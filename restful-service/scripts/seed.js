import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/db.js';
import { seedBooks } from './seed-data.js';

let client;
try {
  const connection = await connectDatabase(readConfig());
  client = connection.client;
  console.log(`Додано книжок: ${await seedBooks(connection.db)}. Наявні записи збережено.`);
} catch (error) {
  console.error('Не вдалося додати дані:', error.name);
  process.exitCode = 1;
} finally { await client?.close(); }
