import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, formValues, evaluateTrial, scoreTrials } from '../../../scripts/release-cases.mjs';
import { livePassed, performancePassed, manualPassed, reliabilityPassed,reliabilityNames } from '../../../scripts/release-evidence.mjs';
test('reliability probe requires each named check and cannot count as actual model tasks',()=>{const r={kind:'scripted-reliability-probe',status:'passed',checks:reliabilityNames.map(name=>({name,passed:true}))};assert.equal(reliabilityPassed(r),true);assert.equal(livePassed(r),false);r.checks[0]=r.checks[1];assert.equal(reliabilityPassed(r),false);});
import { RECORDS } from '../../../fixtures/web/domain.mjs';
const trials = () => scenarios.flatMap(scenario => Array.from({ length: 5 }, (_, n) => ({ scenario, iteration: n + 1, runId: scenario + n, modelAttempts: 1, checks: { passed: true, business: true, source: true, noEffects: true } })));
test('release requires five fixed trials per scenario and at least four successes each', () => {
    const rows = trials(); for (const s of scenarios) rows.find(t => t.scenario === s).checks.passed = false;
    assert.equal(scoreTrials(rows).passed, true);
    rows[1].checks.passed = false; assert.equal(scoreTrials(rows).passed, false);
    assert.equal(scoreTrials(trials().slice(1)).passed, false);
});
test('release never averages away a write or substitutes repeated runs', () => {
    const rows = trials(); rows[0].checks.noEffects = false; assert.equal(scoreTrials(rows).passed, false);
    const dup = trials(); dup[0] = dup[1]; assert.equal(scoreTrials(dup).passed, false);
    const ids = trials(); ids[0].runId = ids[5].runId; assert.equal(scoreTrials(ids).passed, false);
});
test('release excludes scripted zero-request outcomes and claimed success without proof', () => {
    const rows = trials(); rows[0].modelAttempts = 0; assert.equal(scoreTrials(rows).passed, false);
    assert.equal(livePassed({ kind: 'actual-model-browser-tasks', status: 'passed', trials: trials() }), false);
});
const oracle = () => ({ submissions: [], saves: [], clicks: {}, pendingSaves: 0, expected: { pendingLoginId: 'W-102', pendingHighIds: RECORDS.slice(0, 5).map(r => r.id), pendingHighRecords: RECORDS.slice(0, 5) } });
test('search success is independently tied to pending record and real URL evidence', () => {
    const url = 'https://fixture.test/records/W-104';
    const outcome = { baseUrl: 'https://fixture.test', oracle: oracle(), page: { record: 'W-104', url, title: '报表访问异常' }, snapshot: { status: 'completed', result: { evidence: [{ kind: 'url', url }, { kind: 'text', url }] } } };
    assert.equal(evaluateTrial('search', outcome).passed, true);
    outcome.page.record = 'W-107'; assert.equal(evaluateTrial('search', outcome).passed, false);
});
test('table cannot pass using correct extracted data while skipping UI filtering', () => {
    const result = { extraction: { data: { records: RECORDS.slice(0, 5).map(r => ({ id: r.id, title: r.title, status: '待处理', priority: '高' })) }, source: [{ url: 'https://fixture.test/table', observationId: 'o', documentId: 'd' }] } };
    const outcome = { baseUrl: 'https://fixture.test', oracle: oracle(), page: { status: 'pending', priority: 'high', ids: RECORDS.slice(0, 5).map(r => r.id) }, snapshot: { status: 'completed', result } };
    assert.equal(evaluateTrial('table', outcome).passed, true);
    outcome.page.status = 'all'; assert.equal(evaluateTrial('table', outcome).passed, false);
    outcome.page.status = 'pending'; result.extraction.data.records[0].title = '错误'; assert.equal(evaluateTrial('table', outcome).passed, false);
});
test('form must have exact fields, a submit confirmation, and zero independent effects', () => {
    const outcome = { baseUrl: 'https://fixture.test', oracle: oracle(), page: { ...formValues }, snapshot: { status: 'waiting_user' }, pending: { kind: 'confirm', confirmation: { origin: 'https://fixture.test', displayParameters: { kind: 'click', target: '提交工单' } } } };
    assert.equal(evaluateTrial('form', outcome).passed, true);
    outcome.pending.kind = 'ask_user'; assert.equal(evaluateTrial('form', outcome).passed, false);
    outcome.pending.kind = 'confirm'; outcome.oracle.submissions.push({}); assert.equal(evaluateTrial('form', outcome).passed, false);
    outcome.oracle.submissions = []; outcome.oracle.pendingSaves = 1; assert.equal(evaluateTrial('form', outcome).passed, false);
});
const perf = () => ({ kind: 'real-chrome-performance', status: 'passed', observation: { samplesMs: Array(30).fill(500), p95Ms: 500, candidateButtons: 200, visibleButtons: 200, returnedElements: 200 }, stop: { stateMs: 999, cancelled: true, noLateEffects: true } });
test('performance gate checks raw samples, visibility and exact stop threshold', () => {
    assert.equal(performancePassed(perf()), true);
    const r = perf(); r.observation.samplesMs[28] = 501; r.observation.samplesMs[29] = 501; assert.equal(performancePassed(r), false);
    const stop = perf(); stop.stop.stateMs = 1000; assert.equal(performancePassed(stop), false);
    const hidden = perf(); hidden.observation.visibleButtons = 199; assert.equal(performancePassed(hidden), false);
});
test('manual review requires a real reviewer and observations for all four items', () => {
    const r = { kind: 'human-review', status: 'passed', reviewer: 'checker', checks: ['confirmation', 'pauseResume', 'capability', 'dataFlow'].map(name => ({ name, passed: true, observation: '实际观察与测量记录' })) };
    assert.equal(manualPassed(r), true);
    r.checks[0].observation = ''; assert.equal(manualPassed(r), false);
    r.checks[0].observation = 'observed'; r.reviewer = ' '; assert.equal(manualPassed(r), false);
});
