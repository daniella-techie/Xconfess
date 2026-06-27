import cookieParser from 'cookie-parser';
import csurf from 'csurf';
import { RequestHandler } from 'express';

/**
 * CSRF middleware using the double-submit cookie pattern.
 *
 * - Reads/writes the CSRF secret via a signed cookie.
 * - The frontend must read the XSRF-TOKEN cookie and send it back
 *   in the X-XSRF-TOKEN header on every POST/PUT/PATCH/DELETE request.
 * - The webhook route (/api/webhooks/*) is excluded because it uses
 *   its own HMAC signature verification instead.
 */

// Step 1: Parse cookies so csurf can read the secret cookie
export const cookieParserMiddleware: RequestHandler = cookieParser();

// Step 2: Configure csurf to use a cookie (not session) for the secret
export const csrfMiddleware: RequestHandler = csurf({
  cookie: {
    key: '_csrf',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  },
  value: (req: any) =>
    req.headers['x-xsrf-token'] ||
    req.headers['x-csrf-token'] ||
    (req.body && req.body._csrf),
});

// Step 3: After csurf runs, expose the token in a readable cookie so the
// frontend can pick it up (XSRF-TOKEN must NOT be httpOnly).
export const csrfCookieSetter: RequestHandler = (req: any, res, next) => {
  res.cookie('XSRF-TOKEN', req.csrfToken(), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  next();
};
