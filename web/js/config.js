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
    return "https://bhurakshak-ydpe.onrender.com";
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
    { id: "tripura", name: "Tripura", code: "TR", center: [23.8315, 91.2868], zoom: 8 },
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

  // Comprehensive Demo Scenarios & Verified Ground Truth Sites (58 Sites)
  DEMO_SCENARIOS: [
    {
      id: "scenario-arunachal-pradesh-2652",
      title: "Subansiri Cloudburst & Slope Failure",
      siteId: "arunachal pradesh_2652",
      region: "Arunachal Pradesh",
      lat: 27.5838,
      lon: 91.8769,
      risk: "High",
      probability: 0.842,
      trigger: "Heavy Cloudburst",
      summary: "High-resolution observation sector in Arunachal Pradesh. Heavy Cloudburst conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 84.2%.",
      ndvi: 0.4,
      ndmi: 0.57,
      sar_vv: -10.8,
      sar_vh: -17.7,
      staleness: 1
    },
    {
      id: "scenario-arunachal-pradesh-2821",
      title: "Itanagar Highway Toe Instability",
      siteId: "arunachal pradesh_2821",
      region: "Arunachal Pradesh",
      lat: 27.1416,
      lon: 93.6649,
      risk: "High",
      probability: 0.789,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Arunachal Pradesh. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 78.9%.",
      ndvi: 0.42,
      ndmi: 0.52,
      sar_vv: -11.3,
      sar_vh: -18.1,
      staleness: 1
    },
    {
      id: "scenario-arunachal-pradesh-5703",
      title: "Changlang Ridge Flank Surveillance",
      siteId: "arunachal pradesh_5703",
      region: "Arunachal Pradesh",
      lat: 26.9646,
      lon: 95.7982,
      risk: "Medium",
      probability: 0.542,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in Arunachal Pradesh. High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 54.2%.",
      ndvi: 0.5,
      ndmi: 0.31,
      sar_vv: -13.4,
      sar_vh: -19.9,
      staleness: 2
    },
    {
      id: "scenario-assam-5723",
      title: "Brahmaputra Valley Lowland Foothill",
      siteId: "assam_5723",
      region: "Assam",
      lat: 26.1445,
      lon: 91.7362,
      risk: "Low",
      probability: 0.165,
      trigger: "Unknown / Historical",
      summary: "High-resolution observation sector in Assam. Unknown / Historical conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 16.5%.",
      ndvi: 0.64,
      ndmi: -0.01,
      sar_vv: -16.6,
      sar_vh: -22.8,
      staleness: 2
    },
    {
      id: "scenario-assam-5776",
      title: "Karbi Anglong Foothill Drainage",
      siteId: "assam_5776",
      region: "Assam",
      lat: 25.9812,
      lon: 92.8714,
      risk: "Medium",
      probability: 0.395,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in Assam. High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 39.5%.",
      ndvi: 0.56,
      ndmi: 0.19,
      sar_vv: -14.6,
      sar_vh: -21.0,
      staleness: 2
    },
    {
      id: "scenario-assam-6969",
      title: "Jorhat Plain Alluvial Buffer",
      siteId: "assam_6969",
      region: "Assam",
      lat: 26.7509,
      lon: 94.2037,
      risk: "Low",
      probability: 0.142,
      trigger: "Unknown / Historical",
      summary: "High-resolution observation sector in Assam. Unknown / Historical conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 14.2%.",
      ndvi: 0.65,
      ndmi: -0.03,
      sar_vv: -16.8,
      sar_vh: -22.9,
      staleness: 2
    },
    {
      id: "scenario-manipur-3850",
      title: "Imphal-Silchar Highway Cutting",
      siteId: "manipur_3850",
      region: "Manipur",
      lat: 24.817,
      lon: 93.9368,
      risk: "High",
      probability: 0.778,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Manipur. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 77.8%.",
      ndvi: 0.42,
      ndmi: 0.51,
      sar_vv: -11.4,
      sar_vh: -18.2,
      staleness: 1
    },
    {
      id: "scenario-manipur-4010",
      title: "Ukhrul Ridge Slope Monitoring",
      siteId: "manipur_4010",
      region: "Manipur",
      lat: 25.0422,
      lon: 94.3611,
      risk: "Medium",
      probability: 0.432,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Manipur. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 43.2%.",
      ndvi: 0.54,
      ndmi: 0.22,
      sar_vv: -14.3,
      sar_vh: -20.8,
      staleness: 2
    },
    {
      id: "scenario-meghalaya-5921",
      title: "Cherrapunji Escarpment Saturation",
      siteId: "meghalaya_5921",
      region: "Meghalaya",
      lat: 25.5788,
      lon: 91.8933,
      risk: "High",
      probability: 0.865,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Meghalaya. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 86.5%.",
      ndvi: 0.39,
      ndmi: 0.59,
      sar_vv: -10.6,
      sar_vh: -17.5,
      staleness: 1
    },
    {
      id: "scenario-meghalaya-6273",
      title: "Mawsynram Valley Runoff Channel",
      siteId: "meghalaya_6273",
      region: "Meghalaya",
      lat: 25.3211,
      lon: 91.6433,
      risk: "Medium",
      probability: 0.498,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in Meghalaya. High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 49.8%.",
      ndvi: 0.52,
      ndmi: 0.27,
      sar_vv: -13.8,
      sar_vh: -20.3,
      staleness: 2
    },
    {
      id: "scenario-meghalaya-6428",
      title: "Nongstoin Plateau Stable Granite",
      siteId: "meghalaya_6428",
      region: "Meghalaya",
      lat: 25.467,
      lon: 91.3662,
      risk: "Low",
      probability: 0.215,
      trigger: "Unknown / Historical",
      summary: "High-resolution observation sector in Meghalaya. Unknown / Historical conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 21.5%.",
      ndvi: 0.62,
      ndmi: 0.03,
      sar_vv: -16.2,
      sar_vh: -22.4,
      staleness: 2
    },
    {
      id: "scenario-mizoram-7589",
      title: "Aizawl North Anticlinal Escarpment",
      siteId: "mizoram_7589",
      region: "Mizoram",
      lat: 23.7271,
      lon: 92.7176,
      risk: "High",
      probability: 0.814,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Mizoram. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 81.4%.",
      ndvi: 0.41,
      ndmi: 0.54,
      sar_vv: -11.1,
      sar_vh: -17.9,
      staleness: 1
    },
    {
      id: "scenario-mizoram-8029",
      title: "Aizawl Urban Flank Stabilization Watch",
      siteId: "mizoram_8029",
      region: "Mizoram",
      lat: 23.3644,
      lon: 92.8622,
      risk: "Medium",
      probability: 0.521,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in Mizoram. High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 52.1%.",
      ndvi: 0.51,
      ndmi: 0.29,
      sar_vv: -13.6,
      sar_vh: -20.1,
      staleness: 2
    },
    {
      id: "scenario-mizoram-8992",
      title: "Lunglei South Stable Bedrock",
      siteId: "mizoram_8992",
      region: "Mizoram",
      lat: 22.8911,
      lon: 92.981,
      risk: "Low",
      probability: 0.284,
      trigger: "Unknown / Historical",
      summary: "High-resolution observation sector in Mizoram. Unknown / Historical conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 28.4%.",
      ndvi: 0.6,
      ndmi: 0.09,
      sar_vv: -15.6,
      sar_vh: -21.9,
      staleness: 2
    },
    {
      id: "scenario-nagaland-3293",
      title: "Kohima-Dimapur Ridge Creep",
      siteId: "nagaland_3293",
      region: "Nagaland",
      lat: 25.6751,
      lon: 94.1086,
      risk: "High",
      probability: 0.745,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Nagaland. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 74.5%.",
      ndvi: 0.43,
      ndmi: 0.48,
      sar_vv: -11.7,
      sar_vh: -18.4,
      staleness: 1
    },
    {
      id: "scenario-nagaland-4783",
      title: "Mokokchung Sandstone Shaly Facies",
      siteId: "nagaland_4783",
      region: "Nagaland",
      lat: 26.1584,
      lon: 94.5624,
      risk: "Medium",
      probability: 0.461,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Nagaland. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 46.1%.",
      ndvi: 0.53,
      ndmi: 0.24,
      sar_vv: -14.1,
      sar_vh: -20.5,
      staleness: 2
    },
    {
      id: "scenario-sikkim-0812",
      title: "NH-10 Teesta Corridor Blockade",
      siteId: "sikkim_0812",
      region: "Sikkim",
      lat: 27.3389,
      lon: 88.6065,
      risk: "High",
      probability: 0.912,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Sikkim. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 91.2%.",
      ndvi: 0.37,
      ndmi: 0.63,
      sar_vv: -10.2,
      sar_vh: -17.2,
      staleness: 1
    },
    {
      id: "scenario-sikkim-1582",
      title: "Melli-Singtam Highway Verge",
      siteId: "sikkim_1582",
      region: "Sikkim",
      lat: 27.1843,
      lon: 88.5122,
      risk: "Medium",
      probability: 0.587,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Sikkim. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 58.7%.",
      ndvi: 0.49,
      ndmi: 0.35,
      sar_vv: -13.0,
      sar_vh: -19.6,
      staleness: 2
    },
    {
      id: "scenario-west-bengal-0691",
      title: "Darjeeling Hill Cart Road Slump",
      siteId: "west bengal_0691",
      region: "West Bengal (Hills)",
      lat: 27.041,
      lon: 88.2663,
      risk: "High",
      probability: 0.893,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in West Bengal (Hills). Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 89.3%.",
      ndvi: 0.38,
      ndmi: 0.61,
      sar_vv: -10.4,
      sar_vh: -17.3,
      staleness: 1
    },
    {
      id: "scenario-west-bengal-2429",
      title: "Sevoke Coronation Bridge Foothill",
      siteId: "west bengal_2429",
      region: "West Bengal (Hills)",
      lat: 26.85,
      lon: 88.42,
      risk: "Medium",
      probability: 0.472,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in West Bengal (Hills). High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 47.2%.",
      ndvi: 0.53,
      ndmi: 0.25,
      sar_vv: -14.0,
      sar_vh: -20.5,
      staleness: 2
    },
    {
      id: "scenario-arunachal-pradesh-5474",
      title: "Daporijo Upper Escarpment Slip",
      siteId: "arunachal pradesh_5474",
      region: "Arunachal Pradesh",
      lat: 27.985,
      lon: 94.221,
      risk: "High",
      probability: 0.715,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Arunachal Pradesh. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 71.5%.",
      ndvi: 0.44,
      ndmi: 0.46,
      sar_vv: -11.9,
      sar_vh: -18.6,
      staleness: 1
    },
    {
      id: "scenario-negative-manipur-1067",
      title: "Manipur Stable Baseline [1067]",
      siteId: "negative_manipur_1067",
      region: "Manipur",
      lat: 25.0315,
      lon: 94.2941,
      risk: "Low",
      probability: 0.165,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Manipur. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.78,
      ndmi: 0.22,
      sar_vv: -18.9,
      sar_vh: -25.1,
      staleness: 3
    },
    {
      id: "scenario-west-bengal-1147",
      title: "Kalimpong Teesta Bazar Sector",
      siteId: "west bengal_1147",
      region: "West Bengal (Hills)",
      lat: 27.062,
      lon: 88.441,
      risk: "High",
      probability: 0.825,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in West Bengal (Hills). Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 82.5%.",
      ndvi: 0.4,
      ndmi: 0.55,
      sar_vv: -11.0,
      sar_vh: -17.8,
      staleness: 1
    },
    {
      id: "scenario-meghalaya-6588",
      title: "Umiam Gorge NH-6 Transit Line",
      siteId: "meghalaya_6588",
      region: "Meghalaya",
      lat: 25.68,
      lon: 91.88,
      risk: "High",
      probability: 0.758,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Meghalaya. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 75.8%.",
      ndvi: 0.43,
      ndmi: 0.49,
      sar_vv: -11.6,
      sar_vh: -18.3,
      staleness: 1
    },
    {
      id: "scenario-manipur-4040",
      title: "Noney Hill Corridor Active Creep",
      siteId: "manipur_4040",
      region: "Manipur",
      lat: 24.6637,
      lon: 93.9063,
      risk: "Medium",
      probability: 0.621,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in Manipur. High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 62.1%.",
      ndvi: 0.48,
      ndmi: 0.38,
      sar_vv: -12.7,
      sar_vh: -19.3,
      staleness: 2
    },
    {
      id: "scenario-negative-meghalaya-1455",
      title: "Meghalaya Stable Baseline [1455]",
      siteId: "negative_meghalaya_1455",
      region: "Meghalaya",
      lat: 25.5828,
      lon: 91.1022,
      risk: "Low",
      probability: 0.135,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Meghalaya. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.72,
      ndmi: 0.18,
      sar_vv: -18.9,
      sar_vh: -25.1,
      staleness: 1
    },
    {
      id: "scenario-negative-west-bengal-0438",
      title: "West Bengal (Hills) Stable Baseline [0438]",
      siteId: "negative_west_bengal_0438",
      region: "West Bengal (Hills)",
      lat: 26.7423,
      lon: 89.2528,
      risk: "Low",
      probability: 0.18,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in West Bengal (Hills). Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.81,
      ndmi: 0.12,
      sar_vv: -18.1,
      sar_vh: -24.4,
      staleness: 1
    },
    {
      id: "scenario-sikkim-1851",
      title: "Dikchu River Basin Active Slide",
      siteId: "sikkim_1851",
      region: "Sikkim",
      lat: 27.42,
      lon: 88.58,
      risk: "High",
      probability: 0.792,
      trigger: "Heavy Cloudburst",
      summary: "High-resolution observation sector in Sikkim. Heavy Cloudburst conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 79.2%.",
      ndvi: 0.41,
      ndmi: 0.52,
      sar_vv: -11.3,
      sar_vh: -18.1,
      staleness: 1
    },
    {
      id: "scenario-negative-sikkim-1639",
      title: "Sikkim Stable Baseline [1639]",
      siteId: "negative_sikkim_1639",
      region: "Sikkim",
      lat: 27.3684,
      lon: 88.2989,
      risk: "Low",
      probability: 0.195,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Sikkim. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.84,
      ndmi: 0.14,
      sar_vv: -18.9,
      sar_vh: -25.1,
      staleness: 2
    },
    {
      id: "scenario-nagaland-4789",
      title: "Pagla Pahar Sinking Zone NH-29",
      siteId: "nagaland_4789",
      region: "Nagaland",
      lat: 25.792,
      lon: 93.855,
      risk: "High",
      probability: 0.835,
      trigger: "Heavy Cloudburst",
      summary: "High-resolution observation sector in Nagaland. Heavy Cloudburst conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 83.5%.",
      ndvi: 0.4,
      ndmi: 0.56,
      sar_vv: -10.9,
      sar_vh: -17.7,
      staleness: 1
    },
    {
      id: "scenario-negative-arunachal-pradesh-1216",
      title: "Arunachal Pradesh Stable Baseline [1216]",
      siteId: "negative_arunachal_pradesh_1216",
      region: "Arunachal Pradesh",
      lat: 27.7956,
      lon: 94.4859,
      risk: "Low",
      probability: 0.15,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Arunachal Pradesh. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.75,
      ndmi: 0.2,
      sar_vv: -16.5,
      sar_vh: -23.0,
      staleness: 2
    },
    {
      id: "scenario-assam-6808",
      title: "Dima Hasao Hill Railway Section",
      siteId: "assam_6808",
      region: "Assam",
      lat: 25.75,
      lon: 93.12,
      risk: "Medium",
      probability: 0.582,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Assam. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 58.2%.",
      ndvi: 0.49,
      ndmi: 0.34,
      sar_vv: -13.1,
      sar_vh: -19.6,
      staleness: 2
    },
    {
      id: "scenario-tripura-8529",
      title: "Agartala-Udaipur Hill Bypass",
      siteId: "tripura_8529",
      region: "Tripura",
      lat: 23.8315,
      lon: 91.2868,
      risk: "Medium",
      probability: 0.534,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Tripura. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 53.4%.",
      ndvi: 0.51,
      ndmi: 0.3,
      sar_vv: -13.5,
      sar_vh: -20.0,
      staleness: 2
    },
    {
      id: "scenario-negative-west-bengal-0356",
      title: "West Bengal (Hills) Stable Baseline [0356]",
      siteId: "negative_west_bengal_0356",
      region: "West Bengal (Hills)",
      lat: 26.937,
      lon: 88.2472,
      risk: "Low",
      probability: 0.15,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in West Bengal (Hills). Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.75,
      ndmi: 0.16,
      sar_vv: -16.5,
      sar_vh: -23.0,
      staleness: 3
    },
    {
      id: "scenario-mizoram-8632",
      title: "Serchhip Hill Road Toe Subsidence",
      siteId: "mizoram_8632",
      region: "Mizoram",
      lat: 23.45,
      lon: 92.95,
      risk: "High",
      probability: 0.672,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Mizoram. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 67.2%.",
      ndvi: 0.46,
      ndmi: 0.42,
      sar_vv: -12.3,
      sar_vh: -19.0,
      staleness: 2
    },
    {
      id: "scenario-negative-tripura-1898",
      title: "Tripura Stable Baseline [1898]",
      siteId: "negative_tripura_1898",
      region: "Tripura",
      lat: 23.6114,
      lon: 91.3138,
      risk: "Low",
      probability: 0.18,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Tripura. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.81,
      ndmi: 0.16,
      sar_vv: -18.1,
      sar_vh: -24.4,
      staleness: 3
    },
    {
      id: "scenario-negative-tripura-1888",
      title: "Tripura Stable Baseline [1888]",
      siteId: "negative_tripura_1888",
      region: "Tripura",
      lat: 24.0682,
      lon: 92.7039,
      risk: "Low",
      probability: 0.18,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Tripura. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.81,
      ndmi: 0.2,
      sar_vv: -16.5,
      sar_vh: -23.0,
      staleness: 2
    },
    {
      id: "scenario-tripura-8546",
      title: "Jampui Hills Ridge Crest Slide",
      siteId: "tripura_8546",
      region: "Tripura",
      lat: 24.12,
      lon: 92.15,
      risk: "Medium",
      probability: 0.627,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Tripura. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 62.7%.",
      ndvi: 0.47,
      ndmi: 0.38,
      sar_vv: -12.7,
      sar_vh: -19.3,
      staleness: 2
    },
    {
      id: "scenario-mizoram-7655",
      title: "Kolasib NH-306 Highway Corridor",
      siteId: "mizoram_7655",
      region: "Mizoram",
      lat: 23.89,
      lon: 92.68,
      risk: "Medium",
      probability: 0.589,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Mizoram. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 58.9%.",
      ndvi: 0.49,
      ndmi: 0.35,
      sar_vv: -13.0,
      sar_vh: -19.6,
      staleness: 2
    },
    {
      id: "scenario-negative-manipur-0959",
      title: "Manipur Stable Baseline [0959]",
      siteId: "negative_manipur_0959",
      region: "Manipur",
      lat: 25.2496,
      lon: 93.7604,
      risk: "Low",
      probability: 0.195,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Manipur. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.84,
      ndmi: 0.22,
      sar_vv: -18.9,
      sar_vh: -25.1,
      staleness: 3
    },
    {
      id: "scenario-negative-meghalaya-1548",
      title: "Meghalaya Stable Baseline [1548]",
      siteId: "negative_meghalaya_1548",
      region: "Meghalaya",
      lat: 25.2976,
      lon: 92.0124,
      risk: "Low",
      probability: 0.18,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Meghalaya. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.81,
      ndmi: 0.12,
      sar_vv: -16.5,
      sar_vh: -23.0,
      staleness: 1
    },
    {
      id: "scenario-meghalaya-6716",
      title: "South Garo Hills Limestone Fault",
      siteId: "meghalaya_6716",
      region: "Meghalaya",
      lat: 25.19,
      lon: 91.45,
      risk: "High",
      probability: 0.684,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Meghalaya. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 68.4%.",
      ndvi: 0.45,
      ndmi: 0.43,
      sar_vv: -12.2,
      sar_vh: -18.9,
      staleness: 2
    },
    {
      id: "scenario-negative-sikkim-1621",
      title: "Sikkim Stable Baseline [1621]",
      siteId: "negative_sikkim_1621",
      region: "Sikkim",
      lat: 27.4652,
      lon: 88.7247,
      risk: "Low",
      probability: 0.075,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Sikkim. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.75,
      ndmi: 0.14,
      sar_vv: -17.3,
      sar_vh: -23.7,
      staleness: 2
    },
    {
      id: "scenario-arunachal-pradesh-0001",
      title: "Kimin-Ziro Highway Sector Watch",
      siteId: "arunachal_pradesh_0001",
      region: "Arunachal Pradesh",
      lat: 27.321,
      lon: 93.985,
      risk: "High",
      probability: 0.762,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Arunachal Pradesh. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 76.2%.",
      ndvi: 0.43,
      ndmi: 0.5,
      sar_vv: -11.5,
      sar_vh: -18.3,
      staleness: 1
    },
    {
      id: "scenario-nagaland-5134",
      title: "Tuensang Ridge Slope Instability",
      siteId: "nagaland_5134",
      region: "Nagaland",
      lat: 26.25,
      lon: 94.8,
      risk: "Medium",
      probability: 0.618,
      trigger: "High Pore Water Saturation",
      summary: "High-resolution observation sector in Nagaland. High Pore Water Saturation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 61.8%.",
      ndvi: 0.48,
      ndmi: 0.38,
      sar_vv: -12.7,
      sar_vh: -19.4,
      staleness: 2
    },
    {
      id: "scenario-arunachal-pradesh-0017",
      title: "Lower Subansiri Alluvial Terrace",
      siteId: "arunachal_pradesh_0017",
      region: "Arunachal Pradesh",
      lat: 27.538,
      lon: 93.842,
      risk: "Medium",
      probability: 0.485,
      trigger: "Unknown / Historical",
      summary: "High-resolution observation sector in Arunachal Pradesh. Unknown / Historical conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 48.5%.",
      ndvi: 0.53,
      ndmi: 0.26,
      sar_vv: -13.9,
      sar_vh: -20.4,
      staleness: 2
    },
    {
      id: "scenario-negative-assam-1749",
      title: "Assam Stable Baseline [1749]",
      siteId: "negative_assam_1749",
      region: "Assam",
      lat: 24.4837,
      lon: 92.8193,
      risk: "Low",
      probability: 0.195,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Assam. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.84,
      ndmi: 0.18,
      sar_vv: -17.3,
      sar_vh: -23.7,
      staleness: 1
    },
    {
      id: "scenario-negative-arunachal-pradesh-1217",
      title: "Arunachal Pradesh Stable Baseline [1217]",
      siteId: "negative_arunachal_pradesh_1217",
      region: "Arunachal Pradesh",
      lat: 28.5589,
      lon: 96.0983,
      risk: "Low",
      probability: 0.165,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Arunachal Pradesh. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.78,
      ndmi: 0.22,
      sar_vv: -17.3,
      sar_vh: -23.7,
      staleness: 3
    },
    {
      id: "scenario-negative-mizoram-0281",
      title: "Mizoram Stable Baseline [0281]",
      siteId: "negative_mizoram_0281",
      region: "Mizoram",
      lat: 23.3758,
      lon: 93.0779,
      risk: "Low",
      probability: 0.075,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Mizoram. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.75,
      ndmi: 0.22,
      sar_vv: -17.3,
      sar_vh: -23.7,
      staleness: 3
    },
    {
      id: "scenario-arunachal-pradesh-2767",
      title: "Siang Gorge Fracture Zone",
      siteId: "arunachal pradesh_2767",
      region: "Arunachal Pradesh",
      lat: 28.218,
      lon: 94.7278,
      risk: "Medium",
      probability: 0.638,
      trigger: "Continuous Monsoon Rain",
      summary: "High-resolution observation sector in Arunachal Pradesh. Continuous Monsoon Rain conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 63.8%.",
      ndvi: 0.47,
      ndmi: 0.39,
      sar_vv: -12.6,
      sar_vh: -19.2,
      staleness: 2
    },
    {
      id: "scenario-negative-nagaland-0770",
      title: "Nagaland Stable Baseline [0770]",
      siteId: "negative_nagaland_0770",
      region: "Nagaland",
      lat: 25.6659,
      lon: 93.7487,
      risk: "Low",
      probability: 0.06,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Nagaland. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.72,
      ndmi: 0.16,
      sar_vv: -18.1,
      sar_vh: -24.4,
      staleness: 3
    },
    {
      id: "scenario-negative-assam-1714",
      title: "Assam Stable Baseline [1714]",
      siteId: "negative_assam_1714",
      region: "Assam",
      lat: 26.013,
      lon: 92.3517,
      risk: "Low",
      probability: 0.12,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Assam. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.84,
      ndmi: 0.2,
      sar_vv: -18.1,
      sar_vh: -24.4,
      staleness: 2
    },
    {
      id: "scenario-sikkim-1644",
      title: "Lachung High Altitude Road Toe",
      siteId: "sikkim_1644",
      region: "Sikkim",
      lat: 27.6521,
      lon: 88.321,
      risk: "High",
      probability: 0.681,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Sikkim. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 68.1%.",
      ndvi: 0.45,
      ndmi: 0.43,
      sar_vv: -12.2,
      sar_vh: -18.9,
      staleness: 2
    },
    {
      id: "scenario-negative-mizoram-0334",
      title: "Mizoram Stable Baseline [0334]",
      siteId: "negative_mizoram_0334",
      region: "Mizoram",
      lat: 22.4519,
      lon: 92.8398,
      risk: "Low",
      probability: 0.12,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Mizoram. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.84,
      ndmi: 0.2,
      sar_vv: -18.1,
      sar_vh: -24.4,
      staleness: 2
    },
    {
      id: "scenario-west-bengal-1430",
      title: "Kurseong Dowhill Shaly Failure",
      siteId: "west bengal_1430",
      region: "West Bengal (Hills)",
      lat: 26.98,
      lon: 88.31,
      risk: "Medium",
      probability: 0.563,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in West Bengal (Hills). Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 56.3%.",
      ndvi: 0.5,
      ndmi: 0.33,
      sar_vv: -13.2,
      sar_vh: -19.8,
      staleness: 2
    },
    {
      id: "scenario-negative-nagaland-0881",
      title: "Nagaland Stable Baseline [0881]",
      siteId: "negative_nagaland_0881",
      region: "Nagaland",
      lat: 23.9538,
      lon: 91.9053,
      risk: "Low",
      probability: 0.075,
      trigger: "Unknown / Historical",
      summary: "Verified stable geological control site in Nagaland. Negligible shear displacement observed in satellite SAR with robust canopy and low soil saturation.",
      ndvi: 0.75,
      ndmi: 0.22,
      sar_vv: -17.3,
      sar_vh: -23.7,
      staleness: 3
    },
    {
      id: "scenario-assam-6786",
      title: "Haflong Slumping Zone NH-54E",
      siteId: "assam_6786",
      region: "Assam",
      lat: 25.18,
      lon: 92.84,
      risk: "High",
      probability: 0.694,
      trigger: "Road Cut / Slope Toe Excavation",
      summary: "High-resolution observation sector in Assam. Road Cut / Slope Toe Excavation conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 69.4%.",
      ndvi: 0.45,
      ndmi: 0.44,
      sar_vv: -12.1,
      sar_vh: -18.8,
      staleness: 2
    },
    {
      id: "scenario-manipur-4185",
      title: "Tupul Railway Yard Drainage Toe",
      siteId: "manipur_4185",
      region: "Manipur",
      lat: 25.24,
      lon: 93.89,
      risk: "High",
      probability: 0.812,
      trigger: "Heavy Cloudburst",
      summary: "High-resolution observation sector in Manipur. Heavy Cloudburst conditions monitored via multi-temporal Sentinel-1/2 sequences with susceptibility index at 81.2%.",
      ndvi: 0.41,
      ndmi: 0.54,
      sar_vv: -11.1,
      sar_vh: -17.9,
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
    { state: "Tripura", rainIndex: 125, porePressure: 68, roadReadiness: "Ready" },
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
