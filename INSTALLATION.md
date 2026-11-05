# StoryNest — Installation Guide

StoryNest is a Node.js web application with a MySQL database, served as a single
site: the Express server provides the JSON API **and** the pages. There is no
build step, no bundler and no framework to install — if Node and MySQL run, the
app runs.

- **Time needed:** about 10 minutes
- **Works on:** Windows 10/11, macOS, Linux

---

## 1. What you need first

| Software | Version | Check it is installed | Where to get it |
|---|---|---|---|
| **Node.js** | 18 or newer (20 LTS recommended) | `node -v` | <https://nodejs.org> — download the **LTS** installer |
| **npm** | comes with Node | `npm -v` | (installed with Node) |
| **MySQL Server** | 8.0 or newer | `mysql --version` | <https://dev.mysql.com/downloads/mysql/> |
| **Git** | any | `git --version` | <https://git-scm.com> |

If a command reports "not found", close and reopen your terminal after
installing, so the new program is on your `PATH`.

> **MySQL Workbench / phpMyAdmin / XAMPP are optional.** The setup script talks
> to MySQL directly. If you already run MySQL through XAMPP or MAMP, that is
> fine — just use its port and credentials in step 4.

### Installing MySQL, in short

- **Windows** — run the MySQL Installer, choose *Server only* (or *Developer
  Default*), keep port **3306**, choose *Use Strong Password Encryption*, and
  **write down the root password you set**. Let it install MySQL as a Windows
  service so it starts automatically.
- **macOS (Homebrew)** — `brew install mysql` then `brew services start mysql`.
  A fresh install has user `root` with an **empty** password.
- **Linux (Debian/Ubuntu)** — `sudo apt install mysql-server` then
  `sudo systemctl start mysql`.

---

## 2. Get the code

```bash
git clone <your-repository-url> storynest
cd storynest
```

If you were given a ZIP instead, unzip it and `cd` into the folder.

---

## 3. Install the dependencies

```bash
npm install
```

This creates `node_modules/` and takes about a minute. It installs seven
packages: `express`, `mysql2`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`,
`express-rate-limit` and `dotenv`.

---

## 4. Configure your database connection

Copy the example configuration and edit it:

```bash
# macOS / Linux
cp .env.sample .env

# Windows (PowerShell)
Copy-Item .env.sample .env
```

Open `.env` in any text editor and set the MySQL details you chose in step 1:

```ini
PORT=3000
NODE_ENV=development

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_root_password    # leave blank if there is no password
DB_NAME=storynest

JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_IN=7d
```

Two notes:

- `JWT_SECRET` signs the login cookie. Any long random string works for local
  development. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `.env` is listed in `.gitignore`, so your password is never committed.

---

## 5. Create the database

```bash
npm run db:setup
```

This one command:

1. creates the `storynest` database and all 24 tables (`database/schema.sql`),
2. loads the sample titles, tags and badges (`database/seed.sql`),
3. creates the demo accounts and the per-role test accounts, with passwords
   hashed using bcrypt,
4. adds the full-text books from `database/books/`,
5. adds the demo families and the reviews, reading history, reactions and
   favourites that make the library look used.

You should see:

```
StoryNest database setup
------------------------
Target: mysql://root@127.0.0.1:3306/storynest

1/5  Creating tables ...
2/5  Loading the sample library ...
3/5  Creating demo and test accounts ...
4/5  Adding the full-text books ...
5/5  Filling the library with readers ...

Done.
  80 accounts, 86 titles, 36 tags.
  78 of those titles are full books, with 2029 pages of text.
  459 reviews from 26 demo families (43 children).
