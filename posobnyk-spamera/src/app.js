import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { projectRoot } from './config.js';
import { ContactDAO } from './dao/contact-dao.js';
import { CampaignDAO } from './dao/campaign-dao.js';
import { CampaignService } from './services/campaign-service.js';
import { createMailer } from './services/mailer.js';
import { templates } from './data/templates.js';
import { contactInput, objectId } from './validation.js';
import { HttpError } from './errors.js';

export function createApp({ db, config, mailer = createMailer(config) }) {
  const app = express();
  const contacts = new ContactDAO(db);
  const campaigns = new CampaignDAO(db);
  const service = new CampaignService(contacts, campaigns, mailer, config);
  app.set('view engine', 'pug');
  app.set('views', path.join(projectRoot, 'views'));
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'script-src': ["'self'"], 'script-src-attr': ["'none'"],
    'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'],
    'upgrade-insecure-requests': null
  } } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('Sec-Fetch-Site') === 'cross-site') return next(new HttpError(403, 'Запит з іншого сайту заборонено.'));
      if (req.get('Origin')) {
        try {
          if (new URL(req.get('Origin')).host !== req.get('Host')) throw new Error();
        } catch { return next(new HttpError(403, 'Запит з іншого сайту заборонено.')); }
      }
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return next(new HttpError(415, 'Очікується JSON.'));
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/', async (req, res) => {
    const [contactList, campaignList] = await Promise.all([contacts.list(), campaigns.list()]);
    res.set('Cache-Control', 'no-store').render('index', {
      title: 'Листоноша · Пособник спамера',
      contacts: contactList, campaigns: campaignList, templates,
      mailMode: config.mailMode, mailFrom: config.mailFrom,
      menu: [
        { id: 'contacts', label: 'Контакти', icon: 'people' },
        { id: 'compose', label: 'Нова розсилка', icon: 'pencil-square' },
        { id: 'templates', label: 'Шаблони листів', icon: 'files' },
        { id: 'history', label: 'Історія розсилок', icon: 'clock-history' }
      ]
    });
  });
  app.use('/vendor/bootstrap', express.static(path.join(projectRoot, 'node_modules/bootstrap/dist')));
  app.use('/vendor/icons', express.static(path.join(projectRoot, 'node_modules/bootstrap-icons/font')));
  app.use(express.static(path.join(projectRoot, 'public')));
  app.get('/api/health', async (req, res) => { await db.command({ ping: 1 }); res.json({ status: 'ok', database: 'MongoDB' }); });
  app.get('/api/config', (req, res) => res.json({ mailMode: config.mailMode, mailFrom: config.mailFrom, maxRecipients: config.maxRecipients }));
  app.get('/api/templates', (req, res) => res.json(templates));
  app.get('/api/contacts', async (req, res) => res.json(await contacts.list()));
  app.post('/api/contacts', async (req, res) => res.status(201).json(await contacts.create(contactInput(req.body))));
  app.put('/api/contacts/:id', async (req, res) => {
    const contact = await contacts.update(req.params.id, contactInput(req.body));
    if (!contact) throw new HttpError(404, 'Контакт не знайдено.');
    res.json(contact);
  });
  app.delete('/api/contacts/:id', async (req, res) => {
    if (!await contacts.delete(req.params.id)) throw new HttpError(404, 'Контакт не знайдено.');
    res.status(204).end();
  });
  app.get('/api/campaigns', async (req, res) => res.json(await campaigns.list()));
  app.post('/api/campaigns', async (req, res) => res.status(201).json(await service.send(req.body)));
  app.get('/api/campaigns/:id', async (req, res) => {
    const campaign = await campaigns.get(req.params.id);
    if (!campaign) throw new HttpError(404, 'Розсилку не знайдено.');
    res.json(campaign);
  });
  app.get('/api/campaigns/:id/messages/:contactId', async (req, res) => {
    objectId(req.params.contactId);
    const campaign = await campaigns.get(req.params.id);
    const recipient = campaign?.recipients.find(item => item.contactId === req.params.contactId);
    if (!recipient?.fileName || recipient.status !== 'preview') throw new HttpError(404, 'Файл листа не знайдено.');
    res.download(path.join(config.outboxDir, path.basename(recipient.fileName)), 'message.eml');
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не знайдено.' }));
  app.use((req, res) => res.status(404).type('text').send('Сторінку не знайдено.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 11000) return res.status(409).json({ error: 'Ця електронна адреса вже є у списку.', fields: { email: 'Адреса вже використовується.' } });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некоректний JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Завеликий запит.' });
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Файл листа відсутній на диску.' });
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('Помилка сервера:', error.name);
    res.status(status).json({ error: status === 500 ? 'Помилка сервера. Перевірте доступність бази даних.' : error.message, ...(error.fields ? { fields: error.fields } : {}) });
  });
  return { app, contacts, campaigns, mailer };
}
