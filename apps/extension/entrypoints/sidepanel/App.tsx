import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { RunSnapshot, RuntimeEvent, ConfirmationRequest } from '@wisp/protocol';
import { rpc } from '../../host/client';
import { permissionPattern } from '../../host/protocol.mts';
type Tab = {
    id: number;
    url: string;
    title: string;
};
type History = {
    runId: string;
    tabId: number;
    goal: string;
    status: string;
    updatedAt: string;
    reason: string;
    unknownActionId: string | null;
};
type Session = {
    config: {
        endpoint: string;
        model: string;
        jsonMode: boolean;
        hasKey: boolean;
    } | null;
    grants: string[];
};
type Pending = {
    kind: string;
    question?: string;
    reason?: string;
    confirmation?: ConfirmationRequest;
} | null;
const names: Record<string, string> = { created: '准备中', running: '执行中', waiting_user: '等待你', paused: '已暂停', completed: '已完成', failed: '未完成', cancelled: '已停止' };
const eventNames: Record<string, string> = { 'run.state': '任务状态', 'step.observed': '观察网页', 'model.completed': '模型调用', 'action.prepared': '准备操作', 'action.result': '操作结果', 'confirmation.required': '等待确认', 'verification.result': '验证结果', 'budget.updated': '预算记录' };
const terminal = (status?: string) => !!status && ['completed', 'failed', 'cancelled'].includes(status);
export function App() {
    const [session, setSession] = useState<Session>({ config: null, grants: [] }), [tabs, setTabs] = useState<Tab[]>([]), [tabId, setTabId] = useState<number>(), [history, setHistory] = useState<History[]>([]), [selected, setSelected] = useState(''), [snapshot, setSnapshot] = useState<RunSnapshot>(), [pending, setPending] = useState<Pending>(null), [events, setEvents] = useState<RuntimeEvent[]>([]);
    const [endpoint, setEndpoint] = useState(''), [model, setModel] = useState(''), [apiKey, setApiKey] = useState(''), [jsonMode, setJsonMode] = useState(true), [goal, setGoal] = useState(''), [schemaText, setSchemaText] = useState('{}'), [maxSteps, setMaxSteps] = useState(30), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const selection = useRef(''), cursor = useRef(0), refreshing = useRef(false), eventError = useRef(false), mounted = useRef(false);
    const currentTab = tabs.find(t => t.id === tabId), origin = currentTab ? new URL(currentTab.url).origin : '', selectedHistory = history.find(h => h.runId === selected);
    const select = (id: string) => { selection.current = id; cursor.current = 0; eventError.current = false; setSelected(id); setSnapshot(undefined); setPending(null); setEvents([]); };
    async function refresh() { if (refreshing.current)
        return; refreshing.current = true; try {
        const [s, t, h] = await Promise.all([rpc<Session>('session.get'), rpc<Tab[]>('tabs.list'), rpc<History[]>('history.list')]);
        if (!mounted.current)
            return;
        setSession(s);
        setTabs(t);
        setHistory(h);
        setTabId(old => t.some(x => x.id === old) ? old : t[0]?.id);
        const id = selection.current;
        if (id) {
            const view = await rpc<{
                snapshot: RunSnapshot;
                pending: Pending;
            }>('run.get', { runId: id });
            if (selection.current !== id || !mounted.current)
                return;
            setSnapshot(view.snapshot);
            setPending(view.pending);
            if (!eventError.current) {
                try {
                    const page = await rpc<{
                        events: RuntimeEvent[];
                        nextSeq: number;
                    }>('run.events', { runId: id, afterSeq: cursor.current });
                    if (selection.current === id && mounted.current) {
                        cursor.current = page.nextSeq;
                        setEvents(old => [...old, ...page.events].slice(-200));
                    }
                }
                catch (e) {
                    if (e instanceof Error && e.message === 'BUDGET_EXCEEDED') {
                        eventError.current = true;
                        setNotice('部分历史记录已裁剪，仍可查看任务状态与结果。');
                    }
                    else
                        throw e;
                }
            }
        }
    }
    catch (e) {
        if (mounted.current)
            setError(e instanceof Error ? e.message : 'DISCONNECTED');
    }
    finally {
        refreshing.current = false;
    } }
    useEffect(() => { mounted.current = true; let port: ReturnType<typeof browser.runtime.connect> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined; const connect = () => { if (!mounted.current)
        return; port = browser.runtime.connect({ name: 'wisp.panel' }); port.onDisconnect.addListener(() => { if (mounted.current)
        reconnect = setTimeout(connect, 1000); }); }; connect(); void refresh(); const timer = setInterval(() => void refresh(), 700); return () => { mounted.current = false; clearInterval(timer); if (reconnect)
        clearTimeout(reconnect); port?.disconnect(); }; }, []);
    async function perform(fn: () => Promise<unknown>) { setBusy(true); setError(''); setNotice(''); try {
        await fn();
        await refresh();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'DISCONNECTED');
    }
    finally {
        setBusy(false);
    } }
    const command = (type: 'run.pause' | 'run.resume' | 'run.cancel' | 'run.takeover') => perform(async () => { await rpc(type, { runId: selected, ...(type === 'run.resume' ? { schemas: JSON.parse(schemaText) } : {}) }); });
    return <main>
  <header className="masthead"><div><span className="eyebrow">浏览器里的任务助手</span><h1>Wisp<span className="dot">.</span></h1></div><span className="badge">早期版本</span></header>
  <p className="intro">你选择网页、设定目标，Wisp 每次推进一步。写入操作先等你确认。</p>
  {error && <div role="alert" className="alert">操作未完成：{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}
  {notice && <p role="status" className="notice">{notice}</p>}
  <details className="card" open={!session.config}><summary>01 <strong>模型服务</strong><span>{session.config ? '已配置' : '尚未配置'}</span></summary>
   <p className="hint">所选服务会收到经过过滤的页面信息；费用取决于服务商，当前费用未知。密钥仅保留在本次浏览器会话。</p>
   <form onSubmit={e => { e.preventDefault(); void perform(async () => { const host = new URL(endpoint).origin; if (!await browser.permissions.request({ origins: [permissionPattern(host)] }))
        throw Error('PERMISSION_DENIED'); await rpc('session.set', { endpoint, model, apiKey, jsonMode }); setApiKey(''); setNotice('会话配置已保存，密钥输入已清空。'); }); }}>
    <label>完整 API 地址<input required type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder={session.config?.endpoint ?? 'https://服务地址/v1/chat/completions'} autoComplete="off"/></label>
    <label>模型名称<input required value={model} onChange={e => setModel(e.target.value)} placeholder={session.config?.model ?? '填写服务商提供的模型名'} maxLength={256}/></label>
    <label>会话密钥 <span className="optional">本地服务可留空</span><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" maxLength={4096}/></label>
    <label className="check"><input type="checkbox" checked={jsonMode} onChange={e => setJsonMode(e.target.checked)}/>使用服务商 JSON 模式</label>
    <div className="actions"><button disabled={busy || history.some(h => ['running', 'waiting_user'].includes(h.status))}>保存会话配置</button><button type="button" className="secondary" disabled={busy || !session.config} onClick={() => void perform(() => rpc('session.clear'))}>清除配置并暂停任务</button></div>
   </form>
   {session.config && <p className="hint">当前：{session.config.model} · {session.config.hasKey ? '已设置密钥' : '无密钥'}</p>}
  </details>
  <section className="card"><h2><span>02</span>选择与授权</h2>
   <label>目标网页<select value={tabId ?? ''} onChange={e => setTabId(Number(e.target.value))}><option value="" disabled>选择一个普通网页</option>{tabs.map(t => <option key={t.id} value={t.id}>{t.title || t.url}</option>)}</select></label>
   {origin && <p className="origin">{origin}</p>}
   <div className="actions"><button disabled={!origin || busy || session.grants.includes(origin)} onClick={() => void perform(async () => { if (!await browser.permissions.request({ origins: [permissionPattern(origin)] }))
        throw Error('PERMISSION_DENIED'); await rpc('origin.grant', { origin }); })}>{session.grants.includes(origin) ? '本站已授权' : '授权此站点'}</button></div>
   {!!session.grants.length && <ul className="grants">{session.grants.map(o => <li key={o}><span>{o}</span><button className="text-button" disabled={busy} onClick={() => void perform(() => rpc('origin.revoke', { origin: o }))}>撤销</button></li>)}</ul>}
  </section>
  <section className="card"><h2><span>03</span>开始任务</h2>
   <form onSubmit={e => { e.preventDefault(); void perform(async () => { const result = await rpc<{
        runId: string;
    }>('run.start', { tabId, goal, schemas: JSON.parse(schemaText), limits: { maxSteps } }); select(result.runId); }); }}>
    <label>你希望完成什么？<textarea required value={goal} onChange={e => setGoal(e.target.value)} rows={3} maxLength={8000} placeholder="例如：找到编号 W-104 的工单，打开详情并验证标题。"/></label>
    <details className="advanced"><summary>提取格式与步骤上限</summary><label>提取 schema（恢复提取任务需填回原格式）<textarea aria-label="提取 schema" value={schemaText} onChange={e => setSchemaText(e.target.value)} rows={4} maxLength={24000} spellCheck={false}/></label><label>最多步骤<input type="number" min={1} max={10000} value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))}/></label></details>
    <button className="primary wide" disabled={busy || !session.config || !origin || !session.grants.includes(origin)}>开始执行 <span>→</span></button>
   </form><p className="hint">密码、验证码、支付及授权操作请手动接管。手动操作页面前先点“接管”，当前无法可靠区分用户与程序输入。</p>
  </section>
  <section className="card"><div className="section-top"><h2>最近任务</h2><button className="text-button" onClick={() => void refresh()}>刷新</button></div>
   {!history.length ? <p className="empty">任务记录会出现在这里。</p> : <ul className="history">{history.map(h => <li key={h.runId}><button className={'history-row ' + (selected === h.runId ? 'selected' : '')} onClick={() => select(h.runId)}><span className={'status ' + h.status}>{names[h.status] ?? h.status}</span><span>{h.goal}</span></button></li>)}</ul>}
  </section>
  {selected && <section className="card task-view" aria-label="任务详情"><div className="section-top"><h2>任务详情</h2><span className={'status ' + snapshot?.status}>{names[snapshot?.status ?? ''] ?? '加载中'}</span></div><p className="task-goal">{snapshot?.goal ?? selectedHistory?.goal}</p>
   <div className="actions controls"><button className="secondary" disabled={!snapshot || terminal(snapshot.status) || busy} onClick={() => void command('run.pause')}>暂停</button><button disabled={snapshot?.status !== 'paused' || busy || !!selectedHistory?.unknownActionId} onClick={() => void command('run.resume')}>恢复</button><button className="secondary" disabled={!snapshot || terminal(snapshot.status)} onClick={() => void command('run.takeover')}>接管</button><button className="danger" disabled={!snapshot || terminal(snapshot.status)} onClick={() => void command('run.cancel')}>停止</button></div>
   {selectedHistory?.unknownActionId && <div className="confirmation"><h3>上次操作结果未明</h3><p>请先人工检查网页。解除屏障不会重发原操作。</p><button disabled={busy} onClick={() => void perform(() => rpc('run.acknowledge', { runId: selected, actionId: selectedHistory.unknownActionId }))}>我已核对，交由手动处理</button></div>}
   {pending?.kind === 'ask_user' && <div className="confirmation"><h3>需要你的帮助</h3><p>{pending.question}</p><p className="hint">先接管并处理网页，再恢复任务。</p></div>}
   {pending?.kind === 'confirm' && pending.confirmation && <div className="confirmation"><span className="eyebrow">仅此一次</span><h3>批准这次操作？</h3><p className="origin">{pending.confirmation.origin}</p><p>{pending.confirmation.summary}</p><dl>{Object.entries(pending.confirmation.displayParameters).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="hint">有效至 {new Date(pending.confirmation.expiresAt).toLocaleTimeString()}；网页变化后需重新确认。</p><div className="actions"><button disabled={busy || Date.parse(pending.confirmation.expiresAt) <= Date.now()} onClick={() => void perform(() => rpc('run.confirm', { runId: selected, confirmationId: pending.confirmation!.confirmationId, decision: 'approve' }))}>批准本次操作</button><button className="secondary" disabled={busy} onClick={() => void perform(() => rpc('run.confirm', { runId: selected, confirmationId: pending.confirmation!.confirmationId, decision: 'reject' }))}>拒绝</button></div></div>}
   {snapshot && terminal(snapshot.status) && <div className="result"><h3>结果与证据</h3><pre>{JSON.stringify(snapshot.result, null, 2)}</pre><button className="text-button" disabled={busy || !!selectedHistory?.unknownActionId} onClick={() => void perform(async () => { await rpc('run.delete', { runId: selected }); select(''); })}>删除这条任务历史</button></div>}
   <details className="advanced" open><summary>执行记录 <span>{events.length}</span></summary><ol className="events">{events.map(e => <li key={e.eventId}><span>{e.seq.toString().padStart(2, '0')}</span><div><strong>{eventNames[e.type] ?? e.type}</strong><small>{'redacted' in e.payload ? e.payload.summary : e.type === 'model.completed' ? ('usage' in e.payload ? JSON.stringify(e.payload.usage) : '用量未知') : e.type === 'budget.updated' ? '预算已更新' : ''}</small></div></li>)}</ol></details>
  </section>}
  <footer>关闭侧边栏会暂停任务。重新打开后，请核对网页再恢复。</footer>
 </main>;
}
