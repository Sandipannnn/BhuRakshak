/**
 * BhuRakshak GIS Map Engine
 * High-performance Leaflet map with clean Obsidian Dark tiles (no watermark),
 * Highway vector corridors, layer toggles, quick corridor zoom, and telemetry inspection.
 */

class BhuRakshakMap {
  constructor(mapContainerId = "leaflet-map") {
    this.containerId = mapContainerId;
    this.map = null;
    
    // Layer Groups
    this.susceptibleLayer = L.layerGroup();
    this.controlSitesLayer = L.layerGroup();
    this.corridorsLayer = L.layerGroup();
    this.heatmapDensityLayer = L.layerGroup();
    this.reportsLayer = L.layerGroup();

    // Basemap tiles
    this.tileLayers = {};
    this.currentBasemap = "obsidian";

    this.features = [];
    this.activeSiteId = null;

    this.currentFilters = {
      region: "all",
      riskLevel: "all",
      trigger: "all"
    };
  }

  init() {
    if (this.map) return;

    // High-Detail Basemaps (Rich elevation, mountain passes, highways, towns, rivers)
    const topoDetailed = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; Esri, HERE, Garmin, Intermap, USGS, OpenStreetMap',
      maxZoom: 19
    });

    const osmDetailed = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    });

    const satBase = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 19
    });
    const roadsOverlay = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19
    });
    const placesOverlay = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19
    });
    const satelliteHybrid = L.layerGroup([satBase, roadsOverlay, placesOverlay]);

    const darkBase = L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 17
    });
    const darkLabels = L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 17
    });
    const darkDetailed = L.layerGroup([darkBase, roadsOverlay, darkLabels]);

    this.tileLayers = {
      topo: topoDetailed,
      osm: osmDetailed,
      satellite: satelliteHybrid,
      dark: darkDetailed
    };

    // Default to High-Detail Topographic Elevation & Roads
    this.currentBasemap = "topo";

    this.map = L.map(this.containerId, {
      center: CONFIG.MAP.DEFAULT_CENTER,
      zoom: CONFIG.MAP.DEFAULT_ZOOM,
      minZoom: CONFIG.MAP.MIN_ZOOM,
      maxZoom: CONFIG.MAP.MAX_ZOOM,
      zoomControl: false,
      layers: [topoDetailed]
    });


    // Custom Zoom control bottom-right
    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    // Add all initial overlay groups
    this.susceptibleLayer.addTo(this.map);
    this.controlSitesLayer.addTo(this.map);
    this.corridorsLayer.addTo(this.map);
    this.heatmapDensityLayer.addTo(this.map);
    this.reportsLayer.addTo(this.map);

    // Draw Highway Corridors
    this.drawHighwayCorridors();

    // Load Geo Data
    this.refreshData();

    // Map click inspect listener
    this.map.on("click", (e) => {
      this.handleMapClick(e);
    });

    // Bind UI controls
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
      // Glow underlay polyline
      const glowLine = L.polyline(corridor.path, {
        color: corridor.color,
        weight: 8,
        opacity: 0.35,
        lineCap: "round",
        lineJoin: "round"
      });

      // Core vector line
      const coreLine = L.polyline(corridor.path, {
        color: "#ffffff",
        weight: 3,
        dashArray: "6, 8",
        opacity: 0.95
      });

      const popup = `
        <div style="font-family:'Inter',sans-serif; color:#f8fafc; padding:4px; min-width:200px;">
          <div style="font-weight:700; color:#38bdf8; font-size:13px; margin-bottom:4px;">🛣️ ${corridor.name}</div>
          <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">${corridor.state}</div>
          <div style="font-size:11px; color:#cbd5e1; line-height:1.4; margin-bottom:8px;">${corridor.summary}</div>
          <button onclick="window.bhuMap.flyTo(${corridor.center[0]}, ${corridor.center[1]}, ${corridor.zoom})"
                  style="width:100%; background:linear-gradient(135deg,#0ea5e9,#0284c7); border:none; color:#fff; padding:6px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">
            Zoom Corridor &rarr;
          </button>
        </div>
      `;

      glowLine.bindPopup(popup);
      coreLine.bindPopup(popup);

      this.corridorsLayer.addLayer(glowLine);
      this.corridorsLayer.addLayer(coreLine);
    });
  }

  async refreshData() {
    try {
      const riskClasses = this.currentFilters.riskLevel === "all" 
        ? ["High", "Medium", "Low"] 
        : [this.currentFilters.riskLevel];

      const regions = this.currentFilters.region === "all" 
        ? [] 
        : [this.currentFilters.region];

      const geojson = await window.api.getGeoJSON({
        riskClasses: riskClasses,
        regions: regions,
        includeFeatures: true
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

    features.forEach(feature => {
      const coords = feature.geometry.coordinates; // [lon, lat]
      const lat = coords[1];
      const lon = coords[0];
      const props = feature.properties;
      const risk = props.risk_class || "Low";
      const prob = props.susceptibility_probability || 0.0;
      const siteId = props.site_id;
      const riskConfig = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;

      const isHigh = risk === "High";
      const isMed = risk === "Medium";

      // 1. Susceptible Points Layer
      if (isHigh || isMed) {
        const iconHtml = `
          <div class="pulsing-marker" data-site="${siteId}">
            ${isHigh ? `<div class="pulse-beacon" style="background:${riskConfig.glow}; border: 1px solid ${riskConfig.color};"></div>` : ''}
            <div class="marker-core" style="background:${riskConfig.color}; box-shadow: 0 0 10px ${riskConfig.color};"></div>
          </div>
        `;

        const customIcon = L.divIcon({
          className: "custom-leaflet-pin",
          html: iconHtml,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const marker = L.marker([lat, lon], { icon: customIcon });
        marker.bindPopup(this._buildPopupHtml(feature));
        marker.on("click", () => this.selectSite(feature));
        this.susceptibleLayer.addLayer(marker);

        // 2. Heatmap Density Circles
        const heatCircle = L.circle([lat, lon], {
          radius: isHigh ? 18000 : 12000,
          color: riskConfig.color,
          fillColor: riskConfig.color,
          fillOpacity: isHigh ? 0.22 : 0.12,
          stroke: false
        });
        this.heatmapDensityLayer.addLayer(heatCircle);

      } else {
        // 3. Stable Reference Control Sites Layer
        const controlMarker = L.circleMarker([lat, lon], {
          radius: 5,
          color: "#10b981",
          fillColor: "#10b981",
          fillOpacity: 0.85,
          weight: 1.5
        });
        controlMarker.bindPopup(this._buildPopupHtml(feature));
        controlMarker.on("click", () => this.selectSite(feature));
        this.controlSitesLayer.addLayer(controlMarker);
      }
    });

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
      </div>
    `;
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
    const ndvi = feat.ndvi !== undefined ? feat.ndvi : 0.55;
    const ndmi = feat.ndmi !== undefined ? feat.ndmi : 0.35;
    const sarVv = feat.sar_vv !== undefined ? feat.sar_vv : -12.4;
    const sarVh = feat.sar_vh !== undefined ? feat.sar_vh : -18.7;
    const stale = feat.ndvi_days_since_obs !== undefined ? feat.ndvi_days_since_obs : 2;

    if (ndviVal) ndviVal.textContent = ndvi.toFixed(2);
    if (ndviBar) ndviBar.style.width = `${Math.min(100, Math.max(0, ndvi * 100))}%`;

    if (ndmiVal) ndmiVal.textContent = ndmi.toFixed(2);
    if (ndmiBar) {
      const normNdmi = Math.min(100, Math.max(0, ((ndmi + 1) / 2) * 100));
      ndmiBar.style.width = `${normNdmi}%`;
      ndmiBar.style.background = ndmi > 0.5 ? "var(--risk-high)" : "var(--cyan-500)";
    }

    if (sarVvVal) sarVvVal.textContent = `${sarVv.toFixed(1)} dB`;
    if (sarVhVal) sarVhVal.textContent = `${sarVh.toFixed(1)} dB`;
    if (stalenessVal) stalenessVal.textContent = `${stale}d ago`;
  }

  handleMapClick(e) {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    
    // Simulate query for clicked point
    const pseudoSiteId = `point_${Math.abs(Math.round(lat*100))}_${Math.abs(Math.round(lon*100))}`;
    window.api.predictSite(pseudoSiteId, true).then(pred => {
      this.updateSideDrawer({
        ...pred,
        site_id: `Inspect (${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E)`
      });
    });
  }

  bindMapControls() {
    // Top-Left Regional Filters
    const stateSelect = document.getElementById("regional-state-select");
    const riskSelect = document.getElementById("regional-risk-select");
    const triggerSelect = document.getElementById("regional-trigger-select");

    if (stateSelect) {
      stateSelect.addEventListener("change", (e) => {
        this.currentFilters.region = e.target.value;
        const reg = CONFIG.REGIONS.find(r => r.id === e.target.value);
        if (reg && reg.center) {
          this.flyTo(reg.center[0], reg.center[1], reg.zoom);
        }
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

    // Quick Corridors
    document.querySelectorAll(".quick-corridor-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const corridorId = btn.getAttribute("data-corridor");
        const corr = CONFIG.HIGHWAY_CORRIDORS.find(c => c.id === corridorId);
        if (corr) {
          this.flyTo(corr.center[0], corr.center[1], corr.zoom);
        }
      });
    });

    // Top-Right Layer Switcher Radios
    document.querySelectorAll("input[name='map-basemap']").forEach(radio => {
      radio.addEventListener("change", (e) => {
        this.setBasemap(e.target.value);
      });
    });

    // Layer Checkboxes
    const toggleLayer = (id, layer) => {
      const cb = document.getElementById(id);
      if (cb) {
        cb.addEventListener("change", (e) => {
          if (e.target.checked) {
            this.map.addLayer(layer);
          } else {
            this.map.removeLayer(layer);
          }
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
      if (window.inspector) {
        window.inspector.loadSite(siteId);
      }
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
    if (this.map) {
      this.map.flyTo([lat, lon], zoom, { duration: 1.2 });
    }
  }
}

window.bhuMap = new BhuRakshakMap();
