// Monsoon State‑wise Threat Summary Rendering
window.addEventListener('DOMContentLoaded', () => {
  renderMonsoonStateSummary();
});

function renderMonsoonStateSummary() {
  const tbody = document.getElementById('monsoon-state-summary-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!Array.isArray(CONFIG.MONSOON_THREAT)) return;
  CONFIG.MONSOON_THREAT.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:6px 10px;">${item.state}</td>
      <td style="padding:6px 10px;">${item.rainIndex}</td>
      <td style="padding:6px 10px;">${item.porePressure}</td>
      <td style="padding:6px 10px;">${item.roadReadiness}</td>
    `;
    tbody.appendChild(tr);
  });
}
