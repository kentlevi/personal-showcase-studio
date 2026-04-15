import { PreviewExportService } from "./export-service.js";

const STORAGE_KEY = "showcase-studio-editor-mvp";
const BASE_DURATION = 6;

class EditorStateService {
  constructor() {
    this.state = {
      projectName: "Unified Workspace Editor",
      assets: [],
      selectedAssetId: null,
      selectedAssetSnapshot: null,
      cornerRadius: 24,
      animationType: "scroll",
      selectedPreset: "scroll",
      speed: 1,
      currentTime: 0,
      duration: BASE_DURATION,
      progress: 0,
      isPlaying: false,
      previewMode: false,
      exportFps: 30,
      isExporting: false,
    };
    this.subscribers = new Set();
    this.loadSettings();
    this.syncPlaybackState();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.state);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    for (const callback of this.subscribers) {
      callback(this.state);
    }
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.syncPlaybackState();
    this.notify();
  }

  syncPlaybackState() {
    const duration = Math.max(BASE_DURATION / this.state.speed, 0.001);
    const currentTime = Math.min(Math.max(this.state.currentTime, 0), duration);
    const progress = duration > 0 ? currentTime / duration : 0;

    this.state.duration = duration;
    this.state.currentTime = currentTime;
    this.state.progress = progress;
    this.state.selectedPreset = this.state.animationType;
  }

  addAssets(files) {
    if (this.state.isExporting) {
      return;
    }

    const incoming = files
      .filter((file) => file.type.startsWith("image/"))
      .map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        size: file.size,
        objectUrl: URL.createObjectURL(file),
      }));

    if (!incoming.length) {
      return;
    }

    let selectedAssetId = this.state.selectedAssetId ?? incoming[0].id;

    if (!this.getSelectedAsset() && this.state.selectedAssetSnapshot) {
      const matched = incoming.find((asset) => (
        asset.name === this.state.selectedAssetSnapshot.name &&
        asset.size === this.state.selectedAssetSnapshot.size
      ));

      if (matched) {
        selectedAssetId = matched.id;
      }
    }

    this.setState({
      assets: [...this.state.assets, ...incoming],
      selectedAssetId,
      currentTime: 0,
      isPlaying: false,
    });
  }

  selectAsset(id) {
    if (this.state.isExporting) {
      return;
    }

    const selectedAsset = this.state.assets.find((asset) => asset.id === id) ?? null;
    this.setState({
      selectedAssetId: id,
      selectedAssetSnapshot: selectedAsset
        ? {
            id: selectedAsset.id,
            name: selectedAsset.name,
            size: selectedAsset.size,
          }
        : this.state.selectedAssetSnapshot,
      currentTime: 0,
      isPlaying: false,
    });
  }

  setCornerRadius(value) {
    if (this.state.isExporting) {
      return;
    }

    this.setState({ cornerRadius: value });
  }

  setAnimationType(value) {
    if (this.state.isExporting) {
      return;
    }

    this.setState({
      animationType: value,
      currentTime: 0,
    });
  }

  setSpeed(value) {
    if (this.state.isExporting) {
      return;
    }

    const nextSpeed = Math.min(Math.max(value, 0.5), 2);
    const progress = this.state.progress;
    const nextDuration = BASE_DURATION / nextSpeed;

    this.setState({
      speed: nextSpeed,
      currentTime: progress * nextDuration,
    });
  }

  setCurrentTime(value) {
    if (this.state.isExporting) {
      return;
    }

    this.setState({ currentTime: value });
  }

  setProgress(value) {
    if (this.state.isExporting) {
      return;
    }

    const progress = Math.min(Math.max(value, 0), 1);
    this.setState({
      currentTime: progress * this.state.duration,
    });
  }

  togglePlayback() {
    if (this.state.isExporting) {
      return;
    }

    if (!this.state.isPlaying && this.state.currentTime >= this.state.duration) {
      this.setState({
        currentTime: 0,
        isPlaying: true,
      });
      return;
    }

    this.setState({ isPlaying: !this.state.isPlaying });
  }

  restart() {
    if (this.state.isExporting) {
      return;
    }

    this.setState({
      currentTime: 0,
      isPlaying: false,
    });
  }

  togglePreviewMode() {
    if (this.state.isExporting) {
      return;
    }

    this.setState({ previewMode: !this.state.previewMode });
  }

  setExporting(value) {
    this.setState({
      isExporting: value,
      isPlaying: value ? false : this.state.isPlaying,
    });
  }

  getSelectedAsset() {
    return this.state.assets.find((asset) => asset.id === this.state.selectedAssetId) ?? null;
  }

  saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      projectName: this.state.projectName,
      cornerRadius: this.state.cornerRadius,
      animationType: this.state.animationType,
      selectedPreset: this.state.selectedPreset,
      speed: this.state.speed,
      duration: this.state.duration,
      currentTime: this.state.currentTime,
      previewMode: this.state.previewMode,
      exportFps: this.state.exportFps,
      selectedAssetId: this.state.selectedAssetId,
      selectedAssetSnapshot: this.state.selectedAssetSnapshot,
    }));
  }

  loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      this.state.projectName = typeof parsed.projectName === "string" ? parsed.projectName : this.state.projectName;
      this.state.cornerRadius = typeof parsed.cornerRadius === "number" ? parsed.cornerRadius : this.state.cornerRadius;
      this.state.animationType = parsed.animationType === "zoom" ? "zoom" : "scroll";
      this.state.speed = typeof parsed.speed === "number" ? parsed.speed : this.state.speed;
      this.state.currentTime = typeof parsed.currentTime === "number" ? parsed.currentTime : this.state.currentTime;
      this.state.previewMode = Boolean(parsed.previewMode);
      this.state.exportFps = typeof parsed.exportFps === "number" ? parsed.exportFps : this.state.exportFps;
      this.state.selectedAssetId = typeof parsed.selectedAssetId === "string" ? parsed.selectedAssetId : null;
      this.state.selectedAssetSnapshot = parsed.selectedAssetSnapshot && typeof parsed.selectedAssetSnapshot === "object"
        ? parsed.selectedAssetSnapshot
        : null;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

