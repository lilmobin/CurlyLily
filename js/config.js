/* ==========================================================
   config.js — everything you are likely to want to change
   ========================================================== */

export const CONFIG = {
  /* ---------- ASSETS (put your files here) ---------- */
  assets: {
    title: 'assets/title.png',      // transparent PNG of "for Curly Lily"
    music: 'assets/music.mp3',      // your song
    cover: 'assets/cover.jpg',      // album artwork (optional; falls back to a pink gradient)
  },

  /* ---------- SONG INFO shown in the player ---------- */
  song: {
    title: 'Cinderella (feat. Ty Dolla $ign)',
    artist: 'Mac Miller',
  },

  /* ---------- TIMELINE (seconds) ----------
     Each phase starts where the previous one ends.
     Change `loading` to make the flower bloom slower/faster. */
  timing: {
    intro: 4.6,        // dark haze -> light trail -> title reveal
    titleHold: 0.9,    // title stays fully visible
    titleDissolve: 1.1,// title melts into particles
    loading: 3.4,      // loading bar + flower bloom (0 -> 100%)
    loadFade: 0.7,     // loading card fades out at 100%
    flowerHold: 0.5,   // flower rests at full bloom
    flowerDissolve: 3.4,// flower turns to particles, final screen appears
  },

  /* ---------- PARTICLES ---------- */
  particles: {
    dprCap: 2,               // max devicePixelRatio (lower = faster on old phones)
    micro: 110,
    small: 46,
    stars: 12,
    fall: 62,                // drifting-down particles on the final screen
  },

  /* ---------- PLAYER ---------- */
  player: {
    startAutomatically: true, // tries to autoplay; if blocked, waits for first tap
  },
};
