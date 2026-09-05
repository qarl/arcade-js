// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_16a6 (Galaxian sound tick, ROM 0x16a6-0x16b7):
//   16a6  3a 07 40  ld a,(0x4007)   ; frame flag
//   16a9  0f        rrca            ; C = bit0
//   16aa  d8        ret c           ; skip on odd frames
//   16ab  21 df 41  ld hl,0x41df    ; countdown cell
//   16ae  7e        ld a,(hl)
//   16af  a7        and a           ; Z when countdown == 0
//   16b0  c8        ret z
//   16b1  0f        rrca
//   16b2  0f        rrca
//   16b3  32 04 68  ld (0x6804),a   ; sound_w reg4
//   16b6  35        dec (hl)        ; countdown--
//   16b7  c9        ret
// Contract (frame=0, count=0x40): 90 T (13+4+5+10+7+4+5+4+4+13+11+10), reg4 = 0x40>>>2 = 0x10, 0x41df = 0x3f.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_16a6 } from "../loc_16a6.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, { frame = 0x00, count = 0x40 } = {}) {
  const m = mk();
  m.regs.sp = 0x4400; // RAM so m.ret's pop lands in work RAM
  m.mem.write8(0x4007, frame);
  m.mem.write8(0x41df, count);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, reg4: m.io.soundReg[4], count: m.mem.read8(0x41df) };
}

function checkSpec(r) {
  assert.equal(r.cycles, 90, "T-state total of the full path");
  assert.deepEqual(r.calls, [], "no subroutine calls -- straight-line + ret");
  assert.equal(r.reg4, 0x10, "sound_w reg4 = countdown rotated right twice (0x40 -> 0x10)");
  assert.equal(r.count, 0x3f, "0x41df decremented");
}

test("loc_16a6: full sound tick writes reg4 and decrements the countdown; 90 T", () => {
  checkSpec(run(loc_16a6));
});

test("loc_16a6: ret c short-circuits on an odd frame (bit0 set)", () => {
  const r = run(loc_16a6, { frame: 0x01 });
  assert.equal(r.cycles, 13 + 4 + 11, "ld + rrca + ret c(taken)");
  assert.equal(r.reg4, 0, "no sound write on the skipped frame");
  assert.equal(r.count, 0x40, "countdown untouched");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_16a6.js
//   find: mem.write8(0x6804, regs.a, 10);
//   repl: mem.write8(0x6805, regs.a, 10);   (wrong sound register)
//   expect: FAIL  (reg4 stays 0, reg5 gets 0x10 -- caught by reg4 == 0x10; cycles unchanged)
//   verified-anchor: count == 1  (the sole 0x6804 write in loc_16a6.js)
test("loc_16a6: the contract catches a wrong sound-register target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4007); m.step(0x16a9, 13);
    regs.rrca(); m.step(0x16aa, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x16ab, 5);
    regs.hl = 0x41df; m.step(0x16ae, 10);
    regs.a = mem.read8(regs.hl); m.step(0x16af, 7);
    regs.and(regs.a); m.step(0x16b0, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x16b1, 5);
    regs.rrca(); m.step(0x16b2, 4);
    regs.rrca(); m.step(0x16b3, 4);
    mem.write8(0x6805, regs.a, 10); // MUTANT: wrong register
    m.step(0x16b6, 13);
    regs.decMem8(mem, regs.hl); m.step(0x16b7, 11);
    return m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400;
  m.mem.write8(0x4007, 0x00); m.mem.write8(0x41df, 0x40);
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, reg4: m.io.soundReg[4], count: m.mem.read8(0x41df) }));
});
