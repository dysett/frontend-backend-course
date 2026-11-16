import { Router } from 'express';
import { AppError } from '../errors.js';
import { bookController } from '../controllers/book-controller.js';

function methodNotAllowed(methods) {
  return (req, res, next) => {
    res.set('Allow', [...methods, 'OPTIONS', ...(methods.includes('GET') ? ['HEAD'] : [])].join(', '));
    next(new AppError(405, 'METHOD_NOT_ALLOWED', 'Метод не підтримується для цього ресурсу.'));
  };
}

function resource(router, path, handlers) {
  const route = router.route(path);
  for (const [method, handler] of Object.entries(handlers)) route[method.toLowerCase()](handler);
  route.options((req, res) => {
    const methods = [...Object.keys(handlers), 'OPTIONS', ...(handlers.GET ? ['HEAD'] : [])];
    res.set('Allow', methods.join(', ')).json({ data: { methods } });
  });
  route.all(methodNotAllowed(Object.keys(handlers)));
}

export function apiRouter(service) {
  const router = Router();
  const c = bookController(service);
  resource(router, '/books', { GET: c.list, POST: c.create });
  resource(router, '/books/:id', { GET: c.get, PUT: c.update, PATCH: c.update, DELETE: c.delete });
  resource(router, '/books/:id/loans', { GET: c.loans, POST: c.borrow });
  resource(router, '/books/:id/loans/:loanId', { GET: c.loan, DELETE: c.returnLoan });
  resource(router, '/loans', { GET: c.allLoans });
  resource(router, '/statistics', { GET: c.statistics });
  return router;
}
