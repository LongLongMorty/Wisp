import { buildRuntimeExtension } from './build-extension.mjs';
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
const server = await createFixtureServer(), control = createController(server), session = await control.create();
const reports = path.join(root, 'specs/001-browser-agent/evidence');
await mkdir(reports, { recursive: true });
const cache = path.join(root, '.cache/t008');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
report.workerHarness = { primary: 'MV3 ServiceWorker', peer: 'module DedicatedWorker', leaseClock: 'controlled; advance 6000ms per restart', authorization: 'host-only test UI metadata; native SidePanel integration deferred to T012' };
for (const relative of ["packages/protocol/src/actions.mts", "packages/protocol/src/index.mts", "packages/protocol/src/messages.mts", "packages/protocol/src/observation.mts", "packages/protocol/src/policy.mts", "packages/protocol/src/runtime.mts", "packages/protocol/src/validation.mts", "packages/browser-chrome/src/adapter.mts", "packages/browser-chrome/src/chrome.mts", "packages/browser-chrome/src/control-document.mts", "packages/browser-chrome/src/document.mts", "packages/browser-chrome/src/index.mts", "packages/browser-chrome/src/references.mts", "packages/browser-chrome/src/sanitize.mts", "packages/policy/src/index.mts", "packages/models/src/index.mts", "packages/models/src/schema.mts", "packages/runtime/src/loop.mts", "packages/runtime/src/index.mts", "packages/runtime/src/runtime.mts", "packages/runtime/src/store.mts", "packages/runtime/test/runtime-browser.mjs", "packages/runtime/test/extension-background.mjs", "packages/runtime/test/extension-runner.mjs", "packages/runtime/test/extension-peer.mjs", "packages/runtime/test/build-extension.mjs", "scripts/runtime-smoke.mjs", "fixtures/web/domain.mjs", "fixtures/web/server.mjs", "fixtures/web/oracle.mjs", "fixtures/web/pages.mjs", "fixtures/web/public/app.mjs", "fixtures/web/public/style.css"])
    report.files[relative] = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
