-- =============================================================================
-- StoryNest - database schema (MySQL 8.0+)
-- =============================================================================
-- Running this file DROPS and recreates the `storynest` database.
--
-- Differences from the original hand-written schema (both are deliberate and
-- required by the application code):
--   1. users.email is UNIQUE. Login resolves an account by email/login-id, so
--      it has to be unique. NULL is still allowed and MySQL permits many NULLs
--      in a UNIQUE index, so children created without a login are unaffected.
--   2. A few extra indexes on columns the app filters by (role, age_rating,
--      parent/child lookups). Behaviour is identical, queries are just faster.
-- =============================================================================

DROP DATABASE IF EXISTS storynest;
CREATE DATABASE storynest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE storynest;

-- -----------------------------------------------------------------------------
-- Accounts
-- -----------------------------------------------------------------------------
-- role: 'ADMIN' | 'ADULT' | 'CHILD'   (a Guest is simply an unauthenticated
-- visitor and therefore has no row in this table)
CREATE TABLE users (
    user_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    role VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    dob DATE NOT NULL,
    reading_level VARCHAR(50),
    parental_consent BOOLEAN DEFAULT FALSE,
    account_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role (role)
);

-- Which adult owns which child account.
CREATE TABLE parent_child_relationships (
    rlnship_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    parent_id BIGINT NOT NULL,
    child_id BIGINT NOT NULL,
    rlnship_type VARCHAR(50) DEFAULT 'PARENT',
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_parent_child (parent_id, child_id),
    INDEX idx_pcr_child (child_id)
);

-- One row per child. max_age = highest content age-rating the child may open.
-- daily_screen_limit is in minutes; NULL on either column means "no limit".
CREATE TABLE parental_controls (
    control_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    child_id BIGINT UNIQUE NOT NULL,
    max_age INT NULL,
    daily_screen_limit INT NULL,
    allow_content BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Genres a specific child may not see (matched against tags.tag_name).
CREATE TABLE child_blocked_genres (
    child_id BIGINT NOT NULL,
    blocked_genre VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (child_id, blocked_genre),
    FOREIGN KEY (child_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- Library
-- -----------------------------------------------------------------------------
-- content_type: 'BOOK' | 'VIDEO'
-- age_rating:   minimum recommended age, in years
CREATE TABLE content (
    content_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    content_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    author_creator VARCHAR(255),
    age_rating INT,
    reading_level VARCHAR(50),
    language VARCHAR(50) DEFAULT 'English',
    duration_minutes INT,
    cover_image_url TEXT,
    external_link TEXT,
    created_by BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_content_age (age_rating)
);

CREATE TABLE tags (
    tag_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tag_name VARCHAR(100) UNIQUE NOT NULL,
    category ENUM('GENRE', 'THEME', 'TOPIC') DEFAULT 'GENRE'
);

CREATE TABLE content_tags (
    content_id BIGINT NOT NULL,
    tag_id BIGINT NOT NULL,
    PRIMARY KEY (content_id, tag_id),
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE,
    INDEX idx_content_tags_tag (tag_id)
);

CREATE TABLE saved_content (
    saved_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    content_id BIGINT NOT NULL,
    list_type ENUM('FAVORITE', 'WATCHLIST') NOT NULL,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_content_list (user_id, content_id, list_type)
);

CREATE TABLE feedback (
    feedback_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    content_id BIGINT NOT NULL,
    rating INT,
    review TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE
);

CREATE TABLE progress (
    progress_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    content_id BIGINT NOT NULL,
    percentage_completed DECIMAL(5,2) DEFAULT 0.00,
    last_position INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_progress (user_id, content_id)
);

-- -----------------------------------------------------------------------------
-- Story Chat
-- -----------------------------------------------------------------------------
CREATE TABLE chat_sessions (
    session_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE chat_msgs (
    message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    sender ENUM('USER', 'CHATBOT') NOT NULL,
    message_text TEXT NOT NULL,
    feedback ENUM('LIKE', 'DISLIKE') NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
);

-- Titles the chatbot suggested inside a given reply.
CREATE TABLE message_recommendations (
    message_id BIGINT NOT NULL,
    content_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, content_id),
    FOREIGN KEY (message_id) REFERENCES chat_msgs(message_id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- Requests, rewards, messaging, moderation
-- -----------------------------------------------------------------------------
-- A child asking a parent for access to a title their controls currently block.
CREATE TABLE content_requests (
    request_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    content_id BIGINT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    decision_by BIGINT NULL,
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    decision_date TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
    FOREIGN KEY (decision_by) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_requests_user_status (user_id, status)
);

CREATE TABLE badges (
    badge_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    badge_name VARCHAR(100) NOT NULL,
    description TEXT,
    required_count INT DEFAULT 1
);

CREATE TABLE user_badges (
    user_id BIGINT NOT NULL,
    badge_id BIGINT NOT NULL,
    awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, badge_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (badge_id) REFERENCES badges(badge_id) ON DELETE CASCADE
);

CREATE TABLE notifications (
    notif_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read_status BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE reports (
    report_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    content_id BIGINT NULL,
    feedback_id BIGINT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE SET NULL,
    FOREIGN KEY (feedback_id) REFERENCES feedback(feedback_id) ON DELETE SET NULL
);

CREATE TABLE announcements (
    announcement_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Every meaningful action lands here. Parents read their children's rows,
-- admins read everything.
CREATE TABLE audit_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    parent_id BIGINT NULL,
    content_id BIGINT NULL,
    actor_role ENUM('ADULT', 'CHILD', 'ADMIN') NOT NULL,
    activity_type VARCHAR(50) NOT NULL,
    description TEXT NULL,
    target_table VARCHAR(100) NULL,
    target_id BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES users(user_id) ON DELETE SET NULL,
    FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE SET NULL,
    INDEX idx_parent_children_logs (parent_id, user_id),
    INDEX idx_audit_activity_date (activity_type, created_at)
);

CREATE INDEX idx_content_title ON content(title);
CREATE INDEX idx_content_type ON content(content_type);
CREATE INDEX idx_chat_session ON chat_msgs(session_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_feedback_content ON feedback(content_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);
