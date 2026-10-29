// Move and capture sounds, synthesised with the Web Audio API (no audio
// files). A wooden "tock" is a short burst of filtered noise for the click
// plus a quickly decaying low sine for the body of the piece.

let ctx = null;

function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
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

function knock(ac, at, { freq, body, gain, length }) {
  const noise = ac.createBuffer(1, Math.ceil(ac.sampleRate * length), ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const click = ac.createBufferSource();
  click.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.2;
  const clickGain = ac.createGain();
  clickGain.gain.value = gain;
  click.connect(band).connect(clickGain).connect(ac.destination);
  click.start(at);

  const thump = ac.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(body, at);
  thump.frequency.exponentialRampToValueAtTime(body * 0.6, at + length * 2);
  const thumpGain = ac.createGain();
  thumpGain.gain.setValueAtTime(gain * 0.8, at);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, at + length * 2);
  thump.connect(thumpGain).connect(ac.destination);
  thump.start(at);
  thump.stop(at + length * 2 + 0.02);
}

export function playMove() {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  knock(ac, ac.currentTime, { freq: 1900, body: 180, gain: 0.5, length: 0.05 });
}

export function playCapture() {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const now = ac.currentTime;
  knock(ac, now, { freq: 1300, body: 140, gain: 0.8, length: 0.07 });
  knock(ac, now + 0.07, { freq: 2600, body: 260, gain: 0.35, length: 0.04 });
}
