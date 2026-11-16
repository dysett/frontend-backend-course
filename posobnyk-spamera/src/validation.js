import { ObjectId } from 'mongodb';
import isEmail from 'validator/lib/isEmail.js';
import { HttpError } from './errors.js';

export function objectId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw new HttpError(400, 'Некоректний ідентифікатор.');
  }
  return new ObjectId(value);
}

export function contactInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Потрібні дані контакту.');
  const fields = {};
  const contact = {};
  for (const [key, label] of Object.entries({ lastName: 'Прізвище', firstName: "Ім’я", middleName: 'По батькові' })) {
    const value = typeof input[key] === 'string' ? input[key].trim().normalize('NFC') : '';
    if (!value || value.length > 80 || !/^[\p{L}\p{M}][\p{L}\p{M} '’ʼ-]*$/u.test(value)) {
      fields[key] = `${label}: введіть від 1 до 80 символів, використовуючи літери, пробіли, апостроф або дефіс.`;
    }
    contact[key] = value;
  }
  contact.email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!isEmail(contact.email, { allow_utf8_local_part: false }) || contact.email.length > 254) {
    fields.email = 'Введіть коректну електронну адресу.';
  }
  if (Object.keys(fields).length) throw new HttpError(400, 'Перевірте поля форми.', fields);
  return contact;
}

export function messageInput(input, templates) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Потрібні дані розсилки.');
  let subject = input.subject;
  let text = input.text;
  if (input.templateId) {
    const template = templates.find(item => item.id === input.templateId);
    if (!template) throw new HttpError(400, 'Шаблон повідомлення не знайдено.');
    ({ subject, text } = template);
  }
  if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 160 || /[\r\n\x00]/.test(subject)) {
    throw new HttpError(400, 'Тема має містити від 1 до 160 символів без перенесень рядків.');
  }
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 10000 || text.includes('\0')) {
    throw new HttpError(400, 'Текст має містити від 1 до 10 000 символів.');
  }
  if (!['all', 'selected'].includes(input.audience)) throw new HttpError(400, 'Виберіть одержувачів.');
  let recipientIds = [];
  if (input.audience === 'selected') {
    if (!Array.isArray(input.recipientIds) || !input.recipientIds.length) throw new HttpError(400, 'Виберіть хоча б одного одержувача.');
    recipientIds = [...new Set(input.recipientIds.map(id => objectId(id).toHexString()))];
  }
  return { subject: subject.trim(), text: text.trim(), templateId: input.templateId || null, audience: input.audience, recipientIds };
}
