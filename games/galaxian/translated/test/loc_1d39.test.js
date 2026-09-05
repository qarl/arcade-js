// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1d39 (Galaxian tile-strip fill, first half, ROM 0x1d39-0x1d42):
//   1d39  36 30   ld (hl),0x30
//   1d3b  23      inc hl
//   1d3c  36 32   ld (hl),0x32
//   1d3e  23      inc hl
//   1d3f  10 f8   djnz 0x1d39
//   1d41  06 10   ld b,0x10
// Entry contract B=0x10: 16*(10+6+10+6) + 15*13 + 8 + 7 = 722 T; writes 0x30,0x32 x16, HL += 32,
// reloads B=16, tail-calls loc_1d43.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1d39 } from "../loc_1d39.js";

function mk() {
  const routines = new Map([[0x1d43, () => "STUB"]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, b = 0x10, base = 0x5000) {
  const m = mk();
  m.regs.hl = base;
  m.regs.b = b;
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl, b: m.regs.b };
}

test("loc_1d39: B=16 writes the 0x30/0x32 strip, HL+=32, reloads B, tail loc_1d43; 722 T", () => {
  const r = run(loc_1d39);
  assert.equal(r.cycles, 722, "T-state total for B=16");
  assert.deepEqual(r.calls, [0x1d43], "tail into the second-half loop");
  assert.equal(r.hl, 0x5020, "HL advanced by 2 per pair, 16 pairs");
  assert.equal(r.b, 0x10, "B reloaded to 16 for the second half");
  assert.equal(r.m.mem.read8(0x5000), 0x30, "first byte of the pair");
  assert.equal(r.m.mem.read8(0x5001), 0x32, "second byte of the pair");
  assert.equal(r.m.mem.read8(0x501e), 0x30, "last pair, first byte");
  assert.equal(r.m.mem.read8(0x501f), 0x32, "last pair, second byte");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1d39.js
//   find: mem.write8(regs.hl, 0x32);
//   repl: mem.write8(regs.hl, 0x33);
//   expect: FAIL (odd bytes become 0x33 -- caught by the 0x5001/0x501f assertions)
test("loc_1d39: the contract catches a wrong second-tile code", () => {
  const m = mk();
  m.regs.hl = 0x5000; m.regs.b = 0x10;
  for (;;) {
    m.mem.write8(m.regs.hl, 0x30); m.step(0x1d3b, 10);
    m.regs.hl = (m.regs.hl + 1) & 0xffff; m.step(0x1d3c, 6);
    m.mem.write8(m.regs.hl, 0x33); m.step(0x1d3e, 10); // MUTANT: wrong code
    m.regs.hl = (m.regs.hl + 1) & 0xffff; m.step(0x1d3f, 6);
    if (m.regs.djnz() !== 0) { m.step(0x1d39, 13); continue; }
    m.step(0x1d41, 8); break;
  }
  assert.notEqual(m.mem.read8(0x5001), 0x32, "the wrong tile code lands in VRAM");
});
