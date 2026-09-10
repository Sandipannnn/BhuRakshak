/**
 * BhuRakshak Application Controller
 * Bootstraps tabs, omni-search, sound controls, health polling, and module orchestration.
 */

class BhuRakshakApp {
  constructor() {
    this.currentTab = "map";
    this.soundEnabled = true;
    this.theme = localStorage.getItem("bhurakshak_theme") || "dark";
    this.healthTimer = null;
  }

  async init() {
    console.log("🌍 Initializing BhuRakshak // भू-रक्षक Intelligence Console...");

    // Apply saved Theme (Dark / Light)
    this.applyTheme(this.theme);

    // Bind Navigation Tabs
    this.bindNavigation();

    // Bind Omni-search bar
    this.bindOmniSearch();

    // Bind Sound & Theme Toggles
    this.bindSoundToggle();
    this.bindThemeToggle();

    // Initialize Submodules
    if (window.bhuMap) window.bhuMap.init();
    if (window.inspector) window.inspector.init();
    if (window.demoShowcase) window.demoShowcase.init();
    if (window.reportsPortal) window.reportsPortal.init();
    if (window.advisories) window.advisories.init();
    if (window.alerts) window.alerts.init();

    // Health Poll
    await this.pollHealth();
    this.healthTimer = setInterval(() => this.pollHealth(), CONFIG.HEALTH_CHECK_INTERVAL);

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "1") this.switchTab("map");
      if (e.key === "2") this.switchTab("inspector");
      if (e.key === "3") this.switchTab("telemetry");
      if (e.key === "4") this.switchTab("monsoon");
      if (e.key === "5") this.switchTab("inventory");
      if (e.key === "6") this.switchTab("architecture");
      if (e.key === "7") this.switchTab("alerts");
    });

    console.log("✓ BhuRakshak Online & Ready.");
  }

  bindNavigation() {
    document.querySelectorAll(".nav-tab-item").forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        if (target) this.switchTab(target);
      });
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;

    document.querySelectorAll(".nav-tab-item").forEach(tab => {
      if (tab.getAttribute("data-tab") === tabId) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    document.querySelectorAll(".tab-pane").forEach(pane => {
      pane.classList.remove("active");
    });

    const activePane = document.getElementById(`tab-${tabId}`);
    if (activePane) {
      activePane.classList.add("active");
    }

    if (tabId === "map" && window.bhuMap && window.bhuMap.map) {
      setTimeout(() => {
        window.bhuMap.map.invalidateSize();
      }, 100);
    }
  }

  bindOmniSearch() {
    const input = document.getElementById("header-search-input");
    if (!input) return;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = input.value.trim().toLowerCase();
        if (!q) return;

        // Check highway corridors
        const corridor = CONFIG.HIGHWAY_CORRIDORS.find(c => 
          c.name.toLowerCase().includes(q) || c.shortName.toLowerCase().includes(q)
        );
        if (corridor) {
          this.switchTab("map");
          if (window.bhuMap) window.bhuMap.flyTo(corridor.center[0], corridor.center[1], corridor.zoom);
          return;
        }

        // Check regions
        const region = CONFIG.REGIONS.find(r => 
          r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
        );
        if (region && region.center) {
          this.switchTab("map");
          if (window.bhuMap) window.bhuMap.flyTo(region.center[0], region.center[1], region.zoom);
          return;
        }

        // Check coordinates e.g. "27.3, 88.6"
        const parts = q.split(/[, ]+/);
        if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
          this.switchTab("map");
          if (window.bhuMap) window.bhuMap.flyTo(parseFloat(parts[0]), parseFloat(parts[1]), 11);
          return;
        }

        // Check demo scenarios
        const sc = CONFIG.DEMO_SCENARIOS.find(s => 
          s.title.toLowerCase().includes(q) || s.siteId.toLowerCase().includes(q)
        );
        if (sc) {
          this.switchTab("map");
          if (window.bhuMap) window.bhuMap.flyTo(sc.lat, sc.lon, 11);
          return;
        }

        alert(`No direct match found for "${q}". Search by corridor (e.g. "NH-10"), state (e.g. "Sikkim"), or lat/lon.`);
      }
    });
  }

  bindSoundToggle() {
    const btn = document.getElementById("sound-toggle-btn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      this.soundEnabled = !this.soundEnabled;
      btn.innerHTML = this.soundEnabled ? `<span>🔔</span> Sound: ON` : `<span>🔕</span> Sound: OFF`;
      btn.style.color = this.soundEnabled ? "#fbbf24" : "#94a3b8";
    });
  }

  bindThemeToggle() {
    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      this.theme = this.theme === "dark" ? "light" : "dark";
      this.applyTheme(this.theme);
      localStorage.setItem("bhurakshak_theme", this.theme);
    });
  }

  applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const icon = document.getElementById("theme-icon");
    const label = document.getElementById("theme-label");

    if (theme === "light") {
      if (icon) icon.textContent = "🌙";
      if (label) label.textContent = "Dark Mode";
      // Switch map basemap to high-detail topo or OSM if on dark
      if (window.bhuMap && window.bhuMap.currentBasemap === "dark") {
        window.bhuMap.setBasemap("topo");
        const topoRadio = document.querySelector("input[name='map-basemap'][value='topo']");
        if (topoRadio) topoRadio.checked = true;
      }
    } else {
      if (icon) icon.textContent = "☀️";
      if (label) label.textContent = "Light Mode";
    }
  }


  async pollHealth() {
    const syncPill = document.getElementById("header-sync-pill");
    const health = await window.api.checkHealth();
    if (!syncPill) return;

    if (health.online) {
      syncPill.innerHTML = `<span class="green-dot"></span> Sentinel-1/2 GEE Sync`;
    } else {
      syncPill.innerHTML = `<span class="green-dot" style="background:#06b6d4; box-shadow:0 0 8px #06b6d4;"></span> Sentinel-1/2 Local Engine`;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.app = new BhuRakshakApp();
  window.app.init();
});
