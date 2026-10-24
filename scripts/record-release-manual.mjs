import { readFile } from 'node:fs/promises';
import { releaseHashes, archiveRelease, writeRelease, manualNames, manualPassed } from './release-evidence.mjs';
const passed = process.argv.includes('--passed=' + manualNames.join(','));
const reviewer = process.argv.find(a => a.startsWith('--reviewer='))?.slice(11);
const notes = process.argv.find(a => a.startsWith('--notes='))?.slice(8);
if (process.argv.some(a => a.startsWith('--passed=')) && !passed) throw Error('Provide all four completed checks from release-manual.md');
const report = { timestamp: new Date().toISOString(), kind: 'human-review', status: passed ? 'passed' : 'not-run', checks: [], files: await releaseHashes() };
if (passed) {
    if (!reviewer?.trim() || reviewer.length > 80 || !notes) throw Error('Provide reviewer and a JSON notes file after completing release-manual.md');
    const observations = JSON.parse(await readFile(notes, 'utf8'));
    report.reviewer = reviewer;
    report.checks = manualNames.map(name => ({ name, passed: true, observation: observations[name] }));
    if (!manualPassed(report) || report.checks.some(c => c.observation.length > 2000)) throw Error('Each check requires a nonempty observation (max 2000 chars)');
}
await archiveRelease(['manual']); await writeRelease('manual', report);
console.log('Release manual: ' + report.status);
