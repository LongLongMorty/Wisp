import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FIXTURE_VERSION, FixtureError, createRepository, fields, filterRecords } from './domain.mjs';
import { PAGES, renderPage } from './pages.mjs';
const assetFiles = new Map([['/assets/app.mjs', new URL('./public/app.mjs', import.meta.url)], ['/assets/style.css', new URL('./public/style.css', import.meta.url)]]);
function send(res, status, data, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384)
            throw new FixtureError(413, 'Request too large');
        chunks.push(chunk);
    }
    let data;
    try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new FixtureError(400, 'Invalid JSON');
    }
    return data;
}
async function listen(server, port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }); return 'http://127.0.0.1:' + server.address().port; }
function closeServer(server) { return new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }); }
export async function createFixtureServer({ port = 0, controlPort = 0, framePort = 0 } = {}) {
    const repository = createRepository(), controlToken = randomBytes(32).toString('hex');
    let origin, controlOrigin, frameOrigin;
    const servers = [];
    const wrap = handler => async (req, res) => {
        try {
            await handler(req, res);
        }
        catch (error) {
            if (!res.headersSent)
                send(res, error instanceof FixtureError ? error.status : 500, { error: error instanceof FixtureError ? error.message : 'Fixture internal error' });
            else
                res.destroy();
        }
    };
    const app = createServer(wrap(async (req, res) => {
        if (req.headers.host !== new URL(origin).host)
            throw new FixtureError(403, 'Invalid host');
        const url = new URL(req.url, origin);
        if (req.method === 'GET' && url.pathname === '/health')
            return send(res, 200, { version: FIXTURE_VERSION });
        if (req.method === 'GET' && assetFiles.has(url.pathname)) {
            const file = assetFiles.get(url.pathname);
            return send(res, 200, await readFile(file), url.pathname.endsWith('.mjs') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        }
        const api = url.pathname.match(/^\/api\/([a-f0-9-]+)\/(records|record\/[^/]+|submit|save|click)$/);
        if (api) {
            const [, id, operation] = api;
            repository.snapshot(id);
            if (req.method === 'GET' && operation === 'records')
                return send(res, 200, { records: filterRecords({ query: url.searchParams.get('query') || '', status: url.searchParams.get('status') || 'all', priority: url.searchParams.get('priority') || 'all' }) });
            if (req.method === 'GET' && operation.startsWith('record/')) {
                const record = filterRecords().find(row => row.id === operation.slice(7));
                if (!record)
                    throw new FixtureError(404, 'Record not found');
                return send(res, 200, { record });
            }
            if (req.method === 'POST' && ['submit', 'save', 'click'].includes(operation)) {
                if (req.headers.origin && req.headers.origin !== origin)
                    throw new FixtureError(403, 'Cross-origin mutation denied');
                const input = await body(req);
                const result = await repository[operation](id, input);
                return send(res, 200, { result });
            }
            throw new FixtureError(405, 'Method not allowed');
        }
        const pageMatch = url.pathname.match(/^\/s\/([a-f0-9-]+)(?:\/(search|table|form|controls|rerender|delayed-save|safety|performance|records\/[^/]+))?\/?$/);
        if (req.method === 'GET' && pageMatch) {
            const [, sessionId, route = 'home'] = pageMatch;
            repository.snapshot(sessionId);
            let page = route, recordId = '';
            if (route.startsWith('records/')) {
                page = 'detail';
                recordId = route.slice(8);
                if (!filterRecords().some(row => row.id === recordId))
                    throw new FixtureError(404, 'Record not found');
            }
            res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src " + frameOrigin + "; form-action 'self'; base-uri 'none'");
            return send(res, 200, renderPage({ sessionId, page, recordId, frameOrigin }), 'text/html; charset=utf-8');
        }
        throw new FixtureError(404, 'Not found');
    }));
    servers.push(app);
    const frame = createServer(wrap(async (req, res) => {
        if (req.headers.host !== new URL(frameOrigin).host)
            throw new FixtureError(403, 'Invalid host');
        if (req.method !== 'GET' || !['/frame', '/unapproved'].includes(new URL(req.url, frameOrigin).pathname))
            throw new FixtureError(404, 'Not found');
        send(res, 200, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>独立origin</title><h1>跨origin测试表单</h1><label>外部输入 <input></label><button>外部按钮</button></html>', 'text/html; charset=utf-8');
    }));
    servers.push(frame);
    const control = createServer(wrap(async (req, res) => {
        if (req.headers.host !== new URL(controlOrigin).host)
            throw new FixtureError(403, 'Invalid host');
        const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + controlToken);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            throw new FixtureError(401, 'Control authentication required');
        if (req.headers.origin && req.headers.origin !== controlOrigin)
            throw new FixtureError(403, 'Cross-origin control denied');
        const url = new URL(req.url, controlOrigin);
        if (req.method === 'POST' && url.pathname === '/sessions') {
            fields(await body(req), []);
            const session = repository.create();
            return send(res, 201, { sessionId: session.id, generation: session.generation, baseUrl: origin + '/s/' + session.id, origin, frameOrigin });
        }
        const match = url.pathname.match(/^\/sessions\/([a-f0-9-]+)(?:\/(state|reset|config))?$/);
        if (!match)
            throw new FixtureError(404, 'Not found');
        const [, id, operation] = match;
        if (req.method === 'GET' && operation === 'state')
            return send(res, 200, repository.snapshot(id));
        if (req.method === 'POST' && operation === 'reset') {
            fields(await body(req), []);
            return send(res, 200, repository.reset(id));
        }
        if (req.method === 'POST' && operation === 'config')
            return send(res, 200, repository.configure(id, await body(req)));
        if (req.method === 'DELETE' && !operation) {
            repository.remove(id);
            return send(res, 200, { deleted: true });
        }
        throw new FixtureError(405, 'Method not allowed');
    }));
    servers.push(control);
    try {
        origin = await listen(app, port);
        frameOrigin = await listen(frame, framePort);
        controlOrigin = await listen(control, controlPort);
    }
    catch (error) {
        await Promise.allSettled(servers.filter(s => s.listening).map(closeServer));
        throw error;
    }
    return { version: FIXTURE_VERSION, origin, frameOrigin, controlOrigin, controlToken, close: () => Promise.all(servers.map(closeServer)).then(() => { }) };
}
