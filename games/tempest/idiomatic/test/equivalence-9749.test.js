// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rotateBlasterAroundRim -- the spinner/rotation-delta update. When $0201 is non-negative it
// derives a delta (table scan when $05 bit7 is clear; a clamped $50 when set), folds it through $2b/$2c/$2a,
// rings the sound gate on a changed $2a, and commits $2a/$2b/$2c to $0200/$0201/$51. The idiomatic side
// dissolves jsr 97c5 (delta in A) and jsr ccb5 (X = $0111, Y = entry Y) into direct idiomatic calls.
// Live-out is RAM plus the exit [X, Y] the routine returns. Each arm compares RAM (dumpState minus STACK_SCRATCH),
// and the CAPTURE arm and the register-path arms also compare the returned X/Y with the oracle's.
// Run: node --test games/tempest/idiomatic/test/equivalence-9749.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9749 as oracle } from "../../translated/loc_9749.js";
import { rotateBlasterAroundRim } from "../rotateBlasterAroundRim.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STATUS_FLAGS, SPINNER_ACCUM, RIM_ROT_OFFSET, loc_2a, loc_2b, COORD_LIST_PTR_LO, TUBE_GEOM_FLAG, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, loc_31, loc_32, ENEMY_SLOT_TOP, ENEMY_DEPTH, ENEMY_SEGMENT } from "../names.js";

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

test("CAPTURE: real 0x9749 dispatches -- rotateBlasterAroundRim == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    const ex = c.regs.x, ey = c.regs.y;
    c.regs.x ^= 0xff; c.regs.y ^= 0xff; // the entry registers go in as arguments, never through the file
    oracle(o); const [x, y] = rotateBlasterAroundRim(c, ey, ex);
    assert.equal(ramDiff(o, c), null);
    assert.equal(y, o.regs.y, "returned exit Y = the oracle's Y");
    assert.equal(x, o.regs.x, "returned exit X = the oracle's X");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("TEETH-NEGATIVE: $0201 negative -- both early-out with no state change", () => {
  const seed = (m) => { m.mem.write8(PLAYER_FINE_ANGLE, 0x80); m.mem.write8(SPINNER_ACCUM, 0x77); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative early-out");
  assert.equal(c.mem.read8(SPINNER_ACCUM), 0x77, "$50 untouched (routine returned before the clamp)");
});

test("CRAFTED: $05 bit7 CLEAR -- delta comes from the table scan (97c5 path)", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);   // non-negative -> proceed
    m.mem.write8(STATUS_FLAGS, 0x00);     // bit7 clear -> scan path
    m.mem.write8(RIM_ROT_OFFSET, 0x12);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);   // skip the nested clamp
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the scan path");
});

test("CRAFTED: scan path with a target found -- the delta left in Y is the returned exit Y", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x00);     // bit7 clear -> scan path
    m.mem.write8(RIM_ROT_OFFSET, 0x12);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
    m.mem.write8(ENEMY_SLOT_TOP, 0x04);
    for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00);
    m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0x03); // one target, two lanes from the player
    m.mem.write8((ENEMY_SEGMENT + 2) & 0xffff, 0x06);
    m.mem.write8(PLAYER_SEGMENT, 0x04);
    m.regs.y = 0x5a;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); const [x, y] = rotateBlasterAroundRim(c, 0x5a);
  assert.equal(ramDiff(o, c), null, "RAM equal on the found-target scan path");
  assert.notEqual(o.regs.y, 0x5a, "positive control: the oracle's scan reloaded Y");
  assert.equal(y, o.regs.y, "returned exit Y = the oracle's Y");
  assert.equal(x, o.regs.x, "returned exit X = the oracle's X (TUBE_GEOM_FLAG)");
});

// The aim can find a target in the player's own lane: the signed delta is then 0, which the ROM still moves
// through Y (tay), so the exit Y is 0 and not the incoming Y. A truthiness test on the delta would lose it.
test("CRAFTED: scan path with a zero-delta target -- the exit Y is 0, not the incoming Y", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x00);     // bit7 clear -> scan path
    m.mem.write8(RIM_ROT_OFFSET, 0x12);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
    m.mem.write8(ENEMY_SLOT_TOP, 0x04);
    for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00);
    m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0x03); // one target, in the player's lane
    m.mem.write8((ENEMY_SEGMENT + 2) & 0xffff, 0x04);
    m.mem.write8(PLAYER_SEGMENT, 0x04);
    m.regs.y = 0x5a;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c); c.regs.y = 0xa5;
  oracle(o); const [, y] = rotateBlasterAroundRim(c, 0x5a);
  assert.equal(o.regs.y, 0x00, "positive control: the oracle's zero-delta scan left Y = 0");
  assert.equal(y, o.regs.y, "returned exit Y = the oracle's Y");
  assert.equal(ramDiff(o, c), null, "RAM equal on the zero-delta scan path");
});

test("CRAFTED: $05 bit7 SET, $50 positive >=0x1f -- capped to 0x1f then $50 consumed", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x80);     // bit7 set -> $50 clamp path
    m.mem.write8(SPINNER_ACCUM, 0x40);    // positive, >=0x1f
    m.mem.write8(RIM_ROT_OFFSET, 0x03);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the positive-clamp path");
  assert.equal(c.mem.read8(SPINNER_ACCUM), 0x00, "$50 consumed to 0");
});

test("CRAFTED: $05 bit7 SET, $50 negative <0xe1 -- floored to 0xe1", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x80);
    m.mem.write8(SPINNER_ACCUM, 0x90);    // negative, <0xe1
    m.mem.write8(RIM_ROT_OFFSET, 0x03);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative-floor path");
});

test("CRAFTED: $05 bit7 SET, $50 negative >=0xe1 -- kept as-is", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x80);
    m.mem.write8(SPINNER_ACCUM, 0xf0);    // negative, >=0xe1 -> no clamp
    m.mem.write8(RIM_ROT_OFFSET, 0x03);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative-kept path");
});

// $0111 active drives the nested $2c cap (>=0xf0 -> 0xef) then the sign-flip saturation toward $51's sign.
// $50=0x40 -> a=0x1f, $51=0x14 -> $2c = 0x14-0x1f = 0xf5 -> capped 0xef; $2c/$2b and $2c/$51 both flip sign,
// $51 positive -> $2c saturates to 0x00.
function seedNested(m) {
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
  m.mem.write8(STATUS_FLAGS, 0x80);
  m.mem.write8(SPINNER_ACCUM, 0x40);
  m.mem.write8(RIM_ROT_OFFSET, 0x14);
  m.mem.write8(TUBE_GEOM_FLAG, 0x07);   // active -> nested clamp
  m.mem.write8(PLAYER_SEGMENT, 0xff);   // != the folded $2a -> ccb5 fires
}

test("CRAFTED: $0111 active -- nested cap + sign-flip saturation of $2c", () => {
  const o = new Machine(ROM, OPTS); seedNested(o);
  const c = new Machine(ROM, OPTS); seedNested(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the nested-clamp path");
});

test("CRAFTED: ccb5 active -- $05 bit7 SET + $2a != $0200 opens the gate; $31/$32 seated", () => {
  const seedCcb5 = (m) => { seedNested(m); m.regs.y = 0x5a; };
  const o = new Machine(ROM, OPTS); seedCcb5(o);
  const c = new Machine(ROM, OPTS); seedCcb5(c);
  oracle(o); rotateBlasterAroundRim(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the ccb5-active path");
  assert.equal(c.mem.read8(loc_31), 0x07, "$31 = X = $0111 seated by the open sound gate");
  assert.equal(c.mem.read8(loc_32), 0x5a, "$32 = entry Y seated by the open sound gate");
  assert.equal(o.mem.read8(loc_31), 0x07, "oracle agrees $31 seated");
  assert.equal(o.mem.read8(loc_32), 0x5a, "oracle agrees $32 seated");
});

test("STALE-Y: ccb5 path with Y passed explicitly and m.regs.y poisoned on the idiomatic side -- RAM equal", () => {
  const seedCcb5 = (m) => { seedNested(m); m.regs.y = 0x5a; };
  const o = new Machine(ROM, OPTS); seedCcb5(o);
  const c = new Machine(ROM, OPTS); seedCcb5(c);
  c.regs.y = 0xa5; // a stale register must not reach the sound loader's loc_32 stash
  oracle(o); rotateBlasterAroundRim(c, 0x5a);
  assert.equal(ramDiff(o, c), null, "RAM equal with the register poisoned");
});

test("STALE-Y-LOCKED: locked early return hands back the passed Y, not a poisoned register", () => {
  const seed = (m) => { m.mem.write8(PLAYER_FINE_ANGLE, 0x81); };
  const o = new Machine(ROM, OPTS); seed(o); o.regs.y = 0x5a; o.regs.x = 0x3c;
  const c = new Machine(ROM, OPTS); seed(c); c.regs.y = 0xa5; c.regs.x = 0xc3; // stale registers on the idiomatic side
  oracle(o); const [x, y] = rotateBlasterAroundRim(c, 0x5a, 0x3c);
  assert.equal(o.regs.y, 0x5a, "positive control: the oracle's locked exit left Y untouched");
  assert.equal(o.regs.x, 0x3c, "positive control: the oracle's locked exit left X untouched");
  assert.equal(o.mem.read8(PLAYER_FINE_ANGLE), 0x81, "positive control: the oracle took the locked early return");
  assert.equal(ramDiff(o, c), null, "RAM equal on the locked early return");
  assert.equal(y, o.regs.y, "returned exit Y = the oracle's Y");
  assert.equal(x, o.regs.x, "returned exit X = the oracle's X");
});

test("TEETH: a twin that skips the ccb5 gate diverges from the oracle", () => {
  const seedCcb5 = (m) => { seedNested(m); m.regs.y = 0x5a; };
  const o = new Machine(ROM, OPTS); seedCcb5(o);
  const c = new Machine(ROM, OPTS); seedCcb5(c);
  oracle(o);
  // BUG: identical fold but the ccb5 call (the open sound gate seating $31/$32) is skipped.
  const broken = (m) => {
    const { mem8 } = m;
    if (mem8[PLAYER_FINE_ANGLE] & 0x80) return;
    let a = mem8[SPINNER_ACCUM];
    if ((a & 0x80) === 0) { if (a >= 0x1f) a = 0x1f; } else if (a < 0xe1) a = 0xe1;
    mem8[SPINNER_ACCUM] = 0x00;
    mem8[loc_2b] = a;
    let cc = (((a ^ 0xff) + mem8[RIM_ROT_OFFSET] + 1) & 0xff);
    mem8[COORD_LIST_PTR_LO] = cc;
    if (cc >= 0xf0) { cc = 0xef; mem8[COORD_LIST_PTR_LO] = cc; }
    if ((cc ^ mem8[loc_2b]) & 0x80 && (cc ^ mem8[RIM_ROT_OFFSET]) & 0x80) mem8[COORD_LIST_PTR_LO] = mem8[RIM_ROT_OFFSET] & 0x80 ? 0xef : 0x00;
    const hi = mem8[COORD_LIST_PTR_LO] >> 4;
    mem8[loc_2a] = hi;
    mem8[loc_2b] = (hi + 1) & 0x0f;
    /* BUG: no cueRimRotationSound call -- $31/$32 never seated */
    mem8[PLAYER_SEGMENT] = mem8[loc_2a];
    mem8[PLAYER_FINE_ANGLE] = mem8[loc_2b];
    mem8[RIM_ROT_OFFSET] = mem8[COORD_LIST_PTR_LO];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped ccb5 gate");
});

test("TEETH: a wrong positive-clamp constant diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x80);
    m.mem.write8(SPINNER_ACCUM, 0x40);
    m.mem.write8(RIM_ROT_OFFSET, 0x03);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    if (mem8[PLAYER_FINE_ANGLE] & 0x80) return;
    let a = mem8[SPINNER_ACCUM];
    if ((a & 0x80) === 0) { if (a >= 0x1f) a = 0x2f; } else if (a < 0xe1) a = 0xe1; // BUG: 0x2f not 0x1f
    mem8[SPINNER_ACCUM] = 0x00;
    mem8[loc_2b] = a;
    const cc = (((a ^ 0xff) + mem8[RIM_ROT_OFFSET] + 1) & 0xff);
    mem8[COORD_LIST_PTR_LO] = cc;
    const hi = mem8[COORD_LIST_PTR_LO] >> 4;
    mem8[loc_2a] = hi;
    mem8[loc_2b] = (hi + 1) & 0x0f;
    mem8[PLAYER_SEGMENT] = mem8[loc_2a];
    mem8[PLAYER_FINE_ANGLE] = mem8[loc_2b];
    mem8[RIM_ROT_OFFSET] = mem8[COORD_LIST_PTR_LO];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong clamp constant");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
  m.mem.write8(STATUS_FLAGS, 0x80);
  m.mem.write8(SPINNER_ACCUM, 0x40);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, rotateBlasterAroundRim, TARGET, m);
  assert.equal(r.placeable, true, `rotateBlasterAroundRim must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
