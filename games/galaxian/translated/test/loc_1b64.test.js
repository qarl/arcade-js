// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b64 (ROM 0x1B64-0x1B6F): fill one 256-byte VRAM page with A, inc H, pet the
// watchdog, djnz back to loc_1b62 for the next page, ret when B hits 0.
//   1b64 ld (hl),a / 1b65 inc l / 1b66 jp nz,0x1b64 / 1b69 inc h / 1b6a ld a,(0x7800) / 1b6d djnz 0x1b62 / 1b6f ret
// Contracts: B=1 fills exactly one page and rets (5411 T, no transfer); B>1 fills a page then delegates to
// loc_1b62 for the next (djnz taken).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b64 } from "../loc_1b64.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : () => {});
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function pageFilled(m, page, val) {
  const base = (page - 0x50) * 0x100; // videoRam is 0x400 bytes; 0x50->0, 0x51->0x100, ...
  for (let i = 0; i < 0x100; i++) if (m.mem.videoRam[base + i] !== val) return false;
  return true;
}

test("loc_1b64: B=1 fills one VRAM page, pets watchdog, rets; 5411 T", () => {
  const m = mk();
  m.regs.sp = 0x4300; m.push16(0xbeef);
  m.regs.hl = 0x5000; m.regs.a = 0x10; m.regs.b = 0x01;
  const wd0 = m.mem.watchdogReads;
  loc_1b64(m);
  // 256 * (ld(hl),a 7 + inc l 4 + jp nz 10) = 5376; + inc h 4 + ld a,(nn) 13 + djnz-nt 8 + ret 10 = 5411
  assert.equal(m.cycles, 5411, "inner 256*21 + 35");
  assert.ok(pageFilled(m, 0x50, 0x10), "VRAM 0x5000-0x50FF filled with 0x10");
  assert.equal(m.mem.videoRam[0x100], 0x00, "page 0x5100 NOT filled (B=1, single page)");
  assert.equal(m.regs.h, 0x51, "inc h -> next page");
  assert.equal(m.regs.l, 0x00, "L wrapped to 0");
  assert.equal(m.regs.a, 0xff, "ld a,(0x7800) watchdog read floats high");
  assert.equal(m.mem.watchdogReads, wd0 + 1, "watchdog petted once");
  assert.deepEqual(m.calls, [], "B=1: djnz not taken, no transfer");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

function runB2(fn, stubs = { 0x1b62: "stub" }) {
  const m = mk(stubs);
  m.regs.sp = 0x4300; m.push16(0xbeef);
  m.regs.hl = 0x5000; m.regs.a = 0x10; m.regs.b = 0x02;
  fn(m);
  return { calls: m.calls, b: m.regs.b, cycles: m.cycles, filled: pageFilled(m, 0x50, 0x10) };
}

function checkB2(res) {
  assert.ok(res.filled, "first page filled with 0x10");
  assert.deepEqual(res.calls, [0x1b62], "djnz taken -> re-enter loc_1b62 for the next page");
  assert.equal(res.b, 0x01, "B decremented 2 -> 1");
  // inner 5376 + inc h 4 + ld a 13 + djnz-taken 13 = 5406 (stub adds no cycles)
  assert.equal(res.cycles, 5406, "inner 256*21 + 4 + 13 + djnz-taken 13");
}

test("loc_1b64: B=2 fills a page then delegates to loc_1b62 (djnz taken)", () => {
  checkB2(runB2(loc_1b64));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b64.js
//   find: m.step(0x1b62, 13); // djnz 0x1b62 (taken) ...\n    return m.call(0x1b62);
//   repl: m.step(0x1b70, 13); ...  return m.call(0x1b70);
//   expect: FAIL  (djnz re-enters the wrong routine -- caught by calls == [0x1b62])
//   verified-anchor: count == 1  (the sole "return m.call(0x1b62)" in loc_1b64.js)
test("loc_1b64: the contract catches a wrong djnz target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a); m.step(0x1b65, 7);
      regs.l = regs.inc8(regs.l); m.step(0x1b66, 4);
      if (regs.fNZ) { m.step(0x1b64, 10); continue; }
      m.step(0x1b69, 10); break;
    }
    regs.h = regs.inc8(regs.h); m.step(0x1b6a, 4);
    regs.a = mem.read8(0x7800); m.step(0x1b6d, 13);
    if (m.regs.djnz() !== 0) { m.step(0x1b70, 13); return m.call(0x1b70); } // MUTANT: wrong target
    m.step(0x1b6f, 8); m.ret();
  };
  assert.throws(() => checkB2(runB2(mutant, { 0x1b70: "stub" })));
});
