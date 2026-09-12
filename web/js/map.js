/**
 * BhuRakshak GIS Map Engine
 */

class BhuRakshakMap {
  constructor(mapContainerId = "leaflet-map") {
    this.containerId = mapContainerId;
    this.map = null;

    this.susceptibleLayer = L.layerGroup();
    this.controlSitesLayer = L.layerGroup();
    this.corridorsLayer = L.layerGroup();
    this.heatmapDensityLayer = L.layerGroup();
    this.reportsLayer = L.layerGroup();

    this.tileLayers = {};
    this.currentBasemap = "obsidian";

    this.features = [];
    this.activeSiteId = null;
    this._moveendTimer = null;

    this.currentFilters = { region: "all", riskLevel: "all", trigger: "all" };
  }

  init() {
    if (this.map) return;

    const topoDetailed = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; Esri, HERE, Garmin, Intermap, USGS, OpenStreetMap', maxZoom: 19
    });
    const osmDetailed = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    });
    const satBase = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19
    });
    const roadsOverlay = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 });
    const placesOverlay = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 });
    const satelliteHybrid = L.layerGroup([satBase, roadsOverlay, placesOverlay]);
    const darkBase = L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 17 });
    const darkLabels = L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 17 });
    const darkDetailed = L.layerGroup([darkBase, roadsOverlay, darkLabels]);

    this.tileLayers = { topo: topoDetailed, osm: osmDetailed, satellite: satelliteHybrid, dark: darkDetailed };
    this.currentBasemap = "topo";

    this.map = L.map(this.containerId, {
      center: CONFIG.MAP.DEFAULT_CENTER,
      zoom: CONFIG.MAP.DEFAULT_ZOOM,
      minZoom: CONFIG.MAP.MIN_ZOOM,
      maxZoom: CONFIG.MAP.MAX_ZOOM,
      zoomControl: false,
      layers: [topoDetailed]
    });

    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    this.susceptibleLayer.addTo(this.map);
    this.controlSitesLayer.addTo(this.map);
    this.corridorsLayer.addTo(this.map);
    this.heatmapDensityLayer.addTo(this.map);
    this.reportsLayer.addTo(this.map);

    this.drawHighwayCorridors();
    this.refreshData();

    // Re-fetch predictions for the new viewport, debounced, whenever the
    // user finishes panning or zooming.
    this.map.on("moveend", () => {
      clearTimeout(this._moveendTimer);
      this._moveendTimer = setTimeout(() => this.refreshData(), 400);
    });

    this.map.on("click", (e) => this.handleMapClick(e));
    this.bindMapControls();
  }

  setBasemap(type) {
    if (!this.tileLayers[type] || this.currentBasemap === type) return;
    this.map.removeLayer(this.tileLayers[this.currentBasemap]);
    this.tileLayers[type].addTo(this.map);
    this.currentBasemap = type;
  }

  drawHighwayCorridors() {
    this.corridorsLayer.clearLayers();
    CONFIG.HIGHWAY_CORRIDORS.forEach(corridor => {
      const glowLine = L.polyline(corridor.path, { color: corridor.color, weight: 8, opacity: 0.35, lineCap: "round", lineJoin: "round" });
      const coreLine = L.polyline(corridor.path, { color: "#ffffff", weight: 3, dashArray: "6, 8", opacity: 0.95 });
      const popup = `
        <div style="font-family:'Inter',sans-serif; color:#f8fafc; padding:4px; min-width:200px;">
          <div style="font-weight:700; color:#38bdf8; font-size:13px; margin-bottom:4px;">🛣️ ${corridor.name}</div>
          <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">${corridor.state}</div>
          <div style="font-size:11px; color:#cbd5e1; line-height:1.4; margin-bottom:8px;">${corridor.summary}</div>
          <button onclick="window.bhuMap.flyTo(${corridor.center[0]}, ${corridor.center[1]}, ${corridor.zoom})"
                  style="width:100%; background:linear-gradient(135deg,#0ea5e9,#0284c7); border:none; color:#fff; padding:6px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">
            Zoom Corridor &rarr;
          </button>
        </div>`;
      glowLine.bindPopup(popup);
      coreLine.bindPopup(popup);
      this.corridorsLayer.addLayer(glowLine);
      this.corridorsLayer.addLayer(coreLine);
    });
  }

  /**
   * Fetch predictions for only the real sites visible in the current
   * viewport, then render them. Replaces the old whole-dataset demo fetch.
   */
  async refreshData() {
    if (!window.api.allSitesLoaded) return; // sites list still loading at startup

    const bounds = this.map.getBounds();
    const siteIds = window.api.getSitesInBounds(bounds);

    if (siteIds.length === 0) {
      this.features = [];
      this.renderMarkers([]);
      return;
    }

    try {
      const riskClasses = this.currentFilters.riskLevel === "all"
        ? ["High", "Medium", "Low"]
        : [this.currentFilters.riskLevel];
      const regions = this.currentFilters.region === "all" ? [] : [this.currentFilters.region];

      const geojson = await window.api.getGeoJSON(siteIds, {
        riskClasses,
        regions,
        includeFeatures: false
      });

      this.features = geojson.features || [];
      this.renderMarkers(this.features);
    } catch (err) {
      console.error("Map refresh error:", err);
    }
  }

  renderMarkers(features) {
    this.susceptibleLayer.clearLayers();
    this.controlSitesLayer.clearLayers();
    this.heatmapDensityLayer.clearLayers();

    const heatPoints = [];

    features.forEach(feature => {
      const coords = feature.geometry.coordinates;
      const lat = coords[1];
      const lon = coords[0];
      const props = feature.properties;
      const risk = props.risk_class || "Low";
      const siteId = props.site_id;
      const prob = props.susceptibility_probability || 0.0;
      const riskConfig = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;
      const isHigh = risk === "High";
      const isMed = risk === "Medium";

      // Every point contributes to the continuous heatmap
      heatPoints.push([lat, lon, prob]);

      // Static (non-blinking) circle markers on their own toggleable layers
      if (isHigh || isMed) {
        const dot = L.circleMarker([lat, lon], {
          radius: isHigh ? 6 : 5,
          color: riskConfig.color,
          fillColor: riskConfig.color,
          fillOpacity: 0.9,
          weight: 1
        });
        dot.bindPopup(this._buildPopupHtml(feature));
        dot.on("click", () => this.selectSite(feature));
        this.susceptibleLayer.addLayer(dot);
      } else {
        const dot = L.circleMarker([lat, lon], {
          radius: 4,
          color: "#38bdf8",
          fillColor: "#38bdf8",
          fillOpacity: 0.75,
          weight: 1
        });
        dot.bindPopup(this._buildPopupHtml(feature));
        dot.on("click", () => this.selectSite(feature));
        this.controlSitesLayer.addLayer(dot);
      }
    });

    if (heatPoints.length > 0) {
      const heat = L.heatLayer(heatPoints, {
        radius: 20,
        blur: 25,
        maxZoom: 12,
        max: 1.2,
        minOpacity: 0.15,
        gradient: {
          0.7: '#1776f2fb', // (low risk)
          0.8: '#f7f709ff', // (medium risk)
          0.9: '#f70808ff'  // (high risk)
        }
      });
      this.heatmapDensityLayer.addLayer(heat);
    }

    if (features.length > 0 && !this.activeSiteId) {
      this.selectSite(features[0]);
    }
  }

  _buildPopupHtml(feature) {
    const p = feature.properties;
    const risk = p.risk_class || "Low";
    const prob = (p.susceptibility_probability * 100).toFixed(1);
    const coords = feature.geometry.coordinates;
    const config = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;
    return `
      <div style="font-family:'Inter',sans-serif; color:#f8fafc; padding:4px; min-width:210px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-weight:700; font-size:13px; color:#38bdf8;">${p.site_id}</span>
          <span class="badge-risk ${config.badgeClass}">${risk}</span>
        </div>
        <div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">
          Susceptibility: <strong style="color:#fff; font-family:'JetBrains Mono',monospace;">${prob}%</strong>
        </div>
        <div style="font-size:11px; color:#64748b; line-height:1.4; margin-bottom:10px;">
          Coords: ${coords[1].toFixed(4)}°N, ${coords[0].toFixed(4)}°E
        </div>
        <div style="display:flex; gap:6px;">
          <button onclick="window.bhuMap.inspectSite('${p.site_id}')"
                  style="flex:1; background:linear-gradient(135deg,#0ea5e9,#0284c7); border:none; color:white; padding:6px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">
            Inspect Telemetry &rarr;
          </button>
          <button onclick="window.bhuMap.dispatchAlertForSite('${p.site_id}')"
                  style="background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#ef4444; padding:6px 8px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;" title="Send SMS/Email Alert">
            🚨 Alert
          </button>
        </div>
      </div>`;
  }

  selectSite(feature) {
    const props = feature.properties;
    this.activeSiteId = props.site_id;
    this.updateSideDrawer(props);
  }

  updateSideDrawer(props) {
    const siteIdEl = document.getElementById("drawer-site-id");
    const regionEl = document.getElementById("drawer-site-region");
    const probEl = document.getElementById("drawer-prob-number");
    const riskBadgeEl = document.getElementById("drawer-risk-badge");
    const gaugeCircle = document.getElementById("drawer-gauge-circle");
    const ndviVal = document.getElementById("drawer-ndvi-val");
    const ndviBar = document.getElementById("drawer-ndvi-bar");
    const ndmiVal = document.getElementById("drawer-ndmi-val");
    const ndmiBar = document.getElementById("drawer-ndmi-bar");
    const sarVvVal = document.getElementById("drawer-sar-vv-val");
    const sarVhVal = document.getElementById("drawer-sar-vh-val");
    const stalenessVal = document.getElementById("drawer-staleness-val");
    if (!siteIdEl) return;

    const prob = props.susceptibility_probability || 0.0;
    const risk = props.risk_class || "Low";
    const riskConfig = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;

    siteIdEl.textContent = props.site_id;
    regionEl.textContent = (props.region || "NER").replace(/_/g, " ").toUpperCase();
    probEl.textContent = `${(prob * 100).toFixed(1)}%`;
    riskBadgeEl.textContent = riskConfig.label;
    riskBadgeEl.className = `gauge-risk-badge ${riskConfig.badgeClass}`;

    if (gaugeCircle) {
      const circumference = 251.2;
      const offset = circumference - (prob * circumference);
      gaugeCircle.style.strokeDasharray = `${circumference}`;
      gaugeCircle.style.strokeDashoffset = `${offset}`;
      gaugeCircle.style.stroke = riskConfig.color;
    }

    const feat = props.feature_snapshot || {};
    // Real backend responses either include a value or omit the key —
    // no synthetic defaults are substituted here.
    const setOrDash = (el, val, fmt = v => v) => { if (el) el.textContent = val !== undefined && val !== null ? fmt(val) : "—"; };

    setOrDash(ndviVal, feat.ndvi, v => v.toFixed(2));
    if (ndviBar) ndviBar.style.width = feat.ndvi !== undefined ? `${Math.min(100, Math.max(0, feat.ndvi * 100))}%` : "0%";
    setOrDash(ndmiVal, feat.ndmi, v => v.toFixed(2));
    if (ndmiBar) {
      if (feat.ndmi !== undefined) {
        const normNdmi = Math.min(100, Math.max(0, ((feat.ndmi + 1) / 2) * 100));
        ndmiBar.style.width = `${normNdmi}%`;
        ndmiBar.style.background = feat.ndmi > 0.5 ? "var(--risk-high)" : "var(--cyan-500)";
      } else {
        ndmiBar.style.width = "0%";
      }
    }
    setOrDash(sarVvVal, feat.sar_vv, v => `${v.toFixed(1)} dB`);
    setOrDash(sarVhVal, feat.sar_vh, v => `${v.toFixed(1)} dB`);
    setOrDash(stalenessVal, feat.ndvi_days_since_obs, v => `${v}d ago`);
  }

  /**
   * Clicking the map now inspects the nearest real monitored site, instead
   * of fabricating a pseudo site_id from raw coordinates (the old code
   * built `point_<lat>_<lon>` and asked the model to "predict" a location
   * with no history — that only worked because the simulation faked a
   * plausible-looking answer for any string).
   */
  handleMapClick(e) {
    const { lat, lng } = e.latlng;
    const nearest = this._findNearestSite(lat, lng, 0.05); // ~5km tolerance
    if (!nearest) {
      const toast = document.getElementById("demo-action-toast") || document.getElementById("map-toast");
      if (toast) {
        toast.textContent = "No monitored site near this point.";
        toast.style.display = "block";
        setTimeout(() => { toast.style.display = "none"; }, 2500);
      }
      return;
    }
    window.api.predictSite(nearest.site_id, true).then(pred => {
      this.updateSideDrawer(pred);
    }).catch(err => console.error("Click-inspect prediction failed:", err));
  }

  _findNearestSite(lat, lon, maxDeg) {
    let best = null;
    let bestDist = maxDeg;
    for (const s of window.api.allSites) {
      const d = Math.hypot(s.lat - lat, s.lon - lon);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best;
  }

  bindMapControls() {
    const stateSelect = document.getElementById("regional-state-select");
    const riskSelect = document.getElementById("regional-risk-select");
    const triggerSelect = document.getElementById("regional-trigger-select");

    if (stateSelect) {
      stateSelect.addEventListener("change", (e) => {
        this.currentFilters.region = e.target.value;
        const reg = CONFIG.REGIONS.find(r => r.id === e.target.value);
        if (reg && reg.center) this.flyTo(reg.center[0], reg.center[1], reg.zoom);
        this.refreshData();
      });
    }
    if (riskSelect) {
      riskSelect.addEventListener("change", (e) => {
        this.currentFilters.riskLevel = e.target.value;
        this.refreshData();
      });
    }
    if (triggerSelect) {
      triggerSelect.addEventListener("change", (e) => {
        this.currentFilters.trigger = e.target.value;
        this.refreshData();
      });
    }

    document.querySelectorAll(".quick-corridor-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const corridorId = btn.getAttribute("data-corridor");
        const corr = CONFIG.HIGHWAY_CORRIDORS.find(c => c.id === corridorId);
        if (corr) this.flyTo(corr.center[0], corr.center[1], corr.zoom);
      });
    });

    document.querySelectorAll("input[name='map-basemap']").forEach(radio => {
      radio.addEventListener("change", (e) => this.setBasemap(e.target.value));
    });

    const toggleLayer = (id, layer) => {
      const cb = document.getElementById(id);
      if (cb) {
        cb.addEventListener("change", (e) => {
          if (e.target.checked) this.map.addLayer(layer);
          else this.map.removeLayer(layer);
        });
      }
    };
    toggleLayer("layer-toggle-susceptible", this.susceptibleLayer);
    toggleLayer("layer-toggle-control", this.controlSitesLayer);
    toggleLayer("layer-toggle-corridors", this.corridorsLayer);
    toggleLayer("layer-toggle-heatmap", this.heatmapDensityLayer);
  }

  inspectSite(siteId) {
    if (window.app && window.app.switchTab) {
      window.app.switchTab("inspector");
      if (window.inspector) window.inspector.loadSite(siteId);
    }
  }

  dispatchAlertForSite(siteId) {
    if (window.app && window.app.switchTab) {
      window.app.switchTab("alerts");
      const sel = document.getElementById("alert-site-select");
      if (sel) {
        sel.value = siteId;
        sel.dispatchEvent(new Event("change"));
      }
    }
  }

  flyTo(lat, lon, zoom = 10) {
    if (this.map) this.map.flyTo([lat, lon], zoom, { duration: 1.2 });
  }
}

window.bhuMap = new BhuRakshakMap();