import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { AdminDAO } from '../src/dao/admin-dao.js';
import { AuthService } from '../src/services/auth-service.js';
import { seedBooks } from './seed-data.js';
import { testAuth, testCredentials } from '../test/helpers.js';

const screenshots = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
let mongo, client, server, browser;
const checks = [];
const check = text => { checks.push(text); console.log(`OK: ${text}`); };
try {
  mongo = await MongoMemoryServer.create();
  const connection = await connectDatabase({ mongoUri: mongo.getUri(), dbName: 'thick_client_ui_test' });
  client = connection.client;
  await seedBooks(connection.db);
  await new AuthService(new AdminDAO(connection.db)).createAdmin(testCredentials.username, testCredentials.password);
  server = await new Promise(resolve => { const listener = createApp({ db: connection.db, auth: testAuth }).listen(0, '127.0.0.1', () => resolve(listener)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.UI_BROWSER === 'chromium' ? { headless: true } : { channel: 'chrome', headless: true });
  const visitorContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'uk-UA' });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'uk-UA' });
  const reader = await visitorContext.newPage(), admin = await adminContext.newPage();
  const errors = [], cspErrors = [];
  for (const page of [reader, admin]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/content security policy|violates.*directive/i.test(message.text())) cspErrors.push(message.text()); });
  }
  await mkdir(screenshots, { recursive: true });
  await reader.goto(url);
  await reader.locator('.book-card').first().waitFor();
  assert.equal(await reader.locator('.book-card').count(), 3);
  assert.equal(await reader.getByRole('button', { name: 'Додати книжку', exact: true }).count(), 0);
  await reader.screenshot({ path: `${screenshots}/catalog-desktop.png`, fullPage: true });
  check('Відкритий React-каталог, читач не має адміністративних кнопок');

  await admin.goto(url + '/admin');
  await admin.getByLabel('Логін', { exact: true }).fill(testCredentials.username);
  await admin.getByLabel('Пароль', { exact: true }).fill('wrong');
  await admin.getByRole('button', { name: 'Увійти', exact: true }).click();
  await admin.getByRole('alert').filter({ hasText: 'Неправильний логін або пароль' }).waitFor();
  await admin.getByLabel('Пароль', { exact: true }).fill(testCredentials.password);
  await admin.getByRole('button', { name: 'Увійти', exact: true }).click();
  await admin.getByRole('button', { name: 'Додати книжку', exact: true }).waitFor();
  await admin.reload();
  await admin.getByRole('button', { name: 'Додати книжку', exact: true }).waitFor();
  await admin.screenshot({ path: `${screenshots}/admin-desktop.png`, fullPage: true });
  check('Вхід, помилка пароля та відновлення сеансу після перезавантаження');

  const title = `AJAX перевірка ${Date.now()}`;
  const digits = '978' + String(Date.now()).slice(-9);
  const checksum = [...digits].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0);
  const isbn = digits + (10 - checksum % 10) % 10;
  await reader.getByLabel('Пошук у каталозі').fill(title);
  await reader.getByRole('heading', { name: 'Нічого не знайшлося' }).waitFor();
  let navigations = 0;
  reader.on('framenavigated', frame => { if (frame === reader.mainFrame()) navigations++; });
  await admin.getByRole('button', { name: 'Додати книжку', exact: true }).click();
  await admin.getByRole('button', { name: 'Зберегти книжку', exact: true }).click();
  assert.equal(await admin.locator('.is-invalid').count(), 5);
  for (const [name, value] of Object.entries({ title, author: '<script>window.__storedXss=1</script>', isbn, genre: 'Перевірка', publicationYear: '2024', totalCopies: '1' })) await admin.locator(`[name="${name}"]`).fill(value);
  await admin.getByRole('button', { name: 'Зберегти книжку', exact: true }).click();
  await admin.locator('dialog').waitFor({ state: 'hidden' });
  await reader.getByRole('button', { name: title, exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await reader.getByLabel('Пошук у каталозі').inputValue(), title);
  assert.equal(navigations, 0);
  assert.equal(await reader.evaluate(() => window.__storedXss), undefined);
  assert.equal(await reader.locator('.book-card script').count(), 0);
  check('AJAX між незалежними сеансами: нова книжка без навігації, фільтр збережено, XSS не виконується');

  let row = admin.locator('tbody tr').filter({ hasText: title });
  await row.getByRole('button', { name: `Редагувати: ${title}`, exact: true }).click();
  await admin.locator('[name="title"]').fill(title + ' оновлено');
  await admin.getByRole('button', { name: 'Зберегти книжку', exact: true }).click();
  await reader.getByRole('button', { name: title + ' оновлено', exact: true }).waitFor({ timeout: 10000 });
  await reader.getByRole('button', { name: title + ' оновлено', exact: true }).click();
  await reader.getByRole('heading', { name: 'Про книжку', exact: true }).waitFor();
  await reader.getByRole('button', { name: 'Повернутися до каталогу', exact: true }).click();
  check('Редагування та React-вікно перегляду книжки');

  await reader.getByRole('switch', { name: 'Лише доступні' }).check();
  row = admin.locator('tbody tr').filter({ hasText: title });
  await row.getByRole('button', { name: 'Видати', exact: true }).click();
  await admin.getByLabel('Код читача', { exact: true }).fill('ui_reader_1');
  await admin.getByRole('button', { name: 'Підтвердити видачу', exact: true }).click();
  await admin.locator('dialog').waitFor({ state: 'hidden' });
  await reader.getByRole('heading', { name: 'Нічого не знайшлося' }).waitFor({ timeout: 10000 });
  assert.equal(await row.getByRole('button', { name: `Видалити: ${title} оновлено`, exact: true }).isDisabled(), true);
  await admin.getByRole('button', { name: /Активні видачі/ }).click();
  await admin.locator('tbody tr').filter({ hasText: 'ui_reader_1' }).getByRole('button', { name: 'Повернути', exact: true }).click();
  await admin.getByRole('button', { name: 'Повернути примірник', exact: true }).click();
  await reader.getByRole('button', { name: title + ' оновлено', exact: true }).waitFor({ timeout: 10000 });
  check('Видача та повернення автоматично змінюють доступність у каталозі');

  await admin.getByRole('button', { name: /^Каталог/ }).click();
  await admin.locator('tbody tr').filter({ hasText: title }).getByRole('button', { name: `Видалити: ${title} оновлено`, exact: true }).click();
  await admin.getByRole('button', { name: 'Видалити', exact: true }).click();
  await reader.getByRole('heading', { name: 'Нічого не знайшлося' }).waitFor({ timeout: 10000 });
  assert.equal(navigations, 0);
  check('Видалення також синхронізується без перезавантаження');

  await visitorContext.route('**/api/books', route => route.abort());
  await reader.getByRole('alert').filter({ hasText: 'Немає зв’язку' }).waitFor({ timeout: 12000 });
  await visitorContext.unroute('**/api/books');
  await reader.locator('.live-pill:not(.is-offline)').waitFor({ timeout: 12000 });
  check('Автоматичне відновлення після втрати з’єднання');

  await admin.getByRole('button', { name: 'Вийти', exact: true }).click();
  await admin.getByRole('heading', { name: 'Вхід адміністратора', exact: true }).waitFor();
  check('Вихід прибирає адміністративний інтерфейс');

  await reader.getByLabel('Пошук у каталозі').fill('');
  await reader.getByRole('switch', { name: 'Лише доступні' }).uncheck();
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await reader.screenshot({ path: `${screenshots}/catalog-mobile.png`, fullPage: true, animations: 'disabled' });
  assert.ok(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.screenshot({ path: `${screenshots}/login-mobile.png`, fullPage: true });
  assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []); assert.deepEqual(cspErrors, []);
  check('Мобільні екрани 390px, без горизонтального прокручування, JS- і CSP-помилок');
  console.log(`Браузерних сценаріїв пройдено: ${checks.length}. Скріншоти: docs/screenshots`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await client?.close(); await mongo?.stop();
}