class AssetPanel {
  constructor(state) {
    this.state = state;
    this.projectName = document.querySelector("[data-project-name]");
    this.input = document.querySelector("#image-input");
    this.assetList = document.querySelector("[data-asset-list]");
    this.assetCount = document.querySelector("[data-asset-count]");
    this.statusCopy = document.querySelector("[data-status-copy]");
    this.selectedName = document.querySelector("[data-selected-name]");
    this.saveButton = document.querySelector("[data-save-project]");
    this.previewButton = document.querySelector("[data-toggle-preview]");

    this.input?.addEventListener("change", (event) => {
      this.state.addAssets(Array.from(event.target.files ?? []));
      event.target.value = "";
    });

    this.saveButton?.addEventListener("click", () => {
      this.state.saveSettings();
      this.saveButton.classList.add("is-saved");

      window.setTimeout(() => {
        this.saveButton?.classList.remove("is-saved");
      }, 1400);

      if (this.statusCopy) {
        this.statusCopy.textContent = "Project saved locally. Re-import images after refresh if they were uploaded from this device.";
      }
    });

    this.previewButton?.addEventListener("click", () => {
      this.state.togglePreviewMode();
    });

    this.state.subscribe((currentState) => this.render(currentState));
  }

  render(currentState) {
    const selected = this.state.getSelectedAsset();
    const hasMissingSavedAsset = !selected && currentState.selectedAssetSnapshot;

    if (this.projectName) {
      this.projectName.textContent = currentState.projectName;
    }

    if (this.assetCount) {
      this.assetCount.textContent = String(currentState.assets.length);
    }

    if (this.selectedName) {
      this.selectedName.textContent = selected?.name
        ?? (hasMissingSavedAsset ? `${currentState.selectedAssetSnapshot.name} (re-import needed)` : "No image selected");
    }

    if (this.previewButton) {
      this.previewButton.classList.toggle("is-active", currentState.previewMode);
      this.previewButton.disabled = currentState.isExporting;
    }

    if (this.input) {
      this.input.disabled = currentState.isExporting;
    }

    if (this.statusCopy) {
      if (selected) {
        this.statusCopy.textContent = `${selected.name} selected. ${currentState.selectedPreset === "zoom" ? "Zoom" : "Scroll"} preset at ${currentState.speed.toFixed(1)}x speed.`;
      } else if (hasMissingSavedAsset) {
        this.statusCopy.textContent = `Last project restored. Re-import "${currentState.selectedAssetSnapshot.name}" to resume previewing it.`;
      } else {
        this.statusCopy.textContent = "No image selected.";
      }
    }

    if (!this.assetList) {
      return;
    }

    if (!currentState.assets.length) {
      this.assetList.innerHTML = `<div class="asset-empty">Import one or more images to begin building your showcase.</div>`;
      return;
    }

    this.assetList.innerHTML = "";

    for (const asset of currentState.assets) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `asset-item${asset.id === currentState.selectedAssetId ? " is-selected" : ""}`;
      item.innerHTML = `
        <span class="asset-thumb"><img src="${asset.objectUrl}" alt=""></span>
        <span class="asset-meta">
          <strong>${asset.name}</strong>
          <span>${this.formatSize(asset.size)}</span>
        </span>
        <span class="asset-duration">${asset.id === currentState.selectedAssetId ? "Selected" : "View"}</span>
      `;
      item.disabled = currentState.isExporting;
      item.addEventListener("click", () => this.state.selectAsset(asset.id));
      this.assetList.appendChild(item);
    }
  }

  formatSize(bytes) {
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

class ControlsPanel {
  constructor(state) {
    this.state = state;
    this.radiusSlider = document.querySelector("[data-radius-slider]");
    this.radiusValue = document.querySelector("[data-radius-value]");
    this.speedSlider = document.querySelector("[data-speed-slider]");
    this.speedValue = document.querySelector("[data-speed-value]");
    this.animationLabel = document.querySelector("[data-animation-label]");
    this.presetButtons = Array.from(document.querySelectorAll("[data-animation]"));

    this.radiusSlider?.addEventListener("input", (event) => {
      this.state.setCornerRadius(Number(event.target.value));
    });

    this.speedSlider?.addEventListener("input", (event) => {
      this.state.setSpeed(Number(event.target.value));
    });

    this.presetButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.setAnimationType(button.dataset.animation));
    });

    this.state.subscribe((currentState) => {
      if (this.radiusSlider) this.radiusSlider.value = String(currentState.cornerRadius);
      if (this.radiusSlider) this.radiusSlider.disabled = currentState.isExporting;
      if (this.radiusValue) this.radiusValue.textContent = `${currentState.cornerRadius}px`;
      if (this.speedSlider) this.speedSlider.value = String(currentState.speed);
      if (this.speedSlider) this.speedSlider.disabled = currentState.isExporting;
      if (this.speedValue) this.speedValue.textContent = `${currentState.speed.toFixed(1)}x`;
      if (this.animationLabel) this.animationLabel.textContent = currentState.selectedPreset === "zoom" ? "Zoom preset" : "Scroll preset";

      this.presetButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.animation === currentState.selectedPreset);
        button.disabled = currentState.isExporting;
      });
    });
  }
}

