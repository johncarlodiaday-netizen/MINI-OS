/* 
   Core logic: the simulated operating system.

   The engine works only on the state object S. It never touches the page;
   app.js renders S and calls the functions below.

   State S is plain JSON so the Time Machine can snapshot it:
     t, algo, quantum, mode ('K' | 'U'), ps[], q[] (pids), run (pid or 0), qleft,
     last (pid of last dispatch), cs (context switches), nextPid,
     g[]    Gantt cells     {t, pid}
     why[]  Why entries     {t, pid, o, s}
     log[]  kernel log      {t, o, s}
     mem[]  user memory     {b: base KB, s: size KB, o: owner pid, 0 = free hole}
     locks  held locks only {L1: ownerPid, ...}
     dead   pids in a deadlock cycle, or null
     irq    interrupt counters {timer, io, sys}

   S and sel are globals owned by app.js; they are not declared here.
 */
'use strict';

/* 
   1. Constants, workloads and names
*/
const KERNEL_KB = 64;     // KB 0-63 reserved for the kernel
const USER_KB = 256;      // KB 64-319 for user processes
const IO_UNITS = 3;       // length of an I/O wait started by the io_request system call

// Each entry: [name, arrival, priority, bursts (CPU, I/O, CPU, ...), threads]
const W = {
  bal: [
    ["Ana's Thesis", 0, 2, [4, 2, 3], 2],
    ["Ben's Resume", 1, 1, [6], 1],
    ["Carla's Poster", 2, 3, [3, 3, 2], 3],
    ["Dino's Quiz", 3, 2, [5], 1],
    ["Ella's Report", 4, 4, [2, 2, 2], 2]
  ],
  cpu: [
    ["Ana's Thesis", 0, 2, [9], 2],
    ["Ben's Resume", 1, 1, [6], 1],
    ["Carla's Poster", 2, 3, [12], 3],
    ["Dino's Quiz", 3, 2, [4], 1],
    ["Ella's Report", 4, 4, [7], 2]
  ],
  io: [
    ["Ana's Thesis", 0, 2, [1, 4, 1, 4, 1], 2],
    ["Ben's Resume", 1, 1, [2, 5, 1], 1],
    ["Carla's Poster", 2, 3, [1, 3, 1, 3, 2], 3],
    ["Dino's Quiz", 3, 2, [2, 4, 2], 1],
    ["Ella's Report", 4, 4, [1, 5, 1], 2]
  ]
};
/** Story names of the two locks. */
const LOCK_STORY = { L1: 'paper tray', L2: 'stapler' };
const WN = { bal: 'Balanced (mixed)', cpu: 'CPU-heavy', io: 'I/O-heavy' };
const ALG = { FCFS: 'FCFS', SJF: 'SJF (lowest wait)', RR: 'Round Robin', PRI: 'Priority' };

/** Accepts 'RR', 'Round Robin', 'priority', ... and returns FCFS | SJF | RR | PRI. */
function algoKey(name) {
  const first = String(name || 'FCFS').toUpperCase()[0];
  if (first === 'R') return 'RR';
  if (first === 'P') return 'PRI';
  if (first === 'S') return 'SJF';
  return 'FCFS';
}

/** Accepts a key of W (or something close to it) and returns a valid key. */
function workloadKey(key) {
  if (W[key]) return key;
  const first = String(key || 'bal').toLowerCase()[0];
  if (first === 'c') return 'cpu';
  if (first === 'i') return 'io';
  return 'bal';
}

/* 
   2. Small helpers
*/
/** Writes one kernel log line in both vocabularies (OS text, Story text). */
function lg(S, osText, storyText) {
  S.log.push({ t: S.t, o: osText, s: storyText || osText });
}

const byPid = (S, pid) => S.ps.find(p => p.pid === pid) || null;
const allTerminated = S => S.ps.every(p => p.state === 'TERMINATED');
const setThreadStates = (p, state) => p.th.forEach(th => { th.state = state; });

/** The running process (for the CPU box). Uses the global S. */
const run = () => (S.run ? byPid(S, S.run) : null);

/** The process selected in the roster (for system calls and the Threads panel). */
const cur = () => byPid(S, sel) || S.ps[0];

