/**
 * BhuRakshak AI Susceptibility Inspector & Batch Analysis
 */

class SusceptibilityInspector {
  constructor() {
    this.currentSite = null;
    this.batchResults = [];
  }

  init() {
    this.populateSiteDropdown();
    this.bindEvents();
    if (window.api.allSites.length > 0) {
      this.loadSite(window.api.allSites[0].site_id);
    }
  }

  populateSiteDropdown() {
    const select = document.getElementById("inspector-site-select");
    if (!select) return;

    // NOTE: window.api.allSites now holds ~9,685 real sites instead of 58
    // demo ones. A plain <select> with that many <option>s is functional
    // but not great UX — worth swapping for a searchable combobox
    // (e.g. filter-as-you-type over this same array) as a follow-up.
    select.innerHTML = "";
    window.api.allSites.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.site_id;
      opt.textContent = s.site_id;
      select.appendChild(opt);
    });
  }

  bindEvents() {
    const select = document.getElementById("inspector-site-select");
    if (select) {
      select.addEventListener("change", (e) => this.loadSite(e.target.value));
    }
    const runBatchBtn = document.getElementById("run-batch-btn");
    if (runBatchBtn) {
      runBatchBtn.addEventListener("click", () => this.runBatchAnalysis());
    }
    const exportCsvBtn = document.getElementById("export-batch-csv");
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => this.exportBatchCSV());
    }
  }

  async loadSite(siteId) {
    const loadingBanner = document.getElementById("inspector-loading");
    if (loadingBanner) loadingBanner.style.display = "block";
    try {
      const pred = await window.api.predictSite(siteId, true);
      this.currentSite = pred;
      this.renderSiteDetails(pred);
    } catch (e) {
      console.error("Inspector load site failed:", e);
      const interpEl = document.getElementById("insp-interpretation-text");
      if (interpEl) interpEl.innerHTML = `<span style="color:#ef4444;">Failed to load prediction for ${siteId}: ${e.message}</span>`;
    } finally {
      if (loadingBanner) loadingBanner.style.display = "none";
    }
  }

  renderSiteDetails(pred) {
    const prob = pred.susceptibility_probability;
    const risk = pred.risk_class;
    const riskConfig = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;

    const titleEl = document.getElementById("insp-site-id");
    const regEl = document.getElementById("insp-region-badge");
    if (titleEl) titleEl.textContent = pred.site_id;
    if (regEl) regEl.textContent = (pred.region || "NER").replace(/_/g, " ").toUpperCase();

    const gaugeCircle = document.getElementById("insp-gauge-circle");
    const gaugeNum = document.getElementById("insp-gauge-val");
    const riskBadge = document.getElementById("insp-risk-badge");
    const riskDesc = document.getElementById("insp-risk-desc");

    if (gaugeNum) gaugeNum.textContent = `${(prob * 100).toFixed(1)}%`;
    if (riskBadge) {
      riskBadge.textContent = `${risk} Susceptibility`;
      riskBadge.className = `badge-risk ${riskConfig.badgeClass}`;
    }
    if (riskDesc) riskDesc.textContent = riskConfig.description;

    if (gaugeCircle) {
      const circumference = 251.2;
      const offset = circumference - (prob * circumference);
      gaugeCircle.style.strokeDasharray = `${circumference}`;
      gaugeCircle.style.strokeDashoffset = `${offset}`;
      gaugeCircle.style.stroke = riskConfig.color;
    }

    // No synthetic defaults — if the backend didn't return a value, show "—"
    const snap = pred.feature_snapshot || {};
    const has = k => snap[k] !== undefined && snap[k] !== null;

    this._setVal("insp-ndvi-val", has("ndvi") ? snap.ndvi.toFixed(3) : "—");
    this._setVal("insp-ndmi-val", has("ndmi") ? snap.ndmi.toFixed(3) : "—");
    this._setVal("insp-sar-vv-val", has("sar_vv") ? `${snap.sar_vv.toFixed(1)} dB` : "—");
    this._setVal("insp-sar-vh-val", has("sar_vh") ? `${snap.sar_vh.toFixed(1)} dB` : "—");
    this._setVal("insp-staleness-val", has("ndvi_days_since_obs") ? `${snap.ndvi_days_since_obs} days` : "—");

    this._setWidth("insp-ndvi-bar", has("ndvi") ? `${Math.min(100, Math.max(0, snap.ndvi * 100))}%` : "0%");
    this._setWidth("insp-ndmi-bar", has("ndmi") ? `${Math.min(100, Math.max(0, ((snap.ndmi + 1) / 2) * 100))}%` : "0%");

    const interpEl = document.getElementById("insp-interpretation-text");
    if (interpEl) {
      const ndvi = has("ndvi") ? snap.ndvi : null;
      const ndmi = has("ndmi") ? snap.ndmi : null;
      const sarVv = has("sar_vv") ? snap.sar_vv : null;
      let text = `AI Transformer analyzed the trailing 30-day temporal sequence for <strong>${pred.site_id}</strong>. `;
      if (prob >= 0.67) {
        text += `High moisture saturation${ndmi !== null ? ` (NDMI: ${ndmi.toFixed(2)})` : ""}${sarVv !== null ? ` coupled with steep SAR roughness signals (${sarVv.toFixed(1)} dB)` : ""} indicates heightened risk of gravitational slope displacement under rainfall loading. Pre-emptive monitoring is strongly recommended.`;
      } else if (prob >= 0.33) {
        text += `Moderate moisture indicators${ndmi !== null ? ` (NDMI: ${ndmi.toFixed(2)})` : ""}${ndvi !== null ? ` and vegetation canopy (NDVI: ${ndvi.toFixed(2)})` : ""} place this zone on watch. Terrain is vulnerable during extended torrential storms.`;
      } else {
        text += `${ndvi !== null ? `High vegetative root stability (NDVI: ${ndvi.toFixed(2)}) and ` : ""}low soil moisture index indicate solid slope stability under normal hydrological conditions.`;
      }
      interpEl.innerHTML = text;
    }
  }

  /**
   * Runs batch prediction over the sites currently visible on the map,
   * instead of the full site catalog — mirrors map.js's viewport-bounded
   * fetch so this table and the map stay in sync, and so we're never
   * running the transformer over ~9,685 sites in one request.
   */
  async runBatchAnalysis() {
    const tableBody = document.getElementById("batch-table-body");
    const countEl = document.getElementById("batch-count");
    if (!tableBody) return;

    if (!window.bhuMap || !window.bhuMap.map) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#ef4444;">Map not initialized yet.</td></tr>`;
      return;
    }

    const bounds = window.bhuMap.map.getBounds();
    const sites = window.api.getSitesInBounds(bounds);

    if (sites.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">No monitored sites in the current map view. Pan/zoom to an area with sites, then run again.</td></tr>`;
      if (countEl) countEl.textContent = `0 sites evaluated`;
      return;
    }

    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">Processing Transformer batch inference on ${sites.length} visible sites...</td></tr>`;

    try {
      const res = await window.api.predictBatch(sites, { includeFeatures: true });
      this.batchResults = res.results || [];
      if (countEl) countEl.textContent = `${this.batchResults.length} sites evaluated`;

      tableBody.innerHTML = "";
      this.batchResults.forEach(item => {
        const risk = item.risk_class;
        const config = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;
        const p = (item.susceptibility_probability * 100).toFixed(1);
        const feat = item.feature_snapshot || {};

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="font-family:'JetBrains Mono',monospace; color:#38bdf8; font-weight:600;">${item.site_id}</td>
          <td style="text-transform:capitalize;">${(item.region || "NER").replace(/_/g, " ")}</td>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-family:'JetBrains Mono',monospace; font-weight:600; width:45px;">${p}%</span>
              <div style="width:70px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                <div style="width:${p}%; height:100%; background:${config.color};"></div>
              </div>
            </div>
          </td>
          <td><span class="badge-risk ${config.badgeClass}">${risk}</span></td>
          <td style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#94a3b8;">
            NDVI: ${feat.ndvi !== undefined ? feat.ndvi.toFixed(2) : '—'} | NDMI: ${feat.ndmi !== undefined ? feat.ndmi.toFixed(2) : '—'}
          </td>
          <td>
            <button onclick="window.inspector.loadSite('${item.site_id}')"
                    style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">
              Inspect
            </button>
          </td>`;
        tableBody.appendChild(tr);
      });
    } catch (e) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#ef4444;">Batch prediction error: ${e.message}</td></tr>`;
    }
  }

  exportBatchCSV() {
    if (!this.batchResults || this.batchResults.length === 0) {
      alert("Please run batch analysis first to export data.");
      return;
    }
    const headers = ["site_id", "region", "risk_class", "susceptibility_probability", "ndvi", "ndmi", "sar_vv", "sar_vh"];
    const rows = this.batchResults.map(r => {
      const f = r.feature_snapshot || {};
      return [r.site_id, r.region || "", r.risk_class, r.susceptibility_probability, f.ndvi ?? "", f.ndmi ?? "", f.sar_vv ?? "", f.sar_vh ?? ""].join(",");
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `bhurakshak_susceptibility_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  _setVal(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
  _setWidth(id, width) { const el = document.getElementById(id); if (el) el.style.width = width; }
}

window.inspector = new SusceptibilityInspector();