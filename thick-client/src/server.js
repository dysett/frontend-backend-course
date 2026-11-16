import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';
import { seedBooks } from '../scripts/seed-data.js';
import { AuthService } from './services/auth-service.js';
import { AdminDAO } from './dao/admin-dao.js';

let mongo;
let client;
let server;
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  if (server) await new Promise(resolve => server.close(resolve));
  await client?.close();
  // Зупинка процесу без видалення каталогу WiredTiger у demo-режимі.
  await mongo?.stop({ doCleanup: false });
}

try {
  const demo = process.argv.includes('--demo');
  const config = readConfig();
  if (demo) {
    if (config.host !== '127.0.0.1' || config.auth.publicOrigin || config.auth.secureCookies) throw new Error('Demo запускається лише на 127.0.0.1 через HTTP без PUBLIC_ORIGIN.');
    console.log('Demo: локальна MongoDB з постійним сховищем. Перший запуск може завантажити MongoDB.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    await mkdir(config.demoPath, { recursive: true });
    mongo = await MongoMemoryServer.create({ instance: { dbPath: config.demoPath, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
    config.mongoUri = mongo.getUri();
    config.dbName = 'thick_client_demo';
    const secretFile = path.join(config.demoPath, '..', 'session-secret');
    try { config.auth.sessionSecret = await readFile(secretFile, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      config.auth.sessionSecret = randomBytes(48).toString('hex');
      await writeFile(secretFile, config.auth.sessionSecret, { mode: 0o600, flag: 'wx' });
    }
  }
  if (!config.auth.sessionSecret || config.auth.sessionSecret.length < 32) throw new Error('Налаштуйте SESSION_SECRET (мінімум 32 символи).');
  const connection = await connectDatabase(config);
  client = connection.client;
  if (demo && await connection.db.collection('books').countDocuments() === 0) await seedBooks(connection.db);
  if (demo) {
    const admins = new AdminDAO(connection.db);
    if (!await admins.findByUsername('admin')) await new AuthService(admins).createAdmin('admin', 'DemoLibrary!2026');
  }
  const app = createApp({ db: connection.db, auth: config.auth });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Книгосховище: http://${config.host}:${config.port}`);
  console.log(`Адміністратор: http://${config.host}:${config.port}/admin`);
  if (demo) console.log('Локальний демонстраційний обліковий запис: admin / DemoLibrary!2026');
  console.log(`База: MongoDB / ${config.dbName}. Postman baseUrl: http://${config.host}:${config.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => close().then(() => process.exit(0)).catch(() => process.exit(1)));
  }
} catch (error) {
  console.error('Запуск не вдався:', error.name, error.code ?? '');
  console.error('Перевірте MongoDB, PORT та .env. Локальний запуск без встановленої MongoDB: npm run demo');
  await close();
  process.exitCode = 1;
}
