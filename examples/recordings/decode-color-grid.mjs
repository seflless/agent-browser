#!/usr/bin/env node
// Deterministic Decode UI demo. No agent decisions or shape creation via JS during the take.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const COLORS = [
  ['Black', 'black'], ['Grey', 'grey'], ['Violet', 'violet'], ['Light violet', 'light-violet'],
  ['Blue', 'blue'], ['Light blue', 'light-blue'], ['Orange', 'orange'], ['Yellow', 'yellow'],
  ['Green', 'green'], ['Light green', 'light-green'], ['Red', 'red'], ['Light red', 'light-red'],
];

export function buildCommands({ output, cursorIcon, cursorScale = '0.5', cursorHotspot = '59,28', selectAll = 'Meta+a' }) {
  const start = ['record', 'start', output, '--fps', '60'];
  start.push(...(cursorIcon ? ['--cursor-icon', cursorIcon, '--cursor-scale', cursorScale, '--cursor-hotspot', cursorHotspot] : ['--cursor']));
  const commands = [start];
  const click = (label) => ['click', `button[aria-label="${label}"]`, '--human'];
  for (const [index, [label]] of COLORS.entries()) {
    const x = 200 + (index % 4) * 240;
    const y = 200 + Math.floor(index / 4) * 160;
    commands.push(
      click('Rectangle'),
      ['mouse', 'move', `${x}`, `${y}`, '--duration', '360', '--steps', '45', '--human', '--seed', `${100 + index * 2}`],
      ['wait', '90'],
      ['mouse', 'down'],
      ['mouse', 'move', `${x + 190}`, `${y + 110}`, '--duration', '380', '--steps', '47', '--human', '--seed', `${101 + index * 2}`],
      ['mouse', 'up'],
      // Enter's key-up must finish before typing: otherwise a blank paragraph can survive.
      ['keydown', 'Enter'], ['keyup', 'Enter'], ['wait', '100'],
      ['press', selectAll], ['keyboard', 'inserttext', label], ['press', 'Escape'],
      click('Color'), ['wait', '120'], click(label),
    );
    if (index === 0) commands.push(click('Fill'), ['wait', '120'], click('Solid'));
  }
  commands.push(
    ['press', 'Escape'], ['press', selectAll], ['wait', '100'],
    ['press', 'Shift+2'], ['wait', '900'], ['record', 'stop'],
  );
  return commands;
}

function textOf(node) {
  return node?.text ?? (node?.content ?? []).map(textOf).join('');
}

export function verifyBoard(board) {
  if (board.shapes.length !== 12) throw Error(`Expected 12 shapes; found ${board.shapes.length}`);
  const sorted = [...board.shapes].sort((a, b) => Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y);
  const first = sorted[0];
  sorted.forEach((shape, index) => {
    const [label, color] = COLORS[index];
    const p = shape.props;
    if (shape.type !== 'geo' || p.geo !== 'rectangle' || p.color !== color || p.fill !== 'solid') {
      throw Error(`${label}: wrong shape, color, or inherited fill: ${JSON.stringify(p)}`);
    }
    if (textOf(p.richText) !== label || p.richText.content.length !== 1) throw Error(`${label}: label contains missing/extra text or paragraphs`);
    if (p.verticalAlign !== 'middle' || p.align !== 'middle') throw Error(`${label}: text is not centered`);
    const close = (a, b) => Math.abs(a - b) < 1;
    if (!close(shape.x - first.x, (index % 4) * 240) || !close(shape.y - first.y, Math.floor(index / 4) * 160) || !close(p.w, 190) || !close(p.h, 110)) {
      throw Error(`${label}: rectangle is not in the expected 4 x 3 grid`);
    }
  });
  if (board.selected.length !== 12) throw Error('The final Select All did not select all 12 rectangles');
  // Shift+2 should center the selection in the canvas's screen bounds.
  const { selection, viewport } = board;
  if (!selection || !viewport) throw Error('Missing selection or viewport bounds for centering verification');
  if (Math.abs(selection.x + selection.w / 2 - viewport.x - viewport.w / 2) > 2 || Math.abs(selection.y + selection.h / 2 - viewport.y - viewport.h / 2) > 2) {
    throw Error('Shift+2 did not center the selection in the viewport');
  }
}

