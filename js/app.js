/* ============================================================================
   Story Kernel - js/app.js
   User interface: controls, the Time Machine and rendering.
   Skin: Busy Computer Laboratory / Print Station.
   ITEC 55 Platform Technologies, Cavite State University.
   Author / submitter: John Carlo B. Diaday, BSIT 2-4.
   Interface built with AI assistance (Claude); see the AI-Use Disclosure in the manual.

   This file never changes a process by itself. It calls the engine (js/engine.js)
   and r() only draws the state object S.
   ============================================================================ */
'use strict';

const $ = id => document.getElementById(id);

/* ---------------------------------------------------------------------------
   1. Label dictionaries (OS view and Story view)
   --------------------------------------------------------------------------- */
const ST = {
  os:    { NEW: 'NEW', READY: 'READY', RUNNING: 'RUNNING', WAITING: 'WAITING', TERMINATED: 'TERMINATED' },
  story: { NEW: 'Submitting', READY: 'In queue', RUNNING: 'Printing', WAITING: 'At scanner', TERMINATED: 'Collected' }
};

const LB = {
  os: {
    h1: 'Process Control Blocks', h2: 'CPU', h3: 'Ready queue', h4: 'Gantt chart',
    h5: 'Threads (TCB)', h6: 'Kernel log', h7: 'Memory map (kernel 64 KB + user 256 KB)',
    idle: 'CPU idle',
    sys: ['create_process', 'terminate', 'create_thread', 'join_thread', 'io_request', 'yield', 'deadlock_demo']
  },
  story: {
    h1: 'Print job roster', h2: 'Shared printer', h3: 'Print queue', h4: 'Printing timeline',
    h5: 'Documents in this job', h6: 'Technician logbook', h7: 'Print spool space',
    idle: 'Printer is idle, waiting for a job',
    sys: ['New print job', 'Cancel job', 'Add document', 'Remove document',
          'Go to scanner', 'Let others print first', 'Two jobs block each other']
  }
};

const WHY_HINT = 'Click any block in the chart to see why the scheduler chose it.';

/* ---------------------------------------------------------------------------
   2. Application state
      S    simulation state (owned by the engine)
      H    history for the Time Machine: one JSON snapshot of S per time unit
      V    current view: 'os' or 'story'
      sel  pid selected in the roster
   --------------------------------------------------------------------------- */
let S, H;
let V = 'os';
let sel = 1;
let timer = null;
let algo = 'RR';
let quant = 3;
let wl = 'bal';
let whyIndex = null;                        // Gantt block whose Why? text is on screen

/** A stable colour for each process id (grey when the CPU is idle). */
const col = pid => (pid ? `hsl(${pid * 67 % 360},75%,60%)` : '#6b7199');

/** Stores the current state as the snapshot of the current time unit and redraws. */
function save() {
  H.length = S.t + 1;
  H[S.t] = JSON.stringify(S);
  r();
}

/* ---------------------------------------------------------------------------
   3. Actions: tick loop, system calls, deadlock recovery
   --------------------------------------------------------------------------- */
function deadlockIsFinal() {
  const nothingCanRun = !S.run && !S.q.length;
  const noFutureWork = !S.ps.some(p => p.state === 'NEW' || (p.state === 'WAITING' && !p.wl));
  return Boolean(S.dead) && nothingCanRun && noFutureWork;
}

/** One time unit. The timer calls this once per interval so the page never freezes. */
function tick() {
  S.algo = algo;
  S.quantum = quant;
  H.length = S.t + 1;                       // replaying from the past discards the future
  const more = step(S);
  H[S.t] = JSON.stringify(S);
  if (!more || deadlockIsFinal()) pause();
  r();
}

function pause() {
  clearInterval(timer);
  timer = null;
}

function start() {
  if (!timer) timer = setInterval(tick, +$('sp').value);
}

function reset() {
  pause();
  S = mk(wl, algo, quant);
  H = [JSON.stringify(S)];
  sel = 1;
  $('why').textContent = WHY_HINT;
  whyIndex = null;
  r();
}

