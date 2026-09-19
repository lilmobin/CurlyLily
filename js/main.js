/* main.js — one master timeline, one canvas, one continuous scene.
   Every visual is a pure function of time `T` (seconds since start), so the
   whole experience can be scrubbed, replayed, or debugged with ?t=6.5       */

import { CONFIG } from './config.js';
import { clamp, lerp, seg, easeOutCubic, easeOutExpo, easeInOutSine, easeInOutCubic, smooth, rand } from './util.js';
import { buildSprites, ParticleField, sprites } from './particles.js';
import { TrailSet } from './trails.js';
import { Flower } from './flower.js';
import { Player } from './player.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

/* ─────────── timeline (derived from config) ─────────── */
const C = CONFIG.timing;
const K = {};
K.introEnd       = C.intro;
K.titleFadeStart = C.intro - 1.0;                       // title begins to appear within the intro
K.titleHoldEnd   = K.introEnd + C.titleHold;
K.titleGone      = K.titleHoldEnd + C.titleDissolve;
K.loadStart      = K.titleHoldEnd + C.titleDissolve * .35;   // loader appears while title is dissolving
K.loadEnd        = K.loadStart + C.loading;
K.loadFadeEnd    = K.loadEnd + C.loadFade;
K.flowerHoldEnd  = K.loadEnd + C.flowerHold;
K.dissolveStart  = K.flowerHoldEnd;
K.dissolveEnd    = K.dissolveStart + C.flowerDissolve;
K.playerIn       = K.dissolveStart + C.flowerDissolve * .35;
K.total          = K.dissolveEnd + 1.2;

/* reduced-motion: skip the theatrics and land on the calm final screen (see render()) */

/* ─────────── DOM ─────────── */
const stage   = document.getElementById('stage');
const canvas  = document.getElementById('scene');
const ctx     = canvas.getContext('2d', { alpha: true });
const titleEl = document.getElementById('title');
const titleImg= document.getElementById('titleImg');
const loader  = document.getElementById('loader');
const loaderFill = document.getElementById('loaderFill');
const loaderDot  = document.getElementById('loaderDot');
const playerEl   = document.getElementById('player');

titleImg.src = CONFIG.assets.title;
// if the PNG isn't there yet, hide the broken-image icon so the scene still plays
titleImg.addEventListener('error', () => { titleImg.style.visibility = 'hidden'; });

/* ─────────── systems ─────────── */
buildSprites();
const field  = new ParticleField(CONFIG.particles, reduced);
const trails = new TrailSet(reduced);
const flower = new Flower(reduced);
const player = new Player(CONFIG);

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, CONFIG.particles.dprCap);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width  = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  field.resize(W, H);
  flower.layout(W, H);
}
window.addEventListener('resize', resize);
resize();

/* gentle parallax on pointer / device tilt */
window.addEventListener('pointermove', (e) => {
  field.setParallax((e.clientX / W - .5) * 2, (e.clientY / H - .5) * 2);
}, { passive: true });

/* ─────────── loading gate ───────────
   The loading bar is tied to the timeline (so the flower and the bar move
   together) but it also waits for REAL assets: the title PNG must be decoded
   before we pass the 60% mark, so the reveal at the end never pops in.      */
let titleReady = false;
const markTitle = () => { titleReady = true; };
if (titleImg.complete) markTitle(); else { titleImg.addEventListener('load', markTitle); titleImg.addEventListener('error', markTitle); }
if (titleImg.decode) titleImg.decode().then(markTitle).catch(markTitle);

let audioReady = false;
const audioEl = document.getElementById('audio');
audioEl.addEventListener('loadedmetadata', () => { audioReady = true; });
audioEl.addEventListener('error', () => { audioReady = true; });      // don't hang if file missing
setTimeout(() => { audioReady = true; }, 6000);                        // hard safety net

let gateHold = 0;      // seconds of timeline we've had to pause waiting on assets
function assetsReady() { return titleReady && audioReady; }

/* ─────────── scene state ─────────── */
let started = performance.now();
let last = started;
let finalTriggered = false;
let phaseName = 'intro';
const debugT = params.has('t') ? parseFloat(params.get('t')) : null;

function setPhase(name) {
  if (name === phaseName) return;
  phaseName = name;
  stage.classList.remove('phase-intro', 'phase-title', 'phase-loading', 'phase-final');
  stage.classList.add('phase-' + name);
}


/* ─────────── adaptive quality governor ───────────
   Watches real frame times. If a device can't keep up, it steps quality down:
     level 0 = full   ·  level 1 = DPR 1.5, ~70% particles  ·  level 2 = DPR 1, ~45% particles
   Never steps back up mid-experience (no visible "breathing"). */
