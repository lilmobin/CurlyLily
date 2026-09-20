/* trails.js — thin luminous ribbons of light
   Each trail is a spline that:
     • draws itself progressively (0 -> 1)
     • gently breathes over time (control points drift)
     • carries small sparkles that travel ALONG the curve
   Rendered as: wide faint glow pass + thin bright core pass. */

import { rand, clamp, lerp, TAU, spline, polyLengths, pointAlong, seg } from './util.js';
import { sprites } from './particles.js';

class Trail {
  /**
   * @param {Array<{x:number,y:number}>} anchors  in 0..1 space
   * @param {object} o
   */
  constructor(anchors, o = {}) {
    this.anchors = anchors;                 // normalised
    this.amp = o.amp ?? .018;               // breathing amplitude (fraction of width)
    this.speed = o.speed ?? .12;
    this.width = o.width ?? 1;
    this.alpha = o.alpha ?? 1;
    this.riders = Array.from({ length: o.riders ?? 7 }, () => ({
      f: Math.random(),
      v: rand(.012, .034) * (Math.random() < .5 ? 1 : -1),
      r: rand(1.1, 2.6),
      ph: rand(0, TAU),
      a: rand(.55, 1),
    }));
    this.poly = null; this.L = null;
    this.ph = rand(0, TAU);
  }

  rebuild(w, h, t) {
    const pts = this.anchors.map((a, i) => ({
      x: (a.x + Math.sin(t * this.speed + this.ph + i * 1.7) * this.amp) * w,
      y: (a.y + Math.cos(t * this.speed * .8 + this.ph + i * 1.3) * this.amp * .8) * h,
    }));
    this.poly = spline(pts, 12);
    this.L = polyLengths(this.poly);
  }

  /**
   * @param {number} draw   0..1 how much of the ribbon is drawn
   * @param {number} alpha  overall visibility
   * @param {number} white  0..1 colour: 0 = deep crimson, 1 = white light
   */
  render(ctx, dt, t, draw, alpha, reduced, white = 1) {
    if (alpha < .01 || draw < .001) return;
    const poly = this.poly;
    const n = Math.max(2, Math.floor(poly.length * clamp(draw)));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';

    const path = () => {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(poly[i].x, poly[i].y);
    };

    // colour: crimson -> white, driven by how far the pink light has reached the scene
    const mix = (a, b) => Math.round(lerp(a, b, white));
    // soft glow pass (deep red -> pale pink-white)
    ctx.strokeStyle = `rgba(${mix(205, 255)},${mix(22, 196)},${mix(50, 214)},${lerp(.30, .17, white) * alpha * this.alpha})`;
    ctx.lineWidth = 4.2 * this.width; path(); ctx.stroke();
    // hair-thin core (clear red -> white)
    ctx.strokeStyle = `rgba(${mix(255, 255)},${mix(58, 250)},${mix(76, 251)},${lerp(.85, .70, white) * alpha * this.alpha})`;
    ctx.lineWidth = .9 * this.width; path(); ctx.stroke();

    // sparkles are drawn as a crossfade between a crimson glint and the white glint
    const glint = (x, y, s, a) => {
      if (white < .995) { ctx.globalAlpha = clamp(a * (1 - white)); ctx.drawImage(sprites.red, x - s / 2, y - s / 2, s, s); }
      if (white > .005) { ctx.globalAlpha = clamp(a * white);       ctx.drawImage(sprites.dot, x - s / 2, y - s / 2, s, s); }
    };

    // bright head while drawing
    if (draw > .02 && draw < .985) {
      const head = poly[n - 1];
      glint(head.x, head.y, 26, alpha);
      ctx.globalAlpha = 1;
    }

    // sparkles riding the path
    const drawnFrac = clamp(draw);
    for (const p of this.riders) {
      p.f += p.v * dt * (reduced ? .2 : 1);
      if (p.f > 1) p.f -= 1; else if (p.f < 0) p.f += 1;
      const f = p.f * drawnFrac;                      // only ride the drawn part
      const pt = pointAlong(poly, this.L, f);
      const tw = .5 + .5 * Math.sin(t * 2.2 + p.ph);
      const ra = clamp(p.a * tw * alpha * this.alpha);
      glint(pt.x, pt.y, p.r * 8, ra);
      // little comet tail
      const tail = pointAlong(poly, this.L, Math.max(0, f - .012 * Math.sign(p.v || 1)));
      glint(tail.x, tail.y, p.r * 5, ra * .45);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

export class TrailSet {
  constructor(reduced) {
    this.reduced = reduced;
    // Anchors echo the reference: a big S-ribbon sweeping across, an upper arc,
    // and one that orbits the centre.
    this.trails = [
      new Trail([{x:-.08,y:.72},{x:.18,y:.60},{x:.62,y:.66},{x:1.06,y:.74}].concat([]), { amp: .02, riders: 8, width: 1 }),
      new Trail([{x:1.08,y:.63},{x:.72,y:.72},{x:.12,y:.68},{x:.02,y:.80},{x:.34,y:.86},{x:.86,y:.80}], { amp: .022, riders: 9, width: 1.15, speed: .1 }),
      new Trail([{x:-.05,y:.30},{x:.20,y:.16},{x:.56,y:.14},{x:.90,y:.20},{x:1.06,y:.10}], { amp: .016, riders: 6, width: .85, alpha: .85 }),
      new Trail([{x:.20,y:.44},{x:.08,y:.56},{x:.28,y:.66},{x:.60,y:.60},{x:.86,y:.46},{x:.66,y:.32},{x:.34,y:.32}], { amp: .014, riders: 7, width: .9, alpha: .7, speed: .09 }),
    ];
  }

  /**
   * @param {object} v { draw:[per-trail 0..1], alpha }
   */
  draw(ctx, dt, t, w, h, v) {
    for (let i = 0; i < this.trails.length; i++) {
      const tr = this.trails[i];
      tr.rebuild(w, h, t);
      const d = Array.isArray(v.draw) ? v.draw[i] : v.draw;
      const a = Array.isArray(v.alpha) ? v.alpha[i] : v.alpha;
      tr.render(ctx, dt, t, d, a, this.reduced, v.white ?? 1);
    }
  }
}
