/* particles.js — atmospheric particle field
   Categories:
     A) micro   – 1-2px dust, extremely slow
     B) small   – 2-4px glitter, some pulse
     C) stars   – 4-point sparkles that bloom and fade
     D) fall    – final-screen drifters, top -> bottom, shining forever
   Glow is drawn with pre-rendered sprites (fast on mobile). */

import { rand, clamp, TAU } from './util.js';

/* ---------- sprite cache ---------- */
function makeGlowSprite(size, inner, mid, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, inner);
  grd.addColorStop(.18, mid);
  grd.addColorStop(.5, outer);
  grd.addColorStop(1, 'rgba(255,170,190,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeStarSprite(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;

  // soft halo
  const halo = g.createRadialGradient(r, r, 0, r, r, r * .55);
  halo.addColorStop(0, 'rgba(255,240,244,.95)');
  halo.addColorStop(.25, 'rgba(255,190,208,.45)');
  halo.addColorStop(1, 'rgba(255,150,175,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  // four thin rays
  g.globalCompositeOperation = 'lighter';
  for (const ang of [0, Math.PI / 2]) {
    g.save();
    g.translate(r, r);
    g.rotate(ang);
    const ray = g.createLinearGradient(-r, 0, r, 0);
    ray.addColorStop(0, 'rgba(255,220,232,0)');
    ray.addColorStop(.5, 'rgba(255,248,250,1)');
    ray.addColorStop(1, 'rgba(255,220,232,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(-r, 0);
    g.quadraticCurveTo(0, -size * .012, r, 0);
    g.quadraticCurveTo(0, size * .012, -r, 0);
    g.fill();
    g.restore();
  }
  // faint diagonals
  for (const ang of [Math.PI / 4, -Math.PI / 4]) {
    g.save();
    g.translate(r, r);
    g.rotate(ang);
    const ray = g.createLinearGradient(-r * .5, 0, r * .5, 0);
    ray.addColorStop(0, 'rgba(255,220,232,0)');
    ray.addColorStop(.5, 'rgba(255,240,246,.55)');
    ray.addColorStop(1, 'rgba(255,220,232,0)');
    g.fillStyle = ray;
    g.fillRect(-r * .5, -size * .004, r, size * .008);
    g.restore();
  }
  return c;
}

export const sprites = {};
export function buildSprites() {
  sprites.dot   = makeGlowSprite(64, 'rgba(255,255,255,1)',   'rgba(255,240,246,.85)', 'rgba(255,190,208,.22)');
  sprites.warm  = makeGlowSprite(64, 'rgba(255,238,242,1)',   'rgba(255,196,214,.8)',  'rgba(255,140,170,.2)');
  sprites.red   = makeGlowSprite(64, 'rgba(255,150,150,1)',   'rgba(255,48,68,.85)',   'rgba(190,14,40,.24)');   // crimson glint (early trail sparkles)
  sprites.star  = makeStarSprite(128);
}

/* ---------- field ---------- */
export class ParticleField {
  constructor(cfg, reduced) {
    this.cfg = cfg;
    this.reduced = reduced;
    this.w = 0; this.h = 0;
    this.micro = [];
    this.small = [];
    this.stars = [];
    this.fall  = [];
    this.densityMul = 1;                // lowered by the quality governor on slow devices
    this.mouseX = 0; this.mouseY = 0;   // gentle parallax target
    this.px = 0; this.py = 0;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    const area = clamp((w * h) / (390 * 844), .6, 2) * this.densityMul;
    const mk = (n, f) => Array.from({ length: Math.round(n * area) }, f);
    this.micro = mk(this.cfg.micro, () => this._micro());
    this.small = mk(this.cfg.small, () => this._small());
    this.stars = mk(this.cfg.stars, () => this._star(true));
    this.fall  = mk(this.cfg.fall,  () => this._fall(true));
  }

  _micro() {
    return {
      x: rand(0, this.w), y: rand(0, this.h),
      r: rand(.5, 1.1),
      a: rand(.12, .38),
      vx: rand(-.4, .4), vy: rand(-.5, .3),
      ph: rand(0, TAU), sp: rand(.4, 1.1),
      z: rand(.3, 1),
    };
  }
  _small() {
    return {
      x: rand(0, this.w), y: rand(0, this.h),
      r: rand(1, 2),
      a: rand(.3, .8),
      vx: rand(-1.2, 1.2), vy: rand(-1.4, .6),
      ph: rand(0, TAU), sp: rand(.5, 1.6),
      z: rand(.5, 1),
      warm: Math.random() < .35,
    };
  }
  _star(initial) {
    return {
      x: rand(.06, .94) * this.w, y: rand(.04, .96) * this.h,
      size: rand(20, 46),
      life: initial ? rand(0, 1) : 0,
      dur: rand(4.5, 9),
      delay: initial ? 0 : rand(0, 3),
      rot: rand(-.2, .2),
    };
  }
  _fall(initial) {
    const big = Math.random() < .22;
    return {
      x: rand(-.05, 1.05) * this.w,
      y: initial ? rand(-.05, 1.05) * this.h : rand(-.15, -.02) * this.h,
      r: big ? rand(1.6, 2.6) : rand(.7, 1.5),
      a: big ? rand(.7, 1) : rand(.35, .85),
      vy: big ? rand(9, 16) : rand(5, 12),           // px/sec, top -> bottom
      sway: rand(4, 14), swaySp: rand(.25, .7),
      ph: rand(0, TAU), tw: rand(.9, 2.6),           // twinkle speed
      warm: Math.random() < .4,
      big,
    };
  }

  /** parallax input in -1..1 */
  setParallax(nx, ny) { this.mouseX = nx; this.mouseY = ny; }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} dt seconds
   * @param {number} t  global seconds
   * @param {object} v  visibility: { ambient, star, fall, fallEase }
   */
  draw(ctx, dt, t, v) {
    const { w, h } = this;
    const mv = this.reduced ? .15 : 1;
    this.px += (this.mouseX - this.px) * .04;
    this.py += (this.mouseY - this.py) * .04;

    ctx.globalCompositeOperation = 'lighter';

    /* A) micro dust */
    if (v.ambient > .01) {
      for (const p of this.micro) {
        p.x += p.vx * dt * mv; p.y += p.vy * dt * mv;
        if (p.x < -4) p.x = w + 4; else if (p.x > w + 4) p.x = -4;
        if (p.y < -4) p.y = h + 4; else if (p.y > h + 4) p.y = -4;
        const tw = .6 + .4 * Math.sin(t * p.sp + p.ph);
        ctx.globalAlpha = p.a * tw * v.ambient;
        const s = p.r * 5;
        ctx.drawImage(sprites.dot, p.x + this.px * 6 * p.z - s / 2, p.y + this.py * 6 * p.z - s / 2, s, s);
      }
    }

    /* B) small glitter */
    if (v.ambient > .01) {
      for (const p of this.small) {
        p.x += p.vx * dt * mv; p.y += p.vy * dt * mv;
        if (p.x < -6) p.x = w + 6; else if (p.x > w + 6) p.x = -6;
        if (p.y < -6) p.y = h + 6; else if (p.y > h + 6) p.y = -6;
        const pulse = .55 + .45 * Math.sin(t * p.sp + p.ph);
        ctx.globalAlpha = p.a * pulse * v.ambient;
        const s = p.r * (7 + pulse * 3);
        const spr = p.warm ? sprites.warm : sprites.dot;
        ctx.drawImage(spr, p.x + this.px * 12 * p.z - s / 2, p.y + this.py * 12 * p.z - s / 2, s, s);
      }
    }

    /* C) star sparkles: appear -> glow -> expand -> fade */
    if (v.star > .01) {
      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        if (s.delay > 0) { s.delay -= dt; continue; }
        s.life += dt / s.dur;
        if (s.life >= 1) { this.stars[i] = this._star(false); continue; }
        // envelope: quick rise, long soft fall
        const e = s.life < .3 ? Math.sin((s.life / .3) * Math.PI / 2) : Math.pow(1 - (s.life - .3) / .7, 1.6);
        const scale = .55 + e * .6 + s.life * .15;
        const size = s.size * scale;
        ctx.globalAlpha = clamp(e * v.star);
        ctx.save();
        ctx.translate(s.x + this.px * 18, s.y + this.py * 18);
        ctx.rotate(s.rot + s.life * .25);
        ctx.drawImage(sprites.star, -size, -size, size * 2, size * 2);
        ctx.restore();
      }
    }

    /* D) final-screen falling shimmer — top -> bottom, forever */
    if (v.fall > .01) {
      for (let i = 0; i < this.fall.length; i++) {
        const p = this.fall[i];
        p.y += p.vy * dt * mv;
        if (p.y > h + 10) { this.fall[i] = this._fall(false); continue; }
        const sx = Math.sin(t * p.swaySp + p.ph) * p.sway;
        const tw = .35 + .65 * Math.pow(.5 + .5 * Math.sin(t * p.tw + p.ph * 2), 2);
        // fade in near top, out near bottom so nothing pops
        const edge = Math.min(1, Math.max(0, p.y / (h * .08)), Math.max(0, (h - p.y) / (h * .1)));
        ctx.globalAlpha = clamp(p.a * tw * v.fall * edge);
        const s = p.r * (p.big ? 9 : 6.5);
        ctx.drawImage(p.warm ? sprites.warm : sprites.dot, p.x + sx - s / 2, p.y - s / 2, s, s);
        if (p.big && tw > .8) {
          // occasional tiny cross-glint on the brighter drifters
          const g = s * 1.9 * (tw - .7) * 3;
          ctx.globalAlpha = clamp((tw - .8) * 3 * v.fall * edge * .8);
          ctx.drawImage(sprites.star, p.x + sx - g, p.y - g, g * 2, g * 2);
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
