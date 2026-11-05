const headers = { 'Content-Type': 'application/json' };

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request('GET', '/api/me'),
  login: (email, password) => request('POST', '/api/login', { email, password }),
  logout: () => request('POST', '/api/logout'),

  users: () => request('GET', '/api/users'),
  friends: () => request('GET', '/api/users/friends'),
  searchUsers: (q) => request('GET', `/api/users/search?q=${encodeURIComponent(q)}`),
  addFriend: (id) => request('POST', `/api/users/friends/${id}`),
  removeFriend: (id) => request('DELETE', `/api/users/friends/${id}`),

  activeGames: () => request('GET', '/api/games/active'),
  recentGames: (offset, limit) => request('GET', `/api/games/recent?offset=${offset}&limit=${limit}`),
  newGame: (opponentId) => request('POST', '/api/games', { opponentId }),
  challenges: () => request('GET', '/api/challenges'),
  challenge: (userId) => request('POST', '/api/challenges', { userId }),
  acceptChallenge: (id) => request('POST', `/api/challenges/${id}/accept`),
  removeChallenge: (id) => request('DELETE', `/api/challenges/${id}`),
  game: (id) => request('GET', `/api/games/${id}`),
  move: (id, move) => request('POST', `/api/games/${id}/move`, move),
  resign: (id) => request('POST', `/api/games/${id}/resign`),
  draw: (id, action) => request('POST', `/api/games/${id}/draw`, { action }),
  chat: (id) => request('GET', `/api/games/${id}/chat`),
  sendChat: (id, body) => request('POST', `/api/games/${id}/chat`, { body }),

  adminUsers: () => request('GET', '/api/admin/users'),
  adminCreateUser: (fields) => request('POST', '/api/admin/users', fields),
};
