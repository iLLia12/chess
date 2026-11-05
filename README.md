# chess online

Correspondence chess: every player can have several games running at once, and
each game updates live over **server-sent events** (no websockets anywhere).
Node + Express on the server, MySQL for storage, plain ES modules in the
browser — no build step.

## Run it

```bash
npm install
npm run db        # starts MySQL 8 in Docker on port 3307
npm start         # http://localhost:3000
```

Or run everything (app + MySQL) in Docker:

```bash
docker compose up -d --build    # http://localhost:3000
docker compose logs app         # the admin password is printed here on first boot
```

phpMyAdmin comes up with it at http://localhost:8080, already signed in to
the `chess` database as root (local use only).

## Accounts

There is no public sign-up. On the first boot the server creates one admin
account, `goncharovphp@gmail.com` (override with `ADMIN_EMAIL`), and prints its
generated password to the terminal **once** — only a scrypt hash is stored, so
copy it then. The admin opens **Admin** in the top bar to create players
(email, nickname, optional two-letter country); each new player's password is
generated and shown to the admin once, to pass on.

Lost a password? `npm run reset-password -- someone@example.com` prints a new
one and signs that account out everywhere. `npm run reset-db -- --yes` deletes
every player and game; the admin is created again on the next boot.

To play against yourself, create a second player, then sign in as them in a
second browser (or a private window); both windows update live.

Already have MySQL? Skip `npm run db` and point `.env` at it. The schema is
applied automatically on boot (`db/schema.sql`, all `CREATE TABLE IF NOT EXISTS`).

```bash
npm test          # end-to-end smoke test against the real server and database
```

## Screens

**Home** — your profile card (avatar, nickname, country flag, online status,
join date, Friends button), then the tiles of games in progress. Each tile
shows the opponent, when the game started, and a mini board with that game's
current position; "Your move" is highlighted. Under the tiles, recent finished
games with a **Show more** button that pages in five at a time.

**Game** — the opponent above the board with the pieces they have captured,
you below. A left sidebar shows who you are with a home icon beside your name,
then resign and draw (both ask for confirmation) and prev/next to walk the
move history; arrow keys work too. Under it, a chat panel lets the two
players talk, live. Click a piece to see its legal moves and click a
target square to move, or drag the piece there. Moves click and captures knock
(synthesised with the Web Audio API, no sound files), for your moves and your
opponent's. A right sidebar lists your
games as tiles: games in progress first, then finished ones, loading more as
you scroll. The game you're viewing is outlined; click any tile to switch.

## How the live updates work

One `EventSource` per tab on `GET /api/events`, keyed by the signed-in user.
After any state change the server pushes to exactly the users involved:

| event      | payload                       | sent to                      |
|------------|-------------------------------|------------------------------|
| `hello`    | your id + who is online       | the connecting tab           |
| `game`     | the full game state           | both players of that game    |
| `games`    | a nudge to refresh the lists  | both players of that game    |
| `presence` | `{userId, online}`            | everyone connected           |
| `friends`  | a nudge to refresh friends    | the two users involved       |
| `chat`     | one new chat message          | both players of that game    |

Presence is derived from open SSE connections, so closing a tab marks you
offline. A comment heartbeat every 25s keeps proxies from closing the stream,
and `EventSource` reconnects on its own if the server restarts.

## Layout

```
src/
  app.js        express app (routes + static files)
  server.js     migrate, then listen
  db.js         mysql2 pool, transactions, schema migration
  sse.js        the SSE hub: userId -> open responses
  games.js      all chess/game logic and the JSON shapes the client gets
  chat.js       per-game chat messages
  challenges.js challenge, accept, decline / cancel
  auth.js       sessions: random token in an httpOnly cookie, its hash in MySQL
  users.js      account creation, default admin, password reset
  passwords.js  generated passwords, scrypt hashing
  routes/       auth, users, games, events, admin
public/
  index.html    shell
  js/           app (router), home, game, admin, board, tiles, sound, api, events, ui
  css/styles.css
db/schema.sql   users, sessions, friendships, games, moves, chat_messages, challenges
scripts/        reset-db, reset-password
test/smoke.js   end-to-end test
```

Move legality, game-over detection and SAN come from [chess.js] on the server —
the client never decides what is legal. Each move is stored as its own row in
`moves` (SAN, from/to, captured piece, resulting FEN), so history traversal,
captured-piece lists and threefold repetition all come from replaying that
table.

[chess.js]: https://github.com/jhlywa/chess.js

## API

```
POST   /api/login            {email,password}    sign in
POST   /api/logout
GET    /api/me
GET    /api/users                                other players, online first
GET    /api/users/search?q=                      nickname autocomplete
GET    /api/users/friends
POST   /api/users/friends/:id                    add (mutual)
DELETE /api/users/friends/:id
GET    /api/games/active                         tiles for games in progress
GET    /api/games/recent?offset=&limit=          finished games, paged
POST   /api/games           {opponentId}         start a game (random colors)
GET    /api/games/:id                            full state for one game
POST   /api/games/:id/move  {from,to,promotion}
POST   /api/games/:id/resign
POST   /api/games/:id/draw  {action}             offer | accept | decline
GET    /api/games/:id/chat                       chat messages for the game
POST   /api/games/:id/chat  {body}               send a chat message
GET    /api/challenges                           pending challenges, both directions
POST   /api/challenges      {userId}             challenge a player
POST   /api/challenges/:id/accept                accept -> starts the game
DELETE /api/challenges/:id                       decline (challenged) or cancel (challenger)
GET    /api/events                               SSE stream
GET    /api/admin/users                          all accounts (admin only)
POST   /api/admin/users     {email,nickname,country?}  create; returns the password once
```

## Not done yet

* Sign-in has no rate limiting, and players cannot change their own
  password yet. Put it behind HTTPS (`NODE_ENV=production` marks the cookie
  `Secure`) before exposing it.
* No clocks, ratings or takebacks. One active game per pair of players; New
  game starts one immediately, a challenge from the Friends popup waits for
  the other player to accept.
* SSE state lives in the process, so running more than one server instance
  needs a shared pub/sub (Redis, or MySQL polling) behind `src/sse.js`.
