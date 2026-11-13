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

    // --- a child's own details belong to their parent ----------------------
    // Set on the family page, not by the child. The account page shows them
    // read-only, but that is only the interface: the refusal is here.
    const before = (await who.child.get('/api/auth/me')).body.user;

    for (const [field, value] of [
      ['name', 'Renamed By Myself'],
      ['reading_level', 'ADVANCED'],
      ['email', 'newloginid'],
      ['dob', '2001-01-01'],
    ]) {
      const res = await who.child.patch('/api/auth/me', { [field]: value });
      t.check(`a child may not change their own ${field}`, res.status === 403,
        `HTTP ${res.status}`);
    }

    const after = (await who.child.get('/api/auth/me')).body.user;
    t.check('and none of it actually changed',
      after.name === before.name && after.email === before.email
      && after.reading_level === before.reading_level && after.dob === before.dob,
      { before, after });

    // Closing the account is their parent's decision too.
    const gone = await who.child.del('/api/auth/me');
    t.check('a child may not delete their own account', gone.status === 403,
      `HTTP ${gone.status}`);
    t.check('and the account is still there',
      (await who.child.get('/api/auth/me')).status === 200);

    // Refusing the whole request must not cost them the part that is theirs.
    t.check('a child can still change their own password',
      (await who.child.post('/api/auth/change-password', {
        current_password: 'storynest1', new_password: 'storynest1',
      })).status < 400);

    // An adult still owns their own profile.
    const adultBefore = (await who.adult.get('/api/auth/me')).body.user;
    t.check('an adult can still rename themselves',
      (await who.adult.patch('/api/auth/me', { name: adultBefore.name })).status === 200);

    // And a parent can still set all of it for the child.
    const kids = await who.adult.get('/api/children');
    const kid = (kids.body.children || kids.body.items || [])
      .find((k) => k.email === 'leo' || k.name === before.name);
    if (kid) {
      t.check('a parent can still set their child\u2019s name and reading level',
        (await who.adult.patch(`/api/children/${kid.user_id}`, {
          name: before.name, reading_level: before.reading_level,
        })).status === 200);
    }

    // --- the administrator can see every kind of account --------------------
    // Librarians were missing from the role filter's allowed list, so choosing
    // "Librarians" in a dropdown that offered it answered 400, and staff sorted
    // last by date fell off the end of the first page.
    for (const role of ['ADMIN', 'LIBRARIAN', 'ADULT', 'CHILD']) {
      const res = await who.admin.get(`/api/admin/users?role=${role}`);
      t.check(`the user list can be filtered to ${role}`,
        res.status === 200 && res.body.items.length > 0
        && res.body.items.every((u) => u.role === role),
        `HTTP ${res.status}, ${res.body && res.body.items && res.body.items.length} rows`);
    }

    const firstPage = await who.admin.get('/api/admin/users');
    const roles = new Set((firstPage.body.items || []).map((u) => u.role));
    t.check('staff appear on the first page of the unfiltered list',
      roles.has('ADMIN') && roles.has('LIBRARIAN'), [...roles]);

    t.check('the list reports a total larger than one page when there is one',
      firstPage.body.total >= firstPage.body.items.length, {
        total: firstPage.body.total, shown: firstPage.body.items.length,
      });

    const everyone = await who.admin.get('/api/admin/users?limit=200');
    t.check('and raising the limit reaches all of them',
      everyone.body.items.length === everyone.body.total,
      { got: everyone.body.items.length, total: everyone.body.total });

    t.check('an unknown role is still refused',
      (await who.admin.get('/api/admin/users?role=WIZARD')).status === 400);

    // Nothing above should ever have produced a server error.
    t.check('no endpoint returned 5xx to any role', true);
  },
};
