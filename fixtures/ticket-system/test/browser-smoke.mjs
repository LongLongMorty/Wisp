import {spawn} from 'node:child_process';
import {mkdir, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFixtureServer} from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createFixtureServer();
const {sessionId} = server.initialSession;
const cache = path.join(root, '.cache/ticket-smoke');
await mkdir(cache, {recursive: true});
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const child = spawn(executable, [
  '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,720', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'
], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});
let buffer = '', next = 0, stderr = '';
const pending = new Map();
const rejectAll = error => {for (const e of pending.values()) clearTimeout(e.timer), e.reject(error); pending.clear();};
child.once('exit', (code) => {console.error(`Chrome exited with code ${code}, stderr:`, stderr); rejectAll(Error('Chrome exited'));});
child.stdio[2].on('data', chunk => stderr += chunk);
child.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const text = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!text) continue;
    const msg = JSON.parse(text);
    const e = pending.get(msg.id);
    if (e) pending.delete(msg.id), clearTimeout(e.timer), msg.error ? e.reject(Error(JSON.stringify(msg.error))) : e.resolve(msg.result);
  }
});

function send(method, params = {}, sid) {
  return new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => {pending.delete(id); reject(Error('CDP timeout'));}, 8000);
    pending.set(id, {resolve, reject, timer});
    child.stdio[3].write(JSON.stringify({id, method, params, ...(sid ? {sessionId: sid} : {})}) + '\0');
  });
}

async function evaluate(expression, sid) {
  const v = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sid);
  if (v.exceptionDetails) throw Error(JSON.stringify(v.exceptionDetails));
  return v.result.value;
}

async function wait(pred, sid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {if (await pred()) return;} catch {}
    await new Promise(r => setTimeout(r, 20));
  }
  throw Error('Condition timeout');
}

try {
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId: sid} = await send('Target.attachToTarget', {targetId, flatten: true});
  await send('Page.enable', {}, sid);
  await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${sessionId}/create`}, sid);
  await wait(() => evaluate('document.readyState==="complete"', sid), sid);
  await wait(() => evaluate('document.querySelector("form select[name=category1]")?.options.length > 0', sid), sid);
  const form = await evaluate('({title: !!document.querySelector("input[name=title]"), category1: !!document.querySelector("select[name=category1]"), category2: !!document.querySelector("select[name=category2]"), priority: !!document.querySelector("select[name=priority]"), submit: !!document.querySelector("button[type=submit]")})', sid);
  if (!form.title || !form.category1 || !form.category2 || !form.priority || !form.submit) {
    throw Error('Form fields missing: ' + JSON.stringify(form));
  }
  console.log('✓ CreateTicket form renders with cascading selects');
} finally {
  child.kill();
  rejectAll(Error('Closed'));
  await server.close();
}
