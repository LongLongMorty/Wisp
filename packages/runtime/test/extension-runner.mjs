import { createTaskRuntime, openIndexedDbStore } from './modules/runtime/index.mjs';
globalThis.checkpoints = [];
globalThis.operations = {};
chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'checkpoint')
        globalThis.checkpoints.push(message);
});
globalThis.call = async (message) => {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply.ok)
        throw Object.assign(Error(reply.code), { code: reply.code });
    return reply.data;
};
globalThis.begin = (name, message) => { globalThis.operations[name] = { pending: true }; void call(message).then(data => globalThis.operations[name] = { ok: true, data }, error => globalThis.operations[name] = { ok: false, code: error.code || error.message }); return true; };
globalThis.compete = async (config) => new Promise((resolve, reject) => { const worker = new Worker('peer.mjs', { type: 'module' }); worker.onmessage = e => { worker.terminate(); resolve(e.data); }; worker.onerror = e => { worker.terminate(); reject(Error(e.message)); }; worker.postMessage(config); });
