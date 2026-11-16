import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedBooks } from '../scripts/seed-data.js';

let mongo, client, db, server, baseUrl;
let now = new Date('2026-11-11T10:00:00.000Z');
const initialTime = () => new Date('2026-11-11T10:00:00.000Z');
const sample = (fields = {}) => ({
  title: 'Clean Code', author: 'Robert C. Martin', isbn: '9780132350884',
  publicationYear: 2008, genre: 'Програмування', totalCopies: 2, ...fields,
});

async function request(method, url, body, headers = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.match(response.headers.get('content-type'), /application\/json/);
  const json = await response.json();
  return { status: response.status, headers: response.headers, ...json };
}

async function create(fields) {
  const response = await request('POST', '/api/books', sample(fields));
  assert.equal(response.status, 201);
  return response.data;
}

before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } });
  ({ client, db } = await connectDatabase({ mongoUri: mongo.getUri(), dbName: 'restful_library_test' }));
  const app = createApp({ db, clock: () => new Date(now) });
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  now = initialTime();
  await db.collection('books').deleteMany({});
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await client?.close();
  await mongo?.stop();
});

test('Головна сторінка віддає інтерфейс, статичні ресурси та окремий JSON API', async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /lang="uk"/);
  assert.match(html, /Додати книжку/);
  for (const asset of ['/assets/styles.css', '/assets/app.js']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 100);
  }
  assert.equal((await request('GET', '/api')).data, undefined);
  assert.equal((await request('GET', '/api')).name, 'RESTful Library Service');
  assert.equal((await request('GET', '/api/books')).status, 200);
});

test('Повний CRUD, PUT і PATCH, JSON та Location', async () => {
  assert.deepEqual((await request('GET', '/api/books')).data, []);
  const created = await request('POST', '/api/books', sample());
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.headers.get('location'), `/api/books/${id}`);
  assert.equal(created.data.availableCopies, 2);
  assert.equal(created.data.createdAt, now.toISOString());
  assert.equal((await request('GET', `/api/books/${id}`)).data.title, 'Clean Code');
  assert.equal((await request('GET', '/api/books')).meta.count, 1);
  const replaced = await request('PUT', `/api/books/${id}`, sample({ title: 'Нова назва', totalCopies: 3 }));
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.totalCopies, 3);
  const updated = await request('PATCH', `/api/books/${id}`, { genre: 'Тестування' });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.title, 'Нова назва');
  assert.equal(updated.data.genre, 'Тестування');
  assert.equal((await request('DELETE', `/api/books/${id}`)).data.deleted, true);
  assert.equal((await request('GET', `/api/books/${id}`)).status, 404);
});

test('ISBN нормалізується, унікальність забезпечується індексом', async () => {
  const book = await create({ isbn: '978-0-13-235088-4', title: '  Clean Code  ' });
  assert.equal(book.isbn, '9780132350884');
  assert.equal(book.title, 'Clean Code');
  const response = await request('POST', '/api/books', sample());
  assert.equal(response.status, 409);
  assert.equal(response.error.code, 'DUPLICATE_ISBN');
  assert.equal(await db.collection('books').countDocuments(), 1);
});

