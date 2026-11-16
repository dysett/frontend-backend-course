import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../errors.js';
import { bookId, bookInput, bookQuery, loanId, loanInput, overdueQuery } from '../validation.js';

function bookView(book) {
  const { _id, loans, ...fields } = book;
  return { id: _id.toHexString(), ...fields, borrowedCopies: loans.length, availableCopies: book.totalCopies - loans.length };
}

function loanView(loan, now) {
  return { ...loan, overdue: loan.dueAt < now };
}

export class BookService {
  constructor(dao, clock = () => new Date()) {
    this.dao = dao;
    this.clock = clock;
  }

  async requireBook(id) {
    const book = await this.dao.findById(bookId(id));
    if (!book) throw notFound();
    return book;
  }

  async list(query) {
    return (await this.dao.findAll(bookQuery(query))).map(bookView);
  }

  async get(id) { return bookView(await this.requireBook(id)); }

  async create(body) {
    const now = this.clock();
    return bookView(await this.dao.create(bookInput(body, { now }), now));
  }

  async update(id, body, partial) {
    bookId(id);
    const now = this.clock();
    const fields = bookInput(body, { partial, now });
    const book = await this.dao.update(id, fields, now);
    if (!book) {
      await this.requireBook(id);
      throw new AppError(409, 'COPIES_IN_USE', 'Кількість примірників не може бути меншою за кількість виданих.');
    }
    return bookView(book);
  }

  async delete(id) {
    bookId(id);
    const book = await this.dao.delete(id);
    if (!book) {
      await this.requireBook(id);
      throw new AppError(409, 'ACTIVE_LOANS', 'Спочатку поверніть усі видані примірники.');
    }
    return { id, deleted: true };
  }

  async borrow(id, body) {
    bookId(id);
    const { readerId, days } = loanInput(body);
    const now = this.clock();
    const loan = { id: randomUUID(), readerId, borrowedAt: now, dueAt: new Date(now.getTime() + days * 86400000) };
    const book = await this.dao.addLoan(id, loan, now);
    if (!book) {
      const current = await this.requireBook(id);
      if (current.loans.some(item => item.readerId === readerId)) {
        throw new AppError(409, 'ALREADY_BORROWED', 'Цей читач уже має примірник цієї книжки.');
      }
      throw new AppError(409, 'NO_COPIES_AVAILABLE', 'Немає вільних примірників.');
    }
    return { ...loanView(loan, now), bookId: id };
  }

  async loans(id) {
    const book = await this.requireBook(id);
    const now = this.clock();
    return book.loans.map(loan => ({ ...loanView(loan, now), bookId: id }));
  }

  async loan(id, value) {
    loanId(value);
    const loans = await this.loans(id);
    const loan = loans.find(item => item.id === value);
    if (!loan) throw new AppError(404, 'LOAN_NOT_FOUND', 'Активну видачу не знайдено.');
    return loan;
  }

  async returnLoan(id, value) {
    bookId(id);
    loanId(value);
    const now = this.clock();
    const before = await this.dao.removeLoan(id, value, now);
    if (!before) {
      await this.requireBook(id);
      throw new AppError(404, 'LOAN_NOT_FOUND', 'Активну видачу не знайдено або примірник уже повернуто.');
    }
    const loan = before.loans.find(item => item.id === value);
    return { ...loanView(loan, now), bookId: id, returnedAt: now };
  }

  async allLoans(query) {
    const overdue = overdueQuery(query);
    const now = this.clock();
    return (await this.dao.findLoans({ overdue, now })).map(({ loan, ...book }) => ({ ...loanView(loan, now), ...book }));
  }

  statistics() { return this.dao.statistics(this.clock()); }
}
