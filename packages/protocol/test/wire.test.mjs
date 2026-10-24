import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/index.mts';
import { timestamp, target, evidence, element, observation, result, verification, budget, confirmation, extraction, snapshot, request, event, response, clone } from './fixtures.mjs';
const invalid = fn => assert.throws(fn, error => error instanceof p.ProtocolError && error.code === 'MODEL_INVALID_OUTPUT');
test('observations decode as detached data with complete document identity', () => {
    const parsed = p.decodeObservation(JSON.stringify(observation));
    assert.deepEqual(parsed, observation);
    parsed.elements[0].name = 'changed';
    assert.equal(element.name, 'Save');
});
test('observation rejects stale-reference ambiguity, secret value fields and unknown metadata', () => {
    invalid(() => p.parseObservation({ ...observation, elements: [element, { ...element }] }));
    invalid(() => p.parseObservation({ ...observation, elements: [{ ...element, value: 'secret' }] }));
    invalid(() => p.parseObservation({ ...observation, apiKey: 'secret' }));
});
test('truncation requires explicit valid unique reasons', () => {
    assert.equal(p.parseObservation({ ...observation, truncated: true, truncationReasons: ['text_limit'] }).truncated, true);
    for (const patch of [{ truncated: true }, { truncationReasons: ['text_limit'] }, { truncated: true, truncationReasons: ['other'] }, { truncated: true, truncationReasons: ['text_limit', 'text_limit'] }])
        invalid(() => p.parseObservation({ ...observation, ...patch }));
});
test('observation enforces both candidate count and complete serialized budget', () => {
    invalid(() => p.parseObservation({ ...observation, elements: Array.from({ length: 201 }, (_, i) => ({ ...element, ref: String(i) })) }));
    invalid(() => p.parseObservation({ ...observation, text: 'x'.repeat(24000) }));
    invalid(() => p.decodeObservation('中'.repeat(22000)));
});
test('geometry and UTC timestamps reject impossible or nonfinite values', () => {
    assert.equal(p.parseElement({ ...element, bounds: { ...element.bounds, x: -10 } }).bounds.x, -10);
    for (const bounds of [{ ...element.bounds, width: -1 }, { ...element.bounds, y: Infinity }, { ...element.bounds, width: NaN }])
        invalid(() => p.parseElement({ ...element, bounds }));
    for (const capturedAt of ['2026-02-30T03:00:00Z', '2026-10-18T11:00:00+08:00', '2026-10-18', 'not-time'])
        invalid(() => p.parseEvidence({ ...evidence, capturedAt }));
    assert.equal(p.parseEvidence({ ...evidence, capturedAt: '2026-10-18T03:00:00Z' }).capturedAt, '2026-10-18T03:00:00Z');
});
test('capabilities do not silently promise unsupported drivers or duplicate actions', () => {
    assert.deepEqual(p.parseCapabilities({ version: '0.1', actions: ['click'], frames: 'main', shadowDOM: 'open' }).actions, ['click']);
    for (const patch of [{ version: '1' }, { actions: ['evaluate'] }, { actions: ['click', 'click'] }, { frames: 'all' }, { shadowDOM: 'closed' }])
        invalid(() => p.parseCapabilities({ version: '0.1', actions: ['click'], frames: 'main', shadowDOM: 'open', ...patch }));
});
test('action result requires proof for success and preserves uncertain delivery', () => {
    assert.deepEqual(p.parseActionResult(result), result);
    invalid(() => p.parseActionResult({ ...result, evidence: [] }));
    invalid(() => p.parseActionResult({ ...result, dispatched: 'no' }));
    const uncertain = { ...result, dispatched: 'unknown', responded: 'unknown', verified: 'unknown', evidence: [], error: { code: 'OUTCOME_UNKNOWN', message: 'Outcome unknown', retryable: false } };
    assert.equal(p.parseActionResult(uncertain).dispatched, 'unknown');
    invalid(() => p.parseActionResult({ ...uncertain, error: { ...uncertain.error, code: 'RERUN_NOW' } }));
});
test('verification uses AND aggregation and refuses vacuous or unsupported success', () => {
    assert.deepEqual(p.parseVerification(verification), verification);
    invalid(() => p.parseVerification({ status: 'passed', conditions: [] }));
    invalid(() => p.parseVerification({ ...verification, conditions: [{ ...verification.conditions[0], evidence: [] }] }));
    const mixed = [verification.conditions[0], { ...verification.conditions[0], status: 'unknown', evidence: [] }];
    invalid(() => p.parseVerification({ status: 'passed', conditions: mixed }));
    assert.equal(p.parseVerification({ status: 'unknown', conditions: mixed }).status, 'unknown');
    const failed = [...mixed, { ...verification.conditions[0], status: 'failed', evidence: [] }];
    assert.equal(p.parseVerification({ status: 'failed', conditions: failed }).status, 'failed');
});
test('model decisions allow one step, never authority, injected IDs or unproved finish', () => {
    const decision = { kind: 'action', request: { action: { kind: 'click', target }, timeoutMs: 10000 } };
    assert.deepEqual(p.parseDecision(decision), decision);
    invalid(() => p.parseDecision({ ...decision, approved: true }));
    invalid(() => p.parseDecision({ ...decision, request: { ...decision.request, actionId: 'forged' } }));
    invalid(() => p.parseDecision({ kind: 'finish', summary: 'Done', expected: [] }));
    invalid(() => p.parseDecision({ kind: 'extract', schemaId: 'rows', request: decision.request }));
    assert.equal(p.parseDecision({ kind: 'finish', summary: 'Done', expected: [{ kind: 'text', includes: 'Saved' }] }).kind, 'finish');
    assert.equal(p.parseDecision({ kind: 'ask_user', question: 'Which item?' }).kind, 'ask_user');
});
test('model response is bounded and token/cost accounting rejects inconsistent numbers', () => {
    const decision = { kind: 'extract', schemaId: 'rows' };
    assert.deepEqual(p.decodeModelResponse(JSON.stringify({ decision })), { decision });
    for (const usage of [{ inputTokens: -1 }, { costUsd: Infinity }, { inputTokens: 5, outputTokens: 7, totalTokens: 10 }, {}])
        invalid(() => p.parseModelResponse({ decision, usage }));
    assert.equal(p.parseUsage({ inputTokens: 5, outputTokens: 7, totalTokens: 12, costUsd: 0 }).totalTokens, 12);
    invalid(() => p.decodeModelResponse(JSON.stringify({ decision, providerRequestId: '中'.repeat(22000) })));
});
test('budget can report overflow but cannot redefine arbitrary limits', () => {
    assert.equal(p.parseBudget({ ...budget, steps: { used: 31, limit: 30 } }).steps.used, 31);
    invalid(() => p.parseBudget({ ...budget, steps: { used: 0, limit: 0 } }));
    invalid(() => p.parseRunLimits({ maxObservationChars: 24001 }));
    invalid(() => p.parseRunLimits({ unlimited: true }));
    assert.deepEqual(p.parseRunLimits({ maxSteps: 30 }), { maxSteps: 30 });
});
test('extraction is JSON-only, bounded, detached and source-bearing', () => {
    const parsed = p.parseExtraction(extraction);
    parsed.data[0].id = 2;
    assert.equal(extraction.data[0].id, 1);
    invalid(() => p.parseExtraction({ ...extraction, source: [] }));
    invalid(() => p.parseExtraction({ ...extraction, data: () => 1 }));
    invalid(() => p.parseExtraction({ ...extraction, data: { secret: undefined } }));
    let nested = {};
    for (let i = 0; i < 9; i++)
        nested = { nested };
    invalid(() => p.parseExtraction({ ...extraction, data: nested }));
    invalid(() => p.parseExtraction({ ...extraction, data: Array.from({ length: 1024 }, () => [1]) }));
    invalid(() => p.parseExtraction({ ...extraction, data: JSON.parse('{"__proto__": {"polluted": true}}') }));
    assert.equal(p.decodeExtractionResponse(JSON.stringify({ ...extraction, usage: { inputTokens: 1 } })).schemaId, 'rows');
});
test('completed runs and terminal snapshots require consistent evidence-bearing results', () => {
    invalid(() => p.parseRunResult({ status: 'completed', summary: 'Done' }));
    invalid(() => p.parseRunResult({ status: 'completed', summary: 'Done', evidence: [] }));
    const done = { status: 'completed', summary: 'Done', extraction };
    assert.equal(p.parseRunResult(done).status, 'completed');
    invalid(() => p.parseRunSnapshot({ ...snapshot, status: 'completed' }));
    invalid(() => p.parseRunSnapshot({ ...snapshot, result: done }));
    invalid(() => p.parseRunSnapshot({ ...snapshot, status: 'failed', result: done }));
    assert.equal(p.parseRunSnapshot({ ...snapshot, status: 'completed', result: done }).result.status, 'completed');
});
test('confirmation origin and digest are constrained and display parameters are data-only', () => {
    assert.deepEqual(p.parseConfirmation(confirmation), confirmation);
    for (const patch of [{ origin: 'https://example.test/' }, { origin: 'https://example.test/path' }, { origin: 'https://user:secret@example.test' }, { contextDigest: 'not-hash' }, { displayParameters: { handler: () => 1 } }])
        invalid(() => p.parseConfirmation({ ...confirmation, ...patch }));
});
test('all declared request variants decode with their exact payload schemas', () => {
    const ui = [request('run.start', { tabId: 1, goal: 'Search', schemaIds: ['rows'], limits: { maxSteps: 30 } }, {}), ...['run.get', 'run.pause', 'run.resume', 'run.cancel'].map(type => request(type)), request('run.confirm', { confirmationId: 'confirm-1', decision: 'approve' }), request('events.subscribe', { afterSeq: 0 })];
    const page = [request('page.observation', { observation }), request('page.input', { documentId: 'doc-1', frameId: 'main', kind: 'keyboard', timestamp })];
    for (const value of ui)
        assert.deepEqual(p.decodeRequest(JSON.stringify(value), 'ui'), value);
    for (const value of page)
        assert.deepEqual(p.decodeRequest(JSON.stringify(value), 'page'), value);
});
test('message roles cannot submit confirmations or forge page observations', () => {
    for (const type of ['run.cancel', 'run.confirm', 'run.start'])
        invalid(() => p.parseRequest(request(type), 'page'));
    invalid(() => p.parseRequest(request('page.observation', { observation }), 'ui'));
    invalid(() => p.parseRequest({ ...request('run.confirm', { confirmationId: 'confirm-1', decision: 'approve' }), source: 'ui' }, 'page'));
    invalid(() => p.parseRequest(request('run.get'), undefined));
});
test('request schema rejects unsupported versions, context and changed confirmation parameters', () => {
    invalid(() => p.parseRequest({ ...request('run.get'), version: '0.2' }, 'ui'));
    invalid(() => p.parseRequest(request('run.start', { tabId: 1, goal: 'Search' }), 'ui'));
    invalid(() => p.parseRequest(request('run.get', {}, {}), 'ui'));
    invalid(() => p.parseRequest(request('run.confirm', { confirmationId: 'c', decision: 'approve', action: { kind: 'navigate', url: 'https://evil.test' } }), 'ui'));
    invalid(() => p.decodeRequest(' '.repeat(p.MAX_PAYLOAD_BYTES + 1), 'ui'));
});
test('all eight event variants decode with nested schema validation', () => {
    const values = [event('run.state', { status: 'running' }), event('step.observed', { stepId: 's', observation }), event('model.completed', { stepId: 's', usage: { inputTokens: 1 } }), event('action.prepared', { stepId: 's', actionId: 'a', kind: 'fill', target }), event('action.result', { stepId: 's', result }), event('confirmation.required', { stepId: 's', confirmation }), event('verification.result', { stepId: 's', verification }), event('budget.updated', { budget })];
    for (const value of values)
        assert.deepEqual(p.decodeEvent(JSON.stringify(value)), value);
});
test('events reject unsupported versions, invalid sequence and raw sensitive model/action data', () => {
    invalid(() => p.parseEvent(event('run.state', { status: 'running' }, { version: '2' })));
    invalid(() => p.parseEvent(event('run.state', { status: 'running' }, { seq: 0 })));
    invalid(() => p.parseEvent(event('model.completed', { stepId: 's', decision: { kind: 'fill', value: 'secret' } })));
    invalid(() => p.parseEvent(event('action.prepared', { stepId: 's', actionId: 'a', kind: 'fill', target, value: 'secret' })));
    invalid(() => p.parseEvent(event('action.prepared', { stepId: 's', actionId: 'a', kind: 'click' })));
    invalid(() => p.parseEvent(event('action.prepared', { stepId: 's', actionId: 'a', kind: 'scroll', target })));
    invalid(() => p.parseEvent(event('action.result', { stepId: 's', result: { ...result, verified: 'passed', evidence: [] } })));
});
test('confirmation events enforce the 30-second window relative to emission', () => {
    for (const expiresAt of [timestamp, '2026-10-18T03:00:30.001Z'])
        invalid(() => p.parseEvent(event('confirmation.required', { stepId: 's', confirmation: { ...confirmation, expiresAt } })));
    assert.equal(p.parseEvent(event('confirmation.required', { stepId: 's', confirmation })).type, 'confirmation.required');
});
test('response must correlate request ID and type, and cannot contain both data and error', () => {
    const req = p.parseRequest(request('run.get'), 'ui');
    assert.equal(p.decodeResponse(JSON.stringify(response('run.get', snapshot)), req).ok, true);
    for (const patch of [{ requestId: 'wrong' }, { type: 'run.cancel' }, { data: { ...snapshot, runId: 'other' } }, { error: { code: 'TIMEOUT', message: 'timeout', retryable: true } }])
        invalid(() => p.parseResponse({ ...response('run.get', snapshot), ...patch }, req));
    const failure = { version: '0.1', requestId: 'req-1', type: 'run.get', ok: false, error: { code: 'TIMEOUT', message: 'timeout', retryable: true } };
    assert.equal(p.parseResponse(failure, req).ok, false);
    invalid(() => p.parseResponse({ ...failure, data: {} }, req));
});
test('subscription requires ordered, unique events from the same run and an exact delivered cursor', () => {
    const req = p.parseRequest(request('events.subscribe', { afterSeq: 2 }), 'ui');
    const first = event('run.state', { status: 'running' }, { seq: 3, eventId: 'e3' });
    const second = event('run.state', { status: 'paused' }, { seq: 5, eventId: 'e5' });
    assert.equal(p.parseResponse(response('events.subscribe', { events: [first, second], nextSeq: 5 }), req).data.nextSeq, 5);
    for (const events of [[second, first], [first, { ...second, eventId: 'e3' }], [{ ...first, runId: 'other' }], [{ ...first, seq: 2 }]])
        invalid(() => p.parseResponse(response('events.subscribe', { events, nextSeq: 5 }), req));
    invalid(() => p.parseResponse(response('events.subscribe', { events: [first], nextSeq: 5 }), req));
    assert.equal(p.parseResponse(response('events.subscribe', { events: [], nextSeq: 2 }), req).data.nextSeq, 2);
});
test('start and acknowledgement responses enforce their data variants', () => {
    const start = p.parseRequest(request('run.start', { tabId: 1, goal: 'Search' }, {}), 'ui');
    assert.equal(p.parseResponse(response('run.start', { runId: 'new' }), start).data.runId, 'new');
    const cancel = p.parseRequest(request('run.cancel'), 'ui');
    assert.equal(p.parseResponse(response('run.cancel', { accepted: true }), cancel).ok, true);
    invalid(() => p.parseResponse(response('run.cancel', { accepted: false }), cancel));
});
test('plain-data guards reject accessors and symbols without invoking attacker getters', () => {
    let called = false;
    const value = { ...observation };
    Object.defineProperty(value, 'url', { enumerable: true, get() { called = true; return 'https://example.test'; } });
    invalid(() => p.parseObservation(value));
    assert.equal(called, false);
    invalid(() => p.parseRequest({ ...request('run.get'), [Symbol('hidden')]: true }, 'ui'));
});
test('decision and extraction input contracts constrain model context and schemas', () => {
    const input = { goal: 'Search', observation, historySummary: '', allowedActions: ['click'], schemaIds: ['rows'], budget };
    assert.deepEqual(p.parseDecisionInput(input), input);
    invalid(() => p.parseDecisionInput({ ...input, allowedActions: ['evaluate'] }));
    assert.equal(p.parseExtractionInput({ observation, schemaId: 'rows', schema: { type: 'array' } }).schemaId, 'rows');
    invalid(() => p.parseExtractionInput({ observation, schemaId: 'rows', schema: () => 1 }));
});
test('already-decoded response and model objects cannot bypass the transport byte budget', () => {
    const req = p.parseRequest(request('run.get'), 'ui');
    const largeEvidence = Array.from({ length: 32 }, () => ({ ...evidence, actual: '中'.repeat(2000) }));
    invalid(() => p.parseResponse(response('run.get', { ...snapshot, status: 'completed', result: { status: 'completed', summary: 'Done', evidence: largeEvidence } }), req));
    const expected = Array.from({ length: 16 }, () => ({ kind: 'value', target, equals: 'x'.repeat(8000) }));
    invalid(() => p.parseModelResponse({ decision: { kind: 'finish', summary: 'Done', expected } }));
});
