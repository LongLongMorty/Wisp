import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFixtureServer} from '../server.mjs';
import {FIXTURE_VERSION} from '../domain.mjs';
import {createController, assertTicketFields, assertStateTransition, assertAuditLogComplete} from '../oracle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'specs/002-ticket-system/evidence');
await mkdir(reports, {recursive: true});
const cache = path.join(root, '.cache/ticket-evidence');
await mkdir(cache, {recursive: true});
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const server = await createFixtureServer();
const control = createController(server);
const report = {timestamp: new Date().toISOString(), fixtureVersion: FIXTURE_VERSION, status: 'pending', checks: []};

const child = spawn(executable, [
  '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,720', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'
], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});

let buffer = '', next = 0, stderr = '';
const pending = new Map();
const rejectAll = error => {for (const e of pending.values()) clearTimeout(e.timer), e.reject(error); pending.clear();};
child.once('exit', (code) => rejectAll(Error(`Chrome exited with code ${code}`)));
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

async function wait(pred, sid, label = 'condition') {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {if (await pred()) return;} catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw Error(`Condition timeout: ${label}`);
}

async function clickButton(text, sid) {
  const point = await evaluate(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent===${JSON.stringify(text)});if(!b)throw Error("no button "+${JSON.stringify(text)});b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, sid);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1}, sid);
}

async function fillForm(fields, sid) {
  for (const [name, value] of Object.entries(fields)) {
    await evaluate(`(()=>{
      const el=document.querySelector('[name="${name}"]');
      if(!el)throw Error("no field ${name}");
      const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,"value").set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));
    })()`, sid);
  }
}

