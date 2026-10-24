import assert from 'node:assert/strict';
export function createController(server) {
    async function request(path, method = 'GET', value) {
        const response = await fetch(server.controlOrigin + path, { method, headers: { Authorization: 'Bearer ' + server.controlToken, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
        const body = await response.json();
        if (!response.ok)
            throw new Error('Fixture control ' + response.status + ': ' + body.error);
        return body;
    }
    return { create: () => request('/sessions', 'POST', {}), state: id => request('/sessions/' + id + '/state'), reset: id => request('/sessions/' + id + '/reset', 'POST', {}), configure: (id, value) => request('/sessions/' + id + '/config', 'POST', value), remove: id => request('/sessions/' + id, 'DELETE') };
}
export function assertNoEffects(state) { assert.equal(state.submissions.length, 0); assert.equal(state.saves.length, 0); assert.ok(Object.values(state.clicks).every(count => count === 0)); }
export function assertSubmissionCount(state, count) { assert.equal(state.submissions.length, count, 'Unexpected actual submission count'); }
export function assertSavedTitle(state, title) { assert.equal(state.saves.length, 1); assert.equal(state.saves[0].title, title); }
export function assertPendingHighRows(actual, state) {
    assert.deepEqual(actual.map(row => row.id), state.expected.pendingHighIds);
    assert.deepEqual(actual, state.expected.pendingHighRecords);
    assert.ok(actual.every(row => row.status === 'pending' && row.priority === 'high'));
}