/* 
   3. Boot, PCB and TCB
*/
/** Boots the simulator in kernel mode with every workload process in state NEW. */
function mk(workload, algo = 'RR', quantum = 3) {
  const list = Array.isArray(workload) ? workload : W[workloadKey(workload)];
  const S = {
    t: 0, algo, quantum, mode: 'K',
    ps: [], q: [], run: 0, qleft: 0, last: 0, cs: 0, nextPid: 1,
    g: [], why: [], log: [],
    irq: { timer: 0, io: 0, sys: 0 },
    mem: [{ b: KERNEL_KB, s: USER_KB, o: 0 }],     // one big hole; the kernel area is not listed
    locks: {},
    dead: null
  };
  lg(S, `BOOT: kernel mode, memory map ready (kernel KB 0-${KERNEL_KB - 1}), ${list.length} processes created as NEW`,
        `The lab opens. The technician is at the admin desk and ${list.length} print jobs are on their way.`);
  list.forEach(([name, arr, pri, segs, threads]) => addP(S, name, arr, pri, segs, threads, 0));
  return S;
}

/** Creates a PCB (state NEW) with its TCBs and adds it to the process table. */
function addP(S, name, arr, pri, segs, threads, ppid) {
  const pid = S.nextPid++;
  const burst = segs.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);   // even index = CPU
  const sp = 0xFFF0 - pid * 256;

  const p = {
    pid, name, state: 'NEW', pri, arr,
    segs: segs.slice(), si: 0, seg: segs[0],      // bursts, current index, time left in current burst
    burst, rem: burst,                            // total CPU needed / still needed
    ppid: ppid || 0,
    regs: { PC: 0, SP: sp, AX: 0 },
    wait: 0, first: -1, fin: -1,                  // metrics
    want: '', wl: '',                             // lock it will request / lock it is blocked on
    mem: 8 + 4 * (threads + 2), base: -1,         // 8 KB code+heap, 4 KB per stack slot (threads + 2 spare)
    th: [],
    io: false, ioAt: 0,                           // in an I/O wait? tick when it started
    asked: false, nomem: false                    // lock already requested? "no memory" already logged?
  };
  for (let i = 0; i < threads; i++) {
    p.th.push({ tid: pid * 10 + i, state: 'READY', sp: sp - 32 * i });
  }
  S.ps.push(p);
  return p;
}

/* 
   4. Memory: first fit with splitting, free with coalescing
*/
/** Gives p the first hole that is big enough. Returns false if there is none. */
function alloc(S, p) {
  const i = S.mem.findIndex(block => !block.o && block.s >= p.mem);
  if (i < 0) return false;

  const hole = S.mem[i];
  if (hole.s > p.mem) {                                         // split the hole
    S.mem.splice(i + 1, 0, { b: hole.b + p.mem, s: hole.s - p.mem, o: 0 });
  }
  hole.s = p.mem;
  hole.o = p.pid;
  p.base = hole.b;
  return true;
}

/** Frees every block of pid and merges neighbouring free holes. */
function freeMem(S, pid) {
  S.mem.forEach(block => { if (block.o === pid) block.o = 0; });
  for (let i = 0; i < S.mem.length - 1; ) {
    if (!S.mem[i].o && !S.mem[i + 1].o) {
      S.mem[i].s += S.mem[i + 1].s;
      S.mem.splice(i + 1, 1);
    } else {
      i++;
    }
  }
}

/*
   5. Locks: release and hand over
*/
/** Frees the memory and the locks of a finished process; waiting processes get the locks. */
function rel(S, pid) {
  const p = byPid(S, pid);
  if (p && S.mem.some(block => block.o === pid)) {
    freeMem(S, pid);
    lg(S, `MEMORY: P${pid} region of ${p.mem} KB freed and merged with neighbouring holes`,
          `${p.name} is collected; its spool space is free again.`);
  }

  Object.keys(S.locks).filter(name => S.locks[name] === pid).forEach(name => {
    delete S.locks[name];
    const waiter = S.ps.find(w => w.state === 'WAITING' && w.wl === name);
    if (!waiter) return;
    S.locks[name] = waiter.pid;
    waiter.wl = '';
    waiter.state = 'READY';
    S.q.push(waiter.pid);
    lg(S, `LOCK: ${name} granted to P${waiter.pid}, WAITING to READY`,
          `${waiter.name} gets ${LOCK_STORY[name] || name} and joins the print queue.`);
  });
}