try {
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId: sid} = await send('Target.attachToTarget', {targetId, flatten: true});
  await send('Page.enable', {}, sid);

  // Scenario 1: Submit empty form fails
  {
    const session = await control.create();
    await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${session.sessionId}/create`}, sid);
    await wait(() => evaluate('document.readyState==="complete"', sid), sid, 'page load');
    const hasRoot = await evaluate('!!document.getElementById("root")', sid);
    const hasForm = await evaluate('!!document.querySelector("form")', sid);
    const bodyText = await evaluate('document.body.textContent.slice(0, 200)', sid);
    if (!hasRoot) throw Error(`Scenario 1 debug: no #root. body: ${bodyText}`);
    if (!hasForm) throw Error(`Scenario 1 debug: root exists but no form. body: ${bodyText}`);
    await clickButton('提交工单', sid);
    await new Promise(r => setTimeout(r, 100));
    const state1 = await control.state(session.sessionId);
    if (state1.tickets.length !== 0) throw Error(`Scenario 1: expected no tickets, got ${state1.tickets.length}`);
    report.checks.push({scenario: 1, label: 'Empty form rejected by browser validation', passed: true});
  }

  // Scenario 2: Valid submission creates ticket
  {
    const session = await control.create();
    await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${session.sessionId}/create`}, sid);
    await wait(() => evaluate('document.querySelector("select[name=category1]")?.options.length > 0', sid), sid, 'S2: categories loaded');
    await fillForm({title: 'S2工单', description: '描述', priority: 'high'}, sid);
    const filled = await evaluate('({title:document.querySelector("[name=title]").value,description:document.querySelector("[name=description]").value,priority:document.querySelector("[name=priority]").value})', sid);
    if (!filled.title || !filled.description || !filled.priority) throw Error(`S2: form not filled: ${JSON.stringify(filled)}`);
    await clickButton('提交工单', sid);
    await wait(() => evaluate('window.location.pathname.includes("/list")', sid), sid, 'S2: redirect to list');
    const state2 = await control.state(session.sessionId);
    if (state2.tickets.length !== 1) throw Error(`Scenario 2: expected 1 ticket, got ${state2.tickets.length}`);
    assertTicketFields(state2.tickets[0], {id: 'T-0001', title: 'S2工单', description: '描述', priority: 'high', status: 'pending'});
    const createdLog = state2.auditLogs.find(l => l.action === 'created');
    if (!createdLog) throw Error('Scenario 2: no created audit log');
    assertAuditLogComplete(createdLog);
    report.checks.push({scenario: 2, label: 'Valid form submission creates ticket and redirects', passed: true});
  }

  // Scenario 3: Category cascading
  {
    const session = await control.create();
    await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${session.sessionId}/create`}, sid);
    await wait(() => evaluate('document.querySelector("select[name=category1]")?.options.length > 0', sid), sid);
    await evaluate('(()=>{const s=document.querySelector("select[name=category1]");const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;set.call(s,"业务咨询");s.dispatchEvent(new Event("change",{bubbles:true}))})()', sid);
    await wait(() => evaluate('document.querySelector("select[name=category2]").value==="功能咨询"', sid), sid, 'category2 reset');
    await fillForm({title: 'S3工单', description: 'D', priority: 'low'}, sid);
    await clickButton('提交工单', sid);
    await wait(() => evaluate('window.location.pathname.includes("/list")', sid), sid, 'redirect to list');
    const state3 = await control.state(session.sessionId);
    const ticket3 = state3.tickets.find(t => t.category1 === '业务咨询' && t.category2 === '功能咨询');
    if (!ticket3) throw Error('Scenario 3: no ticket with category 业务咨询/功能咨询');
    report.checks.push({scenario: 3, label: 'Category1 change updates category2 options', passed: true});
  }

  // Scenario 4: Filter list by status
  {
    const session = await control.create();
    const t1 = await (await fetch(`${server.origin}/api/${session.sessionId}/tickets`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: 'T1', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'})})).json();
    await fetch(`${server.origin}/api/${session.sessionId}/tickets/${t1.ticket.id}/status`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: 'processing'})});
    await (await fetch(`${server.origin}/api/${session.sessionId}/tickets`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: 'T2', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low'})})).json();
    await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${session.sessionId}/list`}, sid);
    await wait(() => evaluate('document.querySelector("h1")?.textContent.includes("工单列表")', sid), sid);
    await wait(() => evaluate('document.querySelectorAll("tbody tr").length === 2', sid), sid, 'S4: initial 2 tickets');
    await evaluate('(()=>{const s=document.querySelectorAll("select")[0];if(!s)throw Error("no status select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,"processing");s.dispatchEvent(new Event("change",{bubbles:true}))})()', sid);
    await clickButton('筛选', sid);
    await wait(() => evaluate('document.querySelectorAll("tbody tr").length === 1', sid), sid);
    report.checks.push({scenario: 4, label: 'Status filter shows only processing tickets', passed: true});
  }

  // Scenario 5: Status progression
  {
    const session = await control.create();
    const created = await (await fetch(`${server.origin}/api/${session.sessionId}/tickets`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: 'S5', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'high'})})).json();
    const ticketId = created.ticket.id;
    await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${session.sessionId}/detail/${ticketId}`}, sid);
    await wait(() => evaluate('document.querySelector("h1")?.textContent.includes("工单详情")', sid), sid);
    await clickButton('开始处理', sid);
    await wait(() => evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="标记已解决")', sid), sid);
    await clickButton('标记已解决', sid);
    await wait(() => evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="关闭工单")', sid), sid);
    await clickButton('关闭工单', sid);
    await wait(() => evaluate('document.body.textContent.includes("工单已关闭")', sid), sid, 'S5: closed message');
    const state5 = await control.state(session.sessionId);
    const logs5 = state5.auditLogs.filter(l => l.ticket_id === ticketId);
    assertStateTransition(logs5, ['processing', 'resolved', 'closed']);
    report.checks.push({scenario: 5, label: 'Complete status progression: pending → processing → resolved → closed', passed: true});
  }

  // Scenario 6: Non-assignee sees no action buttons
  {
    const session = await control.create();
    const other = server.repository.createTicket(session.sessionId, {title: 'S6', description: 'D', category1: '技术问题', category2: '无法登录', priority: 'low', assignee: 'user2'}, 'user1');
    server.repository.changeStatus(session.sessionId, other.id, 'processing', 'user2');
    await send('Page.navigate', {url: `${server.origin}/ticket-system/s/${session.sessionId}/detail/${other.id}`}, sid);
    await wait(() => evaluate('document.querySelector("h1")?.textContent.includes("工单详情")', sid), sid);
    const buttons = await evaluate('[...document.querySelectorAll("button")].length', sid);
    if (buttons !== 0) throw Error(`Scenario 6: non-assignee sees ${buttons} buttons`);
    report.checks.push({scenario: 6, label: 'Non-assignee sees no action buttons on assigned ticket', passed: true});
  }

  report.status = 'passed';
} catch (error) {
  report.error = error.message;
  report.stderr = stderr;
  report.status = /GPU process|Target crashed/.test(stderr) || error.code === 'ENOENT' ? 'environment-blocked' : 'failed';
} finally {
  await send('Browser.close').catch(() => {});
  child.kill();
  rejectAll(Error('Probe closed'));
  for (const stream of child.stdio) stream?.destroy();
  child.unref();
  await server.close();
  await writeFile(path.join(reports, 't002-ticket-system.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
