import { createDialKit, createDialRoot } from './vendor/index.js';
import { DEFAULTS, SCENARIOS, sample, duration, validateEvents, compileBatch, clamp } from './model.mjs';
import { REFERENCE } from './reference.mjs';

const $ = selector => document.querySelector(selector);
const canvas = $('#preview'), ctx = canvas.getContext('2d');
const state = { scenario: 'text', events: structuredClone(SCENARIOS.text), time: 0, playing: false, selected: 0, config: structuredClone(DEFAULTS) };
let raf = 0, last = 0, syncing = false, valid = true;
const icons = {};
const ASSETS = { default: ['left_ptr.svg', 59, 28], pointer: ['hand2.svg', 67, 30], text: ['xterm.svg', 100, 104] };
for (const [type, [file, x, y]] of Object.entries(ASSETS)) {
  const image = new Image(); image.src = `./assets/${file}`;
  icons[type] = { image, x, y };
  image.onload = () => render();
  image.onerror = () => { $('#error').textContent = `Could not load ${file}. Rebuild with the cursor asset folder.`; };
}

const root = createDialRoot({ target: $('#dials'), mode: 'inline', theme: 'dark' });
const feedback = createDialKit('Pointer feedback', {
  cursor: { scale: [0.4, 0.15, 1, 0.01], type: { type: 'select', options: ['auto', 'default', 'pointer', 'text'] } },
  press: { duration: [90, 20, 300, 5], radius: [16, 5, 60, 0.5], opacity: [0.16, 0, 1, 0.01], scale: [0.94, 0.7, 1, 0.01] },
  hold: { radius: [30, 8, 80, 0.5], opacity: [0.2, 0, 0.8, 0.01], width: [1.5, 0.5, 4, 0.1] },
  release: { duration: [200, 30, 500, 5], radius: [48, 10, 120, 0.5] },
  appearance: { filled: true, color: '#397ef3', hotspot: false },
}, { id: 'pointer-lab-feedback-v2', persist: true });
const eventDial = createDialKit('Selected event', { startMs: [0, 0, 60000, 10], durationMs: [650, 1, 10000, 10], x: [120, 0, 720, 1], y: [220, 0, 400, 1], seed: [42, 0, 9999, 1] }, { id: 'pointer-lab-event', defaultCollapsed: true });

