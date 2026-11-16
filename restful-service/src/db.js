import { MongoClient } from 'mongodb';

export async function connectDatabase({ mongoUri, dbName }) {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    // Підтверджувати запис після журналювання, зокрема перед зупинкою Windows-процесу.
    writeConcern: { w: 1, j: true },
  });
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.collection('books').createIndex({ isbn: 1 }, { unique: true });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
