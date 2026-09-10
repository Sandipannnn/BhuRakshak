/**
 * BhuRakshak Crowdsourced Field Incident Reporting Portal
 * Handles geo-tagged photo uploads, GPS coordinates capture, category tagging,
 * and live community report feed.
 */

class FieldReportsPortal {
  constructor() {
    this.reports = [];
    this.selectedFile = null;
  }

  init() {
    this.bindFormEvents();
    this.loadReportsFeed();
  }

  bindFormEvents() {
    const form = document.getElementById("field-report-form");
    const dropzone = document.getElementById("report-dropzone");
    const fileInput = document.getElementById("report-file-input");
    const previewImg = document.getElementById("dropzone-preview");
    const gpsBtn = document.getElementById("btn-get-gps");

    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());

      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "var(--cyan-400)";
      });

      dropzone.addEventListener("dragleave", () => {
        dropzone.style.borderColor = "rgba(148, 163, 184, 0.25)";
      });

      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "rgba(148, 163, 184, 0.25)";
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.handleFileSelect(e.dataTransfer.files[0], previewImg);
        }
      });

      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleFileSelect(e.target.files[0], previewImg);
        }
      });
    }

    if (gpsBtn) {
      gpsBtn.addEventListener("click", () => {
        if (navigator.geolocation) {
          gpsBtn.textContent = "Acquiring GPS...";
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              document.getElementById("report-lat").value = pos.coords.latitude.toFixed(5);
              document.getElementById("report-lon").value = pos.coords.longitude.toFixed(5);
              gpsBtn.textContent = "✓ GPS Locked";
              setTimeout(() => { gpsBtn.textContent = "📍 Auto GPS"; }, 2500);
            },
            (err) => {
              alert("Could not acquire location: " + err.message + ". Setting default NER coordinates.");
              document.getElementById("report-lat").value = "27.3389";
              document.getElementById("report-lon").value = "88.6065";
              gpsBtn.textContent = "📍 Auto GPS";
            }
          );
        } else {
          alert("Geolocation is not supported by your browser.");
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.submitReport(form);
      });
    }

    // Filter selector for reports feed
    const categoryFilter = document.getElementById("report-category-filter");
    if (categoryFilter) {
      categoryFilter.addEventListener("change", () => {
        this.renderReportsFeed();
      });
    }
  }

  handleFileSelect(file, previewEl) {
    this.selectedFile = file;
    if (file && file.type.startsWith("image/") && previewEl) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewEl.src = e.target.result;
        previewEl.style.display = "block";
        const promptText = document.getElementById("dropzone-prompt");
        if (promptText) promptText.style.display = "none";
      };
      reader.readAsDataURL(file);
    }
  }

  async submitReport(form) {
    const submitBtn = document.getElementById("report-submit-btn");
    const statusMsg = document.getElementById("report-status-msg");

    const lat = parseFloat(document.getElementById("report-lat").value);
    const lon = parseFloat(document.getElementById("report-lon").value);
    const category = document.getElementById("report-category").value;
    const description = document.getElementById("report-desc").value;
    const siteId = document.getElementById("report-site-id").value;

    if (isNaN(lat) || isNaN(lon)) {
      alert("Please provide valid latitude and longitude coordinates.");
      return;
    }

    if (!this.selectedFile) {
      alert("Please upload an evidence photo or video file.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting Evidence...";
    }

    try {
      const formData = new FormData();
      formData.append("latitude", lat);
      formData.append("longitude", lon);
      formData.append("category", category);
      formData.append("description", description);
      if (siteId) formData.append("site_id", siteId);
      formData.append("media", this.selectedFile);

      const saved = await window.api.submitFieldReport(formData);

      if (statusMsg) {
        statusMsg.innerHTML = `<span style="color:var(--risk-low); font-weight:600;">✓ Report #${saved.report_id} successfully logged and geotagged!</span>`;
        statusMsg.style.display = "block";
        setTimeout(() => { statusMsg.style.display = "none"; }, 4000);
      }

      // Reset Form
      form.reset();
      this.selectedFile = null;
      const previewEl = document.getElementById("dropzone-preview");
      if (previewEl) previewEl.style.display = "none";
      const promptText = document.getElementById("dropzone-prompt");
      if (promptText) promptText.style.display = "block";

      // Reload feed & map pin
      await this.loadReportsFeed();
      if (window.bhuMap) {
        window.bhuMap.loadFieldReportMarkers();
      }
    } catch (e) {
      alert("Report submission failed: " + e.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Field Incident Report";
      }
    }
  }

  async loadReportsFeed() {
    const feedContainer = document.getElementById("reports-feed-container");
    if (!feedContainer) return;

    try {
      this.reports = await window.api.getFieldReports();
      this.renderReportsFeed();
    } catch (e) {
      console.error("Failed to load reports feed:", e);
    }
  }

  renderReportsFeed() {
    const feedContainer = document.getElementById("reports-feed-container");
    const countEl = document.getElementById("reports-count-badge");
    const categoryFilter = document.getElementById("report-category-filter");
    if (!feedContainer) return;

    const filterVal = categoryFilter ? categoryFilter.value : "all";
    const filtered = filterVal === "all" 
      ? this.reports 
      : this.reports.filter(r => r.category === filterVal);

    if (countEl) countEl.textContent = `${filtered.length} Reports`;

    feedContainer.innerHTML = "";
    if (filtered.length === 0) {
      feedContainer.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:30px; color:#94a3b8;">No reports in this category yet.</div>`;
      return;
    }

    filtered.forEach(report => {
      const card = document.createElement("div");
      card.className = "report-card";

      const timeAgo = this._formatTimeAgo(new Date(report.submitted_at));
      const catLabel = report.category.replace('_', ' ').toUpperCase();

      card.innerHTML = `
        <img class="report-media-thumb" 
             src="${report.media_url}" 
             alt="${catLabel}"
             onclick="window.reportsPortal.openLightbox('${report.media_url}', '${catLabel}')"
             onerror="this.src='assets/sample_crack.jpg'"/>
        <div class="report-card-body">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
              <span class="report-category-pill">${catLabel}</span>
              <span style="font-size:11px; color:#64748b;">${timeAgo}</span>
            </div>
            <p style="font-size:12px; color:#cbd5e1; line-height:1.45; margin-bottom:10px;">
              ${report.description || "No description provided."}
            </p>
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:8px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#38bdf8;">
              ${report.latitude.toFixed(4)}°N, ${report.longitude.toFixed(4)}°E
            </span>
            <button onclick="window.reportsPortal.locateOnMap(${report.latitude}, ${report.longitude})" 
                    style="background:none; border:none; color:#06b6d4; font-size:11px; font-weight:600; cursor:pointer;">
              View on Map &rarr;
            </button>
          </div>
        </div>
      `;

      feedContainer.appendChild(card);
    });
  }

  locateOnMap(lat, lon) {
    if (window.app && window.app.switchTab) {
      window.app.switchTab("map");
      if (window.bhuMap) {
        window.bhuMap.flyTo(lat, lon, 12);
      }
    }
  }

  openLightbox(src, title) {
    const modal = document.getElementById("lightbox-modal");
    const img = document.getElementById("lightbox-img");
    const caption = document.getElementById("lightbox-caption");
    if (modal && img) {
      img.src = src;
      if (caption) caption.textContent = title;
      modal.classList.add("active");
    }
  }

  _formatTimeAgo(date) {
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}

window.reportsPortal = new FieldReportsPortal();
