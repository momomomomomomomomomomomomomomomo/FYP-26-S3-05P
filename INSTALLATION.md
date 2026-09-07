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

1. creates the `storynest` database and all 20 tables (`database/schema.sql`),
2. loads 24 sample titles, 18 tags and 7 badges (`database/seed.sql`),
3. creates the demo accounts, with passwords hashed using bcrypt.

You should see:

```
StoryNest database setup
------------------------
Target: mysql://root@127.0.0.1:3306/storynest

1/3  Creating tables ...
2/3  Loading the sample library ...
3/3  Creating demo accounts ...

Done.
  6 accounts, 24 titles, 18 tags.
```

> **Careful:** the script **drops** any existing `storynest` database. It
> refuses to run if one already contains accounts — use `npm run db:reset` when
> you really do want to wipe and start again.

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

---

## 7. Sign in and look around

| Role | Sign in with | Password | What to look at |
|---|---|---|---|
| **Administrator** | `admin@storynest.local` | `Admin123!` | *Admin* → every account, the catalogue, reports, audit log |
| **Adult** | `parent@storynest.local` | `Parent123!` | *Family* → Leo and Ada, their controls, one pending request |
| **Adult** | `daniel@storynest.local` | `Parent123!` | A second family, so the admin list is not trivial |
| **Child** | `leo` | `storynest1` | Age 8, mysteries blocked, 60 min/day |
| **Child** | `ada` | `storynest1` | Age 11, sci-fi blocked, 90 min/day |
| **Child** | `sam` | `storynest1` | Age 6, 45 min/day (belongs to Daniel) |
| **Guest** | *don't sign in* | — | Browsing works; saving and Story Chat ask you to sign in |

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
5. Open **Story Chat** as Leo and ask for *"a detective mystery"*. It says it
   cannot find one, rather than offering something else and calling it a
   mystery — the chatbot only ever searches inside what Leo is allowed to see.

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
│   ├── schema.sql          # all 20 tables — drops and recreates the database
│   └── seed.sql            # sample titles, tags and badges
├── scripts/
│   └── setup-db.js         # runs both SQL files, then creates the demo accounts
├── server/
│   ├── index.js            # Express app: middleware, routes, static files
│   ├── config.js           # reads .env
│   ├── db.js               # MySQL connection pool + query helpers
│   ├── middleware/
│   │   ├── auth.js         # reads the session cookie, requireAuth / requireRole
│   │   └── error.js        # turns thrown errors into clean JSON
│   ├── routes/
│   │   ├── auth.js         # register, login, logout, own profile
│   │   ├── content.js      # library, search, one title, progress, reviews
│   │   ├── me.js           # favourites, watchlist, badges, notifications, requests
│   │   ├── children.js     # adult: child accounts, parental controls, requests
│   │   ├── chat.js         # Story Chat sessions and messages
│   │   └── admin.js        # users, catalogue, reports, announcements, audit log
│   └── utils/
│       ├── access.js       # who may see what — the parental-control rules
│       ├── chatbot.js      # the offline Story Chat recommender
│       ├── badges.js       # automatic badge awards
│       ├── audit.js        # writes audit_logs
│       ├── validate.js     # input checking
│       └── errors.js       # ApiError + asyncHandler
├── public/                 # the front end (plain HTML, CSS and JavaScript)
│   ├── index.html          # home page — the approved wireframe
│   ├── library.html watch.html content.html read.html chat.html
│   ├── login.html register.html account.html parent.html admin.html about.html
│   ├── css/styles.css
│   └── js/                 # api.js, app.js (shared) + one file per page
├── .env.example
├── package.json
└── INSTALLATION.md
```

---

## 10. Notes for the marker / next developer

**The four kinds of user**

| | Guest | Child | Adult | Administrator |
|---|---|---|---|---|
| Browse the library | ✅ whole catalogue | ✅ **filtered by their parent** | ✅ | ✅ |
| Save favourites, track progress, earn badges | ❌ | ✅ | ✅ | ✅ |
| Story Chat | ❌ | ✅ (filtered) | ✅ | ✅ |
| Ask to unlock a blocked title | — | ✅ | — | — |
| Create and manage child accounts | ❌ | ❌ | ✅ **their own children only** | ✅ all |
| Set age limits, blocked genres, screen time | ❌ | ❌ | ✅ | ✅ |
| See every account on the site | ❌ | ❌ | ❌ | ✅ |
| Edit the catalogue, handle reports, post announcements | ❌ | ❌ | ❌ | ✅ |

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

**The Story Chat is deliberately not an LLM.** `server/utils/chatbot.js` reads
the child's message for a genre, format, length or age, then ranks the library
with SQL. That keeps the app runnable with no API key and no internet
connection, and it means every suggestion passes through the same parental
filter as the library. It is also careful not to overstate: if a child asks for
a mystery and their parent has blocked mysteries, it says it could not find one
instead of offering something else under that name. To swap in a real model,
replace `generateReply()` — the routes only depend on its
`{reply, contentIds}` return shape.

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
