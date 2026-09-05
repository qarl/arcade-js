// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0661 (ROM 0x0661-0x06c9): the per-frame update pipeline (rst-0x28 dispatch target).
// Runs 27 subsystem calls in order, then a two-part guard: `ret c` on bit0 of (0x4208)|HL(0x4200), then
// `ret nc` on bit0 of (0x4225); otherwise sets HL=0x4260/DE=5/B=0x0e/A=0 and runs the inlined loc_06ca loop
// (OR-accumulate 14 cells stride 5, then an rrca-gated 0x4009 timer tail). Fall-through contract: 1047 T
// (558 through xor a + 489 loop/tail), calls = 27 targets. Early-exit (ret c): 511 T, calls = 27 targets.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0661 } from "../loc_0661.js";

const SEQ = [
  0x0837, 0x0898, 0x0a74, 0x0cc3, 0x0bbe, 0x0a32, 0x0b0b, 0x0b77, 0x1227, 0x129e,
  0x08e5, 0x140c, 0x1344, 0x13e1, 0x14f3, 0x12ed, 0x1327, 0x16a6, 0x1515, 0x1555,
  0x15c3, 0x15f4, 0x1621, 0x1637, 0x16b8, 0x1688, 0x198e,
];

function mk() {
  const routines = new Map();
  const pop = (mm) => { mm.pop16(); };   // each subsystem call balances its pushed return addr
  for (const a of SEQ) routines.set(a, pop);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };

test("loc_0661: full pipeline + inlined loc_06ca loop (timer expiry); 1047 T", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4208, 0x00); wr(m, 0x4200, 0x00); wr(m, 0x4201, 0x00); // ret c not taken
  wr(m, 0x4225, 0x01);                                            // ret nc not taken (bit0 set)
  for (let i = 0; i < 14; i++) wr(m, 0x4260 + i * 5, 0x00);       // OR stays 0 -> loop's ret c not taken
  wr(m, 0x4009, 0x01);                                            // timer dec -> 0 -> ret nz not taken
  wr(m, 0x400a, 0x03);
  loc_0661(m);
  assert.deepEqual(m.calls, [...SEQ], "27 subsystem calls in order, then the loop is inlined (no 0x06ca call)");
  assert.equal(m.mem.read8(0x4009), 0x00, "inlined loop drained the 0x4009 timer");
  assert.equal(m.mem.read8(0x400a), 0x04, "timer expiry bumped 0x400a 3 -> 4");
  assert.equal(m.regs.hl, 0x400a, "HL ends at 0x400a (loop reset then inc l)");
  assert.equal(m.cycles, 1047, "558 through xor a + 489 inlined loop/tail");
});

test("loc_0661: ret c early-exit when (0x4208) bit0 set; 511 T", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4208, 0x01); wr(m, 0x4200, 0x00); wr(m, 0x4201, 0x00); // A bit0 set -> ret c taken
  loc_0661(m);
  assert.deepEqual(m.calls, SEQ, "all 27 calls ran, no delegate");
  assert.equal(m.pc, 0x9999, "ret c returned to caller");
  assert.equal(m.cycles, 511, "27*17 + tail through ret c taken");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0661.js
//   find: m.push16(0x06b2); m.step(0x198e, 17); m.call(0x198e);
//   repl: (drop it -- the last subsystem update is skipped)
//   expect: FAIL (calls omit 0x198e; caught by the ordered deepEqual)
test("loc_0661: the contract catches a dropped subsystem call", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    const seq = SEQ.slice(0, -1); // MUTANT: 0x198e dropped
    const rets = [
      0x0664, 0x0667, 0x066a, 0x066d, 0x0670, 0x0673, 0x0676, 0x0679, 0x067c, 0x067f,
      0x0682, 0x0685, 0x0688, 0x068b, 0x068e, 0x0691, 0x0694, 0x0697, 0x069a, 0x069d,
      0x06a0, 0x06a3, 0x06a6, 0x06a9, 0x06ac, 0x06af,
    ];
    for (let i = 0; i < seq.length; i++) { m.push16(rets[i]); m.step(seq[i], 17); m.call(seq[i]); }
    regs.a = mem.read8(0x4208); m.step(0x06b5, 13);
    regs.hl = mem.read16(0x4200); m.step(0x06b8, 16);
    regs.or(regs.h); m.step(0x06b9, 4);
    regs.or(regs.l); m.step(0x06ba, 4);
    regs.rrca(); m.step(0x06bb, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x06bc, 5);
    regs.a = mem.read8(0x4225); m.step(0x06bf, 13);
    regs.rrca(); m.step(0x06c0, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x06c1, 5);
    regs.hl = 0x4260; m.step(0x06c4, 10);
    regs.de = 0x0005; m.step(0x06c7, 10);
    regs.b = 0x0e; m.step(0x06c9, 7);
    regs.xor(regs.a); m.step(0x06ca, 4);
    for (;;) { // inlined loc_06ca loop
      regs.or(mem.read8(regs.hl)); m.step(0x06cb, 7);
      regs.addHl(regs.de); m.step(0x06cc, 11);
      if (regs.djnz() !== 0) { m.step(0x06ca, 13); continue; }
      m.step(0x06ce, 8); break;
    }
    regs.rrca(); m.step(0x06cf, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x06d0, 5);
    regs.hl = 0x4009; m.step(0x06d3, 10);
    regs.decMem8(mem, regs.hl); m.step(0x06d4, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x06d5, 5);
    regs.l = regs.inc8(regs.l); m.step(0x06d6, 4);
    regs.incMem8(mem, regs.hl); m.step(0x06d7, 11);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4208, 0x00); wr(m, 0x4200, 0x00); wr(m, 0x4201, 0x00); wr(m, 0x4225, 0x01);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [...SEQ]));
});
