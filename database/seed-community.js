'use strict';
const bcrypt = require('bcryptjs');

/**
 * Fills the library with the traffic a working site would already have:
 * families with accounts, reviews on every title, reading progress behind
 * those reviews, reactions and saved favourites.
 *
 * Two rules shape all of it.
 *
 * Deterministic. Every number comes from a seeded generator, so
 * `npm run db:reset` rebuilds the identical community every time. A demo whose
 * ratings move between runs is worse than no demo.
 *
 * Internally consistent. A review implies somebody read the thing, so every
 * reviewer gets progress on that title. A child only reviews titles inside
 * their own age limit, because a child reviewing a book their controls forbid
 * is exactly the contradiction that gives a seeded database away.
 */

// --- a small deterministic generator ----------------------------------------
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Amara', 'Beatriz', 'Caleb', 'Dilan', 'Esme', 'Farida', 'Gabriel', 'Hana', 'Imran', 'Jonas',
  'Kemi', 'Lucia', 'Mateo', 'Nadia', 'Oskar', 'Priya', 'Quinn', 'Rosa', 'Samira', 'Tobias',
  'Uma', 'Victor', 'Wren', 'Yusuf', 'Zoe', 'Aisha', 'Bruno', 'Clara', 'Dmitri', 'Elena',
  'Finn', 'Greta', 'Hugo', 'Ines', 'Jamal', 'Kirsty', 'Lars', 'Maeve', 'Niamh', 'Omar',
];
const LAST = [
  'Abara', 'Bianchi', 'Costa', 'Doyle', 'Eriksen', 'Ferreira', 'Grant', 'Haruna', 'Ivanov',
  'Jensen', 'Kaur', 'Lindqvist', 'Mwangi', 'Novak', 'Oyelaran', 'Petrov', 'Quintero', 'Rahman',
  'Silva', 'Thorne', 'Ueda', 'Varga', 'Whitfield', 'Yilmaz', 'Zielinski', 'Bello', 'Chaudhry',
  'Delacroix', 'Egwu', 'Fischer',
];
const CHILD_FIRST = [
  'Alfie', 'Bea', 'Cass', 'Dot', 'Eli', 'Freya', 'Gus', 'Hattie', 'Ira', 'Jo',
  'Kit', 'Lena', 'Milo', 'Nell', 'Otto', 'Poppy', 'Rafi', 'Sia', 'Tam', 'Vida',
  'Wilf', 'Xan', 'Yara', 'Zed', 'Bram', 'Cleo', 'Dara', 'Ezra', 'Fen', 'Gia',
];

