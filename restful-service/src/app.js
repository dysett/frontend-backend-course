import express from 'express';
import { fileURLToPath } from 'node:url';
import { BookDAO } from './dao/book-dao.js';
import { BookService } from './services/book-service.js';
import { apiRouter } from './routes/books.js';
import { AppError, errorHandler } from './errors.js';

export function createApp({ db, clock }) {
  const app = express();
  const dao = new BookDAO(db);
  const service = new BookService(dao, clock);
  app.disable('x-powered-by');
  app.set('json spaces', 2);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Використовуйте Content-Type: application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
  app.get('/', (req, res) => res.sendFile('index.html', { root: publicRoot }));
  app.use('/assets', express.static(publicRoot, { index: false }));
  app.get('/api', (req, res) => res.json({
    name: 'RESTful Library Service', version: '1.0.0',
    resources: { books: '/api/books', loans: '/api/loans', statistics: '/api/statistics', health: '/api/health' },
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
