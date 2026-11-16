import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function readConfig(env = process.env) {
  const port = Number(env.PORT ?? 3003);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT має бути цілим числом від 1 до 65535.');
  const dbName = env.MONGODB_DB || 'thick_client_library';
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) throw new Error('Некоректна назва MONGODB_DB.');
  if (env.PUBLIC_ORIGIN && !/^https?:\/\/[^/]+$/.test(env.PUBLIC_ORIGIN)) throw new Error('PUBLIC_ORIGIN: укажіть origin без шляху.');
  if (env.NODE_ENV === 'production' && (!env.PUBLIC_ORIGIN?.startsWith('https://') || env.COOKIE_SECURE !== 'true')) throw new Error('Production потребує HTTPS PUBLIC_ORIGIN і COOKIE_SECURE=true.');
  return {
    host: env.HOST || '127.0.0.1', port,
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017', dbName,
    demoPath: path.join(projectRoot, '.data', 'mongodb'),
    adminUsername: env.ADMIN_USERNAME || 'admin', adminPassword: env.ADMIN_PASSWORD,
    auth: { sessionSecret: env.SESSION_SECRET, secureCookies: env.COOKIE_SECURE === 'true', trustProxy: env.TRUST_PROXY === 'true', publicOrigin: env.PUBLIC_ORIGIN },
  };
}