// --- review voices -----------------------------------------------------------
// Slots: {title} {age} {kid} {pages}. Written to sound like a parent or a child
// typing on a phone, which is mostly short and mostly about their own evening.
const ADULT_5 = [
  'Read it twice in one night. {kid} has asked for it again tonight.',
  'This is the one that finally got {kid} reading on their own. Cannot overstate it.',
  'Beautifully judged for the age. Nothing talks down to them.',
  'We have had this on repeat for a fortnight. I can recite most of it.',
  'Exactly the right length for a school night.',
  'My two are {age} and six and both sat still for the whole thing, which never happens.',
  'The ending had me slightly welling up, which I was not expecting on a Tuesday.',
  'Honestly one of the best things in the library. Thank you to whoever added it.',
  'Pitched perfectly. {kid} understood every word and still had questions.',
  'We read a chapter a night and they begged for two.',
  'Lovely. Quiet, kind, and no shouting in it anywhere.',
  'Brilliant for a reluctant reader. Short pages do a lot of work here.',
  'I have bought a paper copy after reading this one on here.',
  'Read it on a long train journey and it covered the whole thing.',
  'Read this to a very tired six year old and it was the right call.',
  'No notes. We have read it four nights running.',
  'The kind of thing that makes bedtime easier rather than harder.',
  'I was expecting to skim-read and ended up properly invested.',
  'One of those where the pictures and the words are doing the same job.',
  '{kid} has started telling other people the story, badly, which is the highest praise.',
  'Gorgeous. We slowed down for the last few pages on purpose.',
  'Handled a tricky subject without once being heavy about it.',
  'A proper story with a beginning and an end. Harder to find than it should be.',
  'Their teacher asked where we got it.',
  'We have three favourites in this house and this has gone straight in.',
  'Quietly funny in a way that works for both of us.',
  'Finished it and they immediately asked whether the author had written others.',
  'The sort of book you remember being read to you.',
];
const ADULT_4 = [
  'Really good. A couple of pages went over {kid}\'s head but they did not mind.',
  'We enjoyed this. Slightly longer than our usual bedtime slot.',
  'Very good indeed, though I would say nearer {age} than the listed age.',
  'Strong start, slightly slow in the middle, lovely finish.',
  'Good one. We will come back to it when they are a bit older.',
  'Enjoyed it more than I expected to, which is the real test.',
  'Solid. Not our favourite but we read it all the way through happily.',
  'Nice and gentle. Took us three evenings.',
  'My {age} year old liked it; the younger one lost interest halfway.',
  'Well written. Would have liked a few more pictures.',
  'Good vocabulary without being difficult. Useful for us.',
  'Good. A little gentler than {kid} usually goes for, but it landed.',
  'Enjoyable. We skipped two pages in the middle and lost nothing.',
  'Better than I expected from the cover.',
  'Read it over a weekend. Would recommend to friends with a similar age.',
  'Good story, slightly abrupt ending for our taste.',
  'We liked it. A few words needed explaining, which is no bad thing.',
  'Comfortably within {kid}\'s reach and still interesting.',
  'A good one for a car journey.',
  'Nicely done. Not one we will reread, but no complaints.',
  'Held their attention right through, which earns it four.',
  'Sweet without being sickly. We will look for more by this author.',
  'Thoughtful. The middle section is the strongest part.',
  'We liked this. The quieter pages are the best bits.',
];
const ADULT_3 = [
  'Fine. Did not grab us but nothing wrong with it.',
  'A bit long for a bedtime read in our house.',
  'Pleasant enough. We did not finish it in one sitting and did not go back for a few days.',
  'Good idea, slightly slow in the telling.',
  'Reasonable. Probably better for a child a year or two older than mine.',
  'It was all right. {kid} was not asking for it again.',
  'Some lovely pages and some that dragged.',
  'Perfectly fine. We have read better and worse this month.',
  'Took a few pages to get going and by then they had wandered off.',
  'Decent story, a bit flat in the telling.',
  'I liked it more than {kid} did.',
  'Not bad. The pictures are doing most of the work.',
  'Readable. Nothing in it stayed with either of us.',
  'We got through it. That is about all I can say.',
  'Middling. Might suit a quieter child better than mine.',
  'Good bones, could have done with another pass.',
  'Did the job on a wet afternoon.',
];
const ADULT_2 = [
  'Not for us, I am afraid. We stopped about halfway.',
  'Too long for the age it is listed at, in our experience.',
  'I could not get {kid} interested in this one at all.',
  'We put this one down after a few pages and did not pick it back up.',
  'A bit old for the age it is listed at, I thought.',
  'Not what we were after. Others here have suited us much better.',
  'Hard going for a bedtime read. We gave up.',
  'The story never quite arrived.',
  'Did not work for us, though I can see who it might.',
  'Well made but it did not hold them.',
];
const CHILD_5 = [
  'I read it twice.',
  'This is my favourite one.',
  'I liked the bit at the end best.',
  'I read it all by myself!',
  'So good. I want another one like this.',
  'I laughed at the funny part.',
  'I have read this four times now.',
  'Please can there be more of these.',
  'I liked the pictures and the words.',
  'The best book I have read this week.',
  'I told my friend about it and she read it too.',
  'I read it in one go and then again.',
  'The best bit is near the middle.',
  'I liked this one a lot!',
  'I want to read it to my little brother.',
  'It made me laugh twice.',
  'I like the drawings.',
  'I have told everyone about this book.',
  'This one is going to be my favourite for ages.',
  'I read it on the bus and nearly missed my stop.',
  'So so good.',
  'I did not know what was going to happen at the end.',
  'I wish it was longer.',
  'I did not want it to finish.',
];
const CHILD_4 = [
  'It was really good.',
  'I liked it. It was a bit long.',
  'Good but I liked the other one more.',
  'I liked the beginning best.',
  'Quite good. Some words were tricky.',
  'I read it in two days.',
  'I liked it but the middle was a bit slow.',
  'Pretty good. I read it in one afternoon.',
  'I liked the people in it.',
  'Good. Not as good as the last one I read.',
  'It was fun. Some bits were a bit easy for me.',
  'I liked the end more than the start.',
  'Good book. I would read another one.',
  'I enjoyed it, there were just a lot of names to remember.',
  'Nearly my favourite.',
  'Good story. A bit sad in the middle.',
];
const CHILD_3 = [
  'It was okay.',
  'I did not finish it yet.',
  'Some of it was good.',
  'It was all right.',
  'I only liked some parts.',
  'A bit boring in the middle.',
  'It was fine but I forgot what happened.',
  'I might finish it later.',
  'Not my favourite but it was okay.',
  'I liked one bit.',
  'A bit slow but I liked the end.',
];

