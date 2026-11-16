import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/db.js';
import { AdminDAO } from '../src/dao/admin-dao.js';
import { AuthService } from '../src/services/auth-service.js';
const config = readConfig();
if (!config.adminPassword) throw new Error('Задайте ADMIN_PASSWORD у .env (12–128 символів).');
const { client, db } = await connectDatabase(config);
try {
  await new AuthService(new AdminDAO(db)).createAdmin(config.adminUsername, config.adminPassword);
  console.log('Адміністратора створено. Пароль збережено як scrypt-хеш із випадковою сіллю.');
} finally { await client.close(); }
