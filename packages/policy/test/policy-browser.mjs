import { createPolicyGateway } from '../dist/index.mjs';
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
const cache = path.join(root, '.cache/t007');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
for (const relative of ["packages/protocol/src/actions.mts", "packages/protocol/src/index.mts", "packages/protocol/src/messages.mts", "packages/protocol/src/observation.mts", "packages/protocol/src/policy.mts", "packages/protocol/src/runtime.mts", "packages/protocol/src/validation.mts", "packages/browser-chrome/src/adapter.mts", "packages/browser-chrome/src/chrome.mts", "packages/browser-chrome/src/control-document.mts", "packages/browser-chrome/src/document.mts", "packages/browser-chrome/src/index.mts", "packages/browser-chrome/src/references.mts", "packages/browser-chrome/src/sanitize.mts", "packages/policy/src/index.mts", "packages/policy/test/policy-browser.mjs", "scripts/policy-smoke.mjs", "fixtures/web/server.mjs", "fixtures/web/domain.mjs", "fixtures/web/pages.mjs", "fixtures/web/oracle.mjs", "fixtures/web/public/app.mjs", "fixtures/web/public/style.css"])
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
    const adapter = createChromeAdapter({ send: (method, params) => send(method, params, sessionId) }, { allowedOrigins: [new URL(session.baseUrl).origin] });
    const extensionId = 'a'.repeat(32), ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' };
    let clock = Date.now();
    report.confirmationClock = 'deterministic host clock; expiry advanced without wall-clock sleep';
    const gateway = createPolicyGateway({ browser: adapter, readContext: (request, signal) => adapter.readPolicyContext(request, signal), extensionId, uiUrl: ui.url, tabId: 1, now: () => clock });
    const request = (action, expected) => ({ actionId: globalThis.crypto.randomUUID(), action, timeoutMs: 3000, ...(expected ? { expected } : {}) });
    const message = (decision, vote = 'approve') => ({ version: '0.1', requestId: globalThis.crypto.randomUUID(), type: 'run.confirm', runId: 'run', payload: { confirmationId: decision.confirmation.confirmationId, decision: vote } });
    const rejects = async (fn) => {
        try {
            await fn();
            return false;
        }
        catch (error) {
            return ['POLICY_DENIED', 'STALE_TARGET', 'PERMISSION_DENIED'].includes(error.code);
        }
    };
    async function target(role, name) { const o = await gateway.observe(); const matches = o.elements.filter(e => e.role === role && e.name === name); assert.equal(matches.length, 1, name); return { documentId: o.documentId, frameId: o.frameId, observationId: o.observationId, ref: matches[0].ref }; }
    async function submission() { return gateway.submit('run', request({ kind: 'click', target: await target('button', '提交工单') }, [{ kind: 'text', includes: '提交成功' }])); }
    await navigate('form');
    check('authorization.noImplicitGrant', await rejects(() => gateway.observe()));
    gateway.grantOrigin(new URL(session.baseUrl).origin, ui);
    for (const [role, name, value] of [['textbox', '标题', '策略审批工单'], ['textbox', '描述', '只有有效批准才提交']]) {
        const d = await gateway.submit('run', request({ kind: 'fill', target: await target(role, name), value }));
        assert.equal(d.kind, 'executed');
        assert.equal(d.result.dispatched, 'yes');
    }
    check('policy.plainFillAllowed', true);
    let decision = await submission();
    check('confirmation.required', decision.kind === 'confirm' && (await control.state(session.sessionId)).submissions.length === 0);
    const fake = await evaluate('({id:' + JSON.stringify(extensionId) + ',url:location.href,tab:{id:1}})');
    check('confirmation.pageSenderRejected', await rejects(() => gateway.confirm(message(decision), fake)) && (await control.state(session.sessionId)).submissions.length === 0);
    check('confirmation.rejectNoSubmit', await rejects(() => gateway.confirm(message(decision, 'reject'), ui)) && (await control.state(session.sessionId)).submissions.length === 0);
    decision = await submission();
    let result = await gateway.confirm(message(decision), ui);
    assertSubmissionCount(await control.state(session.sessionId), 1);
    check('confirmation.approvedOnce', result.kind === 'executed' && result.result.verified === 'passed');
    check('confirmation.replayRejected', await rejects(() => gateway.confirm(message(decision), ui)) && (await control.state(session.sessionId)).submissions.length === 1);
    decision = await submission();
    await evaluate('document.querySelector("[name=title]").value="审批后修改"');
    check('confirmation.changedFieldRejected', await rejects(() => gateway.confirm(message(decision), ui)) && (await control.state(session.sessionId)).submissions.length === 1);
    decision = await submission();
    clock += 30000;
    check('confirmation.expiredRejected', await rejects(() => gateway.confirm(message(decision), ui)) && (await control.state(session.sessionId)).submissions.length === 1);
    decision = await submission();
    gateway.revokeOrigin(new URL(session.baseUrl).origin, ui);
    check('confirmation.revokedRejected', await rejects(() => gateway.confirm(message(decision), ui)) && (await control.state(session.sessionId)).submissions.length === 1);
    gateway.grantOrigin(new URL(session.baseUrl).origin, ui);
    decision = await submission();
    await navigate('controls');
    check('confirmation.navigationRejected', await rejects(() => gateway.confirm(message(decision), ui)) && (await control.state(session.sessionId)).submissions.length === 1);
    await navigate('form');
    await evaluate('document.querySelector("button[type=submit]").setAttribute("formaction","https://denied.example/submit")');
    decision = await gateway.submit('run', request({ kind: 'click', target: await target('button', '提交工单') }));
    check('authorization.formOverrideDenied', decision.kind === 'deny');
    decision = await gateway.submit('run', request({ kind: 'pressKey', target: await target('textbox', '标题'), key: 'Enter' }));
    check('authorization.enterSubmitOverrideDenied', decision.kind === 'deny');
    await evaluate('document.querySelector("button[type=submit]").removeAttribute("formaction");const p=document.createElement("input");p.type="password";p.value="PRIVATE_FORM_SECRET";p.hidden=true;document.getElementById("ticket-form").append(p)');
    const submit = request({ kind: 'click', target: await target('button', '提交工单') });
    const privateContext = await adapter.readPolicyContext(submit);
    decision = await gateway.submit('run', submit);
    check('policy.sensitiveFormHandoff', decision.kind === 'handoff' && !JSON.stringify(privateContext).includes('PRIVATE_FORM_SECRET'));
    await navigate('safety');
    decision = await gateway.submit('run', request({ kind: 'click', target: await target('link', '未授权站点链接') }));
    check('authorization.crossOriginLinkDenied', decision.kind === 'deny');
    decision = await gateway.submit('run', request({ kind: 'navigate', url: 'https://denied.example/' }));
    check('authorization.explicitNavigationDenied', decision.kind === 'deny');
    assertSubmissionCount(await control.state(session.sessionId), 1);
    check('oracle.exactlyOneApprovedSubmission', true);
    await gateway.dispose();
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
    await writeFile(path.join(reports, process.env.WISP_POLICY_REPORT || 't007-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed')
        process.exitCode = 1;
}
