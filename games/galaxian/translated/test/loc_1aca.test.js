// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1aca (VIDEORAM march-test SETUP, ROM 0x1aca-0x1acf):
//   1aca  ld hl,0x5000 / ld b,0x04 / ld a,c   ; VRAM base, 4 pages, seed = C; fall through -> loc_1ad0
// Contract: 3 instr, 21 T (10+7+4), HL=0x5000, B=0x04, A=C, tail into loc_1ad0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1aca } from "../loc_1aca.js";

function mk(stubAddrs = []) {
  const routines = new Map();
  for (const a of stubAddrs) routines.set(Number(a), () => "STUB");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubAddrs = [0x1ad0]) {
  const m = mk(stubAddrs);
  m.regs.c = 0x12;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl, b: m.regs.b, a: m.regs.a };
}

function checkSpec(res) {
  assert.equal(res.cycles, 21, "T-state total (10+7+4)");
  assert.deepEqual(res.calls, [0x1ad0], "falls through into the VRAM write loop loc_1ad0");
  assert.equal(res.hl, 0x5000, "ld hl,0x5000 -- VIDEORAM base");
  assert.equal(res.b, 0x04, "ld b,0x04 -- four pages");
  assert.equal(res.a, 0x12, "ld a,c -- seed the pattern from C=0x12");
}

test("loc_1aca: VRAM test setup loads HL/B/A and falls through to loc_1ad0; 21 T", () => {
  checkSpec(run(loc_1aca));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1aca.js
//   find: regs.hl = 0x5000;\n  m.step(0x1acd, 10); // ld hl,0x5000 -- VIDEORAM base
//   repl: regs.hl = 0x4000;\n  m.step(0x1acd, 10); // ld hl,0x5000 -- VIDEORAM base
//   expect: FAIL  (points the VRAM test at work RAM -> caught by HL == 0x5000)
//   verified-anchor: count == 1  (the sole "regs.hl = 0x5000" in loc_1aca.js)
test("loc_1aca: the contract catches a wrong base address", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x4000; // MUTANT: wrong base (work RAM, not VRAM)
    m.step(0x1acd, 10);
    regs.b = 0x04;
    m.step(0x1acf, 7);
    regs.a = regs.c;
    m.step(0x1ad0, 4);
    return m.call(0x1ad0);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
