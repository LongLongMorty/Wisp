import assert from 'node:assert/strict';

export function createController(server) {
  return {
    async create() {
      const res = await fetch(`${server.controlOrigin}/control/sessions`, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${server.controlToken}`, 'Content-Type': 'application/json'},
        body: '{}'
      });
      const data = await res.json();
      return {sessionId: data.sessionId, baseUrl: `${server.origin}/ticket-system/s/${data.sessionId}/list`};
    },
    async state(sessionId) {
      const res = await fetch(`${server.controlOrigin}/control/sessions/${sessionId}/state`, {
        headers: {'Authorization': `Bearer ${server.controlToken}`}
      });
      return res.json();
    },
    async reset(sessionId) {
      const res = await fetch(`${server.controlOrigin}/control/sessions/${sessionId}/reset`, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${server.controlToken}`}
      });
      return res.json();
    },
    async close(sessionId) {
      await fetch(`${server.controlOrigin}/control/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {'Authorization': `Bearer ${server.controlToken}`}
      });
    }
  };
}

export function assertTicketFields(ticket, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(ticket[key], value, `ticket.${key} mismatch: expected ${value}, got ${ticket[key]}`);
  }
}

export function assertStateTransition(logs, expectedSequence) {
  const actual = logs
    .filter(l => l.action === 'status_changed')
    .map(l => JSON.parse(l.details).to);
  assert.deepStrictEqual(actual, expectedSequence, `state transition mismatch: expected ${JSON.stringify(expectedSequence)}, got ${JSON.stringify(actual)}`);
}

export function assertAuditLogComplete(log) {
  assert.ok(log.operator && log.operator.trim(), 'audit log missing operator');
  assert.ok(log.timestamp, 'audit log missing timestamp');
  assert.ok(!isNaN(Date.parse(log.timestamp)), 'audit log timestamp not ISO format');
}
