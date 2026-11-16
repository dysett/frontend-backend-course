import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function integer(value, fallback, min, max, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name}: очікується ціле число від ${min} до ${max}.`);
  }
  return parsed;
}

export function readConfig(env = process.env) {
  const mailMode = env.MAIL_MODE || 'preview';
  if (!['preview', 'smtp'].includes(mailMode)) throw new Error('MAIL_MODE має бути preview або smtp.');
  if (mailMode === 'smtp' && !env.SMTP_HOST) throw new Error('Задайте SMTP_HOST у .env.');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) throw new Error('Задайте разом SMTP_USER і SMTP_PASS.');
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env.PORT, 3000, 0, 65535, 'PORT'),
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
    dbName: env.MONGODB_DB || 'posobnyk_spamera',
    mailMode,
    mailFrom: env.MAIL_FROM || 'Листоноша <sender@example.com>',
    outboxDir: path.join(projectRoot, 'outbox'),
    maxRecipients: integer(env.MAX_RECIPIENTS, 200, 1, 10000, 'MAX_RECIPIENTS'),
    smtp: {
      host: env.SMTP_HOST,
      port: integer(env.SMTP_PORT, 587, 1, 65535, 'SMTP_PORT'),
      secure: env.SMTP_SECURE === 'true',
      requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    }
  };
}
