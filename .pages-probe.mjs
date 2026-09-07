import { readFileSync } from 'node:fs';
import { createEngine, decodeDisplayList } from 'fleuron';

const wasm = readFileSync('node_modules/fleuron/wasm/fleuron_bg.wasm');
const engine = await createEngine({ wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });

const text = readFileSync('fixture/Chapter Twelve.md', 'utf8');
const extra = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : '';
const split = process.argv[3] === 'split';

const ops = [{ op: 'dialect', dialect: 'obsidian' }];
if (split) ops.push({ op: 'split', level: 1 });
ops.push({ op: 'markdown', name: 'Chapter Twelve.md', text: text + extra });
ops.push({ op: 'style', sheets: [{ name: 'orca.css', css: '' }] });

const reply = await new Promise((ok) => {
  engine.submit({ id: 1, generation: 1, ops, want: 'preview' }, (r) => ok(r));
});
if (!reply.bytes) { console.log('no bytes', reply); process.exit(1); }
const out = decodeDisplayList(reply.bytes);
console.log('bookPages', out.bookPages, 'first', out.first, 'held', out.pages.length);
console.log(out.pages.map((p) => `${p.number}:${p.side}:${p.items.length}`).join(' '));
