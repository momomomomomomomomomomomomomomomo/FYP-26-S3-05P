'use strict';
/**
 * The small amount of machinery the suites share: a client that keeps its
 * cookies, and three assertions.
 *
 * Deliberately dependency-free. A project this size does not need a test
 * framework, and not having one means `npm test` works on a clean checkout
 * with nothing installed beyond what the app itself uses.
 */

/** One signed-in (or anonymous) client. Cookies persist across its calls. */
function client(base) {
  let cookie = '';
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    const text = await res.text();
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    return { status: res.status, body: json, text };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b === undefined ? {} : b),
    put: (p, b) => call('PUT', p, b === undefined ? {} : b),
    patch: (p, b) => call('PATCH', p, b === undefined ? {} : b),
    del: (p) => call('DELETE', p),
    async login(identifier, password) {
      const r = await call('POST', '/api/auth/login', { identifier, password });
      if (r.status !== 200) throw new Error(`login failed for ${identifier}: ${r.status}`);
      return r;
    },
    get cookie() { return cookie; },
  };
}

/** The accounts every suite signs in as, as created by scripts/setup-db.js. */
const ACCOUNTS = {
  child: ['leo', 'storynest1'],
  child2: ['ada', 'storynest1'],
  adult: ['parent@storynest.local', 'Parent123!'],
  adult2: ['daniel@storynest.local', 'Parent123!'],
  librarian: ['librarian@storynest.local', 'Librarian123!'],
  admin: ['admin@storynest.local', 'Admin123!'],
};

async function signedIn(base, who) {
  const c = client(base);
  await c.login(...ACCOUNTS[who]);
  return c;
}

module.exports = { client, signedIn, ACCOUNTS };
