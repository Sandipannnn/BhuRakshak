/**
 * BhuRakshak Multilingual Early Warning Advisory Dispatcher
 * Emergency broadcast synthesizer in English, Assamese, Bengali, and Hindi.
 * Web Audio emergency siren generator & response protocol checklists.
 */

class AdvisoryDispatcher {
  constructor() {
    this.audioCtx = null;
  }

  init() {
    this.populateRegionSelector();
    this.bindEvents();
    this.updateAdvisories();
  }

  populateRegionSelector() {
    const sel = document.getElementById("advisory-site-select");
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
    const sel = document.getElementById("advisory-site-select");
    if (sel) {
      sel.addEventListener("change", () => {
        this.updateAdvisories();
      });
    }

    const soundBtn = document.getElementById("btn-sound-alarm");
    if (soundBtn) {
      soundBtn.addEventListener("click", () => {
        this.playEmergencyAlertChime();
      });
    }

    const broadcastBtn = document.getElementById("btn-dispatch-broadcast");
    if (broadcastBtn) {
      broadcastBtn.addEventListener("click", () => {
        this.dispatchBroadcast();
      });
    }
  }

  updateAdvisories() {
    const sel = document.getElementById("advisory-site-select");
    const siteId = sel ? sel.value : CONFIG.DEMO_SCENARIOS[0].siteId;
    const scenario = CONFIG.DEMO_SCENARIOS.find(s => s.siteId === siteId) || CONFIG.DEMO_SCENARIOS[0];

    const container = document.getElementById("advisory-languages-container");
    if (!container) return;

    container.innerHTML = "";

    Object.entries(CONFIG.ALERT_TEMPLATES).forEach(([code, tpl]) => {
      const card = document.createElement("div");
      card.className = "lang-card";

      const bodyText = tpl.body
        .replace("{region}", scenario.region)
        .replace("{siteId}", scenario.siteId);

      card.innerHTML = `
        <div>
          <div class="lang-header">
            <span class="lang-badge">${tpl.lang}</span>
            <span style="font-size:11px; font-weight:600; color:#ef4444;">PRIORITY 1 BROADCAST</span>
          </div>
          <div class="alert-box">
            <div style="font-weight:700; color:#f8fafc; font-size:13px; margin-bottom:6px;">${tpl.title}</div>
            <p style="color:#cbd5e1; font-size:12px; margin-bottom:8px;">${bodyText}</p>
            <div style="font-size:11px; color:#f59e0b; font-weight:600;">
              🚨 <strong>Protocol:</strong> ${tpl.action}
            </div>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.06); padding-top:10px;">
          <span style="font-size:11px; color:#64748b;">Ready for CAP-CP SMS Gateway</span>
          <button onclick="window.advisories.copyText(this, \`${bodyText}\`)" 
                  style="background:rgba(255,255,255,0.06); border:1px solid var(--border-subtle); color:#fff; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">
            Copy Alert Text
          </button>
        </div>
      `;

      container.appendChild(card);
    });

    // Update meta summary
    const siteTitle = document.getElementById("advisory-target-title");
    const siteCoords = document.getElementById("advisory-target-coords");
    if (siteTitle) siteTitle.textContent = `${scenario.title} (${scenario.region})`;
    if (siteCoords) siteCoords.textContent = `${scenario.lat.toFixed(4)}°N, ${scenario.lon.toFixed(4)}°E | Susceptibility Index: ${(scenario.probability * 100).toFixed(1)}%`;
  }

  dispatchBroadcast() {
    const btn = document.getElementById("btn-dispatch-broadcast");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Transmitting to State DDMA & Police Control...";
      this.playEmergencyAlertChime();
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "✓ Broadcast Dispatched to 4 Language Channels";
        setTimeout(() => {
          btn.textContent = "Broadcast Emergency Advisory";
        }, 3000);
      }, 1500);
    }
  }

  playEmergencyAlertChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      // Two-tone warning siren (880Hz & 659Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(659, now + 0.15);
      osc.frequency.setValueAtTime(880, now + 0.3);
      osc.frequency.setValueAtTime(659, now + 0.45);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.7);
    } catch (e) {
      console.warn("Audio chime error:", e);
    }
  }

  copyText(buttonEl, text) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = buttonEl.textContent;
      buttonEl.textContent = "✓ Copied";
      setTimeout(() => { buttonEl.textContent = orig; }, 2000);
    });
  }
}

window.advisories = new AdvisoryDispatcher();
