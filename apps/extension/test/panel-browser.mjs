import { cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { panelHashes } from '../../../scripts/panel-evidence.mjs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createFixtureServer } from '../../../fixtures/web/server.mjs';
import { createController, assertNoEffects, assertSubmissionCount, assertSavedTitle } from '../../../fixtures/web/oracle.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stage = process.env.WISP_PANEL_STAGE === 't013' ? 't013' : 't012';
const server = await createFixtureServer(), control = createController(server), session = await control.create();
const reports = path.join(root, 'specs/001-browser-agent/evidence');
await mkdir(reports, { recursive: true });
const cache = path.join(root, '.cache', stage);
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
report.files = await panelHashes();
const child = spawn(executable, [...(process.env.WISP_CHROME_HEADED === '1' ? [] : ['--headless=new']), '--enable-unsafe-extension-debugging', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--window-size=1280,720', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: process.env.WISP_CHROME_HEADED !== '1', stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let stderr = '', buffer = '', next = 0;
const pending = new Map();
const rejectAll = error => {
    for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
    }
    pending.clear();
};
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
child.once('error', rejectAll);
child.once('exit', () => rejectAll(Error('Chrome exited')));
child.stdio[3].on('error', rejectAll);
child.stdio[4].on('error', rejectAll);
child.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
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
    }
});
function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.killed || child.stdio[3].destroyed)
            return reject(Error('Chrome exited'));
        const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 8000);
        pending.set(id, { resolve, reject, timer });
        child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
}
let sessionId;
async function evaluate(expression) {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (value.exceptionDetails)
        throw Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
}
async function wait(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try {
            if (await predicate())
                return;
        }
        catch (error) {
            if (!/Execution context was destroyed|Cannot find context with specified id/.test(error.message))
                throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('UI condition timed out');
}
async function navigate(page) { await send('Page.navigate', { url: session.baseUrl + '/' + page }, sessionId); await wait(() => evaluate('document.readyState==="complete" && document.body?.dataset.page===' + JSON.stringify(page.startsWith('records/') ? 'detail' : page))); }
async function click(selector) {
    const point = await evaluate('(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');if(!el)throw Error("Missing control");el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, sessionId);
}
async function fill(selector, text) { await click(selector); await send('Input.insertText', { text }, sessionId); }
const check = (name, pass) => { assert.ok(pass, name); report.checks.push({ name, passed: true }); };
const sameStart = (a, b) => !!a && !!b && a.ok === b.ok && a.type === b.type && a.requestId === b.requestId && a.data?.runId === b.data?.runId;
let calls = 0, sawKey = false;
const modelServer = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req)
        body += chunk;
    calls++;
    sawKey ||= req.headers.authorization === 'Bearer PANEL_TEST_KEY';
    const { input, operation } = JSON.parse(JSON.parse(body).messages[1].content);
    if (input.goal === 'PANEL_HANG')
        return;
    let decision;
    if (input.goal === 'PANEL_WAIT')
        decision = { kind: 'ask_user', question: 'Manual help requested' };
    else if (input.goal === 'PANEL_CONFIRM' && !input.observation.text.includes('操作已记录')) {
        const el = input.observation.elements.find(e => e.role === 'button' && e.name === '普通按钮');
        decision = { kind: 'action', request: { action: { kind: 'click', target: { documentId: input.observation.documentId, frameId: input.observation.frameId, observationId: input.observation.observationId, ref: el.ref } }, expected: [{ kind: 'text', includes: '操作已记录' }], timeoutMs: 3000 } };
    }
    else
        decision = { kind: 'finish', summary: 'Panel fixture verified', expected: [{ kind: 'url', equals: input.observation.url }, { kind: 'text', includes: input.goal === 'PANEL_CONFIRM' ? '操作已记录' : '普通按钮' }] };
    res.end(JSON.stringify({ id: 'panel_fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(decision) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
});
modelServer.listen(0, '127.0.0.1');
await once(modelServer, 'listening');
report.host = { primary: 'production WXT MV3 ServiceWorker', ui: 'native SIDE_PANEL context', model: 'deterministic loopback HTTP fixture; no real provider', manifestOverride: 'only required host_permissions http://127.0.0.1/* for fixture; native permission prompt requires separate manual review' };
const extensionPath = await mkdtemp(path.join(cache, 'extension-'));
await cp(path.join(root, 'apps/extension/.output/chrome-mv3'), extensionPath, { recursive: true });
const fixtureManifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
fixtureManifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(fixtureManifest));
async function evaluateIn(id, expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, id); if (r.exceptionDetails)
    throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