/** Runs system call number i on the selected process. */
function sys(i) {
  const logLines = S.log.length;
  SYS[i]();
  if (S.log.length === logLines) return;      // nothing happened (e.g. yield on a job that is not running)
  S.irq.sys++;
  S.mode = 'K';
  save();
}

function resolveDeadlock() {
  breakDeadlock(S);
  save();
}

/** Benchmark: every algorithm on every workload, run headless with the same engine. */
function benchmark() {
  let html = '<table><tr><th>Workload<th>Algorithm<th>Avg wait<th>Avg turnaround<th>Avg response<th>Switches';
  for (const w in W) {
    const rows = Object.keys(ALG).map(a => {
      const s = mk(w, a, quant);
      for (let n = 0; step(s) && n < 999; n++);
      return { a, m: met(s), cs: s.cs };
    });
    const best = Math.min(...rows.map(x => +x.m.wt));
    rows.forEach(({ a, m, cs }, i) => {
      const star = +m.wt === best ? ' ★' : '';
      html += `<tr><td>${i ? '' : WN[w]}<td>${ALG[a]}${star}<td>${m.wt}<td>${m.tat}<td>${m.rt}<td>${cs}`;
    });
  }
  $('bt').innerHTML = html + `</table><p>★ marks the lowest average waiting time. Round Robin uses quantum ${quant}.</p>`;
  $('bm').showModal();
}

/** Click on a Gantt block: show the Why? text for that scheduling decision. */
function explain(i) {
  const os = V === 'os';
  const g = S.g[i];
  whyIndex = i;
  if (!g.pid) {
    $('why').textContent = os
      ? `t=${g.t}: CPU idle because the ready queue was empty.`
      : `Time ${g.t}: the printer waited because the queue was empty.`;
    return;
  }
  const w = [...S.why].reverse().find(x => x.t <= g.t && x.pid === g.pid);
  const text = w ? (os ? w.o : w.s) + (w.t < g.t ? ` (it kept the CPU since t=${w.t})` : '') : '';
  $('why').textContent = `t=${g.t}: ` + text;
}

/* ---------------------------------------------------------------------------
   4. Wiring of the controls
   --------------------------------------------------------------------------- */
$('bS').onclick = () => { pause(); start(); };
$('bP').onclick = pause;
$('bT').onclick = () => { pause(); tick(); };
$('bR').onclick = reset;
$('bB').onclick = benchmark;
$('bH').onclick = () => $('hp').showModal();
$('bV').onclick = () => {
  V = V === 'os' ? 'story' : 'os';
  $('bV').textContent = V === 'os' ? '👁 Story view' : '👁 OS view';
  r();
  if (whyIndex !== null) explain(whyIndex);          // keep the Why? text in the chosen wording
};

$('al').onchange = e => { algo = e.target.value; S.algo = algo; };
$('qt').onchange = e => { quant = Math.max(1, +e.target.value || 3); S.quantum = quant; };
$('wk').onchange = e => { wl = e.target.value; reset(); };
$('sp').onchange = () => { if (timer) { pause(); start(); } };

$('tm').oninput = e => {                     // Time Machine: restore an earlier snapshot
  pause();
  S = JSON.parse(H[+e.target.value]);
  $('why').textContent = WHY_HINT;
  whyIndex = null;
  r();
};

// Clicks on generated elements are handled once here instead of inline onclick attributes.
$('gt').onclick = e => { const c = e.target.closest('.gc'); if (c) explain(+c.dataset.i); };
$('pcb').onclick = e => {
  const row = e.target.closest('tr[data-pid]');
  if (row) { sel = +row.dataset.pid; r(); }
};
$('sy').onclick = e => {
  const b = e.target.closest('button[data-i]');
  if (b) sys(+b.dataset.i);
};
$('dl').onclick = e => { if (e.target.closest('button')) resolveDeadlock(); };
document.querySelectorAll('[data-close]').forEach(b => {
  b.onclick = () => b.closest('dialog').close();
});

/* ---------------------------------------------------------------------------
   5. Rendering, r(): reads S and never changes it
   --------------------------------------------------------------------------- */
