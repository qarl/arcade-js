// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9cb6 (ROM 0x9cb6-0x9d04) -- the per-slot(x) steering step keyed on the
// direction/flags cell loc_28a,x bit7. bit7 set -> SUB-step (loc_9c99) + maybe flip bit7; bit7 clear ->
// ADD-step (loc_9c63); a common tail may seed an object via loc_a347. Output is RAM (dumpState minus the
// dead STACK_SCRATCH); the slot register X is passed through, and A tracks the oracle's final compare
// operand on every tail exit EXCEPT the loc_a347 arm (there A is that callee's incidental leftover). Y
// IS a live-out into the loc_a347 seed arm -- the ADD step (loc_9c63 -> loc_9d06) leaves the scan index
// in Y and the seed stores it to loc_36 -- so the bit7-clear->loc_9d06->a347 path is exercised below.
// Oracle is the frozen translated/loc_9cb6.js. Reached only by indirect dispatch (no direct jsr/jmp in ROM).
// Run: node --test games/tempest/idiomatic/test/equivalence-9cb6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9cb6 as oracle } from "../../translated/loc_9cb6.js";
import { loc_9cb6 } from "../loc_9cb6.js";
import { loc_9c99, loc_9c63 } from "../loc_9c58.js";
import { loc_a347 } from "../loc_a343.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH, loc_36, loc_108, loc_109, loc_13b, loc_13c, loc_148, loc_157, loc_160, loc_165,
  loc_200, loc_201, loc_202, loc_283, loc_28a, loc_2b9, loc_2cc, loc_2df, loc_3ab,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9cb6;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9cb6 dispatches -- loc_9cb6 == oracle in RAM (-stack) and X", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a dispatch whose deep callee the oracle can't resolve on this frame -- both would throw
    loc_9cb6(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X (slot) passed through");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) checked`);
});

// --- CRAFTED arms (self-contained callee paths: loc_9c99 is a leaf; loc_9c63 seeded to its shallow
// return; loc_a347's chain resolves on a fresh Machine, per equivalence-a343.test.js) ---

function fresh(x) {
  const m = new Machine(ROM, OPTS);
  m.regs.x = x;
  return m;
}

test("CRAFTED: bit7 set -- loc_3ab==0 forces probe 0xff >= threshold -> eor #$80 flip of loc_28a,x", () => {
  const setup = (m) => {
    m.mem.write8((loc_28a + 0x00) & 0xffff, 0x80); // bit7 set -> SUB path
    m.mem.write8((loc_2df + 0x00) & 0xffff, 0x50); // hi coord; delta 0 -> loc_9c99 returns 0x50
    m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x01) & 0xffff, 0x00);
    m.mem.write8(loc_3ab, 0x00);                    // ldy loc_3ab == 0 -> probe = 0xff
    m.mem.write8(loc_157, 0x40);                    // 0xff >= 0x40 -> flip
    m.mem.write8(loc_148, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.x, o.regs.x, "X passed through");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((loc_28a + 0x00) & 0xffff), 0x00, "bit7 flipped: 0x80 ^ 0x80 = 0x00");
});

test("CRAFTED: bit7 set -- loc_3ab!=0, probe = loc_9c99 return < threshold -> bcc, no flip", () => {
  const setup = (m) => {
    m.mem.write8((loc_28a + 0x00) & 0xffff, 0x80);
    m.mem.write8((loc_2df + 0x00) & 0xffff, 0x05); // loc_9c99 returns 0x05
    m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x01) & 0xffff, 0x00);
    m.mem.write8(loc_3ab, 0x01);                    // ldy loc_3ab != 0 -> probe = stepped (0x05)
    m.mem.write8(loc_157, 0x40);                    // 0x05 < 0x40 -> bcc -> no flip
    m.mem.write8(loc_148, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((loc_28a + 0x00) & 0xffff), 0x80, "no flip (bcc taken)");
});

