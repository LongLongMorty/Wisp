const operation = process.argv[2];
if (!['live', 'performance', 'reliability'].includes(operation)) throw Error('Expected live, performance or reliability');
await import('./build.mjs');
await import(operation==='reliability'?'./reliability-browser.mjs':'./release-' + operation + '.mjs');
