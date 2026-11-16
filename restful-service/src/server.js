import { mkdir } from 'node:fs/promises';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';
import { seedBooks } from '../scripts/seed-data.js';

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
    console.log('Demo: локальна MongoDB з постійним сховищем. Перший запуск може завантажити MongoDB.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    await mkdir(config.demoPath, { recursive: true });
    mongo = await MongoMemoryServer.create({ instance: { dbPath: config.demoPath, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
    config.mongoUri = mongo.getUri();
    config.dbName = 'restful_library_demo';
  }
  const connection = await connectDatabase(config);
  client = connection.client;
  if (demo && await connection.db.collection('books').countDocuments() === 0) await seedBooks(connection.db);
  const app = createApp({ db: connection.db });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`RESTful-сервіс: http://${config.host}:${config.port}`);
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
