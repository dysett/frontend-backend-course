import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { AdminDAO } from '../src/dao/admin-dao.js';
import { AuthService } from '../src/services/auth-service.js';
import { browserClient, testAuth, testCredentials } from './helpers.js';

test('WiredTiger зберігає книжку та видачу після перезапуску процесу MongoDB', async () => {
  const dbPath = await mkdtemp(path.join(os.tmpdir(), 'restful-persistence-'));
  let mongo, client, server, browser, db;
  async function start() {
    mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
    const connection = await connectDatabase({ mongoUri: mongo.getUri(), dbName: 'persistence_test' });
    client = connection.client;
    db = connection.db;
    const admins = new AdminDAO(db);
    if (!await admins.findByUsername(testCredentials.username)) await new AuthService(admins).createAdmin(testCredentials.username, testCredentials.password);
    const app = createApp({ db, auth: testAuth });
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server) { await new Promise(resolve => server.close(resolve)); server = undefined; }
    await client?.close(); client = undefined;
    await mongo?.stop({ doCleanup: false }); mongo = undefined;
  }
  try {
    let url = await start();
    browser = browserClient(url);
    await browser.login();
    const cookie = browser.cookie;
    const created = await browser.request('POST', '/api/books', {
        title: 'Persistent Book', author: 'Test Author', isbn: '9780132350884',
        publicationYear: 2008, genre: 'Тестування', totalCopies: 2,
    });
    assert.equal(created.status, 201);
    const { data: book } = created;
    const borrowed = await browser.request('POST', `/api/books/${book.id}/loans`, { readerId: 'reader-1' });
    assert.equal(borrowed.status, 201);
    const { data: loan } = borrowed;
    await stop();
    url = await start();
    const response = await fetch(`${url}/api/books/${book.id}`);
    const persisted = await response.json();
    assert.equal(response.status, 200, JSON.stringify(persisted));
    assert.equal(persisted.data.title, 'Persistent Book');
    assert.equal(persisted.data.borrowedCopies, 1);
    assert.equal(persisted.data.availableCopies, 1);
    const active = await (await fetch(`${url}/api/books/${book.id}/loans/${loan.id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(active.data.readerId, 'reader-1');
    const session = await (await fetch(`${url}/api/auth/session`, { headers: { Cookie: cookie } })).json();
    assert.equal(session.data.user.username, testCredentials.username);
  } finally {
    await stop();
    // Каталог створений цим тестом через mkdtemp; робочі дані не зачіпаються.
    assert.ok(path.resolve(dbPath).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dbPath, { recursive: true, force: true });
  }
});
