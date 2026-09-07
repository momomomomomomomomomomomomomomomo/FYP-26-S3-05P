-- =============================================================================
-- StoryNest - sample library data (tags, badges, content)
-- =============================================================================
-- User accounts are NOT created here: they need bcrypt-hashed passwords, so
-- `npm run db:setup` creates them in Node after running this file.
-- =============================================================================
USE storynest;

-- -----------------------------------------------------------------------------
-- Tags
-- -----------------------------------------------------------------------------
INSERT INTO tags (tag_name, category) VALUES
  ('Fantasy',     'GENRE'),
  ('Adventure',   'GENRE'),
  ('Sci-Fi',      'GENRE'),
  ('Mystery',     'GENRE'),
  ('Fairy Tale',  'GENRE'),
  ('Humour',      'GENRE'),
  ('Poetry',      'GENRE'),
  ('Non-Fiction', 'GENRE'),
  ('Friendship',  'THEME'),
  ('Courage',     'THEME'),
  ('Family',      'THEME'),
  ('Kindness',    'THEME'),
  ('Animals',     'TOPIC'),
  ('Space',       'TOPIC'),
  ('Nature',      'TOPIC'),
  ('History',     'TOPIC'),
  ('Science',     'TOPIC'),
  ('Dinosaurs',   'TOPIC');

-- -----------------------------------------------------------------------------
-- Badges  (awarded automatically, see server/utils/badges.js)
-- -----------------------------------------------------------------------------
INSERT INTO badges (badge_name, description, required_count) VALUES
  ('First Steps',    'Finished your very first story.',          1),
  ('Page Turner',    'Finished 5 stories.',                      5),
  ('Bookworm',       'Finished 15 stories.',                    15),
  ('Story Explorer', 'Started 10 different titles.',            10),
  ('Critic',         'Wrote 3 reviews to help other readers.',   3),
  ('Curator',        'Saved 5 titles to your favourites.',       5),
  ('Chatterbox',     'Asked the Story Chat 10 questions.',      10);

-- -----------------------------------------------------------------------------
-- Content
-- -----------------------------------------------------------------------------
-- age_rating = minimum recommended age.
-- cover_image_url is left NULL on purpose: the front end draws a generated
-- cover from the title so the app works with no internet connection. Put a
-- URL (or /uploads/... path) there and it will be used instead.
INSERT INTO content
  (content_type, title, description, author_creator, age_rating, reading_level, language, duration_minutes, external_link)
VALUES
  ('BOOK','The Lantern of Little Hollow','A shy fox lights the way home for a village that has forgotten how to be brave.','Mira Halloway',6,'BEGINNER','English',18,NULL),
  ('BOOK','Pip and the Paper Dragon','Pip folds a dragon out of homework and it refuses to stay on the page.','Otis Vance',5,'BEGINNER','English',15,NULL),
  ('BOOK','The Girl Who Mapped the Rain','Nell charts every puddle in her town and discovers a river nobody remembers.','Ada Rennick',8,'INTERMEDIATE','English',35,NULL),
  ('BOOK','Moonboots','A pair of secondhand boots take Jonah for a walk across the sky.','Sam Okonkwo',7,'BEGINNER','English',22,NULL),
  ('BOOK','The Clockwork Orchard','Apples that tick, a gardener who cannot sleep, and one very stubborn robin.','Elise Marchetti',9,'INTERMEDIATE','English',48,NULL),
  ('BOOK','Detective Duckling','A duckling with a magnifying glass solves the case of the missing pond.','Ravi Chandra',6,'BEGINNER','English',20,NULL),
  ('BOOK','Whale Song for Beginners','Two friends learn to speak whale, badly, and make a friend anyway.','Nia Osei',7,'BEGINNER','English',25,NULL),
  ('BOOK','The Last Library on Mars','When the colony powers down, twelve-year-old Juno keeps the stories running.','Hector Salas',10,'ADVANCED','English',65,NULL),
  ('BOOK','Grandpa Was a Pirate (Probably)','Every story Grandpa tells gets bigger. This one has a kraken.','Tom Bridger',6,'BEGINNER','English',19,NULL),
  ('BOOK','The Quiet Museum','After closing time the exhibits argue about who has the better century.','Fen Marlowe',9,'INTERMEDIATE','English',44,NULL),
  ('BOOK','Bramble Street Detectives','Four neighbours, one stolen trophy, and a very suspicious cat.','Ravi Chandra',9,'INTERMEDIATE','English',52,NULL),
  ('BOOK','How to Grow a Thunderstorm','A funny, careful guide to weather, with experiments you can actually do.','Dr. Yuki Tanabe',8,'INTERMEDIATE','English',40,NULL),
  ('BOOK','The Dinosaur Who Was Late','Trixie the triceratops misses the meteor because she stopped to help a friend.','Otis Vance',5,'BEGINNER','English',14,NULL),
  ('BOOK','Verses for Very Small Giants','Short, silly poems for people who are bigger on the inside.','Maud Ellery',5,'BEGINNER','English',12,NULL),
  ('BOOK','The Keeper of Lost Kites','Every kite that ever escaped ends up in one place, and it needs a librarian.','Mira Halloway',8,'INTERMEDIATE','English',38,NULL),
  ('BOOK','Signal from the Sixth Moon','A radio built from junk picks up a voice that already knows Ada''s name.','Hector Salas',11,'ADVANCED','English',70,NULL),
  ('VIDEO','Storytime: The Lantern of Little Hollow','A narrated read-along of the picture book, with music.','StoryNest Studio',5,'BEGINNER','English',16,NULL),
  ('VIDEO','How Do Volcanoes Work?','An animated tour from magma chamber to eruption, in eight minutes.','StoryNest Studio',8,'INTERMEDIATE','English',8,NULL),
  ('VIDEO','Meet the Deep Sea','Bioluminescent creatures, explained without the nightmares.','Blue Planet Kids',7,'BEGINNER','English',11,NULL),
  ('VIDEO','Draw a Dragon in 10 Minutes','Follow-along drawing class for beginners. Paper and pencil only.','Studio Pomelo',6,'BEGINNER','English',10,NULL),
  ('VIDEO','The History of the Alphabet','Where our letters came from, from clay tablets to keyboards.','StoryNest Studio',10,'ADVANCED','English',14,NULL),
  ('VIDEO','Space Station Tour','What a day in orbit actually looks like, hour by hour.','Orbit Academy',9,'INTERMEDIATE','English',18,NULL),
  ('VIDEO','Five Experiments With Water','Simple science you can run at the kitchen sink.','Dr. Yuki Tanabe',6,'BEGINNER','English',12,NULL),
  ('VIDEO','Bedtime Lullabies','Twenty minutes of calm songs for the end of the day.','StoryNest Studio',3,'BEGINNER','English',20,NULL);

