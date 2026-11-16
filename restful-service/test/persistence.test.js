import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

test('WiredTiger зберігає книжку та видачу після перезапуску процесу MongoDB', async () => {
  const dbPath = await mkdtemp(path.join(os.tmpdir(), 'restful-persistence-'));
  let mongo, client, server;
  async function start() {
    mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
    const connection = await connectDatabase({ mongoUri: mongo.getUri(), dbName: 'persistence_test' });
    client = connection.client;
    const app = createApp({ db: connection.db });
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
    const created = await fetch(`${url}/api/books`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        title: 'Persistent Book', author: 'Test Author', isbn: '9780132350884',
        publicationYear: 2008, genre: 'Тестування', totalCopies: 2,
      }),
    });
    assert.equal(created.status, 201);
    const { data: book } = await created.json();
    const borrowed = await fetch(`${url}/api/books/${book.id}/loans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readerId: 'reader-1' }),
    });
    assert.equal(borrowed.status, 201);
    const { data: loan } = await borrowed.json();
    await stop();
    url = await start();
    const response = await fetch(`${url}/api/books/${book.id}`);
    const persisted = await response.json();
    assert.equal(response.status, 200, JSON.stringify(persisted));
    assert.equal(persisted.data.title, 'Persistent Book');
    assert.equal(persisted.data.borrowedCopies, 1);
    assert.equal(persisted.data.availableCopies, 1);
    const active = await (await fetch(`${url}/api/books/${book.id}/loans/${loan.id}`)).json();
    assert.equal(active.data.readerId, 'reader-1');
  } finally {
    await stop();
    // Каталог створений цим тестом через mkdtemp; робочі дані не зачіпаються.
    assert.ok(path.resolve(dbPath).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dbPath, { recursive: true, force: true });
  }
});
