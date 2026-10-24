import { randomUUID } from 'node:crypto';
export const FIXTURE_VERSION = 'fixture-0.1';
const rows = [
    ['W-101', '搜索索引重建', 'pending', 'high'], ['W-102', '登录超时', 'pending', 'high'],
    ['W-103', 'CSV导出失败', 'pending', 'high'], ['W-104', '报表访问异常', 'pending', 'high'],
    ['W-105', '邮件队列阻塞', 'pending', 'high'], ['W-106', '个人资料更新', 'pending', 'low'],
    ['W-107', '登录超时', 'closed', 'high'], ['W-108', '通知样式调整', 'closed', 'low'],
    ['W-109', '账单核对', 'processing', 'medium'], ['W-110', '审计记录检查', 'pending', 'medium'],
    ['W-111', '搜索结果排序', 'closed', 'medium'], ['W-112', '流水线文案调整', 'pending', 'low'],
];
export const RECORDS = Object.freeze(rows.map(([id, title, status, priority]) => Object.freeze({ id, title, status, priority })));
export class FixtureError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
export function fields(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ![...required, ...optional].includes(key)) || required.some(key => !Object.hasOwn(value, key)))
        throw new FixtureError(400, 'Invalid fields');
    return value;
}
export function input(value, max = 200) { if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new FixtureError(400, 'Invalid input'); return value.trim(); }
export function filterRecords({ query = '', status = 'all', priority = 'all' } = {}) {
    if (typeof query !== 'string' || query.length > 128 || !['all', 'pending', 'processing', 'closed'].includes(status) || !['all', 'high', 'medium', 'low'].includes(priority))
        throw new FixtureError(400, 'Invalid filter');
    return RECORDS.filter(row => (!query || row.title.includes(query) || row.id.includes(query)) && (status === 'all' || row.status === status) && (priority === 'all' || row.priority === priority)).map(row => ({ ...row }));
}
const initial = () => ({ submissions: [], saves: [], clicks: {}, pendingSaves: 0 });
export function createRepository() {
    const sessions = new Map();
    function get(id) { const session = sessions.get(id); if (!session)
        throw new FixtureError(404, 'Session not found'); return session; }
    return {
        create() { const session = { id: randomUUID(), generation: 1, config: { saveMode: 'success', delayMs: 400 }, state: initial() }; sessions.set(session.id, session); return { id: session.id, generation: session.generation }; },
        exists(id) { return sessions.has(id); },
        reset(id) { const s = get(id); s.generation++; s.config = { saveMode: 'success', delayMs: 400 }; s.state = initial(); return { id: s.id, generation: s.generation }; },
        remove(id) { get(id); sessions.delete(id); },
        configure(id, value) { fields(value, [], ['saveMode', 'delayMs']); const s = get(id); if (Object.hasOwn(value, 'saveMode') && !['success', 'failure'].includes(value.saveMode))
            throw new FixtureError(400, 'Invalid save mode'); if (Object.hasOwn(value, 'delayMs') && (!Number.isInteger(value.delayMs) || value.delayMs < 0 || value.delayMs > 5000))
            throw new FixtureError(400, 'Invalid delay'); s.config = { ...s.config, ...value }; return { ...s.config }; },
        snapshot(id) { const s = get(id); return structuredClone({ id: s.id, generation: s.generation, config: s.config, ...s.state, expected: { pendingHighIds: ['W-101', 'W-102', 'W-103', 'W-104', 'W-105'], pendingLoginId: 'W-102', pendingHighRecords: RECORDS.filter(row => ['W-101', 'W-102', 'W-103', 'W-104', 'W-105'].includes(row.id)).map(row => ({ ...row })) } }); },
        submit(id, value) { fields(value, ['title', 'description', 'priority']); const s = get(id); const title = input(value.title); const description = input(value.description, 2000); if (!['high', 'medium', 'low'].includes(value.priority))
            throw new FixtureError(400, 'Invalid priority'); const record = { sequence: s.state.submissions.length + 1, title, description, priority: value.priority }; s.state.submissions.push(record); return { ...record }; },
        click(id, value) { fields(value, ['name']); const s = get(id); const name = input(value.name, 64); const valid = ['primary', 'disabled', 'covered', 'shadow', 'rerender'].includes(name) || (/^performance-\d{3}$/.test(name) && Number(name.slice(12)) >= 1 && Number(name.slice(12)) <= 200); if (!valid)
            throw new FixtureError(400, 'Unknown click'); s.state.clicks[name] = (s.state.clicks[name] || 0) + 1; return { name, count: s.state.clicks[name] }; },
        async save(id, value) {
            fields(value, ['title']);
            const title = input(value.title);
            const s = get(id), generation = s.generation, state = s.state, config = { ...s.config };
            state.pendingSaves++;
            try {
                await new Promise(resolve => setTimeout(resolve, config.delayMs));
                if (!sessions.has(id) || s.generation !== generation)
                    throw new FixtureError(409, 'Session reset during save');
                if (config.saveMode === 'failure')
                    throw new FixtureError(422, 'Simulated save failure');
                const record = { sequence: state.saves.length + 1, title };
                state.saves.push(record);
                return { ...record };
            }
            finally {
                state.pendingSaves--;
            }
        },
    };
}
