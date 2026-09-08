/** Counts oscillators actually scheduled, to prove music is or is not playing. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const OUT = process.argv[2], PORT = 9310, APP = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const profile = path.join(OUT, 'music');
fs.rmSync(profile, { recursive: true, force: true });
procs.push(spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
   '--window-size=1020,700', '--no-first-run', '--disable-gpu',
   // Lets an AudioContext start without a real gesture, so we measure the
   // music code rather than the browser's autoplay policy.
   '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' }));

let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!page) await sleep(300);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); pending.set(i, res); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? 'THREW: ' + r.exceptionDetails.text : r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');

// Instrument BEFORE the app loads.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__osc = 0;
  const realCreate = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () { window.__osc++; return realCreate.call(this); };
` });

await send('Page.navigate', { url: APP });
await sleep(2200);
// A real gesture here too, so the default-prefs run measures the defaults
// rather than measuring a suspended AudioContext.
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 400, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 400, button: 'left', clickCount: 1 });
await sleep(600);
await ev(`(() => { const el=document.querySelector('input'); if(!el) return 0;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,'Tester');
  el.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
await sleep(200);
await ev(`[...document.querySelectorAll('button')].find(b=>/play as guest/i.test(b.textContent))?.click()`);
await sleep(2500);

console.log('default music pref:', await ev(`JSON.parse(localStorage.getItem('mivimoose:sound')||'null')`));
const baseline = await ev('window.__osc');
await sleep(4000);
const afterIdle = await ev('window.__osc');
console.log(`oscillators with default prefs: ${baseline} -> ${afterIdle} over 4s`);
console.log(afterIdle > baseline + 2 ? 'DEFAULT: menu music plays' : 'DEFAULT: silent');

// Now force music on the way the UI would.
await ev(`(() => { localStorage.setItem('mivimoose:sound', JSON.stringify({music:true,sfx:true,volume:0.6})); return 1; })()`);
await send('Page.navigate', { url: APP });
await sleep(2500);
// A real pointer gesture. el.click() dispatches only a 'click' event, and the
// audio unlock listens on pointerdown — so a synthetic click leaves the
// AudioContext suspended and everything silent.
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 400, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 400, button: 'left', clickCount: 1 });
await sleep(600);
await ev(`(() => { const el=document.querySelector('input'); if(!el) return 0;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,'Tester');
  el.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
await sleep(200);
await ev(`[...document.querySelectorAll('button')].find(b=>/play as guest/i.test(b.textContent))?.click()`);
await sleep(2500);
const b2 = await ev('window.__osc');
await sleep(6000);
const a2 = await ev('window.__osc');
console.log(`oscillators with music:true: ${b2} -> ${a2} over 6s`);
console.log(a2 > b2 + 2 ? 'MUSIC IS PLAYING' : 'MUSIC IS SILENT');

procs.forEach(p => p.kill());
process.exit(0);
