import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from './tools.mjs';
async function visit(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(['node_modules','dist','.output','.wxt','.cache'].includes(entry.name)) continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()) await visit(file);
    else if(/\.(?:mjs|mts|ts)$/.test(file) && !file.endsWith('.d.ts')) execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
    else if(file.endsWith('.json')) JSON.parse(await readFile(file,'utf8'));
  }
}
for(const directory of ['packages','apps','scripts','fixtures']) await visit(path.join(root,directory));
for(const file of ['apps/extension/wxt.config.ts','apps/extension/entrypoints/background.ts','apps/extension/entrypoints/sidepanel/index.html']) await access(path.join(root,file));
console.log('Node syntax, JSON and WXT source entry paths: PASS');
console.log('This does not replace tsc type checking or TSX/WXT compilation.');