/** Terminates p: state, threads, queue, CPU, then memory and locks (via rel). */
function kill(S, p) {
  p.state = 'TERMINATED';
  if (p.fin < 0) p.fin = S.t;
  p.wl = '';
  p.io = false;
  setThreadStates(p, 'TERMINATED');
  S.q = S.q.filter(pid => pid !== p.pid);
  if (S.run === p.pid) S.run = 0;
  rel(S, p.pid);
}

/* 
   6. Scheduler decision
*/
/** Chooses the next PCB from S.q by S.algo and records a Why entry. The caller dispatches it. */
function pick(S) {
  const algo = algoKey(S.algo);
  let best = S.q[0];

  for (const pid of S.q.slice(1)) {                  // strict "<" keeps queue order on ties
    const a = byPid(S, pid), b = byPid(S, best);
    if (algo === 'SJF' && a.seg < b.seg) best = pid;
    if (algo === 'PRI' && a.pri < b.pri) best = pid;
  }

  const p = byPid(S, best);
  const queue = S.q.map(pid => 'P' + pid).join(', ');
  const [osReason, storyReason] = {
    FCFS: ['it is at the front of the queue (first come, first served)', 'it was sent first'],
    RR:   [`it is at the front of the circular queue and may run at most ${S.quantum} units`, 'it is first in the queue and gets one turn'],
    SJF:  [`it has the smallest next CPU burst (${p.seg})`, 'it is the shortest job (fewest pages)'],
    PRI:  [`it has the best priority (rank ${p.pri})`, `its job is the most urgent (rank ${p.pri})`]
  }[algo];

  S.why.push({
    t: S.t, pid: p.pid,
    o: `${algo} chose P${p.pid} because ${osReason}. Ready queue: [${queue}].`,
    s: `The technician sends ${p.name} to the printer because ${storyReason}. Print queue: [${queue}].`
  });
  return p;
}

/* 
   7. Deadlock detection and recovery
*/
/** Follows process -> lock it waits on -> owner ... Returns the pids if it comes back to start. */
function waitCycleFrom(S, start) {
  const chain = [];
  let p = start;
  while (p && p.state === 'WAITING' && p.wl && !chain.includes(p.pid)) {
    chain.push(p.pid);
    const owner = S.locks[p.wl];
    p = owner ? byPid(S, owner) : null;
    if (p && p.pid === start.pid) return chain;
  }
  return null;
}

/** Looks for a wait-for cycle; stores it in S.dead (or null) and logs it once. */
function detect(S) {
  S.dead = null;
  for (const p of S.ps) {
    const cycle = waitCycleFrom(S, p);
    if (!cycle) continue;
    S.dead = cycle;
    if (!S.deadLogged) {
      S.deadLogged = true;
      lg(S, `DEADLOCK: circular wait ${cycle.map(id => 'P' + id).join(' -> ')} -> P${p.pid}`,
            'PRINT JAM! Each job holds the resource the other one needs.');
    }
    return S.dead;
  }
  S.deadLogged = false;
  return null;
}

/** Terminates the first process of the cycle (its locks go to the waiting process). */
function breakDeadlock(S) {
  if (!S.dead) return;
  const victim = byPid(S, S.dead[0]);
  S.mode = 'K';
  lg(S, `RECOVERY: P${victim.pid} chosen as victim and terminated; its locks are released`,
        `${victim.name} is cancelled so the other job can move.`);
  kill(S, victim);
  detect(S);
}

/* 
   8. One clock tick, step(S)
      order: finished I/O, arrivals, RR preemption, dispatch, waiting time,
             execute one unit (+ lock request, burst end), deadlock check, t + 1
*/
function step(S) {
  if (allTerminated(S)) return false;

  S.mode = 'U';
  completeIO(S);
  admitArrivals(S);
  preemptIfQuantumUsed(S);
  dispatch(S);
  countWaiting(S);
  executeOneUnit(S);
  detect(S);
  S.t++;

  return !allTerminated(S);
}

/** I/O completion interrupt: WAITING -> READY when the I/O burst reaches 0. */
function completeIO(S) {
  for (const p of S.ps) {
    if (p.state !== 'WAITING' || !p.io) continue;
    if (p.ioAt < S.t && p.seg > 0) p.seg--;                    // one unit of I/O per tick
    if (p.seg > 0) continue;

    p.io = false;
    p.si++;
    p.seg = p.segs[p.si];
    p.state = 'READY';
    S.q.push(p.pid);
    S.mode = 'K';
    S.irq.io++;
    lg(S, `I/O interrupt: P${p.pid} WAITING to READY`, `${p.name} is back from the scanner.`);
  }
}

