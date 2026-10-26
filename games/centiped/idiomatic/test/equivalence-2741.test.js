// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2741 (ROM 0x2741) -- the per-tick spider/flea spawn-and-move spine. It gates
// on the object flags $c1/$c2 and the pending flags $ee/$ef; when idle it kicks a fresh screen/wave, else
// it lays status rows, folds an input bit into the phase accumulator $9a, advances the spawn-column
// counter $c0, and on a full cycle either re-arms a slot or (spawn pending) drives the whole respawn
// sequence. Live-out is RAM plus write-only side latches (not in dumpState). Each side runs on a clone;
// the contract is RAM (dumpState, minus stack scratch below the entry SP, to 0x40 under it,
// where the oracle's sub-calls scribble). The respawn sub-chain reads $100A (POKEY RANDOM) via the dissolved 0x231f/0x21c7/
// 0x20e8, whose value is clock-derived, so the crafted arm idles the poly counter (pokeyC0 null -> $100A
// is the constant t[0]) and pins the inputs; real boot dispatches early-exit before any RNG read.
// Run: node --test games/centiped/idiomatic/test/equivalence-2741.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2741 as oracleRom } from "../../translated/loc_2741.js";
import { loc_2741 } from "../loc_2741.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry, deadStackDeepAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2741;

function capDiff(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackDeepAtEntry(0x40, ma, mb));
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any gap */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 3000) : [];

