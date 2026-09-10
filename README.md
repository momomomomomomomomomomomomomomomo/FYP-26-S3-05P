# StoryNest

*Where every story finds a home.*

An interactive library of books and videos for children, built as a Node.js +
Express + MySQL web application. Children browse a library that has already been
filtered for them; the adults who look after them decide what that library
contains.

**→ [INSTALLATION.md](INSTALLATION.md) — set-up instructions, demo logins, and notes for the marker.**

Quick start, once Node 18+ and MySQL 8+ are installed:

```bash
npm install
cp .env.sample .env     # then put your MySQL password in it
npm run db:setup
npm start                # http://localhost:3000
```

---

## The four kinds of user

| | Guest | Child | Adult | Administrator |
|---|---|---|---|---|
| Browse the library | whole catalogue | **filtered by their parent**, simplified | ✅ | ✅ |
| Preview a title before opening it | ✅ | ✅ | ✅ | ✅ |
| Favourites, watchlist, progress, badges | favourites by email | ✅ | ✅ | ✅ |
| React to a title with an emoji | — | ✅ | ✅ | ✅ |
| Story Chat | — | ✅ (filtered) | ✅ | ✅ |
| Ask to unlock a blocked title | — | ✅ | — | — |
| Create and manage child accounts | — | — | **their own children** | all |
| Age limits, blocked genres, screen time | — | — | ✅ | ✅ |
| See every account on the site | — | — | — | ✅ |
| Catalogue, reports, announcements, audit log | — | — | — | ✅ |

A Guest is simply an unauthenticated visitor — there is no guest row in `users`.

## How a child's library is filtered

All filtering happens in SQL, in `server/utils/access.js`, so a hidden title is
never sent to the browser. A title is visible to a child when:

```
(age_rating <= max_age  AND  none of its tags are blocked for them)
OR  a parent has APPROVED it for them
```

If `parental_controls.allow_content` is off, only approved titles appear.
`max_age` falls back to the child's own age when no limit is set.

## Features

- **Library** — search titles, blurbs, authors *and* topics, filter by format,
  genre, reading level and age, sort; book and video titles with generated cover
  art (no image files needed). Every cover offers a **preview** — the blurb, the
  opening lines and a trailer link if one is set — which a Guest may open too.
  Children get the same catalogue with a **simplified view**: no sort or level
  menus, big topic chips, and their grown-up's filter still applied.
- **Story Chat** — an offline, rules-based recommender that searches the
  library. It respects the same parental filter as everything else, and it will
  not claim to have found a genre it did not find.
- **Reading** — progress tracking, favourites, watchlist, reviews and ratings,
  one-tap **emoji reactions** for readers who would rather not write, and seven
  automatic badges. Visitors without an account can favourite against an email
  address; those favourites move into the account when that address registers.
- **Family page** (adults) — create child accounts with a login ID instead of an
  email, set age limits, blocked genres and daily screen time, approve or refuse
  unlock requests, and read each child's activity.
- **Administration** — every account, the catalogue (including **bulk CSV
  import** and the **category vocabulary** behind the filters), reported content,
  site-wide announcements, and the full audit trail.

## Stack

Node.js 18+ · Express 4 · MySQL 8 · bcryptjs · JSON Web Tokens in an httpOnly
cookie. The front end is plain HTML, CSS and JavaScript served by the same
server — no build step, no framework, no bundler.

## Layout

```
database/   schema.sql (22 tables) and seed.sql (sample library)
scripts/    setup-db.js — one command to build the database
server/     Express app: config, db pool, middleware, routes, access rules
public/     the front end: one HTML file and one JS file per page
```

The API is documented by section in `INSTALLATION.md` §9–10.
