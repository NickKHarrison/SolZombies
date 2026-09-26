export function len(x, y) { return Math.hypot(x, y); }

export function norm(x, y) {
  const l = Math.hypot(x, y);
  if (!(l > 1e-9)) return { x: 0, y: 0 };
  return { x: x / l, y: y / l };
}

export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }

export function circleHitsCircle(ax, ay, ar, bx, by, br) {
  const dx = bx - ax, dy = by - ay, r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

export function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

// dx,dy must be a unit vector. Returns distance along the ray to the first
// intersection with the circle, 0 if the origin is inside, or Infinity.
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const b = fx * dx + fy * dy;
  if (b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

// Slab method. Returns entry distance, 0 if inside, or Infinity.
export function rayRect(ox, oy, dx, dy, rx, ry, rw, rh) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-12) {
    if (ox < rx || ox > rx + rw) return Infinity;
  } else {
    let t1 = (rx - ox) / dx, t2 = (rx + rw - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < ry || oy > ry + rh) return Infinity;
  } else {
    let t1 = (ry - oy) / dy, t2 = (ry + rh - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin < 0 ? 0 : tmin;
}

// mulberry32 seeded PRNG
export function createRng(seed) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range(lo, hi) { return lo + (hi - lo) * next(); },
    int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    pick(arr) { return arr.length ? arr[Math.floor(next() * arr.length)] : undefined; },
    chance(p) { return next() < p; },
    weighted(weights) {
      const entries = Object.entries(weights).filter(([, w]) => w > 0);
      let total = 0;
      for (const [, w] of entries) total += w;
      let r = next() * total;
      for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
      return entries.length ? entries[entries.length - 1][0] : undefined;
    },
  };
}

let idCounter = 0;
export function nextId() { return ++idCounter; }
