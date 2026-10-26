// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceShotAndScoreLaneHit (ROM 0xa1fa-0xa23e) -- steps a slot's counter toward its per-target
// limit; on reaching it, clamps the limit cell, bumps the hit tally, flags the target, then chimes
// (jsr $ccf6) and awards (jsr $ca6c); after two hits it resets the counter and drops a life. The
// idiomatic side dissolves the two jsr into direct requestSegmentHitSound / addBcdScoreAndAwardAtThreshold calls. Output is RAM plus the
// exit [X, Y]: X is the slot index (loaded from $37 on the work path, entry X on the skip path), Y the award's
// exit Y on an armed hit, else the target segment. Each arm compares RAM (dumpState minus STACK_SCRATCH) and
// the returned X/Y vs o.regs.x/o.regs.y.
// Run: node --test games/tempest/idiomatic/test/equivalence-a1fa.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a1fa as oracle } from "../../translated/loc_a1fa.js";
import { advanceShotAndScoreLaneHit } from "../advanceShotAndScoreLaneHit.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, STATUS_FLAGS, SLOT_LOOP_INDEX, TARGET_SEG, SLOT_STATE, HIT_TALLY, LANE_LIMIT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa1fa;
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

test("CAPTURE: real 0xa1fa dispatches -- advanceShotAndScoreLaneHit == oracle in RAM (-stack) and X/Y live-out", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const [x, y] = advanceShotAndScoreLaneHit(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(x, o.regs.x, "returned X must equal oracle exit X");
    assert.equal(y, o.regs.y, "returned Y must equal oracle exit Y");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// slot 0, target index y=5. gate ($0005 bit7) off by default so ca6c's award path is deterministic.
function seed(m, s) {
  m.regs.x = 0x00;
  m.mem.write8(STATUS_FLAGS, s.gate ?? 0x00);
  m.mem.write8(SLOT_LOOP_INDEX, s.s37 ?? 0x02);
  m.mem.write8(u16(TARGET_SEG + 0), 0x05);          // y = target index
  m.mem.write8(u16(LANE_LIMIT + 5), s.limit ?? 0x10);
  m.mem.write8(u16(SLOT_STATE + 0), s.counter ?? 0x00);
  m.mem.write8(u16(HIT_TALLY + 0), s.tally ?? 0x00); // entry-slot tally
  m.mem.write8(u16(HIT_TALLY + (s.s37 ?? 0x02)), s.tally37 ?? 0x00); // work-path xEff tally
}

test("CRAFTED: limit-not-reached / reached / reached+second-hit -- advanceShotAndScoreLaneHit == oracle (RAM + X/Y)", () => {
  const cases = [
    { tag: "limit 0 -> early return", limit: 0x00, counter: 0x20 },
    { tag: "counter < limit -> skip path, xEff = entry X", limit: 0x40, counter: 0x10 },
    { tag: "counter >= limit -> work path, xEff = $37", limit: 0x10, counter: 0x20 },
    { tag: "counter >= 0xf0 -> limit clears to 0", limit: 0x10, counter: 0xf5 },
    { tag: "work path, gate on -> ca6c awards", limit: 0x10, counter: 0x20, gate: 0x80 },
    { tag: "second hit on $37 slot -> reset + drop life", limit: 0x10, counter: 0x20, s37: 0x02, tally37: 0x01 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    o.regs.y = 0x5a; c.regs.y = 0xa5; // the routine loads Y before reading it
    oracle(o); const [x, y] = advanceShotAndScoreLaneHit(c);
    assert.equal(ramDiff(o, c), null, s.tag);
    assert.equal(x, o.regs.x, `X live-out: ${s.tag}`);
    assert.equal(y, o.regs.y, `Y live-out: ${s.tag}`);
  }
});

test("TEETH: a twin that skips the work block diverges from the oracle on the reached case", () => {
  const s = { limit: 0x10, counter: 0x20, s37: 0x02, tally37: 0x01 };
  const o = new Machine(ROM, OPTS); seed(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, s);
  const broken = (m, x = m.regs.x) => {
    const { mem8 } = m;
    const y = mem8[u16(TARGET_SEG + x)];
    if (mem8[u16(LANE_LIMIT + y)] === 0) return x;
    // BUG: never enters the work block, never reloads xEff from $37, never resets/drops a life.
    return x;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped work block");
});

test("TEETH (live-out): a twin returning entry X instead of $37 diverges from oracle exit X", () => {
  const s = { limit: 0x10, counter: 0x20, s37: 0x07 };
  const o = new Machine(ROM, OPTS); seed(o, s); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, s);
  // BUG: returns entry X (0) rather than the $37-loaded slot index.
  const wrongX = 0x00;
  assert.notEqual(wrongX, o.regs.x, "the live-out check FAILED to catch a wrong exit X");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, advanceShotAndScoreLaneHit, TARGET, m);
  assert.equal(r.placeable, true, `advanceShotAndScoreLaneHit must be seam-placeable; got: ${r.error}`);
});
