// device.js (WO6 Agent C) — touch-device detection, orientation, immersive mode.
// Safe in Node: every browser global is guarded. Functions accept an optional `env`
// ({ window, navigator, location, screen, document }) so tests can inject fakes.

let cached = null; // memoized isMobile() result for the page load

function defaultEnv() {
  const w = typeof window !== 'undefined' ? window : undefined;
  return {
    window: w,
    navigator: typeof navigator !== 'undefined' ? navigator : (w && w.navigator),
    location: typeof location !== 'undefined' ? location : (w && w.location),
    screen: w && w.screen,
    document: typeof document !== 'undefined' ? document : (w && w.document),
  };
}

function resolveEnv(env) {
  if (!env) return defaultEnv();
  const w = env.window;
  return {
    window: w,
    navigator: env.navigator ?? (w && w.navigator),
    location: env.location ?? (w && w.location),
    screen: env.screen ?? (w && w.screen),
    document: env.document ?? (w && w.document),
  };
}

/** Pure detection (not memoized). Returns true / false. */
export function detectMobile(env) {
  const e = resolveEnv(env);
  try {
    const search = (e.location && e.location.search) || '';
    const m = /[?&]touch=([01])\b/.exec(search);
    if (m) return m[1] === '1';
    const w = e.window;
    if (w && typeof w.matchMedia === 'function') {
      const mq = w.matchMedia('(pointer: coarse)');
      if (mq && mq.matches) return true;
    }
    const tp = e.navigator && Number(e.navigator.maxTouchPoints);
    if (tp > 0) {
      const s = e.screen;
      const sw = s && Number(s.width), sh = s && Number(s.height);
      let shortSide = Infinity;
      if (sw > 0 && sh > 0) shortSide = Math.min(sw, sh);
      else if (w && w.innerWidth > 0 && w.innerHeight > 0) shortSide = Math.min(w.innerWidth, w.innerHeight);
      if (shortSide < 900) return true;
    }
  } catch { /* fall through */ }
  return false;
}

/** Memoized per page load; honours ?touch=1|0. Passing `env` bypasses and refreshes the cache. */
export function isMobile(env) {
  if (env) return (cached = detectMobile(env));
  if (cached === null) cached = detectMobile();
  return cached;
}

/** window.innerHeight > window.innerWidth (false without a window). */
export function isPortrait(env) {
  const w = resolveEnv(env).window;
  if (!w) return false;
  return Number(w.innerHeight) > Number(w.innerWidth);
}

/** Fullscreen + landscape lock, best effort. Call inside a user gesture. Never throws. */
export function requestImmersive(env) {
  try {
    const e = resolveEnv(env);
    const lock = () => {
      try {
        const o = e.screen && e.screen.orientation;
        if (o && typeof o.lock === 'function') {
          const p = o.lock('landscape');
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch { /* ignored */ }
    };
    const doc = e.document;
    const root = doc && doc.documentElement;
    const fsEl = doc && (doc.fullscreenElement || doc.webkitFullscreenElement);
    const req = root && (root.requestFullscreen || root.webkitRequestFullscreen);
    if (!fsEl && typeof req === 'function') {
      const p = req.call(root, { navigationUI: 'hide' });
      // The orientation lock usually only succeeds once fullscreen is active.
      if (p && typeof p.then === 'function') { p.then(lock, () => {}); return; }
    }
    lock();
  } catch { /* ignored: best effort */ }
}

/** Test helper: clears the memoized isMobile() result. */
export function _resetForTests() {
  cached = null;
}
