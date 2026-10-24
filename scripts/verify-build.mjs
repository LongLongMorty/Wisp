import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { extension } from './tools.mjs';
const output=path.join(extension,'.output','chrome-mv3');
const manifest=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3 || manifest.minimum_chrome_version!=='125') throw new Error('Unexpected MV3 manifest');
if(JSON.stringify([...(manifest.permissions||[])].sort())!==JSON.stringify(['debugger','sidePanel','storage','tabs'])) throw new Error('Unexpected extension permissions');
if(JSON.stringify([...(manifest.optional_host_permissions||[])].sort())!==JSON.stringify(['http://*/*','https://*/*']))throw new Error('Unexpected optional host permissions');
if(manifest.host_permissions?.length||manifest.content_scripts?.length||manifest.externally_connectable||manifest.web_accessible_resources?.length)throw new Error('Unexpected public or automatic page access');
if(!manifest.background?.service_worker || !manifest.side_panel?.default_path) throw new Error('Missing entrypoints');
async function localFile(relative) {
  if(typeof relative!=='string' || /^[a-z]+:/i.test(relative) || relative.startsWith('//')) throw new Error('Expected local extension resource');
  const filename=path.resolve(output,relative.replace(/^\//,''));
  if(!filename.startsWith(output+path.sep)) throw new Error('Resource outside extension output');
  await access(filename);return filename;
}
await localFile(manifest.background.service_worker);
const html=await readFile(await localFile(manifest.side_panel.default_path),'utf8');
for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const resource=match[1];
  await localFile(resource.startsWith('/')?resource:path.posix.join(path.posix.dirname(manifest.side_panel.default_path),resource));
}
console.log('WXT MV3 manifest and entry resources: PASS');
