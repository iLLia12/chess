import { api } from './api.js';
import { el, flag, ago, toast } from './ui.js';
import { miniBoard } from './board.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// One game as a tile: opponent, mini board, and a footer that says whose move
// it is (active games) or how it ended (finished games). Used on the home
// screen and in the games sidebar of the game screen.
export function gameTile(game, navigate, { current = false } = {}) {
  const finished = game.status === 'finished';
  let footLeft;
  if (finished) {
    const label = game.outcome === 'win' ? 'Won' : game.outcome === 'loss' ? 'Lost' : 'Draw';
    footLeft = el('span', { class: `badge ${game.outcome}`, text: label });
  } else if (game.yourTurn) {
    footLeft = el('span', { class: 'turn-you', text: 'Your move' });
  } else {
    footLeft = el('span', { class: 'turn-them', text: `Waiting for ${game.opponent.nickname}` });
  }
  const footRight = finished
    ? (game.resultReason || '').replace(/-/g, ' ')
    : game.ply
      ? `${Math.ceil(game.ply / 2)} moves`
      : 'no moves yet';

  const classes = ['tile'];
  if (game.yourTurn) classes.push('your-turn');
  else if (!finished) classes.push('waiting'); // opponent to move: dimmed
  if (finished) classes.push('finished');
  if (current) classes.push('current');

  return el('article', { class: classes.join(' '), onclick: () => navigate(`/game/${game.id}`) }, [
    el('header', { class: 'tile-head' }, [
      el('span', { class: 'tile-avatar', text: game.opponent.avatar }),
      el('div', { class: 'tile-who' }, [
        el('span', { class: 'tile-name' }, [
          game.opponent.nickname,
          el('span', { class: 'chip-flag', text: ` ${flag(game.opponent.country)}` }),
        ]),
        el('span', {
          class: 'tile-sub',
          text: finished ? `finished ${ago(game.finishedAt || game.updatedAt)}` : `started ${ago(game.startedAt)}`,
        }),
      ]),
      game.opponent.online ? el('span', { class: 'dot online', title: 'online' }) : el('span', { class: 'dot' }),
    ]),
    miniBoard(game.fen, game.yourColor, game.lastMove),
    el('footer', { class: 'tile-foot' }, [footLeft, el('span', { class: 'tile-ply', text: footRight })]),
  ]);
}

// A pending challenge, shown at the top of the current games. The challenged
// player can accept (which opens the new game) or decline; the challenger can
// cancel. The lists refresh themselves from the `games` SSE nudge.
export function challengeTile(challenge, navigate) {
  const incoming = challenge.direction === 'in';
  const { opponent } = challenge;

  const act = async (button, fn) => {
    for (const b of button.parentNode.querySelectorAll('button')) b.disabled = true;
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
      for (const b of button.parentNode.querySelectorAll('button')) b.disabled = false;
    }
  };

  const actions = incoming
    ? [
        el('button', {
          class: 'btn small primary',
          text: 'Accept',
          onclick: (e) =>
            act(e.currentTarget, async () => {
              const { gameId } = await api.acceptChallenge(challenge.id);
              navigate(`/game/${gameId}`);
            }),
        }),
        el('button', {
          class: 'btn small',
          text: 'Decline',
          onclick: (e) => act(e.currentTarget, () => api.removeChallenge(challenge.id)),
        }),
      ]
    : [
        el('button', {
          class: 'btn small',
          text: 'Cancel',
          onclick: (e) => act(e.currentTarget, () => api.removeChallenge(challenge.id)),
        }),
      ];

  return el('article', { class: `tile challenge${incoming ? ' incoming' : ''}` }, [
    el('header', { class: 'tile-head' }, [
      el('span', { class: 'tile-avatar', text: opponent.avatar }),
      el('div', { class: 'tile-who' }, [
        el('span', { class: 'tile-name' }, [
          opponent.nickname,
          el('span', { class: 'chip-flag', text: ` ${flag(opponent.country)}` }),
        ]),
        el('span', { class: 'tile-sub', text: `${incoming ? 'challenged you' : 'challenge sent'} ${ago(challenge.createdAt)}` }),
      ]),
      opponent.online ? el('span', { class: 'dot online', title: 'online' }) : el('span', { class: 'dot' }),
    ]),
    miniBoard(START_FEN, 'w'),
    el('footer', { class: 'tile-foot' }, [
      el('span', {
        class: incoming ? 'turn-you' : 'turn-them',
        text: incoming ? 'New challenge' : `Waiting for ${opponent.nickname}`,
      }),
      el('span', { class: 'tile-actions' }, actions),
    ]),
  ]);
}
