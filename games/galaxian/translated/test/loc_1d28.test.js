// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1d28 (Galaxian tile-strip updater head, ROM 0x1d28-0x1d38):
//   1d28  21 08 40  ld hl,0x4008    ; gate byte / counter cell
//   1d2b  3a 00 78  ld a,(0x7800)   ; watchdog pet (returns 0xff, discarded)
//   1d2e  7e        ld a,(hl)       ; A = gate byte
//   1d2f  a7        and a
//   1d30  ca 51 1d  jp z,0x1d51     ; gate 0 -> 0x4009 branch
//   1d33  d9        exx
//   1d34  2a 0b 40  ld hl,(0x400b)  ; VRAM cursor
//   1d37  06 10     ld b,0x10
// Fill path (gate nonzero): 71 T (10+13+7+4+10+4+16+7), tail-call loc_1d39, HL=cursor, B=16.
// Gate-0 path: 44 T (10+13+7+4+10), tail-call loc_1d51.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1d28 } from "../loc_1d28.js";

function mk(stubs = { 0x1d39: 1, 0x1d51: 1 }) {
  const routines = new Map();
  for (const a of Object.keys(stubs)) routines.set(Number(a), () => "STUB");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, gate) {
  const m = mk();
  m.mem.write8(0x4008, gate);
  m.mem.write16(0x400b, 0x5000); // VRAM write cursor
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, b: m.regs.b, hl: m.regs.hl,
           altH: m.regs.h_, altL: m.regs.l_ };
}

test("loc_1d28: gate nonzero -> exx, load cursor, fall into fill loop; 71 T", () => {
  const r = run(loc_1d28, 0x03);
  assert.equal(r.cycles, 71, "T-state total (10+13+7+4+10+4+16+7)");
  assert.deepEqual(r.calls, [0x1d39], "tail into the 0x30/0x32 fill loop");
  assert.equal(r.hl, 0x5000, "HL loaded from (0x400b)");
  assert.equal(r.b, 0x10, "B = 16 pairs");
  assert.equal(r.a, 0x03, "A holds the gate byte (and a leaves it)");
  assert.equal(r.altL, 0x08, "exx parked 0x4008 low byte in the alt HL");
  assert.equal(r.altH, 0x40, "exx parked 0x4008 high byte in the alt HL");
});

test("loc_1d28: gate 0 -> jp z to the 0x4009 branch; 44 T", () => {
  const r = run(loc_1d28, 0x00);
  assert.equal(r.cycles, 44, "T-state total (10+13+7+4+10)");
  assert.deepEqual(r.calls, [0x1d51], "tail-jump to loc_1d51, no fill");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1d28.js
//   find: regs.hl = mem.read16(0x400b);
//   repl: regs.hl = mem.read16(0x400a);   // wrong cursor cell
//   expect: FAIL (HL != 0x5000 -- caught by hl assertion)
test("loc_1d28: the contract catches a wrong VRAM-cursor source", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4008; m.step(0x1d2b, 10);
    regs.a = mem.read8(0x7800); m.step(0x1d2e, 13);
    regs.a = mem.read8(regs.hl); m.step(0x1d2f, 7);
    regs.and(regs.a); m.step(0x1d30, 4);
    m.step(0x1d33, 10);
    regs.exx(); m.step(0x1d34, 4);
    regs.hl = mem.read16(0x400a); m.step(0x1d37, 16); // MUTANT: wrong cell
    regs.b = 0x10; m.step(0x1d39, 7);
    return m.call(0x1d39);
  };
  const m = mk();
  m.mem.write8(0x4008, 0x03);
  m.mem.write16(0x400b, 0x5000);
  mutant(m);
  assert.notEqual(m.regs.hl, 0x5000, "reading the wrong cell yields the wrong cursor");
});