class PreviewStage {
  constructor(state) {
    this.state = state;
    this.previewScreen = document.querySelector(".preview-screen");
    this.viewport = document.querySelector("[data-image-viewport]");
    this.image = document.querySelector("[data-preview-image]");
    this.placeholder = document.querySelector("[data-preview-placeholder]");
    this.previewMessage = document.querySelector("[data-preview-message]");
    this.resizeObserver = null;
    this.metrics = null;

    this.image?.addEventListener("load", () => this.render(this.state.state));
    window.addEventListener("resize", () => this.render(this.state.state));

    if (this.viewport && "ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => this.render(this.state.state));
      this.resizeObserver.observe(this.viewport);
    }

    this.state.subscribe((currentState) => this.render(currentState));
  }

  getExportSnapshot() {
    const asset = this.state.getSelectedAsset();

    if (!asset || !this.metrics || !this.previewScreen || !this.viewport) {
      return null;
    }

    const previewBrowser = this.previewScreen.querySelector(".preview-browser");
    const browserTop = this.previewScreen.querySelector(".browser-top");
    const brandMini = this.previewScreen.querySelector(".brand-mini");
    const browserLinks = Array.from(this.previewScreen.querySelectorAll(".browser-links span"));
    const browserActions = Array.from(this.previewScreen.querySelectorAll(".browser-actions span"));
    const laptopBase = this.previewScreen.querySelector(".laptop-base");

    if (!previewBrowser || !browserTop || !brandMini || !laptopBase) {
      return null;
    }

    return {
      asset,
      metrics: {
        ...this.metrics,
        cornerRadius: this.state.state.cornerRadius,
      },
      previewMode: this.state.state.previewMode,
      screenRect: this.previewScreen.getBoundingClientRect(),
      browserRect: previewBrowser.getBoundingClientRect(),
      browserTopRect: browserTop.getBoundingClientRect(),
      brandRect: brandMini.getBoundingClientRect(),
      linkRects: browserLinks.map((element) => element.getBoundingClientRect()),
      actionRects: browserActions.map((element) => element.getBoundingClientRect()),
      viewportRect: this.viewport.getBoundingClientRect(),
      baseRect: laptopBase.getBoundingClientRect(),
    };
  }