let bootstrap, panel, extensionId, windowId, bootstrapTargetId, panelTargetId;
const rpc = async (type, payload = {}, requestId = crypto.randomUUID()) => evaluateIn(panel, 'chrome.runtime.sendMessage(' + JSON.stringify({ version: '0.1', type, payload, requestId }) + ')');
const status = async (id) => (await rpc('run.get', { runId: id })).data?.snapshot.status;
async function until(fn) { const end = Date.now() + 15000; while (Date.now() < end) {
    if (await fn())
        return;
    await new Promise(r => setTimeout(r, 100));
} throw Error('Panel condition timed out'); }
async function openPanel() { try {
    await evaluateIn(bootstrap, 'chrome.sidePanel.open(' + JSON.stringify({ windowId }) + ')');
}
catch (e) {
    throw Error('NATIVE_PANEL_AUTOMATION_UNAVAILABLE: ' + e.message);
} let context; await until(async () => { const contexts = await evaluateIn(bootstrap, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]})'); context = contexts.find(c => c.documentUrl === 'chrome-extension://' + extensionId + '/sidepanel.html'); return !!context; }).catch(() => { throw Error('NATIVE_PANEL_CONTEXT_NOT_EXPOSED'); }); let target; await until(async () => { target = (await send('Target.getTargets')).targetInfos.find(t => t.url === 'chrome-extension://' + extensionId + '/sidepanel.html' && t.targetId!==bootstrapTargetId); return !!target; }).catch(() => { throw Error('NATIVE_PANEL_TARGET_NOT_EXPOSED'); });     panel = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId; panelTargetId = target.targetId; await until(() => evaluateIn(panel, '!!document.querySelector("h1")')); return context; }
async function setValue(selector, value) { await evaluateIn(panel, '(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));})()'); }
try {
    report.browser = await send('Browser.getVersion');
    const target = await send('Target.createTarget', { url: session.baseUrl + '/controls' });
    let fixtureSession = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await until(() => evaluateIn(fixtureSession, 'document.body?.dataset.page==="controls"'));
    ({ windowId } = await send('Browser.getWindowForTarget', { targetId: target.targetId }));
    await send('Target.detachFromTarget', { sessionId: fixtureSession });
    ({ id: extensionId } = await send('Extensions.loadUnpacked', { path: extensionPath }));
    const boot = await send('Target.createTarget', { url: 'chrome-extension://' + extensionId + '/sidepanel.html' });
    bootstrapTargetId=boot.targetId;bootstrap = (await send('Target.attachToTarget', { targetId: boot.targetId, flatten: true })).sessionId;
    await until(() => evaluateIn(bootstrap, '!!chrome.runtime?.id'));
    const denied = await evaluateIn(bootstrap, 'chrome.runtime.sendMessage({version:"0.1",requestId:"fake",type:"session.get",payload:{}})');
    check('sender.regularExtensionTabDenied', denied.error?.code === 'PERMISSION_DENIED');
    const context = await openPanel();
    check('sender.nativeSidePanel', context.contextType === 'SIDE_PANEL');
    const endpoint = 'http://127.0.0.1:' + modelServer.address().port + '/v1/chat/completions';
    await setValue('input[type=url]', endpoint);
    await setValue('form input:not([type])', 'fixture-model');
    await setValue('input[type=password]', 'PANEL_TEST_KEY');
    await evaluateIn(panel, 'document.querySelector("form button").click()');
    await until(async () => (await rpc('session.get')).data?.config?.hasKey === true);
    await until(() => evaluateIn(panel, 'document.querySelector("input[type=password]").value===""'));
    check('session.inputCleared', true);
    check('session.keyNotInResponse', !JSON.stringify(await rpc('session.get')).includes('PANEL_TEST_KEY'));
    await evaluateIn(panel, '[...document.querySelectorAll("button")].find(b=>b.textContent==="授权此站点").click()');
    await until(async () => (await rpc('session.get')).data.grants.includes(new URL(session.baseUrl).origin));
    check('grant.exactOrigin', true);
    await until(() => evaluateIn(panel, 'document.querySelector("button.primary").disabled===false'));
    await setValue('textarea[placeholder]', 'PANEL_READ');
    await evaluateIn(panel, 'document.querySelector("button.primary").click()');
    let runId;
    await until(async () => { runId = (await rpc('history.list')).data.find(r => r.goal === 'PANEL_READ')?.runId; return runId && await status(runId) === 'completed'; });
    check('worker.realReadCompleted', true);
    const read = (await rpc('run.get', { runId })).data.snapshot;
    check('result.actualEvidence', read.result.evidence.length >= 2);
    check('events.versioned', (await rpc('run.events', { runId })).data.events.every(e => e.version === '0.1' && !!e.eventId));
    const repeatedId = crypto.randomUUID(), waiting = await rpc('run.start', { tabId: read.tabId, goal: 'PANEL_WAIT' }, repeatedId), waitingId = waiting.data.runId;
    await until(async () => await status(waitingId) === 'waiting_user');
    const beforeReplay = calls;
    check('request.replaySameRun', sameStart(await rpc('run.start', { tabId: read.tabId, goal: 'PANEL_WAIT' }, repeatedId), waiting));
    check('request.noExtraCall', calls === beforeReplay);
    await rpc('run.cancel', { runId: waitingId });
    const c = await rpc('run.start', { tabId: read.tabId, goal: 'PANEL_CONFIRM' }), confirmId = c.data.runId;
    await until(async () => await status(confirmId) === 'waiting_user');
    const pending = (await rpc('run.get', { runId: confirmId })).data.pending;
    check('confirm.noWriteBeforeApproval', !(await control.state(session.sessionId)).clicks.primary);
    check('confirm.originBound', pending.confirmation.origin === new URL(session.baseUrl).origin);
    await until(() => evaluateIn(panel, '[...document.querySelectorAll(".history-row")].some(b=>b.textContent.includes("PANEL_CONFIRM"))'));
    await evaluateIn(panel, '[...document.querySelectorAll(".history-row")].find(b=>b.textContent.includes("PANEL_CONFIRM")).click()');
    await until(() => evaluateIn(panel, 'document.querySelector(".confirmation")?.textContent.includes("批准这次操作")'));
    await evaluateIn(panel, '[...document.querySelectorAll(".confirmation button")].find(b=>b.textContent==="批准本次操作").click()');
    await until(async () => await status(confirmId) === 'completed');
    check('confirm.exactlyOneEffect', (await control.state(session.sessionId)).clicks.primary === 1);
    check('confirm.finishVerified', true);
    check('confirm.replayRejected', (await rpc('run.confirm', { runId: confirmId, confirmationId: pending.confirmation.confirmationId, decision: 'approve' })).ok === false);
    const hang = await rpc('run.start', { tabId: read.tabId, goal: 'PANEL_HANG' }), hangId = hang.data.runId;
    await until(async () => await status(hangId) === 'running');
    const started = Date.now();
    await rpc('run.cancel', { runId: hangId });
    check('stop.underOneSecond', Date.now() - started < 1000 && await status(hangId) === 'cancelled');
    check('stop.noExtraEffects', (await control.state(session.sessionId)).clicks.primary === 1);
    const restore = await rpc('run.start', { tabId: read.tabId, goal: 'PANEL_WAIT' }), restoreId = restore.data.runId;
    await until(async () => await status(restoreId) === 'waiting_user');
    await send('ServiceWorker.enable', {}, bootstrap);
    await send('ServiceWorker.stopAllWorkers', {}, bootstrap);
    await until(async () => await status(restoreId) === 'paused');
    check('worker.restartPauses', true);
    check('worker.sessionRetained', (await rpc('session.get')).data.config.hasKey === true);
    check('worker.receiptRetained', sameStart(await rpc('run.start', { tabId: read.tabId, goal: 'PANEL_WAIT' }, repeatedId), waiting));
    await rpc('run.resume', { runId: restoreId });
    await until(async () => await status(restoreId) === 'waiting_user');
    try {
        await evaluateIn(bootstrap, 'chrome.sidePanel.close(' + JSON.stringify({ windowId }) + ')');
    }
    catch (e) {
        throw Error('NATIVE_PANEL_CLOSE_UNAVAILABLE: ' + e.message);
    }
    await new Promise(r => setTimeout(r, 300));
    if ((await send('Target.getTargets')).targetInfos.some(t => t.targetId === panelTargetId))
        await send('Target.closeTarget', { targetId: panelTargetId });
    await new Promise(r => setTimeout(r, 300));
    await openPanel();
    await until(async () => await status(restoreId) === 'paused');
    check('panel.closeReopenPaused', true);
    await rpc('run.delete', { runId });
    check('history.deleted', !(await rpc('history.list')).data.some(r => r.runId === runId));
    const local = await evaluateIn(bootstrap, 'Promise.all([chrome.storage.local.get(null),chrome.storage.sync.get(null)]).then(x=>JSON.stringify(x))');
    const idb = await evaluateIn(bootstrap, 'new Promise((resolve,reject)=>{const r=indexedDB.open("wisp-production-v01");r.onerror=()=>reject(Error("IDB open failed"));r.onsuccess=()=>{const db=r.result,t=db.transaction("state","readonly"),get=t.objectStore("state").get("root");get.onsuccess=()=>resolve(JSON.stringify(get.result,(_k,v)=>v instanceof Map?[...v]:v));t.oncomplete=()=>db.close();};})');
    check('privacy.noDurableKey', !local.includes('PANEL_TEST_KEY') && !idb.includes('PANEL_TEST_KEY') && sawKey);
    check('layout.noHorizontalOverflow', await evaluateIn(panel, 'document.querySelector("main").scrollWidth<=document.documentElement.clientWidth'));
    try {
        const png = await send('Page.captureScreenshot', {}, panel);
        await writeFile(path.join(reports, stage + '-panel.png'), Buffer.from(png.data, 'base64'));
        report.screenshot = stage + '-panel.png';
    }
    catch {
        report.screenshot = 'not-supported';
    }
    const f = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    check('privacy.keyNotInTarget', await evaluateIn(f, '!document.documentElement.textContent.includes("PANEL_TEST_KEY")'));
    await send('Target.detachFromTarget', { sessionId: f });
    await rpc('session.clear');
    check('session.cleared', (await rpc('session.get')).data.config === null);
    report.status = 'passed';
}
catch (error) {
    report.error = error.message;
    report.stderr = stderr;
    report.status = (report.checks.length === 0 && (/GPU process|Target crashed/.test(stderr) || error.code === 'ENOENT')) || /^NATIVE_PANEL_/.test(error.message) ? 'environment-blocked' : 'failed';
}
finally {
    await send('Browser.close').catch(() => { });
    child.kill();
    rejectAll(Error('Probe closed'));
    for (const stream of child.stdio)
        stream?.destroy();
    child.unref();
    modelServer.closeAllConnections();
    modelServer.close();
    await server.close();
    await writeFile(path.join(reports, stage + '-panel-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Native panel: ' + report.status + '; checks=' + report.checks.length);
    if (report.status !== 'passed')
        process.exitCode = 1;
}