test("CAPTURE: real 0x2741 dispatches -- loc_2741 == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x2741 at least once");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_2741(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A real entry, mutated to reach one branch. Poly counter idled and inputs pinned so the RNG reads on the
// respawn chain and the IN1 phase-bit fold are deterministic across both sides.
function craft(cap, mut) {
  const m = cap.clone();
  m.io.pokeyC0 = null;
  m.io.in1 = 0;
  m.io.inputAssert = null;
  mut(m);
  return m;
}

test("CRAFTED: every branch of the spawn spine matches the oracle (RAM -stack)", () => {
  const cases = [
    // both object flags negative -> the top gate returns at once.
    { name: "top gate (early return)", mut: (m) => { m.mem8[0xc1] = 0x80; m.mem8[0xc2] = 0x80; } },
    // idle (no object, spawn slot ready, no pending) -> fresh screen/wave kick, then the body.
    { name: "idle kick", mut: (m) => { m.mem8[0xc1] = 0; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; } },
    // active slot with high bits set -> the status-glyph block runs.
    { name: "status glyph block", mut: (m) => { m.mem8[0xc1] = 1; m.mem8[0xc2] = 1; m.mem8[0x89] = 0x06; } },
    // idle sets the pending flag; phase 0x0c rols to 0x18 with c0>=2 -> the full respawn chain (RNG).
    { name: "respawn chain", mut: (m) => { m.mem8[0xc1] = 0; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; m.mem8[0x9a] = 0x0c; m.mem8[0xc0] = 2; } },
    // as above but $c1 negative routes the respawn into the snapshot/object-mover tail.
    { name: "respawn -> snapshot tail", mut: (m) => { m.mem8[0xc1] = 0x80; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; m.mem8[0x9a] = 0x0c; m.mem8[0xc0] = 2; } },
    // phase 0x0c rols to 0x18 with c0 below the wrap -> the slot re-arm path, then the object tail.
    { name: "cycle slot re-arm", mut: (m) => { m.mem8[0xc1] = 1; m.mem8[0xc2] = 1; m.mem8[0xee] = 0; m.mem8[0x9a] = 0x0c; m.mem8[0xc0] = 0; } },
    // object tail on a zero low-3-bit frame, negative homing delta -> the negate branch.
    { name: "object tail, negate delta", mut: (m) => { m.mem8[0xc1] = 1; m.mem8[0xc2] = 1; m.mem8[0x9a] = 0; m.mem8[0x01] = 5; m.mem8[0x00] = 0; m.mem8[0xb9] = 0x90; } },
    // object tail, non-negative delta -> the pass-through branch.
    { name: "object tail, positive delta", mut: (m) => { m.mem8[0xc1] = 1; m.mem8[0xc2] = 1; m.mem8[0x9a] = 0; m.mem8[0x01] = 5; m.mem8[0x00] = 0; m.mem8[0xb9] = 0x10; } },
  ];
  for (const { name, mut } of cases) {
    const o = craft(CAPS[0], mut), c = craft(CAPS[0], mut);
    oracle(o); loc_2741(c);
    assert.equal(capDiff(o, c), null, name);
  }
});

// The main loop's `bpl $2015` after this call reads loc_2741's exit N-flag: N set (both slots idle, the top
// gate) -> run the full frame chain; N clear (spawn work done) -> skip it. Memory-eq is BLIND to that live-out
// (it escaped as a chain-skip bug), so assert the idiomatic return tracks the oracle's exit N across branches.
test("N-TOOTH: the frame-chain gate return matches the oracle's exit N-flag", () => {
  const cases = [
    { name: "top gate -> chain runs (N set)", mut: (m) => { m.mem8[0xc1] = 0x80; m.mem8[0xc2] = 0x80; } },
    { name: "idle kick -> chain skipped (N clear)", mut: (m) => { m.mem8[0xc1] = 0; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; } },
    { name: "respawn chain -> chain skipped", mut: (m) => { m.mem8[0xc1] = 0; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; m.mem8[0x9a] = 0x0c; m.mem8[0xc0] = 2; } },
    { name: "object tail -> chain skipped", mut: (m) => { m.mem8[0xc1] = 1; m.mem8[0xc2] = 1; m.mem8[0x9a] = 0; m.mem8[0x01] = 5; m.mem8[0x00] = 0; m.mem8[0xb9] = 0x10; } },
  ];
  for (const { name, mut } of cases) {
    const o = craft(CAPS[0], mut), c = craft(CAPS[0], mut);
    oracle(o);
    const ret = loc_2741(c);
    assert.equal(!!ret, o.regs.fN, `exit-N mismatch: ${name}`);
  }
  // TEETH: a twin that always reports "chain runs" must diverge from the oracle's N on a spawn-processing exit.
  const mut = (m) => { m.mem8[0xc1] = 0; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; };
  const o = craft(CAPS[0], mut);
  oracle(o);
  assert.notEqual(true, o.regs.fN, "the N tooth cannot fail (a spawn exit must leave N clear)");
});

test("TEETH: a twin that skips the column-counter advance diverges in RAM", () => {
  const mut = (m) => { m.mem8[0xc1] = 1; m.mem8[0xc2] = 1; m.mem8[0xee] = 0; m.mem8[0x9a] = 0x0c; m.mem8[0xc0] = 0; };
  const o = craft(CAPS[0], mut), c = craft(CAPS[0], mut);
  oracle(o);
  loc_2741(c);
  c.mem8[0x8e] = (c.mem8[0x8e] - 1) & 0xff; // BUG: as if the `inc $8e` on the re-arm path never ran
  const d = capDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a skipped counter advance");
});

test("SP-TOOTH: the spine (with its retained sub-calls) is seam-placeable; an adrift twin is refused", () => {
  // The respawn seed drives the retained push16/m.call sites (0x32fe, 0x2d5c) so the tooth sees real pushes.
  const seat = () => craft(CAPS[0], (m) => { m.mem8[0xc1] = 0x80; m.mem8[0xc2] = 0; m.mem8[0xee] = 0x80; m.mem8[0xef] = 0; m.mem8[0x9a] = 0x0c; m.mem8[0xc0] = 2; });
  const good = seamPlaceable(withOmittedRet, loc_2741, TARGET, seat());
  assert.equal(good.placeable, true, `loc_2741 must be seam-placeable; got: ${good.error}`);
  const adrift = (m) => { const rv = loc_2741(m); m.push16(0x0000); return rv; };
  const bad = seamPlaceable(withOmittedRet, adrift, TARGET, seat());
  assert.equal(bad.placeable, false, "the SP tooth FAILED to refuse an adrift stack (a dropped push16)");
  console.log("  SP-TOOTH: placeable, adrift twin refused");
});
