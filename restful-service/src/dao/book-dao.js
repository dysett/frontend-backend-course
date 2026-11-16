import { ObjectId } from 'mongodb';

const literalRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Лише DAO знає структуру колекції та виконує операції MongoDB.
export class BookDAO {
  constructor(db) {
    this.collection = db.collection('books');
  }

  async findAll({ q, genre, available } = {}) {
    const filter = {};
    if (q) {
      const regex = new RegExp(literalRegex(q), 'i');
      filter.$or = [{ title: regex }, { author: regex }, { isbn: regex }];
    }
    if (genre) filter.genre = genre;
    if (available !== undefined) {
      filter.$expr = { [available ? '$lt' : '$gte']: [{ $size: '$loans' }, '$totalCopies'] };
    }
    return this.collection.find(filter).sort({ title: 1, _id: 1 }).toArray();
  }

  findById(id) {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  async create(data, now) {
    const book = { ...data, loans: [], createdAt: now, updatedAt: now };
    const { insertedId } = await this.collection.insertOne(book);
    return { ...book, _id: insertedId };
  }

  update(id, fields, now) {
    const filter = { _id: new ObjectId(id) };
    // Умова і запис атомарні: видача не може обійти перевірку кількості.
    if (fields.totalCopies !== undefined) filter.$expr = { $lte: [{ $size: '$loans' }, fields.totalCopies] };
    return this.collection.findOneAndUpdate(filter, { $set: { ...fields, updatedAt: now } }, { returnDocument: 'after' });
  }

  delete(id) {
    return this.collection.findOneAndDelete({ _id: new ObjectId(id), loans: { $size: 0 } });
  }

  addLoan(id, loan, now) {
    return this.collection.findOneAndUpdate({
      _id: new ObjectId(id),
      'loans.readerId': { $ne: loan.readerId },
      $expr: { $lt: [{ $size: '$loans' }, '$totalCopies'] },
    }, { $push: { loans: loan }, $set: { updatedAt: now } }, { returnDocument: 'after' });
  }

  removeLoan(id, loanId, now) {
    // Повертаємо попередній документ, щоб отримати саме видалену видачу.
    return this.collection.findOneAndUpdate({ _id: new ObjectId(id), 'loans.id': loanId },
      { $pull: { loans: { id: loanId } }, $set: { updatedAt: now } }, { returnDocument: 'before' });
  }

  findLoans({ overdue = false, now }) {
    const pipeline = [{ $unwind: '$loans' }];
    if (overdue) pipeline.push({ $match: { 'loans.dueAt': { $lt: now } } });
    pipeline.push({ $sort: { 'loans.dueAt': 1, 'loans.id': 1 } }, {
      $project: { _id: 0, bookId: { $toString: '$_id' }, title: 1, loan: '$loans' },
    });
    return this.collection.aggregate(pipeline).toArray();
  }

  async statistics(now) {
    const [result] = await this.collection.aggregate([{
      $group: {
        _id: null, titles: { $sum: 1 }, totalCopies: { $sum: '$totalCopies' },
        borrowedCopies: { $sum: { $size: '$loans' } },
        overdueLoans: { $sum: { $size: { $filter: { input: '$loans', as: 'loan', cond: { $lt: ['$$loan.dueAt', now] } } } } },
      },
    }, { $project: { _id: 0 } }]).toArray();
    const stats = result ?? { titles: 0, totalCopies: 0, borrowedCopies: 0, overdueLoans: 0 };
    return { ...stats, availableCopies: stats.totalCopies - stats.borrowedCopies };
  }

}
