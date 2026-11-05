// Move and capture sounds, played from the files in /sounds through the Web
// Audio API: decoded once, so a sound starts the moment a move lands and
// overlapping moves can both play.

const FILES = {
  move: '/sounds/move-self.mp3',
  capture: '/sounds/capture.mp3',
};

let ctx = null;
const buffers = {};

// The files are downloaded straight away, but decoded only once the audio
// context exists: browsers warn about a context created before the player
// has touched the page.
const downloads = Object.fromEntries(
  Object.entries(FILES).map(([name, url]) => [
    name,
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.arrayBuffer();
      })
      .catch((err) => console.warn(`Could not load the ${name} sound:`, err.message)),
  ])
);

function decodeAll(ac) {
  for (const [name, download] of Object.entries(downloads)) {
    download.then(async (bytes) => {
      if (!bytes) return;
      try {
        buffers[name] = await ac.decodeAudioData(bytes);
      } catch (err) {
        console.warn(`Could not decode the ${name} sound:`, err.message);
      }
    });
  }
}

function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    decodeAll(ctx);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow audio after the user has interacted with the page, so
// unlock it on the first click or key press (an opponent's move can arrive
// before we have touched anything).
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => audio(), { once: true, capture: true });
}

function play(name) {
  const ac = audio();
  const buffer = buffers[name];
  if (!ac || ac.state !== 'running' || !buffer) return;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(ac.destination);
  source.start();
}

export function playMove() {
  play('move');
}

export function playCapture() {
  play('capture');
}
