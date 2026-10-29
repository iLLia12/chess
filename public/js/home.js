import { api } from './api.js';
import * as events from './events.js';
import { el, clear, flag, fmtDate, ago, toast, GLYPH } from './ui.js';
import { gameTile, challengeTile } from './tiles.js';

const RECENT_PAGE = 5;

export function renderHome(host, { user, navigate }) {
  const profileHost = el('div');
  const tilesHost = el('div', { class: 'tiles' });
  const recentHost = el('div', { class: 'recent-list' });
  const recentFooter = el('div', { class: 'recent-footer' });

  host.replaceChildren(
    el('div', { class: 'home' }, [
      profileHost,
      el('section', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('h2', { text: 'Current games' }),
          el('button', { class: 'btn primary', text: '+ New game', onclick: openNewGame }),
        ]),
        tilesHost,
      ]),
      el('section', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [el('h2', { text: 'Recent games' })]),
        recentHost,
        recentFooter,
      ]),
    ])
  );

  let recentOffset = 0;
  let recentLoading = false;

  function renderProfile(me) {
    profileHost.replaceChildren(
      el('section', { class: 'profile' }, [
        el('div', { class: 'avatar-lg', text: me.avatar }),
        el('div', { class: 'profile-main' }, [
          el('div', { class: 'profile-top' }, [
            el('h1', { class: 'nickname', text: me.nickname }),
            el('span', { class: 'flag-lg', text: flag(me.country) }),
          ]),
          el('div', { class: 'profile-meta' }, [
            el('span', { class: 'status online' }, [el('span', { class: 'dot online' }), 'online']),
            el('span', { class: 'sep', text: '·' }),
            el('span', { text: `joined ${fmtDate(me.joinedAt)}` }),
          ]),
        ]),
        el('button', { class: 'btn', text: '👥 Friends', onclick: openFriends }),
      ])
    );
  }

  async function loadActive() {
    try {
      const [{ games }, { challenges }] = await Promise.all([api.activeGames(), api.challenges()]);
      if (!games.length && !challenges.length) {
        tilesHost.replaceChildren(
          el('p', { class: 'empty', text: 'No games in progress. Start one with the New game button.' })
        );
        return;
      }
      tilesHost.replaceChildren(
        ...challenges.map((challenge) => challengeTile(challenge, navigate)),
        ...games.map((game) => gameTile(game, navigate))
      );
    } catch (err) {
      tilesHost.replaceChildren(el('p', { class: 'empty', text: err.message }));
    }
  }

  function recentRow(game) {
    const label = game.outcome === 'win' ? 'Won' : game.outcome === 'loss' ? 'Lost' : 'Draw';
    return el('div', { class: 'recent-row', onclick: () => navigate(`/game/${game.id}`) }, [
      el('span', { class: `badge ${game.outcome}`, text: label }),
      el('span', { class: 'recent-avatar', text: game.opponent.avatar }),
      el('span', { class: 'recent-name', text: `${game.opponent.nickname} ${flag(game.opponent.country)}` }),
      el('span', { class: 'recent-reason', text: (game.resultReason || '').replace(/-/g, ' ') }),
      el('span', { class: 'recent-when', text: ago(game.finishedAt || game.updatedAt) }),
      el('span', { class: 'recent-color', text: game.yourColor === 'w' ? `${GLYPH.k} white` : `${GLYPH.k} black` }),
    ]);
  }

  async function loadRecent(reset) {
    if (recentLoading) return;
    recentLoading = true;
    if (reset) {
      recentOffset = 0;
      clear(recentHost);
    }
    try {
      const { games, hasMore, total } = await api.recentGames(recentOffset, RECENT_PAGE);
      recentOffset += games.length;
      if (!total) {
        recentHost.replaceChildren(el('p', { class: 'empty', text: 'No finished games yet.' }));
      } else {
        recentHost.append(...games.map(recentRow));
      }
      clear(recentFooter);
      if (hasMore) {
        recentFooter.append(
          el('button', { class: 'btn ghost', text: 'Show more', onclick: () => loadRecent(false) })
        );
      } else if (total) {
        recentFooter.append(el('span', { class: 'muted', text: `${total} game${total === 1 ? '' : 's'} total` }));
      }
    } catch (err) {
      clear(recentFooter);
      recentFooter.append(el('span', { class: 'muted', text: err.message }));
    } finally {
      recentLoading = false;
    }
  }

  function modal(title, body) {
    const close = () => overlay.remove();
    const overlay = el('div', { class: 'overlay', onclick: (e) => e.target === overlay && close() }, [
      el('div', { class: 'modal wide' }, [
        el('div', { class: 'modal-head' }, [
          el('h3', { text: title }),
          el('button', { class: 'icon-btn', text: '✕', onclick: close }),
        ]),
        body,
      ]),
    ]);
    document.body.append(overlay);
    return close;
  }

  async function openNewGame() {
    const list = el('div', { class: 'user-list', text: 'Loading…' });
    const close = modal('Start a new game', list);
    try {
      const { users } = await api.users();
      if (!users.length) {
        list.replaceChildren(el('p', { class: 'empty', text: 'No other players yet. Open a second browser and sign in with another nickname.' }));
        return;
      }
      list.replaceChildren(
        ...users.map((u) =>
          el('div', { class: 'user-row' }, [
            el('span', { class: 'chip-avatar', text: u.avatar }),
            el('span', { class: 'chip-name', text: `${u.nickname} ${flag(u.country)}` }),
            el('span', { class: `dot${u.online ? ' online' : ''}`, title: u.online ? 'online' : 'offline' }),
            el('button', {
              class: 'btn primary small',
              text: 'Play',
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const { gameId, existing } = await api.newGame(u.id);
                  close();
                  if (existing) toast('You already have a game with this player', 'info');
                  navigate(`/game/${gameId}`);
                } catch (err) {
                  toast(err.message, 'error');
                  e.target.disabled = false;
                }
              },
            }),
          ])
        )
      );
    } catch (err) {
      list.replaceChildren(el('p', { class: 'empty', text: err.message }));
    }
  }

  // Search box with an autocomplete dropdown. Arrow keys move through the
  // suggestions, Enter picks the highlighted one (or the first), Escape
  // closes. onPick(user, { viaKeyboard }) is called with the picked user.
  function userSearch(onPick) {
    const input = el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search players by nickname',
      autocomplete: 'off',
      maxlength: '32',
      role: 'combobox',
      'aria-autocomplete': 'list',
    });
    const list = el('div', { class: 'ac-list', role: 'listbox', hidden: true });
    let results = [];
    let active = -1;
    let timer = null;
    let seq = 0;

    const highlight = (name, q) => {
      const at = name.toLowerCase().indexOf(q.toLowerCase());
      if (at < 0) return [name];
      return [name.slice(0, at), el('mark', { text: name.slice(at, at + q.length) }), name.slice(at + q.length)];
    };

    const close = () => {
      list.hidden = true;
      active = -1;
    };

    const pick = (user, viaKeyboard = false) => {
      close();
      input.value = user.nickname;
      onPick(user, { viaKeyboard });
    };

    const paintList = (q) => {
      if (!results.length) {
        list.replaceChildren(el('div', { class: 'ac-empty', text: `No players match “${q}”` }));
      } else {
        list.replaceChildren(
          ...results.map((u, i) =>
            el('div', {
              class: `ac-item${i === active ? ' active' : ''}`,
              role: 'option',
              onmousedown: (e) => {
                e.preventDefault(); // keep focus in the input
                pick(u);
              },
              // mousemove, not mouseenter: a pointer resting on the list
              // must not steal the highlight back from the arrow keys.
              onmousemove: () => active !== i && setActive(i),
            }, [
              el('span', { class: 'chip-avatar', text: u.avatar }),
              el('span', { class: 'ac-name' }, [...highlight(u.nickname, q), ` ${flag(u.country)}`]),
              u.isFriend ? el('span', { class: 'ac-tag', text: 'friend' }) : null,
              el('span', { class: `dot${u.online ? ' online' : ''}` }),
            ])
          )
        );
      }
      list.hidden = false;
    };

    // Moves the highlight without rebuilding the list.
    const setActive = (i) => {
      active = i;
      list.querySelectorAll('.ac-item').forEach((item, index) => item.classList.toggle('active', index === i));
      const current = list.children[i];
      if (current) current.scrollIntoView({ block: 'nearest' });
    };

    const search = async () => {
      const q = input.value.trim();
      const mine = ++seq;
      if (!q) {
        results = [];
        close();
        return;
      }
      try {
        const { users } = await api.searchUsers(q);
        if (mine !== seq) return; // a newer keystroke already answered
        results = users;
        active = -1;
        paintList(q);
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, 150);
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden || !results.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(active < 0 ? (step > 0 ? 0 : results.length - 1) : (active + step + results.length) % results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(results[Math.max(active, 0)], true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    input.addEventListener('blur', close);
    input.addEventListener('focus', () => input.value.trim() && results.length && paintList(input.value.trim()));

    return { node: el('div', { class: 'ac' }, [input, list]), input };
  }

  async function openFriends() {
    const body = el('div', { class: 'user-list', text: 'Loading…' });
    const picked = el('div', { class: 'ac-picked' });
    let pickedUser = null;
    // Enter on a suggestion adds that player straight away; a mouse pick
    // just shows them with their Add friend / Remove button.
    const finder = userSearch(async (user, { viaKeyboard }) => {
      pickedUser = user;
      paintPicked();
      if (!viaKeyboard || user.isFriend) return;
      try {
        await api.addFriend(user.id);
        toast(`${user.nickname} added to your friends`, 'info');
        finder.input.value = '';
        await paint();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    modal('Friends', el('div', {}, [finder.node, picked, body]));
    setTimeout(() => finder.input.focus(), 0);

    function paintPicked() {
      if (!pickedUser) {
        picked.replaceChildren();
        return;
      }
      picked.replaceChildren(row(pickedUser, pickedUser.isFriend));
    }

    function row(u, isFriend) {
      return el('div', { class: 'user-row' }, [
        el('span', { class: 'chip-avatar', text: u.avatar }),
        el('span', { class: 'chip-name', text: `${u.nickname} ${flag(u.country)}` }),
        el('span', { class: `dot${u.online ? ' online' : ''}` }),
        el('button', {
          class: 'btn small',
          text: '⚔ Challenge',
          onclick: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            try {
              await api.challenge(u.id);
              button.textContent = 'Challenged';
              toast(`Challenge sent to ${u.nickname}`, 'info');
            } catch (err) {
              button.disabled = false;
              toast(err.message, 'error');
            }
          },
        }),
        el('button', {
          class: `btn small${isFriend ? '' : ' primary'}`,
          text: isFriend ? 'Remove' : 'Add friend',
          onclick: async () => {
            try {
              await (isFriend ? api.removeFriend(u.id) : api.addFriend(u.id));
              await paint();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }),
      ]);
    }

    const paint = async () => {
      const [{ friends }, { users }] = await Promise.all([api.friends(), api.users()]);
      const friendIds = new Set(friends.map((f) => f.id));
      if (pickedUser) {
        pickedUser = { ...pickedUser, isFriend: friendIds.has(pickedUser.id) };
        paintPicked();
      }
      body.replaceChildren(
        el('h4', { class: 'sub-head', text: `Your friends (${friends.length})` }),
        friends.length ? el('div', {}, friends.map((f) => row(f, true))) : el('p', { class: 'empty', text: 'No friends added yet.' }),
        el('h4', { class: 'sub-head', text: 'Other players' }),
        el('div', {}, users.filter((u) => !friendIds.has(u.id)).map((u) => row(u, false)))
      );
    };
    try {
      await paint();
    } catch (err) {
      body.replaceChildren(el('p', { class: 'empty', text: err.message }));
    }
  }

  renderProfile(user);
  loadActive();
  loadRecent(true);

  const offGames = events.on('games', () => {
    loadActive();
    loadRecent(true);
  });
  const offPresence = events.on('presence', () => loadActive());

  return () => {
    offGames();
    offPresence();
  };
}
