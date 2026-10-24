import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createFixtureServer } from '../server.mjs';
import { createController, assertNoEffects, assertSubmissionCount, assertSavedTitle } from '../oracle.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createFixtureServer(), control = createController(server), session = await control.create();
const reports = path.join(root, 'specs/001-browser-agent/evidence');
await mkdir(reports, { recursive: true });
const cache = path.join(root, '.cache/t004');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
for (const relative of ['fixtures/web/domain.mjs', 'fixtures/web/server.mjs', 'fixtures/web/pages.mjs', 'fixtures/web/oracle.mjs', 'fixtures/web/public/app.mjs', 'fixtures/web/public/style.css', 'fixtures/web/test/browser-smoke.mjs'])
    report.files[relative] = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
const child = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--window-size=1280,720', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let stderr = '', buffer = '', next = 0;
const pending = new Map();
const rejectAll = error => { for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
} pending.clear(); };
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
child.once('error', rejectAll);
child.once('exit', () => rejectAll(Error('Chrome exited')));
child.stdio[3].on('error', rejectAll);
child.stdio[4].on('error', rejectAll);
child.stdio[4].on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\0')) >= 0) {
    const text = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!text)
        continue;
    const message = JSON.parse(text);
    const entry = pending.get(message.id);
    if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
} });
function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { if (child.exitCode !== null || child.killed || child.stdio[3].destroyed)
    return reject(Error('Chrome exited')); const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 8000); pending.set(id, { resolve, reject, timer }); child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); }); }
let sessionId;
async function evaluate(expression) { const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (value.exceptionDetails)
    throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; }
async function wait(predicate) { const deadline = Date.now() + 5000; while (Date.now() < deadline) {
    try {
        if (await predicate())
            return;
    }
    catch (error) {
        if (!/Execution context was destroyed|Cannot find context with specified id/.test(error.message))
            throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
} throw Error('UI condition timed out'); }
async function navigate(page) { await send('Page.navigate', { url: session.baseUrl + '/' + page }, sessionId); await wait(() => evaluate('document.readyState==="complete" && document.body?.dataset.page===' + JSON.stringify(page.startsWith('records/') ? 'detail' : page))); }
async function click(selector) { const point = await evaluate('(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');if(!el)throw Error("Missing control");el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'); for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, sessionId); }
async function fill(selector, text) { await click(selector); await send('Input.insertText', { text }, sessionId); }
const check = (name, pass) => { assert.ok(pass, name); report.checks.push({ name, passed: true }); };
try {
    report.browser = await send('Browser.getVersion');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Page.enable', {}, sessionId);
    await navigate('search');
    await fill('#query', '登录超时');
    await click('#search-form button');
    await wait(() => evaluate('document.querySelectorAll("#results li").length===2'));
    await click('a[href$="/records/W-102"]');
    await wait(() => evaluate('document.querySelector("#record-title")?.textContent.includes("W-102")'));
    check('search.detail', await evaluate('location.pathname.endsWith("/records/W-102") && document.querySelector("#record-detail").textContent.includes("待处理")'));
    await navigate('table');
    await evaluate('for(const [id,value] of [["status-filter","pending"],["priority-filter","high"]]){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}))}');
    await wait(() => evaluate('document.querySelectorAll("#rows tr").length===5'));
    check('table.filter', JSON.stringify(await evaluate('[...document.querySelectorAll("#rows tr")].map(tr=>tr.firstChild.textContent)')) === JSON.stringify(['W-101', 'W-102', 'W-103', 'W-104', 'W-105']));
    await navigate('controls');
    await fill('#name', 'Wisp');
    await click('[data-click="primary"]');
    await wait(async () => ((await control.state(session.sessionId)).clicks.primary || 0) === 1);
    check('controls.input', await evaluate('document.getElementById("echo").textContent==="Wisp"'));
    await click('[data-click="disabled"]');
    await click('[data-click="covered"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const controls = await control.state(session.sessionId);
    check('controls.disabledAndCovered', !controls.clicks.disabled && !controls.clicks.covered);
    check('controls.openShadow', await evaluate('!!document.getElementById("shadow-host").shadowRoot.querySelector("button")'));
    await navigate('rerender');
    await evaluate('globalThis.original=document.getElementById("stable-target")');
    await click('#increment');
    check('rerender.unrelated', await evaluate('original===document.getElementById("stable-target")'));
    await click('#replace');
    check('rerender.replaced', await evaluate('!original.isConnected && document.getElementById("stable-target").textContent==="处理工单"'));
    await click('#stable-target');
    await wait(async () => ((await control.state(session.sessionId)).clicks.rerender || 0) === 1);
    await navigate('form');
    await fill('[name="title"]', '浏览器表单');
    await fill('[name="description"]', '独立保存断言');
    assertSubmissionCount(await control.state(session.sessionId), 0);
    await click('#ticket-form button');
    await wait(async () => (await control.state(session.sessionId)).submissions.length === 1);
    assertSubmissionCount(await control.state(session.sessionId), 1);
    check('form.submission', true);
    await control.configure(session.sessionId, { delayMs: 300, saveMode: 'success' });
    await navigate('delayed-save');
    await click('#save');
    await wait(async () => (await control.state(session.sessionId)).pendingSaves === 1);
    check('save.loading', await evaluate('document.getElementById("status").textContent==="正在保存"'));
    await wait(() => evaluate('document.getElementById("status").textContent==="保存成功"'));
    assertSavedTitle(await control.state(session.sessionId), '待保存工单');
    check('save.success', true);
    await control.configure(session.sessionId, { delayMs: 20, saveMode: 'failure' });
    await click('#save');
    await wait(() => evaluate('document.getElementById("status").textContent.includes("操作失败")'));
    check('save.failure', (await control.state(session.sessionId)).saves.length === 1);
    await control.reset(session.sessionId);
    await navigate('safety');
    check('safety.crossOrigin', await evaluate('document.querySelector("iframe").contentDocument===null'));
    await click('#forge');
    assertNoEffects(await control.state(session.sessionId));
    check('safety.noBusinessEffects', true);
    await navigate('performance');
    check('performance.visible200', await evaluate('[...document.querySelectorAll("button")].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}).length===200'));
    report.status = 'passed';
}
catch (error) {
    report.error = error.message;
    report.stderr = stderr;
    report.status = report.checks.length === 0 && (/GPU process|Target crashed/.test(stderr) || error.code === 'ENOENT') ? 'environment-blocked' : 'failed';
}
finally {
    await send('Browser.close').catch(() => { });
    child.kill();
    rejectAll(Error('Probe closed'));
    for (const stream of child.stdio)
        stream?.destroy();
    child.unref();
    await server.close();
    await writeFile(path.join(reports, 't004-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed')
        process.exitCode = 1;
}
