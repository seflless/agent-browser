(() => {
  globalThis.__agentBrowserRecordingCursorCleanup?.();
  const config = globalThis.__agentBrowserRecordingCursorConfig || {};
  const size = Math.max(1, Number(config.size) || 28);
  const removers = [];
  // Pointer Lab's accepted soft-disk preset, in CSS pixels/ms. Button state
  // is independent of movement; short clicks release from the current frame.
  let feedback = { radius: 16, opacity: 0, scale: 1, active: false };
  let feedbackTransition = null;
  const icons = {};
  let cursorType = 'default';
  let host, canvas, context;
  let disposed = false;
  let positioned = false;
  let pressed = false;
  let targetX = 0, targetY = 0, visualX = 0, visualY = 0;
  let lastFrame = 0, animationFrame = 0;
  let viewportWidth = 0, viewportHeight = 0, pixelRatio = 0;

  function sampleFeedback(time) {
    if (!feedbackTransition) return feedback;
    const { from, to, started, duration } = feedbackTransition;
    const progress = Math.min(1, Math.max(0, (time - started) / duration));
    const eased = 1 - (1 - progress) ** 3;
    return {
      radius: from.radius + (to.radius - from.radius) * eased,
      opacity: from.opacity + (to.opacity - from.opacity) * eased,
      scale: from.scale + (to.scale - from.scale) * eased,
      active: progress < 1,
    };
  }

  function transitionFeedback(down, time) {
    const from = sampleFeedback(time);
    if (down) {
      if (from.opacity === 0) from.radius = 16;
      from.opacity = Math.max(from.opacity, .16);
    }
    feedbackTransition = {
      from, started: time, duration: down ? 90 : 200,
      to: down ? { radius: 30, opacity: .2, scale: .94 } : { radius: 48, opacity: 0, scale: 1 },
    };
  }

  // Hit-test actual input coordinates, not the slightly eased visual pointer.
  // Read styles before canvas writes, after page event handlers have run.
  function resolveCursor() {
    if (!config.theme || !positioned) return 'default';
    let element = document.elementFromPoint(targetX, targetY);
    if (!element) return 'default';
    const shadowRoots = [];
    while (element.shadowRoot) {
      const root = element.shadowRoot;
      const inner = root.elementFromPoint?.(targetX, targetY);
      if (!inner || inner === element) break;
      shadowRoots.push(root);
      element = inner;
    }
    const style = getComputedStyle(element);
    // Custom CSS URLs have a required final keyword; use that semantic fallback.
    const keyword = style.cursor.split(',').pop().trim();
    if (keyword === 'none') return 'none';
    if (keyword !== 'auto') return keyword === 'pointer' || keyword === 'text' ? keyword : 'default';
    if (element.matches('input:not(:disabled)') && /^(text|search|email|url|tel|password|number)$/.test(element.type)) return 'text';
    if (element.matches('textarea:not(:disabled)') || element.isContentEditable) return 'text';
    if (element.closest('button,select,input') || style.userSelect === 'none' || style.webkitUserSelect === 'none') return 'default';

    // Caret APIs return the nearest text position, even over empty padding.
    // Require a neighboring character's actual bounds to contain the pointer.
    const caret = document.caretPositionFromPoint?.(targetX, targetY, { shadowRoots });
    const legacy = !caret && document.caretRangeFromPoint?.(targetX, targetY);
    const node = caret?.offsetNode || legacy?.startContainer;
    const offset = caret?.offset ?? legacy?.startOffset;
    if (node?.nodeType !== Node.TEXT_NODE || !element.contains(node)) return 'default';
    const parentStyle = getComputedStyle(node.parentElement);
    if (parentStyle.userSelect === 'none' || parentStyle.webkitUserSelect === 'none') return 'default';
    for (const index of [offset - 1, offset]) {
      if (index < 0 || index >= node.length) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      for (const rect of range.getClientRects()) {
        if (targetX >= rect.left && targetX <= rect.right && targetY >= rect.top && targetY <= rect.bottom) return 'text';
      }
    }
    return 'default';
  }

  function refreshCursor() {
    const next = resolveCursor();
    if (next === cursorType) return false;
    cursorType = next;
    // Diagnostic only; the overlay remains inert and absent from snapshots.
    host?.setAttribute('data-cursor-type', next);
    return true;
  }

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
    host.setAttribute('data-cursor-type', cursorType);
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
    if (cursorType === 'none') return;
    const icon = icons[cursorType] || icons.default;
    const { image, width, height, hotspotX, hotspotY } = icon;
    if (!image.complete || !image.naturalWidth || opacity <= 0) return;
    context.save();
    context.globalAlpha = opacity;
    context.translate(x, y);
    context.scale(feedback.scale, feedback.scale);
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
    const changedCursor = refreshCursor();
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
    feedback = sampleFeedback(time);
    if (!feedback.active) feedbackTransition = null;
    // Paint behind both the icon and its trail; never tint cursor artwork.
    // Once settled, a stationary held disk does not request animation frames.
    if (positioned && cursorType !== 'none' && feedback.opacity > 0) {
      context.save();
      context.globalAlpha = feedback.opacity;
      context.fillStyle = '#397ef3';
      context.beginPath();
      context.arc(visualX, visualY, feedback.radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    if (positioned) {
      const dx = visualX - previousX, dy = visualY - previousY;
      const length = Math.hypot(dx, dy);
      const speed = length / elapsed;
      const distance = Math.min(24, speed * 18);
      if (length > 0 && !changedCursor) {
        drawPointer(visualX - dx / length * distance, visualY - dy / length * distance,
          Math.min(.28, Math.max(0, (speed - .08) * .32)), 2.5);
      }
      drawPointer(visualX, visualY, 1);
    }
    if (feedback.active || (positioned && Math.hypot(targetX - visualX, targetY - visualY) > .01)) {
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
    const nextPressed = event.type !== 'pointercancel' && event.buttons !== 0;
    if (nextPressed !== pressed) transitionFeedback(nextPressed, performance.now());
    pressed = nextPressed;
    startAnimation();
  }

  function listen(type, handler) {
    addEventListener(type, handler, { capture: true, passive: true });
    removers.push(() => removeEventListener(type, handler, true));
  }
  for (const [name, entry] of Object.entries(config.theme || { default: config })) {
    const image = new Image();
    icons[name] = {
      image,
      width: Math.max(1, Number(entry.width) || size),
      height: Math.max(1, Number(entry.height) || size),
      hotspotX: Math.max(0, Number(entry.hotspotX) || 0),
      hotspotY: Math.max(0, Number(entry.hotspotY) || 0),
    };
    image.onload = startAnimation;
    image.src = entry.imageDataUrl || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L14 8.5L7.5 10L4 16Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>');
  }
  listen('pointermove', update);
  listen('pointerdown', update);
  listen('pointerup', update);
  listen('pointercancel', update);
  listen('blur', () => {
    if (pressed) transitionFeedback(false, performance.now());
    pressed = false;
    positioned = false;
    startAnimation();
  });
  listen('pointerout', event => {
    if (!event.relatedTarget || event.relatedTarget.localName === 'iframe') {
      positioned = false;
      startAnimation();
    }
  });
  listen('resize', startAnimation);
  listen('scroll', startAnimation);
  listen('DOMContentLoaded', mount);
  mount();
  // CSS can change under a stationary pointer (menus, keyboard tools, timers).
  // Poll only while themed and visible; do not keep painting an idle canvas.
  const styleTimer = config.theme ? setInterval(() => {
    if (!disposed && positioned && !document.hidden && !animationFrame && refreshCursor()) startAnimation();
  }, 80) : 0;
  globalThis.__agentBrowserRecordingCursorCleanup = () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    removers.forEach(remove => remove());
    clearInterval(styleTimer);
    Object.values(icons).forEach(icon => { icon.image.onload = null; });
    host?.remove();
    delete globalThis.__agentBrowserRecordingCursorCleanup;
  };
})();
