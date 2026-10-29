'use strict';

// End-to-end smoke test: boots the real server against the real database and
// plays a short game through the HTTP API, including SSE delivery.
// Run with:  npm test   (needs the database up: npm run db)

require('dotenv').config();

const http = require('http');
const assert = require('assert');

const PORT = Number(process.env.TEST_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE}${path}`,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sseListen(cookie, onEvent) {
  return new Promise((resolve) => {
    const req = http.request(`${BASE}/api/events`, { headers: { Cookie: cookie, Accept: 'text/event-stream' } }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let split;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const type = (frame.match(/^event: (.+)$/m) || [])[1];
          const data = (frame.match(/^data: (.+)$/m) || [])[1];
          if (type) onEvent(type, data ? JSON.parse(data) : null);
        }
      });
      resolve({ stop: () => req.destroy() });
    });
    req.on('error', () => {});
    req.end();
  });
}

const login = async (nickname) => {
  const res = await request('POST', '/api/login', { body: { nickname } });
  assert.strictEqual(res.status, 200, `login ${nickname}: ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'][0].split(';')[0];
  return { user: res.body.user, cookie };
};

let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${label}`);
  } catch (err) {
    console.error(`  FAIL ${label}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  process.env.PORT = String(PORT);
  const db = require('../src/db');
  await db.migrate();

  const app = require('../src/app');
  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(PORT, () => resolve(s));
  });

  const stamp = Date.now().toString().slice(-6);
  const alice = await login(`test-a-${stamp}`);
  const bob = await login(`test-b-${stamp}`);
  console.log('two players signed in');

  const seen = [];
  const aliceStream = await sseListen(alice.cookie, (type, data) => seen.push([type, data]));
  await new Promise((r) => setTimeout(r, 200));
  check('SSE sends a hello frame', () => assert.ok(seen.some(([t]) => t === 'hello')));

  const created = await request('POST', '/api/games', { body: { opponentId: bob.user.id }, cookie: alice.cookie });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const gameId = created.body.gameId;
  console.log(`game #${gameId} created`);

  let game = (await request('GET', `/api/games/${gameId}`, { cookie: alice.cookie })).body.game;
  const whiteIsAlice = game.white.id === alice.user.id;
  const white = whiteIsAlice ? alice : bob;
  const black = whiteIsAlice ? bob : alice;

  check('a new game starts from the initial position', () => assert.strictEqual(game.ply, 0));
  const asWhite = (await request('GET', `/api/games/${gameId}`, { cookie: white.cookie })).body.game;
  check('white is offered legal opening moves', () => assert.deepStrictEqual(asWhite.legalMoves.e2, ['e3', 'e4']));
  const asBlack = (await request('GET', `/api/games/${gameId}`, { cookie: black.cookie })).body.game;
  check('black gets no legal moves while it is white to move', () =>
    assert.deepStrictEqual(asBlack.legalMoves, {}));

  const bad = await request('POST', `/api/games/${gameId}/move`, { body: { from: 'e2', to: 'e5' }, cookie: white.cookie });
  check('an illegal move is rejected', () => assert.strictEqual(bad.status, 422));

  const outOfTurn = await request('POST', `/api/games/${gameId}/move`, { body: { from: 'e7', to: 'e5' }, cookie: white.cookie });
  check('moving the opponent\'s pieces is rejected', () => assert.ok(outOfTurn.status >= 400));

  // Scholar's mate.
  const script = [
    [white, 'e2', 'e4'], [black, 'e7', 'e5'], [white, 'f1', 'c4'], [black, 'b8', 'c6'],
    [white, 'd1', 'h5'], [black, 'g8', 'f6'], [white, 'h5', 'f7'],
  ];
  for (const [who, from, to] of script) {
    const res = await request('POST', `/api/games/${gameId}/move`, { body: { from, to }, cookie: who.cookie });
    assert.strictEqual(res.status, 200, `move ${from}${to}: ${JSON.stringify(res.body)}`);
    game = res.body.game;
  }

  check('history records every ply in SAN', () =>
    assert.deepStrictEqual(game.moves.map((m) => m.san), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']));
  check('checkmate finishes the game', () => {
    assert.strictEqual(game.status, 'finished');
    assert.strictEqual(game.resultReason, 'checkmate');
    assert.strictEqual(game.result, 'white');
  });
  check('captured pieces are tracked', () => assert.deepStrictEqual(game.captured.byWhite, ['p']));

  await new Promise((r) => setTimeout(r, 300));
  check('SSE pushed game updates to the other player', () =>
    assert.ok(seen.filter(([t, d]) => t === 'game' && d && d.id === gameId).length >= 2));

  const active = await request('GET', '/api/games/active', { cookie: alice.cookie });
  check('a finished game leaves the active list', () =>
    assert.ok(!active.body.games.some((g) => g.id === gameId)));

  const recent = await request('GET', '/api/games/recent?offset=0&limit=5', { cookie: alice.cookie });
  check('the finished game shows up in recent games', () =>
    assert.ok(recent.body.games.some((g) => g.id === gameId)));
  check('recent games report a total for lazy loading', () =>
    assert.strictEqual(typeof recent.body.total, 'number'));

  // Resignation on a second game.
  const second = await request('POST', '/api/games', { body: { opponentId: bob.user.id }, cookie: alice.cookie });
  const secondId = second.body.gameId;
  const resigned = await request('POST', `/api/games/${secondId}/resign`, { cookie: alice.cookie });
  check('resigning hands the win to the opponent', () => {
    assert.strictEqual(resigned.body.game.status, 'finished');
    assert.strictEqual(resigned.body.game.resultReason, 'resignation');
    assert.notStrictEqual(resigned.body.game.result, alice.user.id === resigned.body.game.white.id ? 'white' : 'black');
  });

  // Draw by agreement on a third game.
  const third = await request('POST', '/api/games', { body: { opponentId: bob.user.id }, cookie: alice.cookie });
  const thirdId = third.body.gameId;
  await request('POST', `/api/games/${thirdId}/draw`, { body: { action: 'offer' }, cookie: alice.cookie });
  const offered = (await request('GET', `/api/games/${thirdId}`, { cookie: bob.cookie })).body.game;
  check('a draw offer is visible to the opponent', () => assert.strictEqual(offered.drawOfferBy, alice.user.id));
  const accepted = await request('POST', `/api/games/${thirdId}/draw`, { body: { action: 'accept' }, cookie: bob.cookie });
  check('accepting a draw finishes the game', () => {
    assert.strictEqual(accepted.body.game.result, 'draw');
    assert.strictEqual(accepted.body.game.resultReason, 'agreement');
  });

  const others = await request('GET', '/api/users', { cookie: alice.cookie });
  check('every player in the list has a nickname', () =>
    assert.ok(others.body.users.length > 1 && others.body.users.every((u) => u.id && u.nickname)));

  // Challenges: sent, listed for both sides, accepted into a real game.
  const sentChallenge = await request('POST', '/api/challenges', { body: { userId: bob.user.id }, cookie: alice.cookie });
  check('a player can challenge another player', () => assert.strictEqual(sentChallenge.status, 201));
  const twice = await request('POST', '/api/challenges', { body: { userId: bob.user.id }, cookie: alice.cookie });
  check('a second challenge to the same player is refused', () => assert.strictEqual(twice.status, 409));
  const bobSees = (await request('GET', '/api/challenges', { cookie: bob.cookie })).body.challenges;
  const aliceSees = (await request('GET', '/api/challenges', { cookie: alice.cookie })).body.challenges;
  check('the challenged player sees an incoming challenge', () =>
    assert.ok(bobSees.some((c) => c.id === sentChallenge.body.challenge.id && c.direction === 'in' && c.opponent.id === alice.user.id)));
  check('the challenger sees it as sent', () =>
    assert.ok(aliceSees.some((c) => c.id === sentChallenge.body.challenge.id && c.direction === 'out' && c.opponent.id === bob.user.id)));
  const aliceAccepts = await request('POST', `/api/challenges/${sentChallenge.body.challenge.id}/accept`, { cookie: alice.cookie });
  check('the challenger cannot accept their own challenge', () => assert.strictEqual(aliceAccepts.status, 403));
  const bobAccepts = await request('POST', `/api/challenges/${sentChallenge.body.challenge.id}/accept`, { cookie: bob.cookie });
  const challengeGameId = bobAccepts.body.gameId;
  const nowActive = (await request('GET', '/api/games/active', { cookie: alice.cookie })).body.games;
  check('accepting a challenge starts a game', () => assert.ok(nowActive.some((g) => g.id === challengeGameId)));
  const leftover = (await request('GET', '/api/challenges', { cookie: bob.cookie })).body.challenges;
  check('accepted challenges leave the pending list', () =>
    assert.ok(!leftover.some((c) => c.id === sentChallenge.body.challenge.id)));
  const busy = await request('POST', '/api/challenges', { body: { userId: bob.user.id }, cookie: alice.cookie });
  check('you cannot challenge someone you already have a game with', () => assert.strictEqual(busy.status, 409));
  await request('POST', `/api/games/${challengeGameId}/resign`, { cookie: alice.cookie });
  const again = await request('POST', '/api/challenges', { body: { userId: bob.user.id }, cookie: alice.cookie });
  const declined = await request('DELETE', `/api/challenges/${again.body.challenge.id}`, { cookie: bob.cookie });
  const afterDecline = (await request('GET', '/api/challenges', { cookie: alice.cookie })).body.challenges;
  check('declining removes the challenge for both players', () => {
    assert.strictEqual(declined.status, 200);
    assert.ok(!afterDecline.some((c) => c.id === again.body.challenge.id));
  });

  // Player search for the friends popup.
  const found = await request('GET', `/api/users/search?q=${encodeURIComponent(bob.user.nickname.slice(0, 6))}`, { cookie: alice.cookie });
  check('player search finds other players by nickname prefix', () =>
    assert.ok(found.body.users.some((u) => u.id === bob.user.id)));
  check('player search leaves out yourself', () =>
    assert.ok(!found.body.users.some((u) => u.id === alice.user.id)));
  const wildcard = await request('GET', '/api/users/search?q=%25', { cookie: alice.cookie });
  check('a % in the search is matched literally', () => assert.strictEqual(wildcard.body.users.length, 0));

  // Chat on the first game: stored, listed for both players, pushed live.
  const sent = await request('POST', `/api/games/${gameId}/chat`, { body: { body: 'good game!' }, cookie: bob.cookie });
  check('a player can post a chat message', () => assert.strictEqual(sent.status, 201));
  const empty = await request('POST', `/api/games/${gameId}/chat`, { body: { body: '   ' }, cookie: bob.cookie });
  check('an empty chat message is rejected', () => assert.strictEqual(empty.status, 400));
  const log = await request('GET', `/api/games/${gameId}/chat`, { cookie: alice.cookie });
  check('the opponent sees the chat message', () =>
    assert.deepStrictEqual(log.body.messages.map((m) => [m.userId, m.body]), [[bob.user.id, 'good game!']]));
  await new Promise((r) => setTimeout(r, 300));
  check('SSE pushed the chat message to the opponent', () =>
    assert.ok(seen.some(([t, d]) => t === 'chat' && d && d.id === sent.body.message.id)));

  aliceStream.stop();
  server.close();
  await db.pool.end();
  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
