import { createFixtureServer } from './server.mjs';
const server = await createFixtureServer();
const response = await fetch(server.controlOrigin + '/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + server.controlToken, 'Content-Type': 'application/json' }, body: '{}' });
if (!response.ok)
    throw new Error('Cannot create initial fixture session');
const session = await response.json();
console.log(JSON.stringify({ ...server, close: undefined, session }, null, 2));
console.log('Local test-only control credentials are for the harness; they are not exposed to the app.');
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { server.close().then(() => process.exit(0), () => process.exit(1)); });
