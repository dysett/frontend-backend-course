import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
export const safeMethod = method => ['GET', 'HEAD', 'OPTIONS'].includes(method);
export function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== 'admin') return next(new AppError(401, 'AUTH_REQUIRED', 'Увійдіть як адміністратор.'));
  next();
}
export function csrfProtection(req, res, next) {
  if (safeMethod(req.method)) return next();
  const token = req.get('X-CSRF-Token');
  const expected = req.session?.csrfToken;
  if (typeof token !== 'string' || !expected || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return next(new AppError(403, 'CSRF_INVALID', 'Сеанс перевірки застарів. Оновіть сторінку й повторіть дію.'));
  }
  next();
}
export function sameOrigin(publicOrigin) {
  return (req, res, next) => {
    const host = publicOrigin ? new URL(publicOrigin).hostname : null;
    if (!(host ? req.hostname === host : ['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname))) return next(new AppError(403, 'HOST_FORBIDDEN', 'Недозволений хост. Налаштуйте PUBLIC_ORIGIN.'));
    if (!safeMethod(req.method)) {
      const expected = publicOrigin || `${req.protocol}://${req.get('host')}`;
      if ((req.get('Origin') && req.get('Origin') !== expected) || req.get('Sec-Fetch-Site') === 'cross-site') return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Запити з іншого сайту заборонені.'));
    }
    next();
  };
}
