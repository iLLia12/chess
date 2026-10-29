// One SSE connection per tab. Screens subscribe to the event types they care
// about; EventSource reconnects on its own if the server restarts.
const listeners = new Map();
let source = null;

const TYPES = ['hello', 'game', 'games', 'presence', 'friends', 'chat'];

export function connect() {
  if (source) return;
  source = new EventSource('/api/events');
  for (const type of TYPES) {
    source.addEventListener(type, (e) => {
      let payload = null;
      try {
        payload = JSON.parse(e.data);
      } catch (_) {}
      emit(type, payload);
    });
  }
  source.addEventListener('error', () => emit('status', { connected: false }));
  source.addEventListener('open', () => emit('status', { connected: true }));
}

export function disconnect() {
  if (source) source.close();
  source = null;
}

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

function emit(type, payload) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of [...set]) fn(payload);
}
