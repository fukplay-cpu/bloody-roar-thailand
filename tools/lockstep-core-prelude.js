/* BR2 lockstep gate (prelude) — injected at the top of the PCSX-ReARMed core JS by tools/build_online.py.
   Runs in every thread that loads the core (main thread and pthread workers).
   The emulator main loop asks __br2Gate() before every frame:
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
  G.__br2Gate = function () {
    if (!G.__br2Online) return true;
    var B = G.__br2i;
    if (!B) return true; // ยังไม่ผูกกับหน้าเว็บ: เดินตามปกติ (หยุดตอนเปิดเกมทำให้ระบบภาพเสีย)
    var mode = Atomics.load(B, 0);
    if (mode === 0) return true;
    if (mode !== 2) { B[3]++; return false; }
    var f = B[1];
    if (Atomics.load(B, 2) < f) { B[3]++; return false; }
    B[4] = (G.__br2kcb || []).length;
    // diagnostics: input polls since the previous step → histogram [9]=0, [10]=1, [11]=2, [12]=3+
    var pc = Atomics.load(B, 6), d = pc - (G.__br2lastPoll === undefined ? pc : G.__br2lastPoll);
    G.__br2lastPoll = pc;
    if (f > 0) { Atomics.add(B, 9 + Math.min(d, 3), 1); if (d !== B[13]) { B[14]++; B[15] = f; } B[13] = d; }
    var base = 16 + (f % RING) * 2;
    apply(0, B[base]);
    apply(1, B[base + 1]);
    Atomics.store(B, 1, f + 1);
    return true;
  };
})();
