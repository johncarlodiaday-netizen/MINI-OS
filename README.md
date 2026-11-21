# Story Kernel - A Scenario-Driven Mini-OS Simulator

ITEC 55 - Platform Technologies, Cavite State University (Don Severino de las Alas Campus)
Author: John Carlo B. Diaday, BSIT 2-4 (individual project)
Scenario skin: Busy Computer Laboratory / Print Station

Story Kernel is a browser-based, game-style simulator of a simplified operating system. It shows the
kernel (system calls, user/kernel mode, kernel log), processes (PCB, 5-state life cycle, parent-child,
CPU and I/O bursts), threads (TCB, shared vs private resources) and CPU scheduling (FCFS, SJF,
Round Robin with adjustable quantum, Priority) with a live Gantt chart. The same simulation can be
viewed as OS terms or as the Computer Laboratory / Print Station story (students send print jobs to one shared printer). Instructions are built into the page
(click **How to play**).

## Features

- Kernel: create_process, terminate, create_thread, join_thread, io_request, yield, deadlock_demo;
  User/Kernel mode badge; kernel log
- Processes: PCB (PID, state, priority, arrival, burst, remaining, registers), 5-state life cycle,
  parent-child, CPU and I/O bursts
- Threads: TCB per thread, several threads per process, shared vs private resources shown
- Scheduler: FCFS, SJF, Round Robin, Priority; live Gantt chart and ready queue; visible context
  switches; average waiting, turnaround and response time; Start / Pause / Step / Reset
- Standout features: Scenario Skin (Story <-> OS), Dual View button, "Why?" explainer (click a Gantt
  block), Time Machine (rewind slider)
- Your Ideas: three workload presets (balanced, CPU-heavy, I/O-heavy), one-click Benchmark of every
  algorithm on every workload, deadlock detection and recovery

## Programming languages and versions

- HTML5, CSS3 and JavaScript (ES2015+), plain and with no frameworks, libraries or build step.
- A modern web browser. Tested in Chromium 141 (headless). Firefox, Safari and mobile browsers are not yet tested.
- Optional: Visual Studio Code (with the Live Server extension) or Python 3 to serve the folder locally.
- Internet is only needed for one Google Font (Nunito); the page falls back to system fonts offline.

## Open it in Visual Studio Code

1. Unzip `story-kernel.zip`, then in VS Code choose File > Open Folder and select the `story-kernel` folder.
2. Install the extension **Live Server** (by Ritwick Dey) from the Extensions panel.
3. Right-click `index.html` and choose **Open with Live Server** (or click "Go Live" at the bottom right).
4. The simulator opens in your browser. Edit `js/app.js` or `css/style.css`, save, and the page reloads.

Without the extension: open the VS Code terminal (Ctrl+`) and run `python3 -m http.server 8000`, then open http://localhost:8000/.

## Run it (exact commands)

Option 1 - open the file directly (works without a server):

    # Windows: double-click index.html, or
    start index.html
    # macOS
    open index.html
    # Linux
    xdg-open index.html

Option 2 - serve locally:

    cd story-kernel
    python3 -m http.server 8000
    # then open http://localhost:8000/ in a browser

Option 3 - published link (a single-file copy of the same code, hosted as a claude.ai artifact; it is private until its owner chooses to share it):
https://claude.ai/artifact/7VzMRLVWxcVboPGCzrZSVx


## Deployment

The project is static files only. To host it, copy the whole folder to any static host (for example GitHub
Pages: push the folder to a repository, then enable Pages in the repository settings).

## Files

    story-kernel/
      index.html     page structure and the in-page "How to play" panel
      css/style.css  styles (dark game theme, light-mode fallback)
      js/engine.js   CORE LOGIC: the simulated OS (processes, threads, scheduler, memory map, locks, system calls)
      js/app.js      user interface: drawing, buttons, timer, Time Machine, Benchmark dialog, Story/OS labels
      README.md      this file

## Core logic and the user interface

- `js/engine.js` is the **core logic**: the simulated operating system (processes and threads, the four
  schedulers, the memory map, locks and deadlock detection, system calls and metrics). It works only on the
  state object `S` and never touches the page.
- `js/app.js` is the **user interface**: it draws `S`, handles the buttons and the timer, and calls the engine.
  `index.html` and `css/style.css` hold the page structure and the styles.
- The engine is loaded before the interface (see `index.html`). The functions and state fields the interface
  uses are listed in the comment at the top of `engine.js` and in Appendix B of the manual.

## Memory map and interrupts

- 320 KB of simulated memory: KB 0-63 kernel, KB 64-319 user memory in contiguous partitions.
- First-fit allocation when a process is admitted; the block is freed and merged with its neighbours when the
  process ends. If no hole fits, the process waits in NEW and a MEMORY line appears in the log.
- Process size = 8 KB code/heap + 4 KB per thread stack slot (threads + 2 spare slots).
- The Memory panel shows the map, used/free KB, largest hole, fragmentation, and counters for timer
  interrupts, I/O interrupts and system calls.

## How to use (short)

1. Press **Start** (or **Step** for one time unit).
2. Change the algorithm, quantum, speed or workload at any time.
3. Click a roster row, then use the system call buttons.
4. Click a Gantt block to see why the scheduler chose it.
5. Drag the Time Machine slider to rewind; press Start to replay.
6. Press **Story view** to switch vocabularies; press **Benchmark** to compare all algorithms.
7. Press the deadlock_demo button and keep stepping to see deadlock detection, then **Break deadlock**.

## 50-process run (optional demo)

Open the browser console (F12), run the line below, then press **Start**. Processes that do not fit in memory
wait in NEW and are admitted as other processes finish.

    reset(); for (let i = 0; i < 45; i++) addP(S, 'Job' + i, 0, 2, [3, 2, 2], 1, 0); save();

## AI-use disclosure

- `js/engine.js` (core logic): the logic was written by John Carlo B. Diaday and Samuel Vibar.
- `index.html`, `css/style.css`, `js/app.js`, the story wording of the Computer Laboratory / Print Station skin
  (including the story-text strings in `js/engine.js`, with no logic change), the documentation and the test scripts:
  built with AI assistance (Anthropic).

The full log is in Section 11 of Story_Kernel_Documentation.pdf. The AVP script and storyboard are in a .docx file.
