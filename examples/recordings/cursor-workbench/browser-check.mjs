// Focused smoke check for the built page using this fork's actual CLI.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, compileBatch } from './model.mjs';
const binary = process.env.AGENT_BROWSER_BIN || fileURLToPath(new URL('../../../cli/target/debug/agent-browser', import.meta.url));
const session = `pointer-lab-check-${process.pid}`;
const cli = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(binary, ['--session', session, '--json', ...args]);
  let output = '', error = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { error += data; });
  child.on('error', reject); child.on('close', code => code ? reject(Error(error || output)) : resolve(JSON.parse(output)));
  child.stdin.on('error', () => {}); child.stdin.end(input);
});
const batch = commands => cli(['batch', '--bail'], JSON.stringify(commands));
const evaluate = async source => (await cli(['eval', source])).data.result;
try {
  await cli(['--allow-file-access', 'open', new URL('./dist/index.html', import.meta.url).href]);
  await batch([['set', 'viewport', '1280', '1000'], ['wait', '#play'], ['select', '#preset', 'clear']]);
  assert.equal(await evaluate('window.pointerLab.snapshot().config.hold.opacity'), 0.28);
  await batch([['click', '[aria-label="Edit event 3: move at 880 ms"]'], ['eval', `document.querySelector('[role="slider"][aria-label="X"]').focus()`], ['press', 'ArrowRight']]);
  assert.equal(await evaluate('window.pointerLab.snapshot().events[2].x'), 409);
  await batch([['select', '#preset', 'quiet'], ['eval', `(() => { const slider = document.querySelector('#scrubber'); slider.value = 1400; slider.dispatchEvent(new Event('input', {bubbles:true})); })()`]]);
  assert.equal(await evaluate('document.querySelector("#phase").textContent'), 'HOLD');
  const diskPixels = await evaluate('document.querySelector("#preview").toDataURL()');
  await evaluate(`Array.from(document.querySelectorAll('.dialkit-labeled-control')).find(row => row.querySelector('.dialkit-labeled-control-label')?.textContent === 'Filled').querySelectorAll('[role="radio"]')[0].click()`);
  assert.equal(await evaluate('window.pointerLab.snapshot().config.appearance.filled'), false);
  assert.notEqual(await evaluate('document.querySelector("#preview").toDataURL()'), diskPixels);
  await evaluate(`Array.from(document.querySelectorAll('.dialkit-labeled-control')).find(row => row.querySelector('.dialkit-labeled-control-label')?.textContent === 'Filled').querySelectorAll('[role="radio"]')[1].click()`);
  assert.equal(await evaluate('document.querySelector("#preview").toDataURL()'), diskPixels);
  await cli(['screenshot', '/tmp/pointer-lab-held-disk.png']);
  await batch([['eval', `(() => { const slider = document.querySelector('#scrubber'); slider.value = 2500; slider.dispatchEvent(new Event('input', {bubbles:true})); })()`], ['screenshot', '/tmp/pointer-lab-release.png']]);
  assert.equal(await evaluate('document.querySelector("#phase").textContent'), 'RELEASE');
  await batch([['click', '[data-scenario="drag"]'], ['click', '#restart'], ['wait', '4300']]);
  assert.equal(await evaluate('window.pointerLab.snapshot().playing'), false);
  assert.equal(await evaluate('document.querySelector("#phase").textContent'), 'UP');
  await batch([['set', 'viewport', '390', '844'], ['eval', 'scrollTo(0,0)'], ['screenshot', '/tmp/pointer-lab-mobile-final.png']]);
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  // Parser/dispatch contract smoke test, not a claim that this canvas is the
  // real browser selection/drop fixture. Those assertions live in the demo.
  await batch(compileBatch(SCENARIOS.click));
  console.log('Passed: Filled toggle changes actual rendered pixels, Dialkit preset + event slider, seek hold/release, finite playback, mobile layout, exported CLI dispatch.');
} finally { await cli(['close']).catch(() => {}); }
