/* BR2 lockstep gate (prelude) — injected at the top of the PCSX-ReARMed core JS by tools/build_online.py.
   Runs in every thread that loads the core (main thread and pthread workers).
   __br2PollGate() runs each time the game reads the controller (once per game frame):
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
  // Main-loop step: no longer gates (a step does not always run a game frame — PAL games
  // at 50 fps on a 60 Hz screen skip ~1 step in 6 depending on wall-clock time, which
  // differs per phone). Only counts input polls per step for diagnostics.
  G.__br2Gate = function () {
    var B = G.__br2i;
    if (!G.__br2Online || !B) return true;
    var pc = Atomics.load(B, 6), d = pc - (G.__br2lastPoll === undefined ? pc : G.__br2lastPoll);
    G.__br2lastPoll = pc;
    if (Atomics.load(B, 0) === 2) { Atomics.add(B, 9 + Math.min(d, 3), 1); if (d !== B[13]) { B[14]++; B[15] = B[1]; } B[13] = d; }
    return true;
  };
  // The real lockstep gate: called when the game reads the controller, which happens exactly
  // once per emulated game frame (retro_run → input poll → gamepad sample). Blocks this
  // emulator thread (Atomics.wait is allowed in workers) until both players' inputs for the
  // frame are known, then injects them. Frame index [1] therefore counts GAME frames.
  var sleepCell = new Int32Array(new SharedArrayBuffer(4));
  G.__br2PollGate = function () {
    var B = G.__br2i;
    if (!G.__br2Online || !B) return;
    Atomics.add(B, 6, 1);
    for (;;) {
      var mode = Atomics.load(B, 0);
      if (mode === 0) return;                      // passthrough (paused / save-load phases)
      if (mode === 2) {
        var f = Atomics.load(B, 1);
        if (Atomics.load(B, 2) >= f) {
          B[4] = (G.__br2kcb || []).length;
          var base = 16 + (f % RING) * 2;
          apply(0, B[base]);
          apply(1, B[base + 1]);
          Atomics.store(B, 1, f + 1);
          return;
        }
      }
      B[3]++;
      Atomics.wait(sleepCell, 0, 0, 2);            // wait 2 ms, then check again
    }
  };
})();
