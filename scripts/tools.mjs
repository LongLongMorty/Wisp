import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extension = path.join(root, 'apps', 'extension');
export function runTool(packageName, binName, args, cwd = root) {
  const require = createRequire(path.join(cwd, 'package.json'));
  let entry;
  try { entry = require.resolve(packageName); }
  catch { throw new Error('Missing dependency ' + packageName + '. Run npm install at the repository root.'); }
  let directory = path.dirname(entry);
  while (true) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(path.join(directory,'package.json'),'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (pkg?.name === packageName) {
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
      if (!bin) throw new Error('Missing executable ' + binName);
      execFileSync(process.execPath,[path.resolve(directory,bin),...args],{cwd,stdio:'inherit',windowsHide:true});
      return;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot locate package root: ' + packageName);
    directory = parent;
  }
}
