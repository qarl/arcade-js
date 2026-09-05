// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b34 (packed-byte hex readout + strided-copy dispatch, ROM 0x1B34-0x1B55):
//   1b34  4f        ld c,a          ; stash packed byte
//   1b35  3a 00 60  ld a,(0x6000)   ; IN0
//   1b38  47        ld b,a
//   1b39  3a 00 68  ld a,(0x6800)   ; IN1
//   1b3c  a0        and b           ; IN0 & IN1
//   1b3d  e6 04     and 0x04
//   1b3f  28 10     jr z,0x1b51     ; skip readout unless bit 2 set in both
//   1b41  79        ld a,c
//   1b42  e6 0f     and 0x0f
//   1b44  32 d3 51  ld (0x51d3),a   ; low nibble -> VRAM
//   1b47  79        ld a,c
//   1b48  0f 0f 0f 0f  rrca x4
//   1b4c  e6 0f     and 0x0f
//   1b4e  32 f3 51  ld (0x51f3),a   ; high nibble -> VRAM
//   1b51  11 56 1b  ld de,0x1b56
//   1b54  18 b4     jr 0x1b0a
// Contract (decode path: IN0=IN1=0x04 so IN0&IN1&0x04 != 0, packed byte 0x35): 138 T; low nibble 0x05
// -> VRAM 0x51D3, high nibble 0x03 -> VRAM 0x51F3, DE=0x1b56, then tail-jumps into loc_1b0a.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b34 } from "../loc_1b34.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "COPY" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubs = { 0x1b0a: "tail" }) {
  const m = mk(stubs);
  m.io.in0 = 0x04; m.io.in1 = 0x04; // bit 2 set in BOTH -> decode path
  m.regs.a = 0x35;                  // packed byte: low nibble 5, high nibble 3
  const ret = fn(m);
  return {
    cycles: m.cycles,
    calls: m.calls,
    ret,
    de: m.regs.de,
    loNib: m.mem.videoRam[0x51d3 & 0x3ff],
    hiNib: m.mem.videoRam[0x51f3 & 0x3ff],
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 138, "T-state total (decode path)");
  assert.deepEqual(res.calls, [0x1b0a], "tail-jumps into the copy setup 0x1b0a");
  assert.equal(res.ret, "COPY", "the copy callee result propagates out");
  assert.equal(res.loNib, 0x05, "low nibble of 0x35 -> VRAM 0x51D3");
  assert.equal(res.hiNib, 0x03, "high nibble of 0x35 (rrca x4) -> VRAM 0x51F3");
  assert.equal(res.de, 0x1b56, "ld de,0x1b56 -- source table for the strided copy");
}

test("loc_1b34: writes both nibbles of the packed byte to VRAM, dispatches to 0x1b0a; 138 T", () => {
  checkSpec(run(loc_1b34));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b34.js
//   find: mem.write8(0x51d3, regs.a);
//   repl: mem.write8(0x51d4, regs.a);
//   expect: FAIL  (low nibble written to the wrong VRAM cell -- 0x51D3 stays 0, loNib mismatch)
//   verified-anchor: count == 1  (the sole "mem.write8(0x51d3, regs.a)" in loc_1b34.js)
test("loc_1b34: the contract catches a wrong low-nibble VRAM target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.c = regs.a;
    m.step(0x1b35, 4);
    regs.a = mem.read8(0x6000);
    m.step(0x1b38, 13);
    regs.b = regs.a;
    m.step(0x1b39, 4);
    regs.a = mem.read8(0x6800);
    m.step(0x1b3c, 13);
    regs.and(regs.b);
    m.step(0x1b3d, 4);
    regs.and(0x04);
    m.step(0x1b3f, 7);
    if (regs.fZ) {
      m.step(0x1b51, 12);
    } else {
      m.step(0x1b41, 7);
      regs.a = regs.c;
      m.step(0x1b42, 4);
      regs.and(0x0f);
      m.step(0x1b44, 7);
      mem.write8(0x51d4, regs.a); // MUTANT: wrong VRAM cell
      m.step(0x1b47, 13);
      regs.a = regs.c;
      m.step(0x1b48, 4);
      regs.rrca(); m.step(0x1b49, 4);
      regs.rrca(); m.step(0x1b4a, 4);
      regs.rrca(); m.step(0x1b4b, 4);
      regs.rrca(); m.step(0x1b4c, 4);
      regs.and(0x0f);
      m.step(0x1b4e, 7);
      mem.write8(0x51f3, regs.a);
      m.step(0x1b51, 13);
    }
    regs.de = 0x1b56;
    m.step(0x1b54, 10);
    m.step(0x1b0a, 12);
    return m.call(0x1b0a);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
