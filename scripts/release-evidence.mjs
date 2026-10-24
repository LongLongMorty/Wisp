import { faultHashes, matches, collectFaults } from './faults-evidence.mjs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './tools.mjs';
import { scoreTrials, taskVersion, evaluateTrial } from './release-cases.mjs';
export const manualNames = ['confirmation', 'pauseResume', 'capability', 'dataFlow'];
export const reliabilityNames=['observe.formValues','observe.valueBounds','observe.sensitiveExcluded','observe.selectState','select.pending','select.high','select.actualFilteredRows','select.missingRejected','select.disabledRejected','select.ambiguousRejected','select.staleRejected','select.reactControlled','completion.good','completion.bad','oracle.zeroEffects'];
export async function releaseHashes() {
    const files = await faultHashes();
    for (const name of await readdir(path.join(root, 'scripts'))) {
        if (name.startsWith('release-') || name === 'record-release-manual.mjs') {
            const file = 'scripts/' + name; files[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
        }
    }
    for (const file of ['scripts/reliability-browser.mjs','specs/001-browser-agent/reliability-v02.md','specs/001-browser-agent/release-v01.md', 'specs/001-browser-agent/release-manual.md']) files[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
    return files;
}
const evidence = path.join(root, 'specs/001-browser-agent/evidence');
export async function writeRelease(name, report) {
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, 't014-' + name + '.json'), JSON.stringify(report, null, 2) + '\n');
}
export async function archiveRelease(names) {
    const dir = path.join(evidence, 't014-runs', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(dir, { recursive: true });
    for (const name of names) {
        try { await writeFile(path.join(dir, 't014-' + name + '.json'), await readFile(path.join(evidence, 't014-' + name + '.json'))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await writeRelease(name, { timestamp: new Date().toISOString(), status: 'not-run', files: {} });
    }
}
export function livePassed(report) {
    return report.kind === 'actual-model-browser-tasks' && report.status === 'passed' && report.taskVersion === taskVersion && /^[a-f0-9]{64}$/.test(report.configuration?.endpointSha256 ?? '') && !!report.configuration?.model && report.configuration?.promptSha256 === report.files?.['packages/models/src/index.mts'] && !!report.configuration?.promptSha256 && report.configuration?.taskVersion === taskVersion && scoreTrials(report.trials ?? []).passed && report.trials.every(t => {
        if (!t.outcome) return false;
        const actual = evaluateTrial(t.scenario, t.outcome);
        return t.budget?.modelCalls?.used === t.modelAttempts && t.checks.noEffects === actual.noEffects && t.checks.business === actual.business && t.checks.source === actual.source && t.checks.passed === (actual.passed && !t.error);
    });
}
export function performancePassed(report) {
    const p = report.observation, samples = p?.samplesMs;
    if (report.status !== 'passed' || report.kind !== 'real-chrome-performance' || !Array.isArray(samples) || samples.length !== 30 || samples.some(n => !Number.isFinite(n) || n < 0)) return false;
    const sorted = [...samples].sort((a, b) => a - b);
    return p.candidateButtons === 200 && p.visibleButtons === 200 && Number.isInteger(p.returnedElements) && p.returnedElements > 0 && p.p95Ms === sorted[28] && sorted[28] <= 500 && Number.isFinite(report.stop?.stateMs) && report.stop.stateMs >= 0 && report.stop.stateMs < 1000 && report.stop.cancelled === true && report.stop.noLateEffects === true;
}
export function manualPassed(report) {
    return report.kind === 'human-review' && report.status === 'passed' && typeof report.reviewer === 'string' && !!report.reviewer.trim() && report.checks?.length === manualNames.length && manualNames.every(name => report.checks.some(c => c.name === name && c.passed === true && typeof c.observation === 'string' && !!c.observation.trim()));
}
export function reliabilityPassed(report){return report.kind==='scripted-reliability-probe'&&report.status==='passed'&&Array.isArray(report.checks)&&report.checks.length===reliabilityNames.length&&new Set(report.checks.map(c=>c.name)).size===reliabilityNames.length&&reliabilityNames.every(n=>report.checks.some(c=>c.name===n&&c.passed===true));}
export async function collectRelease() {
    const files = await releaseHashes(), suites = {}, checks = [];
    for (const [name, validate] of [['live', livePassed], ['performance', performancePassed], ['manual', manualPassed], ['reliability',reliabilityPassed]]) {
        try {
            const bytes = await readFile(path.join(evidence, 't014-' + name + '.json')), report = JSON.parse(bytes);
            const current = matches(report.files, files);
            suites[name] = { status: report.status, sourceHashesMatch: current, sha256: createHash('sha256').update(bytes).digest('hex') };
            checks.push({ name, passed: current && validate(report) });
        } catch (error) { suites[name] = { status: 'not-run', error: error.code ?? 'INVALID_EVIDENCE', sourceHashesMatch: false }; checks.push({ name, passed: false }); }
    }
    try {
        const current = await collectFaults(), saved = JSON.parse(await readFile(path.join(evidence, 't013-faults.json'), 'utf8'));
        const bound = matches(saved.files, current.files) && JSON.stringify(saved.suites) === JSON.stringify(current.suites) && JSON.stringify(saved.checks) === JSON.stringify(current.checks);
        suites.faultMatrix = { status: current.status, sourceHashesMatch: bound };
        checks.push({ name: 'faultMatrix', passed: bound && saved.status === 'passed' && current.status === 'passed' });
    } catch { suites.faultMatrix = { status: 'not-run', sourceHashesMatch: false }; checks.push({ name: 'faultMatrix', passed: false }); }
    return { timestamp: new Date().toISOString(), status: checks.every(c => c.passed) ? 'passed' : 'incomplete', files, suites, checks };
}