let quality = 0, slowStreak = 0, emaMs = 16.7, govFrames = 0, lastStepAt = 0;
function governor(dtMs, nowMs) {
  if (debugT !== null || reduced) return;
  govFrames++;
  if (govFrames < 90) return;                        // ignore startup + asset-decode jank (~1.5s)
  emaMs = emaMs * .95 + Math.min(dtMs, 100) * .05;   // clamp spikes so one hitch can't dominate
  if (emaMs > 30) slowStreak++; else slowStreak = Math.max(0, slowStreak - 3);
  // needs ~2s of SUSTAINED slowness, and at most one step per 4s so a hiccup can't cascade
  if (slowStreak > 120 && quality < 2 && nowMs - lastStepAt > 4000) {
    quality++; slowStreak = 0; emaMs = 16.7; lastStepAt = nowMs;
    applyQuality();
  }
}
function applyQuality() {
  const dprCap = [CONFIG.particles.dprCap, 1.5, 1][quality];
  const density = [1, .7, .45][quality];
  CONFIG.particles.dprCap = Math.min(CONFIG.particles.dprCap, dprCap);
  field.densityMul = density;
  resize();
}

/* ─────────── the frame ─────────── */
function frame(now) {
  requestAnimationFrame(frame);

  const rawMs = now - last;
  let dt = Math.min(.05, rawMs / 1000);
  last = now;
  governor(rawMs, now);

  /* master clock — freezes at 60% of the loading phase until assets are ready */
  let T = debugT !== null ? debugT : (now - started) / 1000 - gateHold;
  if (debugT === null && T > K.loadStart + C.loading * .6 && T < K.loadEnd && !assetsReady()) {
    gateHold += dt;
    T = K.loadStart + C.loading * .6;
  }

  render(T, dt, now / 1000);
}

