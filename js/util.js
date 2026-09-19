/* util.js — tiny math + easing helpers */

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp  = (a, b, t) => a + (b - a) * t;
export const rand  = (a, b) => a + Math.random() * (b - a);
export const TAU   = Math.PI * 2;

/** map v from [a,b] to 0..1 (clamped) */
export const seg = (v, a, b) => clamp((v - a) / (b - a));

export const easeOutCubic  = t => 1 - Math.pow(1 - t, 3);
export const easeOutExpo   = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeInCubic   = t => t * t * t;
export const smooth        = t => t * t * (3 - 2 * t);

/** Point on a cubic bezier */
export function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Sample a cubic bezier into `n` points */
export function sampleBez(p0, p1, p2, p3, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(bez(p0, p1, p2, p3, i / n));
  return out;
}

/** Catmull-Rom spline through points -> dense polyline */
export function spline(pts, per = 14) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push({
        x: .5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: .5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Cumulative length table for a polyline (for even-speed travel) */
export function polyLengths(poly) {
  const L = [0];
  for (let i = 1; i < poly.length; i++) {
    L.push(L[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  }
  return L;
}

/** Point at fraction f (0..1) along polyline using its length table */
export function pointAlong(poly, L, f) {
  const total = L[L.length - 1];
  const target = clamp(f) * total;
  let lo = 0, hi = L.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (L[mid] < target) lo = mid; else hi = mid;
  }
  const span = L[hi] - L[lo] || 1;
  const k = (target - L[lo]) / span;
  return {
    x: lerp(poly[lo].x, poly[hi].x, k),
    y: lerp(poly[lo].y, poly[hi].y, k),
    i: lo,
  };
}
