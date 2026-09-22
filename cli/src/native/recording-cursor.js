(() => {
  globalThis.__agentBrowserRecordingCursorCleanup?.();
  const config = globalThis.__agentBrowserRecordingCursorConfig || {};
  const size = Math.max(1, Number(config.size) || 28);
  const width = Math.max(1, Number(config.width) || size);
  const height = Math.max(1, Number(config.height) || size);
  const hotspotX = Math.max(0, Number(config.hotspotX) || 0);
  const hotspotY = Math.max(0, Number(config.hotspotY) || 0);
  let host, pointer, shadow;
  const removers = [];
  let disposed = false;

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
      .pointer { position: fixed; top: 0; left: 0; display: none; }
      svg, .cursor-image { display: block; width: ${width}px; height: ${height}px; overflow: visible; transform-origin: ${hotspotX}px ${hotspotY}px; filter: drop-shadow(0 1px 1px #0008); }
      .cursor-image { object-fit: fill; }
      .pressed svg, .pressed .cursor-image { transform: scale(.8); }
      .ripple { position: fixed; width: 16px; height: 16px; margin: -8px; border-radius: 50%; border: 2px solid #60a5fa; background: #60a5fa66; box-sizing: border-box; animation: ripple .18s ease-out forwards; }
      @keyframes ripple { from { transform: scale(1); opacity: .2; } to { transform: scale(4); opacity: .5; } }
    </style><div class="pointer"></div>`;
    pointer = shadow.querySelector('.pointer');
    if (config.imageDataUrl) {
      const image = document.createElement('img');
      image.className = 'cursor-image';
      image.alt = '';
      image.src = config.imageDataUrl;
      pointer.appendChild(image);
    } else {
      pointer.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0L14 8.5L7.5 10L4 16Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    }
    document.documentElement.appendChild(host);
  }

  function update(event) {
    if (!event.isTrusted || event.pointerType !== 'mouse') return;
    mount();
    if (!pointer) return;
    pointer.style.display = 'block';
    pointer.style.transform = `translate3d(${event.clientX - hotspotX}px,${event.clientY - hotspotY}px,0)`;
    pointer.classList.toggle('pressed', event.buttons !== 0);
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
    if ((!event.relatedTarget || event.relatedTarget.localName === 'iframe') && pointer) pointer.style.display = 'none';
  });
  listen('DOMContentLoaded', mount);
  mount();
  globalThis.__agentBrowserRecordingCursorCleanup = () => {
    disposed = true;
    removers.forEach(remove => remove());
    host?.remove();
    delete globalThis.__agentBrowserRecordingCursorCleanup;
  };
})();
