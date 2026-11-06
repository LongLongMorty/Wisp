import assert from 'node:assert/strict';
import { createPolicyGateway } from '../dist/index.mjs';
import { createChromeAdapter } from '../../browser-chrome/dist/index.mjs';
import { createFixtureServer } from '../../../fixtures/web/server.mjs';
import { createController } from '../../../fixtures/web/oracle.mjs';
import { launchReleaseChrome, navigate, waitFor } from '../../../scripts/release-chrome.mjs';

const server = await createFixtureServer(), control = createController(server), session = await control.create();
const chrome = await launchReleaseChrome();
let gateway, page;
try {
    page = await chrome.page(); await navigate(page, session.baseUrl + '/controls', 'controls');
    const origin = new URL(session.baseUrl).origin, extensionId = 'a'.repeat(32), ui = { id: extensionId, url: 'chrome-extension://' + extensionId + '/sidepanel.html' };
    const browser = createChromeAdapter({ send: page.send }, { allowedOrigins: [origin] });
    gateway = createPolicyGateway({ browser, readContext: (request, signal) => browser.readPolicyContext(request, signal), extensionId, uiUrl: ui.url, tabId: 1 });
    gateway.grantOrigin(origin, ui);
    const setLength = n => page.evaluate('document.querySelector("button[data-click=primary]").setAttribute("data-long", "x".repeat(' + n + '))');
    async function request(name = '普通按钮') {
        const obs = await browser.observe(), element = obs.elements.find(e => e.role === 'button' && e.name === name);
        assert.ok(element); return { actionId: crypto.randomUUID(), action: { kind: 'click', target: { documentId: obs.documentId, frameId: obs.frameId, observationId: obs.observationId, ref: element.ref } }, timeoutMs: 3000 };
    }
    const vote = d => ({ version: '0.1', requestId: crypto.randomUUID(), type: 'run.confirm', runId: 'run', payload: { confirmationId: d.confirmation.confirmationId, decision: 'approve' } });
    const count = async () => (await control.state(session.sessionId)).clicks.primary || 0;
    await setLength(3186);
    let d = await gateway.submit('run', await request());
    assert.equal(d.kind, 'confirm'); assert.equal(await count(), 0);
    await page.evaluate('document.querySelector("button[data-click=primary]").setAttribute("data-long", "x".repeat(3185)+"y")');
    await assert.rejects(gateway.confirm(vote(d), ui)); assert.equal(await count(), 0);
    d = await gateway.submit('run', await request()); assert.equal(d.kind, 'confirm');
    assert.equal((await gateway.confirm(vote(d), ui)).kind, 'executed'); await waitFor(async () => await count() > 0); assert.equal(await count(), 1);
    await assert.rejects(gateway.confirm(vote(d), ui)); assert.equal(await count(), 1);
    await setLength(65537); d = await gateway.submit('run', await request());
    assert.equal(d.kind, 'handoff'); assert.equal(d.reason, 'INCOMPLETE_CONTEXT'); assert.equal(await count(), 1);
    await setLength(3186); await page.evaluate('document.querySelector("button[data-click=primary]").setAttribute("aria-label","login")');
    d = await gateway.submit('run', await request('login')); assert.equal(d.kind, 'handoff'); assert.equal(d.reason, 'SENSITIVE_OPERATION'); assert.equal(await count(), 1);
    await page.evaluate('document.querySelector("button[data-click=primary]").removeAttribute("aria-label")');
    gateway.revokeOrigin(origin, ui); d = await gateway.submit('run', await request());
    assert.equal(d.kind, 'deny'); assert.equal(d.reason, 'ORIGIN_NOT_GRANTED'); assert.equal(await count(), 1);
    console.log('Long-attribute browser: PASS; checks=16; browser=' + (await chrome.send('Browser.getVersion')).product);
} finally {
    await gateway?.dispose(); await page?.close(); await chrome.close(); await server.close();
}