function message(text) { $('#notice').textContent = text; }
function check() {
  try { validateEvents(state.events); valid = true; $('#error').textContent = ''; }
  catch (error) { valid = false; $('#error').textContent = error.message; pause(); }
  $('#export-batch').disabled = !valid;
  $('#export-preset').disabled = !valid;
  $('#play').disabled = !valid;
  $('#restart').disabled = !valid;
  return valid;
}
function selectEvent(index) {
  state.selected = index;
  const e = state.events[index]; if (!e) return;
  syncing = true;
  eventDial.updateConfig(e.type === 'move'
    ? { startMs: [e.at, 0, 60000, 10], durationMs: [e.duration, 1, 10000, 10], x: [e.x, 0, 720, 1], y: [e.y, 0, 400, 1], seed: [e.seed, 0, 9999, 1] }
    : { startMs: [e.at, 0, 60000, 10] });
  eventDial.setValues({ startMs: e.at, ...(e.type === 'move' ? { durationMs: e.duration, x: e.x, y: e.y, seed: e.seed } : {}) });
  syncing = false;
  renderTimeline();
}
function updatePrompt() {
  const changed = [];
  const units = { duration: 'ms', radius: 'px', width: 'px', opacity: '', scale: '', type: '', color: '', hotspot: '' };
  for (const [group, fields] of Object.entries(DEFAULTS)) for (const [key, value] of Object.entries(fields)) {
    const current = state.config[group][key];
    if (current !== value) changed.push(`${group} ${key} to ${current}${units[key]}`);
  }
  $('#prompt').textContent = `Apply Pointer Lab’s press → hold → release prototype to the agent-browser recording cursor. Draw a ${state.config.appearance.filled ? 'filled translucent disk' : 'hollow ring'} behind the cursor icon: expand on press, stay at that size during holds and drags, then pulse larger and fade on release. Keep movement independent and the hotspot fixed; transition continuously even when a click releases before its press animation finishes. `
    + (changed.length ? `Compared with the quiet preset, change ${changed.join('; ')}. ` : 'Use the quiet preset defaults. ')
    + 'Do not change gesture timings or CSS cursor detection. Soft disk is already the native recorder default; apply only the requested differences.';
}
function rounded(x, y, width, height, radius, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function label(text, x, y, size = 12, color = '#74806e', weight = 400) {
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillText(text, x, y);
}
function render() {
  if (!valid) return;
  const c = state.config, s = sample(state.events, state.time, c);
  // Fixed logical scene; resize is separate from animation. No per-frame layout reads.
  ctx.setTransform(canvas.width / 720, 0, 0, canvas.height / 400, 0, 0);
  ctx.clearRect(0, 0, 720, 400); ctx.fillStyle = '#f5f5ef'; ctx.fillRect(0, 0, 720, 400);
  ctx.fillStyle = '#e1e4d9';
  for (let x = 24; x < 720; x += 24) for (let y = 24; y < 400; y += 24) ctx.fillRect(x, y, 1, 1);
  label('A small gesture. A clear signal.', 48, 72, 23, '#263320', 600);
  label('Tune the feedback, not the content beneath it.', 48, 97, 12);
  const clicked = state.events.some(e => e.type === 'up' && e.at <= state.time && sample(state.events, e.at).x > 500 && sample(state.events, e.at).y < 125);
  rounded(510, 79, 140, 42, 9, clicked ? '#cceaa9' : '#263b20');
  label(clicked ? 'Saved' : 'Save changes', clicked ? 558 : 537, 105, 12, clicked ? '#263b20' : '#f4f9ea', 600);
  rounded(88, 161, 555, 96, 12, '#fffefb', '#daddd0'); label('SELECTABLE TEXT', 120, 189, 9);
  const down = state.events.find(e => e.type === 'down' && e.at <= state.time);
  const release = down && state.events.find(e => e.type === 'up' && e.at > down.at && e.at <= state.time);
  const gesture = release ? sample(state.events, release.at, c) : s;
  const startPoint = down && sample(state.events, down.at, c);
  ctx.font = '23px system-ui, sans-serif'; const textWidth = ctx.measureText('Select these words, naturally.').width;
  if (startPoint && Math.abs(startPoint.y - 220) < 25) {
    ctx.fillStyle = '#b6d6ff'; ctx.fillRect(120, 202, clamp(gesture.x - 120, 0, textWidth), 29);
  }
  label('Select these words, naturally.', 120, 226, 23, '#293327');
  ctx.setLineDash([5, 5]); rounded(481, 287, 164, 66, 10, '#edf2e6', '#a1ae92'); ctx.setLineDash([]);
  label('Drop here', 536, 325, 13);
  let cardX = 110, cardY = 289;
  const dragging = startPoint && Math.abs(startPoint.y - 320) < 35 && startPoint.x < 300;
  if (dragging) { cardX += gesture.x - startPoint.x; cardY += gesture.y - startPoint.y; }
  const dropped = dragging && release && gesture.x > 481 && gesture.x < 645 && gesture.y > 287 && gesture.y < 353;
  rounded(cardX, cardY, 154, 62, 9, dropped ? '#cfedab' : '#fffefb', '#abb49f');
  label(dropped ? 'Card delivered' : 'Drag this card', cardX + 28, cardY + 36, 13, '#35432d', 500);
  let type = c.cursor.type;
  if (type === 'auto') type = s.x > 510 && s.x < 650 && s.y > 79 && s.y < 121 ? 'pointer' : (s.y > 198 && s.y < 234 && s.x >= 120 && s.x <= 120 + textWidth) ? 'text' : 'default';
  const icon = icons[type];
  // Feedback belongs behind the icon, never over the I-beam or arrow artwork.
  if (s.opacity > 0.001) {
    ctx.save(); ctx.globalAlpha = s.opacity; ctx.fillStyle = c.appearance.color;
    ctx.strokeStyle = c.appearance.color; ctx.lineWidth = c.hold.width;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    if (c.appearance.filled) ctx.fill(); else ctx.stroke();
    ctx.restore();
  }
  if (icon.image.complete && icon.image.naturalWidth) {
    ctx.save(); ctx.translate(s.x, s.y); const scale = c.cursor.scale * s.scale;
    ctx.scale(scale, scale); ctx.drawImage(icon.image, -icon.x, -icon.y, 200, 200); ctx.restore();
  }
  if (c.appearance.hotspot) {
    ctx.strokeStyle = '#e53b45'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke();
  }
  $('#phase').textContent = s.phase.toUpperCase(); $('#motion').textContent = s.moving ? 'MOVING' : 'STILL';
  $('#cursor-type').textContent = type.toUpperCase(); $('#coords').textContent = `${s.x.toFixed(0)}, ${s.y.toFixed(0)}`;
  $('#clock').textContent = `${(state.time / 1000).toFixed(3)} s`;
  $('#scrubber').value = state.time;
  const head = $('.playhead'); if (head) head.style.left = `${state.time / duration(state.events) * 100}%`;
}
function renderTimeline() {
  const total = duration(state.events);
  $('#scrubber').max = total; $('#end-time').textContent = `${total} ms`;
  const tracks = $('#tracks'), list = $('#event-list'); tracks.replaceChildren(); list.replaceChildren();
  state.events.forEach((e, i) => {
    const clip = document.createElement('button'); clip.className = `clip ${e.type}`;
    clip.style.left = `${e.at / total * 100}%`; clip.style.top = `${e.type === 'move' ? 2 : e.type === 'down' ? 34 : 64}px`;
    clip.style.width = `${Math.max(5, (e.duration || 130) / total * 100)}%`;
    clip.textContent = e.type; clip.setAttribute('aria-label', `Edit event ${i + 1}: ${e.type} at ${e.at} ms`);
    clip.setAttribute('aria-pressed', `${i === state.selected}`);
    clip.onclick = () => { pause(); state.time = e.at; selectEvent(i); eventDial.setOpen(true); render(); };
    tracks.append(clip);
    const row = document.createElement('button'); row.className = 'event-row'; row.setAttribute('aria-pressed', `${i === state.selected}`);
    for (const value of [i + 1, `${e.at} ms`, e.type, e.type === 'move' ? `${e.x},${e.y} · ${e.duration} ms · seed ${e.seed}` : 'left button']) {
      const cell = document.createElement('span'); cell.textContent = value; row.append(cell);
    }
    row.onclick = clip.onclick; list.append(row);
  });
  const head = document.createElement('div'); head.className = 'playhead'; tracks.append(head);
  render();
}
function pause() { state.playing = false; cancelAnimationFrame(raf); raf = 0; $('#play').textContent = 'Play'; }
function frame(now) {
  if (!state.playing) return;
  state.time += (now - last) * Number($('#speed').value); last = now;
  const total = duration(state.events);
  if (state.time >= total) {
    if ($('#loop').checked) state.time %= total;
    else { state.time = total; pause(); }
  }
  render(); if (state.playing) raf = requestAnimationFrame(frame);
}
function play(restart = false) {
  if (!valid) return;
  pause(); if (restart || state.time >= duration(state.events)) state.time = 0;
  state.playing = true; last = performance.now(); $('#play').textContent = 'Pause'; raf = requestAnimationFrame(frame);
}
function chooseScenario(name) {
  pause(); state.scenario = name; state.events = structuredClone(SCENARIOS[name]); state.time = 0;
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', `${button.dataset.scenario === name}`));
  check(); selectEvent(0); render();
}
function download(name, content) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  message(`Saved ${name}.`);
}
feedback.subscribe(values => { state.config = values; render(); updatePrompt(); });
eventDial.subscribe(values => {
  if (syncing) return;
  const e = state.events[state.selected]; if (!e) return;
  pause(); e.at = Math.round(values.startMs);
  if (e.type === 'move') Object.assign(e, { duration: Math.round(values.durationMs), x: Math.round(values.x), y: Math.round(values.y), seed: Math.round(values.seed) });
  check(); renderTimeline();
}, false);
document.querySelectorAll('[data-scenario]').forEach(button => button.onclick = () => chooseScenario(button.dataset.scenario));
$('#play').onclick = () => state.playing ? pause() : play(); $('#restart').onclick = () => play(true);
$('#scrubber').oninput = event => { pause(); state.time = Number(event.target.value); render(); };
$('#preset').onchange = event => {
  feedback.resetValues();
  if (event.target.value === 'clear') feedback.setValues({ press: { radius: 20, opacity: 0.22, duration: 100 }, hold: { radius: 38, opacity: 0.28 }, release: { duration: 240, radius: 60 } });
  if (event.target.value === 'minimal') feedback.setValues({ press: { radius: 14, opacity: 0.1, scale: 1, duration: 65 }, hold: { radius: 24, opacity: 0.12 }, release: { duration: 160, radius: 40 } });
};
$('#add-move').onclick = () => { pause(); state.events.push({ at: duration(state.events) - 400, type: 'move', x: 360, y: 140, duration: 600, seed: 42 }); check(); selectEvent(state.events.length - 1); eventDial.setOpen(true); };
$('#add-click').onclick = () => { pause(); const at = duration(state.events) - 400; state.events.push({ at, type: 'down' }, { at: at + 120, type: 'up' }); check(); selectEvent(state.events.length - 2); eventDial.setOpen(true); };
$('#delete-event').onclick = () => { pause(); if (state.events.length <= 1) return; state.events.splice(state.selected, 1); check(); selectEvent(Math.max(0, state.selected - 1)); };
$('#reset-sequence').onclick = () => chooseScenario(state.scenario);
$('#copy-prompt').onclick = async () => {
  try { await navigator.clipboard.writeText($('#prompt').textContent); message('Copied apply instructions.'); }
  catch { const range = document.createRange(); range.selectNodeContents($('#prompt')); getSelection().removeAllRanges(); getSelection().addRange(range); message('Select and copy the highlighted instructions.'); }
};
$('#export-preset').onclick = () => download('pointer-lab-preset.json', { version: 2, scenario: state.scenario, viewport: [720, 400], feedback: state.config, events: state.events });
$('#export-batch').onclick = () => { try { download('pointer-lab.commands.json', compileBatch(state.events)); } catch (error) { message(error.message); } };
$('#import-preset').onchange = async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 200000) throw Error('Preset is too large.');
    const value = JSON.parse(await file.text());
    if (value.version !== 2 || !Object.hasOwn(SCENARIOS, value.scenario)) throw Error('Use a version 2 filled-disk preset; old ring presets are not compatible.');
    validateEvents(value.events);
    // Only known fields reach Dialkit; reject non-finite or out-of-range values.
    const limits = { cursor: { scale: [0.15, 1] }, press: { duration: [20, 300], radius: [5, 60], opacity: [0, 1], scale: [0.7, 1] }, hold: { radius: [8, 80], opacity: [0, 0.8], width: [0.5, 4] }, release: { duration: [30, 500], radius: [10, 120] } };
    const config = structuredClone(DEFAULTS);
    for (const [group, fields] of Object.entries(limits)) for (const [key, [min, max]] of Object.entries(fields)) {
      const n = value.feedback?.[group]?.[key]; if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw Error(`Invalid ${group}.${key}`); config[group][key] = n;
    }
    if (!['auto', 'default', 'pointer', 'text'].includes(value.feedback.cursor.type)) throw Error('Invalid cursor type.');
    if (typeof value.feedback.appearance?.color !== 'string' || !CSS.supports('color', value.feedback.appearance.color)) throw Error('Invalid color.');
    config.cursor.type = value.feedback.cursor.type; config.appearance.color = value.feedback.appearance.color; config.appearance.hotspot = value.feedback.appearance.hotspot === true;
    if (typeof value.feedback.appearance.filled !== 'boolean') throw Error('Filled must be a boolean.');
    config.appearance.filled = value.feedback.appearance.filled;
    chooseScenario(value.scenario); state.events = value.events; feedback.setValues(config); check(); selectEvent(0); message('Loaded preset and events.');
  } catch (error) { message(`Could not load preset: ${error.message}`); }
  event.target.value = '';
};
for (const group of REFERENCE) {
  const section = document.createElement('div'); section.className = 'ref-group';
  const heading = document.createElement('h3'); heading.textContent = group.title; section.append(heading);
  const wrapper = document.createElement('div'); wrapper.className = 'table-scroll'; const table = document.createElement('table');
  const thead = document.createElement('thead'), header = document.createElement('tr');
  for (const title of ['FUNCTION / FILE', 'PARAMETERS / CONTRACT', 'PURPOSE / NOTES']) { const th = document.createElement('th'); th.textContent = title; header.append(th); }
  thead.append(header); table.append(thead); const tbody = document.createElement('tbody');
  for (const row of group.rows) { const tr = document.createElement('tr'); row.forEach((text, i) => { const td = document.createElement('td'); const child = document.createElement(i < 2 ? 'code' : 'span'); child.textContent = text; td.append(child); tr.append(td); }); tbody.append(tr); }
  table.append(tbody); wrapper.append(table); section.append(wrapper); $('#reference-content').append(section);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting) pause(); }); observer.observe(canvas);
const resize = () => { const ratio = Math.min(devicePixelRatio || 1, 3); const bounds = canvas.getBoundingClientRect(); canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio); render(); };
addEventListener('resize', resize); resize(); chooseScenario('text');
// Read-only inspection hooks keep browser checks independent of Dialkit internals.
window.pointerLab = { snapshot: () => structuredClone({ ...state, valid, batch: valid ? compileBatch(state.events) : null }), sample: time => sample(state.events, time, state.config) };
addEventListener('pagehide', () => { pause(); observer.disconnect(); root.destroy(); feedback.destroy(); eventDial.destroy(); });
