/* ============================================================================
   Story Kernel - js/fx.js
   Light / dark theme toggle and the animations that play while the
   simulation runs.

   Load order in index.html: engine.js, app.js, then this file.

   This file never changes the simulation. It wraps r() (the renderer in
   app.js) and, after every render, decorates the DOM that r() just drew:
   it compares the new state S with the previous one and adds CSS classes
   (see css/effects.css) for whatever changed.
   ============================================================================ */
'use strict';

(function () {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  /* -------------------------------------------------------------------------
     1. Theme: light / dark (saved in localStorage; first visit follows the system)
     ------------------------------------------------------------------------- */
  const themeButton = $('bM');

  const currentTheme = () => root.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  function paintThemeButton() {
    themeButton.textContent = currentTheme() === 'dark' ? '☀️ Light' : '🌙 Dark';
  }

  function setTheme(theme) {
    root.classList.add('theme-fade');                       // smooth colour transition
    root.dataset.theme = theme;
    try { localStorage.setItem('sk-theme', theme); } catch (e) { /* storage blocked: ignore */ }
    paintThemeButton();
    setTimeout(() => root.classList.remove('theme-fade'), 450);
  }

  themeButton.onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  systemDark.addEventListener('change', paintThemeButton);
  paintThemeButton();

  /* -------------------------------------------------------------------------
     2. "Running" indicator (moving strip on top, breathing Start button)
        `timer` is the interval id owned by app.js.
     ------------------------------------------------------------------------- */
  function syncRunning() {
    document.body.classList.toggle('running', typeof timer !== 'undefined' && timer !== null);
  }
  const later = () => setTimeout(syncRunning, 0);           // after app.js handled the event
  document.querySelector('nav').addEventListener('click', later);
  document.querySelector('nav').addEventListener('change', later);
  $('tm').addEventListener('input', later);

  /* -------------------------------------------------------------------------
     3. Render hook: animate whatever changed since the last render
     ------------------------------------------------------------------------- */
  const prev = {
    ready: false,      // false until the first decorate() has recorded a baseline
    t: 0, glen: 0, cs: 0,
    done: false,
    q: [],             // pids in the ready queue
    state: {},         // pid -> state
    runPid: 0, pct: 0  // job on the printer and its burst progress
  };

  const FLASH = {      // row flash colour for the NEW state of a process
    NEW: 'rgba(10,132,224,.25)',
    READY: 'rgba(10,132,224,.30)',
    RUNNING: 'rgba(13,148,136,.40)',
    WAITING: 'rgba(245,158,11,.38)',
    TERMINATED: 'rgba(120,130,150,.30)'
  };

  function restart(el, className) {                         // play a CSS animation again
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  function decorate() {
    const motion = !reduceMotion.matches;
    // Rewinding (Time Machine) or Reset goes backwards in time: no animation then.
    const forward = prev.ready && S.t >= prev.t && S.g.length >= prev.glen;
    const animate = motion && forward;

    /* roster: flash rows whose state changed (or that are new) */
    const states = {};
    document.querySelectorAll('#pcb tr[data-pid]').forEach(tr => {
      const p = S.ps.find(x => x.pid === +tr.dataset.pid);
      if (!p) return;
      states[p.pid] = p.state;
      if (animate && prev.state[p.pid] !== p.state) {
        tr.style.setProperty('--flash', FLASH[p.state] || FLASH.NEW);
        tr.classList.add('flash');
      }
    });
    prev.state = states;

    /* clock */
    if (animate && S.t !== prev.t) restart($('clk'), 'tick');

    /* the printer (CPU box) */
    const cpu = $('cpu');
    const ru = run();
    cpu.classList.toggle('busy', motion && Boolean(ru));

    if (ru) {
      const color = col(ru.pid);
      cpu.style.setProperty('--pc', color);
      cpu.style.setProperty('--glow', color.replace('hsl(', 'hsla(').replace(')', ',.55)'));

      if (animate && S.cs > prev.cs) {                      // visible context switch
        restart(cpu, 'switching');
        cpu.insertAdjacentHTML('beforeend', '<span class="cs-tag">⇄ context switch</span>');
        setTimeout(() => cpu.classList.remove('switching'), 700);
      }

      // progress bar of the current burst (grows from where it was last tick)
      const total = ru.segs[ru.si] || 1;
      const pct = Math.max(0, Math.min(100, Math.round((1 - ru.seg / total) * 100)));
      const from = prev.runPid === ru.pid ? prev.pct : 0;
      cpu.insertAdjacentHTML('beforeend', '<div class="pbar"><i></i></div>');
      const fill = cpu.lastElementChild.firstElementChild;
      fill.style.width = (animate ? from : pct) + '%';
      void fill.offsetWidth;
      fill.style.width = pct + '%';
      prev.runPid = ru.pid;
      prev.pct = pct;
    } else {
      prev.runPid = 0;
      prev.pct = 0;
    }
    prev.cs = S.cs;

    /* print queue: new jobs slide in (chips are drawn in the order of S.q) */
    $('rq').querySelectorAll('.chip').forEach((chip, i) => {
      if (animate && !prev.q.includes(S.q[i])) chip.classList.add('enter');
    });
    prev.q = S.q.slice();

    /* Gantt chart: the newest block grows in */
    const gantt = $('gt');
    if (animate && S.g.length > prev.glen && gantt.lastElementChild) {
      gantt.lastElementChild.classList.add('pop');
    }

    /* all jobs collected: confetti (once per finish) */
    const done = S.ps.length > 0 && allTerminated(S);
    if (animate && done && !prev.done) celebrate();
    prev.done = done;

    prev.t = S.t;
    prev.glen = S.g.length;
    prev.ready = true;
    syncRunning();
  }

  function celebrate() {
    const box = document.createElement('div');
    box.className = 'confetti';
    for (let i = 0; i < 46; i++) {
      const piece = document.createElement('i');
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = `hsl(${Math.floor(Math.random() * 360)},85%,60%)`;
      piece.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
      piece.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + 's';
      piece.style.setProperty('--dx', Math.round(Math.random() * 160 - 80) + 'px');
      box.appendChild(piece);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3800);

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.textContent = '🎉 All print jobs collected!';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3100);
  }

  /* wrap the renderer: every call to r() in app.js now also runs decorate() */
  const baseRender = window.r;
  window.r = function () {
    baseRender();
    try { decorate(); } catch (e) { console.error('fx:', e); }   // effects must never break the simulator
  };

  decorate();      // record the baseline for the screen that is already drawn
})();
