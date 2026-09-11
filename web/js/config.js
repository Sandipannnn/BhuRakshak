/**
 * BhuRakshak Configuration & Geo Data
 * System constants, API routing, thresholds, corridors, and SMS/Email alert templates.
 */

const CONFIG = {
  // API base URL: Points to local backend when developing, and Render in production
  API_BASE_URL: (function() {
    // Allow overriding backend URL via localStorage in the browser console:
    // localStorage.setItem("bhurakshak_backend_url", "https://your-backend.onrender.com")
    const customUrl = localStorage.getItem("bhurakshak_backend_url");
    if (customUrl) return customUrl.replace(/\/+$/, "");

    // If served directly by FastAPI on port 8000
    if (window.location.port === "8000") return "";

    // If running on localhost / 127.0.0.1 (e.g. Vite or VS Code Live Server)
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://127.0.0.1:8000";
    }

    // Production URL: Replace with your deployed Render service URL
    return "https://bhurakshak.onrender.com";
  })(),

  HEALTH_CHECK_INTERVAL: 15000,

  // Map settings
  MAP: {
    DEFAULT_CENTER: [26.4006, 92.5376],
    DEFAULT_ZOOM: 7,
    MIN_ZOOM: 5,
    MAX_ZOOM: 18,
    BOUNDS: [
      [21.5, 87.5],
      [29.8, 97.5]
    ]
  },

  // Susceptibility Risk thresholds
  RISK_LEVELS: {
    LOW: {
      name: "Low",
      min: 0.0,
      max: 0.3299,
      color: "#10b981",
      glow: "rgba(16, 185, 129, 0.4)",
      badgeClass: "badge-low",
      label: "Low Susceptibility",
      description: "Stable terrain under current moisture conditions. Normal surveillance."
    },
    MEDIUM: {
      name: "Medium",
      min: 0.33,
      max: 0.6699,
      color: "#f59e0b",
      glow: "rgba(245, 158, 11, 0.4)",
      badgeClass: "badge-medium",
      label: "Medium Watch",
      description: "Moderate slope instability & rising saturation. Heightened advisory."
    },
    HIGH: {
      name: "High",
      min: 0.67,
      max: 1.0,
      color: "#ef4444",
      glow: "rgba(239, 68, 68, 0.6)",
      badgeClass: "badge-high",
      label: "High Critical",
      description: "Critical shear stress & heavy saturation. High landslide danger!"
    }
  },

  // Northeast India States
  REGIONS: [
    { id: "all", name: "All Northeast States", code: "NER" },
    { id: "arunachal_pradesh", name: "Arunachal Pradesh", code: "AR", center: [28.2180, 94.7278], zoom: 7 },
    { id: "assam", name: "Assam", code: "AS", center: [26.2006, 92.9376], zoom: 7 },
    { id: "manipur", name: "Manipur", code: "MN", center: [24.6637, 93.9063], zoom: 8 },
    { id: "meghalaya", name: "Meghalaya", code: "ML", center: [25.4670, 91.3662], zoom: 8 },
    { id: "mizoram", name: "Mizoram", code: "MZ", center: [23.1645, 92.9376], zoom: 8 },
    { id: "nagaland", name: "Nagaland", code: "NL", center: [26.1584, 94.5624], zoom: 8 },
    { id: "sikkim", name: "Sikkim", code: "SK", center: [27.5330, 88.5122], zoom: 9 },
    { id: "west_bengal", name: "West Bengal (Hills)", code: "WB", center: [27.0410, 88.2663], zoom: 9 }
  ],

  // Triggers
  TRIGGERS: [
    { id: "all", name: "All Triggers" },
    { id: "rain", name: "Continuous Monsoon Rain" },
    { id: "cloudburst", name: "Heavy Cloudburst" },
    { id: "road_cut", name: "Road Cut / Slope Toe Excavation" },
    { id: "pore_pressure", name: "High Pore Water Saturation" },
    { id: "unknown", name: "Unknown / Historical" }
  ],

  // Critical Highway Corridors in Northeast India
  HIGHWAY_CORRIDORS: [
    {
      id: "nh10_teesta",
      name: "NH-10 Teesta Corridor",
      shortName: "NH-10 Teesta",
      state: "Sikkim / West Bengal",
      summary: "Lifeline link connecting Siliguri to Gangtok along vulnerable Teesta river gorge.",
      center: [27.1800, 88.4500],
      zoom: 10,
      color: "#ef4444",
      path: [
        [26.7271, 88.4312], // Siliguri
        [26.8920, 88.4715], // Sevoke Coronation Bridge
        [27.0125, 88.4890], // Kalijhora
        [27.0620, 88.4410], // Teesta Bazar
        [27.1240, 88.5020], // Melli
        [27.1780, 88.5280], // Rangpo
        [27.2340, 88.5520], // Singtam
        [27.2950, 88.5910], // Ranipool
        [27.3389, 88.6065]  // Gangtok
      ]
    },
    {
      id: "nh29_kohima",
      name: "NH-29 Kohima Corridor",
      shortName: "NH-29 Kohima",
      state: "Nagaland",
      summary: "Strategic link between Dimapur and Kohima prone to shale subsidence & debris creep.",
      center: [25.7500, 93.9500],
      zoom: 10,
      color: "#f59e0b",
      path: [
        [25.9060, 93.7270], // Dimapur
        [25.8450, 93.7820], // Chumukedima
        [25.7920, 93.8550], // Pagla Pahar
        [25.7550, 93.9210], // Medziphema
        [25.7120, 94.0150], // Zubza
        [25.6751, 94.1086]  // Kohima
      ]
    },
    {
      id: "subansiri_pass",
      name: "Subansiri Pass / NH-13",
      shortName: "Subansiri Pass",
      state: "Arunachal Pradesh",
      summary: "Trans-Arunachal highway segment traversing high-slope metamorphic terrain.",
      center: [27.4500, 93.9000],
      zoom: 9,
      color: "#ef4444",
      path: [
        [27.2350, 94.1120], // North Lakhimpur
        [27.3210, 93.9850], // Kimin
        [27.5380, 93.8420], // Ziro Valley
        [27.6520, 93.9650], // Tamen
        [27.9850, 94.2210]  // Daporijo
      ]
    }
  ],

  // Demo scenarios
  DEMO_SCENARIOS: [
    {
      id: "scenario-sikkim-highway",
      title: "NH-10 Teesta Corridor Blockade",
      siteId: "sikkim_0812",
      region: "Sikkim",
      lat: 27.3389,
      lon: 88.6065,
      risk: "High",
      probability: 0.912,
      trigger: "Continuous Monsoon Rain",
      summary: "Critical lifeline highway between Siliguri and Gangtok. Active debris chute activated following 72-hour continuous mountain rains; rapid soil moisture surge.",
      ndvi: 0.38,
      ndmi: 0.71,
      sar_vv: -9.8,
      sar_vh: -16.4,
      staleness: 1
    },
    {
      id: "scenario-nagaland-kohima",
      title: "Kohima-Dimapur Ridge Creep",
      siteId: "nagaland_3293",
      region: "Nagaland",
      lat: 25.6751,
      lon: 94.1086,
      risk: "High",
      probability: 0.745,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "Incoherent shale bedding undergoing slow gravitational mass movement along NH-29, threatening transport infrastructure.",
      ndvi: 0.52,
      ndmi: 0.56,
      sar_vv: -12.4,
      sar_vh: -18.9,
      staleness: 3
    },
    {
      id: "scenario-arunachal-monsoon",
      title: "Subansiri Cloudburst & Slope Failure",
      siteId: "arunachal_pradesh_2652",
      region: "Arunachal Pradesh",
      lat: 27.5838,
      lon: 91.8769,
      risk: "High",
      probability: 0.842,
      trigger: "Heavy Cloudburst",
      summary: "Intense monsoonal downpour over fractured gneiss slope near Tawang-Subansiri road corridor. Sentinel-1 SAR exhibits anomalous decibel loss (-10.5 dB) and NDMI saturation reaches 0.64.",
      ndvi: 0.43,
      ndmi: 0.64,
      sar_vv: -10.5,
      sar_vh: -17.2,
      staleness: 2
    },
    {
      id: "scenario-meghalaya-quarry",
      title: "Cherrapunji Escarpment Saturation",
      siteId: "meghalaya_5921",
      region: "Meghalaya",
      lat: 25.5788,
      lon: 91.8933,
      risk: "High",
      probability: 0.865,
      trigger: "Continuous Monsoon Rain",
      summary: "High-gradient limestone/sandstone plateaus subject to world-record rainfall runoff. High shear strain detected along river gorge slopes.",
      ndvi: 0.47,
      ndmi: 0.68,
      sar_vv: -11.2,
      sar_vh: -18.1,
      staleness: 2
    },
    {
      id: "scenario-mizoram-aizawl",
      title: "Aizawl Urban Flank Stabilization Watch",
      siteId: "mizoram_8029",
      region: "Mizoram",
      lat: 23.3644,
      lon: 92.8622,
      risk: "Medium",
      probability: 0.521,
      trigger: "High Pore Water Saturation",
      summary: "Steep anticlinal ridge flanks with moderate vegetative buffer. Monitored for pore-pressure spikes during late monsoon bursts.",
      ndvi: 0.61,
      ndmi: 0.38,
      sar_vv: -13.5,
      sar_vh: -19.8,
      staleness: 2
    },
    {
      id: "scenario-assam-alluvium",
      title: "Brahmaputra Valley Lowland Foothill",
      siteId: "assam_5723",
      region: "Assam",
      lat: 26.1445,
      lon: 91.7362,
      risk: "Low",
      probability: 0.165,
      trigger: "Unknown / Historical",
      summary: "Gentle topographic gradient (< 4 degrees) on stable terrace alluvium. Low susceptibility with robust canopy cover.",
      ndvi: 0.74,
      ndmi: 0.18,
      sar_vv: -15.8,
      sar_vh: -22.3,
      staleness: 1
    }
  ],

  // State‑wise Monsoon Threat Summary
  MONSOON_THREAT: [
    { state: "Arunachal Pradesh", rainIndex: 160, porePressure: 92, roadReadiness: "Pending" },
    { state: "Assam", rainIndex: 140, porePressure: 78, roadReadiness: "Ready" },
    { state: "Manipur", rainIndex: 130, porePressure: 70, roadReadiness: "Ready" },
    { state: "Meghalaya", rainIndex: 150, porePressure: 85, roadReadiness: "Pending" },
    { state: "Mizoram", rainIndex: 120, porePressure: 65, roadReadiness: "Ready" },
    { state: "Nagaland", rainIndex: 155, porePressure: 88, roadReadiness: "Pending" },
    { state: "Sikkim", rainIndex: 145, porePressure: 80, roadReadiness: "Ready" },
    { state: "West Bengal (Hills)", rainIndex: 135, porePressure: 72, roadReadiness: "Ready" }
  ],


  // SMS & Email Alert Configuration & Templates
  ALERTS: {
    DEFAULT_SMS_RECIPIENTS: [
      { name: "District Magistrate Control Room", phone: "+91 98765 43210", role: "DDMA Admin" },
      { name: "Border Roads Organisation (BRO) HQ", phone: "+91 94350 11223", role: "Highway Ops" },
      { name: "State Disaster Response Force (SDRF)", phone: "+91 98620 99887", role: "Emergency Response" },
      { name: "Executive Engineer, PWD Hills", phone: "+91 97740 55443", role: "Infrastructure" }
    ],
    DEFAULT_EMAIL_RECIPIENTS: [
      { name: "State Emergency Operation Centre (SEOC)", email: "seoc.disaster@gov.in", dept: "Revenue & Disaster Mgmt" },
      { name: "Geological Survey of India (GSI NER)", email: "landslide.ner@gsi.gov.in", dept: "Geohazards Division" },
      { name: "National Disaster Management Authority", email: "alert-monitor@ndma.gov.in", dept: "Central Early Warning" },
      { name: "Chief Engineer, PWD Highway Border Roads", email: "pwd.hills.highway@assam.gov.in", dept: "Public Works" }
    ],
    SMS_TEMPLATE: "🚨 BHURAKSHAK ALERT: High Landslide Susceptibility ({prob}%) detected at {site} ({region}). High moisture saturation ({ndmi}) & SAR shear detected. Avoid transit on {corridor}. DDMA/BRO mobilized. Info: bhurakshak.ner.gov.in",
    EMAIL_SUBJECT: "⚠️ CRITICAL HAZARD ADVISORY: Landslide Susceptibility Spike in {region} [{site}]",
    EMAIL_TEMPLATE_HTML: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; background: #0f172a; color: #f8fafc; padding: 24px; border-radius: 10px; border: 1px solid #38bdf8;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #ef4444; padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="color: #ef4444; margin: 0;">🚨 BHURAKSHAK EARLY WARNING ADVISORY</h2>
          <span style="background: rgba(239,68,68,0.2); color:#ef4444; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">CRITICAL</span>
        </div>
        <p style="font-size: 14px; line-height: 1.5;">This is an automated alert generated by the <strong>BhuRakshak AI Susceptibility Engine</strong> based on 30-day temporal Sentinel-1 SAR & Sentinel-2 optical Earth observation sequences.</p>
        <div style="background: rgba(255,255,255,0.05); padding: 14px; border-radius: 6px; margin: 16px 0;">
          <table style="width: 100%; font-size: 13px; color: #cbd5e1;">
            <tr><td><strong>Target Corridor:</strong></td><td style="color:#38bdf8;">{corridor} ({region})</td></tr>
            <tr><td><strong>Site Reference:</strong></td><td>{site}</td></tr>
            <tr><td><strong>Coordinates:</strong></td><td>{coords}</td></tr>
            <tr><td><strong>Susceptibility Index:</strong></td><td style="color:#ef4444; font-weight:bold; font-size:15px;">{prob}% (HIGH RISK)</td></tr>
            <tr><td><strong>Soil Moisture Index (NDMI):</strong></td><td>{ndmi} (High Saturation)</td></tr>
            <tr><td><strong>Sentinel-1 SAR VV Backscatter:</strong></td><td>{sar_vv} dB</td></tr>
          </table>
        </div>
        <div style="background: rgba(239,68,68,0.1); border-left: 4px solid #ef4444; padding: 10px; font-size: 13px; color: #fca5a5; margin-bottom: 16px;">
          <strong>ACTION MANDATE:</strong> Restrict heavy transit across slope toe corridors. Position clearing equipment at staging points. Alert downstream habitations.
        </div>
        <div style="font-size: 11px; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
          Smart India Hackathon 2026 • SIH26001 • BhuRakshak Disaster Intelligence System
        </div>
      </div>
    `
  }
};

window.CONFIG = CONFIG;
