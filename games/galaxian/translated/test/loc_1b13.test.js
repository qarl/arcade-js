// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b13 (exx-based strided VRAM copy loop, ROM 0x1B13-0x1B1A):
//   1b13  d9        exx           ; copy pointers into the main set
//   1b14  1a        ld a,(de)     ; A = source byte
//   1b15  77        ld (hl),a     ; store into VRAM
//   1b16  09        add hl,bc     ; dest += stride (0x20)
//   1b17  13        inc de        ; source++
//   1b18  d9        exx           ; counter B back into the main set
//   1b19  10 f8     djnz 0x1b13
// Entry state (as left by loc_1b0a): main B=7 (counter), shadow HL'=dest, BC'=0x0020 (stride),
// DE'=source. Contract: copies 7 bytes down one VRAM column (dest, dest+0x20, ...), 359 T
// (7*(4+7+7+11+6+4) body + 6*13 taken + 8 not-taken djnz), then falls through into 0x1b1b.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b13 } from "../loc_1b13.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "NEXT" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// Source bytes live in work RAM (0x4000..), distinct per row so a mis-stride is visible.
const SRC = [0x1d, 0x11, 0x22, 0x10, 0x14, 0x11, 0x12];

function seed(m) {
  m.regs.b = 0x07;                       // main-set row counter
  m.regs.h_ = 0x52; m.regs.l_ = 0x33;    // shadow HL' = 0x5233 (VRAM dest)
  m.regs.b_ = 0x00; m.regs.c_ = 0x20;    // shadow BC' = 0x0020 (column stride)
  m.regs.d_ = 0x40; m.regs.e_ = 0x00;    // shadow DE' = 0x4000 (source in work RAM)
  for (let k = 0; k < SRC.length; k++) m.mem.workRam[k] = SRC[k];
}

function run(fn, stubs = { 0x1b1b: "tail" }) {
  const m = mk(stubs);
  seed(m);
  const ret = fn(m);
  // VRAM offset of row k: (0x5233 + k*0x20) & 0x3ff.
  const dest = [];
  for (let k = 0; k < SRC.length; k++) dest.push(m.mem.videoRam[(0x233 + k * 0x20) & 0x3ff]);
  return { cycles: m.cycles, calls: m.calls, ret, dest };
}

function checkSpec(res) {
  assert.equal(res.cycles, 359, "T-state total (7 bodies + 6 taken + 1 not-taken djnz)");
  assert.deepEqual(res.calls, [0x1b1b], "falls through into 0x1b1b");
  assert.equal(res.ret, "NEXT", "the fall-through callee result propagates out");
  assert.deepEqual(res.dest, SRC, "7 source bytes copied down the VRAM column at stride 0x20");
}

test("loc_1b13: copies 7 bytes down a VRAM column via the exx register-bank trick; 359 T", () => {
  checkSpec(run(loc_1b13));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b13.js
//   find: regs.addHl(regs.bc);
//   repl: regs.addHl(0x0010);
//   expect: FAIL  (wrong column stride -- rows 1.. land at the wrong VRAM offsets, dest mismatch)
//   verified-anchor: count == 1  (the sole "regs.addHl(regs.bc)" in loc_1b13.js)
test("loc_1b13: the contract catches a wrong column stride", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.exx();
      m.step(0x1b14, 4);
      regs.a = mem.read8(regs.de);
      m.step(0x1b15, 7);
      mem.write8(regs.hl, regs.a);
      m.step(0x1b16, 7);
      regs.addHl(0x0010); // MUTANT: wrong stride
      m.step(0x1b17, 11);
      regs.de = (regs.de + 1) & 0xffff;
      m.step(0x1b18, 6);
      regs.exx();
      m.step(0x1b19, 4);
      if (regs.djnz() !== 0) { m.step(0x1b13, 13); continue; }
      m.step(0x1b1b, 8);
      break;
    }
    return m.call(0x1b1b);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
