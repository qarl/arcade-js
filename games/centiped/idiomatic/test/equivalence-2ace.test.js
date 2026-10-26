// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2ace (ROM 0x2ace) vs the frozen translated oracle. A gated axis-delta
// integrator: unless the enable $86 is negative or the $43 control bits are set, it snapshots $73 into $8d,
// swaps $b9 with $fe, dissolves clampAndHalveSignedDelta on the old $b9, accumulates the halved magnitude
// into $84, and falls through into the companion integrator (loc_2aeb, kept as an m.call the merge dissolves)
// with A = the halved delta and the accumulate carry live. On the two early-out branches it just RTSs.
//
// Two exit shapes, both seam-placeable: the early-out omits its ROM ret (SP unmoved -> the seam rets), the
// fall-through reaches the ret via the companion's tail-transfer (SP +2, pc on the caller slot). The clock is
// frozen to a constant origin so any POKEY read down the dispatched chain is deterministic on both sides.
// Run: node --test games/centiped/idiomatic/test/equivalence-2ace.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ace as oracleRom } from "../../translated/loc_2ace.js";
import { loc_2ace as integrate } from "../loc_2ace.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_43, loc_73, MOVE_SUBSTEP_ACCUM_A, loc_86, loc_8d, loc_b9, loc_fe } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2ace;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function pinClock(m) {
  m.mem.clock = () => 0;
  m.io.pokeyC0 = null;
  m.io.pokeyLastAccess = 0;
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(12, 4000) : [];

function seed({ m86 = 0x10, m43 = 0x00, m73 = 0x22, mfe = 0x44, mb9 = 0x90, m84 = 0x10 } = {}) {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x0100 | ((0xfb + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfb + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.mem.write8(loc_86, m86);
  m.mem.write8(loc_43, m43);
  m.mem.write8(loc_73, m73);
  m.mem.write8(loc_fe, mfe);
  m.mem.write8(loc_b9, mb9);
  m.mem.write8(MOVE_SUBSTEP_ACCUM_A, m84);
  return pinClock(m);
}

test("CAPTURE: real 0x2ace dispatches -- loc_2ace == oracle in RAM (-stack, clock pinned)", () => {
  for (const cap of CAPS) {
    const o = pinClock(cap.clone());
    const c = pinClock(cap.clone());
    oracle(o);
    integrate(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (clock pinned)`);
});

test("CRAFTED: both early-outs and the fall-through integrator == oracle", () => {
  const cases = [
    { tag: "enable negative -> RTS", m86: 0x80 },
    { tag: "control bits set -> RTS", m86: 0x10, m43: 0x01 },
    { tag: "fall-through, mid-range delta", m86: 0x10, m43: 0x00, mb9: 0x90, m84: 0x10 },
    { tag: "fall-through, low delta (rail)", m86: 0x10, m43: 0x00, mb9: 0x05, m84: 0x00 },
    { tag: "fall-through, high delta + carry-out", m86: 0x10, m43: 0x00, mb9: 0xf9, m84: 0xf0 },
    { tag: "control masked bit outside 0xaf clears", m86: 0x10, m43: 0x50, mb9: 0x30 },
  ];
  for (const s of cases) {
    const o = seed(s);
    const c = seed(s);
    oracle(o);
    integrate(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
  console.log("  CRAFTED: loc_2ace == oracle on 6 arms (both exit shapes)");
});

test("TEETH: a dropped $84 accumulate is caught by the RAM diff", () => {
  // mb9 must be odd at 3226's exit (below 0x08 or >=0xf8 -- in-range deltas quantize to even 0x08/0xf8 and
  // the carry-pack A is 0x00, so the accumulate adds nothing). 0x07 keeps its odd value -> A=0x80 -> $84 moves.
  const s = { m86: 0x10, m43: 0x00, mb9: 0x07, m84: 0x10 };
  const o = seed(s);
  const c = seed(s);
  oracle(o);
  integrate(c);
  assert.equal(ramDiff(o, c), null, "precondition: loc_2ace matches the oracle on the fall-through");
  assert.notEqual(o.mem.read8(MOVE_SUBSTEP_ACCUM_A), s.m84, "oracle accumulated into $84");
  c.mem8[MOVE_SUBSTEP_ACCUM_A] = s.m84; // BUG: never accumulated the halved delta into $84
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped $84 accumulate");
  assert.equal(d.addr, MOVE_SUBSTEP_ACCUM_A, "diff should be at the $84 accumulator");
  console.log("  TEETH: dropped-accumulate twin caught at $84");
});

test("SP-TOOTH: the fall-through tail-dispatch places; a net-adrift push pair is refused", () => {
  const r = seamPlaceable(withOmittedRet, integrate, TARGET, seed({ m86: 0x10, m43: 0x00, mb9: 0x90 }));
  assert.equal(r.placeable, true, `seam refused the tail-dispatch body: ${r.error}`);
  // This is a +2 tail-dispatcher (the companion chain's RTS pops the caller slot), so a SINGLE stray push
  // nets to moved 0 and would place vacuously; TWO unmatched pushes leave SP net -2 (moved 0xfe) -> refused.
  const strayPush = (m) => { integrate(m); m.push16(0x9999); m.push16(0x9999); };
  const rm = seamPlaceable(withOmittedRet, strayPush, TARGET, seed({ m86: 0x10, m43: 0x00, mb9: 0x90 }));
  assert.equal(rm.placeable, false, "the stray-push mutant placed at the seam (tooth has no teeth)");
  console.log("  SP-TOOTH: tail-dispatch body placeable; stray-push mutant refused");
});
