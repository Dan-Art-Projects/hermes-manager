import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createManager, type ManagerOptions } from './app.ts';

export { createManager } from './app.ts';

export async function start(options: ManagerOptions = {}) {
  const manager = createManager(options);
  try {
    await new Promise<void>((resolveReady, reject) => {
      manager.server.once('error', reject);
      manager.server.listen(manager.port, '127.0.0.1', () => {
        manager.server.off('error', reject);
        resolveReady();
      });
    });
    return manager;
  } catch (error) {
    await manager.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manager = await start();
  console.log(`Hermes Manager listening at http://127.0.0.1:${manager.port}`);
  const stop = () => {
    void manager.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
