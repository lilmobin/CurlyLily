/* flower.js — a lily assembled from light
   ─────────────────────────────────────────
   Stages (driven by one `bloom` value 0..1, tied to loading %):
     0.00–0.20  scattered dust starts gathering toward the centre
     0.20–0.35  centre glow appears, first thin lines
     0.35–0.50  first petals trace themselves as luminous outlines
     0.50–0.70  more petals open, fill with translucent pink light
     0.70–0.85  veins brighten, glow intensifies
     0.85–1.00  final petals complete, centre becomes brightest
   Then `dissolve` 0..1 turns every petal into drifting particles
   that spread outward and join the ambient field.               */

import { rand, clamp, lerp, TAU, seg, easeOutCubic, easeOutExpo, easeInOutSine, smooth, sampleBez, polyLengths, pointAlong } from './util.js';
import { sprites } from './particles.js';

/* ---- petal blueprint (unit space: origin = flower base, y up is negative) ----
   Each petal: angle (rotation from vertical, radians), length, width,
   layer (0 = back, 1 = front), start/end in the bloom timeline.          */
const PETALS = [
  // back pair — small, peeking out behind, fanned wide
  { ang: -1.30, len: .78, wid: .17, layer: 0, s: .38, e: .70, skew: -.05, curl: -1.5 },
  { ang:  1.30, len: .78, wid: .17, layer: 0, s: .42, e: .74, skew:  .05, curl:  1.5 },
  // outer three — broad, open, recurved outward like a true lily's tepals
  { ang: -.86,  len: 1.20, wid: .20, layer: 1, s: .42, e: .78, skew: -.06, curl: -1.9 },
  { ang:  .86,  len: 1.20, wid: .20, layer: 1, s: .46, e: .82, skew:  .06, curl:  1.9 },
  { ang: -.36,  len: 1.44, wid: .19, layer: 1, s: .34, e: .70, skew: -.04, curl: -1.2 },
  { ang:  .36,  len: 1.44, wid: .19, layer: 1, s: .38, e: .74, skew:  .04, curl:  1.2 },
  // centre petal — first to draw (petal 1 in the brief), tallest, gently nodding
  { ang: 0,     len: 1.62, wid: .18, layer: 1, s: .26, e: .64, skew: 0, curl: .55 },
  // front pair — last to complete, sweeping low and wide
  { ang: -.64,  len: 1.04, wid: .19, layer: 2, s: .62, e: .94, skew: -.04, curl: -1.6 },
  { ang:  .64,  len: 1.04, wid: .19, layer: 2, s: .66, e: .98, skew:  .04, curl:  1.6 },
];

/** Build the closed outline of one petal in local space, base at (0,0) pointing up (-y).
    Lily-like: narrow base, widest around 55%, a pointed tip that curls a little. */
function petalOutline(len, wid, skew = 0, curl = 0) {
  // the tip sweeps sideways by `curl` so tepals recurve outward instead of standing rigid
  const tip  = { x: curl * len * .20, y: -len * (1 - Math.abs(curl) * .05) };
  const base = { x: 0, y: 0 };
  const L = sampleBez(base,
    { x: -wid * 1.55 + skew * .3, y: -len * .30 },
    { x: -wid * .85  + curl * len * .06, y: -len * .78 },
    tip, 40);
  const R = sampleBez(tip,
    { x: wid * .85 + curl * len * .06, y: -len * .78 },
    { x: wid * 1.55 + skew * .3, y: -len * .30 },
    base, 40);
  return L.concat(R.slice(1));
}
/** centre vein */
function petalVein(len, curl = 0) {
  return sampleBez({ x: 0, y: 0 }, { x: len * .01, y: -len * .32 }, { x: curl * len * .09, y: -len * .68 }, { x: curl * len * .17, y: -len * .94 }, 20);
}

export class Flower {
  constructor(reduced) {
    this.reduced = reduced;
    this.cx = 0; this.cy = 0; this.scale = 1;
    this.petals = PETALS.map(p => {
      const outline = petalOutline(p.len, p.wid, p.skew, p.curl);
      const vein = petalVein(p.len, p.curl);
      return {
        ...p, outline,
        oL: polyLengths(outline),
        vein, vL: polyLengths(vein),
        // per-petal sway phase (subtle life once bloomed)
        ph: rand(0, TAU),
      };
    });

    /* dust that gets pulled in to assemble the flower, and later flies away */
    this.motes = [];
    this.spawned = false;
    this.lastDissolve = 0;
  }

  /** place the flower in canvas space */
  layout(w, h) {
    this.cx = w * .5;
    this.cy = h * .80;                          // base of the flower (blooms upward)
    this.scale = Math.min(w * .42, h * .27);    // petal length unit in px
  }

  /* world position of a point on petal i outline/vein */
  _world(p, pt, sway = 0) {
    const a = p.ang + sway;
    const ca = Math.cos(a), sa = Math.sin(a);
    const s = this.scale;
    return {
      x: this.cx + (pt.x * ca - pt.y * sa) * s,
      y: this.cy + (pt.x * sa + pt.y * ca) * s,
    };
  }

