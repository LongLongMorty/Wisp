import { createMemoryStore } from '../../runtime/dist/index.mjs';
import { createAgent } from '../dist/index.mjs';
import { createPolicyGateway } from '../../policy/dist/index.mjs';
import { sdkHashes } from '../../../scripts/sdk-evidence.mjs';
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
const cache = path.join(root, '.cache/t011');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
report.files = await sdkHashes();
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
    const origin = new URL(session.baseUrl).origin, extensionId = 'a'.repeat(32), ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' }, store = createMemoryStore();
    let decide, calls = 0;
    const open = () => createAgent({ store, tabId: 1, uiSender: () => ui, modelFactory: ({ onAttempt }) => ({ async decide(input, signal) { onAttempt(); calls++; return { decision: await decide(input, signal) }; }, async extract() { throw Error('unused'); } }), gatewayFactory: async () => { const browser = createChromeAdapter({ send: (method, params) => send(method, params, sessionId) }, { allowedOrigins: [origin] }); const g = createPolicyGateway({ browser, readContext: (request, signal) => browser.readPolicyContext(request, signal), extensionId, uiUrl: ui.url, tabId: 1 }); g.grantOrigin(origin, ui); return g; } });
    let agent = open();
    try {
        await navigate('controls');
        decide = () => ({ kind: 'finish', summary: 'Controls verified', expected: [{ kind: 'url', equals: session.baseUrl + '/controls' }, { kind: 'text', includes: '普通按钮' }] });
        const run = agent.run({ goal: 'Verify controls page' });
        check('handle.immediate', typeof run.runId === 'string' && run.result instanceof Promise);
        const seen = [];
        run.onEvent(e => seen.push(e));
        const result = await run.result;
        check('result.verified', result.status === 'completed' && result.evidence.length >= 2);
        const replay = await run.events();
        check('events.ordered', replay.events.every((e, i, a) => !i || e.seq > a[i - 1].seq));
        const again = await run.events();
        check('events.stableIds', JSON.stringify(replay.events.map(e => e.eventId)) === JSON.stringify(again.events.map(e => e.eventId)));
        check('events.metadataOnly', replay.events.filter(e => ['step.observed', 'verification.result'].includes(e.type)).every(e => e.payload.redacted === true));
        const before = calls;
        await agent.dispose();
        agent = open();
        await agent.ready;
        const restored = await agent.getRun(run.runId);
        check('reopen.result', (await restored.result).status === 'completed' && calls === before);
        decide = () => ({ kind: 'ask_user', question: 'Waiting' });
        const paused = agent.run({ goal: 'Ask before continuing' });
        await wait(async () => (await paused.snapshot()).status === 'waiting_user');
        let settled = false;
        void paused.result.then(() => settled = true);
        check('wait.resultPending', !settled);
        await paused.pause();
        decide = () => ({ kind: 'finish', summary: 'Resumed', expected: [{ kind: 'url', equals: session.baseUrl + '/controls' }] });
        await paused.resume();
        check('resume.completes', (await paused.result).status === 'completed');
        let resolve, entered;
        const gate = new Promise(r => resolve = r), started = new Promise(r => entered = r);
        decide = () => { entered(); return gate; };
        const cancel = agent.run({ goal: 'Cancel pending model' });
        await started;
        const begin = Date.now();
        await cancel.cancel();
        resolve({ kind: 'action', request: { action: { kind: 'navigate', url: session.baseUrl + '/form' }, timeoutMs: 1000 } });
        check('cancel.immediate', (await cancel.result).status === 'cancelled' && Date.now() - begin < 1000);
        check('cancel.noLateNavigation', await evaluate('document.body.dataset.page==="controls"'));
        assertNoEffects(await control.state(session.sessionId));
        check('oracle.noWrites', true);
        report.status = 'passed';
    }
    finally {
        await agent.dispose();
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
    await writeFile(path.join(reports, process.env.WISP_SDK_REPORT || 't011-sdk-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('SDK browser: ' + report.status + '; checks=' + report.checks.length);
    if (report.status !== 'passed')
        process.exitCode = 1;
}
