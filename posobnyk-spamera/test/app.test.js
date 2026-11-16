import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SMTPServer } from 'smtp-server';
import pug from 'pug';
import { readConfig, projectRoot } from '../src/config.js';
import { connectDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/services/mailer.js';
import { sampleContacts } from '../src/data/sample-contacts.js';
import { templates } from '../src/data/templates.js';

let mongo, client, db, server, root, base, application;
let failEmail = null;
let blockSend = null;
let enteredSend = null;
let config;
const message = { audience: 'all', subject: 'Test message', text: 'Hello from the integration test.' };
async function start(app) {
  return new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
}
async function request(url, method = 'GET', body, headers = {}) {
  const response = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'lystonosha-tests-'));
  mongo = await MongoMemoryServer.create();
  config = { ...readConfig({ MAIL_MODE: 'preview' }), mongoUri: mongo.getUri(), dbName: 'integration', outboxDir: path.join(root, 'outbox') };
  ({ client, db } = await connectDatabase(config));
  const realMailer = createMailer(config);
  const mailer = {
    async send(contact, draft, id) {
      if (enteredSend) enteredSend();
      if (blockSend) await blockSend;
      if (contact.email === failEmail) throw new Error('Intentional test failure');
      return realMailer.send(contact, draft, id);
    },
    close() { realMailer.close(); }
  };
  application = createApp({ db, config, mailer });
  server = await start(application.app);
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  failEmail = null; blockSend = null; enteredSend = null;
  await db.collection('contacts').deleteMany({});
  await db.collection('campaigns').deleteMany({});
  await application.contacts.seed(sampleContacts);
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  application?.mailer.close();
  await client?.close(); await mongo?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

