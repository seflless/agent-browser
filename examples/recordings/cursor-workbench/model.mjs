// Pure, seekable model. Milliseconds and CSS pixels throughout; movement is
// independent of preview frame rate. The Rust dispatcher can still run late.
export const INITIAL = { x: 72, y: 92 };
export const DEFAULTS = {
  cursor: { scale: 0.4, type: 'auto' },
  press: { duration: 90, radius: 16, opacity: 0.16, scale: 0.94 },
  hold: { radius: 30, opacity: 0.2, width: 1.5 },
  release: { duration: 200, radius: 48 },
  appearance: { color: '#397ef3', filled: true, hotspot: false },
};
export const SCENARIOS = {
  click: [
    { at: 0, type: 'move', x: 580, y: 100, duration: 850, seed: 42 },
    { at: 970, type: 'down' }, { at: 1037, type: 'up' },
    { at: 1550, type: 'move', x: 410, y: 180, duration: 600, seed: 42 },
  ],
  text: [
    { at: 0, type: 'move', x: 120, y: 220, duration: 650, seed: 42 },
    { at: 770, type: 'down' },
    { at: 880, type: 'move', x: 408, y: 220, duration: 1450, seed: 42 },
    { at: 2480, type: 'up' },
    { at: 2980, type: 'move', x: 620, y: 292, duration: 650, seed: 42 },
  ],
  drag: [
    { at: 0, type: 'move', x: 187, y: 320, duration: 700, seed: 42 },
    { at: 860, type: 'down' },
    { at: 1000, type: 'move', x: 563, y: 320, duration: 1400, seed: 42 },
    { at: 2580, type: 'up' },
    { at: 3100, type: 'move', x: 640, y: 200, duration: 600, seed: 42 },
  ],
};
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const easeOut = t => 1 - (1 - clamp(t)) ** 3;
const mix = (a, b, t) => a + (b - a) * t;

// Same u64 mixer, curve, and cubic ease-out as interpolated_mouse_point in Rust.
export function humanPoint(from, to, progress, seed = 42) {
  const p = easeOut(progress);
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const mixed = BigInt.asUintN(64, BigInt(seed) * 6364136223846793005n + 1442695040888963407n);
  const unit = Number(mixed >> 11n) / 2 ** 53;
  const bend = (unit * 2 - 1) * Math.min(distance * 0.08, 36);
  const curve = 4 * p * (1 - p) * bend;
  return { x: mix(from.x, to.x, p) - (distance ? dy / distance * curve : 0),
    y: mix(from.y, to.y, p) + (distance ? dx / distance * curve : 0) };
}

export function validateEvents(events) {
  if (!Array.isArray(events) || !events.length || events.length > 100) throw Error('Use 1–100 events.');
  let end = 0, down = false;
  for (const [i, event] of events.entries()) {
    if (!event || typeof event !== 'object') throw Error(`Event ${i + 1}: expected an event object.`);
    if (!Number.isInteger(event.at) || event.at < end || event.at > 60000) throw Error(`Event ${i + 1}: time must follow the previous event/move (≤ 60000 ms).`);
    if (!['move', 'down', 'up'].includes(event.type)) throw Error(`Event ${i + 1}: unknown type.`);
    const keys = event.type === 'move' ? ['at', 'type', 'x', 'y', 'duration', 'seed'] : ['at', 'type'];
    if (Object.keys(event).some(key => !keys.includes(key))) throw Error(`Event ${i + 1}: unknown parameter.`);
    if (event.type === 'move') {
      if (!Number.isInteger(event.duration) || event.duration < 1 || event.duration > 10000) throw Error(`Event ${i + 1}: duration must be 1–10000 ms.`);
      if (![event.x, event.y, event.seed].every(Number.isSafeInteger) || event.x < 0 || event.x > 720 || event.y < 0 || event.y > 400 || event.seed < 0) throw Error(`Event ${i + 1}: coordinates must fit 720×400; use nonnegative integer seed.`);
      end = event.at + event.duration;
    } else {
      if ((event.type === 'down') === down) throw Error(`Event ${i + 1}: down/up must alternate.`);
      down = event.type === 'down'; end = event.at;
    }
  }
  if (down) throw Error('Finish the sequence with pointer-up.');
  return events;
}

export function duration(events) {
  return Math.max(...events.map(e => e.at + (e.duration || 0))) + 600;
}

// Continuous on quick releases/re-presses: each transition starts from the
// sampled previous state, not a reset radius/opacity/scale. The filled disk is
// composited behind the cursor, grows on press, and stays static while held.
export function feedbackAt(events, time, config = DEFAULTS) {
  let value = { radius: config.press.radius, opacity: 0, scale: 1 };
  let transition = null, phase = 'up';
  const evaluate = at => {
    if (!transition) return value;
    const t = easeOut((at - transition.at) / transition.duration);
    return Object.fromEntries(['radius', 'opacity', 'scale'].map(k => [k, mix(transition.from[k], transition.to[k], t)]));
  };
  for (const event of events) {
    if (event.at > time) break;
    if (event.type === 'move') continue;
    value = evaluate(event.at);
    if (transition && event.at >= transition.at + transition.duration) phase = phase === 'press' ? 'hold' : 'up';
    if (event.type === 'down') {
      // The immediate visible onset is intentional; all subsequent motion is continuous.
      value = { ...value, opacity: Math.max(value.opacity, config.press.opacity) };
      if (phase === 'up') value.radius = config.press.radius;
      transition = { at: event.at, duration: config.press.duration, from: value,
        to: { radius: config.hold.radius, opacity: config.hold.opacity, scale: config.press.scale } };
      phase = 'press';
    } else {
      transition = { at: event.at, duration: config.release.duration, from: value,
        to: { radius: config.release.radius, opacity: 0, scale: 1 } };
      phase = 'release';
    }
  }
  value = evaluate(time);
  if (transition && time >= transition.at + transition.duration) phase = phase === 'press' ? 'hold' : 'up';
  return { ...value, phase };
}

export function sample(events, time, config = DEFAULTS) {
  let point = { ...INITIAL }, pressed = false, moving = false, pressPoint = null;
  for (const e of events) {
    if (e.at > time) break;
    if (e.type === 'move') {
      const progress = clamp((time - e.at) / e.duration);
      point = humanPoint(point, e, progress, e.seed);
      moving = progress < 1;
    } else { pressed = e.type === 'down'; if (pressed) pressPoint = { ...point }; }
  }
  return { ...point, pressed, moving, pressPoint, ...feedbackAt(events, time, config) };
}

// This file exports gestures only, not browser setup, recording, or CSS cursors.
// Run against a matching 720×400 fixture; translate coordinates for another UI.
export function compileBatch(events) {
  validateEvents(events);
  const commands = [['mouse', 'move', `${INITIAL.x}`, `${INITIAL.y}`, '--duration', '1', '--steps', '1']];
  let end = 0;
  for (const e of events) {
    if (e.at > end) commands.push(['wait', `${e.at - end}`]);
    if (e.type === 'move') {
      commands.push(['mouse', 'move', `${e.x}`, `${e.y}`, '--duration', `${e.duration}`, '--steps', `${Math.min(240, Math.max(1, Math.round(e.duration / 16.67)))}`, '--human', '--seed', `${e.seed}`]);
      end = e.at + e.duration;
    } else { commands.push(['mouse', e.type]); end = e.at; }
  }
  commands.push(['wait', `${duration(events) - end}`]);
  return commands;
}
