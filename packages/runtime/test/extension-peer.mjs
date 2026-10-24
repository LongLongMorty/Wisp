import { createTaskRuntime, openIndexedDbStore } from './modules/runtime/index.mjs';
onmessage = async (event) => {
    let store, runtime;
    try {
        store = await openIndexedDbStore({ name: event.data.database });
        runtime = await createTaskRuntime({ store, sessionId: crypto.randomUUID(), now: () => event.data.clock, autoHeartbeat: false, gatewayFactory: async () => ({ observe: async () => { throw Error('Lease should deny before observation'); } }) });
        if (event.data.recoverOnly) postMessage({ ok: true, run: await runtime.get(event.data.runId) });
        else { await runtime.start(event.data.runId); postMessage({ ok: true }); }
    }
    catch (error) {
        postMessage({ ok: false, code: error.code || 'DISCONNECTED' });
    }
    finally {
        await runtime?.dispose();
        store?.close();
    }
};