  render(currentState) {
    const selected = this.state.getSelectedAsset();

    if (this.viewport) {
      this.viewport.style.borderRadius = `${currentState.cornerRadius}px`;
    }

    this.previewScreen?.classList.toggle("preview-mode", currentState.previewMode);

    if (!selected || !this.image || !this.placeholder) {
      if (this.image) this.image.hidden = true;
      if (this.placeholder) this.placeholder.hidden = false;
      if (this.previewMessage) {
        this.previewMessage.textContent = currentState.selectedAssetSnapshot
          ? `Saved project restored. Re-import "${currentState.selectedAssetSnapshot.name}" to display it inside the preview.`
          : "Import an image to preview your cinematic showcase.";
      }
      this.metrics = null;
      return;
    }

    if (this.image.src !== selected.objectUrl) {
      this.image.src = selected.objectUrl;
    }

    this.image.hidden = false;
    this.placeholder.hidden = true;

    if (!this.image.complete || !this.image.naturalWidth || !this.image.naturalHeight || !this.viewport) {
      return;
    }

    const naturalWidth = this.image.naturalWidth;
    const naturalHeight = this.image.naturalHeight;
    const viewportWidth = this.viewport.clientWidth;
    const viewportHeight = this.viewport.clientHeight;
    const progress = currentState.progress;

    if (!viewportWidth || !viewportHeight) {
      return;
    }

    if (currentState.animationType === "zoom") {
      const coverScale = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
      const animatedScale = coverScale * (1.01 + progress * 0.11);
      const renderedWidth = naturalWidth * animatedScale;
      const renderedHeight = naturalHeight * animatedScale;
      const offsetLeft = (viewportWidth - renderedWidth) / 2;
      const offsetTop = (viewportHeight - renderedHeight) / 2;

      this.applyImageLayout({
        naturalWidth,
        naturalHeight,
        viewportWidth,
        viewportHeight,
        renderedWidth,
        renderedHeight,
        offsetLeft,
        offsetTop,
        movementY: 0,
      });
      return;
    }

    const widthScale = viewportWidth / naturalWidth;
    const renderedWidth = viewportWidth;
    const renderedHeight = naturalHeight * widthScale;
    const maxScrollDistance = Math.max(renderedHeight - viewportHeight, 0);
    const movementY = maxScrollDistance > 0 ? progress * maxScrollDistance : 0;
    const offsetLeft = (viewportWidth - renderedWidth) / 2;
    const offsetTop = maxScrollDistance > 0
      ? -movementY
      : (viewportHeight - renderedHeight) / 2;

    this.applyImageLayout({
      naturalWidth,
      naturalHeight,
      viewportWidth,
      viewportHeight,
      renderedWidth,
      renderedHeight,
      offsetLeft,
      offsetTop,
      movementY,
    });
  }