test('Валідація типів, контрольної цифри ISBN та дозволених полів', async () => {
  const invalidBodies = [null, [], 5, {}, sample({ title: ' ' }), sample({ author: 10 }),
    sample({ isbn: '9780132350880' }), sample({ isbn: { $ne: null } }),
    sample({ totalCopies: 0 }), sample({ totalCopies: 101 }), sample({ totalCopies: '2' }),
    sample({ publicationYear: 2027 }), sample({ publicationYear: 1.5 }),
    sample({ loans: [] }), sample({ availableCopies: 999 }), sample({ genre: '' })];
  for (const body of invalidBodies) {
    const response = await request('POST', '/api/books', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(await db.collection('books').countDocuments(), 0);
  const book = await create();
  assert.equal((await request('PUT', `/api/books/${book.id}`, { title: 'Лише назва' })).status, 400);
  assert.equal((await request('PATCH', `/api/books/${book.id}`, {})).status, 400);
});

test('Помилки HTTP, некоректний JSON, невідомі маршрути й методи повертаються як JSON', async () => {
  assert.equal((await request('GET', '/api/health')).data.status, 'ok');
  assert.equal((await request('GET', '/missing')).error.code, 'ROUTE_NOT_FOUND');
  assert.equal((await request('GET', '/api/books/no-id')).status, 400);
  assert.equal((await request('GET', '/api/books/000000000000000000000000')).status, 404);
  const wrongMethod = await request('PATCH', '/api/books', {});
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.headers.get('allow'), /GET/);
  assert.equal((await request('OPTIONS', '/api/books')).status, 200);
  const unsupported = await fetch(`${baseUrl}/api/books`, { method: 'POST', body: 'hello', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  const malformed = await fetch(`${baseUrl}/api/books`, { method: 'POST', body: '{broken', headers: { 'Content-Type': 'application/json' } });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'VALIDATION_ERROR');
  const huge = await request('POST', '/api/books', { title: 'x'.repeat(33000) });
  assert.equal(huge.status, 413);
});

test('Пошук є буквальним; фільтри та параметри перевіряються', async () => {
  const book = await create({ totalCopies: 1 });
  await create({ title: 'Refactoring', author: 'Martin Fowler', isbn: '9780134757599', genre: 'Рефакторинг' });
  assert.equal((await request('GET', '/api/books?q=martin')).data.length, 2);
  assert.equal((await request('GET', '/api/books?q=.*')).data.length, 0);
  assert.equal((await request('GET', `/api/books?genre=${encodeURIComponent('Рефакторинг')}`)).data.length, 1);
  await request('POST', `/api/books/${book.id}/loans`, { readerId: 'reader-1' });
  assert.equal((await request('GET', '/api/books?available=true')).data.length, 1);
  assert.equal((await request('GET', '/api/books?available=false')).data[0].id, book.id);
  for (const query of ['available=1', 'q[x]=a', 'q=a&q=b', 'limit=2']) {
    assert.equal((await request('GET', `/api/books?${query}`)).status, 400);
  }
});

test('Видача, стандартний строк 14 діб та доступ до створеного підресурсу', async () => {
  const book = await create();
  const borrowed = await request('POST', `/api/books/${book.id}/loans`, { readerId: 'reader-1' });
  assert.equal(borrowed.status, 201);
  assert.equal(borrowed.data.dueAt, '2026-11-25T10:00:00.000Z');
  assert.equal(borrowed.data.overdue, false);
  const resource = borrowed.headers.get('location');
  assert.equal((await request('GET', resource)).data.id, borrowed.data.id);
  assert.equal((await request('GET', `/api/books/${book.id}/loans`)).data.length, 1);
  const state = (await request('GET', `/api/books/${book.id}`)).data;
  assert.equal(state.availableCopies, 1);
  assert.equal(state.borrowedCopies, 1);
});

test('Читач не може взяти ту саму книжку двічі; вільний фонд обмежений', async () => {
  const book = await create({ totalCopies: 1 });
  const route = `/api/books/${book.id}/loans`;
  assert.equal((await request('POST', route, { readerId: 'a', days: 1 })).status, 201);
  assert.equal((await request('POST', route, { readerId: 'a' })).error.code, 'ALREADY_BORROWED');
  assert.equal((await request('POST', route, { readerId: 'b' })).error.code, 'NO_COPIES_AVAILABLE');
});

test('Валідація видачі та ID підресурсів', async () => {
  const book = await create();
  for (const body of [{}, { readerId: ' ' }, { readerId: 'a b' }, { readerId: 'a', days: 0 },
    { readerId: 'a', days: 31 }, { readerId: 'a', days: '7' }, { readerId: 'a', dueAt: '2020-01-01' }]) {
    assert.equal((await request('POST', `/api/books/${book.id}/loans`, body)).status, 400);
  }
  assert.equal((await request('GET', `/api/books/${book.id}/loans/bad-id`)).status, 400);
  assert.equal((await request('GET', `/api/books/${book.id}/loans/00000000-0000-4000-8000-000000000000`)).status, 404);
  assert.equal((await request('POST', '/api/books/000000000000000000000000/loans', { readerId: 'a' })).status, 404);
});

test('Повернення звільняє примірник рівно один раз', async () => {
  const book = await create({ totalCopies: 1 });
  const loan = (await request('POST', `/api/books/${book.id}/loans`, { readerId: 'a', days: 7 })).data;
  const route = `/api/books/${book.id}/loans/${loan.id}`;
  const returned = await request('DELETE', route);
  assert.equal(returned.status, 200);
  assert.equal(returned.data.returnedAt, now.toISOString());
  assert.equal((await request('DELETE', route)).status, 404);
  assert.equal((await request('GET', route)).status, 404);
  assert.equal((await request('GET', `/api/books/${book.id}`)).data.availableCopies, 1);
  assert.deepEqual((await request('GET', '/api/loans')).data, []);
});

test('Заборона вилучення книжки й зменшення фонду нижче кількості виданих', async () => {
  const book = await create();
  for (const readerId of ['a', 'b']) await request('POST', `/api/books/${book.id}/loans`, { readerId });
  const updated = await request('PATCH', `/api/books/${book.id}`, { totalCopies: 1 });
  assert.equal(updated.status, 409);
  assert.equal(updated.error.code, 'COPIES_IN_USE');
  assert.equal((await request('DELETE', `/api/books/${book.id}`)).error.code, 'ACTIVE_LOANS');
  assert.equal((await request('PATCH', `/api/books/${book.id}`, { title: 'Змінена назва' })).status, 200);
  assert.equal((await request('GET', `/api/books/${book.id}`)).data.borrowedCopies, 2);
});

test('10 одночасних запитів можуть видати один примірник лише один раз', async () => {
  const book = await create({ totalCopies: 1 });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => request('POST', `/api/books/${book.id}/loans`, { readerId: `reader-${i}` })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 9);
  assert.equal((await request('GET', `/api/books/${book.id}`)).data.availableCopies, 0);
});

test('Одночасні видачі одному читачу не створюють дублікати', async () => {
  const book = await create({ totalCopies: 5 });
  const results = await Promise.all(Array.from({ length: 10 }, () => request('POST', `/api/books/${book.id}/loans`, { readerId: 'same-reader' })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.error?.code === 'ALREADY_BORROWED').length, 9);
});

test('Одночасні повернення не збільшують фонд повторно', async () => {
  const book = await create({ totalCopies: 1 });
  const loan = (await request('POST', `/api/books/${book.id}/loans`, { readerId: 'a' })).data;
  const results = await Promise.all(Array.from({ length: 10 }, () => request('DELETE', `/api/books/${book.id}/loans/${loan.id}`)));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 404).length, 9);
  assert.equal((await request('GET', `/api/books/${book.id}`)).data.availableCopies, 1);
});