const extensionPath = await buildRuntimeExtension();
const child = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--window-size=1280,720', '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
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
    await navigate('controls');
    await send('Target.detachFromTarget', { sessionId });
    const extension = await send('Extensions.loadUnpacked', { path: extensionPath });
    report.extensionId = extension.id;
    const runner = await send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/sidepanel.html' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId: runner.targetId, flatten: true }));
    await send('Runtime.enable', {}, sessionId);
    await wait(() => evaluate('typeof globalThis.call==="function"'));
    await send('ServiceWorker.enable', {}, sessionId);
    const database = 'wisp-t008-' + Date.now();
    let clock = 1000;
    const call = message => evaluate('globalThis.call(' + JSON.stringify(message) + ')');
    const method = (name, ...args) => call({ type: 'runtime', method: name, args });
    async function init(hold) { return call({ type: 'init', database, baseUrl: session.baseUrl, clock, hold }); }
    const initial = await init(null), actualTabId = initial.tabId;
    check('idb.atomicRollback', await call({ type: 'rollback' }));
    let effects = 0, currentBoot = initial.bootId;
    for (const phase of ['prepared', 'dispatching', 'responded', 'finished']) {
        await call({ type: 'hold', value: phase });
        const started = { bootId: currentBoot };
        await method('create', { runId: 'run-' + phase, tabId: actualTabId, goal: 'Crash recovery ' + phase });
        const o = await method('start', 'run-' + phase);
        const element = o.elements.find(e => e.role === 'button' && e.name === '普通按钮');
        assert.ok(element);
        const req = { actionId: globalThis.crypto.randomUUID(), action: { kind: 'click', target: { documentId: o.documentId, frameId: o.frameId, observationId: o.observationId, ref: element.ref } }, expected: [{ kind: 'text', includes: '操作已记录：' + (effects + 1) }], timeoutMs: 3000 };
        await evaluate('globalThis.checkpoints=[]');
        await evaluate('globalThis.begin(' + JSON.stringify(phase) + ',' + JSON.stringify({ type: 'runtime', method: 'execute', args: ['run-' + phase, req] }) + ')');
        await wait(() => evaluate('globalThis.checkpoints.some(c=>c.phase===' + JSON.stringify(phase) + ')'));
        if (phase === 'responded' || phase === 'finished')
            effects++;
        await send('ServiceWorker.stopAllWorkers', {}, sessionId);
        clock += 6000;
        const restored = await init(null);
        currentBoot = restored.bootId;
        check('worker.' + phase + '.restarted', restored.bootId !== started.bootId);
        const checkpoint = await method('get', 'run-' + phase);
        check('worker.' + phase + '.paused', checkpoint.snapshot.status === 'paused');
        const duplicate = await method('execute', 'run-' + phase, req);
        check('worker.' + phase + '.stage', duplicate.action.stage === (phase === 'prepared' ? 'abandoned' : phase === 'finished' ? 'finished' : 'unknown'));
        const state = await control.state(session.sessionId);
        check('worker.' + phase + '.noReplay', (state.clicks.primary || 0) === effects);
        if (phase === 'dispatching' || phase === 'responded') {
            let denied = false;
            try {
                await method('resume', 'run-' + phase);
            }
            catch {
                denied = true;
            }
            check('worker.' + phase + '.unknownBarrier', denied);
            if (phase === 'responded') {
                const proof = await method('reconcile', 'run-' + phase, req);
                check('worker.responded.reconciled', proof.status === 'passed');
            }
            else
                await method('acknowledgeUnknown', 'run-' + phase, req.actionId);
        }
        await method('resume', 'run-' + phase);
        await method('pause', 'run-' + phase);
    }
    if (process.env.WISP_RUNTIME_REPORT?.startsWith('t013-')) {
        const runId = 'surviving-host';
        await call({ type: 'hold', value: 'responded' });
        await method('create', { runId, tabId: actualTabId, goal: 'Fence surviving host' });
        const o = await method('start', runId), element = o.elements.find(e => e.role === 'button' && e.name === '普通按钮');
        assert.ok(element);
        const req = { actionId: crypto.randomUUID(), action: { kind: 'click', target: { documentId: o.documentId, frameId: o.frameId, observationId: o.observationId, ref: element.ref } }, expected: [{ kind: 'text', includes: '操作已记录：' + (effects + 1) }], timeoutMs: 3000 };
        await evaluate('globalThis.begin("survivor",' + JSON.stringify({ type: 'runtime', method: 'execute', args: [runId, req] }) + ')');
        await wait(() => evaluate('globalThis.checkpoints.some(c=>c.actionId===' + JSON.stringify(req.actionId) + '&&c.phase==="responded")'));
        effects++;
        clock += 6000; await call({ type: 'clock', value: clock });
        const recovered = await evaluate('globalThis.compete(' + JSON.stringify({ database, clock, runId, recoverOnly: true }) + ')');
        check('worker.survivor.recoveredPaused', recovered.ok && recovered.run.snapshot.status === 'paused');
        await call({ type: 'release', actionId: req.actionId });
        await wait(() => evaluate('globalThis.operations.survivor?.pending!==true'));
        check('worker.survivor.oldReplyIgnored', (await method('execute', runId, req)).action.stage === 'unknown');
        check('worker.survivor.noReplay', (await control.state(session.sessionId)).clicks.primary === effects);
        const denied = await evaluate('(async()=>{try{await globalThis.call(' + JSON.stringify({ type: 'runtime', method: 'resume', args: [runId] }) + ');return null}catch(error){return error.code}})()');
        check('worker.survivor.unknownBarrier', denied === 'OUTCOME_UNKNOWN');
        check('worker.survivor.reconciled', (await method('reconcile', runId, req)).status === 'passed');
        await call({ type: 'hold', value: null });
        await method('resume', runId); await method('pause', runId);
    }
    await method('create', { runId: 'lease-owner', tabId: actualTabId, goal: 'Own tab' });
    await method('start', 'lease-owner');
    await method('create', { runId: 'lease-peer', tabId: actualTabId, goal: 'Compete for tab' });
    const peer = await evaluate('globalThis.compete(' + JSON.stringify({ database, clock, runId: 'lease-peer' }) + ')');
    check('lease.twoWorkersOneOwner', peer.ok === false && peer.code === 'TAB_BUSY');
    await method('pause', 'lease-owner');
    await method('create', { runId: 'input', tabId: actualTabId, goal: 'Input attribution' });
    const o = await method('start', 'input');
    const text = o.elements.find(e => e.role === 'textbox' && e.name === '姓名');
    await call({ type: 'monitor' });
    await method('execute', 'input', { actionId: globalThis.crypto.randomUUID(), action: { kind: 'fill', target: { documentId: o.documentId, frameId: o.frameId, observationId: o.observationId, ref: text.ref }, value: 'program' }, timeoutMs: 3000 });
    await call({ type: 'externalInput' });
    const trusted = await call({ type: 'trusted' });
    check('input.trustedCannotProveUser', trusted.length >= 2 && trusted.every(v => v === true));
    check('input.unknownPauses', (await method('get', 'input')).snapshot.status === 'paused');
    check('oracle.onlyRecordedEffects', (await control.state(session.sessionId)).clicks.primary === effects);
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
    await writeFile(path.join(reports, process.env.WISP_RUNTIME_REPORT || 't008-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed')
        process.exitCode = 1;
}
