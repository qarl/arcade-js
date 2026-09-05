// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1d43 (Galaxian tile-strip fill, second half + counter, ROM 0x1d43-0x1d50):
//   1d43  36 34 / 23 / 36 36 / 23    ld (hl),0x34 ; inc hl ; ld (hl),0x36 ; inc hl
//   1d49  10 f8                       djnz 0x1d43
//   1d4b  22 0b 40                    ld (0x400b),hl   ; save advanced cursor
//   1d4e  d9                          exx              ; MAIN HL -> 0x4008 counter
//   1d4f  35                          dec (hl)
//   1d50  c0                          ret nz
// Entry B=0x10, alt HL=0x4008. Counter->0: 512+203+16+4+11+5 = 751 T, tail loc_1d51, (0x4008)=0.
// Counter still running: 512+203+16+4+11+11 = 757 T, ret, (0x4008) decremented.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1d43 } from "../loc_1d43.js";

function mk() {
  const routines = new Map([[0x1d51, () => "STUB"]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, counter, base = 0x5020) {
  const m = mk();
  m.regs.hl = base; m.regs.b = 0x10;
  m.regs.h_ = 0x40; m.regs.l_ = 0x08; // alt HL = 0x4008 counter cell
  m.mem.write8(0x4008, counter);
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret };
}

test("loc_1d43: counter -> 0 writes strip, saves cursor, falls into loc_1d51; 751 T", () => {
  const r = run(loc_1d43, 0x01);
  assert.equal(r.cycles, 751, "T-state total, counter path to 0");
  assert.deepEqual(r.calls, [0x1d51], "falls through to the 0x4009 branch");
  assert.equal(r.m.mem.read8(0x5020), 0x34, "first byte of the pair");
  assert.equal(r.m.mem.read8(0x5021), 0x36, "second byte of the pair");
  assert.equal(r.m.mem.read16(0x400b), 0x5040, "advanced cursor stashed to 0x400b");
  assert.equal(r.m.mem.read8(0x4008), 0x00, "dec (0x4008) reached 0");
});

test("loc_1d43: counter still running returns (no fall-through); 757 T", () => {
  const r = run(loc_1d43, 0x02);
  assert.equal(r.cycles, 757, "T-state total, ret nz taken");
  assert.deepEqual(r.calls, [], "ret nz -- no delegate call");
  assert.equal(r.m.mem.read8(0x4008), 0x01, "counter decremented, still non-zero");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1d43.js
//   find: mem.write16(0x400b, regs.hl);
//   repl: (delete the line)
//   expect: FAIL (0x400b never updated -- caught by the read16(0x400b) assertion)
test("loc_1d43: the contract catches a missing cursor stash", () => {
  const m = mk();
  m.regs.hl = 0x5020; m.regs.b = 0x10; m.regs.h_ = 0x40; m.regs.l_ = 0x08;
  m.mem.write8(0x4008, 0x01);
  m.mem.write16(0x400b, 0x1234); // sentinel that must be overwritten
  for (;;) {
    m.mem.write8(m.regs.hl, 0x34); m.step(0x1d45, 10);
    m.regs.hl = (m.regs.hl + 1) & 0xffff; m.step(0x1d46, 6);
    m.mem.write8(m.regs.hl, 0x36); m.step(0x1d48, 10);
    m.regs.hl = (m.regs.hl + 1) & 0xffff; m.step(0x1d49, 6);
    if (m.regs.djnz() !== 0) { m.step(0x1d43, 13); continue; }
    m.step(0x1d4b, 8); break;
  }
  // MUTANT: no mem.write16(0x400b, regs.hl)
  m.step(0x1d4e, 16);
  m.regs.exx(); m.step(0x1d4f, 4);
  m.regs.decMem8(m.mem, m.regs.hl); m.step(0x1d50, 11);
  assert.notEqual(m.mem.read16(0x400b), 0x5040, "the cursor was never saved back");
});
