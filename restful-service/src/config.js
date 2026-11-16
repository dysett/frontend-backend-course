import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function readConfig(env = process.env) {
  const port = Number(env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT має бути цілим числом від 1 до 65535.');
  const dbName = env.MONGODB_DB || 'restful_library';
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) throw new Error('Некоректна назва MONGODB_DB.');
  return {
    host: env.HOST || '127.0.0.1', port,
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017', dbName,
    demoPath: path.join(projectRoot, '.data', 'mongodb'),
  };
}