test('MongoDB health and static Bootstrap assets are available', async () => {
  assert.deepEqual((await request('/api/health')).body, { status: 'ok', database: 'MongoDB' });
  for (const url of ['/', '/app.js', '/styles.css', '/vendor/bootstrap/css/bootstrap.min.css', '/vendor/icons/bootstrap-icons.min.css']) {
    assert.equal((await fetch(base + url)).status, 200, url);
  }
});
test('contacts use Ukrainian alphabetical ordering', async () => {
  const { body } = await request('/api/contacts');
  assert.equal(body.length, 8);
  assert.deepEqual(body.map(c => c.lastName), ['Бондаренко', 'Іваненко', 'Коваленко', 'Мельник', 'Петренко', 'Савченко', 'Ткаченко', 'Шевченко']);
});
test('Pug renders MongoDB contacts and template cards on the server', async () => {
  const response = await fetch(base + '/');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<!DOCTYPE html>/i);
  assert.ok(html.includes('maria.bondarenko@example.com'));
  assert.ok(html.includes('Вітальний лист'));
  assert.ok(html.indexOf('Бондаренко Марія') < html.indexOf('Шевченко Анна'));
  assert.equal((html.match(/class="form-check-input contact-check"/g) || []).length, 8);
  assert.ok(!html.includes('SMTP_PASS'));
});
test('create, update, read and delete a contact stored in MongoDB', async () => {
  const contact = { lastName: 'Їжак', firstName: 'Мар’яна', middleName: 'Ігорівна', email: ' NEW@example.com ' };
  const created = await request('/api/contacts', 'POST', contact);
  assert.equal(created.status, 201); assert.equal(created.body.email, 'new@example.com');
  assert.ok(await db.collection('contacts').findOne({ email: 'new@example.com' }));
  const updated = await request(`/api/contacts/${created.body._id}`, 'PUT', { ...contact, firstName: 'Анна', email: 'updated@example.com' });
  assert.equal(updated.status, 200); assert.equal(updated.body.firstName, 'Анна');
  assert.equal((await request(`/api/contacts/${created.body._id}`, 'DELETE')).status, 204);
  assert.equal((await request('/api/contacts')).body.length, 8);
});
test('duplicate email is rejected for both creation and editing', async () => {
  const existing = (await request('/api/contacts')).body;
  assert.equal((await request('/api/contacts', 'POST', { ...sampleContacts[0], email: sampleContacts[0].email.toUpperCase() })).status, 409);
  const edited = { ...existing[1], email: existing[0].email };
  assert.equal((await request(`/api/contacts/${existing[1]._id}`, 'PUT', edited)).status, 409);
});
test('validation rejects empty fields, email injection and markup', async () => {
  for (const change of [{ middleName: '' }, { email: 'a@example.com\r\nBcc: x@example.com' }, { lastName: '<script>alert(1)</script>' }, { firstName: { $ne: null } }]) {
    const result = await request('/api/contacts', 'POST', { ...sampleContacts[0], ...change });
    assert.equal(result.status, 400); assert.ok(result.body.fields);
  }
  assert.equal(await db.collection('contacts').countDocuments(), 8);
});
test('invalid identifiers and missing records have meaningful HTTP statuses', async () => {
  assert.equal((await request('/api/contacts/nope', 'DELETE')).status, 400);
  assert.equal((await request('/api/contacts/000000000000000000000000', 'DELETE')).status, 404);
  assert.equal((await request('/api/campaigns/000000000000000000000000')).status, 404);
});
test('cross-site requests and malformed JSON are rejected', async () => {
  assert.equal((await request('/api/contacts', 'POST', sampleContacts[0], { Origin: 'https://unrelated.example' })).status, 403);
  const bad = await fetch(`${base}/api/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
});
test('custom message produces one downloadable .eml for each selected recipient', async () => {
  const contacts = (await request('/api/contacts')).body;
  const recipientIds = [contacts[0]._id, contacts[1]._id, contacts[0]._id];
  const result = await request('/api/campaigns', 'POST', { ...message, audience: 'selected', recipientIds });
  assert.equal(result.status, 201); assert.equal(result.body.total, 2); assert.equal(result.body.succeeded, 2);
  assert.equal(result.body.status, 'completed'); assert.equal(result.body.mode, 'preview');
  for (const recipient of result.body.recipients) {
    const response = await fetch(`${base}/api/campaigns/${result.body._id}/messages/${recipient.contactId}`);
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.ok(raw.includes(recipient.email)); assert.ok(raw.includes(message.text));
    assert.ok(!raw.includes(result.body.recipients.find(r => r.email !== recipient.email).email));
    assert.match(raw, /Subject: Test message/); assert.match(raw, /Content-Type: text\/plain/);
    assert.match(raw, /Content-Type: multipart\/alternative/); assert.match(raw, /Content-Type: text\/html/);
  }
});
test('Pug email template escapes custom text and subject', () => {
  const html = pug.renderFile(path.join(projectRoot, 'views/emails/message.pug'), { subject: '<script>alert(1)</script>', text: '<img src=x onerror=alert(1)>\n\nЗвичайний текст' });
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img '));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('Звичайний текст'));
});
test('predefined template is used and all recipients are processed', async () => {
  const result = await request('/api/campaigns', 'POST', { audience: 'all', templateId: 'welcome' });
  assert.equal(result.status, 201); assert.equal(result.body.total, 8); assert.equal(result.body.succeeded, 8);
  assert.equal(result.body.text, templates[0].text); assert.equal(result.body.subject, templates[0].subject);
  assert.equal((await request('/api/campaigns')).body.length, 1);
  assert.equal((await request(`/api/campaigns/${result.body._id}`)).body.recipients.length, 8);
});
test('empty message, invalid template, missing recipients and deleted contacts are rejected before sending', async () => {
  for (const draft of [{ ...message, text: '' }, { ...message, subject: 'bad\r\nheader' }, { ...message, templateId: 'missing' },
    { ...message, audience: 'selected', recipientIds: [] }, { ...message, audience: 'selected', recipientIds: ['000000000000000000000000'] }]) {
    assert.equal((await request('/api/campaigns', 'POST', draft)).status, 400);
  }
  await db.collection('contacts').deleteMany({});
  assert.equal((await request('/api/campaigns', 'POST', message)).status, 400);
  assert.equal(await db.collection('campaigns').countDocuments(), 0);
});
test('one failed recipient does not prevent remaining deliveries', async () => {
  failEmail = sampleContacts[0].email;
  const result = await request('/api/campaigns', 'POST', message);
  assert.equal(result.status, 201); assert.equal(result.body.status, 'partial');
  assert.equal(result.body.succeeded, 7); assert.equal(result.body.failed, 1);
  assert.equal(result.body.recipients.find(r => r.email === failEmail).status, 'failed');
});
test('another send request is rejected while a campaign is running', async () => {
  let release, markEntered;
  blockSend = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { markEntered = resolve; });
  enteredSend = markEntered;
  const pending = request('/api/campaigns', 'POST', message);
  await entered;
  try { assert.equal((await request('/api/campaigns', 'POST', message)).status, 409); }
  finally { release(); }
  assert.equal((await pending).body.status, 'completed');
});
test('deleting a contact preserves campaign snapshots and downloadable messages', async () => {
  const campaign = (await request('/api/campaigns', 'POST', message)).body;
  const recipient = campaign.recipients[0];
  assert.equal((await request(`/api/contacts/${recipient.contactId}`, 'DELETE')).status, 204);
  assert.equal(await db.collection('contacts').countDocuments(), 7);
  assert.equal((await request(`/api/campaigns/${campaign._id}`)).body.recipients[0].email, recipient.email);
  assert.equal((await fetch(`${base}/api/campaigns/${campaign._id}/messages/${recipient.contactId}`)).status, 200);
});
test('reconnect to MongoDB preserves contacts and interrupted jobs are marked without resending', async () => {
  await application.campaigns.create({ status: 'sending', subject: 'Interrupted', total: 8, succeeded: 2, failed: 0, createdAt: new Date(), recipients: [] });
  const connection = await connectDatabase(config);
  try { assert.equal(await connection.db.collection('contacts').countDocuments(), 8); }
  finally { await connection.client.close(); }
  await application.campaigns.recoverInterrupted();
  assert.equal((await request('/api/campaigns')).body[0].status, 'interrupted');
});
test('seed is idempotent and leaves user edits intact', async () => {
  const existing = (await request('/api/contacts')).body[0];
  await request(`/api/contacts/${existing._id}`, 'PUT', { ...existing, firstName: 'Леся' });
  await application.contacts.seed(sampleContacts);
  assert.equal(await db.collection('contacts').countDocuments(), 8);
  assert.equal((await db.collection('contacts').findOne({ email: existing.email })).firstName, 'Леся');
});
test('real SMTP transport sends separate envelopes and records rejected recipients', async () => {
  const received = [];
  const smtp = new SMTPServer({
    authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], logger: false,
    onRcptTo(address, session, callback) {
      if (address.address === sampleContacts[0].email) return callback(Object.assign(new Error('Rejected by test SMTP'), { responseCode: 550 }));
      callback();
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', chunk => { raw += chunk.toString(); });
      stream.on('end', () => { received.push({ raw, recipients: session.envelope.rcptTo.map(r => r.address) }); callback(); });
    }
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  const smtpConfig = { ...config, mailMode: 'smtp', smtp: { host: '127.0.0.1', port: smtp.server.address().port, secure: false, requireTLS: false } };
  const smtpApp = createApp({ db, config: smtpConfig });
  const listener = await start(smtpApp.app);
  try {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
    const result = await response.json();
    assert.equal(response.status, 201); assert.equal(result.mode, 'smtp');
    assert.equal(result.status, 'partial'); assert.equal(result.succeeded, 7); assert.equal(result.failed, 1);
    assert.equal(received.length, 7);
    for (const email of received) { assert.equal(email.recipients.length, 1); assert.ok(email.raw.includes(message.text)); }
    const contacts = await application.contacts.list();
    const response2 = await fetch(`http://127.0.0.1:${listener.address().port}/api/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience: 'selected', recipientIds: [String(contacts[0]._id)], templateId: 'meeting' }) });
    const result2 = await response2.json();
    assert.equal(result2.status, 'completed'); assert.equal(result2.subject, templates[1].subject);
    assert.equal(received.length, 8);
  } finally {
    await new Promise(resolve => listener.close(resolve)); smtpApp.mailer.close(); await new Promise(resolve => smtp.close(resolve));
  }
});