  _spawnMotes(w, h) {
    // one mote group per petal; each mote is assigned a point on that petal's outline
    this.motes = [];
    this.petals.forEach((p, pi) => {
      const n = this.reduced ? 10 : 22;
      for (let k = 0; k < n; k++) {
        const f = k / n + rand(-.01, .01);
        this.motes.push({
          pi, f: clamp(f),
          // starting position: somewhere in the wider scene
          sx: rand(-.1, 1.1) * w, sy: rand(-.05, 1.05) * h,
          delay: rand(0, .35),
          size: rand(.9, 2.1),
          // dissolve velocity (fills in at dissolve time)
          vx: 0, vy: 0, dx: 0, dy: 0, active: false,
          ph: rand(0, TAU),
        });
      }
    });
    this.spawned = true;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} dt
   * @param {number} t
   * @param {number} bloom     0..1  loading-synced
   * @param {number} dissolve  0..1  final dissolve
   * @param {number} glowMul   extra brightness pulse
   */
  draw(ctx, dt, t, bloom, dissolve, w, h) {
    if (bloom <= 0.001 && dissolve <= 0) return;
    if (!this.spawned) this._spawnMotes(w, h);

    const s = this.scale;
    const dis = clamp(dissolve);
    const vis = 1 - easeInOutSine(seg(dis, .10, .96));      // overall flower body opacity (lingers)
    const sway = this.reduced ? 0 : 1;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    /* ── centre glow (appears early, ends as brightest) ── */
    const cg = easeOutCubic(seg(bloom, .16, .95));
    if (cg > 0.01 && vis > .01) {
      const pulse = 1 + (this.reduced ? 0 : Math.sin(t * 1.6) * .05);
      const R = s * (.38 + cg * .62) * pulse * (1 + dis * .35);
      const gx = this.cx, gy = this.cy - s * .28;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
      g.addColorStop(0,   `rgba(255,206,222,${.26 * cg * vis})`);
      g.addColorStop(.30, `rgba(255,168,196,${.15 * cg * vis})`);
      g.addColorStop(.70, `rgba(255,140,172,${.05 * cg * vis})`);
      g.addColorStop(1,   'rgba(255,140,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gx - R, gy - R, R * 2, R * 2);
    }

    /* ── petals (back → front) ── */
    const order = [0, 1, 2];
    for (const layer of order) {
      for (const p of this.petals) {
        if (p.layer !== layer) continue;
        const grow = easeOutExpo(seg(bloom, p.s, p.e));        // 0..1 for this petal
        if (grow <= 0.001 || vis <= 0.001) continue;

        const swayA = Math.sin(t * .7 + p.ph) * .018 * sway * seg(bloom, .9, 1);
        const draw = clamp(seg(grow, 0, .62));                  // outline tracing
        const fill = easeOutCubic(seg(grow, .38, 1));           // translucent fill
        const open = .82 + .18 * easeOutCubic(grow);            // unfurl scale
        const dim = layer === 0 ? .62 : layer === 1 ? .85 : 1;

        // transform into petal space with unfurl
        const wpt = (pt) => this._world(p, { x: pt.x * open, y: pt.y * open }, swayA);

        const n = Math.max(2, Math.floor(p.outline.length * draw));

        /* translucent fill once outline is mostly drawn */
        const pv = 1 - easeInOutSine(seg(dis, .04 + (p.layer === 0 ? 0 : p.layer === 1 ? .1 : .16) + Math.abs(p.ang) * .06, .62 + (p.layer === 0 ? 0 : p.layer === 1 ? .09 : .14)));
        if (fill > .01 && pv > .005) {
          ctx.fillStyle = `rgba(255,178,204,${(.26 * fill * vis * dim * pv).toFixed(3)})`;
          ctx.beginPath();
          const fullN = p.outline.length;
          for (let i = 0; i < fullN; i++) {
            const q = wpt(p.outline[i]);
            if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
          }
          ctx.closePath();
          ctx.globalAlpha = 1;
          ctx.fill();
        }

        /* glowing outline (traced progressively) */
        const strokePass = (lw, col) => {
          ctx.lineWidth = lw; ctx.strokeStyle = col;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const q = wpt(p.outline[i]);
            if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
          }
          ctx.stroke();
        };
        // staggered dissolve — back/outer petals release first, the centre petal last
        const rank = p.layer === 0 ? 0 : p.layer === 1 ? .2 : .32;
        const petalVis = 1 - easeInOutSine(seg(dis, .04 + rank * .5 + Math.abs(p.ang) * .06, .62 + rank * .45));
        const oa = vis * dim * petalVis;
        strokePass(3, `rgba(255,180,204,${.20 * oa})`);
        strokePass(.9, `rgba(255,232,240,${.70 * oa})`);

        /* veins brighten as the petal opens */
        const veinA = easeOutCubic(seg(grow, .55, 1)) * seg(bloom, .55, .95);
        if (veinA > .01) {
          ctx.lineWidth = .6;
          ctx.strokeStyle = `rgba(255,236,242,${.55 * veinA * oa})`;
          ctx.beginPath();
          const vn = Math.max(2, Math.floor(p.vein.length * veinA));
          for (let i = 0; i < vn; i++) {
            const q = wpt(p.vein[i]);
            if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
          }
          ctx.stroke();
        }

        /* the travelling light-point that is "drawing" the outline */
        if (draw < .999 && draw > 0.01) {
          const q = wpt(p.outline[n - 1]);
          const sz = 30;
          ctx.globalAlpha = vis;
          ctx.drawImage(sprites.dot, q.x - sz / 2, q.y - sz / 2, sz, sz);
          ctx.globalAlpha = 1;
        }
      }
    }

    /* ── motes: dust that flies in, rides the outlines, then flies away ── */
    this._motes(ctx, dt, t, bloom, dis, w, h);

    /* ── stem-ish soft base glow so the lily seems to rise from light ── */
    const base = easeOutCubic(seg(bloom, .3, 1)) * vis;
    if (base > .01) {
      const R = s * .9;
      const g = ctx.createRadialGradient(this.cx, this.cy + s * .02, 0, this.cx, this.cy + s * .02, R);
      g.addColorStop(0, `rgba(255,206,222,${.16 * base})`);
      g.addColorStop(1, 'rgba(255,170,195,0)');
      ctx.fillStyle = g;
      ctx.fillRect(this.cx - R, this.cy - R, R * 2, R * 2);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  _motes(ctx, dt, t, bloom, dis, w, h) {
    const petals = this.petals;
    for (const m of this.motes) {
      const p = petals[m.pi];
      const swayA = 0;
      const outlinePt = pointAlong(p.outline, p.oL, m.f);
      const target = this._world(p, outlinePt, swayA);

      if (dis <= 0) {
        /* ASSEMBLY: fly from scattered start to its spot on the petal outline */
        const start = p.s - .2, end = p.s + (p.e - p.s) * .55;
        const k = easeOutCubic(seg(bloom - m.delay * .12, start, end));
        if (k <= 0.001) continue;
        const x = lerp(m.sx, target.x, k);
        const y = lerp(m.sy, target.y, k);
        // a curved approach so dust swirls in rather than flying straight
        const curve = Math.sin(k * Math.PI) * (1 - k) * 60;
        const cx = x + curve * Math.cos(m.ph);
        const cy = y + curve * Math.sin(m.ph);
        // brighter as it nears the petal, then settles to a soft glint
        const near = k < 1 ? .35 + .65 * k : .55 + .35 * Math.sin(t * 2 + m.ph);
        ctx.globalAlpha = clamp(near);
        const sz = m.size * (k < 1 ? 7 : 6);
        ctx.drawImage(sprites.warm, cx - sz / 2, cy - sz / 2, sz, sz);
      } else {
        /* DISSOLVE: each mote leaves the petal and drifts outward, then joins the sky */
        if (!m.active) {
          m.active = true;
          const dx = target.x - this.cx, dy = target.y - (this.cy - this.scale * .5);
          const d = Math.hypot(dx, dy) || 1;
          const sp = rand(14, 46);
          m.vx = dx / d * sp + rand(-8, 8);
          m.vy = dy / d * sp * .7 + rand(-20, -4);       // lifts a little first
          m.dx = target.x; m.dy = target.y;
          m.born = t;
          m.wait = rand(0, .5) + (this.petals[m.pi].layer === 0 ? 0 : this.petals[m.pi].layer === 1 ? .35 : .6) + (1 - m.f) * .3;  // staggered release
        }
        const age = Math.max(0, t - m.born - m.wait);
        if (age <= 0) {
          ctx.globalAlpha = .75;
          const sz = m.size * 6;
          ctx.drawImage(sprites.warm, m.dx - sz / 2, m.dy - sz / 2, sz, sz);
          continue;
        }
        // burst outward, then get caught by the same top→bottom drift as the final-screen shimmer
        const settle = clamp(age / 2.2);                        // 0..1: outward burst → gentle fall
        const outward = 1 - Math.pow(1 - clamp(age / 1.6), 2);  // ease-out travel
        const x = m.dx + m.vx * 2.4 * outward + Math.sin(age * .8 + m.ph) * (5 + settle * 8);
        const y = m.dy + m.vy * 1.6 * outward + settle * age * 15;
        const fade = clamp(1 - Math.max(0, age - 2.4) / 4.2);   // long, soft fade
        if (fade <= 0) continue;
        const tw = .55 + .45 * Math.sin(t * (2 + m.size) + m.ph * 3);
        ctx.globalAlpha = clamp(tw * fade * .95);
        const sz = m.size * (5.5 + tw * 2);
        ctx.drawImage(sprites.warm, x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** reset so the animation can replay */
  reset() {
    this.motes.forEach(m => (m.active = false));
    this.spawned = false;
  }
}