/** NEW -> READY for every process whose arrival time has come and that fits in memory. */
function admitArrivals(S) {
  for (const p of S.ps) {
    if (p.state !== 'NEW' || p.arr > S.t) continue;

    if (alloc(S, p)) {
      p.state = 'READY';
      p.nomem = false;
      S.q.push(p.pid);
      S.mode = 'K';
      lg(S, `ADMIT: P${p.pid} NEW to READY, memory ${p.base}-${p.base + p.mem - 1} KB`,
            `${p.name} is submitted and joins the print queue.`);
    } else if (!p.nomem) {                                     // log the failure only once
      p.nomem = true;
      lg(S, `MEMORY: no free hole of ${p.mem} KB for P${p.pid}; it stays NEW`,
            `${p.name} finds no spool space and waits to be accepted.`);
    }
  }
}

/** Round Robin timer interrupt: the quantum is used up and somebody else is waiting. */
function preemptIfQuantumUsed(S) {
  if (algoKey(S.algo) !== 'RR' || !S.run || S.qleft > 0) return;

  if (S.q.length === 0) {                                      // nobody waits: fresh quantum
    S.qleft = S.quantum;
    return;
  }
  const p = byPid(S, S.run);
  p.state = 'READY';
  setThreadStates(p, 'READY');
  S.q.push(p.pid);
  S.run = 0;
  S.mode = 'K';
  S.irq.timer++;
  lg(S, `TIMER interrupt: quantum expired, P${p.pid} RUNNING to READY`,
        `The turn timer beeps for ${p.name}; back of the queue.`);
}

/** If the CPU is free, picks a process and makes it RUNNING (counts context switches). */
function dispatch(S) {
  if (S.run || S.q.length === 0) return;

  const p = pick(S);
  S.q.splice(S.q.indexOf(p.pid), 1);
  p.state = 'RUNNING';
  S.run = p.pid;
  S.qleft = S.quantum;
  S.mode = 'K';
  if (p.first < 0) p.first = S.t;

  if (S.last !== p.pid) {                                      // only a different PID is a switch
    S.cs++;
    lg(S, `DISPATCH: context switch, save P${S.last}, load P${p.pid}`,
          `The printer now prints ${p.name}.`);
  }
  S.last = p.pid;
}

/** Every READY process waits one tick. */
function countWaiting(S) {
  S.ps.forEach(p => { if (p.state === 'READY') p.wait++; });
}

/** Runs the CPU for one time unit, then handles a lock request and the end of a burst. */
function executeOneUnit(S) {
  S.g.push({ t: S.t, pid: S.run });                            // pid 0 = CPU idle
  if (!S.run) return;

  const p = byPid(S, S.run);
  p.rem--;
  p.seg--;
  S.qleft--;
  p.regs.PC++;
  p.regs.AX = (p.regs.AX + p.pid) & 0xFFFF;
  p.th.forEach((th, i) => { th.state = i === S.t % p.th.length ? 'RUNNING' : 'READY'; });

  requestLock(S, p);
  if (S.run === p.pid && p.seg === 0) endOfBurst(S, p);
}

/** First time a process runs it asks for its wanted lock; it blocks if somebody owns it. */
function requestLock(S, p) {
  if (!p.want || p.asked) return;
  p.asked = true;

  const owner = S.locks[p.want];
  if (!owner) {
    S.locks[p.want] = p.pid;
    return;
  }
  if (owner === p.pid) return;

  p.state = 'WAITING';
  p.wl = p.want;
  S.run = 0;
  S.mode = 'K';
  setThreadStates(p, 'READY');
  lg(S, `LOCK: P${p.pid} requests ${p.want} (held by P${owner}), RUNNING to WAITING (blocked)`,
        `${p.name} wants the ${LOCK_STORY[p.want] || p.want} but ${byPid(S, owner).name} is holding it.`);
}

/** The current burst reached 0: exit if it was the last one, otherwise start the I/O wait. */
function endOfBurst(S, p) {
  S.run = 0;
  S.mode = 'K';
  S.irq.sys++;
  setThreadStates(p, 'READY');

  if (p.si >= p.segs.length - 1) {                             // last burst: exit
    lg(S, `SYSCALL exit: P${p.pid} RUNNING to TERMINATED`, `${p.name} is printed and collected.`);
    p.fin = S.t + 1;
    kill(S, p);
    return;
  }
  p.si++;
  p.seg = p.segs[p.si];
  p.state = 'WAITING';
  p.io = true;
  p.ioAt = S.t;
  lg(S, `SYSCALL io_request: P${p.pid} RUNNING to WAITING (${p.seg} units)`,
        `${p.name} goes to the scanner.`);
}

