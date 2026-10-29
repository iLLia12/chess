-- chess online schema

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nickname      VARCHAR(32)  NOT NULL,
  avatar        VARCHAR(16)  NOT NULL DEFAULT '♟',
  country       CHAR(2)      NOT NULL DEFAULT 'UA',
  joined_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_nickname (nickname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friendships (
  user_id    INT UNSIGNED NOT NULL,
  friend_id  INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT fk_friend_user   FOREIGN KEY (user_id)   REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friend_friend FOREIGN KEY (friend_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS games (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  white_id       INT UNSIGNED NOT NULL,
  black_id       INT UNSIGNED NOT NULL,
  status         ENUM('active','finished') NOT NULL DEFAULT 'active',
  result         ENUM('white','black','draw') DEFAULT NULL,
  result_reason  VARCHAR(32) DEFAULT NULL,
  fen            VARCHAR(100) NOT NULL,
  ply            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  draw_offer_by  INT UNSIGNED DEFAULT NULL,
  started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at    DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_games_white (white_id, status, updated_at),
  KEY idx_games_black (black_id, status, updated_at),
  CONSTRAINT fk_games_white FOREIGN KEY (white_id) REFERENCES users (id),
  CONSTRAINT fk_games_black FOREIGN KEY (black_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS moves (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id    INT UNSIGNED NOT NULL,
  ply        SMALLINT UNSIGNED NOT NULL,
  color      ENUM('w','b') NOT NULL,
  san        VARCHAR(12) NOT NULL,
  from_sq    CHAR(2) NOT NULL,
  to_sq      CHAR(2) NOT NULL,
  promotion  CHAR(1) DEFAULT NULL,
  captured   CHAR(1) DEFAULT NULL,
  fen_after  VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_moves_game_ply (game_id, ply),
  CONSTRAINT fk_moves_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  body       VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_game (game_id, id),
  CONSTRAINT fk_chat_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A challenge waits for the other player to accept; accepting creates the game.
CREATE TABLE IF NOT EXISTS challenges (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_id     INT UNSIGNED NOT NULL,
  to_id       INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_challenges_pair (from_id, to_id),
  KEY idx_challenges_to (to_id),
  CONSTRAINT fk_challenges_from FOREIGN KEY (from_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenges_to   FOREIGN KEY (to_id)   REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
