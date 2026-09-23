#!/usr/bin/env node
// One deterministic batch records the themed cursor on actual UI controls.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { theme: { type: 'string' }, output: { type: 'string', default: 'recordings/cursor-theme-demo.mp4' }, verify: { type: 'boolean' } } });
if (!values.theme) throw Error('Provide --theme /absolute/path/to/theme.json');
const output = resolve(values.output);
if (existsSync(output)) throw Error(`Refusing to overwrite ${output}`);
const binary = process.env.AGENT_BROWSER_BIN || fileURLToPath(new URL('../../cli/target/debug/agent-browser', import.meta.url));
const session = `cursor-theme-demo-${process.pid}`;
const cli = (args, input) => new Promise((yes, no) => {
  const child = spawn(binary, ['--session', session, '--json', ...args]);
  let out = '', err = '';
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
  child.on('error', no);
  child.on('close', code => code ? no(Error(err || out)) : yes(JSON.parse(out)));
  child.stdin.on('error', () => {}); child.stdin.end(input);
});
const batch = commands => cli(['batch', '--bail'], JSON.stringify(commands));
const html = await readFile(new URL('./cursor-theme-demo.html', import.meta.url));
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const url = `http://127.0.0.1:${server.address().port}`;
let recording = false;
try {
  await mkdir(dirname(output), { recursive: true });
  await cli(['--args', '--force-device-scale-factor=2', 'open', url]);
  await batch([['set', 'viewport', '1280', '800', '2'], ['wait', '#action'], ['wait', '500'], ['mouse', 'move', '150', '335']]);
  const start = ['record', 'start', output, '--fps', '60', '--cursor-theme', resolve(values.theme), '--cursor-scale', '0.4'];
  const move = (x, y, duration = 600) => ['mouse', 'move', `${Math.round(x)}`, `${Math.round(y)}`, '--duration', `${duration}`, '--steps', `${Math.round(duration / 16.67)}`, '--human', '--seed', '42'];
  const geometry = (await cli(['eval', `(() => {
    const center = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#auto-text'));
    const r = range.getBoundingClientRect();
    return { textStart: [r.left + 1, r.y + r.height / 2], textEnd: [r.right - 1, r.y + r.height / 2], card: center('#drag-card'), drop: center('#drop-zone') };
  })()`])).data.result;
  const selectText = [move(...geometry.textStart, 650), ['wait', '120'], ['mouse', 'down'], move(...geometry.textEnd, 1150), ['mouse', 'up'], ['wait', '950']];
  const dragCard = [move(...geometry.card, 700), ['wait', '160'], ['mouse', 'down'], move(...geometry.drop, 1400), ['wait', '180'], ['mouse', 'up'], ['wait', '950']];
  const take = [start, move(230, 345), ['wait', '750'], ['click', '#action', '--human'], ['wait', '650'],
    ['click', '#input', '--human'], ['wait', '400'], ['keyboard', 'type', 'The right cursor, automatically.'], ['wait', '650'],
    ...selectText,
    move(707, 615, 600), ['wait', '750'], move(925, 547, 550), ['wait', '800'],
    move(1090, 547, 500), ['wait', '850'], ...dragCard, move(335, 690, 1000), ['wait', '900'], ['record', 'stop']];
  if (values.verify) {
    // Real-browser semantic regressions. Kept outside the demonstration take.
    const probe = output.replace(/\.mp4$/, '.checks.mp4');
    await cli(['record', 'start', probe, '--cursor-theme', resolve(values.theme), '--cursor-scale', '0.4']); recording = true;
    const checks = [
      ['default', 230, 345], ['pointer', 570, 390], ['text', 970, 390],
      ['text', 210, 559], ['default', 707, 615], ['default', 925, 547], ['none', 1090, 547],
    ];
    for (const [expected, x, y] of checks) {
      await batch([['mouse', 'move', `${x}`, `${y}`], ['wait', '120']]);
      const result = await cli(['eval', `document.querySelector('[data-agent-browser-recording-cursor]').dataset.cursorType`]);
      if (result.data?.result !== expected) throw Error(`At ${x},${y}: expected ${expected}, got ${JSON.stringify(result)}`);
      await cli(['screenshot', `${output}.${expected}-${x}.png`]);
    }
    // Explicit overrides and a stationary pointer must update without movement.
    await batch([['mouse', 'move', '970', '390'], ['eval', `document.querySelector('#input').style.cursor='default'`], ['wait', '160']]);
    let result = await cli(['eval', `document.querySelector('[data-agent-browser-recording-cursor]').dataset.cursorType`]);
    if (result.data?.result !== 'default') throw Error('Explicit default did not override editable inference');
    await batch([['eval', `document.querySelector('#input').style.cursor='text'`], ['wait', '160']]);
    result = await cli(['eval', `document.querySelector('[data-agent-browser-recording-cursor]').dataset.cursorType`]);
    if (result.data?.result !== 'text') throw Error('Stationary cursor did not update');
    await batch([['record', 'stop'], ['open', url], ['wait', '#action'], ['wait', '350']]); recording = false;
    console.log('Passed: explicit styles, auto input, glyph hit-test, padding, fallback, none, stationary update.');
  }
  await writeFile(`${output}.commands.json`, JSON.stringify(take, null, 2));
  recording = true;
  const result = await batch(take); recording = false;
  await writeFile(`${output}.result.json`, JSON.stringify(result, null, 2));
  const finalState = (await cli(['eval', `({ selectedText: window.demoSelectedText, dropped: document.querySelector('#drop-zone').dataset.completed === 'true', dropText: document.querySelector('#drop-zone').textContent, cardInsideDrop: document.querySelector('#drop-zone').contains(document.querySelector('#drag-card')) })`])).data.result;
  await writeFile(`${output}.verification.json`, JSON.stringify(finalState, null, 2));
  if (finalState.selectedText !== 'Select these words, naturally.' || !finalState.dropped || !finalState.cardInsideDrop || finalState.dropText !== 'Card delivered') throw Error(`Gesture verification failed: ${JSON.stringify(finalState)}`);
  await cli(['screenshot', `${output}.final.png`]);
  console.log('Verified full sentence drag-selection and completed card drop.');
  console.log(`Saved ${output}`);
} finally {
  if (recording) await cli(['record', 'stop']).catch(() => {});
  await cli(['close']).catch(() => {});
  server.close();
}