/* 
   9. Metrics (averages over finished processes, as strings with 2 decimals)
*/
function met(S) {
  const done = S.ps.filter(p => p.state === 'TERMINATED' && p.fin >= 0);
  const avg = value => (done.length ? done.reduce((sum, p) => sum + value(p), 0) / done.length : 0).toFixed(2);
  return {
    wt: avg(p => p.wait),
    tat: avg(p => p.fin - p.arr),
    rt: avg(p => (p.first < 0 ? 0 : p.first - p.arr))
  };
}

/* 
   10. System calls (use the globals S and sel; app.js counts irq.sys and sets mode 'K')
*/
const SYS = [
  /* 0 */ function create_process() {
    const p = cur();
    if (!p || p.state === 'TERMINATED') return;
    const child = addP(S, p.name + ' (copy)', S.t, p.pri, [3], 2, p.pid);
    lg(S, `SYSCALL create_process: P${p.pid} created child P${child.pid}`, `${p.name} sends a new print job.`);
  },

  /* 1 */ function terminate() {
    const p = cur();
    if (!p || p.state === 'TERMINATED') return;
    lg(S, `SYSCALL terminate: P${p.pid} TERMINATED`, `${p.name} is cancelled.`);
    kill(S, p);
  },

  /* 2 */ function create_thread() {
    const p = cur();
    if (!p || p.state === 'TERMINATED') return;
    const slots = (p.mem - 8) / 4;                             // stack slots in the memory region
    if (p.th.length >= slots) {
      lg(S, `SYSCALL create_thread failed: P${p.pid} stack area is full`,
            'There is no room for another document in this job.');
      return;
    }
    const i = p.th.length;
    p.th.push({ tid: p.pid * 10 + i, state: 'READY', sp: p.regs.SP - 32 * i });
    lg(S, `SYSCALL create_thread: T${p.th[i].tid} added to P${p.pid}`, `A document is added to ${p.name}.`);
  },

  /* 3 */ function join_thread() {
    const p = cur();
    if (!p || p.state === 'TERMINATED') return;
    if (p.th.length <= 1) {                                    // a process keeps at least one thread
      lg(S, `SYSCALL join_thread: P${p.pid} keeps its last thread`, 'The last document stays.');
      return;
    }
    const th = p.th.pop();
    lg(S, `SYSCALL join_thread: T${th.tid} joined and removed`, `A document is removed from ${p.name}.`);
  },

  /* 4 */ function io_request() {
    const p = cur();
    if (!p || p.state !== 'RUNNING') return;
    p.segs.splice(p.si + 1, 0, IO_UNITS, p.seg);               // I/O now, then the rest of this CPU burst
    p.si++;
    p.seg = IO_UNITS;
    p.io = true;
    p.ioAt = S.t - 1;
    p.state = 'WAITING';
    S.run = 0;
    setThreadStates(p, 'READY');
    lg(S, `SYSCALL io_request: P${p.pid} RUNNING to WAITING (${IO_UNITS} units)`, `${p.name} goes to the scanner.`);
  },

  /* 5 */ function yield_() {                                  // "yield" is a reserved word
    const p = cur();
    if (!p || p.state !== 'RUNNING') return;
    p.state = 'READY';
    S.q.push(p.pid);
    S.run = 0;
    setThreadStates(p, 'READY');
    lg(S, `SYSCALL yield: P${p.pid} RUNNING to READY`, `${p.name} lets other jobs print first.`);
  },

  /* 6 */ function deadlock_demo() {
    const x = addP(S, 'Xyla Slides', S.t, 1, [4], 1, 0);
    const y = addP(S, 'Yuri Handout', S.t, 1, [4], 1, 0);
    x.want = 'L2';                                             // X holds L1 and will want L2
    y.want = 'L1';                                             // Y holds L2 and will want L1
    S.locks.L1 = x.pid;
    S.locks.L2 = y.pid;
    lg(S, `SYSCALL deadlock_demo: P${x.pid} holds L1 and wants L2; P${y.pid} holds L2 and wants L1`,
          'Two jobs each hold a resource the other one needs.');
  }
];