test("CRAFTED: bit7 clear -- coord < threshold picks Y=1 -> loc_9c63 reads delta[1]", () => {
  const setup = (m) => {
    m.mem.write8((loc_28a + 0x00) & 0xffff, 0x00); // bit7 clear -> ADD path
    m.mem.write8((loc_2df + 0x00) & 0xffff, 0x25); // 0x25 < 0x40 -> Y stays 1
    m.mem.write8(loc_157, 0x40);
    m.mem.write8(loc_202, 0x00);                    // floor 0 -> loc_9c63 hi > floor, skips loc_9d06
    m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x01) & 0xffff, 0x02); // delta[1] hi +2
    m.mem.write8((loc_160 + 0x00) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x00) & 0xffff, 0x10); // delta[0] differs -> a wrong Y would diverge in RAM
    m.mem.write8(loc_148, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((loc_2df + 0x00) & 0xffff), 0x27, "hi stepped by delta[1]: 0x25 + 0x02");
});

test("CRAFTED: bit7 clear -- coord >= threshold picks Y=0 -> loc_9c63 reads delta[0]", () => {
  const setup = (m) => {
    m.mem.write8((loc_28a + 0x00) & 0xffff, 0x00);
    m.mem.write8((loc_2df + 0x00) & 0xffff, 0x50); // 0x50 >= 0x40 -> ldy #0 -> Y=0
    m.mem.write8(loc_157, 0x40);
    m.mem.write8(loc_202, 0x00);
    m.mem.write8((loc_160 + 0x00) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x00) & 0xffff, 0x01); // delta[0] hi +1
    m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x01) & 0xffff, 0x02); // delta[1] differs
    m.mem.write8(loc_148, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((loc_2df + 0x00) & 0xffff), 0x51, "hi stepped by delta[0]: 0x50 + 0x01");
});

// The common tail with all four conditions true -> jsr loc_a347. Reached via the bit7-set path so no
// deep loc_9c63 dispatch is involved; Y at the a347 site = loc_3ab's value (0x01), which loc_a3d6 writes.
function seedTailA347(m) {
  m.mem.write8((loc_28a + 0x00) & 0xffff, 0x80);   // bit7 set
  m.mem.write8((loc_2df + 0x00) & 0xffff, 0x20);   // loc_9c99 returns/writes 0x20
  m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
  m.mem.write8((loc_165 + 0x01) & 0xffff, 0x00);
  m.mem.write8(loc_3ab, 0x01);                      // probe = 0x20 (< thr) -> no flip; Y = 0x01
  m.mem.write8(loc_157, 0x40);                      // cond2: loc_2df,x (0x20) < 0x40
  m.mem.write8(loc_148, 0x00);                      // cond1: bit7 clear -> continue
  m.mem.write8(loc_200, 0x88); m.mem.write8((loc_2b9 + 0x00) & 0xffff, 0x88); // cond3 equal
  m.mem.write8(loc_201, 0x33); m.mem.write8((loc_2cc + 0x00) & 0xffff, 0x33); // cond4 equal
  m.mem.write8(loc_202, 0x77);                      // loc_a352 copies loc_202
}

