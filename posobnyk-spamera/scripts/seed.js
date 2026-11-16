import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/db.js';
import { ContactDAO } from '../src/dao/contact-dao.js';
import { sampleContacts } from '../src/data/sample-contacts.js';

const { client, db } = await connectDatabase(readConfig());
try {
  const result = await new ContactDAO(db).seed(sampleContacts);
  console.log(`Додано демонстраційних контактів: ${result.upsertedCount}. Наявні записи збережено.`);
} finally { await client.close(); }
