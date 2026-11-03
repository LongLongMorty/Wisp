import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FIXTURE_VERSION, FixtureError, createRepository, CATEGORIES, USERS} from './domain.mjs';
import {renderPage} from './pages.mjs';

const ASSETS = {
  '/assets/vendor/react.production.min.js': 'fixtures/ticket-system/public/vendor/react.production.min.js',
  '/assets/vendor/react-dom.production.min.js': 'fixtures/ticket-system/public/vendor/react-dom.production.min.js',
  '/assets/app.js': 'fixtures/ticket-system/public/app.js',
  '/assets/style.css': 'fixtures/ticket-system/public/style.css'
};

const MIME = {'.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'};

export function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

export async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new FixtureError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FixtureError(400, 'Invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FixtureError(400, 'JSON body must be an object');
  return value;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve('http://127.0.0.1:' + server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const known = error instanceof FixtureError;
      send(res, known ? error.status : 500, {error: known ? error.message : 'Fixture internal error'});
    }
  };
}

export async function createFixtureServer() {
  const repository = createRepository();
  const controlToken = randomBytes(32).toString('hex');
  let origin, controlOrigin;
  const routes = {business: [], control: []};

  const app = createServer(wrap(async (req, res) => {
    if (req.headers.host !== new URL(origin).host) throw new FixtureError(403, 'Invalid host');
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, {version: FIXTURE_VERSION});
    if (req.method === 'GET' && ASSETS[url.pathname]) {
      const content = await readFile(ASSETS[url.pathname]);
      const ext = url.pathname.slice(url.pathname.lastIndexOf('.'));
      return send(res, 200, content, MIME[ext] || 'application/octet-stream');
    }
    const pageMatch = url.pathname.match(/^\/ticket-system\/s\/([^/]+)\/(home|create|list|detail)(?:\/(.+))?$/);
    if (req.method === 'GET' && pageMatch) {
      const [, sid, route, param] = pageMatch;
      return send(res, 200, renderPage(sid, route, origin, param), 'text/html; charset=utf-8');
    }
    for (const route of routes.business) if (await route(req, res, url)) return;
    throw new FixtureError(404, 'Not found');
  }));

  const control = createServer(wrap(async (req, res) => {
    if (req.headers.host !== new URL(controlOrigin).host) throw new FixtureError(403, 'Invalid host');
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(controlToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new FixtureError(403, 'Forbidden');
    const url = new URL(req.url, controlOrigin);
    for (const route of routes.control) if (await route(req, res, url)) return;
    throw new FixtureError(404, 'Not found');
  }));

  origin = await listen(app);
  controlOrigin = await listen(control);
  const {sessionId} = repository.createSession();

  const CURRENT_USER = 'user1';

  routes.business.push(async (req, res, url) => {
    const apiMatch = url.pathname.match(/^\/api\/([^/]+)\/tickets(?:\/([^/]+))?(?:\/(status|audit-logs))?$/);
    if (apiMatch) {
      const [, sid, ticketId, action] = apiMatch;
      if (req.method === 'POST' && !ticketId) {
        const body = await readJson(req);
        if ('operator' in body) throw new FixtureError(400, 'operator field not allowed');
        const ticket = repository.createTicket(sid, body, CURRENT_USER);
        return send(res, 200, {ticket}), true;
      }
      if (req.method === 'GET' && !ticketId) {
        const tickets = repository.getTickets(sid, {status: url.searchParams.get('status') || 'all', priority: url.searchParams.get('priority') || 'all'});
        return send(res, 200, {tickets}), true;
      }
      if (req.method === 'GET' && ticketId && !action) {
        const ticket = repository.getTicketById(sid, ticketId);
        if (!ticket) throw new FixtureError(404, 'Ticket not found');
        return send(res, 200, {ticket}), true;
      }
      if (req.method === 'PATCH' && ticketId && action === 'status') {
        const body = await readJson(req);
        if ('operator' in body) throw new FixtureError(400, 'operator field not allowed');
        const ticket = repository.changeStatus(sid, ticketId, body.status, CURRENT_USER);
        return send(res, 200, {ticket}), true;
      }
      if (req.method === 'GET' && ticketId && action === 'audit-logs') {
        const logs = repository.getAuditLogs(sid, ticketId);
        return send(res, 200, {logs}), true;
      }
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/[^/]+\/categories$/)) {
      return send(res, 200, {categories: CATEGORIES}), true;
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/[^/]+\/users$/)) {
      return send(res, 200, {users: USERS}), true;
    }
    return false;
  });

  routes.control.push(async (req, res, url) => {
    const match = url.pathname.match(/^\/control\/sessions(?:\/([^/]+))?(?:\/(state|reset))?$/);
    if (!match) return false;
    const [, id, action] = match;
    if (req.method === 'POST' && !id) {
      const session = repository.createSession();
      return send(res, 200, session), true;
    }
    if (req.method === 'GET' && id && action === 'state') {
      return send(res, 200, repository.getState(id)), true;
    }
    if (req.method === 'POST' && id && action === 'reset') {
      return send(res, 200, repository.reset(id)), true;
    }
    if (req.method === 'DELETE' && id && !action) {
      return repository.close(id), send(res, 204, ''), true;
    }
    return false;
  });

  return {
    origin, controlOrigin, controlToken, repository, routes,
    initialSession: {sessionId, baseUrl: `${origin}/ticket-system/s/${sessionId}/list`},
    async close() {
      await Promise.all([closeServer(app), closeServer(control)]);
    }
  };
}