async function command(program, args, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveResult(stdout.trim()) : reject(Error(`${program} ${args.slice(0, 4).join(' ')} failed (${code}): ${stderr || stdout}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Inspect a real Chrome screencast JPEG, not the higher-resolution initial screenshot.
async function sourceDimensions(endpoint) {
  const url = new URL(endpoint);
  const targets = await (await fetch(`http://${url.host}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && /^https?:/.test(item.url));
  if (!target) throw Error('No HTTP page target for raw-frame verification');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0, acceptFrame, rejectFrame;
  const frame = new Promise((resolveFrame, reject) => { acceptFrame = resolveFrame; rejectFrame = reject; });
  // A close can precede the first awaited frame; keep its rejection handled.
  frame.catch(() => {});
  socket.addEventListener('close', () => {
    const error = Error('CDP closed before the source-resolution probe completed');
    rejectFrame(error);
    for (const { no } of pending.values()) no(error);
    pending.clear();
  });
  const timeout = setTimeout(() => socket.close(), 10000);
  try {
    await new Promise((ready, reject) => { socket.onopen = ready; socket.onerror = reject; socket.onclose = () => reject(Error('CDP closed while connecting')); });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.screencastFrame') acceptFrame(message.params);
      if (pending.has(message.id)) {
        const { yes, no } = pending.get(message.id); pending.delete(message.id);
        message.error ? no(Error(JSON.stringify(message.error))) : yes(message.result);
      }
    };
    const send = (method, params = {}) => new Promise((yes, no) => {
      const id = ++sequence; pending.set(id, { yes, no }); socket.send(JSON.stringify({ id, method, params }));
    });
    const version = await send('Browser.getVersion');
    await send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
    const image = await frame;
    await send('Page.screencastFrameAck', { sessionId: image.sessionId });
    await send('Page.stopScreencast');
    const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', 'pipe:0'], Buffer.from(image.data, 'base64')));
    return { ...probe.streams[0], browser: version.product };
  } finally { clearTimeout(timeout); socket.close(); }
}

async function main() {
  const { values } = parseArgs({ options: {
    'board-url': { type: 'string' }, 'base-url': { type: 'string', default: 'http://127.0.0.1:4266' },
    'dev-user-id': { type: 'string' }, username: { type: 'string' },
    output: { type: 'string', default: 'recordings/decode-color-grid.mp4' },
    'cursor-icon': { type: 'string' }, 'cursor-scale': { type: 'string', default: '0.5' },
    'cursor-hotspot': { type: 'string', default: '59,28' }, 'dry-run': { type: 'boolean' },
  } });
  const output = resolve(values.output);
  if (!output.endsWith('.mp4')) throw Error('Use an .mp4 output path');
  const cursorIcon = values['cursor-icon'] && resolve(values['cursor-icon']);
  const commands = buildCommands({ output, cursorIcon, cursorScale: values['cursor-scale'], cursorHotspot: values['cursor-hotspot'], selectAll: process.platform === 'darwin' ? 'Meta+a' : 'Control+a' });
  if (values['dry-run']) { console.log(JSON.stringify(commands, null, 2)); return; }
  if (existsSync(output)) throw Error(`Refusing to overwrite an existing take: ${output}`);
  if (cursorIcon && !existsSync(cursorIcon)) throw Error(`Cursor image not found: ${cursorIcon}`);
  const localBinary = fileURLToPath(new URL('../../cli/target/debug/agent-browser', import.meta.url));
  const binary = process.env.AGENT_BROWSER_BIN || (existsSync(localBinary) ? localBinary : 'agent-browser');
  const session = `decode-palette-${process.pid}`;
  const cli = (...args) => command(binary, ['--session', session, ...args]);
  const batch = async (items) => {
    const response = JSON.parse(await command(binary, ['--session', session, '--json', 'batch', '--bail'], JSON.stringify(items)));
    return response;
  };
  const evaluate = async (script) => {
    const response = JSON.parse(await cli('--json', 'eval', script));
    if (!response.success) throw Error(JSON.stringify(response));
    return response.data.result;
  };
  let boardUrl = values['board-url'];
  let loginUrl;
  if (values['dev-user-id']) {
    const base = new URL(values['base-url']);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && !base.hostname.endsWith('.localhost')) throw Error('Dev auth is only allowed on a local development server');
    if (!values.username) throw Error('--username is required with --dev-user-id');
    loginUrl = new URL(`/api/auth/dev-login?userId=${encodeURIComponent(values['dev-user-id'])}`, base).href;
    if (!boardUrl) {
      const response = await fetch(new URL('/api/projects', base), { method: 'POST', headers: { 'x-dev-user-id': values['dev-user-id'], 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Color palette' }) });
      if (!response.ok) throw Error(`Create board failed: ${response.status} ${await response.text()}`);
      const board = await response.json();
      boardUrl = new URL(`/${encodeURIComponent(values.username)}/color-palette-${board.id}`, base).href;
    }
  }
  if (!boardUrl) throw Error('Provide --board-url for an empty accessible board, or --dev-user-id and --username for a new local board');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.commands.json`, JSON.stringify(commands, null, 2));
  let recording = false;
  try {
    console.log(`Preflight: ${boardUrl}`);
    await cli('--args', '--force-device-scale-factor=2', 'open', loginUrl || boardUrl);
    await batch([
      ['set', 'viewport', '1280', '800', '2'], ['open', boardUrl],
      ['wait', '--fn', '!!window.__tldraw_editor__'],
      ['wait', 'button[aria-label="Rectangle"]'], ['wait', 'button[aria-label="Color"]'],
      ['press', 'Shift+0'], ['wait', '1500'],
    ]);
    const empty = await evaluate('window.__tldraw_editor__.getCurrentPageShapes().length === 0');
    if (!empty) throw Error('The board must be empty; the script never deletes existing content');
    const viewport = await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:window.__tldraw_editor__.getZoomLevel()})');
    if (viewport.width !== 1280 || viewport.height !== 800 || viewport.dpr !== 2 || Math.abs(viewport.zoom - 1) > .001) throw Error(`Unexpected viewport: ${JSON.stringify(viewport)}`);
    const source = await sourceDimensions(await cli('get', 'cdp-url'));
    if (source.width !== 2560 || source.height !== 1600) throw Error(`Expected native 2560x1600 capture, got ${JSON.stringify(source)}`);
    console.log('Recording 12 rectangles in one deterministic batch. No snapshots or agent loop during the take.');
    recording = true;
    const result = await batch(commands);
    recording = false;
    await writeFile(`${output}.commands-result.json`, JSON.stringify(result, null, 2));
    const board = await evaluate(`(()=>{const e=window.__tldraw_editor__;return {shapes:e.getCurrentPageShapes(),selected:e.getSelectedShapeIds(),camera:e.getCamera(),selection:e.getSelectionPageBounds(),viewport:e.getViewportPageBounds()}})()`);
    verifyBoard(board);
    await cli('screenshot', `${output}.png`);
    const media = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames', '-show_entries', 'format=duration', '-of', 'json', output]));
    const manifest = { createdAt: new Date().toISOString(), boardUrl, viewport, source, media, cursor: cursorIcon ? { path: cursorIcon, sha256: createHash('sha256').update(await readFile(cursorIcon)).digest('hex'), scale: values['cursor-scale'], hotspot: values['cursor-hotspot'] } : 'default', colors: COLORS, board, verification: '12 rectangles; 4 columns x 3 rows; exact single-paragraph labels; matching colors; solid fill; all selected; selection centered' };
    await writeFile(`${output}.manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`Verified recording: ${output}\nManifest: ${output}.manifest.json`);
  } finally {
    if (recording) await cli('record', 'stop').catch(() => {});
    await cli('close').catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