test('Одночасна зміна фонду й видача зберігають кількісні обмеження', async () => {
  const book = await create({ totalCopies: 2 });
  await request('POST', `/api/books/${book.id}/loans`, { readerId: 'a' });
  const [updated, borrowed] = await Promise.all([
    request('PATCH', `/api/books/${book.id}`, { totalCopies: 1 }),
    request('POST', `/api/books/${book.id}/loans`, { readerId: 'b' }),
  ]);
  assert.ok((updated.status === 200 && borrowed.status === 409) || (updated.status === 409 && borrowed.status === 201));
  const final = (await request('GET', `/api/books/${book.id}`)).data;
  assert.ok(final.availableCopies >= 0);
  assert.equal(final.totalCopies, final.availableCopies + final.borrowedCopies);
});

test('Статистика та прострочення розраховуються за серверним часом', async () => {
  const first = await create({ totalCopies: 2 });
  const second = await create({ title: 'Refactoring', isbn: '9780134757599', totalCopies: 3 });
  await request('POST', `/api/books/${first.id}/loans`, { readerId: 'a', days: 1 });
  await request('POST', `/api/books/${second.id}/loans`, { readerId: 'b', days: 7 });
  now = new Date('2026-11-13T10:00:00.000Z');
  const overdue = await request('GET', '/api/loans?overdue=true');
  assert.equal(overdue.data.length, 1);
  assert.equal(overdue.data[0].bookId, first.id);
  assert.equal(overdue.data[0].overdue, true);
  assert.equal((await request('GET', '/api/loans?overdue=false')).data.length, 2);
  assert.equal((await request('GET', '/api/loans?overdue=yes')).status, 400);
  assert.deepEqual((await request('GET', '/api/statistics')).data, {
    titles: 2, totalCopies: 5, borrowedCopies: 2, overdueLoans: 1, availableCopies: 3,
  });
});

test('Порожня база має нульову статистику; seed повторно не змінює дані', async () => {
  assert.deepEqual((await request('GET', '/api/statistics')).data, {
    titles: 0, totalCopies: 0, borrowedCopies: 0, overdueLoans: 0, availableCopies: 0,
  });
  assert.equal(await seedBooks(db), 3);
  assert.equal(await seedBooks(db), 0);
  assert.equal((await request('GET', '/api/books')).data.length, 3);
});