const CHILD_2 = [
  'I did not really like it.',
  'It was too long for me.',
  'I stopped reading it.',
  'I did not understand some of it.',
  'Not for me.',
  'I found it hard.',
];

const VOICES = {
  ADULT: { 5: ADULT_5, 4: ADULT_4, 3: ADULT_3, 2: ADULT_2 },
  CHILD: { 5: CHILD_5, 4: CHILD_4, 3: CHILD_3, 2: CHILD_2 },
};

/** A handful of reviews that name something only this book contains. */
const SPECIFIC = {
  'The Lighthouse That Forgot to Sleep': [
    'THE WATCH IS SHARED is now a thing we say in this house.',
    'One hundred and six stairs. My daughter counted them out loud with her.',
  ],
  'Rocket Jam': ['"Far is up, lying down" has been quoted at me four times this week.'],
  'Detective Marigold and the Missing Marbles': [
    'The page about THINGS I WANT TO BE TRUE is worth the whole book.',
    'My son has started a notebook with a hard red cover. Make of that what you will.',
  ],
  'The Boy Who Counted Clouds': ['NOTICING = NO NUMBER. We have written it on the fridge.'],
  'Nell Finds the Ninth Moon': [
    'A genuinely good explanation of why error bars matter, hidden inside a story.',
    'My eleven year old went and looked up Kepler-62f afterwards.',
  ],
  'The Mountain That Grew Overnight': [
    'I did not know the lightning killed more people than the lava. Neither did my son.',
    'Used this for a school project on volcanoes and it was better than the textbook.',
  ],
  'Ant Country': ['We spent an hour on the patio after this, following a trail. Worth it.'],
  'Whale Fall': ['Grim in the best way. The bone-eating worms got a genuine "no way" out of him.'],
  'Starling City': ['We went and watched a murmuration because of this. Picked one bird. Lost it.'],
  'The Bee That Would Not Dance': ['A really kind way to say that getting it wrong is part of it.'],
  'Sprocket Learns to Wait': ['My daughter was in hospital in March. This one landed hard.'],
  'Soup for Forty': ['The rice trick actually works. We used it at a church lunch.'],
  'Mo and the Mountain of Homework': [
    'We put the homework on the wall. It worked. I am slightly annoyed about how well.',
  ],
  'How to Grow a Thunderstorm': [
    'The flash-to-bang counting is now a family routine. Useful and a bit alarming.',
  ],
  'The Girl With the Loudest Laugh': [
    'As the parent of a loud one, this made me cry a bit. Thank you.',
  ],
  'The Last Library on Mars': ['We have started reading a chapter aloud at dinner because of this.'],
};

// --- the work ----------------------------------------------------------------
/**
 * Removes a previous demo community in full.
 *
 * The children have to go before the parents: a child is a user row in its own
 * right, so deleting the parent only cascades the relationship and leaves the
 * child — and its reviews — behind as an orphan.
 */
async function clearCommunity(conn) {
  const [kids] = await conn.execute(
    `DELETE u FROM users u
       JOIN parent_child_relationships r ON r.child_id = u.user_id
       JOIN users p ON p.user_id = r.parent_id
      WHERE u.role = 'CHILD' AND p.email LIKE '%@example.com'`,
  );
  const [parents] = await conn.execute(
    "DELETE FROM users WHERE role = 'ADULT' AND email LIKE '%@example.com'",
  );
  return { children: kids.affectedRows, adults: parents.affectedRows };
}

