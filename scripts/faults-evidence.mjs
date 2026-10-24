import { panelHashes } from './panel-evidence.mjs';
import { loopHashes } from './loop-evidence.mjs';
import { sdkHashes } from './sdk-evidence.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './tools.mjs';

export const matrix = JSON.parse(await readFile(path.join(root, 'specs/001-browser-agent/fault-matrix.json'), 'utf8'));
export async function faultHashes() {
    const files = await panelHashes();
    for (const file of ['scripts/faults-evidence.mjs', 'scripts/faults-smoke.mjs', 'scripts/validate-toolchain.mjs', 'specs/001-browser-agent/fault-matrix.json']) {
        files[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
    }
    return files;
}
export function matches(actual, expected) {
    return !!actual && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([f, h]) => actual[f] === h);
}
export function suiteChecks(suite, report) {
    const required = matrix.suites[suite];
    if (!required?.length || !report || report.status !== 'passed' || !Array.isArray(report.checks)) return false;
    const names = report.checks.map(c => c.name);
    return new Set(names).size === names.length && report.checks.every(c => c.passed === true) && required.every(name => names.includes(name));
}
export async function collectFaults() {
    const files = await faultHashes(), suites = {}, checks = [];
    for (const suite of Object.keys(matrix.suites)) {
        const file = 'specs/001-browser-agent/evidence/t013-' + (suite === 'deterministic' ? suite : suite + '-browser') + '.json';
        try {
            const bytes = await readFile(path.join(root, file)), report = JSON.parse(bytes);
            // Deterministic tests bind the entire current acceptance source set.
            // Browser suites retain their existing source/bundle fingerprint scope.
            let current = Object.keys(report.files ?? {}).length > 0;
            for (const [f, h] of Object.entries(report.files ?? {})) {
                if (createHash('sha256').update(await readFile(path.join(root, f))).digest('hex') !== h) current = false;
            }
            if (suite === 'deterministic') current = current && matches(report.files, files);
            if (suite === 'panel') current = current && matches(report.files, await panelHashes());
            if (suite === 'loop') current = current && matches(report.files, await loopHashes());
            if (suite === 'sdk') current = current && matches(report.files, await sdkHashes());
            if (!['loop','sdk'].includes(suite) && matrix.requiredFiles[suite]) current = current && Object.keys(report.files ?? {}).length === matrix.requiredFiles[suite].length && matrix.requiredFiles[suite].every(f => Object.hasOwn(report.files ?? {}, f));
            suites[suite] = { status: report.status, sourceHashesMatch: current, evidence: file, sha256: createHash('sha256').update(bytes).digest('hex') };
            for (const name of matrix.suites[suite]) checks.push({ name: suite + ':' + name, passed: current && suiteChecks(suite, report) && report.checks.some(c => c.name === name && c.passed === true) });
        } catch (error) {
            suites[suite] = { status: 'not-run', sourceHashesMatch: false, error: error.code ?? error.message };
            for (const name of matrix.suites[suite]) checks.push({ name: suite + ':' + name, passed: false });
        }
    }
    return { timestamp: new Date().toISOString(), status: checks.every(c => c.passed) ? 'passed' : 'incomplete', files, suites, checks };
}
