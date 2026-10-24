import { execFileSync } from 'node:child_process';
import { root } from './tools.mjs';
import { collectRelease, writeRelease, archiveRelease, releaseHashes } from './release-evidence.mjs';
await archiveRelease(['acceptance', 'checks']);
let passed = true, prerequisites=true;
for (const file of ['scripts/faults-smoke.mjs','scripts/reliability-browser.mjs', 'scripts/release-live.mjs', 'scripts/release-performance.mjs']) {
    if(file==='scripts/release-live.mjs' && !prerequisites && process.env.WISP_MODEL_ENDPOINT && process.env.WISP_MODEL_NAME){await archiveRelease(['live']);await writeRelease('live',{timestamp:new Date().toISOString(),kind:'actual-model-browser-tasks',status:'not-run',reason:'PREREQUISITE_FAILED',trials:[],files:await releaseHashes()});passed=false;continue;}
    try { execFileSync(process.execPath, [file], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: file.endsWith('release-live.mjs') ? 4800000 : 600000 }); }
    catch (error) { passed = false; if(['scripts/faults-smoke.mjs','scripts/reliability-browser.mjs'].includes(file))prerequisites=false; console.error(file + ': did not pass (exit ' + error.status + ')'); }
}
const report = await collectRelease(); await writeRelease('acceptance', report);
console.log('Release acceptance: ' + report.status + ' (manual review is recorded separately)');
if (!passed || report.status !== 'passed') process.exitCode = 1;
