(() => {
  globalThis.__agentBrowserRecordingCursorCleanup?.();
  const config = globalThis.__agentBrowserRecordingCursorConfig || {};
  const size = Math.max(1, Number(config.size) || 28);
  const width = Math.max(1, Number(config.width) || size);
  const height = Math.max(1, Number(config.height) || size);
  const hotspotX = Math.max(0, Number(config.hotspotX) || 0);
  const hotspotY = Math.max(0, Number(config.hotspotY) || 0);
  let host, pointer, motion, shadow;
  const removers = [];
  let disposed = false;
  let targetX = 0;
  let targetY = 0;
  let visualX = 0;
  let visualY = 0;
  let previousVisualX = 0;
  let previousVisualY = 0;
  let lastFrame = 0;
  let animationFrame = 0;
  let positioned = false;

  function mount() {
    if (disposed || host || !document.documentElement) return;
    host = document.createElement('agent-browser-recording-cursor');
    host.setAttribute('data-agent-browser-recording-cursor', '');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('inert', '');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;contain:layout style!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host, * { pointer-events: none !important; }
      .pointer, .motion { position: fixed; top: 0; left: 0; display: none; will-change: transform; }
      .pointer { z-index: 1; }
      .motion { z-index: 0; opacity: 0; pointer-events: none; will-change: transform, opacity, filter; }
      svg, .cursor-image { display: block; width: ${width}px; height: ${height}px; overflow: visible; transform-origin: ${hotspotX}px ${hotspotY}px; filter: drop-shadow(0 1px 1px #0008); }
      .cursor-image { object-fit: fill; }
      .pressed svg, .pressed .cursor-image { transform: scale(.8); }
      .ripple { position: fixed; width: 16px; height: 16px; margin: -8px; border-radius: 50%; border: 2px solid #60a5fa; background: #60a5fa66; box-sizing: border-box; animation: ripple .18s ease-out forwards; }
      @keyframes ripple { from { transform: scale(1); opacity: .2; } to { transform: scale(4); opacity: .5; } }
    </style><div class="motion"></div><div class="pointer"></div>`;
    pointer = shadow.querySelector('.pointer');
    motion = shadow.querySelector('.motion');
    if (config.imageDataUrl) {
      const image = document.createElement('img');
      image.className = 'cursor-image';
      image.alt = '';
      image.src = config.imageDataUrl;
      pointer.appendChild(image);
      motion.appendChild(image.cloneNode());
    } else {
      pointer.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0L14 8.5L7.5 10L4 16Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      motion.innerHTML = pointer.innerHTML;
    }
    document.documentElement.appendChild(host);
  }

  function paint(x, y, speed = 0) {
    if (!pointer || !motion) return;
    pointer.style.transform = `translate3d(${x - hotspotX}px,${y - hotspotY}px,0)`;
    const distance = Math.min(24, speed * 18);
    const deltaX = x - previousVisualX;
    const deltaY = y - previousVisualY;
    const length = Math.hypot(deltaX, deltaY) || 1;
    motion.style.transform = `translate3d(${x - hotspotX - deltaX / length * distance}px,${y - hotspotY - deltaY / length * distance}px,0)`;
    motion.style.opacity = `${Math.min(.28, Math.max(0, (speed - .08) * .32))}`;
    motion.style.filter = `blur(${Math.min(3.5, speed * 2.5)}px)`;
  }

  function animate(time) {
    animationFrame = 0;
    if (disposed || !positioned) return;
    const elapsed = Math.min(34, Math.max(1, time - lastFrame));
    lastFrame = time;
    // Blend to the most recently delivered CDP point on each compositor
    // frame. This avoids bursty input responses appearing as a staircase.
    const blend = 1 - Math.exp(-elapsed / 13);
    visualX += (targetX - visualX) * blend;
    visualY += (targetY - visualY) * blend;
    const speed = Math.hypot(visualX - previousVisualX, visualY - previousVisualY) / elapsed;
    paint(visualX, visualY, speed);
    previousVisualX = visualX;
    previousVisualY = visualY;
    animationFrame = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (!animationFrame) animationFrame = requestAnimationFrame(animate);
  }

  function update(event) {
    if (!event.isTrusted || event.pointerType !== 'mouse') return;
    mount();
    if (!pointer || !motion) return;
    pointer.style.display = 'block';
    motion.style.display = 'block';
    targetX = event.clientX;
    targetY = event.clientY;
    if (!positioned || event.type === 'pointerdown' || event.type === 'pointerup') {
      visualX = targetX;
      visualY = targetY;
      previousVisualX = visualX;
      previousVisualY = visualY;
      positioned = true;
      lastFrame = performance.now();
      paint(visualX, visualY);
    }
    pointer.classList.toggle('pressed', event.buttons !== 0);
    motion.classList.toggle('pressed', event.buttons !== 0);
    startAnimation();
    if (event.type === 'pointerdown') {
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
      shadow.insertBefore(ripple, pointer);
    }
  }

  function listen(type, handler) {
    addEventListener(type, handler, { capture: true, passive: true });
    removers.push(() => removeEventListener(type, handler, true));
  }

  listen('pointermove', update);
  listen('pointerdown', update);
  listen('pointerup', update);
  listen('pointerout', event => {
    if ((!event.relatedTarget || event.relatedTarget.localName === 'iframe') && pointer) {
      pointer.style.display = 'none';
      motion.style.display = 'none';
      positioned = false;
    }
  });
  listen('DOMContentLoaded', mount);
  mount();
  globalThis.__agentBrowserRecordingCursorCleanup = () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    removers.forEach(remove => remove());
    host?.remove();
    delete globalThis.__agentBrowserRecordingCursorCleanup;
  };
})();
