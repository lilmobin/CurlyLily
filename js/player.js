/* player.js — real HTML5 audio wired to the glass player.
   The progress bar reflects the ACTUAL playback position (no fake animation). */

const fmt = (s) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

export class Player {
  constructor(cfg) {
    this.cfg = cfg;
    this.audio = document.getElementById('audio');
    this.el = {
      root: document.getElementById('player'),
      cover: document.getElementById('cover'),
      title: document.getElementById('songTitle'),
      artist: document.getElementById('songArtist'),
      bar: document.getElementById('bar'),
      fill: document.getElementById('barFill'),
      knob: document.getElementById('barKnob'),
      cur: document.getElementById('tCur'),
      dur: document.getElementById('tDur'),
      play: document.getElementById('playBtn'),
      prev: document.getElementById('prevBtn'),
      next: document.getElementById('nextBtn'),
      shuffle: document.getElementById('shuffleBtn'),
      repeat: document.getElementById('repeatBtn'),
      heart: document.getElementById('heartBtn'),
    };
    this.seeking = false;
    this.wantsAutoplay = false;
    this.ready = false;         // becomes true once the final screen is shown
    this.hasSource = false;

    this._bindMeta();
    this._bindAudio();
    this._bindUI();
    this._loadSource();
  }

  _bindMeta() {
    this.el.title.textContent = this.cfg.song.title;
    this.el.artist.textContent = this.cfg.song.artist;
    // cover art: try the file; if it fails keep the pink gradient fallback
    const img = new Image();
    img.onload = () => { this.el.cover.style.backgroundImage = `url("${this.cfg.assets.cover}")`; };
    img.src = this.cfg.assets.cover;
  }

  _loadSource() {
    const a = this.audio;
    a.src = this.cfg.assets.music;
    a.addEventListener('error', () => { this.hasSource = false; this._paintTime(); }, { once: false });
    a.load();
  }

  _bindAudio() {
    const a = this.audio;
    a.addEventListener('loadedmetadata', () => {
      this.hasSource = true;
      this.el.dur.textContent = fmt(a.duration);
      this.el.bar.setAttribute('aria-valuemax', Math.round(a.duration));
    });
    a.addEventListener('durationchange', () => { this.el.dur.textContent = fmt(a.duration); });
    a.addEventListener('timeupdate', () => this._paintTime());
    a.addEventListener('play',  () => this._paintPlay(true));
    a.addEventListener('pause', () => this._paintPlay(false));
    a.addEventListener('ended', () => {
      this._paintPlay(false);
      if (this.el.repeat.getAttribute('aria-pressed') === 'true') { a.currentTime = 0; a.play().catch(() => {}); }
    });
    // smooth the bar between timeupdate ticks (still reads the real currentTime)
    const raf = () => { if (!this.seeking) this._paintTime(); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }

  _paintTime() {
    const a = this.audio;
    const d = isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    const p = d ? Math.min(1, a.currentTime / d) : 0;
    this._setBar(p);
    this.el.cur.textContent = fmt(a.currentTime);
    this.el.bar.setAttribute('aria-valuenow', Math.round(p * 100));
  }
  _setBar(p) {
    this.el.fill.style.transform = `scaleX(${p})`;
    const w = this.el.bar.clientWidth;
    this.el.knob.style.transform = `translate3d(${p * w}px,0,0)`;
  }
  _paintPlay(on) {
    this.el.play.classList.toggle('is-playing', on);
    this.el.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
  }

  _bindUI() {
    const { play, bar, heart, shuffle, repeat, prev, next } = this.el;

    play.addEventListener('click', () => this.toggle());

    /* seek: click / drag / keyboard */
    const seekTo = (clientX) => {
      const r = bar.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      if (isFinite(this.audio.duration)) this.audio.currentTime = p * this.audio.duration;
      this._setBar(p);
      this.el.cur.textContent = fmt(this.audio.currentTime);
    };
    bar.addEventListener('pointerdown', (e) => {
      this.seeking = true;
      bar.setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    });
    bar.addEventListener('pointermove', (e) => { if (this.seeking) seekTo(e.clientX); });
    const end = (e) => { if (this.seeking) { this.seeking = false; try { bar.releasePointerCapture(e.pointerId); } catch (_) {} } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      const a = this.audio;
      if (!isFinite(a.duration)) return;
      if (e.key === 'ArrowRight') { a.currentTime = Math.min(a.duration, a.currentTime + 5); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { a.currentTime = Math.max(0, a.currentTime - 5); e.preventDefault(); }
    });

    /* heart — subtle visual only */
    heart.addEventListener('click', () => {
      const on = heart.getAttribute('aria-pressed') !== 'true';
      heart.setAttribute('aria-pressed', String(on));
      heart.classList.remove('pop'); void heart.offsetWidth; heart.classList.add('pop');
    });

    /* toggles (single-song experience → purely visual, harmless) */
    for (const b of [shuffle, repeat]) {
      b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));
    }
    /* prev = restart song, next = harmless nudge to the start */
    prev.addEventListener('click', () => { this.audio.currentTime = 0; });
    next.addEventListener('click', () => {
      next.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    });
  }

  toggle() {
    const a = this.audio;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  /**
   * Called when the final screen appears.
   * Tries to autoplay; if the browser blocks it we wait silently for the first user tap.
   */
  async onFinal() {
    this.ready = true;
    if (!this.cfg.player.startAutomatically) return;
    try {
      await this.audio.play();
    } catch (_) {
      /* Autoplay blocked. The player is fully usable — the visitor can press Play.
         We also start the song on their first tap ANYWHERE that isn't the player itself,
         so the experience begins naturally. Taps on the player controls are left alone
         (they do their own thing) so nothing ever fires twice. */
      const arm = (e) => {
        if (e.target.closest && e.target.closest('#player')) { cleanup(); return; }
        cleanup();
        if (this.audio.paused) this.audio.play().catch(() => {});
      };
      const cleanup = () => {
        window.removeEventListener('pointerdown', arm, true);
        window.removeEventListener('keydown', arm, true);
      };
      window.addEventListener('pointerdown', arm, true);
      window.addEventListener('keydown', arm, true);
    }
  }
}
