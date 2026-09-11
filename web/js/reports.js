/**
 * BhuRakshak Crowdsourced Field Incident Reporting Portal
 *
 * Existing functionality preserved:
 * - Existing field report form handling
 * - GPS coordinate capture
 * - Image preview
 * - Field report submission
 * - Community report feed
 * - Category filtering
 * - Map navigation
 * - Report image lightbox
 *
 * Added:
 * - Floating "Report Live Event" button
 * - Live event reporting modal
 * - Camera/gallery image upload
 * - Live GPS capture
 * - Event category selection
 * - Description
 * - Mobile responsive UI
 */

class FieldReportsPortal {
  constructor() {
    this.reports = [];
    this.selectedFile = null;

    // Separate state for the new Live Event reporter
    this.liveEventFile = null;
    this.liveEventLocation = null;
    this.liveEventSubmitting = false;
  }

  init() {
    // Existing functionality
    this.bindFormEvents();
    this.loadReportsFeed();

    // New Live Event functionality
    this.injectLiveEventStyles();
    this.injectLiveEventUI();
    this.bindLiveEventEvents();
  }

  /* ============================================================
     EXISTING FIELD REPORT FORM
     ============================================================ */

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
          this.handleFileSelect(
            e.dataTransfer.files[0],
            previewImg
          );
        }
      });

      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleFileSelect(
            e.target.files[0],
            previewImg
          );
        }
      });
    }

    if (gpsBtn) {
      gpsBtn.addEventListener("click", () => {
        if (navigator.geolocation) {
          gpsBtn.textContent = "Acquiring GPS...";

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              document.getElementById("report-lat").value =
                pos.coords.latitude.toFixed(5);

              document.getElementById("report-lon").value =
                pos.coords.longitude.toFixed(5);

              gpsBtn.textContent = "✓ GPS Locked";

              setTimeout(() => {
                gpsBtn.textContent = "📍 Auto GPS";
              }, 2500);
            },

            (err) => {
              alert(
                "Could not acquire location: " +
                err.message +
                ". Setting default NER coordinates."
              );

              document.getElementById("report-lat").value =
                "27.3389";

              document.getElementById("report-lon").value =
                "88.6065";

              gpsBtn.textContent = "📍 Auto GPS";
            }
          );
        } else {
          alert(
            "Geolocation is not supported by your browser."
          );
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.submitReport(form);
      });
    }

    // Existing category filter
    const categoryFilter =
      document.getElementById("report-category-filter");

    if (categoryFilter) {
      categoryFilter.addEventListener("change", () => {
        this.renderReportsFeed();
      });
    }
  }

  handleFileSelect(file, previewEl) {
    this.selectedFile = file;

    if (
      file &&
      file.type.startsWith("image/") &&
      previewEl
    ) {
      const reader = new FileReader();

      reader.onload = (e) => {
        previewEl.src = e.target.result;
        previewEl.style.display = "block";

        const promptText =
          document.getElementById("dropzone-prompt");

        if (promptText) {
          promptText.style.display = "none";
        }
      };

      reader.readAsDataURL(file);
    }
  }

  async submitReport(form) {
    const submitBtn =
      document.getElementById("report-submit-btn");

    const statusMsg =
      document.getElementById("report-status-msg");

    const lat =
      parseFloat(
        document.getElementById("report-lat").value
      );

    const lon =
      parseFloat(
        document.getElementById("report-lon").value
      );

    const category =
      document.getElementById("report-category").value;

    const description =
      document.getElementById("report-desc").value;

    const siteId =
      document.getElementById("report-site-id").value;

    if (isNaN(lat) || isNaN(lon)) {
      alert(
        "Please provide valid latitude and longitude coordinates."
      );
      return;
    }

    if (!this.selectedFile) {
      alert(
        "Please upload an evidence photo or video file."
      );
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

      if (siteId) {
        formData.append("site_id", siteId);
      }

      formData.append("media", this.selectedFile);

      const saved =
        await window.api.submitFieldReport(formData);

      if (statusMsg) {
        statusMsg.innerHTML =
          `<span style="color:var(--risk-low); font-weight:600;">
            ✓ Report #${saved.report_id} successfully logged and geotagged!
          </span>`;

        statusMsg.style.display = "block";

        setTimeout(() => {
          statusMsg.style.display = "none";
        }, 4000);
      }

      // Reset form
      form.reset();

      this.selectedFile = null;

      const previewEl =
        document.getElementById("dropzone-preview");

      if (previewEl) {
        previewEl.style.display = "none";
      }

      const promptText =
        document.getElementById("dropzone-prompt");

      if (promptText) {
        promptText.style.display = "block";
      }

      // Reload feed and map pin
      await this.loadReportsFeed();

      if (window.bhuMap) {
        window.bhuMap.loadFieldReportMarkers();
      }

    } catch (e) {
      alert(
        "Report submission failed: " +
        e.message
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent =
          "Submit Field Incident Report";
      }
    }
  }

  /* ============================================================
     NEW LIVE EVENT UI
     ============================================================ */

  injectLiveEventStyles() {
    if (document.getElementById("live-event-styles")) {
      return;
    }

    const style =
      document.createElement("style");

    style.id = "live-event-styles";

    style.textContent = `
      /* -------------------------------------------------------
         Floating Live Event Button
      ------------------------------------------------------- */

      #report-live-event-btn {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 9990;

        display: flex;
        align-items: center;
        gap: 9px;

        padding: 13px 18px;

        border: 1px solid rgba(34, 211, 238, 0.45);
        border-radius: 999px;

        background:
          linear-gradient(
            135deg,
            rgba(8, 47, 73, 0.98),
            rgba(15, 23, 42, 0.98)
          );

        color: #e0f2fe;

        font-family: inherit;
        font-size: 14px;
        font-weight: 700;

        cursor: pointer;

        box-shadow:
          0 8px 30px rgba(0, 0, 0, 0.35),
          0 0 20px rgba(34, 211, 238, 0.12);

        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease,
          border-color 0.2s ease;
      }

      #report-live-event-btn:hover {
        transform: translateY(-2px);

        border-color: rgba(34, 211, 238, 0.8);

        box-shadow:
          0 12px 35px rgba(0, 0, 0, 0.4),
          0 0 25px rgba(34, 211, 238, 0.2);
      }

      #report-live-event-btn:active {
        transform: translateY(0);
      }

      .live-event-camera-icon {
        font-size: 18px;
        line-height: 1;
      }

      /* -------------------------------------------------------
         Modal Overlay
      ------------------------------------------------------- */

      #live-event-modal {
        position: fixed;
        inset: 0;

        z-index: 10000;

        display: none;

        align-items: center;
        justify-content: center;

        padding: 20px;

        background: rgba(2, 6, 23, 0.78);

        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }

      #live-event-modal.active {
        display: flex;
      }

      /* -------------------------------------------------------
         Modal
      ------------------------------------------------------- */

      .live-event-modal-card {
        width: min(560px, 100%);
        max-height: 92vh;

        overflow-y: auto;

        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 18px;

        background:
          linear-gradient(
            145deg,
            rgba(15, 23, 42, 0.99),
            rgba(2, 6, 23, 0.99)
          );

        box-shadow:
          0 30px 80px rgba(0, 0, 0, 0.55);

        color: #e2e8f0;
      }

      .live-event-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;

        padding: 20px 22px;

        border-bottom:
          1px solid rgba(148, 163, 184, 0.12);
      }

      .live-event-title-wrap h2 {
        margin: 0;

        font-size: 20px;
        line-height: 1.3;

        color: #f8fafc;
      }

      .live-event-title-wrap p {
        margin: 5px 0 0;

        font-size: 12px;
        line-height: 1.5;

        color: #94a3b8;
      }

      #live-event-close {
        width: 34px;
        height: 34px;

        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 8px;

        background: rgba(30, 41, 59, 0.6);

        color: #cbd5e1;

        font-size: 20px;
        line-height: 1;

        cursor: pointer;
      }

      #live-event-close:hover {
        background: rgba(51, 65, 85, 0.8);
        color: white;
      }

      .live-event-modal-body {
        padding: 20px 22px 22px;
      }

      /* -------------------------------------------------------
         Form
      ------------------------------------------------------- */

      .live-event-field {
        margin-bottom: 16px;
      }

      .live-event-field label {
        display: block;

        margin-bottom: 7px;

        font-size: 12px;
        font-weight: 700;

        color: #cbd5e1;
      }

      .live-event-required {
        color: #22d3ee;
      }

      .live-event-input,
      .live-event-select,
      .live-event-textarea {
        width: 100%;

        box-sizing: border-box;

        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 9px;

        background: rgba(15, 23, 42, 0.8);

        color: #e2e8f0;

        font-family: inherit;
        font-size: 13px;

        outline: none;

        transition:
          border-color 0.2s ease,
          box-shadow 0.2s ease;
      }

      .live-event-input,
      .live-event-select {
        min-height: 42px;
        padding: 10px 12px;
      }

      .live-event-textarea {
        min-height: 90px;
        padding: 11px 12px;
        resize: vertical;
      }

      .live-event-input:focus,
      .live-event-select:focus,
      .live-event-textarea:focus {
        border-color: rgba(34, 211, 238, 0.65);

        box-shadow:
          0 0 0 3px rgba(34, 211, 238, 0.08);
      }

      /* -------------------------------------------------------
         Location
      ------------------------------------------------------- */

      .live-event-location-row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 8px;
      }

      .live-event-gps-btn {
        min-height: 42px;

        padding: 9px 12px;

        border: 1px solid rgba(34, 211, 238, 0.35);
        border-radius: 9px;

        background: rgba(8, 47, 73, 0.65);

        color: #67e8f9;

        font-family: inherit;
        font-size: 12px;
        font-weight: 700;

        cursor: pointer;
      }

      .live-event-gps-btn:hover {
        background: rgba(8, 47, 73, 0.9);
      }

      .live-event-location-status {
        margin-top: 7px;

        font-size: 11px;

        color: #64748b;
      }

      .live-event-location-status.success {
        color: #4ade80;
      }

      .live-event-location-status.error {
        color: #fb7185;
      }

      /* -------------------------------------------------------
         Upload
      ------------------------------------------------------- */

      .live-event-upload {
        position: relative;

        min-height: 160px;

        display: flex;
        align-items: center;
        justify-content: center;

        overflow: hidden;

        border:
          1px dashed rgba(34, 211, 238, 0.35);

        border-radius: 12px;

        background:
          rgba(15, 23, 42, 0.55);

        cursor: pointer;

        transition:
          border-color 0.2s ease,
          background 0.2s ease;
      }

      .live-event-upload:hover {
        border-color: rgba(34, 211, 238, 0.75);
        background: rgba(8, 47, 73, 0.25);
      }

      .live-event-upload-content {
        text-align: center;
        padding: 20px;
      }

      .live-event-upload-icon {
        font-size: 32px;
        margin-bottom: 8px;
      }

      .live-event-upload-title {
        font-size: 13px;
        font-weight: 700;
        color: #e2e8f0;
      }

      .live-event-upload-subtitle {
        margin-top: 5px;
        font-size: 11px;
        color: #64748b;
      }

      #live-event-file-input {
        display: none;
      }

      #live-event-preview {
        display: none;

        width: 100%;
        height: 220px;

        object-fit: cover;

        border-radius: 10px;
      }

      .live-event-remove-photo {
        display: none;

        position: absolute;
        top: 10px;
        right: 10px;

        padding: 6px 9px;

        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 7px;

        background: rgba(2, 6, 23, 0.8);

        color: white;

        font-size: 11px;
        font-weight: 700;

        cursor: pointer;
      }

      /* -------------------------------------------------------
         Submit
      ------------------------------------------------------- */

      .live-event-submit {
        width: 100%;

        min-height: 46px;

        border: 0;
        border-radius: 10px;

        background:
          linear-gradient(
            135deg,
            #0891b2,
            #06b6d4
          );

        color: white;

        font-family: inherit;
        font-size: 13px;
        font-weight: 800;

        cursor: pointer;

        transition:
          opacity 0.2s ease,
          transform 0.2s ease;
      }

      .live-event-submit:hover {
        transform: translateY(-1px);
      }

      .live-event-submit:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        transform: none;
      }

      .live-event-status {
        display: none;

        margin-top: 12px;

        padding: 10px 12px;

        border-radius: 8px;

        font-size: 12px;
        line-height: 1.45;
      }

      .live-event-status.success {
        display: block;

        background: rgba(34, 197, 94, 0.08);
        border: 1px solid rgba(34, 197, 94, 0.2);

        color: #86efac;
      }

      .live-event-status.error {
        display: block;

        background: rgba(244, 63, 94, 0.08);
        border: 1px solid rgba(244, 63, 94, 0.2);

        color: #fda4af;
      }

      .live-event-note {
        margin-top: 12px;

        font-size: 10px;
        line-height: 1.5;

        text-align: center;

        color: #64748b;
      }

      /* -------------------------------------------------------
         Mobile
      ------------------------------------------------------- */

      @media (max-width: 600px) {

        #report-live-event-btn {
          right: 16px;
          bottom: 16px;

          padding: 12px 15px;

          font-size: 13px;
        }

        .live-event-modal-card {
          max-height: 94vh;
          border-radius: 15px;
        }

        .live-event-modal-header {
          padding: 17px;
        }

        .live-event-modal-body {
          padding: 17px;
        }

        .live-event-location-row {
          grid-template-columns: 1fr 1fr;
        }

        .live-event-gps-btn {
          grid-column: 1 / -1;
        }

        #live-event-preview {
          height: 190px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectLiveEventUI() {
    // Do not create duplicates
    if (
      document.getElementById(
        "report-live-event-btn"
      )
    ) {
      return;
    }

    /* ---------------------------------------------------------
       Floating Button
    --------------------------------------------------------- */

    const button =
      document.createElement("button");

    button.id = "report-live-event-btn";
    button.type = "button";
    button.innerHTML = `
      <span class="live-event-camera-icon">📸</span>
      <span>Report Live Event</span>
    `;

    document.body.appendChild(button);

    /* ---------------------------------------------------------
       Modal
    --------------------------------------------------------- */

    const modal =
      document.createElement("div");

    modal.id = "live-event-modal";

    modal.innerHTML = `
      <div
        class="live-event-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-event-title"
      >

        <div class="live-event-modal-header">

          <div class="live-event-title-wrap">
            <h2 id="live-event-title">
              Report Live Event
            </h2>

            <p>
              Help BhuRakshak monitor ground conditions
              with a geo-tagged field report.
            </p>
          </div>

          <button
            id="live-event-close"
            type="button"
            aria-label="Close"
          >
            ×
          </button>

        </div>

        <div class="live-event-modal-body">

          <!-- Event Category -->
          <div class="live-event-field">

            <label for="live-event-category">
              Event Type
              <span class="live-event-required">*</span>
            </label>

            <select
              id="live-event-category"
              class="live-event-select"
            >
              <option value="">
                Select an event
              </option>

              <option value="crack">
                🧱 Ground / Road Crack
              </option>

              <option value="slope_movement">
                ⛰️ Slope Movement
              </option>

              <option value="blocked_road">
                🚧 Blocked Road
              </option>

              <option value="other">
                ⚠️ Other Hazard
              </option>
            </select>

          </div>

          <!-- Photo -->
          <div class="live-event-field">

            <label>
              Evidence Photo
              <span class="live-event-required">*</span>
            </label>

            <div
              id="live-event-upload"
              class="live-event-upload"
            >

              <div
                id="live-event-upload-content"
                class="live-event-upload-content"
              >

                <div class="live-event-upload-icon">
                  📷
                </div>

                <div class="live-event-upload-title">
                  Take a photo or choose from gallery
                </div>

                <div class="live-event-upload-subtitle">
                  JPG, PNG or other image • Max 10 MB
                </div>

              </div>

              <img
                id="live-event-preview"
                alt="Selected evidence preview"
              />

              <button
                id="live-event-remove-photo"
                class="live-event-remove-photo"
                type="button"
              >
                Remove
              </button>

              <input
                id="live-event-file-input"
                type="file"
                accept="image/*"
                capture="environment"
              />

            </div>

          </div>

          <!-- GPS -->
          <div class="live-event-field">

            <label>
              Event Location
              <span class="live-event-required">*</span>
            </label>

            <div class="live-event-location-row">

              <input
                id="live-event-lat"
                class="live-event-input"
                type="number"
                step="any"
                placeholder="Latitude"
                readonly
              />

              <input
                id="live-event-lon"
                class="live-event-input"
                type="number"
                step="any"
                placeholder="Longitude"
                readonly
              />

              <button
                id="live-event-gps-btn"
                class="live-event-gps-btn"
                type="button"
              >
                📍 Get GPS
              </button>

            </div>

            <div
              id="live-event-location-status"
              class="live-event-location-status"
            >
              Your location is required for a live event report.
            </div>

          </div>

          <!-- Description -->
          <div class="live-event-field">

            <label for="live-event-description">
              Description
            </label>

            <textarea
              id="live-event-description"
              class="live-event-textarea"
              maxlength="500"
              placeholder="Briefly describe what you observed..."
            ></textarea>

          </div>

          <!-- Submit -->
          <button
            id="live-event-submit"
            class="live-event-submit"
            type="button"
          >
            Submit Live Event
          </button>

          <div
            id="live-event-status"
            class="live-event-status"
          ></div>

          <div class="live-event-note">
            Reports are used to improve real-time
            landslide monitoring and community awareness.
          </div>

        </div>

      </div>
    `;

    document.body.appendChild(modal);
  }

  bindLiveEventEvents() {
    const openBtn =
      document.getElementById(
        "report-live-event-btn"
      );

    const modal =
      document.getElementById(
        "live-event-modal"
      );

    const closeBtn =
      document.getElementById(
        "live-event-close"
      );

    const upload =
      document.getElementById(
        "live-event-upload"
      );

    const fileInput =
      document.getElementById(
        "live-event-file-input"
      );

    const removePhotoBtn =
      document.getElementById(
        "live-event-remove-photo"
      );

    const gpsBtn =
      document.getElementById(
        "live-event-gps-btn"
      );

    const submitBtn =
      document.getElementById(
        "live-event-submit"
      );

    if (openBtn) {
      openBtn.addEventListener(
        "click",
        () => {
          this.openLiveEventModal();
        }
      );
    }

    if (closeBtn) {
      closeBtn.addEventListener(
        "click",
        () => {
          this.closeLiveEventModal();
        }
      );
    }

    // Clicking the dark overlay closes the modal
    if (modal) {
      modal.addEventListener(
        "click",
        (e) => {
          if (e.target === modal) {
            this.closeLiveEventModal();
          }
        }
      );
    }

    // ESC closes modal
    document.addEventListener(
      "keydown",
      (e) => {
        if (
          e.key === "Escape" &&
          modal &&
          modal.classList.contains("active")
        ) {
          this.closeLiveEventModal();
        }
      }
    );

    /* ---------------------------------------------------------
       Image upload
    --------------------------------------------------------- */

    if (upload && fileInput) {
      upload.addEventListener(
        "click",
        (e) => {
          if (
            e.target === removePhotoBtn
          ) {
            return;
          }

          fileInput.click();
        }
      );
    }

    if (fileInput) {
      fileInput.addEventListener(
        "change",
        (e) => {
          const file =
            e.target.files &&
            e.target.files[0];

          if (file) {
            this.handleLiveEventFile(
              file
            );
          }
        }
      );
    }

    if (removePhotoBtn) {
      removePhotoBtn.addEventListener(
        "click",
        (e) => {
          e.stopPropagation();
          this.removeLiveEventFile();
        }
      );
    }

    /* ---------------------------------------------------------
       GPS
    --------------------------------------------------------- */

    if (gpsBtn) {
      gpsBtn.addEventListener(
        "click",
        () => {
          this.getLiveEventGPS();
        }
      );
    }

    /* ---------------------------------------------------------
       Submit
    --------------------------------------------------------- */

    if (submitBtn) {
      submitBtn.addEventListener(
        "click",
        async () => {
          await this.submitLiveEvent();
        }
      );
    }
  }

  openLiveEventModal() {
    const modal =
      document.getElementById(
        "live-event-modal"
      );

    if (!modal) {
      return;
    }

    modal.classList.add("active");

    // Automatically try to acquire GPS
    // when the modal opens.
    this.getLiveEventGPS();
  }

  closeLiveEventModal() {
    const modal =
      document.getElementById(
        "live-event-modal"
      );

    if (!modal) {
      return;
    }

    modal.classList.remove("active");
  }

  /* ============================================================
     LIVE EVENT IMAGE HANDLING
     ============================================================ */

  handleLiveEventFile(file) {
    const status =
      document.getElementById(
        "live-event-status"
      );

    // Only images
    if (
      !file.type ||
      !file.type.startsWith("image/")
    ) {
      this.showLiveEventStatus(
        "Please select an image file.",
        "error"
      );

      return;
    }

    // 10 MB limit
    const maxSize =
      10 * 1024 * 1024;

    if (file.size > maxSize) {
      this.showLiveEventStatus(
        "Image is too large. Please choose an image smaller than 10 MB.",
        "error"
      );

      return;
    }

    this.liveEventFile = file;

    const preview =
      document.getElementById(
        "live-event-preview"
      );

    const uploadContent =
      document.getElementById(
        "live-event-upload-content"
      );

    const removeBtn =
      document.getElementById(
        "live-event-remove-photo"
      );

    if (preview) {
      const reader =
        new FileReader();

      reader.onload = (e) => {
        preview.src =
          e.target.result;

        preview.style.display =
          "block";
      };

      reader.readAsDataURL(file);
    }

    if (uploadContent) {
      uploadContent.style.display =
        "none";
    }

    if (removeBtn) {
      removeBtn.style.display =
        "block";
    }

    // Clear previous status
    if (status) {
      status.className =
        "live-event-status";

      status.style.display =
        "none";
    }
  }

  removeLiveEventFile() {
    this.liveEventFile = null;

    const fileInput =
      document.getElementById(
        "live-event-file-input"
      );

    const preview =
      document.getElementById(
        "live-event-preview"
      );

    const uploadContent =
      document.getElementById(
        "live-event-upload-content"
      );

    const removeBtn =
      document.getElementById(
        "live-event-remove-photo"
      );

    if (fileInput) {
      fileInput.value = "";
    }

    if (preview) {
      preview.src = "";
      preview.style.display =
        "none";
    }

    if (uploadContent) {
      uploadContent.style.display =
        "block";
    }

    if (removeBtn) {
      removeBtn.style.display =
        "none";
    }
  }

  /* ============================================================
     LIVE EVENT GPS
     ============================================================ */

  getLiveEventGPS() {
    const gpsBtn =
      document.getElementById(
        "live-event-gps-btn"
      );

    const latInput =
      document.getElementById(
        "live-event-lat"
      );

    const lonInput =
      document.getElementById(
        "live-event-lon"
      );

    const status =
      document.getElementById(
        "live-event-location-status"
      );

    if (!navigator.geolocation) {
      this.showLiveLocationStatus(
        "Geolocation is not supported by this browser.",
        "error"
      );

      return;
    }

    if (gpsBtn) {
      gpsBtn.disabled = true;
      gpsBtn.textContent =
        "📍 Acquiring...";
    }

    this.showLiveLocationStatus(
      "Requesting your current location..."
    );

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        this.liveEventLocation = {
          latitude,
          longitude
        };

        if (latInput) {
          latInput.value =
            latitude.toFixed(6);
        }

        if (lonInput) {
          lonInput.value =
            longitude.toFixed(6);
        }

        if (gpsBtn) {
          gpsBtn.disabled = false;
          gpsBtn.textContent =
            "✓ GPS Locked";
        }

        this.showLiveLocationStatus(
          `Location captured: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          "success"
        );
      },

      (error) => {
        this.liveEventLocation = null;

        if (gpsBtn) {
          gpsBtn.disabled = false;
          gpsBtn.textContent =
            "📍 Get GPS";
        }

        let message =
          "Could not acquire your location.";

        if (
          error.code ===
          error.PERMISSION_DENIED
        ) {
          message =
            "Location permission was denied. Please allow location access and try again.";
        } else if (
          error.code ===
          error.POSITION_UNAVAILABLE
        ) {
          message =
            "Your current location is unavailable. Please try again.";
        } else if (
          error.code ===
          error.TIMEOUT
        ) {
          message =
            "Location request timed out. Please try again.";
        }

        this.showLiveLocationStatus(
          message,
          "error"
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  }

  showLiveLocationStatus(
    message,
    type = ""
  ) {
    const status =
      document.getElementById(
        "live-event-location-status"
      );

    if (!status) {
      return;
    }

    status.textContent = message;

    status.className =
      "live-event-location-status";

    if (type) {
      status.classList.add(type);
    }
  }

  /* ============================================================
     LIVE EVENT SUBMISSION
     ============================================================ */

  async submitLiveEvent() {
    if (this.liveEventSubmitting) {
      return;
    }

    const category =
      document.getElementById(
        "live-event-category"
      )?.value;

    const description =
      document.getElementById(
        "live-event-description"
      )?.value.trim();

    const submitBtn =
      document.getElementById(
        "live-event-submit"
      );

    // Validate category
    if (!category) {
      this.showLiveEventStatus(
        "Please select the type of event you observed.",
        "error"
      );

      return;
    }

    // Validate photo
    if (!this.liveEventFile) {
      this.showLiveEventStatus(
        "Please take or select an evidence photo.",
        "error"
      );

      return;
    }

    // Validate GPS
    if (
      !this.liveEventLocation ||
      typeof this.liveEventLocation.latitude !==
      "number" ||
      typeof this.liveEventLocation.longitude !==
      "number"
    ) {
      this.showLiveEventStatus(
        "Your current GPS location is required. Please tap 'Get GPS' and try again.",
        "error"
      );

      return;
    }

    this.liveEventSubmitting = true;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent =
        "Submitting Report...";
    }

    try {
      const formData =
        new FormData();

      formData.append(
        "latitude",
        this.liveEventLocation.latitude
      );

      formData.append(
        "longitude",
        this.liveEventLocation.longitude
      );

      formData.append(
        "category",
        category
      );

      formData.append(
        "description",
        description || ""
      );

      formData.append(
        "media",
        this.liveEventFile
      );

      /*
       * Uses the existing API method from api.js:
       * window.api.submitFieldReport(formData)
       */
      const saved =
        await window.api.submitFieldReport(
          formData
        );

      if (saved && saved.isLocal) {
        this.showLiveEventStatus(
          `✓ Report #${saved.report_id} saved locally. It will be available in this browser.`,
          "success"
        );
      } else {
        this.showLiveEventStatus(
          `✓ Report #${saved.report_id} successfully submitted and geotagged.`,
          "success"
        );
      }

      // Refresh community feed
      await this.loadReportsFeed();

      // Refresh map markers
      if (
        window.bhuMap &&
        typeof window.bhuMap
          .loadFieldReportMarkers ===
        "function"
      ) {
        window.bhuMap.loadFieldReportMarkers();
      }

      // Reset after successful submission
      setTimeout(() => {
        this.resetLiveEventForm();
        this.closeLiveEventModal();
      }, 1800);

    } catch (error) {
      console.error(
        "Live event submission failed:",
        error
      );

      this.showLiveEventStatus(
        "Report submission failed: " +
        (error.message ||
          "Unknown error"),
        "error"
      );

    } finally {
      this.liveEventSubmitting = false;

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent =
          "Submit Live Event";
      }
    }
  }

  resetLiveEventForm() {
    const category =
      document.getElementById(
        "live-event-category"
      );

    const description =
      document.getElementById(
        "live-event-description"
      );

    const lat =
      document.getElementById(
        "live-event-lat"
      );

    const lon =
      document.getElementById(
        "live-event-lon"
      );

    const gpsBtn =
      document.getElementById(
        "live-event-gps-btn"
      );

    const status =
      document.getElementById(
        "live-event-status"
      );

    if (category) {
      category.value = "";
    }

    if (description) {
      description.value = "";
    }

    if (lat) {
      lat.value = "";
    }

    if (lon) {
      lon.value = "";
    }

    if (gpsBtn) {
      gpsBtn.textContent =
        "📍 Get GPS";
      gpsBtn.disabled = false;
    }

    this.liveEventLocation = null;

    this.removeLiveEventFile();

    if (status) {
      status.textContent = "";
      status.className =
        "live-event-status";
      status.style.display =
        "none";
    }

    this.showLiveLocationStatus(
      "Your location is required for a live event report."
    );
  }

  showLiveEventStatus(
    message,
    type
  ) {
    const status =
      document.getElementById(
        "live-event-status"
      );

    if (!status) {
      return;
    }

    status.textContent = message;

    status.className =
      "live-event-status";

    if (type) {
      status.classList.add(type);
    }

    status.style.display =
      "block";
  }

  /* ============================================================
     EXISTING REPORT FEED
     ============================================================ */

  async loadReportsFeed() {
    const feedContainer =
      document.getElementById(
        "reports-feed-container"
      );

    if (!feedContainer) {
      return;
    }

    try {
      this.reports =
        await window.api.getFieldReports();

      this.renderReportsFeed();

    } catch (e) {
      console.error(
        "Failed to load reports feed:",
        e
      );
    }
  }

  renderReportsFeed() {
    const feedContainer =
      document.getElementById(
        "reports-feed-container"
      );

    const countEl =
      document.getElementById(
        "reports-count-badge"
      );

    const categoryFilter =
      document.getElementById(
        "report-category-filter"
      );

    if (!feedContainer) {
      return;
    }

    const filterVal =
      categoryFilter
        ? categoryFilter.value
        : "all";

    const filtered =
      filterVal === "all"
        ? this.reports
        : this.reports.filter(
          (r) =>
            r.category ===
            filterVal
        );

    if (countEl) {
      countEl.textContent =
        `${filtered.length} Reports`;
    }

    feedContainer.innerHTML = "";

    if (filtered.length === 0) {
      feedContainer.innerHTML = `
        <div
          style="
            grid-column: 1/-1;
            text-align:center;
            padding:30px;
            color:#94a3b8;
          "
        >
          No reports in this category yet.
        </div>
      `;

      return;
    }

    filtered.forEach((report) => {
      const card =
        document.createElement("div");

      card.className =
        "report-card";

      const timeAgo =
        this._formatTimeAgo(
          new Date(
            report.submitted_at
          )
        );

      const catLabel =
        report.category
          .replace("_", " ")
          .toUpperCase();

      card.innerHTML = `
        <img
          class="report-media-thumb"
          src="${report.media_url}"
          alt="${catLabel}"
          onclick="window.reportsPortal.openLightbox('${report.media_url}', '${catLabel}')"
          onerror="this.src='assets/sample_crack.jpg'"
        />

        <div class="report-card-body">

          <div>

            <div
              style="
                display:flex;
                justify-content:space-between;
                align-items:flex-start;
                margin-bottom:6px;
              "
            >

              <span
                class="report-category-pill"
              >
                ${catLabel}
              </span>

              <span
                style="
                  font-size:11px;
                  color:#64748b;
                "
              >
                ${timeAgo}
              </span>

            </div>

            <p
              style="
                font-size:12px;
                color:#cbd5e1;
                line-height:1.45;
                margin-bottom:10px;
              "
            >
              ${report.description ||
        "No description provided."
        }
            </p>

          </div>

          <div
            style="
              border-top:
                1px solid
                rgba(255,255,255,0.06);

              padding-top:8px;

              display:flex;
              justify-content:space-between;
              align-items:center;
            "
          >

            <span
              style="
                font-family:'JetBrains Mono',monospace;
                font-size:11px;
                color:#38bdf8;
              "
            >
              ${report.latitude.toFixed(4)}°N,
              ${report.longitude.toFixed(4)}°E
            </span>

            <button
              onclick="
                window.reportsPortal.locateOnMap(
                  ${report.latitude},
                  ${report.longitude}
                )
              "
              style="
                background:none;
                border:none;
                color:#06b6d4;
                font-size:11px;
                font-weight:600;
                cursor:pointer;
              "
            >
              View on Map &rarr;
            </button>

          </div>

        </div>
      `;

      feedContainer.appendChild(card);
    });
  }

  /* ============================================================
     EXISTING MAP NAVIGATION
     ============================================================ */

  locateOnMap(lat, lon) {
    if (
      window.app &&
      window.app.switchTab
    ) {
      window.app.switchTab("map");

      if (window.bhuMap) {
        window.bhuMap.flyTo(
          lat,
          lon,
          12
        );
      }
    }
  }

  /* ============================================================
     EXISTING LIGHTBOX
     ============================================================ */

  openLightbox(src, title) {
    const modal =
      document.getElementById(
        "lightbox-modal"
      );

    const img =
      document.getElementById(
        "lightbox-img"
      );

    const caption =
      document.getElementById(
        "lightbox-caption"
      );

    if (modal && img) {
      img.src = src;

      if (caption) {
        caption.textContent =
          title;
      }

      modal.classList.add(
        "active"
      );
    }
  }

  /* ============================================================
     EXISTING TIME FORMATTER
     ============================================================ */

  _formatTimeAgo(date) {
    const diff =
      Math.floor(
        (Date.now() -
          date.getTime()) /
        1000
      );

    if (diff < 60) {
      return "Just now";
    }

    if (diff < 3600) {
      return `${Math.floor(
        diff / 60
      )}m ago`;
    }

    if (diff < 86400) {
      return `${Math.floor(
        diff / 3600
      )}h ago`;
    }

    return `${Math.floor(
      diff / 86400
    )}d ago`;
  }
}

/* ================================================================
   GLOBAL INSTANCE
   ================================================================ */

window.reportsPortal =
  new FieldReportsPortal();