import test from 'node:test';
import assert from 'node:assert/strict';
import { matrix, suiteChecks, matches } from '../../../scripts/faults-evidence.mjs';
const good = () => ({ status: 'passed', checks: matrix.suites.runtime.map(name => ({ name, passed: true })) });
test('fault evidence rejects a green total with a missing named recovery assertion', () => {
    const r = good(); assert.equal(suiteChecks('runtime', r), true);
    r.checks[0].name = 'unrelated'; assert.equal(suiteChecks('runtime', r), false);
});
test('fault evidence rejects duplicate, false and non-passed reports', () => {
    const r = good(); r.checks.push(r.checks[0]); assert.equal(suiteChecks('runtime', r), false);
    const f = good(); f.checks[0].passed = false; assert.equal(suiteChecks('runtime', f), false);
    assert.equal(suiteChecks('runtime', { ...good(), status: 'environment-blocked' }), false);
});
test('fault evidence requires every file and rejects substituted fingerprints', () => {
    assert.equal(matches({ a: '1' }, { a: '1', b: '2' }), false);
    assert.equal(matches({ a: '2' }, { a: '1' }), false);
    assert.equal(matches({ b: '2', a: '1' }, { a: '1', b: '2' }), true);
});
