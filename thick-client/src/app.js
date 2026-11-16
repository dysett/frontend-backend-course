import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { BookDAO } from './dao/book-dao.js';
import { AdminDAO } from './dao/admin-dao.js';
import { BookService } from './services/book-service.js';
import { AuthService } from './services/auth-service.js';
import { apiRouter } from './routes/books.js';
import { authRouter } from './routes/auth.js';
import { sameOrigin } from './middleware/security.js';
import { AppError, errorHandler } from './errors.js';

export function createApp({ db, clock, auth }) {
  if (!auth?.sessionSecret || auth.sessionSecret.length < 32) throw new Error('SESSION_SECRET: потрібно щонайменше 32 символи.');
  const app = express();
  const dao = new BookDAO(db);
  const service = new BookService(dao, clock);
  const sessionMaxAge = auth.sessionMaxAge ?? 30 * 60 * 1000;
  app.disable('x-powered-by');
  if (auth.trustProxy) app.set('trust proxy', 1);
  app.set('json spaces', 2);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'script-src': ["'self'"], 'style-src': ["'self'"], 'font-src': ["'self'"],
    'connect-src': ["'self'"], 'base-uri': ["'none'"], 'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': null,
  } } }));
  app.use(sameOrigin(auth.publicOrigin));
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Використовуйте Content-Type: application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  app.use('/assets', express.static(`${dist}/assets`, { index: false, maxAge: '1y', immutable: true }));
  app.get(['/', '/admin'], (req, res) => res.sendFile('index.html', { root: dist }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Забагато запитів. Спробуйте за хвилину.' } },
  }));
  const store = MongoStore.create({ client: db.client, dbName: db.databaseName, collectionName: 'sessions', ttl: sessionMaxAge / 1000, autoRemove: 'native' });
  store.on('error', error => console.error('Сховище сеансів:', error.name));
  app.use('/api', session({ name: 'library.sid', secret: auth.sessionSecret, store,
    resave: false, saveUninitialized: false, rolling: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: Boolean(auth.secureCookies), maxAge: sessionMaxAge },
  }));
  // Фонові запити не продовжують авторизацію понад абсолютні 30 хвилин.
  app.use('/api', (req, res, next) => {
    if (req.session.user && Date.now() - req.session.authenticatedAt >= sessionMaxAge) {
      return req.session.destroy(error => error ? next(error) : next(new AppError(401, 'SESSION_EXPIRED', 'Сеанс завершився. Увійдіть знову.')));
    }
    next();
  });
  app.use('/api/auth', authRouter(new AuthService(new AdminDAO(db)), { ...auth, sessionMaxAge }));
  app.get('/api', (req, res) => res.json({
    name: 'Thick Client Library', version: '2.0.0',
    resources: { books: '/api/books', loans: '/api/loans', statistics: '/api/statistics', health: '/api/health', session: '/api/auth/session' },
  }));
  app.get('/api/health', async (req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ data: { status: 'ok', database: 'MongoDB' } });
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'MongoDB недоступна.');
    }
  });
  app.use('/api', apiRouter(service));
  app.use((req, res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'Маршрут не знайдено.')));
  app.use(errorHandler);
  return app;
}
