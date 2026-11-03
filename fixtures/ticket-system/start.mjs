import {createFixtureServer} from './server.mjs';
import {FIXTURE_VERSION} from './domain.mjs';

const server = await createFixtureServer();
console.log(JSON.stringify({
  version: FIXTURE_VERSION,
  origin: server.origin,
  controlOrigin: server.controlOrigin,
  controlToken: server.controlToken,
  session: server.initialSession
}, null, 2));
console.log('Local test-only control credentials are for the harness; they are not exposed to the app.');

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
