import { MongoClient } from 'mongodb';

export async function connectDatabase(config) {
  const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(config.dbName);
    await db.collection('contacts').createIndex({ email: 1 }, { unique: true });
    await db.collection('contacts').createIndex({ lastName: 1, firstName: 1, middleName: 1 }, { collation: { locale: 'uk', strength: 2 } });
    await db.collection('campaigns').createIndex({ createdAt: -1 });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
