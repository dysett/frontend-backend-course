import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authController } from '../controllers/auth-controller.js';
import { csrfProtection, requireAdmin } from '../middleware/security.js';
export function authRouter(service, options) {
  const router = Router();
  const c = authController(service, options);
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Забагато спроб входу. Спробуйте через 15 хвилин.' } },
  });
  router.get('/session', c.session);
  router.post('/login', loginLimit, csrfProtection, c.login);
  router.post('/logout', requireAdmin, csrfProtection, c.logout);
  return router;
}
