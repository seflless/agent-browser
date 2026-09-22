import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommands, COLORS, verifyBoard } from './decode-color-grid.mjs';

test('one deterministic take creates 12 rectangles, sets fill once, and ends with select-all/zoom', () => {
  const commands = buildCommands({ output: '/tmp/demo.mp4', cursorIcon: '/tmp/arrow with spaces.svg' });
  const clicks = commands.filter(c => c[0] === 'click').map(c => c[1]);
  assert.equal(clicks.filter(s => s === 'button[aria-label="Rectangle"]').length, 12);
  assert.equal(clicks.filter(s => s === 'button[aria-label="Solid"]').length, 1);
  assert.equal(clicks.filter(s => s === 'button[aria-label="Fill"]').length, 1);
  assert.equal(clicks.some(s => /Arrow|Select/.test(s)), false);
  assert.deepEqual(commands.filter(c => c[0] === 'keyboard').map(c => c[2]), COLORS.map(c => c[0]));
  assert.deepEqual(commands.slice(-6), [['press', 'Escape'], ['press', 'Meta+a'], ['wait', '100'], ['press', 'Shift+2'], ['wait', '900'], ['record', 'stop']]);
  assert.equal(commands.filter(c => c[0] === 'record' && c[1] === 'start').length, 1);
  const moves = commands.filter(c => c[0] === 'mouse' && c[1] === 'move');
  assert.equal(new Set(moves.filter((_, i) => i % 2 === 0).map(c => c[2])).size, 4);
  assert.equal(new Set(moves.filter((_, i) => i % 2 === 0).map(c => c[3])).size, 3);
});

function boardFixture() {
  return {
    selected: COLORS.map((_, i) => `shape:${i}`),
    shapes: COLORS.map(([label, color], i) => ({ type: 'geo', x: 200 + i % 4 * 240, y: 160 + Math.floor(i / 4) * 160, props: {
      geo: 'rectangle', w: 190, h: 110, color, fill: 'solid', align: 'middle', verticalAlign: 'middle',
      richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }] },
    } })),
    selection: { x: 200, y: 160, w: 910, h: 430 }, viewport: { x: 155, y: 115, w: 1000, h: 520 },
  };
}

test('postflight accepts the exact palette grid', () => verifyBoard(boardFixture()));
test('postflight catches newline, inherited fill, and centering regressions', () => {
  const newline = boardFixture(); newline.shapes[0].props.richText.content.unshift({ type: 'paragraph' });
  assert.throws(() => verifyBoard(newline), /paragraphs/);
  const fill = boardFixture(); fill.shapes[1].props.fill = 'none';
  assert.throws(() => verifyBoard(fill), /inherited fill/);
  const centered = boardFixture(); centered.viewport.x += 50;
  assert.throws(() => verifyBoard(centered), /center/);
  const missingBounds = boardFixture(); missingBounds.selection = null;
  assert.throws(() => verifyBoard(missingBounds), /bounds/);
});
