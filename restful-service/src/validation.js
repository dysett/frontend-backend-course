import { invalid } from './errors.js';

function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Тіло запиту має бути JSON-об’єктом.');
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw invalid(`Невідомі поля: ${unknown.join(', ')}.`);
}

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw invalid(`${name}: потрібен непорожній рядок довжиною до ${max} символів.`);
  }
  return value.trim();
}

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${name}: потрібне ціле число від ${min} до ${max}.`);
  return value;
}

function isbn13(value) {
  const isbn = text(value, 'isbn', 32).replace(/[ -]/g, '');
  if (!/^97[89]\d{10}$/.test(isbn)) throw invalid('isbn: потрібен ISBN-13 із префіксом 978 або 979.');
  const sum = [...isbn].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  if (sum % 10 !== 0) throw invalid('isbn: неправильна контрольна цифра ISBN-13.');
  return isbn;
}

export function bookInput(body, { partial = false, now = new Date() } = {}) {
  const fields = ['title', 'author', 'isbn', 'publicationYear', 'genre', 'totalCopies'];
  object(body, fields);
  if (!partial && fields.some(field => !Object.hasOwn(body, field))) throw invalid(`Обов’язкові поля: ${fields.join(', ')}.`);
  if (partial && !Object.keys(body).length) throw invalid('Передайте хоча б одне поле для оновлення.');
  const result = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) continue;
    if (field === 'isbn') result[field] = isbn13(body[field]);
    else if (field === 'publicationYear') result[field] = integer(body[field], field, 1, now.getUTCFullYear());
    else if (field === 'totalCopies') result[field] = integer(body[field], field, 1, 100);
    else result[field] = text(body[field], field, field === 'genre' ? 80 : 200);
  }
  return result;
}

export function bookId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw invalid('ID книжки має містити 24 шістнадцяткові символи.');
  return value;
}

export function loanId(value) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw invalid('ID видачі має бути UUID v4.');
  return value;
}

export function loanInput(body) {
  object(body, ['readerId', 'days']);
  const readerId = text(body.readerId, 'readerId', 64);
  if (!/^[\p{L}\p{N}_-]+$/u.test(readerId)) throw invalid('readerId може містити літери, цифри, дефіс і підкреслення.');
  return { readerId, days: body.days === undefined ? 14 : integer(body.days, 'days', 1, 30) };
}

export function bookQuery(query) {
  object(query, ['q', 'genre', 'available']);
  const result = {};
  if (query.q !== undefined) result.q = text(query.q, 'q', 100);
  if (query.genre !== undefined) result.genre = text(query.genre, 'genre', 80);
  if (query.available !== undefined) result.available = booleanQuery(query.available, 'available');
  return result;
}

export function overdueQuery(query) {
  object(query, ['overdue']);
  return query.overdue === undefined ? false : booleanQuery(query.overdue, 'overdue');
}

function booleanQuery(value, name) {
  if (value !== 'true' && value !== 'false') throw invalid(`${name}: дозволені лише true або false.`);
  return value === 'true';
}
