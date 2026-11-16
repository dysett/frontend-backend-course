import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, invalid } from '../errors.js';
const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw invalid('Пароль має містити від 12 до 128 символів.');
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: (await scrypt(password, salt, 64)).toString('hex') };
}

export class AuthService {
  constructor(dao) { this.dao = dao; }
  async createAdmin(username, password) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,40}$/.test(username)) throw invalid('Логін: 3–40 латинських літер, цифр, дефісів або підкреслень.');
    if (await this.dao.findByUsername(username)) throw new AppError(409, 'ADMIN_EXISTS', 'Адміністратор уже існує.');
    await this.dao.create({ username, ...await hashPassword(password), createdAt: new Date() });
  }
  async authenticate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['username', 'password'].includes(key)) ||
        typeof body.username !== 'string' || !/^[a-zA-Z0-9_-]{3,40}$/.test(body.username) || typeof body.password !== 'string' || body.password.length > 128) throw invalid('Укажіть коректний логін і пароль.');
    const admin = await this.dao.findByUsername(body.username);
    // Однакова дорога операція для невідомого логіна та неправильного пароля.
    const actual = await scrypt(body.password, admin?.salt ?? '00000000000000000000000000000000', 64);
    const expected = Buffer.from(admin?.passwordHash ?? '00'.repeat(64), 'hex');
    if (!admin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError(401, 'INVALID_CREDENTIALS', 'Неправильний логін або пароль.');
    return { username: admin.username, role: 'admin' };
  }
}