function r() {
  const L = LB[V];
  const os = V === 'os';
  const say = (osText, storyText) => (os ? osText : storyText);        // pick the wording for the view
  const P = id => S.ps.find(p => p.pid === id);
  const nm = p => (os ? 'P' + p.pid : p.name);

  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'].forEach(k => { $(k).textContent = L[k]; });
  renderHeader(say, nm, P);
  renderRoster(say, os);
  renderCpuAndQueue(say, nm, P, L);
  renderGantt(os, P);
  $('sy').innerHTML = L.sys.map((s, i) => `<button data-i="${i}">${s}</button>`).join('');
  renderThreads(say, os);
  renderAverages(say, nm, P);
  renderMemory(say, os, P);
  $('lg').innerHTML = S.log.slice(-40).reverse().map(l => `<div>[${l.t}] ${os ? l.o : l.s}</div>`).join('');
  $('tm').max = H.length - 1;
  $('tm').value = S.t;
  $('tl').textContent = `${S.t} / ${H.length - 1}`;
}

function renderHeader(say, nm, P) {
  $('sc').textContent = say('Mini-OS simulator', 'Computer lab print station');
  const mode = S.mode === 'K'
    ? say('Kernel mode', '🛠 Technician desk')
    : say('User mode', '💻 At the workstation');
  $('badge').innerHTML = `<span class="m ${S.mode}">${mode}</span>`;
  $('clk').textContent = `t = ${S.t}`;

  $('dl').innerHTML = S.dead
    ? `<b>⚠ ${say('Deadlock detected', 'Print jam!')}</b> ${say('Circular wait', 'The jobs block each other')}: ` +
      S.dead.concat(S.dead[0]).map(id => nm(P(id))).join(' → ') +
      ` <button>${say('Break deadlock (kill victim)', 'Cancel one job')}</button>`
    : '';
}

function renderRoster(say, os) {
  const head = say(
    ['PID', 'Name', 'State', 'Pri', 'Arr', 'Burst', 'Rem', 'PPID', 'Memory KB', 'PC / SP / AX'],
    ['Job', 'Who', 'Status', 'Rank', 'Sent at', 'Pages', 'Left', 'Sent by', 'Spool space', 'Docs']
  );
  const status = p => (p.wl ? say('BLOCKED on ' + p.wl, 'Waiting for the ' + LOCK_STORY[p.wl]) : ST[V][p.state]);
  const memory = p => (p.base < 0 ? '–' : `${p.base}-${p.base + p.mem - 1}`);
  const regs = p => (os ? `${p.regs.PC} / 0x${p.regs.SP.toString(16)} / ${p.regs.AX}` : `${p.th.length} docs`);

  const rows = S.ps.map(p =>
    `<tr class="${p.pid === sel ? 'sel' : ''}" data-pid="${p.pid}">` +
    `<td style="color:${col(p.pid)}">● ${p.pid}<td>${p.name}<td class="st-${p.state}">${status(p)}` +
    `<td>${p.pri}<td>${p.arr}<td>${p.burst}<td>${p.rem}<td>${p.ppid || '–'}<td>${memory(p)}<td>${regs(p)}`
  ).join('');

  $('pcb').innerHTML = '<table><tr>' + head.map(x => `<th>${x}`).join('') + rows + '</table>';
}

function renderCpuAndQueue(say, nm, P, L) {
  const ru = run();
  $('cpu').style.borderColor = ru ? col(ru.pid) : '';

  if (ru) {
    const quantumLeft = S.algo === 'RR' ? Math.max(S.qleft, 0) : '–';
    $('cpu').innerHTML =
      `<b style="color:${col(ru.pid)}">${nm(ru)}</b> ${say('running', 'is printing')}<br>` +
      `<small>${say('burst left', 'pages left')}: ${ru.seg} · ${say('quantum left', 'turn left')}: ${quantumLeft}</small>`;
  } else {
    $('cpu').innerHTML = S.q.length
      ? say('Kernel dispatches the next process on the following tick', 'Technician is choosing the next job')
      : L.idle;
  }

  $('rq').innerHTML = S.q.length
    ? S.q.map(id => `<span class="chip" style="background:${col(id)}">${say('', '📄 ')}${nm(P(id))}</span>`).join('')
    : '<small>empty</small>';
}

