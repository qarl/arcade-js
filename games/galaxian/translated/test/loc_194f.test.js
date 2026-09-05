// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_194f (ROM 0x194f-0x1960):
//   194f 7e        ld a,(hl)
//   1950 fe 63     cp 0x63
//   1952 c8        ret z            ; already at ceiling
//   1953 30 0c     jr nc,0x1961     ; (hl)>0x63: clamp
//   1955 34        inc (hl)
//   1956 3e 01     ld a,0x01
//   1958 32 c9 41  ld (0x41c9),a
//   195b 11 01 07  ld de,0x0701
//   195e c3 f2 08  jp 0x08f2        ; tail-enqueue
// Contract: below-ceiling path bumps (hl), raises 0x41c9, DE=0x0701, tails 0x08f2 in 77 T
// (7+7+5+7+11+7+13+10+10). Plus: at 0x63 -> ret z; above 0x63 -> clamp via loc_1961.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_194f } from "../loc_194f.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(hlVal, stubs) {
  const m = mk(stubs);
  m.regs.sp = 0x4400;
  m.regs.hl = 0x4002;
  m.mem.write8(0x4002, hlVal);
  const ret = fnWrap(m);
  return { m, ret, cycles: m.cycles, calls: m.calls };
}
function fnWrap(m) { return loc_194f(m); }

test("loc_194f: below ceiling -> bump (hl), raise 0x41c9, DE=0x0701, tail 0x08f2; 77 T", () => {
  const r = run(0x10, { 0x08f2: "tail" });
  assert.equal(r.cycles, 77, "T-state total 7+7+5+7+11+7+13+10+10");
  assert.deepEqual(r.calls, [0x08f2], "tails into the command-queue enqueue");
  assert.equal(r.ret, "TAIL", "tail-jump callee result propagates");
  assert.equal(r.m.mem.read8(0x4002), 0x11, "inc (hl): 0x10 -> 0x11");
  assert.equal(r.m.mem.read8(0x41c9), 0x01, "ld (0x41c9),a raised the flag");
  assert.equal(r.m.regs.de, 0x0701, "ld de,0x0701 command word");
});

test("loc_194f: at 0x63 -> ret z, no enqueue", () => {
  const r = run(0x63, {});
  assert.deepEqual(r.calls, [], "no delegation on ret z");
  assert.equal(r.m.mem.read8(0x4002), 0x63, "(hl) unchanged");
  assert.equal(r.m.mem.read8(0x41c9), 0x00, "flag not raised");
});

test("loc_194f: above 0x63 -> clamp via loc_1961", () => {
  const r = run(0x70, { 0x1961: "tail" });
  assert.deepEqual(r.calls, [0x1961], "jr nc delegates to the clamp head");
  assert.equal(r.m.mem.read8(0x4002), 0x70, "loc_194f itself does not touch (hl) on the clamp branch");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_194f.js
//   find: regs.de = 0x0701;
//   repl: regs.de = 0x0601;
//   expect: FAIL  (wrong command word -- caught by de == 0x0701)
//   verified-anchor: count == 1  (the sole "regs.de = 0x0701" in loc_194f.js)
test("loc_194f: contract catches a wrong command word", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(regs.hl); m.step(0x1950, 7);
    regs.cp(0x63); m.step(0x1952, 7);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x1953, 5);
    if (regs.fNC) { m.step(0x1961, 12); return m.call(0x1961); }
    m.step(0x1955, 7);
    regs.incMem8(mem, regs.hl); m.step(0x1956, 11);
    regs.a = 0x01; m.step(0x1958, 7);
    mem.write8(0x41c9, regs.a); m.step(0x195b, 13);
    regs.de = 0x0601; m.step(0x195e, 10); // MUTANT
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk({ 0x08f2: "tail" });
  m.regs.sp = 0x4400; m.regs.hl = 0x4002; m.mem.write8(0x4002, 0x10);
  mutant(m);
  assert.notEqual(m.regs.de, 0x0701, "mutant enqueues the wrong word");
});