function render(T, dt, clock) {
  ctx.clearRect(0, 0, W, H);

  /* ── phases ── */
  if (reduced) T = K.total + 5;                               // jump straight to the calm final state
  const inFinal = T >= K.dissolveStart + C.flowerDissolve * .25;
  setPhase(T < K.introEnd ? 'intro' : T < K.loadStart ? 'title' : T < K.dissolveStart ? 'loading' : 'final');

  /* ── DARKNESS lifts from near-black-rose to dusty pink ──
        dark: 1 at 0s  →  ~.55 at title reveal  →  0 around loading start */
  const dark = 1 - easeInOutSine(seg(T, 1.2, K.loadStart + .4));
  stage.style.setProperty('--dark', dark.toFixed(3));

  /* ── AMBIENT particles fade in after the first beat ── */
  const ambient = easeOutCubic(seg(T, .2, 1.6));
  const starV   = easeOutCubic(seg(T, .8, 2.2));
  const fallV   = easeInOutSine(seg(T, K.dissolveStart + .6, K.dissolveEnd + 1.2));

  /* ── LIGHT TRAILS ──
        draw themselves during the intro; fade to a whisper by the final screen */
  const introTrailDraw = [
    easeInOutCubic(seg(T, .8, 3.4)),
    easeInOutCubic(seg(T, 1.3, 4.0)),
    easeInOutCubic(seg(T, 1.8, 4.4)),
    easeInOutCubic(seg(T, 2.2, 4.8)),
  ];
  const trailAlphaMain = 1 - .78 * easeInOutSine(seg(T, K.introEnd + .5, K.loadStart + 1.4));   // dims when the loader appears
  // during the bloom the trails swell slightly again, then settle to "extremely subtle"
  const bloomSwell = .32 * easeInOutSine(seg(T, K.loadStart, K.loadEnd)) * (1 - seg(T, K.dissolveStart, K.dissolveStart + 1.5));
  const finalWhisper = .12;
  const trailAlpha = Math.max(finalWhisper, trailAlphaMain + bloomSwell);

  /* ── draw scene layers ── */
  trails.draw(ctx, dt, clock, W, H, { draw: introTrailDraw, alpha: trailAlpha });
  field.draw(ctx, dt, clock, { ambient, star: starV, fall: fallV });

  /* ── central soft glow that prepares the title (2.8–3.8s brief) ── */
  const cGlow = easeInOutSine(seg(T, 1.8, 3.6)) * (1 - easeInOutSine(seg(T, K.titleHoldEnd, K.titleGone)));
  if (cGlow > .01) {
    const gx = W * .5, gy = H * .27, R = Math.min(W, H) * .55;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
    g.addColorStop(0, `rgba(255,190,208,${.22 * cGlow})`);
    g.addColorStop(1, 'rgba(255,150,175,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(gx - R, gy - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── TITLE: illuminated by a passing light, blooms, holds, then melts into dust ── */
  updateTitle(T);

  /* ── LOADER + FLOWER bloom synced to progress ── */
  const loadP = seg(T, K.loadStart, K.loadEnd);              // 0..1 real progress
  updateLoader(T, loadP);

  // flower bloom uses the SAME progress (with a hair of easing so it never outruns the bar)
  const bloom = clamp(loadP * (loadP >= 1 ? 1 : .985));
  const dissolve = seg(T, K.dissolveStart, K.dissolveEnd);
  flower.draw(ctx, dt, clock, bloom, easeInOutSine(dissolve), W, H);

  /* ── PLAYER fades in as the flower dissolves ── */
  updatePlayer(T);

  /* final-screen hand-off (once) */
  if (!finalTriggered && T >= K.playerIn + .6) {
    finalTriggered = true;
    player.onFinal();
  }
}

/* ─────────── title ─────────── */
let _titleFilterKey = '';
function setTitleFilter(str) { if (str !== _titleFilterKey) { _titleFilterKey = str; titleImg.style.filter = str; } }

function updateTitle(T) {
  // 0→.2→.6→1 opacity while blur 8→4→0 and glow low→high→subtle (brief §11)
  const reveal = easeOutCubic(seg(T, K.titleFadeStart, K.introEnd));
  const opacity = reveal < .25 ? lerp(0, .2, reveal / .25)
                : reveal < .6  ? lerp(.2, .6, (reveal - .25) / .35)
                :                lerp(.6, 1, (reveal - .6) / .4);
  const blur = lerp(8, 0, easeOutCubic(reveal));
  // glow peaks mid-reveal (as the light passes) then settles
  const glowPeak = Math.sin(clamp(reveal) * Math.PI);
  const glowA = .35 + glowPeak * .5;

  // dissolve → title melts away into the particles (fades + drifts up a touch + softens)
  const gone = easeInOutSine(seg(T, K.titleHoldEnd, K.titleGone));
  const o = opacity * (1 - gone);

  titleEl.style.opacity = o.toFixed(3);
  titleEl.style.transform = `translateX(-50%) translateY(${(-gone * 14).toFixed(2)}px) scale(${(1 + gone * .03).toFixed(4)})`;
  setTitleFilter(
    `blur(${(blur + gone * 6).toFixed(1)}px) ` +
    `drop-shadow(0 0 ${(4 + glowPeak * 6).toFixed(0)}px rgba(255,244,245,${glowA.toFixed(2)})) ` +
    `drop-shadow(0 0 ${(18 + glowPeak * 20).toFixed(0)}px rgba(255,190,205,${(glowA * .7).toFixed(2)}))`);

  // a luminous point that travels across the lettering while it is being revealed
  if (reveal > .02 && reveal < .98) {
    const r = titleEl.getBoundingClientRect();
    const x = lerp(r.left - 10, r.right + 10, easeInOutSine(reveal));
    const y = r.top + r.height * (.52 + Math.sin(reveal * Math.PI * 2.2) * .18);
    const s = 46 * Math.sin(reveal * Math.PI) + 8;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .95;
    ctx.drawImage(sprites.dot, x - s / 2, y - s / 2, s, s);
    ctx.globalAlpha = .6;
    ctx.drawImage(sprites.star, x - s * 1.4, y - s * 1.4, s * 2.8, s * 2.8);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // once the flower has dissolved, the title returns to its final resting place
  // (see updatePlayer — title fades back in as the flower turns to light)
}

/* ─────────── loader ─────────── */
function updateLoader(T, p) {
  const inP  = easeOutCubic(seg(T, K.loadStart - .35, K.loadStart + .45));   // blur/scale/fade-in
  const outP = easeInOutSine(seg(T, K.loadEnd + .05, K.loadFadeEnd));        // fades at 100%
  const vis = inP * (1 - outP);

  loader.style.opacity = vis.toFixed(3);
  loader.style.transform = `translate(-50%, -50%) scale(${(lerp(.96, 1, inP) + outP * .02).toFixed(4)})`;

  // eased, cinematic fill; the point glides at the fill's leading edge
  const eased = easeInOutSine(p) * .5 + p * .5;
  loaderFill.style.transform = `scaleX(${eased.toFixed(4)})`;
  const trackW = loaderFill.parentElement.clientWidth;
  loaderDot.style.transform = `translate3d(${(eased * trackW).toFixed(1)}px,0,0)`;
}

/* ─────────── player + returning title ─────────── */
function updatePlayer(T) {
  const pIn = easeOutExpo(seg(T, K.playerIn, K.playerIn + 1.4));
  playerEl.style.opacity = pIn.toFixed(3);
  playerEl.style.transform = `translate(-50%, 0) scale(${lerp(.96, 1, pIn).toFixed(4)})`;

  // final title: the flower turns to light and the title is rewritten in its final position
  const tBack = easeInOutSine(seg(T, K.dissolveStart + C.flowerDissolve * .30, K.dissolveStart + C.flowerDissolve * 1.0));
  if (T > K.dissolveStart) {
    const o = tBack;
    titleEl.style.opacity = o.toFixed(3);
    titleEl.style.transform = `translateX(-50%) translateY(${((1 - tBack) * 10).toFixed(2)}px) scale(1)`;
    const settled = tBack >= .999;
    // once settled the glow is STATIC (no per-frame filter rewrite → the calm final screen stays cheap)
    const glow = settled ? .42 : .38 + .12 * Math.sin(performance.now() / 1800);
    setTitleFilter(
      `blur(${((1 - tBack) * 5).toFixed(1)}px) ` +
      `drop-shadow(0 0 5px rgba(255,244,245,${glow.toFixed(2)})) ` +
      `drop-shadow(0 0 20px rgba(255,190,205,${(glow * .65).toFixed(2)}))`);
  }
}

/* ─────────── start ─────────── */
started = performance.now();
last = started;
requestAnimationFrame(frame);

// tap anywhere during the intro to skip straight to the final screen
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && debugT === null) { started -= (K.total + 1) * 1000; }
});
