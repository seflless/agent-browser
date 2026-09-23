import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { 'assets-dir': { type: 'string' } } });
if (!values['assets-dir']) throw Error('Pass --assets-dir containing left_ptr.svg, hand2.svg, xterm.svg (seflless- prefix also accepted).');
const out = resolve(here, 'dist');
await mkdir(out, { recursive: true });
const read = name => readFile(resolve(here, name), 'utf8');
const assets = {};
for (const name of ['left_ptr.svg', 'hand2.svg', 'xterm.svg']) {
  let source = resolve(values['assets-dir'], name);
  try { await access(source); } catch { source = resolve(values['assets-dir'], `seflless-${name}`); }
  assets[name] = `data:image/svg+xml;base64,${(await readFile(source)).toString('base64')}`;
}
const css = (await read('style.css')) + '\n' + (await read('node_modules/dialkit/dist/vanilla/styles.css'));
const vendor = await read('node_modules/dialkit/dist/vanilla/browser.global.js');
const model = (await read('model.mjs')).replace(/^export /gm, '');
const reference = (await read('reference.mjs')).replace(/^export /gm, '');
const app = (await read('app.mjs')).replace(/^import .*;\n/gm, '').replace('image.src = `./assets/${file}`', `image.src = ${JSON.stringify(assets)}[file]`);
const source = `const { createDialKit, createDialRoot } = DialKit;\n${model}\n${reference}\n${app}`;
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
const license = await read('node_modules/dialkit/LICENSE');
const html = (await read('index.html'))
  .replace(/  <link rel="stylesheet"[^>]+>\n/g, '')
  .replace('</head>', `<!-- Dialkit: ${license.replaceAll('--', '—')}\nCursor assets: https://github.com/seflless/seflless.com/tree/main/public/cursors -->\n<style>${css}</style></head>`)
  .replace('<script type="module" src="./app.mjs"></script>', `<script>${safeScript(vendor)}</script><script type="module">${safeScript(source)}</script>`);
await writeFile(resolve(out, 'index.html'), html);
await writeFile(resolve(out, 'dialkit-license.txt'), license);
console.log(`Built ${out}. Serve only this directory. Cursor assets: github.com/seflless/seflless.com/tree/main/public/cursors`);
