/**
 * BhuRakshak AI Susceptibility Inspector & Batch Analysis
 * Single-site interactive deep dive, telemetry sparklines, and batch prediction table.
 */

class SusceptibilityInspector {
  constructor() {
    this.currentSite = null;
    this.batchResults = [];
  }

  init() {
    this.populateSiteDropdown();
    this.bindEvents();
    // Default load first scenario
    if (CONFIG.DEMO_SCENARIOS.length > 0) {
      this.loadSite(CONFIG.DEMO_SCENARIOS[0].siteId);
    }
  }

  async populateSiteDropdown() {
    const select = document.getElementById("inspector-site-select");
    if (!select) return;

    try {
      const siteIds = await window.api.getDemoSites();
      select.innerHTML = "";
      siteIds.forEach(sid => {
        const opt = document.createElement("option");
        opt.value = sid;
        opt.textContent = sid;
        select.appendChild(opt);
      });
    } catch (e) {
      console.warn("Dropdown populate failed:", e);
    }
  }

  bindEvents() {
    const select = document.getElementById("inspector-site-select");
    if (select) {
      select.addEventListener("change", (e) => {
        this.loadSite(e.target.value);
      });
    }

    const runBatchBtn = document.getElementById("run-batch-btn");
    if (runBatchBtn) {
      runBatchBtn.addEventListener("click", () => {
        this.runBatchAnalysis();
      });
    }

    const exportCsvBtn = document.getElementById("export-batch-csv");
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => {
        this.exportBatchCSV();
      });
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
    } finally {
      if (loadingBanner) loadingBanner.style.display = "none";
    }
  }

  renderSiteDetails(pred) {
    const prob = pred.susceptibility_probability;
    const risk = pred.risk_class;
    const riskConfig = CONFIG.RISK_LEVELS[risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;

    // Header & Meta
    const titleEl = document.getElementById("insp-site-id");
    const regEl = document.getElementById("insp-region-badge");
    if (titleEl) titleEl.textContent = pred.site_id;
    if (regEl) regEl.textContent = (pred.region || "NER").replace(/_/g, " ").toUpperCase();

    // Large Gauge
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
      const circumference = 251.2; // 2 * PI * 40
      const offset = circumference - (prob * circumference);
      gaugeCircle.style.strokeDasharray = `${circumference}`;
      gaugeCircle.style.strokeDashoffset = `${offset}`;
      gaugeCircle.style.stroke = riskConfig.color;
    }

    // Telemetry Breakdown
    const snap = pred.feature_snapshot || {};
    const ndvi = snap.ndvi ?? 0.52;
    const ndmi = snap.ndmi ?? 0.38;
    const sarVv = snap.sar_vv ?? -11.8;
    const sarVh = snap.sar_vh ?? -17.5;
    const staleness = snap.ndvi_days_since_obs ?? 2;

    this._setVal("insp-ndvi-val", ndvi.toFixed(3));
    this._setVal("insp-ndmi-val", ndmi.toFixed(3));
    this._setVal("insp-sar-vv-val", `${sarVv.toFixed(1)} dB`);
    this._setVal("insp-sar-vh-val", `${sarVh.toFixed(1)} dB`);
    this._setVal("insp-staleness-val", `${staleness} days`);

    // Meter bars
    this._setWidth("insp-ndvi-bar", `${Math.min(100, Math.max(0, ndvi * 100))}%`);
    const ndmiPercent = Math.min(100, Math.max(0, ((ndmi + 1) / 2) * 100));
    this._setWidth("insp-ndmi-bar", `${ndmiPercent}%`);

    // Dynamic Interpretation paragraph
    const interpEl = document.getElementById("insp-interpretation-text");
    if (interpEl) {
      let text = `AI Transformer analyzed the trailing 30-day temporal sequence for <strong>${pred.site_id}</strong>. `;
      if (prob >= 0.67) {
        text += `High moisture saturation (NDMI: ${ndmi.toFixed(2)}) coupled with steep SAR roughness signals (-${Math.abs(sarVv).toFixed(1)} dB) indicates heightened risk of gravitational slope displacement under rainfall loading. Pre-emptive monitoring is strongly recommended.`;
      } else if (prob >= 0.33) {
        text += `Moderate moisture indicators (NDMI: ${ndmi.toFixed(2)}) and steady vegetation canopy (NDVI: ${ndvi.toFixed(2)}) place this zone on watch. Terrain is vulnerable during extended torrential storms.`;
      } else {
        text += `High vegetative root stability (NDVI: ${ndvi.toFixed(2)}) and low soil moisture index indicate solid slope stability under normal hydrological conditions.`;
      }
      interpEl.innerHTML = text;
    }
  }

  async runBatchAnalysis() {
    const tableBody = document.getElementById("batch-table-body");
    const countEl = document.getElementById("batch-count");
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">Processing Transformer batch inference...</td></tr>`;

    try {
      const sites = await window.api.getDemoSites();
      const res = await window.api.predictBatch(sites, { includeFeatures: true });
      this.batchResults = res.results || [];

      if (countEl) countEl.textContent = `${this.batchResults.length} sites evaluated`;

      tableBody.innerHTML = "";
      this.batchResults.forEach((item, idx) => {
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
            NDVI: ${feat.ndvi !== undefined ? feat.ndvi.toFixed(2) : '-'} | NDMI: ${feat.ndmi !== undefined ? feat.ndmi.toFixed(2) : '-'}
          </td>
          <td>
            <button onclick="window.inspector.loadSite('${item.site_id}')" 
                    style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">
              Inspect
            </button>
          </td>
        `;
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
      return [
        r.site_id,
        r.region || "",
        r.risk_class,
        r.susceptibility_probability,
        f.ndvi ?? "",
        f.ndmi ?? "",
        f.sar_vv ?? "",
        f.sar_vh ?? ""
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bhurakshak_susceptibility_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  _setVal(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  _setWidth(id, width) {
    const el = document.getElementById(id);
    if (el) el.style.width = width;
  }
}

window.inspector = new SusceptibilityInspector();
