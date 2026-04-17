import { PreviewExportService, calculateMotionLayout } from "./export-service.js";

const STORAGE_KEY = "showcase-studio-editor-mvp";
const BASE_DURATION = 6;

export const DEVICE_FRAMES = {
  browser: { label: "Browser", shape: "landscape" },
  laptop: { label: "Laptop", shape: "landscape" },
  phone: { label: "Mobile", shape: "portrait" },
  frameless: { label: "Frameless", shape: "flexible" }
};

export const PRESETS = {
  websiteScroll: {
    animationType: "scroll",
    speed: 1.0,
    cornerRadius: 24,
    background: { mode: 'gradient', color: '#1a1a1a', gradient: ['#f5f7fa', '#c3cfe2'], glowIntensity: 0.18 },
    effects: { depth: true, vignette: false }
  },
  heroZoom: {
    animationType: "zoom",
    speed: 1.2,
    cornerRadius: 16,
    background: { mode: 'glow', color: '#1a1a1a', gradient: ['#20232d', '#c0c4cf'], glowIntensity: 0.25 },
    effects: { depth: true, vignette: true }
  },
  mobileDemo: {
    animationType: "scroll",
    speed: 1.5,
    cornerRadius: 48,
    background: { mode: 'solid', color: '#090a0f', gradient: ['#20232d', '#c0c4cf'], glowIntensity: 0.18 },
    effects: { depth: false, vignette: false }
  },
  cinematicReveal: {
    animationType: "zoom",
    speed: 0.8,
    cornerRadius: 12,
    background: { mode: 'glow', color: '#050505', gradient: ['#0f2027', '#203a43'], glowIntensity: 0.4 },
    effects: { depth: true, vignette: true }
  }
};

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
      exportResolution: 1080,
      isExporting: false,
      activePresetId: null,
      deviceFrame: "browser",
      background: { mode: 'glow', color: '#1a1a1a', gradient: ['#20232d', '#c0c4cf'], glowIntensity: 0.18 },
      effects: { depth: true, vignette: true },
      scrollPauses: [],
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
    const EASE_DUR = 0.18; // Easing in and out each take 0.18s
    const baseMotionDuration = Math.max(4, BASE_DURATION / this.state.speed);
    const holdDuration = this.state.scrollPauses.reduce((sum, p) => sum + (p.duration || 0), 0);
    const easingOverhead = this.state.scrollPauses.length * (EASE_DUR * 2);
    const effectiveDuration = baseMotionDuration + holdDuration + easingOverhead;

    const currentTime = Math.min(Math.max(this.state.currentTime, 0), effectiveDuration);
    const progress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;

    this.state.duration = effectiveDuration;
    this.state.baseMotionDuration = baseMotionDuration;
    this.state.totalPauseDuration = holdDuration + easingOverhead;
    this.state.currentTime = currentTime;
    this.state.progress = progress;
    this.state.selectedPreset = this.state.animationType;

    if (this.state.scrollPauses.length > 0) {
      console.info(`[ShowcaseStudio] Cinematic Timing: Motion(${baseMotionDuration.toFixed(2)}s) + Holds(${holdDuration.toFixed(2)}s) + Easing(${easingOverhead.toFixed(2)}s) = Total(${effectiveDuration.toFixed(2)}s)`);
    }
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

  addScrollPause(progress = 0.5, duration = 0.5) {
    const newPause = {
      id: `pause-${Date.now()}`,
      progress: Math.min(Math.max(progress, 0), 1),
      duration: Math.min(Math.max(duration, 0.1), 10.0), // Allow up to 10 seconds hold
    };

    this.setState({
      scrollPauses: [...this.state.scrollPauses, newPause]
    });
  }

  updateScrollPause(id, updates) {
    this.setState({
      scrollPauses: this.state.scrollPauses.map(p => 
        p.id === id ? { ...p, ...updates } : p
      )
    });
  }

  removeScrollPause(id) {
    this.setState({
      scrollPauses: this.state.scrollPauses.filter(p => p.id !== id)
    });
  }

  applyPreset(presetId) {
    if (this.state.isExporting) {
      return;
    }
    const preset = PRESETS[presetId];
    if (preset) {
      this.setState({
        ...preset,
        activePresetId: presetId,
        currentTime: 0,
        isPlaying: false,
      });
    }
  }

  setCornerRadius(value) {
    if (this.state.isExporting) {
      return;
    }

    this.setState({ cornerRadius: value, activePresetId: null });
  }

  setAnimationType(value) {
    if (this.state.isExporting) {
      return;
    }

    this.setState({
      animationType: value,
      currentTime: 0,
      activePresetId: null,
    });
  }

  setDeviceFrame(value) {
    if (this.state.isExporting) {
      return;
    }
    
    if (DEVICE_FRAMES[value]) {
      this.setState({
        deviceFrame: value,
        activePresetId: null,
      });
    }
  }

  setExportResolution(value) {
    if (this.state.isExporting) return;
    this.setState({ exportResolution: Number(value) });
  }

  setExportFps(value) {
    if (this.state.isExporting) return;
    this.setState({ exportFps: Number(value) });
  }

  setSpeed(value) {
    if (this.state.isExporting) {
      return;
    }

    const nextSpeed = Math.min(Math.max(value, 0.5), 2);
    const progress = this.state.progress;
    
    // We update the speed and immediately sync to get the new effective duration
    this.state.speed = nextSpeed;
    this.syncPlaybackState();

    this.setState({
      currentTime: progress * this.state.duration,
      activePresetId: null,
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

  setBackground(partial) {
    if (this.state.isExporting) {
      return;
    }
    this.setState({ background: { ...this.state.background, ...partial }, activePresetId: null });
  }

  setEffects(partial) {
    if (this.state.isExporting) {
      return;
    }
    this.setState({ effects: { ...this.state.effects, ...partial }, activePresetId: null });
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
      background: this.state.background,
      effects: this.state.effects,
      scrollPauses: this.state.scrollPauses,
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
      this.state.background = parsed.background && typeof parsed.background === "object" ? { ...this.state.background, ...parsed.background } : this.state.background;
      this.state.effects = parsed.effects && typeof parsed.effects === "object" ? { ...this.state.effects, ...parsed.effects } : this.state.effects;
      this.state.scrollPauses = Array.isArray(parsed.scrollPauses) ? parsed.scrollPauses : [];
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
      this.assetList.innerHTML = `
        <div class="asset-empty">
          <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          <p>Import one or more images to begin building your cinematic showcase.</p>
        </div>
      `;
      return;
    }

    const assetIds = currentState.assets.map((a) => a.id).join(",");
    if (this._lastAssetIds === assetIds && this._lastSelectedId === currentState.selectedAssetId && this._lastExporting === currentState.isExporting) {
      return;
    }
    this._lastAssetIds = assetIds;
    this._lastSelectedId = currentState.selectedAssetId;
    this._lastExporting = currentState.isExporting;

    this.assetList.innerHTML = "";

    for (const asset of currentState.assets) {
      const isSelected = asset.id === currentState.selectedAssetId;
      const item = document.createElement("button");
      item.type = "button";
      item.className = `asset-item${isSelected ? " is-selected" : ""}`;
      item.innerHTML = `
        <span class="asset-thumb"><img src="${asset.objectUrl}" alt=""></span>
        <span class="asset-meta">
          <strong>${asset.name}</strong>
          <span>${this.formatSize(asset.size)}</span>
        </span>
        <span class="asset-duration">${isSelected ? "Selected" : "View"}</span>
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
    this.quickPresetButtons = Array.from(document.querySelectorAll("[data-apply-preset]"));
    this.deviceFrameButtons = Array.from(document.querySelectorAll("[data-device-frame]"));
    this.resolutionButtons = Array.from(document.querySelectorAll("[data-export-resolution]"));
    this.fpsButtons = Array.from(document.querySelectorAll("[data-export-fps]"));
    this.radiusSlider = document.querySelector("[data-radius-slider]");
    this.radiusValue = document.querySelector("[data-radius-value]");
    this.speedSlider = document.querySelector("[data-speed-slider]");
    this.speedValue = document.querySelector("[data-speed-value]");
    this.animationLabel = document.querySelector("[data-animation-label]");
    this.presetButtons = Array.from(document.querySelectorAll("[data-animation]"));
    this.bgButtons = Array.from(document.querySelectorAll("[data-bg-mode]"));
    this.effectButtons = Array.from(document.querySelectorAll("[data-toggle-effect]"));

    this.quickPresetButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.applyPreset(button.dataset.applyPreset));
    });

    this.deviceFrameButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.setDeviceFrame(button.dataset.deviceFrame));
    });

    this.resolutionButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.setExportResolution(button.dataset.exportResolution));
    });

    this.fpsButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.setExportFps(button.dataset.exportFps));
    });

    this.radiusSlider?.addEventListener("input", (event) => {
      this.state.setCornerRadius(Number(event.target.value));
    });

    this.speedSlider?.addEventListener("input", (event) => {
      this.state.setSpeed(Number(event.target.value));
    });

    this.presetButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.setAnimationType(button.dataset.animation));
    });

    this.bgButtons.forEach((button) => {
      button.addEventListener("click", () => this.state.setBackground({ mode: button.dataset.bgMode }));
    });

    // Setup Add Pause button
    const addPauseBtn = document.querySelector("[data-add-pause]");
    if (addPauseBtn) {
      addPauseBtn.addEventListener("click", () => {
        // Add pause at current scroll progress for convenience
        const currentScroll = this.state.state.progress;
        this.state.addScrollPause(currentScroll, 0.15);
      });
    }

    this.effectButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const effect = button.dataset.toggleEffect;
        this.state.setEffects({ [effect]: !this.state.state.effects[effect] });
      });
    });

    this.state.subscribe((currentState) => {
      if (this.radiusSlider) this.radiusSlider.value = String(currentState.cornerRadius);
      if (this.radiusSlider) this.radiusSlider.disabled = currentState.isExporting;
      if (this.radiusValue) this.radiusValue.textContent = `${currentState.cornerRadius}px`;
      if (this.speedSlider) this.speedSlider.value = String(currentState.speed);
      if (this.speedSlider) this.speedSlider.disabled = currentState.isExporting;
      if (this.speedValue) this.speedValue.textContent = `${currentState.speed.toFixed(1)}x`;
      if (this.animationLabel) this.animationLabel.textContent = currentState.selectedPreset === "zoom" ? "Zoom preset" : "Scroll preset";

      this.quickPresetButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.applyPreset === currentState.activePresetId);
        button.disabled = currentState.isExporting;
      });

      this.deviceFrameButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.deviceFrame === currentState.deviceFrame);
        button.disabled = currentState.isExporting;
      });

      this.resolutionButtons.forEach((button) => {
        button.classList.toggle("is-active", Number(button.dataset.exportResolution) === currentState.exportResolution);
        button.disabled = currentState.isExporting;
      });

      this.fpsButtons.forEach((button) => {
        button.classList.toggle("is-active", Number(button.dataset.exportFps) === currentState.exportFps);
        button.disabled = currentState.isExporting;
      });

      this.presetButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.animation === currentState.selectedPreset);
        button.disabled = currentState.isExporting;
      });

      this.bgButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.bgMode === currentState.background.mode);
        button.disabled = currentState.isExporting;
      });

      this.effectButtons.forEach((button) => {
        const effect = button.dataset.toggleEffect;
        button.classList.toggle("is-active", Boolean(currentState.effects[effect]));
        button.disabled = currentState.isExporting;
      });

      this.renderScrollPauses(currentState);
    });
  }

  renderScrollPauses(currentState) {
    const section = document.querySelector("[data-scroll-pauses-section]");
    const list = document.querySelector("[data-pause-list]");
    
    if (!section || !list) return;

    const isScroll = currentState.animationType === "scroll";
    section.hidden = !isScroll;

    if (!isScroll) return;

    // Prevent re-rendering if user is currently typing in an input inside this list
    if (list.contains(document.activeElement)) {
      return;
    }

    // Only rebuild if count changed or for initial render
    const html = currentState.scrollPauses.map(pause => `
      <div class="pause-item" style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; background: rgba(255,255,255,0.03); padding: 6px; border-radius: 8px; border: 1px solid var(--line);">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 9px; color: var(--muted); text-transform: uppercase;">Pos</span>
          <input type="number" step="0.01" min="0" max="1" value="${pause.progress}" 
            onchange="window.stateService.updateScrollPause('${pause.id}', { progress: parseFloat(this.value) })"
            style="background: transparent; border: none; color: #fff; font-size: 11px; width: 100%;">
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 9px; color: var(--muted); text-transform: uppercase;">Hold (s)</span>
          <input type="number" step="0.1" min="0.1" max="10" value="${pause.duration}" 
            onchange="window.stateService.updateScrollPause('${pause.id}', { duration: parseFloat(this.value) })"
            style="background: transparent; border: none; color: #fff; font-size: 11px; width: 100%;">
        </div>
        <button class="secondary-button" type="button" 
          onclick="window.stateService.removeScrollPause('${pause.id}')"
          style="padding: 4px; color: var(--accent); background: transparent; border: none; cursor: pointer;">
          <svg viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
    `).join("");

    list.innerHTML = html || `<p style="font-size: 11px; color: var(--muted); text-align: center; padding: 10px;">No pauses added.</p>`;
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

    this.image?.addEventListener("load", () => this.requestRender());
    window.addEventListener("resize", () => this.requestRender());

    if (this.viewport && "ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => this.requestRender());
      this.resizeObserver.observe(this.viewport);
    }

    this.state.subscribe((currentState) => this.render(currentState));
  }

  requestRender() {
    if (this._renderRequested) return;
    this._renderRequested = true;
    requestAnimationFrame(() => {
      this.render(this.state.state);
      this._renderRequested = false;
    });
  }

  getExportSnapshot() {
    const asset = this.state.getSelectedAsset();

    if (!asset || !this.metrics || !this.previewScreen || !this.viewport) {
      return null;
    }

    const previewDevice = this.previewScreen.querySelector(".preview-device");
    const deviceHardware = this.previewScreen.querySelector(".device-hardware");
    const hardwareTop = this.previewScreen.querySelector(".browser-top");
    const notch = this.previewScreen.querySelector(".hardware-notch");
    const brandMini = this.previewScreen.querySelector(".brand-mini");
    const browserLinks = Array.from(this.previewScreen.querySelectorAll(".browser-links span"));
    const browserActions = Array.from(this.previewScreen.querySelectorAll(".browser-actions span"));
    const deviceStand = this.previewScreen.querySelector("[data-device-stand]");

    if (!previewDevice) {
      return null;
    }

    return {
      asset,
      deviceFrame: this.state.state.deviceFrame,
      metrics: {
        ...this.metrics,
        cornerRadius: this.state.state.cornerRadius,
      },
      previewMode: this.state.state.previewMode,
      background: this.state.state.background,
      effects: this.state.state.effects,
      screenRect: this.previewScreen.getBoundingClientRect(),
      deviceRect: previewDevice.getBoundingClientRect(),
      hardwareRect: deviceHardware ? deviceHardware.getBoundingClientRect() : null,
      topHardwareRect: hardwareTop ? hardwareTop.getBoundingClientRect() : null,
      notchRect: notch ? notch.getBoundingClientRect() : null,
      brandRect: brandMini ? brandMini.getBoundingClientRect() : null,
      linkRects: browserLinks.map((element) => element.getBoundingClientRect()),
      actionRects: browserActions.map((element) => element.getBoundingClientRect()),
      viewportRect: this.viewport.getBoundingClientRect(),
      standRect: deviceStand ? deviceStand.getBoundingClientRect() : null,
    };
  }

  render(currentState) {
    const selected = this.state.getSelectedAsset();

    if (this.viewport) {
      this.viewport.style.borderRadius = `${currentState.cornerRadius}px`;
    }

    this.previewScreen?.classList.toggle("preview-mode", currentState.previewMode);

    if (this.previewScreen) {
      this.previewScreen.dataset.bgMode = currentState.background.mode;
      this.previewScreen.dataset.vignette = String(Boolean(currentState.effects.vignette));
      const previewDevice = this.previewScreen.querySelector(".preview-device");
      if (previewDevice) {
        previewDevice.dataset.activeDevice = currentState.deviceFrame;
        previewDevice.dataset.depth = String(Boolean(currentState.effects.depth));
      }
    }

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

    if (!viewportWidth || !viewportHeight) {
      return;
    }

    const baseMetrics = { naturalWidth, naturalHeight, viewportWidth, viewportHeight };
    const metrics = calculateMotionLayout(
      baseMetrics, 
      currentState.animationType, 
      currentState.currentTime, 
      currentState.duration,
      currentState.scrollPauses
    );

    this.applyImageLayout(metrics);
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
      this.label.textContent = "Export MP4 Video";
    }

    if (!canExport && !currentState.isExporting) {
      this.button.title = "Import and preview an image before exporting.";
    } else {
      this.button.removeAttribute("title");
    }

    if (currentState.isPlaying && this.button.disabled && !currentState.isExporting && this.label) {
      this.label.textContent = "Export MP4 Video";
    }
  }

  async handleExport() {
    if (!this.button || this.state.state.isExporting) {
      return;
    }

    if (!this.state.getSelectedAsset() || !this.previewStage.metrics) {
      if (this.statusCopy) {
        this.statusCopy.textContent = "Import and preview an image before exporting an MP4 video.";
      }
      return;
    }

    this.state.setExporting(true);
    this.button.classList.add("is-loading");
    this.button.disabled = true;
    this.button.setAttribute("aria-disabled", "true");

    if (this.label) {
      if (this.state.state.exportFps) {
        this.label.textContent = `Exporting MP4 (${this.state.state.exportFps} FPS)...`;
      } else {
        this.label.textContent = "Exporting MP4...";
      }
    }

    try {
      const result = await this.exportService.exportMp4Sequence({
        previewStage: this.previewStage,
        state: this.state.state,
        fps: this.state.state.exportFps,
        onProgress: ({ currentFrame, totalFrames, step, progress }) => {
          if (step === "rendering") {
            const pct = Math.round((progress || 0) * 100);
            if (this.label) {
              this.label.textContent = `Rendering ${pct}%`;
            }
            if (this.statusCopy) {
              this.statusCopy.textContent = `Rendering frame ${currentFrame} of ${totalFrames} at ${this.state.state.exportFps} FPS.`;
            }
          } else if (step === "encoding") {
            if (this.label) {
              this.label.textContent = `Encoding Video...`;
            }
            if (this.statusCopy) {
              this.statusCopy.textContent = `Compressing MP4 frames securely... please wait.`;
            }
          }
        },
      });

      this.button.classList.add("is-saved");

      if (this.label) {
        this.label.textContent = "Export Complete";
      }

      if (this.statusCopy) {
        this.statusCopy.textContent = `${result.totalFrames} frames encoded as MP4 and downloaded successfully.`;
      }

      window.setTimeout(() => {
        this.button?.classList.remove("is-saved");

        if (!this.state.state.isExporting && this.label) {
          this.label.textContent = "Export MP4 Video";
        }
      }, 3500);
    } catch (error) {
      if (this.statusCopy) {
        this.statusCopy.textContent = error instanceof Error
          ? error.message
          : "MP4 export failed. Try again after the preview finishes rendering.";
      }

      if (this.label) {
        this.label.textContent = "Export MP4 Video";
      }
    } finally {
      this.state.setExporting(false);
      this.button.classList.remove("is-loading");
      this.render(this.state.state);
    }
  }
}

const state = new EditorStateService();
window.stateService = state;
new AssetPanel(state);
new ControlsPanel(state);
const previewStage = new PreviewStage(state);
new TimelineBar(state);
new PlaybackController(state);
new ExportController(state, previewStage);
