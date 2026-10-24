import os from 'node:os';
import { createChromeAdapter } from '../dist/index.mjs';
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
const cache = path.join(root, '.cache/t006');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(path.join(cache, 'chrome-'));
const executable = process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report = { machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, timestamp: new Date().toISOString(), fixtureVersion: server.version, node: process.version, platform: process.platform, status: 'pending', checks: [], files: {} };
for (const relative of ['packages/browser-chrome/src/references.mts', 'packages/browser-chrome/src/sanitize.mts', 'packages/browser-chrome/src/document.mts', 'packages/browser-chrome/src/control-document.mts', 'packages/browser-chrome/src/chrome.mts', 'packages/browser-chrome/src/adapter.mts', 'packages/browser-chrome/src/index.mts', 'packages/protocol/src/index.mts', 'packages/protocol/src/actions.mts', 'packages/protocol/src/observation.mts', 'packages/protocol/src/runtime.mts', 'packages/protocol/src/validation.mts', 'packages/protocol/src/messages.mts','packages/protocol/src/policy.mts', 'scripts/control-smoke.mjs', 'packages/browser-chrome/test/control-browser.mjs', 'packages/browser-chrome/package.json', 'packages/browser-chrome/tsconfig.json', 'fixtures/web/server.mjs', 'fixtures/web/domain.mjs', 'fixtures/web/pages.mjs', 'fixtures/web/oracle.mjs', 'fixtures/web/public/app.mjs', 'fixtures/web/public/style.css', 'probes/t001/vendor/react.production.min.js', 'probes/t001/vendor/react-dom.production.min.js'])
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
    async function target(role, name) { const observation = await adapter.observe(); const matches = observation.elements.filter(el => el.role === role && el.name === name); assert.equal(matches.length, 1, 'unique target ' + name); return { documentId: observation.documentId, frameId: observation.frameId, observationId: observation.observationId, ref: matches[0].ref }; }
    const request = (action, expected, timeoutMs = 3000) => ({ actionId: globalThis.crypto.randomUUID(), action, timeoutMs, ...(expected ? { expected } : {}) });
    await navigate('controls');
    const field = await target('textbox', '姓名');
    let result = await adapter.execute(request({ kind: 'fill', target: field, value: 'first' }, [{ kind: 'value', target: field, equals: 'first' }]));
    check('input.replaceInitial', result.verified === 'passed' && await evaluate('document.getElementById("echo").textContent==="first"'));
    result = await adapter.execute(request({ kind: 'fill', target: field, value: '替换文本' }, [{ kind: 'value', target: field, equals: '替换文本' }]));
    check('input.replaceExisting', result.verified === 'passed' && await evaluate('document.getElementById("echo").textContent==="替换文本"'));
    result = await adapter.execute(request({ kind: 'fill', target: field, value: '' }, [{ kind: 'value', target: field, equals: '' }]));
    check('input.clear', result.verified === 'passed' && await evaluate('document.getElementById("echo").textContent===""'));
    const primary = await target('button', '普通按钮');
    const once = request({ kind: 'click', target: primary });
    result = await adapter.execute(once);
    await adapter.execute(once);
    await wait(async () => ((await control.state(session.sessionId)).clicks.primary || 0) === 1);
    check('click.deduplicate', result.dispatched === 'yes' && result.verified === 'not_checked' && result.responded === 'unknown');
    result = await adapter.execute(request({ kind: 'pressKey', target: await target('button', '普通按钮'), key: 'Enter' }));
    await wait(async () => ((await control.state(session.sessionId)).clicks.primary || 0) === 2);
    check('input.keyboardDoesNotExtraClick', result.dispatched === 'yes');
    for (const name of ['禁用按钮', '被遮挡按钮']) {
        result = await adapter.execute(request({ kind: 'click', target: await target('button', name) }));
        check('actionability.' + name, result.dispatched === 'no' && result.error?.code === 'NOT_ACTIONABLE');
    }
    result = await adapter.execute(request({ kind: 'click', target: await target('button', 'Shadow按钮') }));
    await wait(async () => ((await control.state(session.sessionId)).clicks.shadow || 0) === 1);
    check('click.openShadow', result.dispatched === 'yes');
    const state = await control.state(session.sessionId);
    check('actionability.noForbiddenEffects', !state.clicks.disabled && !state.clicks.covered);
    result = await adapter.execute(request({ kind: 'scroll', direction: 'down', pixels: 600 }));
    await wait(() => evaluate('scrollY>0'));
    check('input.scroll', result.dispatched === 'yes');
    result = await adapter.execute(request({ kind: 'navigate', url: session.baseUrl + '/search' }, [{ kind: 'url', equals: session.baseUrl + '/search' }]));
    check('input.navigate', result.verified === 'passed');
    await wait(() => evaluate('document.body?.dataset.page==="search"'));
    const query = await target('textbox', '搜索工单');
    await adapter.execute(request({ kind: 'fill', target: query, value: '登录超时' }));
    result = await adapter.execute(request({ kind: 'pressKey', target: query, key: 'Enter' }, [{ kind: 'text', includes: 'W-102' }]));
    check('input.pressEnter', result.verified === 'passed');
    await navigate('rerender');
    const stale = await target('button', '处理工单');
    await evaluate('document.getElementById("replace").click()');
    result = await adapter.execute(request({ kind: 'click', target: stale }));
    check('reference.noReplacementClick', result.dispatched === 'no' && result.error?.code === 'STALE_TARGET' && !(await control.state(session.sessionId)).clicks.rerender);
    await control.configure(session.sessionId, { delayMs: 650, saveMode: 'success' });
    await navigate('delayed-save');
    const saveTitle = await target('textbox', '保存标题');
    const saving = adapter.execute(request({ kind: 'click', target: await target('button', '保存') }, [{ kind: 'text', includes: '保存成功' }, { kind: 'value', target: saveTitle, equals: '待保存工单' }]));
    await wait(async () => (await control.state(session.sessionId)).pendingSaves === 1);
    check('save.loadingNotComplete', await evaluate('document.getElementById("status").textContent==="正在保存"'));
    result = await saving;
    assertSavedTitle(await control.state(session.sessionId), '待保存工单');
    check('save.verifiedSuccess', result.verified === 'passed' && result.evidence.length > 0);
    await control.configure(session.sessionId, { delayMs: 20, saveMode: 'failure' });
    await navigate('delayed-save');
    result = await adapter.execute(request({ kind: 'click', target: await target('button', '保存') }, [{ kind: 'text', includes: '保存成功' }], 450));
    check('save.failureIsNotSuccess', result.error?.code === 'TIMEOUT' && result.verified !== 'passed' && (await control.state(session.sessionId)).saves.length === 1);
    await navigate('safety');
    result = await adapter.execute(request({ kind: 'fill', target: await target('textbox', '密码'), value: 'must-not-type' }));
    check('safety.sensitiveHandoff', result.dispatched === 'no' && result.error?.code === 'POLICY_DENIED');
    result = await adapter.execute(request({ kind: 'navigate', url: 'https://denied.example/' }));
    check('safety.originDenied', result.dispatched === 'no' && result.error?.code === 'PERMISSION_DENIED');
    await navigate('controls');
    const react = await readFile(path.join(root, 'probes/t001/vendor/react.production.min.js'), 'utf8'), reactDom = await readFile(path.join(root, 'probes/t001/vendor/react-dom.production.min.js'), 'utf8');
    await evaluate(react + ';' + reactDom + ';(()=>{const root=document.createElement("div");document.body.prepend(root);function App(){const [value,setValue]=React.useState("initial");return React.createElement("label",null,"React输入",React.createElement("input",{id:"controlled",value,onChange:e=>setValue(e.target.value)}),React.createElement("output",{id:"controlled-echo"},value))}ReactDOM.createRoot(root).render(React.createElement(App))})()');
    await wait(() => evaluate('!!document.getElementById("controlled")'));
    const reactObservation = await adapter.observe();
    const reactMatches = reactObservation.elements.filter(el => el.role === 'textbox' && el.name.startsWith('React输入'));
    assert.equal(reactMatches.length, 1, 'unique target React输入');
    const reactField = { documentId: reactObservation.documentId, frameId: reactObservation.frameId, observationId: reactObservation.observationId, ref: reactMatches[0].ref };
    result = await adapter.execute(request({ kind: 'fill', target: reactField, value: 'React replaced' }, [{ kind: 'value', target: reactField, equals: 'React replaced' }]));
    check('input.reactControlled', result.verified === 'passed' && await evaluate('document.getElementById("controlled-echo").textContent==="React replaced"'));
    await evaluate('for(let i=0;i<2;i++){const button=document.createElement("button");button.textContent="重复目标";document.body.prepend(button)}');
    await assert.rejects(adapter.verify([{ kind: 'element', role: 'button', name: '重复目标', state: 'visible' }]), { code: 'AMBIGUOUS_TARGET' });
    check('verify.semanticAmbiguity', true);
    await adapter.dispose();
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
    await writeFile(path.join(reports, process.env.WISP_CONTROL_REPORT || 't006-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed')
        process.exitCode = 1;
}
