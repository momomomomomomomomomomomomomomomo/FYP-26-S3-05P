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

## The five kinds of user

| | Guest | Child | Adult | Librarian | Administrator |
|---|---|---|---|---|---|
| Browse and preview the catalogue | whole catalogue | **filtered by their parent**, simplified | ✅ | ✅ | ✅ |
| Favourites, watchlist, progress, badges | favourites by email | ✅ | ✅ | — | — |
| Read, review or react to a title | — | ✅ | ✅ | — | — |
| Story Chat | — | ✅ (filtered) | ✅ | — | — |
| Ask to unlock a blocked title | — | ✅ | — | — | — |
| Create and manage child accounts | — | — | **their own children** | — | via the user list |
| Age limits, blocked genres, screen time | — | — | ✅ | — | — |
| See every account on the site | — | — | — | — | ✅ |
| **Add, edit and remove titles** | — | — | — | ✅ | — |
| **Categories and bulk import** | — | — | — | ✅ | — |
| Reports, announcements, audit log | — | — | — | — | ✅ |

A Guest is simply an unauthenticated visitor — there is no guest row in `users`.

**Librarian and Administrator are deliberately separate.** Cataloguing and account
administration are different duties, so neither role can do the other's work: a
librarian cannot reach accounts, reports or the audit trail, and an administrator
cannot add, edit or remove a single title. Both are enforced server-side, not just
hidden in the interface.

**Staff are not readers.** Neither role has a reader profile of its own: no
favourites, watchlist, reading progress, badges, reviews, reactions, Story Chat
or notifications, and no family page. They may browse and preview the catalogue —
a librarian has to be able to check their own shelves — and edit their own name
and password, and that is all. The reader routes reject them outright rather than
quietly building up a personal library nobody intended them to have.

Signing in takes each role where its work is: administrators land on the admin
console, librarians on the catalogue, and everyone else on the landing page.

## How a child's library is filtered

All filtering happens in SQL, in `server/utils/access.js`, so a hidden title is
never sent to the browser. A title is visible to a child when:

```
(age_rating <= max_age  AND  none of its tags are blocked for them)
OR  a parent has APPROVED it for them
```

If `parental_controls.allow_content` is off, only approved titles appear.
`max_age` falls back to the child's own age when no limit is set.

## The landing page

One page, four experiences, decided by who is looking:

- **Guest** — a welcome, then a sliding shelf of what readers have said about
  titles in the library.
- **Adult** — a greeting by name, then how each child has been getting on:
  what they finished, screen time used today, anything waiting to be approved,
  and a feed of their latest activity.
- **Child** — a greeting, the one book they are part-way through with a
  *Keep reading* button, then picks drawn from what their grown-up allows and
  weighted towards the kinds of stories they have already favourited.
- **Administrator and Librarian** — sent straight to their own dashboard.

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
- **Catalogue** (librarians) — the shelf at a glance, titles to add, edit and
  remove, **bulk CSV import**, and the **category vocabulary** behind every
  library filter. The overview flags titles with no category or no age rating,
  and titles nobody has ever opened.
- **Administration** — every account (including appointing librarians), reported
  content, site-wide announcements, and the full audit trail.

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