```

followed by the list of sign-ins. The accounts and passwords are also kept in
`ACCOUNTS.md`.

> **Careful:** the script **drops** any existing `storynest` database. It
> refuses to run if one already contains accounts — use `npm run db:reset` when
> you really do want to wipe and start again.

### Moving the database to another machine

The command above is reproducible: run it anywhere and you get the same titles,
the same accounts, the same reviews and the same dates. Nothing in the seed is
measured from the day it runs, so a copy built next month matches this one.

If you would rather carry the finished database across than rebuild it, import
the full export instead of running step 5:

```bash
mysql -u root -p < database/storynest-full.sql
```

That file holds the schema and every row, drops and recreates `storynest`, and
produces a database identical to the one `npm run db:setup` builds — all 24
tables match row for row. Use whichever route suits the machine; both end up in
the same place.

Only the passwords differ between the two routes, and only in their stored
form: bcrypt salts each hash separately, so the hashes are never byte-identical
even though the passwords themselves are the same.

---

## 6. Start the application

```bash
npm start
```

```
[db] connected to mysql://127.0.0.1:3306/storynest
[web] StoryNest is running at http://localhost:3000
```

Open <http://localhost:3000> in your browser.

For development, `npm run dev` restarts the server whenever you save a file.

### Running the tests

```bash
npm test                 # every suite
npm test -- scope        # one suite, by name
npm test -- --keep       # leave the test database up afterwards, to poke at
```

The tests build their own database (`storynest_test`), start their own server
on port 3999, run against that, and drop the database when they finish. They
never touch the database named in your `.env`, which is what makes it safe for
them to check destructive things like whether a librarian can really delete a
title.

There are six suites, run in this order:

| Suite | What it covers |
|---|---|
| `data` | The shape of a fresh install: no broken references, every book has pages and cover art, no child holds an interest they are not allowed to be offered |
| `permissions` | Every role against every protected endpoint — a route added without a guard fails here |
| `flows` | What people actually do: browsing, searching, favourites, reading, reviews, unlock requests, parental controls, the catalogue, administration, Story Chat |
| `scope` | What a restricted child may see, computed from the rules and checked against every endpoint that returns titles — including guessing ids and probing Story Chat |
| `validation` | Input that should be refused: bad ids, out-of-range numbers, oversized text, `javascript:` links, malformed payloads |
| `chatbot` | Intent classification, interest-led recommendations, the question-and-answer flow, and that no suggestion ever leaves the reader's scope |

Nothing extra is installed to run them: no test framework, so `npm test` works
on a clean checkout.

---

## 7. Sign in and look around

| Role | Sign in with | Password | What to look at |
|---|---|---|---|
| **Administrator** | `admin@storynest.local` | `Admin123!` | *Admin* → accounts, reports, announcements, audit log |
| **Librarian** | `librarian@storynest.local` | `Librarian123!` | *Catalogue* → add, edit and remove titles, categories, bulk import |
| **Adult** | `parent@storynest.local` | `Parent123!` | *Family* → Leo and Ada, their controls, one pending request |
| **Adult** | `daniel@storynest.local` | `Parent123!` | A second family, so the admin list is not trivial |
| **Child** | `leo` | `storynest1` | Age 8, mysteries blocked, 60 min/day |
| **Child** | `ada` | `storynest1` | Age 11, sci-fi blocked, 90 min/day |
| **Child** | `sam` | `storynest1` | Age 6, 45 min/day (belongs to Daniel) |
| **Guest** | *don't sign in* | — | Browsing works; saving and Story Chat ask you to sign in |

`npm run db:setup` also creates one **test account per role**, with no parental
restrictions on the child, for checking each role in isolation:

| Role | Sign in with | Password | Notes |
|---|---|---|---|
| **Administrator** | `test.admin@storynest.local` | `TestAdmin123!` | — |
| **Librarian** | `test.librarian@storynest.local` | `TestLibrarian123!` | — |
| **Adult** | `test.parent@storynest.local` | `TestParent123!` | Parent of *Test Kid* |
| **Child** | `testkid` | `testkid1` | Age 9, no blocked genres, no screen limit |

Children sign in with a **login ID**, not an email address — their parent picks
it when creating the account.

**Change these passwords before you demo the app to anyone outside your team.**

### A five-minute tour that shows the access rules working

1. Sign in as `leo`. The library shows **16** of the 24 titles — nothing rated
   above age 8, and nothing tagged *Mystery*.
2. Search for *The Last Library on Mars* (rated 10+) and open it. Leo gets a
   lock screen and an **Ask a grown-up** button. Send the request.
3. Sign out, sign in as `parent@storynest.local`, open **Family → Requests**,
   and choose *Unlock it*.
4. Sign back in as `leo`. The title is now in his library — an approved title
   overrides the age and genre rules, but only for him.
5. Open **Story Chat** as Leo and ask for *"a scary mystery"*. It tells him a
   grown-up has turned that kind off and points him at them — it does not offer
   something else under that name, and it does not reveal how many mysteries the
   library holds. Try *"a book for a 12 year old"* too: same polite refusal,
   because Leo's limit is 8. Then ask for *"an adventure, but nothing scary"*
   and watch it exclude what he did not want.

---

## 8. If something goes wrong

| Message | What it means | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | MySQL is not running | Start it: `brew services start mysql` / `sudo systemctl start mysql` / start the MySQL service in Windows *Services* |
| `ER_ACCESS_DENIED_ERROR` | Wrong MySQL user or password | Fix `DB_USER` / `DB_PASSWORD` in `.env` |
| `Unknown database 'storynest'` | Step 5 was skipped | Run `npm run db:setup` |
| `EADDRINUSE :::3000` | Something else uses port 3000 | Change `PORT` in `.env`, or stop the other program |
| `Database "storynest" already exists and has N account(s)` | Safety check | `npm run db:reset` to wipe and rebuild |
| `command not found: npm` | Node is not on your PATH | Reinstall Node, then open a **new** terminal |
| Page loads but is unstyled / buttons do nothing | Files served from the wrong folder | Run `npm start` from the project root, not from `server/` |

Check the API is alive on its own with:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"connected"}
```

