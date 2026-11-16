import { objectId } from '../validation.js';

export class CampaignDAO {
  constructor(db) { this.collection = db.collection('campaigns'); }
  async create(campaign) {
    const result = await this.collection.insertOne(campaign);
    return { ...campaign, _id: result.insertedId };
  }
  async update(id, changes) { await this.collection.updateOne({ _id: objectId(id) }, { $set: changes }); }
  async get(id) { return this.collection.findOne({ _id: objectId(id) }); }
  async list() { return this.collection.find({}, { projection: { recipients: 0, text: 0 } }).sort({ createdAt: -1 }).limit(30).toArray(); }
  async recoverInterrupted() {
    await this.collection.updateMany({ status: 'sending' }, { $set: { status: 'interrupted', finishedAt: new Date() } });
  }
}
