/* Shared by the inner pages (contact, about). Same behaviour as the homepage: fog headings, menu drawer,
   gentle reveals on scroll, letter-scramble hover on [data-decrypt]. */

/* fog reveal: wrap each word so it can emerge from a blur, one after another */
document.querySelectorAll('[data-fog]').forEach(h => {
  let i = 0;
  const walk = n => [...n.childNodes].forEach(c => {
    if (c.nodeType === 3) {
      const frag = document.createDocumentFragment();
      c.textContent.split(/([ \t\n]+)/).forEach(part => {
        if (!part) return;
        if (/^[ \t\n]+$/.test(part)) { frag.append(part); return; }
        const g = part.includes(' ') ? document.createElement('span') : frag;
        if (g !== frag) { g.className = 'fog-g'; frag.append(g); }
        part.split(' ').forEach((word, k) => {
          if (k) g.append(' ');
          if (!word) return;
          const w = document.createElement('span'); w.className = 'fog-w'; w.textContent = word;
          w.style.setProperty('--i', i++); g.append(w);
        });
      });
      c.replaceWith(frag);
    } else if (c.nodeType === 1) walk(c);
  });
  walk(h);
});

/* menu drawer + reveals */
(() => {
  const header = document.getElementById('site-header');
  const setScrolled = () => header.classList.toggle('is-scrolled', scrollY > 40);
  addEventListener('scroll', setScrolled, { passive: true }); setScrolled();
  const drawer = document.getElementById('site-drawer');
  const burger = document.querySelector('.header__burger');
  let last = null;
  const open = () => {
    last = document.activeElement;
    drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false');
    burger.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('drawer-open');
    setTimeout(() => drawer.querySelector('.drawer__nav a')?.focus(), 50);
  };
  const close = () => {
    drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true');
    burger.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('drawer-open');
    (last || burger).focus?.({ preventScroll: true });
  };
  burger.addEventListener('click', open);
  drawer.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
  addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('is-open')) close(); });

  // reveal once fonts are in (so headings don't re-wrap mid-animation), then as blocks scroll into view
  const targets = [...document.querySelectorAll('[data-reveal], [data-stair]')]; // data-stair: the About staircase steps in as one group
  const start = () => {
    if (!('IntersectionObserver' in window)) { targets.forEach(el => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
    targets.forEach(el => io.observe(el));
  };
  Promise.race([document.fonts?.ready || Promise.resolve(), new Promise(r => setTimeout(r, 1200))])
    .then(() => requestAnimationFrame(() => requestAnimationFrame(start)));
})();

/* Decrypted-text hover for [data-decrypt] */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+';
  const SPEED = 45;
  document.querySelectorAll('[data-decrypt]').forEach(el => {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    const wrap = document.createElement('span'); wrap.setAttribute('aria-hidden', 'true');
    const cells = []; let word = null;
    [...text].forEach(ch => {
      if (/\s/.test(ch)) { wrap.append(ch); word = null; return; }
      if (!word) { word = document.createElement('span'); word.className = 'dc-word'; wrap.append(word); }
      const cell = document.createElement('span'); cell.className = 'dc-cell';
      const c = document.createElement('span'); c.className = 'dc-char'; c.textContent = ch;
      const g = document.createElement('span'); g.className = 'dc-glyph';
      cell.append(c, g); word.append(cell); cells.push({ cell, c, g });
    });
    el.append(wrap);
    let timer = null, queue = [];
    const scramble = item => {
      item.g.textContent = POOL[Math.floor(Math.random() * POOL.length)];
      const need = item.g.offsetWidth, room = item.c.offsetWidth;
      item.g.style.setProperty('--sq', need > room ? (room / need).toFixed(3) : 1);
    };
    const stop = () => { clearInterval(timer); timer = null; cells.forEach(i => i.cell.classList.remove('is-scrambled')); };
    const tick = () => {
      const next = queue.shift();
      if (next) next.cell.classList.remove('is-scrambled');
      cells.forEach(i => { if (i.cell.classList.contains('is-scrambled')) scramble(i); });
      if (!queue.length) stop();
    };
    el.addEventListener('mouseenter', () => {
      if (timer) return;
      cells.forEach(i => { i.cell.classList.add('is-scrambled'); scramble(i); });
      queue = [...cells]; timer = setInterval(tick, SPEED);
    });
    el.addEventListener('mouseleave', stop);
  });
})();
