/**
 * BhuRakshak SMS & Email Alert Dispatch System
 */

class AlertSystem {
  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim());
  }

  constructor() {
    this.smsRecipients = [...CONFIG.ALERTS.DEFAULT_SMS_RECIPIENTS];
    this.emailRecipients = [...CONFIG.ALERTS.DEFAULT_EMAIL_RECIPIENTS];
    this.dispatchLogs = this._loadLogs();
    this.activeSite = null; // loaded async from a real prediction now
    this.threshold = 70;
  }

  async init() {
    this.initApiKeyField();
    this.renderRecipients();
    this.populateSiteSelector();
    this.bindEvents();
    await this.loadActiveSiteFromSelector();
    this.renderLogs();
  }

  initApiKeyField() {
    const keyInput = document.getElementById("fast2sms-api-key-input");
    const saveBtn = document.getElementById("btn-save-fast2sms-key");
    const status = document.getElementById("api-key-save-status");
    if (keyInput) {
      keyInput.value = "";
      keyInput.placeholder = "Configured on backend";
      keyInput.disabled = true;
    }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.style.display = "none"; }
    if (status) { status.textContent = "Fast2SMS key is configured on the backend"; status.style.display = "inline"; }
  }

  populateSiteSelector() {
    const sel = document.getElementById("alert-site-select");
    if (!sel) return;
    // Same caveat as inspector.js: ~9,685 real sites in a plain <select>
    // works but isn't great UX — a filter-as-you-type combobox over
    // window.api.allSites would be a worthwhile follow-up here too.
    sel.innerHTML = "";
    window.api.allSites.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.site_id;
      opt.textContent = s.site_id;
      sel.appendChild(opt);
    });
  }

  async loadActiveSiteFromSelector() {
    const sel = document.getElementById("alert-site-select");
    const siteId = sel && sel.value ? sel.value : (window.api.allSites[0] && window.api.allSites[0].site_id);
    if (!siteId) return;
    await this.setActiveSiteById(siteId);
  }

  async setActiveSiteById(siteId) {
    try {
      const pred = await window.api.predictSite(siteId, true);
      this.activeSite = this._toAlertSite(pred);
      this.updatePreviews();
    } catch (e) {
      console.error("Failed to load site for alert preview:", e);
      this.showToast(`Failed to load ${siteId}: ${e.message}`);
    }
  }

  /**
   * Real /predict responses have no narrative "title" and may return a
   * partial feature_snapshot — this adapts the response into the shape
   * the preview/dispatch code expects, with explicit "—" fallbacks
   * instead of the old scenario object's fully-populated fiction.
   */
  _toAlertSite(pred) {
    const snap = pred.feature_snapshot || {};
    return {
      siteId: pred.site_id,
      region: (pred.region || "NER").replace(/_/g, " "),
      title: `${pred.site_id} Monitoring Site`,
      probability: pred.susceptibility_probability,
      ndvi: snap.ndvi,
      ndmi: snap.ndmi,
      sar_vv: snap.sar_vv,
      sar_vh: snap.sar_vh,
      lat: snap.lat,
      lon: snap.lon
    };
  }

  bindEvents() {
    const siteSel = document.getElementById("alert-site-select");
    if (siteSel) {
      siteSel.addEventListener("change", (e) => this.setActiveSiteById(e.target.value));
    }

    const threshInput = document.getElementById("alert-threshold-slider");
    const threshVal = document.getElementById("alert-threshold-val");
    if (threshInput && threshVal) {
      threshInput.addEventListener("input", (e) => {
        this.threshold = parseInt(e.target.value);
        threshVal.textContent = `${this.threshold}%`;
        this.updatePreviews();
      });
    }

    const sendBtn = document.getElementById("btn-dispatch-alerts");
    if (sendBtn) sendBtn.addEventListener("click", () => this.dispatchEmergencyAlert());

    const addSmsBtn = document.getElementById("btn-add-sms");
    if (addSmsBtn) {
      addSmsBtn.addEventListener("click", () => {
        const name = prompt("Enter Contact Name (e.g. Control Room Officer):");
        const phone = prompt("Enter Mobile Number with +91:");
        if (name && phone) {
          const cleaned = this._cleanPhoneNumbers([phone]);
          if (cleaned.length !== 1) {
            this.showToast("Invalid Indian mobile number. Enter a valid 10-digit number.");
            return;
          }
          this.smsRecipients.push({ name, phone, role: "Field Responder" });
          this.renderRecipients();
        }
      });
    }

    const addEmailBtn = document.getElementById("btn-add-email");
    if (addEmailBtn) {
      addEmailBtn.addEventListener("click", () => {
        const name = prompt("Enter Department Name:");
        const email = prompt("Enter Official Email Address:");
        if (name && email) {
          if (!this.isValidEmail(email)) { this.showToast(`Invalid email address: ${email}`); return; }
          this.emailRecipients.push({ name, email, dept: "Emergency Cell" });
          this.renderRecipients();
        }
      });
    }

    const testEmailBtn = document.getElementById("btn-test-email");
    if (testEmailBtn) {
      testEmailBtn.addEventListener("click", async () => {
        const emails = this.emailRecipients.map(r => r.email).filter(e => e);
        if (emails.length === 0) { this.showToast("No email recipients configured for test."); return; }
        for (const email of emails) {
          if (!this.isValidEmail(email)) { this.showToast(`Invalid email address: ${email}`); return; }
        }
        try {
          const res = await fetch("/alerts/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emails, subject: "[TEST] BhuRakshak Email Alert", body: "This is a test email sent from the BhuRakshak alert system." })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || data.message || "Email request failed.");
          this.showToast(data.success ? "Test email sent successfully." : `Test email failed: ${data.message || "Unknown error"}`);
        } catch (err) {
          this.showToast(`Error sending test email: ${err.message}`);
        }
      });
    }
  }

  updatePreviews() {
    if (!this.activeSite) return;
    const s = this.activeSite;
    const prob = (s.probability * 100).toFixed(1);
    const corridor = s.title;
    const ndmiStr = s.ndmi != null ? s.ndmi.toFixed(2) : "—";
    const sarVvStr = s.sar_vv != null ? s.sar_vv.toFixed(1) : "—";
    const coordsStr = (s.lat != null && s.lon != null) ? `${s.lat.toFixed(4)}°N, ${s.lon.toFixed(4)}°E` : "Coordinates unavailable";

    const smsText = CONFIG.ALERTS.SMS_TEMPLATE
      .replace("{prob}", prob).replace("{site}", s.siteId).replace("{region}", s.region)
      .replace("{ndmi}", ndmiStr).replace("{corridor}", corridor);

    const smsPreviewEl = document.getElementById("sms-preview-text");
    const smsCountEl = document.getElementById("sms-char-counter");
    if (smsPreviewEl) smsPreviewEl.textContent = smsText;
    if (smsCountEl) {
      const chars = smsText.length;
      const segments = Math.max(1, Math.ceil(chars / 160));
      smsCountEl.textContent = `${chars} chars (${segments} SMS segment${segments > 1 ? "s" : ""})`;
    }

    const emailSubject = CONFIG.ALERTS.EMAIL_SUBJECT.replace("{region}", s.region).replace("{site}", s.siteId);
    const emailHtml = CONFIG.ALERTS.EMAIL_TEMPLATE_HTML
      .replace(/{corridor}/g, corridor).replace(/{region}/g, s.region).replace(/{site}/g, s.siteId)
      .replace(/{coords}/g, coordsStr).replace(/{prob}/g, prob)
      .replace(/{ndmi}/g, ndmiStr).replace(/{sar_vv}/g, sarVvStr);

    const emailSubjEl = document.getElementById("email-preview-subject");
    const emailBodyEl = document.getElementById("email-preview-body");
    if (emailSubjEl) emailSubjEl.textContent = emailSubject;
    if (emailBodyEl) emailBodyEl.innerHTML = emailHtml;
  }

  renderRecipients() {
    const smsList = document.getElementById("sms-recipients-list");
    const emailList = document.getElementById("email-recipients-list");
    if (smsList) {
      smsList.innerHTML = "";
      this.smsRecipients.forEach((r, idx) => {
        const item = document.createElement("div");
        item.className = "recipient-item";
        item.innerHTML = `
          <div>
            <div style="font-weight:600; font-size:12px; color:#fff;">${r.name}</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#38bdf8;">${r.phone} • <span style="color:#94a3b8;">${r.role}</span></div>
          </div>
          <button onclick="window.alerts.removeSms(${idx})" style="background:none;border:none;color:#ef4444;font-size:14px;cursor:pointer;">&times;</button>`;
        smsList.appendChild(item);
      });
    }
    if (emailList) {
      emailList.innerHTML = "";
      this.emailRecipients.forEach((r, idx) => {
        const item = document.createElement("div");
        item.className = "recipient-item";
        item.innerHTML = `
          <div>
            <div style="font-weight:600; font-size:12px; color:#fff;">${r.name}</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#38bdf8;">${r.email} • <span style="color:#94a3b8;">${r.dept}</span></div>
          </div>
          <button onclick="window.alerts.removeEmail(${idx})" style="background:none;border:none;color:#ef4444;font-size:14px;cursor:pointer;">&times;</button>`;
        emailList.appendChild(item);
      });
    }
  }

  removeSms(idx) { this.smsRecipients.splice(idx, 1); this.renderRecipients(); }
  removeEmail(idx) { this.emailRecipients.splice(idx, 1); this.renderRecipients(); }

  async dispatchEmergencyAlert() {
    const sendBtn = document.getElementById("btn-dispatch-alerts");
    if (!this.activeSite) { this.showToast("No site selected."); return; }
    const s = this.activeSite;
    const prob = (s.probability * 100).toFixed(1);
    const corridor = s.title;
    const ndmiStr = s.ndmi != null ? s.ndmi.toFixed(2) : "—";

    if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = `<span>⏳</span> Sending Emergency Alert...`; }

    try {
      if (window.app && window.app.soundEnabled && window.advisories) {
        window.advisories.playEmergencyAlertChime();
      }

      const smsText = CONFIG.ALERTS.SMS_TEMPLATE
        .replace("{prob}", prob).replace("{site}", s.siteId).replace("{region}", s.region)
        .replace("{ndmi}", ndmiStr).replace("{corridor}", corridor);

      const phoneNumbers = this.smsRecipients.map(r => r.phone).filter(Boolean);
      const cleanNums = this._cleanPhoneNumbers(phoneNumbers);
      if (cleanNums.length === 0) throw new Error("No valid SMS recipients configured.");

      const smsResponse = await fetch("/alerts/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: cleanNums, message: smsText, area: s.region, location: corridor, weather: "" })
      });

      let smsData = {};
      try { smsData = await smsResponse.json(); } catch (e) { smsData = {}; }
      if (!smsResponse.ok) throw new Error(smsData.detail || smsData.message || `HTTP ${smsResponse.status}`);
      if (!smsData.success) throw new Error(smsData.message || "Fast2SMS rejected the SMS request.");

      const requestId = smsData.request_id || "OK";
      const timestamp = new Date().toLocaleTimeString();
      const newLog = {
        id: "DISP-" + Math.floor(1000 + Math.random() * 9000),
        time: timestamp,
        target: `${s.title} (${s.region})`,
        site: s.siteId,
        prob: `${prob}%`,
        smsCount: smsData.recipients_count || cleanNums.length,
        emailCount: this.emailRecipients.length,
        status: `SENT VIA FAST2SMS (${requestId})`
      };
      this.dispatchLogs.unshift(newLog);
      this._saveLogs();
      this.renderLogs();

      if (sendBtn) {
        sendBtn.innerHTML = `<span>✓</span> Real SMS Sent via Fast2SMS!`;
        setTimeout(() => { sendBtn.innerHTML = `<span>🚨</span> Dispatch Emergency SMS & Email Alert`; }, 3500);
      }
      this.showToast(`✓ Fast2SMS accepted the alert for ${cleanNums.length} number(s). Request ID: ${requestId}`);
    } catch (err) {
      console.error("BhuRakshak SMS dispatch error:", err);
      const timestamp = new Date().toLocaleTimeString();
      const newLog = {
        id: "DISP-" + Math.floor(1000 + Math.random() * 9000),
        time: timestamp,
        target: `${s.title} (${s.region})`,
        site: s.siteId,
        prob: `${prob}%`,
        smsCount: 0,
        emailCount: this.emailRecipients.length,
        status: `SMS FAILED: ${err.message}`
      };
      this.dispatchLogs.unshift(newLog);
      this._saveLogs();
      this.renderLogs();
      if (sendBtn) {
        sendBtn.innerHTML = `<span>✕</span> SMS Failed`;
        setTimeout(() => { sendBtn.innerHTML = `<span>🚨</span> Dispatch Emergency SMS & Email Alert`; }, 3500);
      }
      this.showToast(`❌ SMS failed: ${err.message}`);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  renderLogs() {
    const container = document.getElementById("alert-logs-container");
    if (!container) return;
    if (this.dispatchLogs.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:#64748b;font-size:12px;">No alerts dispatched in this session yet.</div>`;
      return;
    }
    container.innerHTML = "";
    this.dispatchLogs.forEach(log => {
      const row = document.createElement("div");
      row.className = "alert-log-row";
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#38bdf8;font-size:12px;">${log.id} • ${log.time}</span>
          <span class="badge-risk badge-high" style="font-size:10px;">${log.status}</span>
        </div>
        <div style="font-size:12px;color:#f8fafc;margin-bottom:4px;">${log.target}</div>
        <div style="font-size:11px;color:#94a3b8;display:flex;gap:12px;">
          <span>📱 ${log.smsCount} SMS sent</span>
          <span>📧 ${log.emailCount} Emails sent</span>
          <span style="color:#ef4444;font-weight:600;">Prob: ${log.prob}</span>
        </div>`;
      container.appendChild(row);
    });
  }

  showToast(msg) {
    let toast = document.getElementById("alert-toast-banner");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "alert-toast-banner";
      toast.className = "alert-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 5000);
  }

  _cleanPhoneNumbers(numbers) {
    return numbers.map(n => {
      let digits = String(n).replace(/\D/g, "");
      if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
      if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
      return digits;
    }).filter(d => d.length === 10 && /^[6-9]\d{9}$/.test(d));
  }

  _loadLogs() {
    try {
      const s = localStorage.getItem("bhurakshak_alert_logs");
      if (s) return JSON.parse(s);
    } catch (e) { console.warn("Could not load alert logs:", e); }
    return []; // no more fabricated "DISP-4821 DELIVERED" seed history
  }

  _saveLogs() {
    try { localStorage.setItem("bhurakshak_alert_logs", JSON.stringify(this.dispatchLogs.slice(0, 30))); }
    catch (e) { console.warn("Could not save alert logs:", e); }
  }
}

window.alerts = new AlertSystem();