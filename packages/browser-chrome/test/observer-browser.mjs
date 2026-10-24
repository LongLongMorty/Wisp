import os from 'node:os';
import { createChromeObserver } from '../dist/index.mjs';
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
const cache = path.join(root, '.cache/t005');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
for (const relative of ['packages/browser-chrome/src/references.mts', 'packages/browser-chrome/src/sanitize.mts', 'packages/browser-chrome/src/document.mts', 'packages/browser-chrome/src/chrome.mts', 'packages/browser-chrome/src/control-document.mts', 'packages/browser-chrome/src/index.mts', 'packages/browser-chrome/test/observer-browser.mjs', 'packages/browser-chrome/package.json', 'packages/browser-chrome/tsconfig.json', 'fixtures/web/domain.mjs', 'fixtures/web/server.mjs', 'fixtures/web/oracle.mjs', 'fixtures/web/pages.mjs', 'fixtures/web/public/app.mjs', 'fixtures/web/public/style.css'])
    report.files[relative] = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
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
    const observer = createChromeObserver({ send: (method, params) => send(method, params, sessionId) }, { allowedOrigins: [new URL(session.baseUrl).origin] });
    await navigate('controls');
    let observed = await observer.observe();
    check('observe.semanticControls', observed.elements.some(e => e.role === 'button') && observed.elements.some(e => e.editable));
    check('observe.disabled', observed.elements.some(e => !e.enabled));
    const shadowText = await evaluate('document.getElementById("shadow-host").shadowRoot.querySelector("button").textContent');
    check('observe.openShadow', observed.elements.some(e => e.name.includes(shadowText)));
    await evaluate('(()=>{const secret="WISP_PRIVATE_987654";const input=document.createElement("input");input.type="password";input.value=secret;input.setAttribute("aria-label","密码");const echo=document.createElement("p");echo.textContent=secret;document.body.prepend(input,echo);document.title=secret;history.replaceState(null,"","?token="+secret);})()');
    observed = await observer.observe();
    check('observe.redaction', !JSON.stringify(observed).includes('WISP_PRIVATE_987654') && observed.elements.some(e => e.sensitive));
    const clipped = await observer.observe({ maxNodes: 1 });
    check('observe.incompleteScanSuppressesText', clipped.text === '' && clipped.title === '' && clipped.truncationReasons.includes('unsupported_content'));
    const limited = await observer.observe({ maxElements: 1, maxChars: 1024, maxBytes: 2048 });
    check('observe.budget', limited.truncated && limited.elements.length <= 1 && JSON.stringify(limited).length <= 1024 && Buffer.byteLength(JSON.stringify(limited)) <= 2048);
    await navigate('rerender');
    observed = await observer.observe();
    const entry = observed.elements.find(e => e.name === '处理工单');
    assert.ok(entry, 'rerender target present');
    const target = { documentId: observed.documentId, frameId: observed.frameId, observationId: observed.observationId, ref: entry.ref };
    await evaluate('document.getElementById("increment").click()');
    check('reference.unrelatedRender', (await observer.inspect(target)).ref === entry.ref);
    await evaluate('document.getElementById("replace").click()');
    await assert.rejects(observer.inspect(target), { code: 'STALE_TARGET' });
    check('reference.replacement', true);
    observed = await observer.observe();
    const next = observed.elements.find(e => e.name === '处理工单');
    const nextTarget = { documentId: observed.documentId, frameId: observed.frameId, observationId: observed.observationId, ref: next.ref };
    await evaluate('(()=>{const el=document.getElementById("stable-target"),parent=el.parentNode;el.remove();parent.append(el)})()');
    await assert.rejects(observer.inspect(nextTarget), { code: 'STALE_TARGET' });
    check('reference.sameObjectReinsert', true);
    observed = await observer.observe();
    const retained = observed.elements[0];
    const old = { documentId: observed.documentId, frameId: observed.frameId, observationId: observed.observationId, ref: retained.ref };
    for (let i = 0; i < 8; i++)
        await observer.observe();
    await assert.rejects(observer.inspect(old), { code: 'STALE_TARGET' });
    check('reference.scopeExpiry', true);
    await navigate('safety');
    await assert.rejects(observer.inspect(old), { code: 'STALE_TARGET' });
    check('reference.navigation', true);
    observed = await observer.observe();
    check('observe.unsupportedFrame', observed.truncationReasons.includes('unsupported_content'));
    const denied = createChromeObserver({ send: (method, params) => send(method, params, sessionId) }, { allowedOrigins: ['https://denied.example'] });
    await assert.rejects(denied.observe(), { code: 'PERMISSION_DENIED' });
    await denied.dispose();
    check('observe.originGate', true);
    await navigate('performance');
    const samples = [];
    for (let i = 0; i < 30; i++) {
        const began = performance.now();
        observed = await observer.observe();
        samples.push(performance.now() - began);
    }
    samples.sort((a, b) => a - b);
    report.performance = { sampleCount: 30, p50Ms: samples[14], p95Ms: samples[28], maxMs: samples[29], returnedElements: observed.elements.length, candidateButtons: await evaluate('document.querySelectorAll("button").length') };
    check('observe.performance', report.performance.candidateButtons === 200 && report.performance.p95Ms < 500);
    await observer.dispose();
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
    await writeFile(path.join(reports, process.env.WISP_OBSERVER_REPORT || 't005-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed')
        process.exitCode = 1;
}
