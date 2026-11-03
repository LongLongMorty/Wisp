import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {assertTicketFields, assertStateTransition, assertAuditLogComplete} from '../oracle.mjs';

describe('Oracle assertions', () => {
  it('assertTicketFields throws on mismatch', () => {
    assert.throws(() => assertTicketFields({title: 'A', priority: 'low'}, {priority: 'high'}));
  });

  it('assertTicketFields passes when all expected fields match', () => {
    assertTicketFields({title: 'A', priority: 'low', status: 'pending'}, {priority: 'low', status: 'pending'});
  });

  it('assertStateTransition accepts ordered sequence', () => {
    const logs = [
      {action: 'created', details: '{}'},
      {action: 'status_changed', details: '{"from":"pending","to":"processing"}'},
      {action: 'assigned', details: '{}'}
    ];
    assertStateTransition(logs, ['processing']);
  });

  it('assertAuditLogComplete rejects missing operator', () => {
    assert.throws(() => assertAuditLogComplete({operator: '', timestamp: new Date().toISOString()}));
  });

  it('assertAuditLogComplete rejects invalid timestamp', () => {
    assert.throws(() => assertAuditLogComplete({operator: 'user1', timestamp: 'not-a-date'}));
  });

  it('assertAuditLogComplete passes on valid log', () => {
    assertAuditLogComplete({operator: 'user1', timestamp: new Date().toISOString(), action: 'created'});
  });
});
