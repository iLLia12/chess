import { api } from './api.js';
import * as events from './events.js';
import { el, clear, flag, ago, toast, confirmDialog, GLYPH } from './ui.js';
import { renderBoard, isDragging, parseFen, previewMove, findKing } from './board.js';
import { gameTile, challengeTile } from './tiles.js';
import { playMove, playCapture } from './sound.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export function renderGame(host, { gameId, navigate }) {
  let state = null;
  let viewIndex = -1; // -1 = starting position, otherwise index into state.moves
  let pendingPromotion = null;
  // A dropped move waiting for the server: { from, to, fen }. The board shows
  // it straight away instead of snapping the piece back until the reply.
  let pendingMove = null;
  let busy = false;
  let ownPly = -1; // ply of the last move made from this page

  const topHost = el('div', { class: 'player-bar' });
  const boardHost = el('div', { class: 'board-host' });
  const bottomHost = el('div', { class: 'player-bar' });
  const bannerHost = el('div', { class: 'banner-host' });
  const barHost = el('div', { class: 'side-actions' });
  const chatList = el('div', { class: 'chat-list' });
  const chatInput = el('input', { class: 'input chat-input', placeholder: 'Message', maxlength: '500' });
  const chatForm = el('form', { class: 'chat-form' }, [
    chatInput,
    el('button', { class: 'btn small primary', type: 'submit', text: 'Send' }),
  ]);
  let messages = [];
  const gamesList = el('div', { class: 'games-list' });
  const FINISHED_PAGE = 10;
  // The page header (brand, connection dot, sign out) lives in the sidebar
  // while a game is open; it goes back on top when the game screen closes.
  const header = document.querySelector('.topbar');
  const headerHome = header.parentNode;
  const headerNext = header.nextSibling;

  host.replaceChildren(
    el('div', { class: 'game-screen' }, [
      el('div', { class: 'side-col' }, [
        el('aside', { class: 'side-bar' }, [
          el('div', { class: 'side-head' }, [
            header,
            el('button', {
              class: 'icon-btn home-btn',
              title: 'Home',
              'aria-label': 'Home',
              html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h5v-6h4v6h5V9"/></svg>',
              onclick: () => navigate('/'),
            }),
          ]),
          barHost,
        ]),
        el('aside', { class: 'chat-panel' }, [el('h3', { class: 'chat-title', text: 'Chat' }), chatList, chatForm]),
      ]),
      el('div', { class: 'game-main' }, [
        bannerHost,
        el('div', { class: 'play-area' }, [topHost, boardHost, bottomHost]),
      ]),
      el('aside', { class: 'games-panel' }, [el('h3', { class: 'chat-title', text: 'Your games' }), gamesList]),
    ])
  );

  // Placeholders until the game arrives: shimmering player bars, an empty
  // board with a spinner, a spinner in the chat and a few skeleton tiles.
  // paint(), renderChat() and loadGames() replace each one when data lands.
  function renderSkeleton() {
    const skeletonBar = () => [
      el('div', { class: 'player-id' }, [
        el('span', { class: 'avatar skel' }),
        el('div', { class: 'player-text skel-lines' }, [el('span', { class: 'skel skel-line' }), el('span', { class: 'skel skel-line short' })]),
      ]),
    ];
    topHost.replaceChildren(...skeletonBar());
    bottomHost.replaceChildren(...skeletonBar());
    renderBoard(boardHost, { fen: EMPTY_FEN });
    boardHost.append(el('div', { class: 'board-loading' }, [el('span', { class: 'spinner', role: 'status', 'aria-label': 'Loading game' })]));
    chatList.replaceChildren(el('div', { class: 'chat-empty' }, [el('span', { class: 'spinner small' })]));
    gamesList.replaceChildren(
      ...[0, 1, 2].map(() =>
        el('div', { class: 'tile skel-tile' }, [
          el('div', { class: 'tile-head' }, [
            el('span', { class: 'skel skel-dot' }),
            el('div', { class: 'skel-lines' }, [el('span', { class: 'skel skel-line' }), el('span', { class: 'skel skel-line short' })]),
          ]),
          el('div', { class: 'skel skel-board' }),
        ])
      )
    );
  }

  const isLive = () => !!state && viewIndex === state.moves.length - 1;
  const viewFen = () => {
    if (pendingMove && isLive()) return pendingMove.fen;
    return viewIndex < 0 ? START_FEN : state.moves[viewIndex].fen;
  };
  const viewLastMove = () => {
    if (pendingMove && isLive()) return pendingMove;
    return viewIndex < 0 ? null : state.moves[viewIndex];
  };

  function capturedRow(pieces, advantage) {
    const node = el('div', { class: 'captured' });
    const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    const sorted = [...pieces].sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
    for (const piece of sorted) node.append(el('span', { class: 'cap', text: GLYPH[piece] }));
    if (advantage > 0) node.append(el('span', { class: 'advantage', text: `+${advantage}` }));
    return node;
  }

  function playerBar(bar, player, color, side) {
    const youMove = state.status === 'active' && state.turn === color;
    // Each player's row shows the pieces that player has captured.
    const taken = color === 'w' ? state.captured.byWhite : state.captured.byBlack;
    const advantage = color === 'w' ? state.captured.advantage : -state.captured.advantage;
    bar.className = `player-bar ${side}${youMove ? ' to-move' : ''}`;
    bar.replaceChildren(
      el('div', { class: 'player-id' }, [
        el('span', { class: 'avatar', text: player.avatar }),
        el('div', { class: 'player-text' }, [
          el('span', { class: 'player-name' }, [
            player.nickname,
            el('span', { class: 'flag', text: ` ${flag(player.country)}` }),
            side === 'bottom' ? el('span', { class: 'you-tag', text: 'you' }) : null,
          ]),
          el('span', { class: 'player-sub' }, [
            el('span', { class: `dot${player.online ? ' online' : ''}` }),
            el('span', { text: player.online ? 'online' : `seen ${ago(player.lastSeenAt)}` }),
            el('span', { class: 'piece-side', text: color === 'w' ? '· white' : '· black' }),
          ]),
        ]),
      ]),
      capturedRow(taken, advantage)
    );
  }

  function resultText() {
    if (state.status !== 'finished') return null;
    const reason = (state.resultReason || '').replace(/-/g, ' ');
    if (state.result === 'draw') return `Draw by ${reason}`;
    const winner = state.result === 'white' ? state.white : state.black;
    const youWon = (state.result === 'white' ? 'w' : 'b') === state.yourColor;
    return `${youWon ? 'You won' : `${winner.nickname} won`} by ${reason}`;
  }

  function renderBanner() {
    clear(bannerHost);
    const finished = resultText();
    if (finished) {
      bannerHost.append(el('div', { class: 'banner result', text: finished }));
      return;
    }
    if (state.drawOfferBy) {
      const fromMe = state.drawOfferBy === (state.yourColor === 'w' ? state.white.id : state.black.id);
      if (fromMe) {
        bannerHost.append(el('div', { class: 'banner', text: 'Draw offered — waiting for your opponent' }));
      } else {
        bannerHost.append(
          el('div', { class: 'banner offer' }, [
            el('span', { text: 'Your opponent offers a draw' }),
            el('span', { class: 'banner-actions' }, [
              el('button', { class: 'btn small primary', text: 'Accept', onclick: () => act(() => api.draw(gameId, 'accept')) }),
              el('button', { class: 'btn small', text: 'Decline', onclick: () => act(() => api.draw(gameId, 'decline')) }),
            ]),
          ])
        );
      }
      return;
    }
    if (state.inCheck && isLive()) {
      const checked = state.turn === state.yourColor ? 'You are' : 'Your opponent is';
      bannerHost.append(el('div', { class: 'banner check', text: `${checked} in check` }));
    }
  }

  function renderActionBar() {
    const live = state.status === 'active';
    const atStart = viewIndex === -1;
    const atEnd = viewIndex >= state.moves.length - 1;
    barHost.replaceChildren(
      el('button', {
        class: 'bar-btn danger',
        text: '🏳 Resign',
        disabled: !live || busy,
        onclick: async () => {
          if (await confirmDialog('Resign this game? Your opponent wins.', 'Resign')) {
            act(() => api.resign(gameId));
          }
        },
      }),
      el('button', {
        class: 'bar-btn',
        text: '½ Draw',
        disabled: !live || busy,
        onclick: async () => {
          if (await confirmDialog('Offer a draw to your opponent?', 'Offer draw')) {
            act(() => api.draw(gameId, 'offer'));
          }
        },
      }),
      el('div', { class: 'side-nav' }, [
        el('button', {
          class: 'bar-btn nav',
          text: '‹ Prev',
          disabled: atStart,
          onclick: () => {
            viewIndex -= 1;
            paint();
          },
        }),
        el('button', {
          class: 'bar-btn nav',
          text: 'Next ›',
          disabled: atEnd,
          onclick: () => {
            viewIndex += 1;
            paint();
          },
        }),
      ])
    );
  }

  function renderPromotion() {
    const existing = host.querySelector('.promo');
    if (existing) existing.remove();
    if (!pendingPromotion) return;
    const choose = (piece) => {
      const { from, to } = pendingPromotion;
      pendingPromotion = null;
      pendingMove = { from, to, fen: previewMove(state.fen, from, to, piece) };
      paint();
      act(() => api.move(gameId, { from, to, promotion: piece }));
    };
    boardHost.append(
      el('div', { class: 'promo' }, [
        el('span', { class: 'promo-label', text: 'Promote to' }),
        ...['q', 'r', 'b', 'n'].map((piece) =>
          el('button', { class: `promo-btn ${state.turn}`, text: GLYPH[piece], onclick: () => choose(piece) })
        ),
        el('button', {
          class: 'promo-cancel',
          text: '✕',
          onclick: () => {
            pendingPromotion = null;
            pendingMove = null;
            paint();
          },
        }),
      ])
    );
  }

  // A piece let go on one of its legal squares makes the move; anywhere else
  // it goes back. A pawn reaching the last rank asks what to promote to first.
  function onDrop(from, to) {
    const legal = (state.legalMoves || {})[from] || [];
    if (busy || !to || !legal.includes(to) || !isLive() || !state.canMove || state.status !== 'active') {
      paint();
      return;
    }
    // Show the piece where it was dropped right away (a promoting pawn waits
    // on its square while the piece to promote to is picked).
    pendingMove = { from, to, fen: previewMove(state.fen, from, to) };
    const piece = parseFen(state.fen)[from];
    const lastRank = state.turn === 'w' ? '8' : '1';
    if (piece && piece.type === 'p' && to[1] === lastRank) {
      pendingPromotion = { from, to };
      paint();
      return;
    }
    paint();
    act(() => api.move(gameId, { from, to }));
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    renderActionBar();
    try {
      const { game } = await fn();
      ownPly = game.ply;
      pendingMove = null;
      apply(game, true);
    } catch (err) {
      // Rejected: put the board back to the real position.
      if (pendingMove) {
        pendingMove = null;
        paint();
      }
      toast(err.message, 'error');
      await load();
    } finally {
      busy = false;
      renderActionBar();
    }
  }

  function paint() {
    if (!state) return;
    const opponentColor = state.yourColor === 'w' ? 'b' : 'w';
    const opponent = state.yourColor === 'w' ? state.black : state.white;
    const me = state.yourColor === 'w' ? state.white : state.black;
    playerBar(topHost, opponent, opponentColor, 'top');
    playerBar(bottomHost, me, state.yourColor, 'bottom');
    renderBanner();

    // Mid-drag the board is left alone; the drop repaints it.
    if (isDragging(boardHost)) return;
    const live = isLive();
    const interactive = live && state.canMove && state.status === 'active' && !pendingPromotion && !pendingMove;
    renderBoard(boardHost, {
      fen: viewFen(),
      orientation: state.yourColor,
      lastMove: viewLastMove(),
      checkSquare: live && state.inCheck ? findKing(state.fen, state.turn) : null,
      interactive,
      legalMoves: interactive ? state.legalMoves || {} : {},
      onDrop,
    });
    if (!live) {
      boardHost.append(
        el('div', { class: 'review-note' }, [
          el('span', { text: `Reviewing move ${viewIndex + 1} of ${state.moves.length}` }),
          el('button', {
            class: 'btn small',
            text: 'Jump to live',
            onclick: () => {
              viewIndex = state.moves.length - 1;
              paint();
            },
          }),
        ])
      );
    }
    renderPromotion();
    renderActionBar();
  }

  function apply(game, follow) {
    const wasLive = !state || isLive();
    // A new move arrived (ours or the opponent's): click or capture sound.
    // The move response and its SSE echo carry the same ply, so it plays once.
    if (state && game.moves.length > state.moves.length) {
      const latest = game.moves[game.moves.length - 1];
      if (latest.captured) playCapture();
      else playMove();
    }
    state = game;
    if (follow || wasLive) viewIndex = state.moves.length - 1;
    else viewIndex = Math.min(viewIndex, state.moves.length - 1);
    paint();
  }

  async function load() {
    try {
      const { game } = await api.game(gameId);
      apply(game, state === null);
    } catch (err) {
      host.replaceChildren(
        el('div', { class: 'game-screen' }, [
          el('p', { class: 'empty', text: err.message }),
          el('button', { class: 'btn', text: '‹ Back home', onclick: () => navigate('/') }),
        ])
      );
    }
  }

  function renderChat() {
    if (!messages.length) {
      chatList.replaceChildren(el('p', { class: 'chat-empty', text: 'No messages yet. Say hi!' }));
      return;
    }
    const myId = state && (state.yourColor === 'w' ? state.white.id : state.black.id);
    const nameOf = (userId) => {
      if (!state) return '';
      return userId === state.white.id ? state.white.nickname : state.black.nickname;
    };
    chatList.replaceChildren(
      ...messages.map((message) => {
        const mine = message.userId === myId;
        return el('div', { class: `chat-msg${mine ? ' mine' : ''}` }, [
          el('div', { class: 'chat-meta', text: `${mine ? 'you' : nameOf(message.userId)} · ${ago(message.createdAt)}` }),
          el('div', { class: 'chat-body', text: message.body }),
        ]);
      })
    );
    chatList.scrollTop = chatList.scrollHeight;
  }

  function addMessage(message) {
    if (messages.some((m) => m.id === message.id)) return;
    messages.push(message);
    renderChat();
  }

  async function loadChat() {
    try {
      ({ messages } = await api.chat(gameId));
      renderChat();
    } catch (err) {
      chatList.replaceChildren(el('p', { class: 'chat-empty', text: err.message }));
    }
  }

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = chatInput.value.trim();
    if (!body) return;
    chatInput.value = '';
    try {
      const { message } = await api.sendChat(gameId, body);
      addMessage(message);
    } catch (err) {
      chatInput.value = body;
      toast(err.message, 'error');
    }
  });

  // Right sidebar: games in progress first, then finished ones, paging in
  // more finished games as the list is scrolled to the bottom.
  let finishedOffset = 0;
  let finishedMore = false;
  let gamesLoading = false;

  function gameTiles(games) {
    return games.map((game) => gameTile(game, navigate, { current: game.id === Number(gameId) }));
  }

  async function loadGames() {
    gamesLoading = true;
    try {
      const [{ challenges }, { games: active }, recent] = await Promise.all([
        api.challenges(),
        api.activeGames(),
        api.recentGames(0, Math.max(finishedOffset, FINISHED_PAGE)),
      ]);
      finishedOffset = recent.games.length;
      finishedMore = recent.hasMore;
      const nodes = [...challenges.map((challenge) => challengeTile(challenge, navigate)), ...gameTiles(active)];
      if (recent.games.length) nodes.push(el('h4', { class: 'games-divider', text: 'Finished' }), ...gameTiles(recent.games));
      gamesList.replaceChildren(...(nodes.length ? nodes : [el('p', { class: 'chat-empty', text: 'No games yet.' })]));
    } catch (err) {
      gamesList.replaceChildren(el('p', { class: 'chat-empty', text: err.message }));
    } finally {
      gamesLoading = false;
    }
  }

  async function loadMoreFinished() {
    if (gamesLoading || !finishedMore) return;
    gamesLoading = true;
    try {
      const recent = await api.recentGames(finishedOffset, FINISHED_PAGE);
      finishedOffset += recent.games.length;
      finishedMore = recent.hasMore;
      gamesList.append(...gameTiles(recent.games));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      gamesLoading = false;
    }
  }

  gamesList.addEventListener('scroll', () => {
    if (gamesList.scrollTop + gamesList.clientHeight >= gamesList.scrollHeight - 120) loadMoreFinished();
  });

  renderSkeleton();
  load().then(loadChat);
  loadGames();

  const offGame = events.on('game', (game) => {
    if (!game || Number(game.id) !== Number(gameId)) return;
    const wasMyTurn = state && state.yourTurn;
    // The push for a move made from this page (an admin may have just moved
    // for the opponent) is not news; it can land before or after the reply.
    const ownMove = busy || game.ply === ownPly;
    apply(game, false);
    if (!wasMyTurn && !ownMove && game.yourTurn && game.status === 'active') toast('Your move', 'info');
  });
  const offPresence = events.on('presence', () => {
    if (state) paint();
    loadGames();
  });
  const offGames = events.on('games', () => loadGames());
  const offChat = events.on('chat', (message) => {
    if (!message || message.gameId !== Number(gameId)) return;
    addMessage(message);
  });

  const onKey = (e) => {
    if (!state || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft' && viewIndex > -1) {
      viewIndex -= 1;
      paint();
    } else if (e.key === 'ArrowRight' && viewIndex < state.moves.length - 1) {
      viewIndex += 1;
      paint();
    }
  };
  document.addEventListener('keydown', onKey);

  return () => {
    headerHome.insertBefore(header, headerNext);
    offGame();
    offPresence();
    offGames();
    offChat();
    document.removeEventListener('keydown', onKey);
  };
}
