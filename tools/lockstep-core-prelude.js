/* BR2 lockstep gate (prelude) — injected at the top of the PCSX-ReARMed core JS by tools/build_online.py.
   Runs in every thread that loads the core (main thread and pthread workers).
   The emulator main loop asks __br2Gate() before every step:
     - shared Int32Array __br2i (SharedArrayBuffer from the page):
       [0] mode: 0 passthrough, 1 armed (wait), 2 running lockstep
       [1] next frame index to run   (written here)
       [2] last frame whose inputs are known for BOTH players (written by the page)
       [3] stall counter (ms-ish, for diagnostics)
       [16 + (f % RING) * 2] = P1 bits, [+1] = P2 bits
   Inputs are injected synchronously into RetroArch's keyboard callbacks right before the frame runs,
   so both machines see identical input on identical frames. */
globalThis.__br2Online = true;
(function () {
  var G = globalThis;
  if (G.__br2Gate) return;
  var RING = 256;
  var prev = [0, 0];
  function apply(p, bits) {
    var old = prev[p];
    if (old === bits) return;
    var codes = G.__br2codes && G.__br2codes[p];
    if (!codes || !G.__br2Key) return;
    var ch = old ^ bits;
    for (var i = 0; i < codes.length; i++) {
      if (ch & (1 << i)) { G.__br2Key((bits & (1 << i)) ? 2 : 3, codes[i]); if (G.__br2i) G.__br2i[5]++; }
    }
    prev[p] = bits;
  }
  // Lockstep gate, asked before every main-loop step (emulator thread).
  // A step does NOT always run a game frame: PAL games (50 fps) on a 60 Hz screen skip
  // ~1 step in 6 based on wall-clock time, differently on each phone. So frame [1] only
  // advances when the previous step really ran a game frame — detected by the game's
  // controller read ([6] counts them; it runs on the browser main thread, synchronously
  // inside the step). Inputs for frame f are injected once and stay "pending" until a
  // game frame has consumed them; steps without a game frame just run again.
  G.__br2Gate = function () {
    if (!G.__br2Online) return true;
    var B = G.__br2i;
    if (!B) return true; // ยังไม่ผูกกับหน้าเว็บ: เดินตามปกติ
    var mode = Atomics.load(B, 0);
    var pc = Atomics.load(B, 6);
    if (mode === 0) { G.__br2lastPoll = pc; return true; }   // passthrough: polls here don't count
    if (mode !== 2) { B[3]++; return false; }
    if (G.__br2lastPoll === undefined) G.__br2lastPoll = pc;
    var d = pc - G.__br2lastPoll;                            // game frames run by the previous step
    G.__br2lastPoll = pc;
    if (G.__br2stepDone) { Atomics.add(B, 9 + Math.min(d, 3), 1); if (d !== B[13]) { B[14]++; B[15] = B[1]; } B[13] = d; G.__br2stepDone = false; }
    if (d > 0 && G.__br2pending) { Atomics.store(B, 1, Atomics.load(B, 1) + 1); G.__br2pending = false; }
    if (!G.__br2pending) {
      var f = Atomics.load(B, 1);
      if (Atomics.load(B, 2) < f) { B[3]++; return false; }
      B[4] = (G.__br2kcb || []).length;
      var base = 16 + (f % RING) * 2;
      apply(0, B[base]);
      apply(1, B[base + 1]);
      G.__br2pending = true;
    }
    G.__br2stepDone = true;
    return true;
  };
})();
