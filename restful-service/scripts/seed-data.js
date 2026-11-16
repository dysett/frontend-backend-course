import { BookDAO } from '../src/dao/book-dao.js';
import { BookService } from '../src/services/book-service.js';
import { sampleBooks } from '../src/data/sample-books.js';

export async function seedBooks(db) {
  const service = new BookService(new BookDAO(db));
  let inserted = 0;
  for (const book of sampleBooks) {
    try { await service.create(book); inserted++; }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  return inserted;
}
