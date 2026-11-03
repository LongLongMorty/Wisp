import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

export const FIXTURE_VERSION = 'ticket-system-0.1';

export const CATEGORIES = {
  '技术问题': ['无法登录', '功能报错', '性能问题', '数据丢失'],
  '业务咨询': ['功能咨询', '价格咨询', '流程咨询', '政策咨询'],
  '功能建议': ['新功能', '界面改进', '流程优化', '其他建议']
};

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const USERS = [
  {id: 'user1', name: '张三'},
  {id: 'user2', name: '李四'},
  {id: 'user3', name: '王五'}
];

export class FixtureError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SCHEMA = `
CREATE TABLE tickets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
  category1 TEXT NOT NULL, category2 TEXT NOT NULL, priority TEXT NOT NULL,
  assignee TEXT, status TEXT NOT NULL, due_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL,
  action TEXT NOT NULL, operator TEXT NOT NULL, details TEXT, timestamp TEXT NOT NULL
);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
`;

function openDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO users (id, name) VALUES (?, ?)');
  for (const user of USERS) insert.run(user.id, user.name);
  return db;
}

export function createRepository() {
  const sessions = new Map();
  function get(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new FixtureError(404, 'Session not found');
    return session;
  }
  return {
    createSession() {
      const sessionId = randomUUID();
      sessions.set(sessionId, {db: openDatabase(), generation: 1, ticketCounter: 0});
      return {sessionId, generation: 1};
    },
    getState(sessionId) {
      const {db} = get(sessionId);
      return {
        tickets: db.prepare('SELECT * FROM tickets ORDER BY id').all(),
        auditLogs: db.prepare('SELECT * FROM audit_logs ORDER BY id').all()
      };
    },
    reset(sessionId) {
      const session = get(sessionId);
      session.db.close();
      session.db = openDatabase();
      session.generation += 1;
      session.ticketCounter = 0;
      return {generation: session.generation};
    },
    close(sessionId) {
      get(sessionId).db.close();
      sessions.delete(sessionId);
    },
    createTicket(sessionId, data, currentUser) {
      const session = get(sessionId);
      const text = (value, max) => {
        if (typeof value !== 'string' || !value.trim() || value.length > max) throw new FixtureError(400, 'Invalid ticket field');
        return value.trim();
      };
      const title = text(data.title, 200), description = text(data.description, 2000);
      if (!Object.hasOwn(CATEGORIES, data.category1) || !CATEGORIES[data.category1].includes(data.category2)) throw new FixtureError(400, 'Invalid category');
      if (!PRIORITIES.includes(data.priority)) throw new FixtureError(400, 'Invalid priority');
      const assignee = data.assignee || null;
      if (assignee !== null && !USERS.some(user => user.id === assignee)) throw new FixtureError(400, 'Invalid assignee');
      const dueDate = data.priority === 'urgent' && data.due_date ? text(data.due_date, 10) : null;
      const id = 'T-' + String(++session.ticketCounter).padStart(4, '0');
      const now = new Date().toISOString();
      session.db.prepare('INSERT INTO tickets (id, title, description, category1, category2, priority, assignee, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, title, description, data.category1, data.category2, data.priority, assignee, 'pending', dueDate, now, now);
      session.db.prepare('INSERT INTO audit_logs (ticket_id, action, operator, details, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(id, 'created', currentUser, null, now);
      return session.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    },
    getAuditLogs(sessionId, ticketId) {
      const {db} = get(sessionId);
      return db.prepare('SELECT * FROM audit_logs WHERE ticket_id = ? ORDER BY timestamp').all(ticketId);
    },
    changeStatus(sessionId, ticketId, newStatus, currentUser) {
      const session = get(sessionId);
      const ticket = session.db.prepare('SELECT status, assignee FROM tickets WHERE id = ?').get(ticketId);
      if (!ticket) throw new FixtureError(404, 'Ticket not found');
      const validTransitions = {
        pending: ['processing'],
        processing: ['resolved'],
        resolved: ['closed']
      };
      if (!validTransitions[ticket.status]?.includes(newStatus)) {
        throw new FixtureError(400, `Invalid state transition from ${ticket.status} to ${newStatus}`);
      }
      if ((ticket.status === 'processing' || ticket.status === 'resolved') && currentUser !== ticket.assignee) {
        throw new FixtureError(403, 'Only assignee can perform this action');
      }
      const now = new Date().toISOString();
      session.db.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, ticketId);
      if (newStatus === 'processing') {
        session.db.prepare('UPDATE tickets SET assignee = ? WHERE id = ?').run(currentUser, ticketId);
      }
      session.db.prepare('INSERT INTO audit_logs (ticket_id, action, operator, details, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(ticketId, 'status_changed', currentUser, JSON.stringify({from: ticket.status, to: newStatus}), now);
      return session.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    },
    getTickets(sessionId, filter = {}) {
      const {db} = get(sessionId);
      const {status = 'all', priority = 'all'} = filter;
      return db.prepare('SELECT * FROM tickets WHERE (? = \'all\' OR status = ?) AND (? = \'all\' OR priority = ?) ORDER BY id')
        .all(status, status, priority, priority);
    },
    getTicketById(sessionId, ticketId) {
      const {db} = get(sessionId);
      return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) || null;
    }
  };
}