  applyImageLayout(metrics) {
    this.metrics = metrics;

    this.image.style.width = `${metrics.renderedWidth}px`;
    this.image.style.height = `${metrics.renderedHeight}px`;
    this.image.style.left = `${metrics.offsetLeft}px`;
    this.image.style.top = `${metrics.offsetTop}px`;
    this.image.style.transform = "translate3d(0, 0, 0)";

    this.viewport.dataset.naturalWidth = String(metrics.naturalWidth);
    this.viewport.dataset.naturalHeight = String(metrics.naturalHeight);
    this.viewport.dataset.renderedWidth = String(Math.round(metrics.renderedWidth));
    this.viewport.dataset.renderedHeight = String(Math.round(metrics.renderedHeight));
    this.viewport.dataset.viewportWidth = String(Math.round(metrics.viewportWidth));
    this.viewport.dataset.viewportHeight = String(Math.round(metrics.viewportHeight));
    this.viewport.dataset.maxScrollDistance = String(Math.round(Math.max(metrics.renderedHeight - metrics.viewportHeight, 0)));
  }
}

class TimelineBar {
  constructor(state) {
    this.state = state;
    this.slider = document.querySelector("[data-timeline-slider]");
    this.progress = document.querySelector("[data-timeline-progress]");
    this.currentTime = document.querySelector("[data-current-time]");
    this.totalTime = document.querySelector("[data-total-time]");
    this.playButton = document.querySelector("[data-toggle-play]");
    this.restartButton = document.querySelector("[data-restart]");
    this.playIcon = document.querySelector("[data-play-icon]");
    this.pauseIcon = document.querySelector("[data-pause-icon]");
    this.scrubbing = false;

    this.slider?.addEventListener("input", (event) => {
      this.scrubbing = true;
      this.state.setCurrentTime(Number(event.target.value));
    });

    this.slider?.addEventListener("change", () => {
      this.scrubbing = false;
    });

    this.playButton?.addEventListener("click", () => {
      if (this.state.getSelectedAsset()) {
        this.state.togglePlayback();
      }
    });

    this.restartButton?.addEventListener("click", () => this.state.restart());

    this.state.subscribe((currentState) => {
      const ratio = currentState.progress;

      if (this.slider && !this.scrubbing) {
        this.slider.max = currentState.duration.toFixed(3);
        this.slider.value = currentState.currentTime.toFixed(3);
        this.slider.disabled = currentState.isExporting;
      }

      if (this.progress) {
        this.progress.style.width = `${ratio * 100}%`;
      }

      if (this.currentTime) {
        this.currentTime.textContent = `${currentState.currentTime.toFixed(2)}s`;
      }

      if (this.totalTime) {
        this.totalTime.textContent = `${currentState.duration.toFixed(2)}s`;
      }

      if (this.playIcon && this.pauseIcon) {
        this.playIcon.hidden = currentState.isPlaying;
        this.pauseIcon.hidden = !currentState.isPlaying;
      }

      if (this.playButton) {
        this.playButton.disabled = currentState.isExporting;
      }

      if (this.restartButton) {
        this.restartButton.disabled = currentState.isExporting;
      }
    });
  }
}

