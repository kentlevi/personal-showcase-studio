import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile, toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, fillStyle) {
  context.save();
  drawRoundedRect(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
  context.restore();
}

function strokeRoundedRect(context, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  context.save();
  drawRoundedRect(context, x, y, width, height, radius);
  context.lineWidth = lineWidth;
  context.strokeStyle = strokeStyle;
  context.stroke();
  context.restore();
}

function createRelativeRect(rect, baseRect, scale) {
  return {
    x: (rect.left - baseRect.left) * scale,
    y: (rect.top - baseRect.top) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function drawRadialGlow(context, x, y, radius, innerColor, outerColor) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(1, outerColor);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildFrameName(index, totalFrames) {
  const digits = Math.max(4, String(totalFrames).length);
  return `frame-${String(index).padStart(digits, "0")}.png`;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("The browser could not encode the preview as PNG."));
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function remapProgressWithPauses(t, pauses, totalDuration) {
  if (!pauses || pauses.length === 0) return t;

  const EASE_DUR = 0.18; // Seconds for deceleration/acceleration
  const sortedPauses = [...pauses]
    .filter(p => p.duration > 0)
    .sort((a, b) => a.progress - b.progress);

  if (sortedPauses.length === 0) return t;

  const totalHoldDuration = sortedPauses.reduce((sum, p) => sum + p.duration, 0);
  const totalEaseDuration = sortedPauses.length * (EASE_DUR * 2);
  const baseMotionDuration = Math.max(0.1, totalDuration - totalHoldDuration - totalEaseDuration);
  
  // Nominal velocity (progress units per second) during linear phase
  const v = 1 / baseMotionDuration;
  const distE = 0.5 * v * EASE_DUR; // Distance covered during one easing phase (0.18s)
  
  const currentTime = t * totalDuration;

  let elapsedHoldTime = 0;
  let elapsedEaseTime = 0;

  for (const pause of sortedPauses) {
    // Current pause 'event' timing:
    // 1. Linear phase ends at:
    const linearMotionTime = (pause.progress * baseMotionDuration) - (EASE_DUR * 0.5);
    const easeInStart = linearMotionTime + elapsedHoldTime + elapsedEaseTime;
    const holdStart = easeInStart + EASE_DUR;
    const holdEnd = holdStart + pause.duration;
    const easeOutEnd = holdEnd + EASE_DUR;

    // Linear Phase
    if (currentTime < easeInStart) {
      const activeMotionTime = currentTime - elapsedHoldTime - elapsedEaseTime;
      return activeMotionTime / baseMotionDuration;
    }

    // Ease In (Deceleration to stop at pause.progress)
    if (currentTime < holdStart) {
      const s = currentTime - easeInStart; // Time into easing [0, 0.18]
      const startP = (pause.progress - distE);
      // Quadratic: p(s) = startP + v*s - 0.5 * (v/EASE_DUR) * s^2
      const p_s = startP + (v * s) - (0.5 * (v / EASE_DUR) * s * s);
      return Math.min(pause.progress, p_s);
    }

    // Hold
    if (currentTime <= holdEnd) {
      return pause.progress;
    }

    // Ease Out (Acceleration from pause.progress)
    if (currentTime < easeOutEnd) {
      const s = currentTime - holdEnd; // Time into easing [0, 0.18]
      // Quadratic: p(s) = pause.progress + 0.5 * (v/EASE_DUR) * s^2
      const p_s = pause.progress + (0.5 * (v / EASE_DUR) * s * s);
      return Math.min(pause.progress + distE, p_s);
    }

    elapsedHoldTime += pause.duration;
    elapsedEaseTime += (EASE_DUR * 2);
  }

  // Final Linear Phase
  const finalMotionTime = currentTime - elapsedHoldTime - elapsedEaseTime;
  return Math.min(1, finalMotionTime / baseMotionDuration);
}

export function calculateMotionLayout(baseMetrics, animationType, currentTime, duration, scrollPauses = []) {
  const naturalWidth = baseMetrics.naturalWidth;
  const naturalHeight = baseMetrics.naturalHeight;
  const viewportWidth = baseMetrics.viewportWidth;
  const viewportHeight = baseMetrics.viewportHeight;

  const delay = 0.3;
  const activeDuration = Math.max(duration - delay, 0.001);
  const activeTime = Math.max(currentTime - delay, 0);
  const rawProgress = Math.min(Math.max(activeTime / activeDuration, 0), 1);
  let p = rawProgress;

  if (animationType === "zoom") {
    p = 1 - Math.pow(1 - rawProgress, 3);
    const coverScale = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    const animatedScale = coverScale * (1.01 + p * 0.11);
    const renderedWidth = naturalWidth * animatedScale;
    const renderedHeight = naturalHeight * animatedScale;
    const offsetLeft = (viewportWidth - renderedWidth) / 2;
    const offsetTop = (viewportHeight - renderedHeight) / 2;

    return {
      ...baseMetrics,
      renderedWidth,
      renderedHeight,
      offsetLeft,
      offsetTop,
      movementY: 0,
    };
  }

  p = rawProgress < 0.5 ? 2 * rawProgress * rawProgress : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;

  if (animationType === "scroll") {
    // 1. Remap the raw progress based on manual pauses (additive model)
    const remappedP = remapProgressWithPauses(rawProgress, scrollPauses, duration);
    // 2. Apply humanized easing to the remapped path to make it feel natural
    p = remappedP < 0.5 ? 2 * remappedP * remappedP : 1 - Math.pow(-2 * remappedP + 2, 2) / 2;
  }

  const scale = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const maxScrollDistance = Math.max(renderedHeight - viewportHeight, 0);
  const movementY = maxScrollDistance > 0 ? p * maxScrollDistance : 0;
  
  const maxScrollX = Math.max(renderedWidth - viewportWidth, 0);
  const offsetLeft = maxScrollX > 0 ? -(maxScrollX / 2) : 0;
  const offsetTop = maxScrollDistance > 0 ? -movementY : 0;

  return {
    ...baseMetrics,
    renderedWidth,
    renderedHeight,
    offsetLeft,
    offsetTop,
    movementY,
  };
}

function createCanvas(width, height, scale) {
  const canvas = document.createElement("canvas");
  
  let w = Math.max(2, Math.round(width * scale));
  let h = Math.max(2, Math.round(height * scale));
  
  canvas.width = w % 2 === 0 ? w : w + 1;
  canvas.height = h % 2 === 0 ? h : h + 1;
  
  return canvas;
}

export class PreviewExportService {
  constructor() {
    this.imageCache = new Map();
  }

  async exportFrame({ previewStage, state }) {
    const stageSnapshot = previewStage?.getExportSnapshot?.();

    if (!stageSnapshot || !stageSnapshot.asset || !stageSnapshot.metrics) {
      throw new Error("Select an image before exporting a frame.");
    }

    const exportScale = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
    const canvas = createCanvas(stageSnapshot.screenRect.width, stageSnapshot.screenRect.height, exportScale);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not create a PNG export canvas.");
    }

    await this.drawScene({
      context,
      snapshot: stageSnapshot,
      scale: exportScale,
      metrics: calculateMotionLayout(
        stageSnapshot.metrics,
        state.animationType,
        state.currentTime,
        state.duration,
        state.scrollPauses
      ),
    });

    const projectSlug = slugify(state.projectName || "showcase-studio");
    const assetSlug = slugify(stageSnapshot.asset.name || "frame");
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `${projectSlug}-${assetSlug || "frame"}.png`);
  }

  async exportMp4Sequence({ previewStage, state, fps = 30, onProgress }) {
    const stageSnapshot = previewStage?.getExportSnapshot?.();

    if (!stageSnapshot || !stageSnapshot.asset || !stageSnapshot.metrics) {
      throw new Error("Select an image before exporting an MP4 sequence.");
    }

    const exportResolution = state.exportResolution || 1080;
    const exportScale = exportResolution / stageSnapshot.screenRect.height;
    const totalFrames = Math.max(1, Math.round(state.duration * fps));
    const canvas = createCanvas(stageSnapshot.screenRect.width, stageSnapshot.screenRect.height, exportScale);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not create a PNG export canvas.");
    }

    const ffmpeg = new FFmpeg();
    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
    } catch {
      throw new Error("Failed to load ffmpeg encoding engine. Check your connection.");
    }

    for (let index = 0; index < totalFrames; index += 1) {
      const progress = totalFrames === 1 ? 0 : index / (totalFrames - 1);
      const currentTime = progress * state.duration;
      const metrics = calculateMotionLayout(
        stageSnapshot.metrics,
        state.animationType,
        currentTime,
        state.duration,
        state.scrollPauses
      );

      await this.drawScene({
        context,
        snapshot: stageSnapshot,
        scale: exportScale,
        metrics,
      });

      const blob = await canvasToBlob(canvas);
      const fileName = buildFrameName(index, totalFrames);
      
      const fileData = await fetchFile(blob);
      await ffmpeg.writeFile(fileName, fileData);

      onProgress?.({
        step: "rendering",
        currentFrame: index + 1,
        totalFrames,
        progress,
      });

      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    onProgress?.({ step: "encoding" });

    let ffmpegLogs = "";
    ffmpeg.on("log", ({ message }) => {
      ffmpegLogs += message + "\n";
    });

    const digits = Math.max(4, String(totalFrames).length);
    const exitCode = await ffmpeg.exec([
      "-framerate", fps.toString(),
      "-i", `frame-%0${digits}d.png`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "output.mp4"
    ]);

    if (exitCode !== 0) {
      console.error(ffmpegLogs);
      throw new Error("FFmpeg failed: " + ffmpegLogs.split('\n').filter(l => l.includes('Error') || l.includes('Invalid') || l.includes('failed')).join(', '));
    }

    const data = await ffmpeg.readFile("output.mp4");
    const mp4Blob = new Blob([data], { type: "video/mp4" });
    
    for (let index = 0; index < totalFrames; index += 1) {
       await ffmpeg.deleteFile(buildFrameName(index, totalFrames));
    }
    await ffmpeg.deleteFile("output.mp4");

    const projectSlug = slugify(state.projectName || "showcase-studio");
    const assetSlug = slugify(stageSnapshot.asset.name || "video");
    const presetSlug = slugify(state.animationType || "clip");
    downloadBlob(mp4Blob, `${projectSlug}-${assetSlug}-${presetSlug}.mp4`);

    return { totalFrames, fps };
  }

  async drawScene({ context, snapshot, scale, metrics }) {
    const {
      asset,
      deviceFrame = "browser",
      previewMode,
      background = { mode: "glow", color: "#1a1a1a", gradient: ["#20232d", "#c0c4cf"], glowIntensity: 0.18 },
      effects = { depth: true, vignette: true },
      screenRect,
      deviceRect,
      topHardwareRect,
      notchRect,
      brandRect,
      linkRects = [],
      actionRects = [],
      viewportRect,
      standRect,
    } = snapshot;

    const screen = {
      x: 0,
      y: 0,
      width: screenRect.width * scale,
      height: screenRect.height * scale,
    };
    const device = deviceRect ? createRelativeRect(deviceRect, screenRect, scale) : null;
    const viewport = createRelativeRect(viewportRect, screenRect, scale);

    context.clearRect(0, 0, screen.width, screen.height);

    if (background.mode === "solid") {
      context.fillStyle = background.color || "#1a1a1a";
      context.fillRect(0, 0, screen.width, screen.height);
    } else {
      const backgroundGradient = context.createLinearGradient(0, 0, screen.width, screen.height);
      const gradientColors = background.gradient || ["#20232d", "#c0c4cf"];
      backgroundGradient.addColorStop(0, gradientColors[0]);
      backgroundGradient.addColorStop(1, gradientColors[1]);
      context.fillStyle = backgroundGradient;
      context.fillRect(0, 0, screen.width, screen.height);
      
      if (background.mode === "glow") {
        drawRadialGlow(
          context,
          screen.width * 0.7,
          screen.height * 0.3,
          Math.max(screen.width, screen.height) * 0.22,
          `rgba(255, 91, 87, ${background.glowIntensity || 0.18})`,
          "rgba(255, 91, 87, 0)"
        );
      }
    }

    let outerCornerRadius = 18 * scale;
    if (deviceFrame === "laptop") outerCornerRadius = 14 * scale;
    if (deviceFrame === "phone") outerCornerRadius = 38 * scale;

    if (device && deviceFrame !== "frameless") {
      context.save();
      if (effects.depth) {
        context.shadowColor = "rgba(0, 0, 0, 0.45)";
        context.shadowBlur = 60 * scale;
        context.shadowOffsetY = 24 * scale;
      }
      fillRoundedRect(context, device.x, device.y, device.width, device.height, outerCornerRadius, "#090909");
      context.restore();

      drawRadialGlow(
        context,
        device.x + device.width * 0.78,
        device.y + device.height * 0.2,
        device.width * 0.24,
        "rgba(255, 91, 87, 0.22)",
        "rgba(255, 91, 87, 0)"
      );

      const deviceGradient = context.createLinearGradient(device.x, device.y, device.x, device.y + device.height);
      deviceGradient.addColorStop(0, "#070707");
      deviceGradient.addColorStop(1, "#0b0a0b");
      fillRoundedRect(context, device.x, device.y, device.width, device.height, outerCornerRadius, deviceGradient);
      strokeRoundedRect(context, device.x, device.y, device.width, device.height, outerCornerRadius, "rgba(255, 255, 255, 0.08)", Math.max(1, scale));
      
      const rimRadius = (deviceFrame === "phone") ? 42 * scale : 24 * scale;
      const rimOffset = (deviceFrame === "phone") ? 5 * scale : ((deviceFrame === "laptop") ? 12 * scale : 8 * scale);
      strokeRoundedRect(context, device.x - rimOffset, device.y - rimOffset, device.width + (rimOffset * 2), device.height + (rimOffset * 2), rimRadius, "rgba(18, 18, 18, 0.9)", 3 * scale);

      if ((deviceFrame === "browser" || deviceFrame === "laptop") && brandRect && topHardwareRect) {
        const brand = createRelativeRect(brandRect, screenRect, scale);
        const links = linkRects.map((rect) => createRelativeRect(rect, screenRect, scale));
        const actions = actionRects.map((rect) => createRelativeRect(rect, screenRect, scale));

        const brandGradient = context.createLinearGradient(brand.x, brand.y, brand.x + brand.width, brand.y);
        brandGradient.addColorStop(0, "rgba(255, 91, 87, 0.9)");
        brandGradient.addColorStop(1, "rgba(255, 255, 255, 0.9)");
        fillRoundedRect(context, brand.x, brand.y, brand.width, brand.height, brand.height / 2, brandGradient);

        for (const rect of links) {
          fillRoundedRect(context, rect.x, rect.y, rect.width, rect.height, rect.height / 2, "rgba(255, 255, 255, 0.24)");
        }

        actions.forEach((rect, index) => {
          const fill = index === actions.length - 1
            ? context.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height)
            : "rgba(255, 255, 255, 0.12)";

          if (typeof fill !== "string") {
            fill.addColorStop(0, "#ff6c67");
            fill.addColorStop(1, "#ee4a45");
          }

          fillRoundedRect(context, rect.x, rect.y, rect.width, rect.height, rect.height / 2, fill);
        });
      }
    }

    const viewportBackground = context.createLinearGradient(viewport.x, viewport.y, viewport.x, viewport.y + viewport.height);
    viewportBackground.addColorStop(0, "rgba(255, 255, 255, 0.04)");
    viewportBackground.addColorStop(1, "rgba(255, 255, 255, 0.02)");
    fillRoundedRect(context, viewport.x, viewport.y, viewport.width, viewport.height, metrics.cornerRadius * scale, viewportBackground);
    drawRadialGlow(
      context,
      viewport.x + viewport.width * 0.78,
      viewport.y + viewport.height * 0.2,
      viewport.width * 0.18,
      "rgba(255, 91, 87, 0.14)",
      "rgba(255, 91, 87, 0)"
    );

    context.save();
    drawRoundedRect(context, viewport.x, viewport.y, viewport.width, viewport.height, metrics.cornerRadius * scale);
    context.clip();

    const image = await this.loadImage(asset.objectUrl);
    context.drawImage(
      image,
      viewport.x + metrics.offsetLeft * scale,
      viewport.y + metrics.offsetTop * scale,
      metrics.renderedWidth * scale,
      metrics.renderedHeight * scale
    );
    context.restore();

    if (deviceFrame === "phone" && notchRect) {
      const notch = createRelativeRect(notchRect, screenRect, scale);
      fillRoundedRect(context, notch.x, notch.y, notch.width, notch.height, notch.height / 2, "rgba(0, 0, 0, 0.85)");
    }

    if (deviceFrame === "laptop" && standRect) {
      const laptopBase = createRelativeRect(standRect, screenRect, scale);
      const baseGradient = context.createLinearGradient(laptopBase.x, laptopBase.y, laptopBase.x, laptopBase.y + laptopBase.height);
      baseGradient.addColorStop(0, "#eceef2");
      baseGradient.addColorStop(1, "#7c808a");
      fillRoundedRect(context, laptopBase.x, laptopBase.y, laptopBase.width, laptopBase.height, Math.min(laptopBase.height, 80 * scale), baseGradient);

      const dentWidth = Math.min(120 * scale, laptopBase.width * 0.24);
      const dentHeight = Math.max(6 * scale, laptopBase.height * 0.32);
      fillRoundedRect(
        context,
        laptopBase.x + (laptopBase.width - dentWidth) / 2,
        laptopBase.y + 12 * scale,
        dentWidth,
        dentHeight,
        dentHeight / 2,
        "rgba(0, 0, 0, 0.3)"
      );
    }

    if (previewMode && device && deviceFrame !== "frameless") {
      context.save();
      context.globalAlpha = 0.04;
      fillRoundedRect(context, device.x, device.y, device.width, device.height, outerCornerRadius, "#ffffff");
      context.restore();
    }

    if (effects.vignette) {
      const vignetteGradient = context.createRadialGradient(
        screen.width / 2,
        screen.height / 2,
        Math.min(screen.width, screen.height) * 0.4,
        screen.width / 2,
        screen.height / 2,
        Math.max(screen.width, screen.height) * 0.65
      );
      vignetteGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignetteGradient.addColorStop(1, "rgba(0, 0, 0, 0.7)");
      context.fillStyle = vignetteGradient;
      context.fillRect(0, 0, screen.width, screen.height);
    }
  }

  loadImage(src) {
    const cached = this.imageCache.get(src);

    if (cached) {
      return cached;
    }

    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The selected image could not be prepared for PNG export."));
      image.src = src;
    });

    this.imageCache.set(src, promise);
    return promise;
  }
}