To inspect the data directly:

```bash
mysql -u root -p storynest -e "SELECT user_id, role, name, email FROM users;"
```

---

## 9. What is in the project

```
storynest/
├── database/
│   ├── schema.sql          # all 24 tables — drops and recreates the database
│   ├── seed.sql            # sample titles, tags and badges
│   ├── storynest-full.sql  # the finished database, schema and all rows
│   ├── books/              # 78 full books, one file each, pages and all
│   ├── videos.js           # cover art and categories for the video titles
│   ├── seed-community.js   # the demo families and everything they wrote
│   └── import-books.js     # loads database/books/ into the catalogue
├── scripts/
│   ├── setup-db.js         # runs both SQL files, creates accounts, loads books
│   ├── import-books.js     # adds the books to a database that already exists
│   └── make-covers.js      # draws public/covers/*.svg from database/books/
├── server/
│   ├── index.js            # Express app: middleware, routes, static files
│   ├── config.js           # reads .env
│   ├── db.js               # MySQL connection pool + query helpers
│   ├── middleware/
│   │   ├── auth.js         # reads the session cookie, requireAuth / requireRole
│   │   └── error.js        # turns thrown errors into clean JSON
│   ├── routes/
│   │   ├── auth.js         # register, login, logout, own profile
│   │   ├── content.js      # library, search, previews, reactions, progress, reviews
│   │   ├── me.js           # favourites, watchlist, badges, notifications, requests
│   │   ├── children.js     # adult: child accounts, parental controls, requests
│   │   ├── chat.js         # Story Chat sessions and messages
│   │   ├── admin.js        # users, reports, announcements, audit log
│   │   └── catalog.js      # the Librarian's routes: titles, categories, bulk import
│   └── utils/
│       ├── access.js       # who may see what — the parental-control rules
│       ├── chatbot.js      # Story Chat: retrieve, rank (BM25), verify, explain
│       ├── nlp.js          # the language model: stemming, negation, TF-IDF
│       ├── chat-guard.js   # who may see what, checked before and after
│       ├── badges.js       # automatic badge awards
│       ├── audit.js        # writes audit_logs
│       ├── validate.js     # input checking
│       └── errors.js       # ApiError + asyncHandler
├── public/                 # the front end (plain HTML, CSS and JavaScript)
│   ├── index.html          # home page — the approved wireframe
│   ├── library.html watch.html content.html read.html chat.html
│   ├── login.html register.html account.html parent.html about.html
│   ├── admin.html          # accounts and moderation
│   ├── librarian.html      # the catalogue
│   ├── css/styles.css
│   └── js/                 # api.js, app.js (shared) + one file per page
├── .env.example
├── package.json
└── INSTALLATION.md
```

---

## 10. Running it somewhere real

Everything above sets the site up on one machine for marking and demonstration.
If it is ever put on a server that other people reach, three things change.

**Serve it over HTTPS.** The sign-in cookie is marked `Secure` as soon as
`NODE_ENV=production`, which means the browser will only send it over HTTPS —
over plain HTTP nobody would be able to stay signed in. The app also starts
sending `Strict-Transport-Security` in production, so a browser that has seen
the site once will refuse to fall back to HTTP. Put it behind a reverse proxy
that terminates TLS (nginx, Caddy, or a platform that does it for you); the app
already sets `trust proxy`, so it reads the real client address from
`X-Forwarded-For` rather than seeing every request as coming from the proxy.

**Set a real `JWT_SECRET`.** The default in `server/config.js` is a development
placeholder, and the app refuses to start in production while it is still in
place. Any long random string will do:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Change every password in `ACCOUNTS.md`.** They are published in this
repository's documentation; they exist so a marker can sign in, not to protect
anything.

```bash
NODE_ENV=production JWT_SECRET=... npm start
```

In production the app also stops explaining itself in error messages: a
database outage returns "The site is temporarily unavailable" rather than the
advice about checking MySQL and `.env`, which is for whoever is running it, not
for whoever is reading.

---

