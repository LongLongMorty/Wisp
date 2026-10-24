import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { openIndexedDbStore } from '@wisp/runtime';
import { createChromeAdapter } from '@wisp/browser-chrome';
import { createPolicyGateway } from '@wisp/policy';
import { createPanelHost } from '../host/controller.mts';
import type { SessionState, NativeSender } from '../host/controller.mts';
export default defineBackground({ type: 'module', main() {
        const extensionId = browser.runtime.id, ports = new Set<unknown>();
        const attachments = new Map<number, {
            done: Promise<void>;
            release: () => void;
            disposing: boolean;
            onDetach: (() => void) | undefined;
        }>();
        const ready = (async () => {
            await browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
            const store = await openIndexedDbStore({ name: 'wisp-production-v01' });
            const host = createPanelHost({ extensionId,
                async isPanel(sender) { const url = browser.runtime.getURL('/sidepanel.html'); if (sender.tab || sender.url !== url) return false; const contexts = await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL'], ...(sender.documentId ? { documentIds: [sender.documentId] } : {}) }); return contexts.some(c => c.documentUrl === url && c.frameId <= 0 && (!sender.documentId || c.documentId === sender.documentId)); },
                async loadSession() { return (await browser.storage.session.get('wispSession')).wispSession as SessionState | undefined; },
                async saveSession(state) { await browser.storage.session.set({ wispSession: state }); },
                async tabs() { return (await browser.tabs.query({})).filter(t => t.id !== undefined && !!t.url && !t.incognito).map(t => ({ id: t.id!, url: t.url!, title: t.title ?? '' })); },
                async hasPermission(pattern) { return browser.permissions.contains({ origins: [pattern] }); },
                async gateway(run, origins, _sender, signal) {
                    await attachments.get(run.tabId)?.done;
                    const target = { tabId: run.tabId };
                    if (signal.aborted)
                        throw { code: 'ABORTED' };
                    let release!: () => void;
                    const attachment = { done: new Promise<void>(r => release = r), release: () => release(), disposing: false, onDetach: undefined as (() => void) | undefined };
                    attachments.set(run.tabId, attachment);
                    try {
                        try {
                            await browser.debugger.sendCommand(target, 'Page.getFrameTree');
                        }
                        catch {
                            await browser.debugger.attach(target, '1.3');
                        }
                        const adapter = createChromeAdapter({ async send(method, params, signal) { if (signal?.aborted)
                                throw { code: 'ABORTED' }; return browser.debugger.sendCommand(target, method, params); } }, { allowedOrigins: origins });
                        const g = createPolicyGateway({ browser: adapter, readContext: (request, signal) => adapter.readPolicyContext(request, signal), extensionId, uiUrl: browser.runtime.getURL('/sidepanel.html'), tabId: run.tabId });
                        return { ...g, async dispose() { try {
                                await g.dispose();
                                attachment.disposing = true;
                                let timer: ReturnType<typeof setTimeout> | undefined;
                                const detached = new Promise<void>(resolve => { attachment.onDetach = resolve; timer = setTimeout(resolve, 500); });
                                try {
                                    await browser.debugger.detach(target);
                                    await detached;
                                }
                                catch { }
                                finally {
                                    if (timer)
                                        clearTimeout(timer);
                                }
                            }
                            finally {
                                if (attachments.get(run.tabId) === attachment)
                                    attachments.delete(run.tabId);
                                attachment.release();
                            } } };
                    }
                    catch (error) {
                        attachment.disposing = true;
                        await browser.debugger.detach(target).catch(() => { });
                        attachments.delete(run.tabId);
                        attachment.release();
                        throw error;
                    }
                }
            }, store);
            await host.ready;
            setTimeout(() => { void host.recover().catch(() => { }); }, 5100);
            return host;
        })();
        void ready.catch(() => { });
        browser.runtime.onMessage.addListener((message, sender, respond) => { void ready.then(h => h.request(message, sender as NativeSender)).then(respond, () => respond({ version: '0.1', ok: false, error: { code: 'DISCONNECTED' } })); return true; });
        browser.runtime.onConnect.addListener(port => { if (port.name !== 'wisp.panel')
            return; let dropped = false; port.onDisconnect.addListener(() => { dropped = true; const verified = ports.delete(port); if (verified && !ports.size)
            void ready.then(h => h.pauseAll()).catch(() => { }); }); void ready.then(async (h) => { if (!port.sender || !await h.authorize(port.sender as NativeSender)) {
            port.disconnect();
            return;
        } if (!dropped)
            ports.add(port); }).catch(() => port.disconnect()); });
        (browser.sidePanel as unknown as {
            onClosed?: {
                addListener: (fn: () => void) => void;
            };
        }).onClosed?.addListener(() => { void ready.then(h => h.pauseAll()).catch(() => { }); });
        browser.debugger.onDetach.addListener(source => { if (source.tabId === undefined)
            return; const attachment = attachments.get(source.tabId); if (attachment?.disposing) {
            attachment.onDetach?.();
            return;
        } void ready.then(h => h.interruptTab(source.tabId!)).catch(() => { }); });
        browser.tabs.onRemoved.addListener(tabId => { void ready.then(h => h.interruptTab(tabId)).catch(() => { }); });
        browser.permissions.onRemoved.addListener(() => { void ready.then(h => h.refreshPermissions()).catch(() => { }); });
        browser.runtime.onInstalled.addListener(() => { void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { }); });
    } });
