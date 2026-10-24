import {sdkHashes} from './sdk-evidence.mjs';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './tools.mjs';
export async function panelHashes(){const files=await sdkHashes();async function walk(dir){for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){if(['node_modules','.wxt','.output'].includes(e.name))continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await walk(file);else files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}}await walk('apps/extension');await walk('apps/extension/.output/chrome-mv3');for(const file of ['scripts/panel-smoke.mjs','scripts/panel-evidence.mjs','scripts/record-panel-manual.mjs','scripts/verify-build.mjs'])files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');return files;}