## 11. Notes for the marker / next developer

**The four kinds of user**

| | Guest | Child | Adult | Administrator |
|---|---|---|---|---|
| Browse the library | ✅ whole catalogue | ✅ **filtered by their parent**, simplified view | ✅ | ✅ |
| Add, edit or remove a title | ❌ | ❌ | ❌ | ❌ — that is the **Librarian's** job |
| Have a reader profile (favourites, progress, badges, Story Chat) | ❌ | ✅ | ✅ | ❌ — staff accounts have none |
| Preview a title (blurb, opening lines, trailer) | ✅ | ✅ | ✅ | ✅ |
| Save favourites, track progress, earn badges | ✅ favourites, against an email | ✅ | ✅ | ❌ — no reader profile |
| React to a title with one emoji | ❌ | ✅ | ✅ | ❌ — no reader profile |
| Story Chat | ❌ | ✅ (filtered) | ✅ | ❌ — no reader profile |
| Ask to unlock a blocked title | — | ✅ | — | — |
| Create and manage child accounts | ❌ | ❌ | ✅ **their own children only** | ✅ all |
| Set age limits, blocked genres, screen time | ❌ | ❌ | ✅ | ❌ — a family belongs to its parent |
| See every account on the site | ❌ | ❌ | ❌ | ✅ |
| Handle reports, post announcements, read the audit log | ❌ | ❌ | ❌ | ✅ |

**How a child's library is filtered.** All of it happens in SQL, in
`server/utils/access.js` (`contentScopeClause`), so a hidden title never reaches
the browser at all. A title is visible to a child when:

```
(age_rating <= max_age  AND  none of its tags are in child_blocked_genres)
OR  a parent has APPROVED it in content_requests
```

…and if `parental_controls.allow_content` is off, *only* approved titles show.
`max_age` falls back to the child's own age when a parent has not set one.

**Screen time.** The reader posts one minute at a time to
`POST /api/me/screen-time`; those minutes are summed from `audit_logs` for the
current day and compared with `parental_controls.daily_screen_limit`. Once it is
spent, opening a title returns 403.

**The Story Chat runs its NLP in-process, not through an API.**
`server/utils/nlp.js` is the language model: it normalises the message (including
contractions), tokenises it, stems each word, works out what the reader does
*not* want, maps the words onto the catalogue's own category vocabulary, and
classifies the intent. `server/utils/chatbot.js` then retrieves the titles the
reader is allowed to open and ranks them with **BM25** over a TF-IDF index of
every title, blurb, author and tag — rebuilt automatically whenever a librarian
changes the catalogue, so a title added now is findable now. No API key, no
internet, nothing leaves the machine.

**The guard rails are a separate module on purpose.**
`server/utils/chat-guard.js` checks three times: it refuses a request that breaks
the reader's settings *before* searching, retrieval runs only through
`contentScopeClause()`, and every id the ranker returns is re-verified in its own
query afterwards. That last check is the one that survives a future refactor
forgetting the scope clause — or a language model being dropped in behind
`rankCandidates()`, which is the only function that should ever be replaced.
Refusals are recorded as `CHAT_BLOCKED` in the audit trail, and never reveal what
is hidden.

**Two deliberate changes to the original schema** (both noted at the top of
`database/schema.sql`): `users.email` is now `UNIQUE`, because login resolves an
account by email/login-ID; and a few extra indexes were added on columns the app
filters by. Nothing else about the schema changed.

**Security choices worth mentioning in a report.** Passwords are bcrypt-hashed
with a cost of 12. The session is a signed JWT in an `httpOnly`, `SameSite=Lax`
cookie, so page scripts cannot read it and ordinary cross-site requests cannot
use it. Every SQL query uses bound parameters. Login and password changes are
rate-limited. The front end writes user text with `textContent`, never
`innerHTML`, and a Content-Security-Policy header blocks inline and third-party
scripts. Role checks are enforced on the server for every route — the hidden
*Admin* and *Family* buttons are a convenience, not the control.

**Known limitations, stated plainly.** The reader at `/read` is a demo: the
sample library stores metadata only, so it paginates placeholder text rather
than real book pages, though the surrounding progress, screen-time and
authorisation logic is real. There is no file upload for covers or media (point
`cover_image_url` and `external_link` at files you serve yourself). There is no
password-reset email — an adult resets a child's password from **Family**, and
an administrator can reset anyone's. The app is configured for `http://localhost`;
before putting it on a real server, set `NODE_ENV=production` (which switches
the cookie to `secure`), put it behind HTTPS, and give it a MySQL user with
only the privileges it needs rather than `root`.
