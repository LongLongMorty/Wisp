import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createTaskRuntime, createMemoryStore } from '../packages/runtime/dist/index.mjs';
import { createPolicyGateway } from '../packages/policy/dist/index.mjs';
import { createChromeAdapter } from '../packages/browser-chrome/dist/index.mjs';
import { createChatModel } from '../packages/models/dist/index.mjs';
import { createFixtureServer } from '../fixtures/web/server.mjs';
import { createController } from '../fixtures/web/oracle.mjs';
import { releaseHashes, writeRelease, archiveRelease } from './release-evidence.mjs';
import { launchReleaseChrome, machine, navigate, waitFor, browserFailure } from './release-chrome.mjs';
import { taskVersion, scenarios, goals, schemas, siteRules, evaluateTrial, scoreTrials } from './release-cases.mjs';

await archiveRelease(['live']);
const report = { timestamp: new Date().toISOString(), kind: 'actual-model-browser-tasks', taskVersion, machine: machine(), status: 'not-configured', files: await releaseHashes(), trials: [], checks: [] };
const endpoint = process.env.WISP_MODEL_ENDPOINT, model = process.env.WISP_MODEL_NAME, apiKey = process.env.WISP_MODEL_API_KEY;
let chrome, server;
try {
    if (endpoint && model) {
        // Validate before launching or sending requests; never put raw endpoint/key in evidence.
        const config = { endpoint, model, ...(apiKey ? { apiKey } : {}), jsonMode: process.env.WISP_MODEL_JSON_MODE !== 'off', timeoutMs: 30000 };
        createChatModel(config);
        report.status = 'running';
        report.configuration = { endpointSha256: createHash('sha256').update(endpoint).digest('hex'), model, jsonMode: config.jsonMode, promptSha256: createHash('sha256').update(await readFile(new URL('../packages/models/src/index.mts', import.meta.url))).digest('hex'), taskVersion, timeoutMs: 30000, limits: { maxSteps: 30, maxModelCalls: 40, maxDurationMs: 300000 } };
        chrome = await launchReleaseChrome(); report.browser = await chrome.send('Browser.getVersion');
        server = await createFixtureServer(); report.fixtureVersion = server.version; const control = createController(server);
        for (const scenario of scenarios) for (let iteration = 1; iteration <= 5; iteration++) {
            const trial = { scenario, iteration, runId: crypto.randomUUID(), modelAttempts: 0, checks: { noEffects: false, business: false, source: false, passed: false } };
            const session = await control.create(), page = await chrome.page(), store = createMemoryStore();
            const origin = new URL(session.baseUrl).origin, extensionId = 'a'.repeat(32), ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' };
            let runtime, snapshot, pending, actualPage; const began = performance.now();
            try {
                await navigate(page, session.baseUrl + '/' + scenario, scenario);
                if (scenario === 'search') await waitFor(() => page.evaluate('document.querySelectorAll("#results a").length===12'));
                if (scenario === 'table') await waitFor(() => page.evaluate('document.querySelectorAll("#rows tr").length===12'));
                runtime = await createTaskRuntime({ store,
                    loop: { modelFactory({ onAttempt, attemptLimit }) { return createChatModel({ ...config, corrections: attemptLimit - 1, onAttempt() { onAttempt(); trial.modelAttempts++; } }); } },
                    gatewayFactory: async () => {
                        const browser = createChromeAdapter({ send: (method, params) => page.send(method, params) }, { allowedOrigins: [origin] });
                        const gateway = createPolicyGateway({ browser, readContext: (request, signal) => browser.readPolicyContext(request, signal), extensionId, uiUrl: ui.url, tabId: 1, rules: siteRules(session.baseUrl) });
                        gateway.grantOrigin(origin, ui); return gateway;
                    } });
                await runtime.create({ runId: trial.runId, tabId: 1, goal: goals[scenario] });
                await runtime.configureLoop(trial.runId, { schemas: scenario === 'table' ? schemas : {}, ...(scenario==='search'?{completionConditions:[{kind:'url',startsWith:session.baseUrl+'/records/'},{kind:'text',includes:'报表访问异常'}]}:{}) });
                await runtime.start(trial.runId); snapshot = await runtime.drive(trial.runId); pending = await runtime.pending(trial.runId);
                actualPage = await page.evaluate(scenario === 'search' ? '({url:location.href,record:document.body.dataset.record,title:document.getElementById("record-title")?.textContent})' : scenario === 'table' ? '({status:document.getElementById("status-filter")?.value,priority:document.getElementById("priority-filter")?.value,ids:[...document.querySelectorAll("#rows tr")].map(r=>r.cells[0].textContent)})' : '({title:document.querySelector("[name=title]")?.value,description:document.querySelector("[name=description]")?.value,priority:document.querySelector("[name=priority]")?.value})');
                const stored = await runtime.get(trial.runId);
                trial.status = snapshot.status; trial.reason = stored.reason; trial.budget = stored.loop.budget; trial.usage = stored.loop.usage;
                trial.stopReason=stored.loop.stopReason;trial.failureCode=snapshot.result?.status==='failed'?snapshot.result.error.code:undefined;
                trial.journal = await runtime.events(trial.runId);
            } catch (error) { trial.error = { code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'PROBE_ERROR' }; }
            finally {
                if (runtime) { await runtime.cancel(trial.runId).catch(() => {}); await runtime.dispose(); }
                store.close(); await page.close();
                // Check after target close and adapter teardown; save requests still pending are unsafe.
                const oracle = await control.state(session.sessionId);
                // Keep only bounded fixture results/proof metadata, never model prose or DOM.
                const proof = e => ({ kind: e.kind, url: e.url, documentId: e.documentId, observationId: e.observationId, capturedAt: e.capturedAt, actual: '[REDACTED]' });
                trial.outcome = { baseUrl: session.baseUrl, page: actualPage, oracle: { submissions: oracle.submissions.map(() => ({})), saves: oracle.saves.map(() => ({})), pendingSaves: oracle.pendingSaves, clicks: oracle.clicks, expected: oracle.expected },
                    ...(snapshot ? { snapshot: { status: snapshot.status, result: { ...(snapshot.result?.evidence ? { evidence: snapshot.result.evidence.map(proof) } : {}), ...(snapshot.result?.extraction ? { extraction: { data: snapshot.result.extraction.data, source: snapshot.result.extraction.source.map(proof) } } : {}) } } } : {}),
                    ...(pending?.kind === 'confirm' ? { pending: { kind: pending.kind, confirmation: { confirmationId: pending.confirmation.confirmationId, actionId: pending.confirmation.actionId, documentId: pending.confirmation.documentId, origin: pending.confirmation.origin, expiresAt: pending.confirmation.expiresAt, displayParameters: pending.confirmation.displayParameters } } } : {}) };
                trial.checks = evaluateTrial(scenario, trial.outcome);
                trial.checks.passed = trial.checks.passed && !trial.error;
                trial.durationMs = performance.now() - began;
                report.trials.push(trial); await writeRelease('live', report);
                await control.remove(session.sessionId);
                console.log('Actual model ' + scenario + ' ' + iteration + '/5: ' + (trial.checks.passed ? 'passed' : 'failed') + '; attempts=' + trial.modelAttempts);
            }
        }
        report.score = scoreTrials(report.trials); report.status = report.score.passed ? 'passed' : 'failed';
    }
} catch (error) {
    report.status = chrome && report.trials.length === 0 ? browserFailure(error, chrome.stderr()) : 'failed';
    report.error = { code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'CONFIGURATION_OR_BROWSER_ERROR' };
    if (chrome) report.browserStderr = chrome.stderr();
} finally {
    await chrome?.close(); await server?.close();
    await writeRelease('live', report); console.log('Actual model 15 tasks: ' + report.status);
    if (report.status !== 'passed') process.exitCode = 1;
}
