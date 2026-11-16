import { objectId } from '../validation.js';

export class ContactDAO {
  constructor(db) { this.collection = db.collection('contacts'); }
  async list() {
    return this.collection.find({}).collation({ locale: 'uk', strength: 2 })
      .sort({ lastName: 1, firstName: 1, middleName: 1, email: 1 }).toArray();
  }
  async findByIds(ids) { return this.collection.find({ _id: { $in: ids.map(objectId) } }).toArray(); }
  async create(contact) {
    const document = { ...contact, createdAt: new Date(), updatedAt: new Date() };
    const result = await this.collection.insertOne(document);
    return { ...document, _id: result.insertedId };
  }
  async update(id, contact) {
    return this.collection.findOneAndUpdate({ _id: objectId(id) }, { $set: { ...contact, updatedAt: new Date() } }, { returnDocument: 'after' });
  }
  async delete(id) { return (await this.collection.deleteOne({ _id: objectId(id) })).deletedCount === 1; }
  async seed(contacts) {
    // Повторний запуск не стирає і не змінює наявних контактів.
    return this.collection.bulkWrite(contacts.map(contact => ({ updateOne: {
      filter: { email: contact.email }, update: { $setOnInsert: { ...contact, createdAt: new Date(), updatedAt: new Date() } }, upsert: true
    } })));
  }
}
