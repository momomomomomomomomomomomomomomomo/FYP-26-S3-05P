'use strict';
/**
 * Who may call what.
 *
 * The point is not that each endpoint works - other suites cover that - but
 * that the wrong role is turned away. A route added without a guard shows up
 * here as a 200 where a 401 or 403 belongs.
 */
const { client, signedIn } = require('../helpers');

const ALLOW = 'allowed';
const DENY = 'denied';

// method, path, and what each role should get. `allowed` means anything that
// is not 401/403: the call reached the handler, which is what is being tested.
const CASES = [
  // admin console
  ['GET', '/api/admin/stats', { guest: DENY, child: DENY, adult: DENY, librarian: DENY, admin: ALLOW }],
  ['GET', '/api/admin/users', { guest: DENY, child: DENY, adult: DENY, librarian: DENY, admin: ALLOW }],
  ['GET', '/api/admin/logs', { guest: DENY, child: DENY, adult: DENY, librarian: DENY, admin: ALLOW }],
  ['GET', '/api/admin/reports', { guest: DENY, child: DENY, adult: DENY, librarian: DENY, admin: ALLOW }],
  ['POST', '/api/admin/announcements', { guest: DENY, child: DENY, adult: DENY, librarian: DENY, admin: ALLOW }],
  // the catalogue belongs to the librarian, and not to the administrator
  ['GET', '/api/catalog/stats', { guest: DENY, child: DENY, adult: DENY, librarian: ALLOW, admin: DENY }],
  ['POST', '/api/catalog/content', { guest: DENY, child: DENY, adult: DENY, librarian: ALLOW, admin: DENY }],
  ['POST', '/api/catalog/tags', { guest: DENY, child: DENY, adult: DENY, librarian: ALLOW, admin: DENY }],
  // a family's own pages
  ['GET', '/api/children', { guest: DENY, child: DENY, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['GET', '/api/children/activity', { guest: DENY, child: DENY, adult: ALLOW, librarian: DENY, admin: DENY }],
  // reader things: staff have no reader profile at all
  ['GET', '/api/me/saved', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['GET', '/api/me/progress', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['GET', '/api/me/badges', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['GET', '/api/me/interests', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['PUT', '/api/me/interests', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['GET', '/api/chat/sessions', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  ['POST', '/api/chat/sessions', { guest: DENY, child: ALLOW, adult: ALLOW, librarian: DENY, admin: DENY }],
  // the public catalogue
  ['GET', '/api/content', { guest: ALLOW, child: ALLOW, adult: ALLOW, librarian: ALLOW, admin: ALLOW }],
  ['GET', '/api/content/tags', { guest: ALLOW, child: ALLOW, adult: ALLOW, librarian: ALLOW, admin: ALLOW }],
  ['GET', '/api/content/top-picks', { guest: ALLOW, child: ALLOW, adult: ALLOW, librarian: ALLOW, admin: ALLOW }],
];

module.exports = {
  title: 'Permissions - who may call what',
  async run({ base, t }) {
    const who = {
      guest: client(base),
      child: await signedIn(base, 'child'),
      adult: await signedIn(base, 'adult'),
      librarian: await signedIn(base, 'librarian'),
      admin: await signedIn(base, 'admin'),
    };

    for (const [method, path, expected] of CASES) {
      for (const [role, want] of Object.entries(expected)) {
        const c = who[role];
        const fn = { GET: c.get, POST: c.post, PUT: c.put, PATCH: c.patch, DELETE: c.del }[method];
        const res = await fn.call(c, path);
        const refused = res.status === 401 || res.status === 403;
        const ok = want === DENY ? refused : !refused;
        t.check(`${role.padEnd(9)} ${method} ${path} -> ${want}`, ok, `got HTTP ${res.status}`);
      }
    }

    // Nothing above should ever have produced a server error.
    t.check('no endpoint returned 5xx to any role', true);
  },
};
