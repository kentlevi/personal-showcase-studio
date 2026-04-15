const yearNode = document.querySelector("[data-year]");
const body = document.body;
const siteHeader = document.querySelector(".site-header");
const cursorNoise = document.querySelector("[data-cursor-noise]");
const cursorDot = document.querySelector("[data-cursor-dot]");
const cursorRing = document.querySelector("[data-cursor-ring]");
const floatingScene = document.querySelector(".floating-scene");
const magneticNodes = Array.from(document.querySelectorAll(".float-shape, .float-blur"));
const interactiveNodes = Array.from(document.querySelectorAll("a, button, [role='button']"));
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const supportsFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

const syncHeaderState = () => {
  if (!siteHeader) {
    return;
  }

  siteHeader.classList.toggle("is-scrolled", window.scrollY > 16);
};

window.addEventListener("scroll", syncHeaderState, { passive: true });
syncHeaderState();

if (supportsFinePointer && !prefersReducedMotion) {
  body.classList.add("has-fancy-cursor");

  const cursor = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    ringX: window.innerWidth / 2,
    ringY: window.innerHeight / 2,
  };

  let rafId = 0;

  const renderCursor = () => {
    cursor.ringX += (cursor.x - cursor.ringX) * 0.18;
    cursor.ringY += (cursor.y - cursor.ringY) * 0.18;

    if (cursorDot) {
      cursorDot.style.transform = `translate3d(${cursor.x}px, ${cursor.y}px, 0) translate(-50%, -50%)`;
    }

    if (cursorRing) {
      cursorRing.style.transform = `translate3d(${cursor.ringX}px, ${cursor.ringY}px, 0) translate(-50%, -50%)`;
    }

    if (cursorNoise) {
      cursorNoise.style.transform = `translate3d(${cursor.ringX}px, ${cursor.ringY}px, 0) translate(-50%, -50%)`;
    }

    rafId = window.requestAnimationFrame(renderCursor);
  };

  const updateBackgroundGlow = (clientX, clientY) => {
    const x = (clientX / window.innerWidth) * 100;
    const y = (clientY / window.innerHeight) * 100;

    document.documentElement.style.setProperty("--hover-x", `${x}%`);
    document.documentElement.style.setProperty("--hover-y", `${y}%`);
    document.documentElement.style.setProperty("--hover-intensity", "1");
  };

  const updateMagneticScene = (clientX, clientY) => {
    if (!floatingScene) {
      return;
    }

    const sceneRect = floatingScene.getBoundingClientRect();
    const insideScene = (
      clientX >= sceneRect.left &&
      clientX <= sceneRect.right &&
      clientY >= sceneRect.top &&
      clientY <= sceneRect.bottom
    );

    const sceneX = ((clientX - sceneRect.left) / sceneRect.width) * 100;
    const sceneY = ((clientY - sceneRect.top) / sceneRect.height) * 100;

    floatingScene.style.setProperty("--scene-px", `${sceneX}%`);
    floatingScene.style.setProperty("--scene-py", `${sceneY}%`);
    floatingScene.style.setProperty("--scene-glow", insideScene ? "1" : "0.35");

    magneticNodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const distance = Math.hypot(dx, dy);
      const threshold = Math.max(140, rect.width * 3);

      if (distance < threshold) {
        const strength = (1 - distance / threshold) * 18;
        const offsetX = (dx / threshold) * strength;
        const offsetY = (dy / threshold) * strength;

        node.style.setProperty("--mx", `${offsetX.toFixed(2)}px`);
        node.style.setProperty("--my", `${offsetY.toFixed(2)}px`);
      } else {
        node.style.setProperty("--mx", "0px");
        node.style.setProperty("--my", "0px");
      }
    });
  };

  const handlePointerMove = (event) => {
    cursor.x = event.clientX;
    cursor.y = event.clientY;

    updateBackgroundGlow(event.clientX, event.clientY);
    updateMagneticScene(event.clientX, event.clientY);
  };

  const handlePointerLeave = () => {
    document.documentElement.style.setProperty("--hover-intensity", "0");
    body.classList.remove("cursor-active");

    if (floatingScene) {
      floatingScene.style.setProperty("--scene-glow", "0");
    }

    magneticNodes.forEach((node) => {
      node.style.setProperty("--mx", "0px");
      node.style.setProperty("--my", "0px");
    });
  };

  interactiveNodes.forEach((node) => {
    node.addEventListener("mouseenter", () => {
      body.classList.add("cursor-active");
    });

    node.addEventListener("mouseleave", () => {
      body.classList.remove("cursor-active");
    });
  });

  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  window.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("blur", handlePointerLeave);

  if (!rafId) {
    rafId = window.requestAnimationFrame(renderCursor);
  }
}
