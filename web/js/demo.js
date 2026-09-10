/**
 * BhuRakshak Interactive Demo Showcase
 * Curated scenarios for hackathon presentations, animated ML pipeline flow.
 */

class DemoShowcase {
  constructor() {
    this.activeScenario = null;
  }

  init() {
    this.renderScenarioCards();
    this.bindPipelineAnimation();
  }

  renderScenarioCards() {
    const container = document.getElementById("scenarios-container");
    if (!container) return;

    container.innerHTML = "";
    CONFIG.DEMO_SCENARIOS.forEach((scenario, index) => {
      const card = document.createElement("div");
      card.className = `scenario-card ${index === 0 ? 'active' : ''}`;
      card.id = `scenario-card-${scenario.id}`;

      const riskConfig = CONFIG.RISK_LEVELS[scenario.risk.toUpperCase()] || CONFIG.RISK_LEVELS.LOW;

      card.innerHTML = `
        <div class="scenario-header">
          <span class="scenario-state">${scenario.region}</span>
          <span class="badge-risk ${riskConfig.badgeClass}">${scenario.risk} Risk</span>
        </div>
        <div class="scenario-title">${scenario.title}</div>
        <div class="scenario-desc">${scenario.summary}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.06); padding-top:12px; margin-top:8px;">
          <div style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#94a3b8;">
            Prob: <strong style="color:${riskConfig.color};">${(scenario.probability * 100).toFixed(1)}%</strong>
          </div>
          <button class="btn-primary" style="padding:5px 10px; font-size:11px;" onclick="window.demoShowcase.activateScenario('${scenario.id}')">
            Launch Scenario &rarr;
          </button>
        </div>
      `;

      container.appendChild(card);
    });
  }

  activateScenario(scenarioId) {
    const scenario = CONFIG.DEMO_SCENARIOS.find(s => s.id === scenarioId);
    if (!scenario) return;

    this.activeScenario = scenario;

    // Highlight card
    document.querySelectorAll(".scenario-card").forEach(c => c.classList.remove("active"));
    const activeCard = document.getElementById(`scenario-card-${scenarioId}`);
    if (activeCard) activeCard.classList.add("active");

    // Animate pipeline flow
    this.triggerPipelineAnimation();

    // Fly map to scenario coordinates
    if (window.bhuMap) {
      window.bhuMap.flyTo(scenario.lat, scenario.lon, 10);
    }

    // Switch to Map or Inspector view if clicked from launch button
    const toast = document.getElementById("demo-action-toast");
    if (toast) {
      toast.textContent = `Activated: ${scenario.title} (${scenario.region}) — Telemetry Loaded`;
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 3500);
    }
  }

  triggerPipelineAnimation() {
    const steps = document.querySelectorAll(".pipeline-step");
    steps.forEach((step, idx) => {
      step.classList.remove("active");
      setTimeout(() => {
        step.classList.add("active");
      }, idx * 300);
    });
  }

  bindPipelineAnimation() {
    const runPipeBtn = document.getElementById("run-pipeline-btn");
    if (runPipeBtn) {
      runPipeBtn.addEventListener("click", () => {
        this.triggerPipelineAnimation();
      });
    }
  }
}

window.demoShowcase = new DemoShowcase();
