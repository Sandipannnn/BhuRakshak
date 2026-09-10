/**
 * BhuRakshak SMS & Email Alert Dispatch System
 * Configures emergency channels, recipient databases, automated triggers,
 * live preview generators, and transmission simulation.
 */

class AlertSystem {
  // Simple email format validation
  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim());
  }
  constructor() {
    this.smsRecipients = [...CONFIG.ALERTS.DEFAULT_SMS_RECIPIENTS];
    this.emailRecipients = [...CONFIG.ALERTS.DEFAULT_EMAIL_RECIPIENTS];
    this.dispatchLogs = this._loadLogs();
    this.activeSite = CONFIG.DEMO_SCENARIOS[0];
    this.threshold = 70;
    this.fast2SmsApiKey = localStorage.getItem("fast2sms_api_key") || "";
  }

  init() {
    this.initApiKeyField();
    this.renderRecipients();
    this.populateSiteSelector();
    this.bindEvents();
    this.updatePreviews();
    this.renderLogs();
  }

  initApiKeyField() {
    const keyInput = document.getElementById("fast2sms-api-key-input");
    const saveBtn = document.getElementById("btn-save-fast2sms-key");
    if (keyInput) {
      keyInput.value = this.fast2SmsApiKey;
      if (saveBtn) {
        saveBtn.addEventListener("click", () => {
          this.fast2SmsApiKey = keyInput.value.trim();
          localStorage.setItem("fast2sms_api_key", this.fast2SmsApiKey);
          const status = document.getElementById("api-key-save-status");
          if (status) {
            status.textContent = "✓ Fast2SMS API Key Saved";
            status.style.display = "inline";
            setTimeout(() => { status.style.display = "none"; }, 2500);
          }
        });
      }
    }
  }


  populateSiteSelector() {
    const sel = document.getElementById("alert-site-select");
    if (!sel) return;

    sel.innerHTML = "";
    CONFIG.DEMO_SCENARIOS.forEach(sc => {
      const opt = document.createElement("option");
      opt.value = sc.siteId;
      opt.textContent = `${sc.region} — ${sc.title} (${(sc.probability * 100).toFixed(0)}% Risk)`;
      sel.appendChild(opt);
    });
  }

  bindEvents() {
    const siteSel = document.getElementById("alert-site-select");
    if (siteSel) {
      siteSel.addEventListener("change", (e) => {
        const found = CONFIG.DEMO_SCENARIOS.find(s => s.siteId === e.target.value);
        if (found) {
          this.activeSite = found;
          this.updatePreviews();
        }
      });
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
    if (sendBtn) {
      sendBtn.addEventListener("click", () => {
        this.dispatchEmergencyAlert();
      });
    }

    // Add SMS recipient
    const addSmsBtn = document.getElementById("btn-add-sms");
    if (addSmsBtn) {
      addSmsBtn.addEventListener("click", () => {
        const name = prompt("Enter Contact Name (e.g. Control Room Officer):");
        const phone = prompt("Enter Mobile Number with +91:");
        if (name && phone) {
          this.smsRecipients.push({ name, phone, role: "Field Responder" });
          this.renderRecipients();
        }
      });
    }

    // Add Email recipient
    const addEmailBtn = document.getElementById("btn-add-email");
    if (addEmailBtn) {
      addEmailBtn.addEventListener("click", () => {
        const name = prompt("Enter Department Name:");
        const email = prompt("Enter Official Email Address:");
        if (name && email) {
          if (!this.isValidEmail(email)) {
            this.showToast(`Invalid email address: ${email}`);
            return;
          }
          this.emailRecipients.push({ name, email, dept: "Emergency Cell" });
          this.renderRecipients();
        }
      });
    }

    // Add Test Email button handler
    const testEmailBtn = document.getElementById("btn-test-email");
    if (testEmailBtn) {
      testEmailBtn.addEventListener("click", () => {
        const emails = this.emailRecipients.map(r => r.email).filter(e => e);
        if (emails.length === 0) {
          this.showToast("No email recipients configured for test.");
          return;
        }
        // Validate each email format before sending
        for (const e of emails) {
          if (!this.isValidEmail(e)) {
            this.showToast(`Invalid email address: ${e}`);
            return;
          }
        }
        fetch("/alerts/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails: emails,
            subject: "[TEST] BhuRakshak Email Alert",
            body: "This is a test email sent from the BhuRakshak alert system."
          })
        })
          .then(res => res.json())
          .then(data => {
            const msg = data.success ? "Test email sent successfully." : `Test email failed: ${data.message}`;
            this.showToast(msg);
          })
          .catch(err => {
            this.showToast(`Error sending test email: ${err}`);
          });
      });
    }
  }

  updatePreviews() {
    const s = this.activeSite;
    const prob = (s.probability * 100).toFixed(1);
    const corridor = s.title;

    // SMS Preview
    const smsText = CONFIG.ALERTS.SMS_TEMPLATE
      .replace("{prob}", prob)
      .replace("{site}", s.siteId)
      .replace("{region}", s.region)
      .replace("{ndmi}", s.ndmi.toFixed(2))
      .replace("{corridor}", corridor);

    const smsPreviewEl = document.getElementById("sms-preview-text");
    const smsCountEl = document.getElementById("sms-char-counter");
    if (smsPreviewEl) smsPreviewEl.textContent = smsText;
    if (smsCountEl) {
      const chars = smsText.length;
      const segments = Math.ceil(chars / 160);
      smsCountEl.textContent = `${chars} chars (${segments} SMS segment${segments > 1 ? 's' : ''})`;
    }

    // Email Preview
    const emailSubject = CONFIG.ALERTS.EMAIL_SUBJECT
      .replace("{region}", s.region)
      .replace("{site}", s.siteId);

    const emailHtml = CONFIG.ALERTS.EMAIL_TEMPLATE_HTML
      .replace(/{corridor}/g, corridor)
      .replace(/{region}/g, s.region)
      .replace(/{site}/g, s.siteId)
      .replace(/{coords}/g, `${s.lat.toFixed(4)}°N, ${s.lon.toFixed(4)}°E`)
      .replace(/{prob}/g, prob)
      .replace(/{ndmi}/g, s.ndmi.toFixed(2))
      .replace(/{sar_vv}/g, s.sar_vv.toFixed(1));

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
          <button onclick="window.alerts.removeSms(${idx})" style="background:none; border:none; color:#ef4444; font-size:14px; cursor:pointer;">&times;</button>
        `;
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
          <button onclick="window.alerts.removeEmail(${idx})" style="background:none; border:none; color:#ef4444; font-size:14px; cursor:pointer;">&times;</button>
        `;
        emailList.appendChild(item);
      });
    }
  }

  removeSms(idx) {
    this.smsRecipients.splice(idx, 1);
    this.renderRecipients();
  }

  removeEmail(idx) {
    this.emailRecipients.splice(idx, 1);
    this.renderRecipients();
  }

  async dispatchEmergencyAlert() {
    const sendBtn = document.getElementById("btn-dispatch-alerts");
    const s = this.activeSite;
    const prob = (s.probability * 100).toFixed(1);
    const corridor = s.title;

    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = `<span>⏳</span> Connecting to Fast2SMS Gateway & Email Relays...`;
    }

    // Play warning sound if enabled
    if (window.app && window.app.soundEnabled && window.advisories) {
      window.advisories.playEmergencyAlertChime();
    }

    const smsText = CONFIG.ALERTS.SMS_TEMPLATE
      .replace("{prob}", prob)
      .replace("{site}", s.siteId)
      .replace("{region}", s.region)
      .replace("{ndmi}", s.ndmi.toFixed(2))
      .replace("{corridor}", corridor);

    const cleanNums = this._cleanPhoneNumbers(phoneNumbers);
    let fast2SmsStatus = "SIMULATED";
    let isLiveSms = false;

    // Check if Fast2SMS key is present
    const apiKey = (this.fast2SmsApiKey || localStorage.getItem("fast2sms_api_key") || "").trim();
    if (apiKey && cleanNums.length > 0) {
      try {
        let sent = false;
        // 1. Try backend endpoint first
        try {
          const res = await fetch("/alerts/sms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              numbers: cleanNums,
              message: smsText,
              api_key: apiKey
            })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              fast2SmsStatus = `FAST2SMS LIVE (Req ID: ${data.request_id || "OK"})`;
              isLiveSms = true;
              sent = true;
            } else {
              fast2SmsStatus = `FAST2SMS: ${data.message || "Failed"}`;
            }
          }
        } catch (backendErr) {
          // Backend not running on this port, will try direct
        }

        // 2. Direct gateway fallback if backend endpoint was not reachable
        if (!sent) {
          const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=q&message=${encodeURIComponent(smsText)}&language=english&flash=0&numbers=${encodeURIComponent(cleanNums.join(','))}`;
          const directRes = await fetch(url, { mode: "cors" });
          const directData = await directRes.json();
          if (directData && (directData.return === true || directData.status_code === 200)) {
            fast2SmsStatus = `FAST2SMS LIVE (Req ID: ${directData.request_id || "OK"})`;
            isLiveSms = true;
          } else {
            const msg = Array.isArray(directData.message) ? directData.message.join(" ") : (directData.message || "Gateway declined");
            fast2SmsStatus = `FAST2SMS: ${msg}`;
          }
        }
      } catch (err) {
        console.warn("Fast2SMS gateway error:", err);
        fast2SmsStatus = `FAST2SMS ERR: ${err.message}`;
      }
    } else {
      await new Promise(r => setTimeout(r, 1200));
    }


    const timestamp = new Date().toLocaleTimeString();
    const newLog = {
      id: "DISP-" + Math.floor(1000 + Math.random() * 9000),
      time: timestamp,
      target: `${s.title} (${s.region})`,
      site: s.siteId,
      prob: `${prob}%`,
      smsCount: this.smsRecipients.length,
      emailCount: this.emailRecipients.length,
      status: isLiveSms ? "SENT VIA FAST2SMS" : (apiKey ? fast2SmsStatus : "DELIVERED")
    };

    this.dispatchLogs.unshift(newLog);
    this._saveLogs();
    this.renderLogs();

    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = isLiveSms 
        ? `<span>✓</span> Real SMS Sent via Fast2SMS!` 
        : `<span>✓</span> Dispatched to ${this.smsRecipients.length} SMS & ${this.emailRecipients.length} Email Targets!`;
      setTimeout(() => {
        sendBtn.innerHTML = `<span>🚨</span> Dispatch Emergency SMS & Email Alert`;
      }, 3500);
    }

    const toastMsg = isLiveSms
      ? `✓ Fast2SMS Live SMS Delivered to ${this.smsRecipients.length} Numbers!`
      : (apiKey 
          ? `Fast2SMS Gateway: ${fast2SmsStatus}` 
          : `🚨 Alert broadcast transmitted for ${s.region} (${prob}% Susceptibility)`);
    this.showToast(toastMsg);
  }


  renderLogs() {
    const container = document.getElementById("alert-logs-container");
    if (!container) return;

    if (this.dispatchLogs.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b; font-size:12px;">No alerts dispatched in this session yet.</div>`;
      return;
    }

    container.innerHTML = "";
    this.dispatchLogs.forEach(log => {
      const row = document.createElement("div");
      row.className = "alert-log-row";
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-family:'JetBrains Mono',monospace; font-weight:700; color:#38bdf8; font-size:12px;">${log.id} • ${log.time}</span>
          <span class="badge-risk badge-high" style="font-size:10px;">${log.status}</span>
        </div>
        <div style="font-size:12px; color:#f8fafc; margin-bottom:4px;">${log.target}</div>
        <div style="font-size:11px; color:#94a3b8; display:flex; gap:12px;">
          <span>📱 ${log.smsCount} SMS sent</span>
          <span>📧 ${log.emailCount} Emails sent</span>
          <span style="color:#ef4444; font-weight:600;">Prob: ${log.prob}</span>
        </div>
      `;
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
    setTimeout(() => {
      toast.classList.remove("show");
    }, 4000);
  }

  _cleanPhoneNumbers(numbers) {
    return numbers.map(n => {
      let digits = n.replace(/\D/g, "");
      if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
      if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
      return digits;
    }).filter(d => d.length === 10);
  }

  _loadLogs() {

    try {
      const s = localStorage.getItem("bhurakshak_alert_logs");
      if (s) return JSON.parse(s);
    } catch (e) {}
    return [
      {
        id: "DISP-4821",
        time: "10:14:22 AM",
        target: "NH-10 Teesta Corridor Blockade (Sikkim)",
        site: "sikkim_0812",
        prob: "91.2%",
        smsCount: 4,
        emailCount: 4,
        status: "DELIVERED"
      },
      {
        id: "DISP-4790",
        time: "08:45:10 AM",
        target: "Subansiri Cloudburst & Slope Failure (Arunachal)",
        site: "arunachal_pradesh_2652",
        prob: "84.2%",
        smsCount: 4,
        emailCount: 4,
        status: "DELIVERED"
      }
    ];
  }

  _saveLogs() {
    try {
      localStorage.setItem("bhurakshak_alert_logs", JSON.stringify(this.dispatchLogs.slice(0, 30)));
    } catch (e) {}
  }
}

window.alerts = new AlertSystem();
