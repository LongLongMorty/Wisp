import { createChromeAdapter } from '../packages/browser-chrome/dist/index.mjs';
import { createTaskRuntime, createMemoryStore } from '../packages/runtime/dist/index.mjs';
import { createPolicyGateway } from '../packages/policy/dist/index.mjs';
import { createFixtureServer } from '../fixtures/web/server.mjs';
import { createController, assertNoEffects } from '../fixtures/web/oracle.mjs';
import { releaseHashes, writeRelease, archiveRelease, performancePassed } from './release-evidence.mjs';
import { launchReleaseChrome, machine, navigate, browserFailure } from './release-chrome.mjs';
await archiveRelease(['performance']);
const report = { timestamp: new Date().toISOString(), kind: 'real-chrome-performance', status: 'pending', machine: machine(), files: await releaseHashes(), boundary: '1280x720; full observe including CDP and serialization; excludes navigation/model; stop uses pending model double, not a provider request' };
let chrome, server, adapter, runtime, store;
try {
    chrome = await launchReleaseChrome(); report.browser = await chrome.send('Browser.getVersion');
    server = await createFixtureServer(); report.fixtureVersion = server.version;
    const control = createController(server), session = await control.create(), page = await chrome.page(), origin = new URL(session.baseUrl).origin;
    await navigate(page, session.baseUrl + '/performance', 'performance');
    adapter = createChromeAdapter({ send: (method, params) => page.send(method, params) }, { allowedOrigins: [origin] });
    const samplesMs = []; let observed;
    for (let i = 0; i < 30; i++) { const start = performance.now(); observed = await adapter.observe(); samplesMs.push(performance.now() - start); }
    const sorted = [...samplesMs].sort((a, b) => a - b);
    report.observation = { samplesMs, sampleCount: samplesMs.length, p50Ms: sorted[14], p95Ms: sorted[28], maxMs: sorted[29], returnedElements: observed.elements.length, candidateButtons: await page.evaluate('document.querySelectorAll("button").length'), visibleButtons: await page.evaluate('[...document.querySelectorAll("button")].filter(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth}).length') };
    await adapter.dispose(); adapter = undefined;
    await navigate(page, session.baseUrl + '/controls', 'controls');
    let entered; const hit = new Promise(r => entered = r);
    const extensionId = 'a'.repeat(32), ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' };
    store = createMemoryStore();
    runtime = await createTaskRuntime({ store, loop: { modelFactory({ onAttempt }) { return { decide(_input, signal) { onAttempt(); entered(); return new Promise((_resolve, reject) => { const abort = () => reject(Object.assign(Error('ABORTED'), { code: 'ABORTED' })); if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }); } }; } }, gatewayFactory: async () => {
        const browser = createChromeAdapter({ send: (method, params) => page.send(method, params) }, { allowedOrigins: [origin] });
        const gateway = createPolicyGateway({ browser, readContext: (r, s) => browser.readPolicyContext(r, s), extensionId, uiUrl: ui.url, tabId: 1 }); gateway.grantOrigin(origin, ui); return gateway;
    } });
    await runtime.create({ runId: 'release-stop', tabId: 1, goal: '等待模型期间停止' }); await runtime.configureLoop('release-stop'); await runtime.start('release-stop');
    const drive = runtime.drive('release-stop'); drive.catch(() => {});
    let timer;
    try { await Promise.race([hit, new Promise((_r, reject) => { timer = setTimeout(() => reject(Error('MODEL_NOT_ENTERED')), 5000); })]); }
    finally { clearTimeout(timer); }
    const start = performance.now(); await runtime.cancel('release-stop'); const cancelled = (await runtime.get('release-stop')).snapshot.status === 'cancelled', stateMs = performance.now() - start;
    await drive; await runtime.dispose(); runtime = undefined;
    const state = await control.state(session.sessionId); assertNoEffects(state);
    report.stop = { stateMs, cancelled, noLateEffects: true, ui: 'requires separate human review' };
    report.status = 'passed'; if (!performancePassed(report)) report.status = 'failed';
} catch (error) {
    report.status = !report.observation && chrome ? browserFailure(error, chrome.stderr()) : 'failed';
    report.error = { code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'BROWSER_OR_ASSERTION_FAILED' };
    if (chrome) report.browserStderr = chrome.stderr();
} finally {
    await runtime?.dispose(); store?.close(); await adapter?.dispose().catch(() => {}); await chrome?.close(); await server?.close();
    await writeRelease('performance', report); console.log('Release performance: ' + report.status);
    if (report.status !== 'passed') process.exitCode = 1;
}
