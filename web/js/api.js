/**
 * BhuRakshak API Client
 * Connects to FastAPI backend (/health, /demo, /predict, /reports)
 * with transparent offline simulation fallback so the UI is always functional.
 */

class BhuRakshakAPI {
  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL;
    this.isBackendOnline = false;
    this.modelLoaded = false;
    this.cachedSites = [];
    this.localReports = this._loadLocalReports();
  }

  /**
   * Health check to detect backend and PyTorch model status
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json();
        this.isBackendOnline = true;
        this.modelLoaded = data.model_loaded === true;
        return {
          online: true,
          status: data.status || "healthy",
          modelLoaded: this.modelLoaded,
          features: data.features || ["ndvi", "ndmi", "sar_vv", "sar_vh", "lat", "lon"]
        };
      }
    } catch (e) {
      // Backend not currently reachable
    }

    this.isBackendOnline = false;
    this.modelLoaded = false;
    return {
      online: false,
      status: "offline_simulation",
      modelLoaded: true, // Simulation engine acts as loaded model
      features: ["ndvi", "ndmi", "sar_vv", "sar_vh", "ndvi_days_since_obs", "ndmi_days_since_obs", "sar_vv_days_since_obs", "sar_vh_days_since_obs", "lat", "lon"]
    };
  }

  /**
   * List available demo sites
   */
  async getDemoSites() {
    if (this.isBackendOnline) {
      try {
        const res = await fetch(`${this.baseUrl}/demo/sites`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          if (data.site_ids && data.site_ids.length > 0) {
            this.cachedSites = data.site_ids;
            return data.site_ids;
          }
        }
      } catch (e) {
        console.warn("Backend /demo/sites failed, using presets:", e);
      }
    }

    // Preset demo sites
    const presetIds = CONFIG.DEMO_SCENARIOS.map(s => s.siteId);
    this.cachedSites = presetIds;
    return presetIds;
  }

  /**
   * Fetch GeoJSON FeatureCollection with filters
   */
  async getGeoJSON(filters = {}) {
    const { minProbability, riskClasses, regions, includeFeatures = true } = filters;

    if (this.isBackendOnline) {
      try {
        const params = new URLSearchParams();
        if (minProbability !== undefined && minProbability !== null) {
          params.append("min_probability", minProbability);
        }
        if (riskClasses && riskClasses.length > 0) {
          riskClasses.forEach(rc => params.append("risk_classes", rc));
        }
        if (regions && regions.length > 0 && !regions.includes("all")) {
          regions.forEach(reg => params.append("regions", reg));
        }
        params.append("include_features", includeFeatures ? "true" : "false");

        const res = await fetch(`${this.baseUrl}/demo/geojson?${params.toString()}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const geojson = await res.json();
          if (geojson.features && geojson.features.length > 0) {
            return geojson;
          }
        }
      } catch (e) {
        console.warn("Backend /demo/geojson failed, using fallback:", e);
      }
    }

    // High fidelity GeoJSON generation from preset demo sites + synthesized NER grid
    return this._generateSimulatedGeoJSON(filters);
  }

  /**
   * Predict susceptibility for a single site
   */
  async predictSite(siteId, includeFeatures = true) {
    if (this.isBackendOnline) {
      try {
        // Try /demo/predict first, then /predict
        let res = await fetch(`${this.baseUrl}/demo/predict/${encodeURIComponent(siteId)}?include_features=${includeFeatures}`, {
          signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) {
          res = await fetch(`${this.baseUrl}/predict/${encodeURIComponent(siteId)}?include_features=${includeFeatures}`, {
            signal: AbortSignal.timeout(4000)
          });
        }
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        console.warn(`Backend prediction for ${siteId} failed:`, e);
      }
    }

    // Match preset demo scenario if available
    const scenario = CONFIG.DEMO_SCENARIOS.find(s => s.siteId === siteId);
    if (scenario) {
      return {
        site_id: scenario.siteId,
        susceptibility_probability: scenario.probability,
        risk_class: scenario.risk,
        region: scenario.region.toLowerCase().replace(/\s+/g, "_"),
        feature_snapshot: includeFeatures ? {
          ndvi: scenario.ndvi,
          ndmi: scenario.ndmi,
          sar_vv: scenario.sar_vv,
          sar_vh: scenario.sar_vh,
          ndvi_days_since_obs: scenario.staleness,
          ndmi_days_since_obs: scenario.staleness,
          sar_vv_days_since_obs: scenario.staleness + 1,
          sar_vh_days_since_obs: scenario.staleness + 1,
          lat: scenario.lat,
          lon: scenario.lon
        } : null
      };
    }

    // Deterministic simulation based on siteId hash
    return this._simulateSitePrediction(siteId, includeFeatures);
  }

  /**
   * Batch predict for list of sites
   */
  async predictBatch(siteIds, filters = {}) {
    if (this.isBackendOnline) {
      try {
        const payload = {
          site_ids: siteIds,
          include_features: filters.includeFeatures ?? true,
          min_probability: filters.minProbability,
          risk_classes: filters.riskClasses,
          regions: filters.regions && !filters.regions.includes("all") ? filters.regions : undefined
        };
        const res = await fetch(`${this.baseUrl}/demo/predict/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        console.warn("Backend predictBatch failed:", e);
      }
    }

    // Simulation
    const results = [];
    for (const sid of siteIds) {
      const p = await this.predictSite(sid, filters.includeFeatures ?? true);
      // Filter checks
      if (filters.minProbability !== undefined && p.susceptibility_probability < filters.minProbability) continue;
      if (filters.riskClasses && filters.riskClasses.length > 0 && !filters.riskClasses.includes(p.risk_class)) continue;
      if (filters.regions && filters.regions.length > 0 && !filters.regions.includes("all") && !filters.regions.includes(p.region)) continue;
      results.push(p);
    }
    return { results, errors: {} };
  }

  /**
   * Fetch submitted field reports
   */
  async getFieldReports(siteId = null) {
    if (this.isBackendOnline) {
      try {
        const url = siteId 
          ? `${this.baseUrl}/reports?site_id=${encodeURIComponent(siteId)}` 
          : `${this.baseUrl}/reports`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          if (data.reports) {
            // Combine with local reports to preserve offline uploads
            return [...data.reports, ...this.localReports];
          }
        }
      } catch (e) {
        console.warn("Backend getFieldReports failed:", e);
      }
    }

    return this.localReports;
  }

  /**
   * Submit a new field report (multipart form)
   */
  async submitFieldReport(formData) {
    if (this.isBackendOnline) {
      try {
        const res = await fetch(`${this.baseUrl}/reports`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        console.warn("Backend report submission failed, saving locally:", e);
      }
    }

    // Fallback: Store locally
    const file = formData.get("media");
    let mediaUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect width="400" height="300" fill="#1e293b"/>
        <text x="50%" y="45%" fill="#94a3b8" font-family="sans-serif" font-size="16" text-anchor="middle">Field Photo Uploaded</text>
        <text x="50%" y="60%" fill="#38bdf8" font-family="sans-serif" font-size="13" text-anchor="middle">${file ? file.name : "Attachment"}</text>
      </svg>`
    );

    if (file && file.type.startsWith("image/")) {
      try {
        mediaUrl = await this._readFileAsDataURL(file);
      } catch (err) {
        console.error("DataURL conversion failed", err);
      }
    }

    const newReport = {
      report_id: "rep_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      submitted_at: new Date().toISOString(),
      latitude: parseFloat(formData.get("latitude")),
      longitude: parseFloat(formData.get("longitude")),
      category: formData.get("category") || "slope_movement",
      description: formData.get("description") || "",
      site_id: formData.get("site_id") || null,
      media_filename: file ? file.name : "field_capture.jpg",
      media_content_type: file ? file.type : "image/jpeg",
      media_url: mediaUrl,
      isLocal: true
    };

    this.localReports.unshift(newReport);
    this._saveLocalReports();
    return newReport;
  }

  // --- Internal Helpers & Realistic Fallback Generation ---

  _readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  _loadLocalReports() {
    try {
      const stored = localStorage.getItem("bhurakshak_reports");
      if (stored) return JSON.parse(stored);
    } catch (e) {}

    // Seed default initial field reports
    return [
      {
        report_id: "rep_sikkim_nh10_01",
        submitted_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        latitude: 27.3389,
        longitude: 88.6065,
        category: "slope_movement",
        description: "Fresh tension crack of ~14 meters observed along NH-10 road verge. Water seepage emerging from retaining wall weep holes.",
        site_id: "sikkim_0812",
        media_filename: "teesta_slope_crack.jpg",
        media_content_type: "image/jpeg",
        media_url: "assets/sample_crack.jpg"
      },
      {
        report_id: "rep_arunachal_02",
        submitted_at: new Date(Date.now() - 3600000 * 14).toISOString(),
        latitude: 27.5838,
        longitude: 91.8769,
        category: "blocked_road",
        description: "Rockfall and mud debris obstructing one lane of Tawang supply route. BRO clearing crew on site with excavators.",
        site_id: "arunachal_pradesh_2652",
        media_filename: "subansiri_rockfall.jpg",
        media_content_type: "image/jpeg",
        media_url: "assets/sample_rockfall.jpg"
      },
      {
        report_id: "rep_meghalaya_03",
        submitted_at: new Date(Date.now() - 3600000 * 26).toISOString(),
        latitude: 25.5788,
        longitude: 91.8933,
        category: "crack",
        description: "Subsidence crack cutting across boundary wall in upper slope village. Continuous rainfall measured at 112mm in 24h.",
        site_id: "meghalaya_5921",
        media_filename: "cherra_subsidence.jpg",
        media_content_type: "image/jpeg",
        media_url: "assets/sample_crack2.jpg"
      }
    ];
  }

  _saveLocalReports() {
    try {
      localStorage.setItem("bhurakshak_reports", JSON.stringify(this.localReports.slice(0, 50)));
    } catch (e) {}
  }

  _simulateSitePrediction(siteId, includeFeatures) {
    let hash = 0;
    for (let i = 0; i < siteId.length; i++) {
      hash = ((hash << 5) - hash) + siteId.charCodeAt(i);
      hash |= 0;
    }
    const norm = Math.abs(hash % 1000) / 1000.0;
    let risk = "Low";
    if (norm >= 0.67) risk = "High";
    else if (norm >= 0.33) risk = "Medium";

    let state = "ner";
    for (const r of CONFIG.REGIONS) {
      if (siteId.toLowerCase().startsWith(r.id)) {
        state = r.id;
        break;
      }
    }

    return {
      site_id: siteId,
      susceptibility_probability: Math.round(norm * 10000) / 10000,
      risk_class: risk,
      region: state,
      feature_snapshot: includeFeatures ? {
        ndvi: Math.round((0.35 + (1 - norm) * 0.45) * 100) / 100,
        ndmi: Math.round((-0.2 + norm * 0.9) * 100) / 100,
        sar_vv: Math.round((-18.0 + norm * 9.0) * 10) / 10,
        sar_vh: Math.round((-24.0 + norm * 8.0) * 10) / 10,
        ndvi_days_since_obs: (Math.abs(hash) % 4) + 1,
        ndmi_days_since_obs: (Math.abs(hash) % 4) + 1,
        sar_vv_days_since_obs: (Math.abs(hash) % 5) + 1,
        sar_vh_days_since_obs: (Math.abs(hash) % 5) + 1,
        lat: 25.5 + norm * 3.0,
        lon: 90.5 + norm * 5.0
      } : null
    };
  }

  _generateSimulatedGeoJSON(filters) {
    const features = [];
    const minProb = filters.minProbability ?? 0.0;
    const allowedRisks = filters.riskClasses && filters.riskClasses.length > 0 ? filters.riskClasses : ["Low", "Medium", "High"];
    const allowedRegions = filters.regions && filters.regions.length > 0 && !filters.regions.includes("all") ? filters.regions : null;

    // Add preset demo scenarios
    for (const s of CONFIG.DEMO_SCENARIOS) {
      const reg = s.region.toLowerCase().replace(/\s+/g, "_");
      if (s.probability < minProb) continue;
      if (!allowedRisks.includes(s.risk)) continue;
      if (allowedRegions && !allowedRegions.includes(reg)) continue;

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [s.lon, s.lat]
        },
        properties: {
          site_id: s.siteId,
          title: s.title,
          susceptibility_probability: s.probability,
          risk_class: s.risk,
          region: reg,
          feature_snapshot: {
            ndvi: s.ndvi,
            ndmi: s.ndmi,
            sar_vv: s.sar_vv,
            sar_vh: s.sar_vh,
            ndvi_days_since_obs: s.staleness,
            ndmi_days_since_obs: s.staleness,
            sar_vv_days_since_obs: s.staleness + 1,
            sar_vh_days_since_obs: s.staleness + 1,
            lat: s.lat,
            lon: s.lon
          }
        }
      });
    }

    // Generate supplementary grid points for Northeast India for comprehensive heatmap display
    const gridSeeds = [
      { id: "arunachal_pradesh_5703", lat: 26.9646, lon: 95.7982, p: 0.542, r: "Medium", reg: "arunachal_pradesh" },
      { id: "arunachal_pradesh_2821", lat: 27.1416, lon: 93.6649, p: 0.789, r: "High", reg: "arunachal_pradesh" },
      { id: "sikkim_1582", lat: 27.1843, lon: 88.5122, p: 0.587, r: "Medium", reg: "sikkim" },
      { id: "sikkim_0411", lat: 27.6521, lon: 88.3210, p: 0.824, r: "High", reg: "sikkim" },
      { id: "meghalaya_6273", lat: 25.3211, lon: 91.6433, p: 0.498, r: "Medium", reg: "meghalaya" },
      { id: "meghalaya_6428", lat: 25.4670, lon: 91.3662, p: 0.215, r: "Low", reg: "meghalaya" },
      { id: "nagaland_4783", lat: 26.1584, lon: 94.5624, p: 0.461, r: "Medium", reg: "nagaland" },
      { id: "manipur_3850", lat: 24.8170, lon: 93.9368, p: 0.778, r: "High", reg: "manipur" },
      { id: "manipur_4010", lat: 25.0422, lon: 94.3611, p: 0.432, r: "Medium", reg: "manipur" },
      { id: "mizoram_7589", lat: 23.7271, lon: 92.7176, p: 0.814, r: "High", reg: "mizoram" },
      { id: "mizoram_8992", lat: 22.8911, lon: 92.9810, p: 0.284, r: "Low", reg: "mizoram" },
      { id: "assam_5776", lat: 25.9812, lon: 92.8714, p: 0.395, r: "Medium", reg: "assam" },
      { id: "assam_6969", lat: 26.7509, lon: 94.2037, p: 0.142, r: "Low", reg: "assam" },
      { id: "west_bengal_0691", lat: 27.0410, lon: 88.2663, p: 0.893, r: "High", reg: "west_bengal" },
      { id: "west_bengal_2429", lat: 26.8500, lon: 88.4200, p: 0.472, r: "Medium", reg: "west_bengal" }
    ];

    for (const g of gridSeeds) {
      if (g.p < minProb) continue;
      if (!allowedRisks.includes(g.r)) continue;
      if (allowedRegions && !allowedRegions.includes(g.reg)) continue;

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [g.lon, g.lat]
        },
        properties: {
          site_id: g.id,
          susceptibility_probability: g.p,
          risk_class: g.r,
          region: g.reg,
          feature_snapshot: {
            ndvi: Math.round((0.70 - g.p * 0.35) * 100) / 100,
            ndmi: Math.round((-0.1 + g.p * 0.75) * 100) / 100,
            sar_vv: Math.round((-17.0 + g.p * 8.0) * 10) / 10,
            sar_vh: Math.round((-23.0 + g.p * 7.0) * 10) / 10,
            ndvi_days_since_obs: 2,
            ndmi_days_since_obs: 2,
            sar_vv_days_since_obs: 3,
            sar_vh_days_since_obs: 3,
            lat: g.lat,
            lon: g.lon
          }
        }
      });
    }

    return {
      type: "FeatureCollection",
      features: features,
      errors: {}
    };
  }
}

window.api = new BhuRakshakAPI();