test("CRAFTED: common tail all four conditions match -> loc_a347 seeds the object (RAM + X; A dropped)", () => {
  const o = fresh(0x00); seedTailA347(o);
  const c = fresh(0x00); seedTailA347(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (incl. loc_a347's insert)");
  assert.equal(c.regs.x, o.regs.x, "X passed through");
  // A is NOT compared here: on the loc_a347 arm A is that callee-chain's incidental leftover, not a
  // reproduced live-out (loc_a352 ends on a mem store, leaving A as loc_a3d6/loc_ccb0's last value).
  assert.equal(c.mem.read8(loc_13b), 0x07, "loc_a347 stamped the head flag 0x07");
  assert.equal(c.mem.read8(loc_13c), 0x01, "loc_a347 raised the ready flag");
  assert.equal(c.mem.read8(loc_201), 0x81, "loc_a352 set loc_201 = 0x81");
});

test("CRAFTED: common tail with one condition false (loc_200 != loc_2b9,x) -> no loc_a347, A = loc_200", () => {
  const setup = (m) => { seedTailA347(m); m.mem.write8((loc_2b9 + 0x00) & 0xffff, 0x99); }; // break cond3
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x88, "A = loc_200 (bne exit before loc_a347)");
  assert.equal(c.mem.read8(loc_13c), 0x00, "loc_a347 did NOT run (ready flag untouched)");
  assert.equal(c.mem.read8(loc_201), 0x33, "loc_201 untouched (still 0x33)");
});

test("TEETH: a twin that skips the eor #$80 flip diverges from the oracle in RAM", () => {
  const setup = (m) => {
    m.mem.write8((loc_28a + 0x00) & 0xffff, 0x80);
    m.mem.write8((loc_2df + 0x00) & 0xffff, 0x50);
    m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
    m.mem.write8((loc_165 + 0x01) & 0xffff, 0x00);
    m.mem.write8(loc_3ab, 0x00);                    // probe = 0xff >= threshold -> oracle flips
    m.mem.write8(loc_157, 0x40);
    m.mem.write8(loc_148, 0x80);                    // tail exits immediately (no tail RAM writes)
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o);
  const broken = (m, x = m.regs.x) => { loc_9c99(m, x, 1); /* BUG: never performs the eor #$80 flip */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped bit7 flip");
});

// The wrong-Y bug path (the reason 9cb6 was deferred): bit7-CLEAR -> loc_9c63 enters loc_9d06 because
// the stepped hi <= loc_202; loc_9d06's scan arm leaves the SCAN INDEX in Y; the common tail then seeds
// via loc_a347, whose chain (loc_a352 -> loc_994d -> loc_a3d6) stores that Y to loc_36. The pre-fix
// idiomatic handed a347 the pre-call steering y instead. Drive it and require loc_36 = the scan index.
function seedClear9d06ToA347(m) {
  m.mem.write8((loc_28a + 0x00) & 0xffff, 0x00);   // bit7 clear -> ADD path
  m.mem.write8((loc_2df + 0x00) & 0xffff, 0x05);   // < loc_157 -> steering y = 1; also the add base
  m.mem.write8(loc_157, 0x40);
  m.mem.write8((loc_160 + 0x01) & 0xffff, 0x00);
  m.mem.write8((loc_165 + 0x01) & 0xffff, 0x00);   // delta[1] = 0 -> stepped hi = 0x05
  m.mem.write8(loc_202, 0x10);                      // hi 0x05 <= 0x10 -> enter loc_9d06; 0x10 < loc_157 -> tail passes
  m.mem.write8(loc_109, 0x01);                      // loc_9d06 scan arm
  m.mem.write8(loc_108, 0x05);
  m.mem.write8((loc_283 + 0x00) & 0xffff, 0x00);   // kind 0 (not 1, not negative) -> scan
  m.mem.write8((loc_2df + 0x06) & 0xffff, 0x10);   // slot 6 stash == shared(loc_202) -> scan matches at y = 6
  m.mem.write8((loc_283 + 0x06) & 0xffff, 0x00);
  m.mem.write8(loc_148, 0x00);                      // tail cond1: bit7 clear
  m.mem.write8(loc_200, 0x88); m.mem.write8((loc_2b9 + 0x00) & 0xffff, 0x88); // cond3 equal
  m.mem.write8(loc_201, 0x33); m.mem.write8((loc_2cc + 0x00) & 0xffff, 0x33); // cond4 equal
}

test("CRAFTED (wrong-Y path): bit7-clear -> loc_9d06 scan -> a347 stores the scan index to loc_36", () => {
  const o = fresh(0x00); seedClear9d06ToA347(o);
  const c = fresh(0x00); seedClear9d06ToA347(c);
  oracle(o); loc_9cb6(c);
  assert.equal(ramDiff(o, c), null, "RAM equal incl. loc_36 (the a347 Y-store)");
  assert.equal(c.regs.x, o.regs.x, "X passed through");
  assert.equal(c.mem.read8(loc_36), o.mem.read8(loc_36), "loc_36 = the scan index Y (not the steering y)");
  assert.equal(o.mem.read8(loc_36), 0x06, "the oracle stored the scan index 0x06 to loc_36");
});

test("TEETH (wrong-Y): a twin passing the pre-call steering y to the seed diverges at loc_36", () => {
  const o = fresh(0x00); seedClear9d06ToA347(o);
  const c = fresh(0x00); seedClear9d06ToA347(c);
  oracle(o);
  // Broken twin = the pre-fix behaviour: run the same delegate (loc_9c63 -> loc_9d06), then seed with the
  // STEERING y (1) instead of the Y loc_9c63 left (the scan index 6). Must diverge at loc_36.
  const broken = (m, x = 0x00) => { loc_9c63(m, x, 1); return loc_a347(m, x, 1); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the wrong Y into a347 was NOT caught at loc_36");
});