async function seedCommunity(conn, { log = () => {} } = {}) {
  // Always start from nothing, so running this twice produces one community
  // rather than two. Everything it writes hangs off these users, so clearing
  // them clears the reviews, progress, reactions and favourites with them.
  const cleared = await clearCommunity(conn);
  if (cleared.adults || cleared.children) {
    log(`  cleared a previous community (${cleared.adults} adults, ${cleared.children} children)`);
  }

  // Everything dated in here is measured from this fixed point rather than
  // from today, so the same seed produces the same rows on any machine on any
  // day. Without it the review dates and the children's birthdays slide with
  // the calendar and two installations stop matching.
  const REFERENCE = Date.UTC(2026, 10, 2); // 2 November 2026
  const REFERENCE_YEAR = 2026;

  const rand = makeRandom(20260101);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // Same as pick, but avoids wording already used on the title in hand. Two
  // identical sentences side by side on one page is the thing that gives a
  // seeded library away, so it is worth the extra pass.
  const pickFresh = (arr, seen) => {
    const fresh = arr.filter((t) => !seen.has(t));
    return pick(fresh.length ? fresh : arr);
  };

  // One shared password for every demo family. They exist to populate the
  // library, not to be signed into individually.
  const hash = await bcrypt.hash('Reader123!', 12);

  // ---- families ------------------------------------------------------------
  const FAMILIES = 26;
  const adults = [];
  const children = [];
  const usedLogins = new Set();

  for (let i = 0; i < FAMILIES; i += 1) {
    const surname = LAST[i % LAST.length];
    const adultName = `${FIRST[i % FIRST.length]} ${surname}`;
    const email = `${FIRST[i % FIRST.length].toLowerCase()}.${surname.toLowerCase()}@example.com`;
    if (usedLogins.has(email)) continue;
    usedLogins.add(email);

    const dob = `19${70 + Math.floor(rand() * 20)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`;
    const [res] = await conn.execute(
      `INSERT INTO users (role, name, email, password, dob, parental_consent, account_status)
       VALUES ('ADULT', ?, ?, ?, ?, TRUE, 'ACTIVE')`,
      [adultName, email, hash, dob],
    );
    const parentId = Number(res.insertId);
    adults.push({ id: parentId, name: adultName });

    // One or two children each, so the family sizes are not uniform.
    const kids = rand() < 0.45 ? 2 : 1;
    for (let k = 0; k < kids; k += 1) {
      const first = CHILD_FIRST[(i * 2 + k) % CHILD_FIRST.length];
      const login = `${first.toLowerCase()}${i}${k}`;
      if (usedLogins.has(login)) continue;
      usedLogins.add(login);

      const age = 5 + Math.floor(rand() * 7); // 5-11
      const year = REFERENCE_YEAR - age;
      const childDob = `${year}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`;
      const level = age <= 6 ? 'BEGINNER' : age <= 9 ? 'INTERMEDIATE' : 'ADVANCED';

      const [kidRes] = await conn.execute(
        `INSERT INTO users (role, name, email, password, dob, reading_level, parental_consent, account_status)
         VALUES ('CHILD', ?, ?, ?, ?, ?, TRUE, 'ACTIVE')`,
        [`${first} ${surname}`, login, hash, childDob, level],
      );
      const childId = Number(kidRes.insertId);

      await conn.execute(
        'INSERT INTO parent_child_relationships (parent_id, child_id) VALUES (?, ?)',
        [parentId, childId],
      );
      // Most families leave the cap at the child's own age; a few allow a year
      // above it. This is written out as a number rather than left NULL on
      // purpose: a NULL cap makes the app fall back to an age worked out from
      // the child's birthday against today's date, so a child in an imported
      // copy would quietly gain a year and see more of the library than this
      // seed intended. An explicit cap behaves the same on any date.
      const maxAge = rand() < 0.3 ? age + 1 : age;
      await conn.execute(
        `INSERT INTO parental_controls (child_id, max_age, daily_screen_limit, allow_content)
         VALUES (?, ?, ?, TRUE)`,
        [childId, maxAge, rand() < 0.35 ? 30 + Math.floor(rand() * 4) * 15 : null],
      );

      children.push({
        id: childId, name: `${first} ${surname}`, first, age, parentId,
      });
    }
  }
  log(`  ${adults.length} adult and ${children.length} child accounts`);

  // ---- who reviews ---------------------------------------------------------
  // Only the demo community writes these reviews. The hand-written ones that
  // ship with the seed stay as they are, the demo accounts a marker signs into
  // stay uncluttered, and `--reset` removes every review this script created
  // through the foreign-key cascade on these users.
  const allAdults = adults;
  const allChildren = children;

  // ---- reviews -------------------------------------------------------------
  const [titles] = await conn.execute(
    `SELECT content_id, title, content_type, age_rating,
            (SELECT COUNT(*) FROM content_pages p WHERE p.content_id = content.content_id) AS pages
       FROM content ORDER BY content_id`,
  );

  const now = REFERENCE;
  const DAY = 86400000;
  let reviews = 0;
  let progressRows = 0;
  let reactions = 0;
  let favourites = 0;

  const REACTION_EMOJI = ['\u{1F60D}', '\u{1F602}', '\u{1F62E}', '\u{1F914}', '\u{1F634}', '\u{1F44D}'];

  for (const item of titles) {
    const contentId = Number(item.content_id);
    const ageRating = item.age_rating === null ? 0 : Number(item.age_rating);

    // A per-title disposition, so some titles are loved and a few are not.
    // Derived from the id, so it never moves between runs.
    const quality = 0.55 + ((contentId * 37) % 45) / 100; // 0.55 - 0.99
    const popular = ((contentId * 17) % 10) < 4;
    const target = (popular ? 6 : 3) + Math.floor(rand() * 4); // 3-9

    // Seed the "already reviewed" set from the database, not just from this
    // loop: a reviewer may already have a hand-written review on this title,
    // and two rows for one person breaks the app's one-review-per-person rule.
    const [already] = await conn.execute(
      'SELECT user_id, review FROM feedback WHERE content_id = ?', [contentId],
    );
    const used = new Set(already.map((r) => Number(r.user_id)));
    const seenText = new Set(already.map((r) => r.review).filter(Boolean));

    for (let n = 0; n < target; n += 1) {
      // Children review roughly half of everything, and only what their own
      // age limit would actually let them open.
      const asChild = rand() < 0.45;
      const pool = asChild
        ? allChildren.filter((c) => c.age >= ageRating)
        : allAdults;
      if (!pool.length) continue;

      const reviewer = pool[Math.floor(rand() * pool.length)];
      if (used.has(reviewer.id)) continue;
      used.add(reviewer.id);

      // Rating drawn around the title's disposition.
      const roll = rand();
      let rating;
      if (roll < quality - 0.35) rating = 5;
      else if (roll < quality + 0.08) rating = 4;
      else if (roll < quality + 0.30) rating = 3;
      else rating = 2;
      if (asChild && rating === 2 && rand() < 0.7) rating = 3; // children rarely two-star

      const voice = asChild ? VOICES.CHILD : VOICES.ADULT;
      let text;
      const specific = SPECIFIC[item.title];
      // The specific reviews name something only this book contains, so a
      // repeat of one reads far worse than a repeat of a general remark. Once
      // they are used up on a title, fall through to the ordinary voice rather
      // than saying the distinctive thing twice.
      const unusedSpecific = specific ? specific.filter((t) => !seenText.has(t)) : [];
      if (!asChild && unusedSpecific.length && rating >= 4 && rand() < 0.5) {
        text = pick(unusedSpecific);
      } else {
        text = pickFresh(voice[rating] || voice[3], seenText);
      }
      seenText.add(text);

      const kid = allChildren.length ? pick(allChildren).first : 'my daughter';
      text = text
        .replace(/\{title\}/g, item.title)
        .replace(/\{age\}/g, String(Math.max(4, ageRating + Math.floor(rand() * 3))))
        .replace(/\{kid\}/g, kid)
        .replace(/\{pages\}/g, String(item.pages || 20));

      // Spread across the past twenty months, newest titles reviewed later.
      const daysAgo = 20 + Math.floor(rand() * 580);
      const when = new Date(now - daysAgo * DAY);

      await conn.execute(
        `INSERT INTO feedback (user_id, content_id, rating, review, status, created_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
        [reviewer.id, contentId, rating, text, when],
      );
      reviews += 1;

      // A review means they read it. Finished, mostly.
      const pct = rating >= 4 ? 100 : 40 + Math.floor(rand() * 60);
      await conn.execute(
        `INSERT INTO progress (user_id, content_id, percentage_completed, last_position, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE percentage_completed = GREATEST(percentage_completed, VALUES(percentage_completed))`,
        [reviewer.id, contentId, pct, Math.floor(((item.pages || 20) * pct) / 100), when],
      );
      progressRows += 1;

      if (asChild && rating >= 4 && rand() < 0.5) {
        await conn.execute(
          `INSERT IGNORE INTO content_reactions (user_id, content_id, emoji) VALUES (?, ?, ?)`,
          [reviewer.id, contentId, REACTION_EMOJI[Math.floor(rand() * REACTION_EMOJI.length)]],
        );
        reactions += 1;
      }
      if (rating === 5 && rand() < 0.4) {
        await conn.execute(
          `INSERT IGNORE INTO saved_content (user_id, content_id, list_type)
           VALUES (?, ?, 'FAVORITE')`,
          [reviewer.id, contentId],
        );
        favourites += 1;
      }
    }
  }

  return {
    adults: adults.length,
    children: children.length,
    reviews,
    progress: progressRows,
    reactions,
    favourites,
    titles: titles.length,
  };
}

module.exports = { seedCommunity, clearCommunity };
