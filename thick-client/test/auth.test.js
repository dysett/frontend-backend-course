import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/db.js';
import { AdminDAO } from '../src/dao/admin-dao.js';
import { AuthService } from '../src/services/auth-service.js';
import { browserClient, testAuth, testCredentials } from './helpers.js';

let mongo, client, db, server, baseUrl;
before(async () => {
  mongo = await MongoMemoryServer.create();
  ({ client, db } = await connectDatabase({ mongoUri: mongo.getUri(), dbName: 'thick_client_auth_test' }));
  await new AuthService(new AdminDAO(db)).createAdmin(testCredentials.username, testCredentials.password);
  const app = createApp({ db, auth: testAuth });
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await client?.close(); await mongo?.stop();
});

test('Каталог відкритий, усі зміни та персональні дані видач потребують входу', async () => {
  const visitor = browserClient(baseUrl);
  for (const path of ['/api/books', '/api/statistics']) assert.equal((await visitor.request('GET', path)).status, 200);
  for (const [method, path] of [['POST', '/api/books'], ['PUT', '/api/books/000000000000000000000000'], ['PATCH', '/api/books/000000000000000000000000'], ['DELETE', '/api/books/000000000000000000000000'], ['POST', '/api/books/000000000000000000000000/loans'], ['DELETE', '/api/books/000000000000000000000000/loans/00000000-0000-4000-8000-000000000000'], ['GET', '/api/loans'], ['GET', '/api/books/000000000000000000000000/loans'], ['GET', '/api/books/000000000000000000000000/loans/00000000-0000-4000-8000-000000000000']]) {
    assert.equal((await visitor.request(method, path, ['POST', 'PUT', 'PATCH'].includes(method) ? {} : undefined)).status, 401, `${method} ${path}`);
  }
});

test('Вхід змінює ID сеансу й CSRF, cookie HttpOnly/SameSite, пароль лише як scrypt-хеш', async () => {
  const visitor = browserClient(baseUrl);
  const session = await visitor.request('GET', '/api/auth/session');
  const oldCookie = visitor.cookie, oldCsrf = visitor.csrf;
  assert.equal(session.data.user, null);
  assert.match(session.headers.get('set-cookie'), /HttpOnly/);
  assert.match(session.headers.get('set-cookie'), /SameSite=Strict/);
  const loggedIn = await visitor.request('POST', '/api/auth/login', testCredentials);
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.data.user.role, 'admin');
  assert.notEqual(visitor.cookie, oldCookie); assert.notEqual(visitor.csrf, oldCsrf);
  assert.equal((await visitor.request('GET', '/api/auth/session', undefined, { Cookie: oldCookie })).data.user, null);
  const admin = await db.collection('admins').findOne({ username: testCredentials.username });
  assert.equal(admin.password, undefined); assert.equal(admin.passwordHash.length, 128);
  assert.ok(!JSON.stringify(loggedIn.data).includes(admin.passwordHash));
});

test('Авторизації недостатньо без правильного CSRF; чужі Origin і Host відхиляються', async () => {
  const browser = browserClient(baseUrl); await browser.login();
  for (const token of ['', 'bad', 'é'.repeat(64)]) assert.equal((await browser.request('POST', '/api/books', {}, { 'X-CSRF-Token': token })).status, 403);
  const foreign = await browser.request('POST', '/api/books', {}, { Origin: 'https://foreign.invalid' });
  assert.equal(foreign.status, 403); assert.equal(foreign.error.code, 'ORIGIN_FORBIDDEN');
  // Fetch нормалізує Host; сирий HTTP-запит перевіряє фактичний недовірений заголовок.
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/api/books`, { headers: { Host: 'foreign.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(hostStatus, 403);
  const fresh = await browser.request('GET', '/api/auth/session');
  assert.ok(fresh.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.ok(!fresh.headers.get('content-security-policy').includes("'unsafe-inline'"));
  assert.equal(fresh.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(fresh.headers.get('cache-control'), 'no-store');
});

test('NoSQL-об’єкти у логіні/паролі відхиляються; помилка не розкриває наявності логіна', async () => {
  const browser = browserClient(baseUrl); await browser.request('GET', '/api/auth/session');
  for (const body of [{ username: { $ne: null }, password: 'x' }, { username: 'test_admin', password: { $ne: null } }]) assert.equal((await browser.request('POST', '/api/auth/login', body)).status, 400);
  const wrong = await browser.request('POST', '/api/auth/login', { ...testCredentials, password: 'wrong' });
  const unknown = await browser.request('POST', '/api/auth/login', { username: 'unknown_admin', password: 'wrong' });
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.error, unknown.error);
});

test('Вихід знищує сесію на сервері: повторне використання старої cookie неможливе', async () => {
  const browser = browserClient(baseUrl); await browser.login();
  const cookie = browser.cookie;
  assert.equal((await browser.request('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await browser.request('GET', '/api/loans', undefined, { Cookie: cookie })).status, 401);
  assert.equal((await browser.request('GET', '/api/auth/session', undefined, { Cookie: cookie })).data.user, null);
});

test('Абсолютні 30 хвилин сеансу не подовжуються фоновими запитами', async () => {
  const browser = browserClient(baseUrl); await browser.login();
  const doc = (await db.collection('sessions').find({}).toArray()).find(doc => JSON.parse(doc.session).user?.username === testCredentials.username);
  // Кілька тестових сеансів можуть належати одному користувачу; прострочуємо всі його сесії.
  assert.ok(doc);
  for (const record of await db.collection('sessions').find({}).toArray()) {
    const session = JSON.parse(record.session);
    if (!session.user) continue;
    session.authenticatedAt = Date.now() - 31 * 60 * 1000;
    await db.collection('sessions').updateOne({ _id: record._id }, { $set: { session: JSON.stringify(session) } });
  }
  const expired = await browser.request('GET', '/api/loans');
  assert.equal(expired.status, 401); assert.equal(expired.error.code, 'SESSION_EXPIRED');
  assert.equal((await browser.request('GET', '/api/auth/session')).data.user, null);
});

test('Ліміт невдалих входів зупиняє повторний перебір паролів', async () => {
  const browser = browserClient(baseUrl); await browser.request('GET', '/api/auth/session');
  let last;
  for (let i = 0; i < 12; i++) last = await browser.request('POST', '/api/auth/login', { ...testCredentials, password: 'wrong' });
  assert.equal(last.status, 429); assert.equal(last.error.code, 'TOO_MANY_ATTEMPTS');
  assert.ok(last.headers.get('retry-after'));
});
