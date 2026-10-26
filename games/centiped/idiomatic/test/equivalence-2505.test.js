// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2505 (ROM 0x2505) -- a thin entry that tail-forwards to the segment
// sprite-table rebuild (0x231f) and returns. Live-out is RAM only; each side runs on a clone and the
// contract is RAM (dumpState, minus stack scratch below the entry SP, to 0x40 under it, where the
// oracle's sub-call scribbles). Since the body IS rebuildSegmentSpriteTables, the crafted arm drives the RNG
// fill loop with the poly counter idle (pokeyC0 null -> $100A constant on both sides).
// Run: node --test games/centiped/idiomatic/test/equivalence-2505.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2505 as oracleRom } from "../../translated/loc_2505.js";
import { loc_2505 } from "../loc_2505.js";
import { rebuildSegmentSpriteTables } from "../rebuildSegmentSpriteTables.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, markEntry, deadStackAtEntry, deadStackDeepAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2505;

// A per-cap diff that also excludes the page-1 window just below the entry SP, where the oracle's m.call chain
// leaves return-slot scribble the direct-call idiomatic layer does not.
function capDiff(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackDeepAtEntry(0x40, ma, mb));
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any gap */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x2505 dispatches -- loc_2505 == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x2505 at least once");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_2505(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Force the rebuild's RNG fill loop from a real entry: length counter 1 skips the descriptor loop and
// drops straight into the random-fill; the poly counter is idled so $100A is the constant t[0].
function craftFill(cap) {
  const m = cap.clone();
  m.io.pokeyC0 = null;
  m.mem8[0x88] = 0x00;      // object slot 0
  m.mem8[0x94] = 0xff;      // gate byte nonzero -> skip the counter refresh
  m.mem8[0x9a] = 0x01;      // length 1 -> descriptor loop skipped, fill loop entered
  m.mem8[0x9c] = 0x05;
  return m;
}

test("CRAFTED: the tail-forward drives the rebuild fill loop identically (RAM -stack)", () => {
  assert.ok(CAPS.length > 0);
  const o = craftFill(CAPS[0]), c = markEntry(craftFill(CAPS[0])), r = markEntry(craftFill(CAPS[0]));
  oracle(o);
  loc_2505(c);
  rebuildSegmentSpriteTables(r); // the forwarder must equal a direct call to its target
  assert.equal(capDiff(o, c), null, "loc_2505 vs oracle");
  assert.equal(firstStateDiff(c.dumpState(), r.dumpState(), (off) => c.stateOffsetToAddr(off), deadStackAtEntry(c, r)),
    null, "loc_2505 vs a direct rebuildSegmentSpriteTables");
});

test("TEETH: a twin that skips the rebuild diverges in RAM", () => {
  assert.ok(CAPS.length > 0);
  const o = craftFill(CAPS[0]), c = craftFill(CAPS[0]);
  oracle(o);
  // BUG: the forwarder does nothing (never calls the rebuild) -- the fill loop's writes are missing.
  const d = capDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a forwarder that skipped the rebuild");
});

test("SP-TOOTH: the tail-forward is seam-placeable (moved 0) and an adrift twin is refused", () => {
  assert.ok(CAPS.length > 0);
  const good = seamPlaceable(withOmittedRet, loc_2505, TARGET, CAPS[0].clone());
  assert.equal(good.placeable, true, `loc_2505 must be seam-placeable; got: ${good.error}`);
  // Null-mutant: an unbalanced push16 leaves SP adrift (the missing-push16 failure class) -> refused.
  const adrift = (m) => { const rv = loc_2505(m); m.push16(0x0000); return rv; };
  const bad = seamPlaceable(withOmittedRet, adrift, TARGET, CAPS[0].clone());
  assert.equal(bad.placeable, false, "the SP tooth FAILED to refuse an adrift stack");
  console.log("  SP-TOOTH: placeable, adrift twin refused");
});
