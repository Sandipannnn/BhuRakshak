/**
 * BhuRakshak API Client
 * Connects to FastAPI backend (/health, /predict, /reports) using real
 * trained-model predictions only. No demo/simulation fallback — if the
 * backend is offline, calls fail explicitly so the UI can show that state
 * rather than silently rendering fake data.
 */

class BhuRakshakAPI {
  async _fetchWithTimeout(url, options = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn(`Request timed out after ${timeout} ms`);
        reject(new Error(`Request timed out after ${timeout} ms`));
      }, timeout);

      fetch(url, options)
        .then(res => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL;
    this.isBackendOnline = false;
    this.modelLoaded = false;
    this.allSites = [];       // [{site_id, lat, lon}] — fetched once, cached
    this.allSitesLoaded = false;
    this.localReports = this._loadLocalReports();
  }

  /**
   * Health check to detect backend and PyTorch model status
   */
  async checkHealth() {
    try {
      const response = await this._fetchWithTimeout(`${this.baseUrl}/health`, {
        method: "GET",
        headers: { "Accept": "application/json" },
      }, 3000);
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
    return { online: false, status: "offline", modelLoaded: false, features: [] };
  }

  /**
   * Fetch and cache every known real site_id + coordinates. Call once at
   * startup; the map/viewport filter then works entirely from this cached
   * list without re-hitting the backend just to know what sites exist.
   */
  async loadAllSites() {
    if (this.allSitesLoaded) return this.allSites;
    try {
      const res = await this._fetchWithTimeout(`${this.baseUrl}/predict/sites`, {}, 25000);
      if (res.ok) {
        this.allSites = await res.json();
        this.allSitesLoaded = true;
        return this.allSites;
      }
    } catch (e) {
      console.error("Failed to load site list from /predict/sites:", e);
    }
    return [];
  }

  /**
   * Given the cached site list and a Leaflet LatLngBounds, return just the
   * site_ids currently visible on screen.
   */
  getSitesInBounds(bounds) {
    return this.allSites
      .filter(s => bounds.contains([s.lat, s.lon]))
      .map(s => s.site_id);
  }

  /**
   * Fetch GeoJSON FeatureCollection for a specific list of site_ids.
   * Keep payloads under the backend's request shape limit by batching the
   * site_id list into chunks of 500, then merge the returned features/errors.
   */
  async getGeoJSON(siteIds, filters = {}) {
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return { type: "FeatureCollection", features: [], errors: {} };
    }

    const { minProbability, riskClasses, regions, includeFeatures = true } = filters;
    const combined = { type: "FeatureCollection", features: [], errors: {} };
    const siteChunks = [];

    for (let i = 0; i < siteIds.length; i += 500) {
      siteChunks.push(siteIds.slice(i, i + 500));
    }

    for (const chunk of siteChunks) {
      const payload = {
        site_ids: chunk,
        include_features: includeFeatures,
        min_probability: minProbability,
        risk_classes: riskClasses,
        regions: regions && !regions.includes("all") ? regions : undefined
      };

      const res = await this._fetchWithTimeout(`${this.baseUrl}/predict/geojson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, 30000);

      if (!res.ok) {
        throw new Error(`predict/geojson failed: ${res.status}`);
      }

      const data = await res.json();
      combined.features.push(...(data.features || []));
      if (data.errors) Object.assign(combined.errors, data.errors);
    }

    return combined;
  }

  /**
   * Predict susceptibility for a single real site.
   */
  async predictSite(siteId, includeFeatures = true) {
    const res = await this._fetchWithTimeout(
      `${this.baseUrl}/predict/${encodeURIComponent(siteId)}?include_features=${includeFeatures}`,
      {},
      20000,
    );
    if (!res.ok) throw new Error(`predict/${siteId} failed: ${res.status}`);
    return await res.json();
  }

  /**
   * Batch predict for a list of real site_ids.
   * Chunk large site lists into 500-site requests and merge the response shape
   * exactly like the backend's BatchSusceptibilityResponse.
   */
  async predictBatch(siteIds, filters = {}) {
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return { results: [], errors: {} };
    }

    const combined = { results: [], errors: {} };
    const siteChunks = [];

    for (let i = 0; i < siteIds.length; i += 500) {
      siteChunks.push(siteIds.slice(i, i + 500));
    }

    for (const chunk of siteChunks) {
      const payload = {
        site_ids: chunk,
        include_features: filters.includeFeatures ?? true,
        min_probability: filters.minProbability,
        risk_classes: filters.riskClasses,
        regions: filters.regions && !filters.regions.includes("all") ? filters.regions : undefined
      };

      const res = await this._fetchWithTimeout(`${this.baseUrl}/predict/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, 30000);

      if (!res.ok) {
        throw new Error(`predict/batch failed: ${res.status}`);
      }

      const data = await res.json();
      combined.results.push(...(data.results || []));
      if (data.errors) Object.assign(combined.errors, data.errors);
    }

    return combined;
  }

  /**
   * Fetch submitted field reports (unchanged — not part of demo/real split)
   */
  async getFieldReports(siteId = null) {
    if (this.isBackendOnline) {
      try {
        const url = siteId
          ? `${this.baseUrl}/reports?site_id=${encodeURIComponent(siteId)}`
          : `${this.baseUrl}/reports`;
        const res = await this._fetchWithTimeout(url, {}, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.reports) return [...data.reports, ...this.localReports];
        }
      } catch (e) {
        console.warn("Backend getFieldReports failed:", e);
      }
    }
    return this.localReports;
  }

  /**
   * Submit a new field report (unchanged)
   */
  async submitFieldReport(formData) {
    if (this.isBackendOnline) {
      try {
        const res = await this._fetchWithTimeout(`${this.baseUrl}/reports`, {
          method: "POST",
          body: formData,
        }, 10000);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn("Backend report submission failed, saving locally:", e);
      }
    }

    const file = formData.get("media");
    let mediaUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect width="400" height="300" fill="#1e293b"/>
        <text x="50%" y="45%" fill="#94a3b8" font-family="sans-serif" font-size="16" text-anchor="middle">Field Photo Uploaded</text>
        <text x="50%" y="60%" fill="#38bdf8" font-family="sans-serif" font-size="13" text-anchor="middle">${file ? file.name : "Attachment"}</text>
      </svg>`
    );
    if (file && file.type.startsWith("image/")) {
      try { mediaUrl = await this._readFileAsDataURL(file); } catch (err) { console.error("DataURL conversion failed", err); }
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

  // --- Internal Helpers ---

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
    } catch (e) { }
    return [];
  }

  _saveLocalReports() {
    try {
      localStorage.setItem("bhurakshak_reports", JSON.stringify(this.localReports.slice(0, 50)));
    } catch (e) { }
  }
}

window.api = new BhuRakshakAPI();