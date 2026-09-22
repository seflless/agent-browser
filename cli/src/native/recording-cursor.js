(() => {
  globalThis.__agentBrowserRecordingCursorCleanup?.();
  const config = globalThis.__agentBrowserRecordingCursorConfig || {};
  const size = Math.max(1, Number(config.size) || 28);
  const width = Math.max(1, Number(config.width) || size);
  const height = Math.max(1, Number(config.height) || size);
  const hotspotX = Math.max(0, Number(config.hotspotX) || 0);
  const hotspotY = Math.max(0, Number(config.hotspotY) || 0);
  const removers = [];
  const ripples = [];
  const image = new Image();
  let host, canvas, context;
  let disposed = false;
  let positioned = false;
  let pressed = false;
  let targetX = 0, targetY = 0, visualX = 0, visualY = 0;
  let lastFrame = 0, animationFrame = 0;
  let viewportWidth = 0, viewportHeight = 0, pixelRatio = 0;

  function resize() {
    if (!canvas) return;
    const ratio = devicePixelRatio || 1;
    if (viewportWidth === innerWidth && viewportHeight === innerHeight && pixelRatio === ratio) return;
    viewportWidth = innerWidth;
    viewportHeight = innerHeight;
    pixelRatio = ratio;
    canvas.width = Math.ceil(viewportWidth * ratio);
    canvas.height = Math.ceil(viewportHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function mount() {
    if (disposed || host || !document.documentElement) return;
    host = document.createElement('agent-browser-recording-cursor');
    host.setAttribute('data-agent-browser-recording-cursor', '');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('inert', '');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;contain:layout style!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    shadow.appendChild(canvas);
    context = canvas.getContext('2d');
    document.documentElement.appendChild(host);
    resize();
  }

  function drawPointer(x, y, opacity, blur = 0) {
    if (!image.complete || !image.naturalWidth || opacity <= 0) return;
    context.save();
    context.globalAlpha = opacity;
    context.translate(x, y);
    if (pressed) context.scale(.8, .8);
    context.filter = blur ? 'blur(' + blur + 'px)' : 'none';
    context.shadowColor = '#0008';
    context.shadowOffsetY = 1;
    context.shadowBlur = 1;
    context.drawImage(image, -hotspotX, -hotspotY, width, height);
    context.restore();
  }

  function animate(time) {
    animationFrame = 0;
    if (disposed || !context) return;
    resize();
    const elapsed = Math.max(1, time - lastFrame);
    lastFrame = time;
    const previousX = visualX, previousY = visualY;
    // A dragged control follows the delivered input point, so its pointer must
    // not lag behind it. Apply visual easing only to free pointer movement.
    const blend = pressed ? 1 : 1 - Math.exp(-elapsed / 13);
    visualX += (targetX - visualX) * blend;
    visualY += (targetY - visualY) * blend;

    // A stable, viewport-sized canvas damage region is intentional. Chromium's
    // AnimatedContentSampler can lock onto a preceding drag's damage rectangle
    // and reject smaller moving DOM cursor regions for ~250 ms. Clearing this
    // single recording-only surface keeps cursor and page capture in sync.
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    for (let i = ripples.length - 1; i >= 0; i--) {
      const ripple = ripples[i];
      const progress = (time - ripple.time) / 180;
      if (progress >= 1) { ripples.splice(i, 1); continue; }
      const eased = 1 - (1 - Math.max(0, progress)) ** 2;
      context.save();
      context.globalAlpha = .2 + .3 * eased;
      context.fillStyle = '#60a5fa66';
      context.strokeStyle = '#60a5fa';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(ripple.x, ripple.y, 8 + 24 * eased, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    }
    if (positioned) {
      const dx = visualX - previousX, dy = visualY - previousY;
      const length = Math.hypot(dx, dy);
      const speed = length / elapsed;
      const distance = Math.min(24, speed * 18);
      if (length > 0) {
        drawPointer(visualX - dx / length * distance, visualY - dy / length * distance,
          Math.min(.28, Math.max(0, (speed - .08) * .32)), 2.5);
      }
      drawPointer(visualX, visualY, 1);
    }
    if (ripples.length || (positioned && Math.hypot(targetX - visualX, targetY - visualY) > .01)) {
      startAnimation();
    }
  }

  function startAnimation() {
    if (!disposed && !animationFrame) animationFrame = requestAnimationFrame(animate);
  }

  function update(event) {
    if (!event.isTrusted || event.pointerType !== 'mouse') return;
    mount();
    targetX = event.clientX;
    targetY = event.clientY;
    if (!positioned || event.type === 'pointerdown' || event.type === 'pointerup') {
      visualX = targetX;
      visualY = targetY;
      lastFrame = performance.now();
    }
    positioned = true;
    pressed = event.buttons !== 0;
    if (event.type === 'pointerdown') ripples.push({ x: targetX, y: targetY, time: performance.now() });
    startAnimation();
  }

  function listen(type, handler) {
    addEventListener(type, handler, { capture: true, passive: true });
    removers.push(() => removeEventListener(type, handler, true));
  }
  image.onload = startAnimation;
  image.src = config.imageDataUrl || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L14 8.5L7.5 10L4 16Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>');
  listen('pointermove', update);
  listen('pointerdown', update);
  listen('pointerup', update);
  listen('pointerout', event => {
    if (!event.relatedTarget || event.relatedTarget.localName === 'iframe') {
      positioned = false;
      startAnimation();
    }
  });
  listen('resize', startAnimation);
  listen('DOMContentLoaded', mount);
  mount();
  globalThis.__agentBrowserRecordingCursorCleanup = () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    removers.forEach(remove => remove());
    image.onload = null;
    host?.remove();
    delete globalThis.__agentBrowserRecordingCursorCleanup;
  };
})();
