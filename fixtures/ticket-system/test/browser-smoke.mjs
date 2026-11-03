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

  async function clickButton(text) {
    const point = await evaluate(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent===${JSON.stringify(text)});if(!b)throw Error("no button "+${JSON.stringify(text)});b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, sid);
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1}, sid);
  }

  const created = await (await fetch(`${server.origin}/api/${sessionId}/tickets`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({title: '烟雾工单', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high'})
  })).json();
  const ticketId = created.ticket.id;
  await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${sessionId}/detail/${ticketId}`}, sid);
  await wait(() => evaluate('document.querySelector("h1")?.textContent.includes("工单详情")', sid), sid);
  const buttons = await evaluate('[...document.querySelectorAll("button")].map(b=>b.textContent)', sid);
  if (!buttons.includes('开始处理')) throw Error('Detail buttons: ' + JSON.stringify(buttons));
  if (!(await evaluate('[...document.querySelectorAll("a")].some(a=>a.textContent==="返回列表")', sid))) throw Error('missing 返回列表 link');
  await clickButton('开始处理');
  await wait(() => server.repository.getTicketById(sessionId, ticketId).status === 'processing', sid);
  console.log('✓ Detail: 开始处理 moves ticket to processing');

  await wait(() => evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="标记已解决")', sid), sid);
  await clickButton('标记已解决');
  await wait(() => server.repository.getTicketById(sessionId, ticketId).status === 'resolved', sid);
  await wait(() => evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="关闭工单")', sid), sid);
  await clickButton('关闭工单');
  await wait(() => server.repository.getTicketById(sessionId, ticketId).status === 'closed', sid);
  await wait(() => evaluate('document.body.textContent.includes("工单已关闭")', sid), sid);
  if ((await evaluate('document.querySelectorAll("button").length', sid)) !== 0) throw Error('closed ticket still shows buttons');
  console.log('✓ Detail: assignee can resolve and close; closed ticket has no buttons');

  const other = server.repository.createTicket(sessionId, {title: '他人工单', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low', assignee: 'user2'}, 'user1');
  server.repository.changeStatus(sessionId, other.id, 'processing', 'user2');
  await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${sessionId}/detail/${other.id}`}, sid);
  await wait(() => evaluate('document.querySelector("h1")?.textContent.includes("工单详情")', sid), sid);
  if ((await evaluate('[...document.querySelectorAll("button")].length', sid)) !== 0) throw Error('non-assignee sees action buttons');
  console.log('✓ Detail: non-assignee sees no action buttons');

  await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${sessionId}/list`}, sid);
  await wait(() => evaluate('document.querySelector("h1")?.textContent.includes("工单列表")', sid), sid);
  await wait(() => evaluate('document.querySelector("button")?.textContent==="筛选"', sid), sid);
  const rowsBefore = await evaluate('document.querySelectorAll("tbody tr").length', sid);
  await evaluate('(()=>{const s=document.querySelectorAll("select")[0];const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;set.call(s,"closed");s.dispatchEvent(new Event("change",{bubbles:true}))})()', sid);
  if ((await evaluate('document.querySelectorAll("tbody tr").length', sid)) !== rowsBefore) throw Error('list refetched before 筛选 was clicked');
  await clickButton('筛选');
  await wait(() => evaluate('document.querySelectorAll("tbody tr").length === 1', sid), sid);
  console.log('✓ List: 筛选 button applies the status filter');

  await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${sessionId}/create`}, sid);
  await wait(() => evaluate('document.querySelector("select[name=category1]")?.options.length > 0', sid), sid);
  await evaluate(`(()=>{
    const set = (el, proto, value, type) => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(type, {bubbles: true})); };
    set(document.querySelector('[name=title]'), HTMLInputElement.prototype, '   ', 'input');
    set(document.querySelector('[name=description]'), HTMLTextAreaElement.prototype, '描述', 'input');
    set(document.querySelector('[name=priority]'), HTMLSelectElement.prototype, 'low', 'change');
  })()`, sid);
  await clickButton('提交工单');
  await wait(() => evaluate('!!document.querySelector("[role=alert]")', sid), sid);
  if (!(await evaluate('location.pathname.endsWith("/create")', sid))) throw Error('create form left the page despite a server rejection');
  const createError = await evaluate('document.querySelector("[role=alert]").textContent', sid);
  if (!createError.includes('创建失败')) throw Error('unexpected create error text: ' + createError);
  console.log('✓ Create: a server rejection shows an inline error and stays on the form');

  const stale = server.repository.createTicket(sessionId, {title: '过期页面', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'}, 'user1');
  await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${sessionId}/detail/${stale.id}`}, sid);
  await wait(() => evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="开始处理")', sid), sid);
  server.repository.changeStatus(sessionId, stale.id, 'processing', 'user1');
  await clickButton('开始处理');
  await wait(() => evaluate('!!document.querySelector("[role=alert]")', sid), sid);
  console.log('✓ Detail: a rejected status change shows an inline error');
} finally {
  child.kill();
  rejectAll(Error('Closed'));
  await server.close();
}
