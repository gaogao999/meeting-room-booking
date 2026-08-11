'use strict';

const config = require('../config');

// Authentication middleware.
// - AUTH_MODE=mock       : no login. req.user is left empty and the browser
//                          supplies the department and name with each booking.
// - AUTH_MODE=checklogin : reuse the company's existing /checklogin. Only the
//                          integration point lives here; the user is read from
//                          the session or the request headers.
async function authenticate(req, res, next) {
  try {
    // No login: the browser sends the department and name with each booking,
    // and remembers them locally between visits.
    if (config.auth.mode === 'mock') {
      req.user = { name: '', department: '', authenticated: false, mode: 'mock' };
      return next();
    }

    // Production: the integration point for the existing /checklogin. In real
    // use the already-verified user arrives from the reverse proxy or the
    // session; the headers below are the fallback read here.
    const name = req.get('X-User-Name');
    const department = req.get('X-User-Department');
    // The mailbox is what free/busy is looked up by, so a login that carries
    // one saves everybody typing their own address to see their own calendar.
    // Not every sign-in has it to give, hence the fallback: no address here
    // means the form asks, exactly as it does with no login at all.
    const email = String(req.get('X-User-Email') || '').trim();
    if (name) {
      req.user = {
        name,
        department: department || '',
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
        authenticated: true,
        mode: 'checklogin',
      };
      return next();
    }

    return res.status(401).json({ error: 'Authentication required.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticate };
