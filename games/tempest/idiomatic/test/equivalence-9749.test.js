// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9749 -- the spinner/rotation-delta update. When $0201 is non-negative it
// derives a delta (table scan when $05 bit7 is clear; a clamped $50 when set), folds it through $2b/$2c/$2a,
// rings the sound gate on a changed $2a, and commits $2a/$2b/$2c to $0200/$0201/$51. The idiomatic side
// dissolves jsr 97c5 (delta in A) and jsr ccb5 (X = $0111, Y = entry Y) into direct idiomatic calls.
// Live-out is memory only, so each arm compares RAM (dumpState minus STACK_SCRATCH).
// Run: node --test games/tempest/idiomatic/test/equivalence-9749.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9749 as oracle } from "../../translated/loc_9749.js";
import { loc_9749 } from "../loc_9749.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_5, loc_50, loc_51, loc_2a, loc_2b, loc_2c, loc_111, loc_200, loc_201, loc_31, loc_32 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9749;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x9749 dispatches -- loc_9749 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9749(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("TEETH-NEGATIVE: $0201 negative -- both early-out with no state change", () => {
  const seed = (m) => { m.mem.write8(loc_201, 0x80); m.mem.write8(loc_50, 0x77); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative early-out");
  assert.equal(c.mem.read8(loc_50), 0x77, "$50 untouched (routine returned before the clamp)");
});

test("CRAFTED: $05 bit7 CLEAR -- delta comes from the table scan (97c5 path)", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x00);   // non-negative -> proceed
    m.mem.write8(loc_5, 0x00);     // bit7 clear -> scan path
    m.mem.write8(loc_51, 0x12);
    m.mem.write8(loc_111, 0x00);   // skip the nested clamp
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the scan path");
});

test("CRAFTED: $05 bit7 SET, $50 positive >=0x1f -- capped to 0x1f then $50 consumed", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x00);
    m.mem.write8(loc_5, 0x80);     // bit7 set -> $50 clamp path
    m.mem.write8(loc_50, 0x40);    // positive, >=0x1f
    m.mem.write8(loc_51, 0x03);
    m.mem.write8(loc_111, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the positive-clamp path");
  assert.equal(c.mem.read8(loc_50), 0x00, "$50 consumed to 0");
});

test("CRAFTED: $05 bit7 SET, $50 negative <0xe1 -- floored to 0xe1", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x00);
    m.mem.write8(loc_5, 0x80);
    m.mem.write8(loc_50, 0x90);    // negative, <0xe1
    m.mem.write8(loc_51, 0x03);
    m.mem.write8(loc_111, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative-floor path");
});

test("CRAFTED: $05 bit7 SET, $50 negative >=0xe1 -- kept as-is", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x00);
    m.mem.write8(loc_5, 0x80);
    m.mem.write8(loc_50, 0xf0);    // negative, >=0xe1 -> no clamp
    m.mem.write8(loc_51, 0x03);
    m.mem.write8(loc_111, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative-kept path");
});

// $0111 active drives the nested $2c cap (>=0xf0 -> 0xef) then the sign-flip saturation toward $51's sign.
// $50=0x40 -> a=0x1f, $51=0x14 -> $2c = 0x14-0x1f = 0xf5 -> capped 0xef; $2c/$2b and $2c/$51 both flip sign,
// $51 positive -> $2c saturates to 0x00.
function seedNested(m) {
  m.mem.write8(loc_201, 0x00);
  m.mem.write8(loc_5, 0x80);
  m.mem.write8(loc_50, 0x40);
  m.mem.write8(loc_51, 0x14);
  m.mem.write8(loc_111, 0x07);   // active -> nested clamp
  m.mem.write8(loc_200, 0xff);   // != the folded $2a -> ccb5 fires
}

test("CRAFTED: $0111 active -- nested cap + sign-flip saturation of $2c", () => {
  const o = new Machine(ROM, OPTS); seedNested(o);
  const c = new Machine(ROM, OPTS); seedNested(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the nested-clamp path");
});

test("CRAFTED: ccb5 active -- $05 bit7 SET + $2a != $0200 opens the gate; $31/$32 seated", () => {
  const seedCcb5 = (m) => { seedNested(m); m.regs.y = 0x5a; };
  const o = new Machine(ROM, OPTS); seedCcb5(o);
  const c = new Machine(ROM, OPTS); seedCcb5(c);
  oracle(o); loc_9749(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the ccb5-active path");
  assert.equal(c.mem.read8(loc_31), 0x07, "$31 = X = $0111 seated by the open sound gate");
  assert.equal(c.mem.read8(loc_32), 0x5a, "$32 = entry Y seated by the open sound gate");
  assert.equal(o.mem.read8(loc_31), 0x07, "oracle agrees $31 seated");
  assert.equal(o.mem.read8(loc_32), 0x5a, "oracle agrees $32 seated");
});

test("TEETH: a twin that skips the ccb5 gate diverges from the oracle", () => {
  const seedCcb5 = (m) => { seedNested(m); m.regs.y = 0x5a; };
  const o = new Machine(ROM, OPTS); seedCcb5(o);
  const c = new Machine(ROM, OPTS); seedCcb5(c);
  oracle(o);
  // BUG: identical fold but the ccb5 call (the open sound gate seating $31/$32) is skipped.
  const broken = (m) => {
    const { mem8 } = m;
    if (mem8[loc_201] & 0x80) return;
    let a = mem8[loc_50];
    if ((a & 0x80) === 0) { if (a >= 0x1f) a = 0x1f; } else if (a < 0xe1) a = 0xe1;
    mem8[loc_50] = 0x00;
    mem8[loc_2b] = a;
    let cc = (((a ^ 0xff) + mem8[loc_51] + 1) & 0xff);
    mem8[loc_2c] = cc;
    if (cc >= 0xf0) { cc = 0xef; mem8[loc_2c] = cc; }
    if ((cc ^ mem8[loc_2b]) & 0x80 && (cc ^ mem8[loc_51]) & 0x80) mem8[loc_2c] = mem8[loc_51] & 0x80 ? 0xef : 0x00;
    const hi = mem8[loc_2c] >> 4;
    mem8[loc_2a] = hi;
    mem8[loc_2b] = (hi + 1) & 0x0f;
    /* BUG: no loc_ccb5 call -- $31/$32 never seated */
    mem8[loc_200] = mem8[loc_2a];
    mem8[loc_201] = mem8[loc_2b];
    mem8[loc_51] = mem8[loc_2c];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped ccb5 gate");
});

test("TEETH: a wrong positive-clamp constant diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(loc_201, 0x00);
    m.mem.write8(loc_5, 0x80);
    m.mem.write8(loc_50, 0x40);
    m.mem.write8(loc_51, 0x03);
    m.mem.write8(loc_111, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    if (mem8[loc_201] & 0x80) return;
    let a = mem8[loc_50];
    if ((a & 0x80) === 0) { if (a >= 0x1f) a = 0x2f; } else if (a < 0xe1) a = 0xe1; // BUG: 0x2f not 0x1f
    mem8[loc_50] = 0x00;
    mem8[loc_2b] = a;
    const cc = (((a ^ 0xff) + mem8[loc_51] + 1) & 0xff);
    mem8[loc_2c] = cc;
    const hi = mem8[loc_2c] >> 4;
    mem8[loc_2a] = hi;
    mem8[loc_2b] = (hi + 1) & 0x0f;
    mem8[loc_200] = mem8[loc_2a];
    mem8[loc_201] = mem8[loc_2b];
    mem8[loc_51] = mem8[loc_2c];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong clamp constant");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(loc_201, 0x00);
  m.mem.write8(loc_5, 0x80);
  m.mem.write8(loc_50, 0x40);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, loc_9749, TARGET, m);
  assert.equal(r.placeable, true, `loc_9749 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