-- Link content to tags by name so the ids do not have to be hard-coded.
INSERT INTO content_tags (content_id, tag_id)
SELECT c.content_id, t.tag_id
FROM content c
JOIN (
  SELECT 'The Lantern of Little Hollow' AS title, 'Fantasy' AS tag_name UNION ALL
  SELECT 'The Lantern of Little Hollow', 'Courage' UNION ALL
  SELECT 'The Lantern of Little Hollow', 'Animals' UNION ALL
  SELECT 'Pip and the Paper Dragon', 'Fantasy' UNION ALL
  SELECT 'Pip and the Paper Dragon', 'Humour' UNION ALL
  SELECT 'The Girl Who Mapped the Rain', 'Adventure' UNION ALL
  SELECT 'The Girl Who Mapped the Rain', 'Nature' UNION ALL
  SELECT 'Moonboots', 'Fantasy' UNION ALL
  SELECT 'Moonboots', 'Adventure' UNION ALL
  SELECT 'The Clockwork Orchard', 'Mystery' UNION ALL
  SELECT 'The Clockwork Orchard', 'Fantasy' UNION ALL
  SELECT 'Detective Duckling', 'Mystery' UNION ALL
  SELECT 'Detective Duckling', 'Animals' UNION ALL
  SELECT 'Detective Duckling', 'Humour' UNION ALL
  SELECT 'Whale Song for Beginners', 'Friendship' UNION ALL
  SELECT 'Whale Song for Beginners', 'Animals' UNION ALL
  SELECT 'The Last Library on Mars', 'Sci-Fi' UNION ALL
  SELECT 'The Last Library on Mars', 'Space' UNION ALL
  SELECT 'The Last Library on Mars', 'Courage' UNION ALL
  SELECT 'Grandpa Was a Pirate (Probably)', 'Humour' UNION ALL
  SELECT 'Grandpa Was a Pirate (Probably)', 'Family' UNION ALL
  SELECT 'The Quiet Museum', 'Fantasy' UNION ALL
  SELECT 'The Quiet Museum', 'History' UNION ALL
  SELECT 'Bramble Street Detectives', 'Mystery' UNION ALL
  SELECT 'Bramble Street Detectives', 'Friendship' UNION ALL
  SELECT 'How to Grow a Thunderstorm', 'Non-Fiction' UNION ALL
  SELECT 'How to Grow a Thunderstorm', 'Science' UNION ALL
  SELECT 'The Dinosaur Who Was Late', 'Dinosaurs' UNION ALL
  SELECT 'The Dinosaur Who Was Late', 'Kindness' UNION ALL
  SELECT 'Verses for Very Small Giants', 'Poetry' UNION ALL
  SELECT 'Verses for Very Small Giants', 'Humour' UNION ALL
  SELECT 'The Keeper of Lost Kites', 'Fantasy' UNION ALL
  SELECT 'The Keeper of Lost Kites', 'Adventure' UNION ALL
  SELECT 'Signal from the Sixth Moon', 'Sci-Fi' UNION ALL
  SELECT 'Signal from the Sixth Moon', 'Space' UNION ALL
  SELECT 'Storytime: The Lantern of Little Hollow', 'Fantasy' UNION ALL
  SELECT 'Storytime: The Lantern of Little Hollow', 'Animals' UNION ALL
  SELECT 'How Do Volcanoes Work?', 'Science' UNION ALL
  SELECT 'How Do Volcanoes Work?', 'Non-Fiction' UNION ALL
  SELECT 'Meet the Deep Sea', 'Nature' UNION ALL
  SELECT 'Meet the Deep Sea', 'Animals' UNION ALL
  SELECT 'Draw a Dragon in 10 Minutes', 'Fantasy' UNION ALL
  SELECT 'The History of the Alphabet', 'History' UNION ALL
  SELECT 'The History of the Alphabet', 'Non-Fiction' UNION ALL
  SELECT 'Space Station Tour', 'Space' UNION ALL
  SELECT 'Space Station Tour', 'Science' UNION ALL
  SELECT 'Five Experiments With Water', 'Science' UNION ALL
  SELECT 'Bedtime Lullabies', 'Kindness'
) AS m ON m.title = c.title
JOIN tags t ON t.tag_name = m.tag_name;
