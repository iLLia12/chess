import { api } from './api.js';
import * as events from './events.js';
import { el, toast } from './ui.js';
import { renderHome } from './home.js';
import { renderGame } from './game.js';

const root = document.getElementById('app');
const statusDot = document.getElementById('conn');
const whoami = document.getElementById('whoami');

let me = null;
let teardown = null;

function navigate(path) {
  if (location.hash.slice(1) === path) route();
  else location.hash = path;
}

function renderLogin() {
  const input = el('input', { class: 'input', placeholder: 'Your nickname', maxlength: '32', autofocus: true });
  const submit = async () => {
    try {
      const { user } = await api.login(input.value);
      me = user;
      events.connect();
      paintHeader();
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  root.replaceChildren(
    el('div', { class: 'login' }, [
      el('div', { class: 'login-card' }, [
        el('div', { class: 'logo', text: '♞' }),
        el('h1', { text: 'chess online' }),
        el('p', { class: 'muted', text: 'Pick a nickname to play. New nicknames create a player.' }),
        input,
        el('button', { class: 'btn primary wide', text: 'Enter', onclick: submit }),
      ]),
    ])
  );
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  input.focus();
}

function paintHeader() {
  whoami.replaceChildren();
  if (!me) return;
  whoami.append(
    el('span', { class: 'me' }, [el('span', { class: 'me-avatar', text: me.avatar }), me.nickname]),
    el('button', {
      class: 'btn small ghost',
      text: 'Sign out',
      onclick: async () => {
        await api.logout();
        events.disconnect();
        me = null;
        paintHeader();
        renderLogin();
      },
    })
  );
}

function route() {
  if (teardown) {
    teardown();
    teardown = null;
  }
  if (!me) {
    renderLogin();
    return;
  }
  const path = location.hash.slice(1) || '/';
  const gameMatch = path.match(/^\/game\/(\d+)$/);
  if (gameMatch) {
    teardown = renderGame(root, { gameId: Number(gameMatch[1]), navigate });
    return;
  }
  teardown = renderHome(root, { user: me, navigate });
}

events.on('status', ({ connected }) => {
  statusDot.className = `conn${connected ? ' on' : ''}`;
  statusDot.title = connected ? 'live updates connected' : 'reconnecting…';
});

// Challenge notifications, wherever the player is in the app.
events.on('games', (payload) => {
  if (!payload) return;
  if (payload.reason === 'challenge-received') toast(`${payload.from} challenged you to a game`, 'info');
  if (payload.reason === 'challenge-accepted' && payload.by) toast(`${payload.by} accepted your challenge`, 'info');
  if (payload.reason === 'challenge-declined' && payload.by) toast(`${payload.by} declined your challenge`, 'info');
  if (payload.reason === 'challenge-cancelled' && payload.by) toast(`${payload.by} took back their challenge`, 'info');
});

window.addEventListener('hashchange', route);

(async function start() {
  try {
    const { user } = await api.me();
    me = user;
  } catch (_) {
    me = null;
  }
  if (me) events.connect();
  paintHeader();
  route();
})();
