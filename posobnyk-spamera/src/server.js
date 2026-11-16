import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readConfig, projectRoot } from './config.js';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';
import { sampleContacts } from './data/sample-contacts.js';

let mongo;
let client;
let server;
let mailer;
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  if (server) await new Promise(resolve => server.close(resolve));
  mailer?.close();
  await client?.close();
  await mongo?.stop();
}

try {
  const demo = process.argv.includes('--demo');
  const config = readConfig(demo ? { ...process.env, MAIL_MODE: 'preview', SMTP_USER: '', SMTP_PASS: '' } : process.env);
  if (demo) {
    console.log('Демонстраційний режим: MongoDB + локальні .eml. Перший запуск може завантажити MongoDB.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const dbPath = path.join(projectRoot, '.data/mongodb');
    await mkdir(dbPath, { recursive: true });
    mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
    config.mongoUri = mongo.getUri();
    config.dbName = 'posobnyk_spamera_demo';
  }
  const database = await connectDatabase(config);
  client = database.client;
  const application = createApp({ db: database.db, config });
  mailer = application.mailer;
  await application.campaigns.recoverInterrupted();
  if (demo && await database.db.collection('contacts').countDocuments() === 0) await application.contacts.seed(sampleContacts);
  server = await new Promise((resolve, reject) => {
    const listener = application.app.listen(config.port, config.host, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Листоноша: http://${config.host}:${server.address().port}`);
  console.log(`База даних: MongoDB (${config.dbName}). Пошта: ${config.mailMode}.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close().then(() => process.exit(0)));
} catch (error) {
  console.error('Не вдалося запустити застосунок:', error.name);
  console.error('Перевірте .env та MongoDB. Для запуску демонстрації: npm run demo');
  await close();
  process.exitCode = 1;
}
