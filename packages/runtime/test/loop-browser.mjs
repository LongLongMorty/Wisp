import { createTaskRuntime, createMemoryStore } from '../dist/index.mjs';
import { createPolicyGateway } from '../../policy/dist/index.mjs';
import { loopHashes } from '../../../scripts/loop-evidence.mjs';
import { RECORDS } from '../../../fixtures/web/domain.mjs';
import os from 'node:os';
import { createChromeAdapter } from '../../browser-chrome/dist/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createFixtureServer } from '../../../fixtures/web/server.mjs';
import { createController, assertNoEffects, assertSubmissionCount, assertSavedTitle } from '../../../fixtures/web/oracle.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createFixtureServer(), control = createController(server), session = await control.create();
const reports = path.join(root, 'specs/001-browser-agent/evidence');
await mkdir(reports, { recursive: true });
const cache = path.join(root, '.cache/t010');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
report.files = await loopHashes();
const child = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--window-size=1280,720', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
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
try {
    report.browser = await send('Browser.getVersion');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Page.enable', {}, sessionId);
    const origin = new URL(session.baseUrl).origin, extensionId = 'a'.repeat(32), ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' };
    const store = createMemoryStore();
    let decide, extract, calls = 0;
    const runtime = await createTaskRuntime({ store, loop: { modelFactory({ onAttempt }) { return { async decide(input) { onAttempt(); calls++; return { decision: await decide(input) }; }, async extract(input) { onAttempt(); calls++; return extract(input); } }; } }, gatewayFactory: async () => {
            const browser = createChromeAdapter({ send: (method, params) => send(method, params, sessionId) }, { allowedOrigins: [origin] });
            const gateway = createPolicyGateway({ browser, readContext: (request, signal) => browser.readPolicyContext(request, signal), extensionId, uiUrl: ui.url, tabId: 1, rules: [{ origin, path: new URL(session.baseUrl).pathname + '/search', kind: 'pressKey', role: 'textbox', name: '搜索工单', decision: 'allow' }, { origin, path: new URL(session.baseUrl).pathname + '/search', kind: 'click', role: 'link', name: 'W-104 报表访问异常', decision: 'allow' }] });
            gateway.grantOrigin(origin, ui);
            return gateway;
        } });
    const target = (o, role, name) => { const el = o.elements.find(e => e.role === role && e.name === name); assert.ok(el, 'target ' + name); return { documentId: o.documentId, frameId: o.frameId, observationId: o.observationId, ref: el.ref }; };
    try {
        await navigate('search');
        let step = 0;
        decide = ({ observation: o }) => { switch (step++) {
            case 0: return { kind: 'action', request: { action: { kind: 'fill', target: target(o, 'textbox', '搜索工单'), value: 'W-104' }, timeoutMs: 3000 } };
            case 1: return { kind: 'action', request: { action: { kind: 'pressKey', target: target(o, 'textbox', '搜索工单'), key: 'Enter' }, expected: [{ kind: 'text', includes: 'W-104' }], timeoutMs: 3000 } };
            case 2: return { kind: 'action', request: { action: { kind: 'click', target: target(o, 'link', 'W-104 报表访问异常') }, expected: [{ kind: 'url', equals: session.baseUrl + '/records/W-104' }], timeoutMs: 3000 } };
            default: return { kind: 'finish', summary: 'Found W-104', expected: [{ kind: 'url', equals: session.baseUrl + '/records/W-104' }, { kind: 'text', includes: '报表访问异常' }] };
        } };
        await runtime.create({ runId: 'search', tabId: 1, goal: '搜索W-104并打开详情' });
        await runtime.configureLoop('search');
        await runtime.start('search');
        let result = await runtime.drive('search');
        check('search.completedWithProof', result.status === 'completed' && result.result.evidence.length >= 2);
        check('search.actualDetail', await evaluate('document.body.dataset.record==="W-104" && document.getElementById("record-title").textContent.includes("报表访问异常")'));
        check('search.singleActions', (await runtime.events('search')).filter(e => e.type === 'action.prepared').length === 3);
        check('search.modelAccounting', (await runtime.get('search')).loop.budget.modelCalls.used === 4 && calls === 4);
        await navigate('table');
        await wait(() => evaluate('document.querySelectorAll("#rows tr").length===12'));
        decide = () => ({ kind: 'extract', schemaId: 'rows' });
        extract = ({ observation: o, schemaId }) => ({ schemaId, data: { ids: [...new Set(o.text.match(/W-\d{3}/g))].slice(0, 5) }, source: [{ kind: 'url', url: o.url, documentId: o.documentId, observationId: o.observationId, capturedAt: o.capturedAt, actual: o.url }] });
        const schemas = { rows: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5 } }, required: ['ids'], additionalProperties: false } };
        await runtime.create({ runId: 'table', tabId: 1, goal: '提取页面前五条工单编号' });
        await runtime.configureLoop('table', { schemas });
        await runtime.start('table');
        result = await runtime.drive('table');
        check('extract.completed', result.status === 'completed');
        check('extract.oracleFiveRows', JSON.stringify(result.result.extraction.data.ids) === JSON.stringify(RECORDS.slice(0, 5).map(r => r.id)));
        check('extract.boundSource', result.result.extraction.source[0].url === session.baseUrl + '/table');
        await navigate('form');
        decide = ({ observation: o }) => ({ kind: 'action', request: { action: { kind: 'click', target: target(o, 'button', '提交工单') }, timeoutMs: 1000 } });
        await runtime.create({ runId: 'confirm', tabId: 1, goal: '请求提交并等待确认' });
        await runtime.configureLoop('confirm');
        await runtime.start('confirm');
        let before = calls;
        result = await runtime.drive('confirm');
        check('policy.confirmationStopsLoop', result.status === 'waiting_user' && calls === before + 1);
        assertSubmissionCount(await control.state(session.sessionId), 0);
        check('policy.noUnapprovedWrites', true);
        await runtime.cancel('confirm');
        await navigate('controls');
        decide = () => ({ kind: 'finish', summary: 'Unproven', expected: [{ kind: 'text', includes: 'THIS_DOES_NOT_EXIST' }] });
        await runtime.create({ runId: 'false-finish', tabId: 1, goal: '不能伪造完成' });
        await runtime.configureLoop('false-finish');
        await runtime.start('false-finish');
        const round = await runtime.step('false-finish');
        check('finish.unverifiedRemainsRunning', round.kind === 'unverified' && (await runtime.get('false-finish')).snapshot.status === 'running');
        await runtime.cancel('false-finish');
        report.status = 'passed';
    }
    finally {
        await runtime.dispose();
        store.close();
    }
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
    await writeFile(path.join(reports, process.env.WISP_LOOP_REPORT || 't010-loop-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Loop browser: ' + report.status + '; checks=' + report.checks.length);
    if (report.status !== 'passed')
        process.exitCode = 1;
}
