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
  return `frame-${String(index + 1).padStart(digits, "0")}.png`;
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
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function computePreviewMetrics(baseMetrics, animationType, progress) {
  const naturalWidth = baseMetrics.naturalWidth;
  const naturalHeight = baseMetrics.naturalHeight;
  const viewportWidth = baseMetrics.viewportWidth;
  const viewportHeight = baseMetrics.viewportHeight;

  if (animationType === "zoom") {
    const coverScale = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    const animatedScale = coverScale * (1.01 + progress * 0.11);
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

  const widthScale = viewportWidth / naturalWidth;
  const renderedWidth = viewportWidth;
  const renderedHeight = naturalHeight * widthScale;
  const maxScrollDistance = Math.max(renderedHeight - viewportHeight, 0);
  const movementY = maxScrollDistance > 0 ? progress * maxScrollDistance : 0;
  const offsetLeft = (viewportWidth - renderedWidth) / 2;
  const offsetTop = maxScrollDistance > 0
    ? -movementY
    : (viewportHeight - renderedHeight) / 2;

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
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

function makeSignature() {
  return Uint8Array.from([80, 75, 3, 4]);
}

function makeCentralSignature() {
  return Uint8Array.from([80, 75, 1, 2]);
}

function makeEndSignature() {
  return Uint8Array.from([80, 75, 5, 6]);
}

function crc32(bytes) {
  let crc = 0 ^ -1;

  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];

    for (let step = 0; step < 8; step += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ -1) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function concatenateUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let cursor = 0;

  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }

  return output;
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localFiles = [];
  const centralDirectory = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = new Uint8Array(file.bytes);
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localHeader.set(makeSignature(), 0);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, dataBytes.length);
    writeUint32(localView, 22, dataBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralHeader.set(makeCentralSignature(), 0);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, dataBytes.length);
    writeUint32(centralView, 24, dataBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);

    localFiles.push(localHeader, dataBytes);
    centralDirectory.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });

  const centralBytes = concatenateUint8Arrays(centralDirectory);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endRecord.set(makeEndSignature(), 0);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralBytes.length);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return new Blob([...localFiles, centralBytes, endRecord], { type: "application/zip" });
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
      metrics: stageSnapshot.metrics,
    });

    const projectSlug = slugify(state.projectName || "showcase-studio");
    const assetSlug = slugify(stageSnapshot.asset.name || "frame");
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `${projectSlug}-${assetSlug || "frame"}.png`);
  }

  async exportFrameSequence({ previewStage, state, fps = 30, onProgress }) {
    const stageSnapshot = previewStage?.getExportSnapshot?.();

    if (!stageSnapshot || !stageSnapshot.asset || !stageSnapshot.metrics) {
      throw new Error("Select an image before exporting a frame sequence.");
    }

    const exportScale = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
    const totalFrames = Math.max(1, Math.round(state.duration * fps));
    const canvas = createCanvas(stageSnapshot.screenRect.width, stageSnapshot.screenRect.height, exportScale);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not create a PNG export canvas.");
    }

    const files = [];

    for (let index = 0; index < totalFrames; index += 1) {
      const progress = totalFrames === 1 ? 0 : index / (totalFrames - 1);
      const metrics = computePreviewMetrics(stageSnapshot.metrics, state.animationType, progress);

      await this.drawScene({
        context,
        snapshot: stageSnapshot,
        scale: exportScale,
        metrics,
      });

      const blob = await canvasToBlob(canvas);
      const bytes = await blob.arrayBuffer();
      files.push({
        name: buildFrameName(index, totalFrames),
        bytes,
      });

      onProgress?.({
        currentFrame: index + 1,
        totalFrames,
        progress,
      });

      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    const zipBlob = createStoredZip(files);
    const projectSlug = slugify(state.projectName || "showcase-studio");
    const assetSlug = slugify(stageSnapshot.asset.name || "sequence");
    const presetSlug = slugify(state.animationType || "clip");
    downloadBlob(zipBlob, `${projectSlug}-${assetSlug}-${presetSlug}-frames.zip`);

    return { totalFrames, fps };
  }

  async drawScene({ context, snapshot, scale, metrics }) {
    const {
      asset,
      previewMode,
      screenRect,
      browserRect,
      brandRect,
      linkRects,
      actionRects,
      viewportRect,
      baseRect,
    } = snapshot;

    const screen = {
      x: 0,
      y: 0,
      width: screenRect.width * scale,
      height: screenRect.height * scale,
    };
    const browser = createRelativeRect(browserRect, screenRect, scale);
    const brand = createRelativeRect(brandRect, screenRect, scale);
    const viewport = createRelativeRect(viewportRect, screenRect, scale);
    const laptopBase = createRelativeRect(baseRect, screenRect, scale);
    const links = linkRects.map((rect) => createRelativeRect(rect, screenRect, scale));
    const actions = actionRects.map((rect) => createRelativeRect(rect, screenRect, scale));

    context.clearRect(0, 0, screen.width, screen.height);

    const backgroundGradient = context.createLinearGradient(0, 0, screen.width, screen.height);
    backgroundGradient.addColorStop(0, "#20232d");
    backgroundGradient.addColorStop(1, "#c0c4cf");
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, screen.width, screen.height);

    drawRadialGlow(
      context,
      screen.width * 0.7,
      screen.height * 0.3,
      Math.max(screen.width, screen.height) * 0.22,
      "rgba(255, 91, 87, 0.18)",
      "rgba(255, 91, 87, 0)"
    );

    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.45)";
    context.shadowBlur = 60 * scale;
    context.shadowOffsetY = 24 * scale;
    fillRoundedRect(context, browser.x, browser.y, browser.width, browser.height, 18 * scale, "#090909");
    context.restore();

    drawRadialGlow(
      context,
      browser.x + browser.width * 0.78,
      browser.y + browser.height * 0.2,
      browser.width * 0.24,
      "rgba(255, 91, 87, 0.22)",
      "rgba(255, 91, 87, 0)"
    );

    const browserGradient = context.createLinearGradient(browser.x, browser.y, browser.x, browser.y + browser.height);
    browserGradient.addColorStop(0, "#070707");
    browserGradient.addColorStop(1, "#0b0a0b");
    fillRoundedRect(context, browser.x, browser.y, browser.width, browser.height, 18 * scale, browserGradient);
    strokeRoundedRect(context, browser.x, browser.y, browser.width, browser.height, 18 * scale, "rgba(255, 255, 255, 0.08)", Math.max(1, scale));
    strokeRoundedRect(context, browser.x - 8 * scale, browser.y - 8 * scale, browser.width + 16 * scale, browser.height + 16 * scale, 24 * scale, "rgba(18, 18, 18, 0.9)", 3 * scale);

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

    const baseGradient = context.createLinearGradient(laptopBase.x, laptopBase.y, laptopBase.x, laptopBase.y + laptopBase.height);
    baseGradient.addColorStop(0, "#eceef2");
    baseGradient.addColorStop(1, "#7c808a");
    fillRoundedRect(context, laptopBase.x, laptopBase.y, laptopBase.width, laptopBase.height, Math.min(laptopBase.height, 80 * scale), baseGradient);

    const notchWidth = Math.min(120 * scale, laptopBase.width * 0.24);
    const notchHeight = Math.max(6 * scale, laptopBase.height * 0.32);
    fillRoundedRect(
      context,
      laptopBase.x + (laptopBase.width - notchWidth) / 2,
      laptopBase.y + 12 * scale,
      notchWidth,
      notchHeight,
      notchHeight / 2,
      "rgba(0, 0, 0, 0.3)"
    );

    if (previewMode) {
      context.save();
      context.globalAlpha = 0.04;
      fillRoundedRect(context, browser.x, browser.y, browser.width, browser.height, 18 * scale, "#ffffff");
      context.restore();
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
