import { randomBytes } from 'node:crypto';
const save = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
export function authController(service, { secureCookies = false, sessionMaxAge = 1800000 } = {}) {
  return {
    session: async (req, res) => {
      if (!req.session.csrfToken) {
        req.session.csrfToken = randomBytes(32).toString('hex');
        await save(req);
      }
      res.json({ data: { user: req.session.user ?? null, csrfToken: req.session.csrfToken } });
    },
    login: async (req, res) => {
      const user = await service.authenticate(req.body);
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.user = user;
      req.session.authenticatedAt = Date.now();
      req.session.csrfToken = randomBytes(32).toString('hex');
      req.session.cookie.maxAge = sessionMaxAge;
      await save(req);
      res.json({ data: { user, csrfToken: req.session.csrfToken } });
    },
    logout: async (req, res) => {
      await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      res.clearCookie('library.sid', { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookies });
      res.json({ data: { loggedOut: true } });
    },
  };
}
