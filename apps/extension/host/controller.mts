import { createAgent } from '@wisp/sdk';
import { createChatModel } from '@wisp/models';
import { RuntimeError } from '@wisp/runtime';
import type { RuntimeStore } from '@wisp/runtime';
import type { PolicyGateway, UiSender } from '@wisp/policy';
import type { RunSnapshot, JsonValue, RunLimits } from '@wisp/protocol';
import { parsePanelRequest, errorCode, exactOrigin, permissionPattern } from './protocol.mts';
import type { PanelRequest } from './protocol.mts';
export type NativeSender = UiSender & {
    documentId?: string;
};
export type ModelConfig = {
    endpoint: string;
    model: string;
    apiKey: string;
    jsonMode: boolean;
};
type Receipt = {
    hash: string;
    response?: unknown;
};
export type SessionState = {
    config?: ModelConfig;
    grants: string[];
    receipts: Record<string, Receipt>;
};
export type Platform = {
    extensionId: string;
    isPanel: (sender: NativeSender) => Promise<boolean>;
    loadSession: () => Promise<SessionState | undefined>;
    saveSession: (state: SessionState) => Promise<void>;
    tabs: () => Promise<{
        id: number;
        url: string;
        title: string;
    }[]>;
    hasPermission: (pattern: string) => Promise<boolean>;
    gateway: (run: RunSnapshot, origins: string[], sender: NativeSender, signal: AbortSignal) => Promise<PolicyGateway>;
};
const fail = (code: ConstructorParameters<typeof RuntimeError>[0]): never => { throw new RuntimeError(code); };
export function createPanelHost(platform: Platform, store: RuntimeStore) {
    let session: SessionState = { grants: [], receipts: {} }, initiator: NativeSender | undefined, confirmationSender: NativeSender | undefined, closed = false, transition = false;
    let serial: Promise<unknown> = Promise.resolve();
    const inflight = new Map<string, {
        hash: string;
        promise: Promise<unknown>;
    }>(), gateways = new Map<string, PolicyGateway>();
    const loaded = (async () => { const value = await platform.loadSession(); if (value)
        session = value; session.grants = session.grants.map(exactOrigin); if (session.config)
        validateConfig(session.config); })();
    void loaded.catch(() => { });
    function validateConfig(config: ModelConfig) { try {
        const { apiKey, ...rest } = config;
        createChatModel({ ...rest, ...(apiKey ? { apiKey } : {}) });
    }
    catch {
        fail('MODEL_INVALID_OUTPUT');
    } }
    const agent = createAgent({ store, modelFactory({ onAttempt, attemptLimit }) { if (!session.config)
            fail('POLICY_DENIED'); const saved=session.config!;const {apiKey,...config}=saved;const provider=createChatModel({...config,...(apiKey?{apiKey}:{}),onAttempt,corrections:(attemptLimit-1) as 0|1});async function check(){if(session.config!==saved||!await platform.hasPermission(permissionPattern(new URL(saved.endpoint).origin))||session.config!==saved)fail('PERMISSION_DENIED');}return {async decide(input,signal){await check();return provider.decide(input,signal);},async extract(input,signal){await check();return provider.extract(input,signal);}}; }, uiSender() { if (!confirmationSender)
            fail('PERMISSION_DENIED'); return confirmationSender!; }, gatewayFactory: async (run, signal) => { await loaded; if (!initiator || !await authorize(initiator))
            fail('PERMISSION_DENIED'); const tab = (await platform.tabs()).find(t => t.id === run.tabId); if (!tab || !session.grants.includes(new URL(tab.url).origin))
            fail('PERMISSION_DENIED'); const origins = []; for (const origin of session.grants)
            if (await platform.hasPermission(permissionPattern(origin)))
                origins.push(origin); if (!origins.includes(new URL(tab!.url).origin))
            fail('PERMISSION_DENIED'); const gateway = await platform.gateway(run, origins, initiator!, signal); for (const origin of origins)
            gateway.grantOrigin(origin, initiator!); gateways.set(run.runId, gateway); return gateway; } });
    const ready = Promise.all([loaded, agent.ready]).then(() => undefined);
    void ready.catch(() => { });
    async function authorize(sender: NativeSender) { return !!sender && sender.id === platform.extensionId && sender.url === 'chrome-extension://' + platform.extensionId + '/sidepanel.html' && (sender.frameId === undefined || sender.frameId === 0) && (sender.documentId === undefined || sender.documentId.length <= 256) && (sender.origin === undefined || sender.origin === 'chrome-extension://' + platform.extensionId) && (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active') && await platform.isPanel(sender); }
    function ordered<T>(fn: () => Promise<T>) { const p = serial.then(fn); serial = p.catch(() => { }); return p; }
    async function persist() { await platform.saveSession(structuredClone(session)); }
    const publicConfig = () => session.config ? { endpoint: session.config.endpoint, model: session.config.model, jsonMode: session.config.jsonMode, hasKey: !!session.config.apiKey } : null;
    async function pauseAll() { for (const run of await agent.history())
        if (['running', 'waiting_user'].includes(run.status))
            await agent.notifyInput(run.tabId, 'unknown'); }
    async function handle(r: PanelRequest, sender: NativeSender) { if (!['session.set', 'run.start'].includes(r.type))
        return execute(r, sender); if (transition)
        fail('TAB_BUSY'); transition = true; try {
        return await execute(r, sender);
    }
    finally {
        transition = false;
    } }
    async function execute(r: PanelRequest, sender: NativeSender) {
        const p = r.payload;
        if (r.type === 'session.get')
            return { config: publicConfig(), grants: session.grants };
        if (r.type === 'tabs.list')
            return (await platform.tabs()).filter(t => /^https?:/.test(t.url)).map(t => ({ id: t.id, url: t.url, title: t.title }));
        if (r.type === 'history.list')
            return agent.history();
        if (r.type === 'session.set') {
            if ((await agent.history()).some(x => ['created', 'running', 'waiting_user'].includes(x.status)))
                fail('TAB_BUSY');
            const config = { endpoint: p.endpoint, model: p.model, apiKey: p.apiKey, jsonMode: p.jsonMode } as ModelConfig;
            validateConfig(config);
            if (!await platform.hasPermission(permissionPattern(new URL(config.endpoint).origin)))
                fail('PERMISSION_DENIED');
            await ordered(async () => { session.config = config; await persist(); });
            return { configured: true };
        }
        if (r.type === 'session.clear') {
            delete session.config;
            await pauseAll();
            await ordered(persist);
            return { cleared: true };
        }
        if (r.type === 'origin.grant') {
            const origin = exactOrigin(p.origin);
            if (!await platform.hasPermission(permissionPattern(origin)))
                fail('PERMISSION_DENIED');
            await ordered(async () => { if (!session.grants.includes(origin))
                session.grants.push(origin); if (session.grants.length > 32)
                fail('BUDGET_EXCEEDED'); await persist(); });
            return { granted: true };
        }
        if (r.type === 'origin.revoke') {
            const origin = exactOrigin(p.origin);
            session.grants = session.grants.filter(o => o !== origin);
            for (const g of gateways.values())
                try {
                    g.revokeOrigin(origin, sender);
                }
                catch { }
            await pauseAll();
            await ordered(persist);
            return { revoked: true };
        }
        if (r.type === 'run.start') {
            if (!session.config)
                fail('POLICY_DENIED');
            const tab = (await platform.tabs()).find(t => t.id === p.tabId);
            if (!tab || !session.grants.includes(new URL(tab.url).origin) || !await platform.hasPermission(permissionPattern(new URL(tab.url).origin)))
                fail('PERMISSION_DENIED');
            initiator = sender;
            const h = agent.run({ tabId: p.tabId as number, goal: p.goal as string, ...(p.completionConditions ? { completionConditions:p.completionConditions as import('@wisp/protocol').Condition[] }:{}), ...(p.schemas ? { schemas: p.schemas as Record<string, JsonValue> } : {}), ...(p.limits ? { limits: p.limits as RunLimits } : {}) });
            await h.snapshot();
            return { runId: h.runId };
        }
        const runId = p.runId as string;
        if (r.type === 'run.delete') {
            await agent.deleteRun(runId);
            return { deleted: true };
        }
        if (r.type === 'run.acknowledge') {
            await agent.acknowledgeUnknown(runId, p.actionId as string);
            return { acknowledged: true };
        }
        const h = await agent.getRun(runId);
        if (r.type === 'run.get')
            return { snapshot: await h.snapshot(), pending: await h.pending() };
        if (r.type === 'run.events')
            return h.events((p.afterSeq as number | undefined) ?? 0);
        if (r.type === 'run.pause' || r.type === 'run.takeover')
            await h.pause();
        if (r.type === 'run.cancel')
            await h.cancel();
        if (r.type === 'run.resume') {
            if (!session.config)
                fail('POLICY_DENIED');
            initiator = sender;
            await h.resume(p.schemas ? { schemas: p.schemas as Record<string, JsonValue> } : undefined);
        }
        if (r.type === 'run.confirm') {
            if (confirmationSender)
                fail('TAB_BUSY');
            confirmationSender = sender;
            try {
                await h.confirm({ confirmationId: p.confirmationId as string, decision: p.decision as 'approve' | 'reject' });
            }
            finally {
                confirmationSender = undefined;
            }
        }
        return { accepted: true };
    }
    async function request(value: unknown, sender: NativeSender): Promise<unknown> {
        let r: PanelRequest;
        try {
            if (closed || !await authorize(sender))
                fail('PERMISSION_DENIED');
            r = parsePanelRequest(value);
            await ready;
            if (closed)
                fail('DISCONNECTED');
            sender = Object.fromEntries(['id', 'url', 'origin', 'frameId', 'documentId', 'documentLifecycle', 'tlsChannelId'].filter(k => (sender as Record<string, unknown>)[k] !== undefined).map(k => [k, (sender as Record<string, unknown>)[k]])) as NativeSender;
        }
        catch (error) {
            return { version: '0.1', ok: false, error: { code: errorCode(error) } };
        }
        const envelope = (data: unknown) => ({ version: '0.1', requestId: r.requestId, type: r.type, ok: true, data });
        const failure = (error: unknown) => ({ version: '0.1', requestId: r.requestId, type: r.type, ok: false, error: { code: errorCode(error) } });
        if (['run.pause', 'run.cancel', 'run.takeover', 'session.clear', 'origin.revoke'].includes(r.type)) {
            try {
                return envelope(await handle(r, sender));
            }
            catch (error) {
                return failure(error);
            }
        }
        if (['session.get', 'tabs.list', 'history.list', 'run.get', 'run.events'].includes(r.type)) {
            try {
                const response = envelope(await handle(r, sender));
                if (new TextEncoder().encode(JSON.stringify(response)).length > 65536)
                    fail('BUDGET_EXCEEDED');
                return response;
            }
            catch (error) {
                return failure(error);
            }
        }
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(r))))].map(x => x.toString(16).padStart(2, '0')).join('');
        const known = inflight.get(r.requestId);
        if (known)
            return known.hash === hash ? known.promise : failure(new RuntimeError('POLICY_DENIED'));
        const promise = (async () => {
            try {
                const previous = await ordered(async () => { const previous = Object.hasOwn(session.receipts, r.requestId) ? session.receipts[r.requestId] : undefined; if (previous)
                    return previous; if (Object.keys(session.receipts).length >= 256)
                    fail('BUDGET_EXCEEDED'); session.receipts[r.requestId] = { hash }; await persist(); return null; });
                if (previous) {
                    if (previous.hash !== hash)
                        fail('POLICY_DENIED');
                    return previous.response ?? failure(new RuntimeError('OUTCOME_UNKNOWN'));
                }
                let response;
                try {
                    response = envelope(await handle(r, sender));
                }
                catch (error) {
                    response = failure(error);
                }
                await ordered(async () => { session.receipts[r.requestId] = { hash, response }; await persist(); });
                return response;
            }
            catch (error) {
                return failure(error);
            }
            finally {
                inflight.delete(r.requestId);
            }
        })();
        inflight.set(r.requestId, { hash, promise });
        return promise;
    }
    return { ready, request, authorize, pauseAll, async recover() { await ready; await agent.recover(); }, async interruptTab(tabId: number) { await ready; await agent.notifyInput(tabId, 'unknown'); }, async refreshPermissions() { await ready; for (const origin of [...session.grants])
            if (!await platform.hasPermission(permissionPattern(origin))) {
                session.grants = session.grants.filter(o => o !== origin);
                for (const g of gateways.values())
                    try {
                        if (initiator)
                            g.revokeOrigin(origin, initiator);
                    }
                    catch { }
                await pauseAll();
            }if(session.config&&!await platform.hasPermission(permissionPattern(new URL(session.config.endpoint).origin))){delete session.config;await pauseAll();} await ordered(persist); }, async close() { closed = true; await agent.dispose(); } };
}
