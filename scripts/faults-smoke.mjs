import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './tools.mjs';
import { faultHashes, collectFaults, suiteChecks } from './faults-evidence.mjs';

const evidence = path.join(root, 'specs/001-browser-agent/evidence');
const archive = path.join(evidence, 't013-runs', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(archive, { recursive: true });
// Archive before running: a failed process must not leave an old green report behind.
for (const name of ['deterministic', 'observer-browser', 'control-browser', 'policy-browser', 'runtime-browser', 'loop-browser', 'sdk-browser', 'panel-browser', 'faults', 'checks']) {
    const file = 't013-' + name + '.json';
    try { await writeFile(path.join(archive, file), await readFile(path.join(evidence, file))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(path.join(evidence, file), JSON.stringify({ timestamp: new Date().toISOString(), status: 'not-run', checks: [], files: {} }, null, 2) + '\n');
}
await import('./build.mjs');
const deterministic = { timestamp: new Date().toISOString(), node: process.version, platform: process.platform, status: 'failed', kind: 'runtime-policy-integration; memory store and browser double', checks: [], files: await faultHashes() };
try {
    deterministic.stdout = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'packages/runtime/test/faults.test.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    deterministic.checks = [...deterministic.stdout.matchAll(/^ok \d+ - (fault\.[^:\n]+):[^\n]*$/gm)].map(m => ({ name: m[1], passed: true }));
    deterministic.status = 'passed';
    if (!suiteChecks('deterministic', deterministic)) deterministic.status = 'failed';
} catch (error) { deterministic.stdout = String(error.stdout ?? ''); deterministic.error = String(error.stderr || error.message); }
await writeFile(path.join(evidence, 't013-deterministic.json'), JSON.stringify(deterministic, null, 2) + '\n');
for (const [file, env] of [['scripts/sdk-smoke.mjs', { WISP_SDK_STAGE: 't013' }], ['apps/extension/test/panel-browser.mjs', { WISP_PANEL_STAGE: 't013' }]]) {
    try { execFileSync(process.execPath, [file], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true, timeout: 300000 }); }
    catch (error) { console.error(file + ': failed (exit ' + error.status + ')'); }
}
const report = await collectFaults();
await writeFile(path.join(evidence, 't013-faults.json'), JSON.stringify(report, null, 2) + '\n');
console.log('T-013 fault matrix: ' + report.checks.filter(c => c.passed).length + '/' + report.checks.length + '; ' + report.status);
if (report.status !== 'passed') process.exitCode = 1;