class PlaybackController {
  constructor(state) {
    this.state = state;
    this.lastFrame = 0;
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  tick(timestamp) {
    if (!this.lastFrame) {
      this.lastFrame = timestamp;
    }

    const delta = (timestamp - this.lastFrame) / 1000;
    this.lastFrame = timestamp;

    if (this.state.state.isPlaying && this.state.getSelectedAsset()) {
      const nextTime = this.state.state.currentTime + delta;

      if (nextTime >= this.state.state.duration) {
        this.state.setState({
          currentTime: this.state.state.duration,
          isPlaying: false,
        });
      } else {
        this.state.setCurrentTime(nextTime);
      }
    }

    requestAnimationFrame(this.tick);
  }
}

class ExportController {
  constructor(state, previewStage) {
    this.state = state;
    this.previewStage = previewStage;
    this.exportService = new PreviewExportService();
    this.button = document.querySelector("[data-export-frame]");
    this.label = document.querySelector("[data-export-label]");
    this.statusCopy = document.querySelector("[data-status-copy]");

    this.button?.addEventListener("click", () => {
      this.handleExport();
    });

    this.state.subscribe((currentState) => this.render(currentState));
  }

  render(currentState) {
    if (!this.button) {
      return;
    }

    const canExport = Boolean(this.state.getSelectedAsset() && this.previewStage.metrics);
    this.button.disabled = currentState.isExporting || !canExport;
    this.button.setAttribute("aria-disabled", String(this.button.disabled));

    if (this.label && !currentState.isExporting) {
      this.label.textContent = "Export PNG Sequence";
    }

    if (!canExport && !currentState.isExporting) {
      this.button.title = "Import and preview an image before exporting.";
    } else {
      this.button.removeAttribute("title");
    }

    if (currentState.isPlaying && this.button.disabled && !currentState.isExporting && this.label) {
      this.label.textContent = "Export PNG Sequence";
    }
  }

  async handleExport() {
    if (!this.button || this.state.state.isExporting) {
      return;
    }

    if (!this.state.getSelectedAsset() || !this.previewStage.metrics) {
      if (this.statusCopy) {
        this.statusCopy.textContent = "Import and preview an image before exporting a PNG sequence.";
      }
      return;
    }

    this.state.setExporting(true);
    this.button.classList.add("is-loading");
    this.button.disabled = true;
    this.button.setAttribute("aria-disabled", "true");

    if (this.label) {
      this.label.textContent = "Exporting Frames...";
    }

    try {
      const result = await this.exportService.exportFrameSequence({
        previewStage: this.previewStage,
        state: this.state.state,
        fps: this.state.state.exportFps,
        onProgress: ({ currentFrame, totalFrames }) => {
          if (this.label) {
            this.label.textContent = `Exporting ${currentFrame}/${totalFrames}`;
          }

          if (this.statusCopy) {
            this.statusCopy.textContent = `Exporting frame ${currentFrame} of ${totalFrames} at ${this.state.state.exportFps} FPS.`;
          }
        },
      });

      this.button.classList.add("is-saved");

      if (this.label) {
        this.label.textContent = "ZIP Downloaded";
      }

      if (this.statusCopy) {
        this.statusCopy.textContent = `${result.totalFrames} PNG frames exported as a ZIP from the current preview stage.`;
      }

      window.setTimeout(() => {
        this.button?.classList.remove("is-saved");

        if (!this.state.state.isExporting && this.label) {
          this.label.textContent = "Export PNG Sequence";
        }
      }, 1400);
    } catch (error) {
      if (this.statusCopy) {
        this.statusCopy.textContent = error instanceof Error
          ? error.message
          : "PNG export failed. Try again after the preview finishes rendering.";
      }

      if (this.label) {
        this.label.textContent = "Export PNG Sequence";
      }
    } finally {
      this.state.setExporting(false);
      this.button.classList.remove("is-loading");
      this.render(this.state.state);
    }
  }
}

const state = new EditorStateService();
new AssetPanel(state);
new ControlsPanel(state);
const previewStage = new PreviewStage(state);
new TimelineBar(state);
new PlaybackController(state);
new ExportController(state, previewStage);