function renderGantt(os, P) {
  $('gt').innerHTML = S.g.map((c, i) => {
    const switched = i && S.g[i - 1].pid !== c.pid ? 'cs' : '';          // red outline = context switch
    const label = c.pid ? (os ? 'P' + c.pid : P(c.pid).name[0]) : '·';
    return `<i class="gc ${switched}" data-i="${i}" style="background:${col(c.pid)}"><b>${label}</b><u>${c.t}</u></i>`;
  }).join('');
}

function renderThreads(say, os) {
  const p = cur();
  const rows = p.th.map(h => {
    const state = ST[V][p.state === 'RUNNING' ? h.state : p.state] || p.state;
    return `<tr><td>${os ? h.tid : 'Doc ' + (h.tid % 10 + 1)}<td>${state}<td>0x${h.sp.toString(16)}`;
  }).join('');
  const note = say(
    'Shared by all threads: code, heap, open files. Private to each thread: stack, registers, PC.',
    'Shared: the student’s login and print credits. Private: each document’s own page counter.'
  );
  $('th').innerHTML =
    `<table><tr><th>${say('TID', 'Document')}<th>State<th>${say('Private stack ptr', 'Own page counter')}` +
    `${rows}</table><small>${note}</small>`;
}

function renderAverages(say, nm, P) {
  const m = met(S);
  let html =
    `${say('Waiting', 'Time in queue')}: <b>${m.wt}</b> · ${say('Turnaround', 'Whole job')}: <b>${m.tat}</b> · ` +
    `${say('Response', 'Time to first page')}: <b>${m.rt}</b> · ${say('Context switches', 'Job changes')}: <b>${S.cs}</b>`;
  const held = Object.entries(S.locks);
  if (held.length) {
    html += `<br>${say('Locks', 'Resources')}: ${held.map(([name, pid]) => `${say(name, LOCK_STORY[name])} held by ${nm(P(pid))}`).join(', ')}`;
  }
  $('mt').innerHTML = html;
}

function renderMemory(say, os, P) {
  const used = S.mem.filter(x => x.o).reduce((a, x) => a + x.s, 0);
  const free = 256 - used;
  const biggestHole = Math.max(0, ...S.mem.filter(x => !x.o).map(x => x.s));
  const fragmentation = free ? Math.round((1 - biggestHole / free) * 100) : 0;

  const blocks = S.mem.map(x => {
    const label = x.s >= 14 ? (x.o ? (os ? 'P' + x.o : P(x.o).name[0]) : 'free') : '';
    const style = `width:${x.s / 3.2}%;` + (x.o ? `background:${col(x.o)}` : '');
    return `<div class="mb ${x.o ? '' : 'free'}" title="${x.b}-${x.b + x.s - 1} KB" style="${style}">${label}</div>`;
  }).join('');

  $('mm').innerHTML =
    `<div class="bar"><div class="mb k" style="width:${64 / 3.2}%">${say('Kernel', 'Admin')}</div>${blocks}</div>` +
    `<small>${say('Used', 'Spool used')} ${used}/256 KB (${Math.round(used / 2.56)}%) · ` +
    `${say('free', 'free space')} ${free} KB · ${say('largest hole', 'biggest gap')} ${biggestHole} KB · ` +
    `${say('fragmentation', 'wasted gaps')} ${fragmentation}%<br>` +
    `${say('Interrupts', 'Alerts')}: ${say('timer', 'turn timer')} ${S.irq.timer} · ` +
    `${say('I/O', 'scanner done')} ${S.irq.io} · ${say('system calls', 'requests')} ${S.irq.sys}</small>`;
}

/* ---------------------------------------------------------------------------
   6. Start-up
   --------------------------------------------------------------------------- */
reset();
try {
  if (!sessionStorage.seen) {                 // show "How to play" on the first visit only
    sessionStorage.seen = 1;
    $('hp').showModal();
  }
} catch (e) {
  $('hp').showModal();
}
