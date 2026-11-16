export class AdminDAO {
  constructor(db) { this.collection = db.collection('admins'); }
  findByUsername(username) { return this.collection.findOne({ username }); }
  create(admin) { return this.collection.insertOne(admin); }
}
