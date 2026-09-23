import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, DEFAULTS, humanPoint, feedbackAt, sample, compileBatch, validateEvents } from './model.mjs';

test('all presets validate and export real gesture command arrays', () => {
  for (const events of Object.values(SCENARIOS)) {
    validateEvents(events);
    const commands = compileBatch(events);
    assert.deepEqual(commands[0], ['mouse', 'move', '72', '92', '--duration', '1', '--steps', '1']);
    assert.equal(commands.filter(c => c[1] === 'down').length, 1);
    assert.equal(commands.filter(c => c[1] === 'up').length, 1);
  }
});
test('movement is fast to depart, slow to arrive, exact and deterministic', () => {
  const from = { x: 0, y: 0 }, to = { x: 400, y: 0 };
  assert.equal(humanPoint(from, to, 0.5).x, 350);
  assert.deepEqual(humanPoint(from, to, 1), to);
  assert.deepEqual(humanPoint(from, to, 0), from);
  assert.deepEqual(sample(SCENARIOS.drag, 1455), sample(SCENARIOS.drag, 1455));
  assert.equal(sample(SCENARIOS.drag, 1455).moving, true);
  assert.equal(sample(SCENARIOS.drag, 1455).phase, 'hold');
});
test('quick click release is continuous, then clears completely', () => {
  const events = [{ at: 0, type: 'down' }, { at: 67, type: 'up' }];
  const before = feedbackAt(events, 67 - 1e-7), after = feedbackAt(events, 67);
  for (const key of ['radius', 'opacity', 'scale']) assert.ok(Math.abs(before[key] - after[key]) < 1e-6);
  assert.equal(after.phase, 'release');
  assert.equal(feedbackAt(events, 300).opacity, 0);
  assert.equal(feedbackAt(events, 300).scale, 1);
  assert.equal(feedbackAt(events, 300).phase, 'up');
});
test('hold is static and a paused sample does not depend on rendering history', () => {
  const events = [{ at: 0, type: 'down' }, { at: 5000, type: 'up' }];
  assert.deepEqual(feedbackAt(events, 200), feedbackAt(events, 4900));
  assert.equal(feedbackAt(events, 200).radius, DEFAULTS.hold.radius);
  const sought = sample(SCENARIOS.text, 1100);
  for (let t = 0; t < 4000; t += 1000 / 30) sample(SCENARIOS.text, t);
  assert.deepEqual(sample(SCENARIOS.text, 1100), sought);
});
test('filled disk grows on press, holds its size, then pulses larger on release', () => {
  const events = [{ at: 0, type: 'down' }, { at: 1000, type: 'up' }];
  const initial = feedbackAt(events, 0), held = feedbackAt(events, 500), released = feedbackAt(events, 1100);
  assert.ok(held.radius > initial.radius);
  assert.equal(held.radius, 30);
  assert.equal(held.opacity, 0.2);
  assert.ok(released.radius > held.radius);
  assert.ok(released.opacity < held.opacity);
  assert.equal(feedbackAt(events, 1200).opacity, 0);
});
test('a later click resets onset radius after an earlier release finishes', () => {
  const events = [{ at: 0, type: 'down' }, { at: 100, type: 'up' }, { at: 1000, type: 'down' }, { at: 1100, type: 'up' }];
  assert.equal(feedbackAt(events, 1000).radius, DEFAULTS.press.radius);
  assert.equal(feedbackAt(events, 1000).phase, 'press');
});
test('invalid sequencing cannot silently export a broken drag', () => {
  assert.throws(() => validateEvents([{ at: 0, type: 'down' }]), /pointer-up/);
  assert.throws(() => validateEvents([{ at: 0, type: 'up' }]), /alternate/);
  assert.throws(() => validateEvents([{ at: 0, type: 'move', x: 10, y: 10, duration: 500, seed: 42 }, { at: 100, type: 'down' }]), /previous/);
  assert.throws(() => validateEvents([{ at: 0, type: 'move', x: NaN, y: 10, duration: 500, seed: 42 }]), /coordinates/);
});
test('export accounts for movement duration before inserting waits', () => {
  const commands = compileBatch(SCENARIOS.click);
  assert.deepEqual(commands[2], ['wait', '120']);
  assert.deepEqual(commands[4], ['wait', '67']);
  assert.equal(commands.at(-1)[1], '600');
});
