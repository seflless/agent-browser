import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, feedbackAt } from '../examples/recordings/cursor-workbench/model.mjs';

const source = readFileSync(new URL('../cli/src/native/recording-cursor.js', import.meta.url), 'utf8');
function overlay() {
  let time = 0, frameId = 0, removed = false;
  const frames = new Map(), listeners = new Map(), calls = [];
  const context = new Proxy({}, { get: (object, key) => object[key] ?? ((...args) => calls.push([key, ...args])), set: (object, key, value) => { object[key] = value; calls.push([key, value]); return true; } });
  const canvas = { style: {}, getContext: () => context };
  const host = { style: {}, setAttribute() {}, attachShadow: () => ({ appendChild() {} }), remove: () => { removed = true; } };
  const sandbox = {
    document: { documentElement: { appendChild() {} }, createElement: tag => tag === 'canvas' ? canvas : host },
    Image: class { complete = true; naturalWidth = 200; },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 2,
    performance: { now: () => time },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type), clearInterval() {},
  };
  runInNewContext(source, sandbox);
  return {
    event(type, at, buttons, x = 200, y = 150) { time = at; listeners.get(type)?.({ type, isTrusted: true, pointerType: 'mouse', buttons, clientX: x, clientY: y }); },
    tick(at) { time = at; calls.length = 0; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(at)); return calls; },
    get pending() { return frames.size; },
    close() { sandbox.__agentBrowserRecordingCursorCleanup(); assert.equal(removed, true); assert.equal(frames.size, 0); assert.equal(listeners.size, 0); },
  };
}
function painted(calls) {
  return { radius: calls.find(call => call[0] === 'arc')?.[3], opacity: calls.find(call => call[0] === 'globalAlpha')?.[1], scale: calls.find(call => call[0] === 'scale')?.[1] };
}
test('native overlay matches the accepted workbench preset and paints behind the icon', () => {
  const o = overlay(); o.event('pointerdown', 0, 1);
  for (const time of [0, 30, 90]) {
    const calls = o.tick(time), actual = painted(calls), expected = feedbackAt([{ at: 0, type: 'down' }], time, DEFAULTS);
    for (const key of ['radius', 'opacity', 'scale']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, key);
    assert.ok(calls.findIndex(c => c[0] === 'fill') < calls.findIndex(c => c[0] === 'drawImage'));
    assert.ok(!calls.some(c => c[0] === 'stroke'));
  }
  assert.equal(o.pending, 0, 'static holds must not repaint');
  o.event('pointermove', 500, 1, 450, 250);
  assert.deepEqual(o.tick(500).find(c => c[0] === 'arc').slice(1, 4), [450, 250, 30]);
  o.event('pointerup', 600, 0, 450, 250);
  assert.ok(painted(o.tick(700)).radius > 30);
  assert.ok(!o.tick(800).some(c => c[0] === 'arc'));
  assert.equal(o.pending, 0); o.close();
});
test('quick clicks release continuously and finish at normal cursor scale', () => {
  const o = overlay(); o.event('pointerdown', 0, 1); o.tick(0);
  const before = painted(o.tick(67)); o.event('pointerup', 67, 0);
  assert.deepEqual(painted(o.tick(67)), before);
  assert.equal(painted(o.tick(267)).scale, 1); assert.equal(o.pending, 0); o.close();
});
test('cancelled drags release; focus loss hides feedback and stops repainting', () => {
  const o = overlay(); o.event('pointerdown', 0, 1); o.tick(90);
  o.event('pointercancel', 100, 1); o.tick(300); assert.equal(o.pending, 0);
  o.event('pointerdown', 400, 1); o.tick(490); o.event('blur', 500, 0);
  assert.ok(!o.tick(500).some(c => c[0] === 'arc' || c[0] === 'drawImage'));
  o.tick(700); assert.equal(o.pending, 0); o.close();
});
