import { createTaskRuntime, openIndexedDbStore } from './modules/runtime/index.mjs';
import { createChromeAdapter } from './modules/browser-chrome/index.mjs';
import { createPolicyGateway } from './modules/policy/index.mjs';
let runtime, store, config, tabId, ui;
const holds = new Map();
const bootId = crypto.randomUUID();
async function command(method, params = {}) { return chrome.debugger.sendCommand({ tabId }, method, params); }
async function initialize(message, sender) {
    config = message;
    ui = { id: sender.id, url: sender.url };
    const tabs = await chrome.tabs.query({});
    tabId = tabs.find(t => t.url?.startsWith(config.baseUrl))?.id;
    if (!Number.isInteger(tabId))
        throw Error('Fixture tab missing');
    store = await openIndexedDbStore({ name: config.database });
    runtime = await createTaskRuntime({ store, sessionId: bootId, now: () => config.clock, autoHeartbeat: false, onCheckpoint: async (phase, actionId) => {
            void chrome.runtime.sendMessage({ type: 'checkpoint', phase, actionId, bootId }).catch(() => { });
            if (config.hold === phase)
                await new Promise(resolve => holds.set(actionId, resolve));
        }, gatewayFactory: async (run) => {
            if (run.tabId !== tabId)
                throw Object.assign(Error('TAB_BUSY'), { code: 'TAB_BUSY' });
            try {
                await command('Page.getFrameTree');
            }
            catch {
                await chrome.debugger.attach({ tabId }, '1.3');
            }
            const browser = createChromeAdapter({ send: (method, params) => command(method, params) }, { allowedOrigins: [new URL(config.baseUrl).origin] });
            const gateway = createPolicyGateway({ browser, readContext: (request, signal) => browser.readPolicyContext(request, signal), extensionId: chrome.runtime.id, uiUrl: chrome.runtime.getURL('sidepanel.html'), tabId, rules: [{ origin: new URL(config.baseUrl).origin, path: new URL(config.baseUrl).pathname + '/controls', kind: 'click', role: 'button', name: '普通按钮', decision: 'allow' }] });
            gateway.grantOrigin(new URL(config.baseUrl).origin, ui);
            return gateway;
        } });
    return { bootId, tabId };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html'))
        return false;
    void (async () => {
        try {
            let data;
            if (message.type === 'init')
                data = await initialize(message, sender);
            else if (message.type === 'hold') {
                config.hold = message.value;
                data = true;
            }
            else if (message.type === 'clock') {
                config.clock = message.value;
                data = true;
            }
            else if (message.type === 'release') {
                const release = holds.get(message.actionId);
                holds.delete(message.actionId);
                release?.();
                data = !!release;
            }
            else if (message.type === 'monitor') {
                await command('Runtime.evaluate', { expression: 'globalThis.__wispTrusted=[];document.getElementById("name").addEventListener("input",event=>globalThis.__wispTrusted.push(event.isTrusted))' });
                data = true;
            }
            else if (message.type === 'externalInput') {
                await command('Input.insertText', { text: 'external' });
                await runtime.notifyInput(tabId, 'unknown');
                data = true;
            }
            else if (message.type === 'trusted') {
                data = (await command('Runtime.evaluate', { expression: 'globalThis.__wispTrusted', returnByValue: true })).result.value;
            }
            else if (message.type === 'rollback') {
                try {
                    await store.transact(s => { s.generations.set(999, 99); throw Error('rollback'); });
                }
                catch { }
                data = await store.transact(s => !s.generations.has(999));
            }
            else if (message.type === 'runtime') {
                const allowed = new Set(['create', 'start', 'resume', 'pause', 'cancel', 'get', 'events', 'execute', 'reconcile', 'acknowledgeUnknown', 'notifyInput']);
                if (!allowed.has(message.method))
                    throw Error('Unknown command');
                data = await runtime[message.method](...message.args);
            }
            else
                throw Error('Unknown message');
            reply({ ok: true, data, bootId });
        }
        catch (error) {
            reply({ ok: false, code: error.code || 'DISCONNECTED', bootId });
        }
    })();
    return true;
});
