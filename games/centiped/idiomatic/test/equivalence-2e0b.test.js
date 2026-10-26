// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for steerHeadAndSeedVelocity (0x2e0b) -- the centipede head's per-tick steering:
// guard the orientation wrap at the top of the range, do nothing inside a narrow band, or (near the top
// of the position range, on the tick phase, for a young slot, when the RNG permits) re-seed the head and
// commit its velocity. A dispatching leaf: it dissolves to guardHeadOrientationWrap / returnNoop /
// seedWaveState directly and keeps a transient m.call into the velocity store; the seam completes it.
//
// The routine reads the POKEY RANDOM register, whose value is clock-derived and the one thing the
// clock-free layer cannot reproduce. Both sides read the SAME forced value (a constant, or the pinned
// origin t[0]), which isolates the routine's logic from that engine-level phase -- the accepted contract.
// Run: node --test games/centiped/idiomatic/test/equivalence-2e0b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e0b as oracleRom } from "../../translated/loc_2e0b.js";
import { steerHeadAndSeedVelocity } from "../steerHeadAndSeedVelocity.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_00, loc_40, loc_43, HEAD_VELOCITY_SEED, loc_60, loc_70, loc_80, loc_88, loc_9a, loc_ab, loc_b8, loc_ef, loc_f0,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2e0b;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const pinRng = (m) => { m.io.pokeyC0 = null; return m; };

// A fresh entry with the given cells and (optionally) the RANDOM register forced to a constant on both
// sides -- the reseed path only fires when the RNG's low two bits are clear, which pinned t[0] (0xff) is not.
function seed(cells, rng) {
  const m = new Machine(ROM);
  pinRng(m);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  for (const [addr, v] of Object.entries(cells)) m.mem.write8(Number(addr), v);
  if (rng !== undefined) m.io.pokeyRandom = () => rng;
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any gap */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x2e0b dispatches -- steerHeadAndSeedVelocity == oracle in RAM (-stack, RNG pinned)", () => {
  for (const cap of CAPS) {
    const o = pinRng(cap.clone());
    const c = pinRng(cap.clone());
    oracle(o); steerHeadAndSeedVelocity(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (RNG pinned to t[0])`);
});

test("CRAFTED: every branch (guard / commit / noop / reseed) == oracle", () => {
  const arms = [
    { tag: "orient >= 0x34 -> guard wrap", cells: { [loc_40]: 0x40, [loc_ef]: 0x00 } },
    { tag: "orient in [0x30,0x34) -> commit, live $43 reseeds wave", cells: { [loc_40]: 0x31, [loc_ef]: 0x00, [loc_43]: 0x01 } },
    { tag: "orient in [0x30,0x34) -> commit velocity (add, $ef==0)", cells: { [loc_40]: 0x31, [loc_ef]: 0x00, [loc_43]: 0x00, [loc_60]: 0x05, [HEAD_VELOCITY_SEED]: 0x03 } },
    { tag: "orient in [0x30,0x34) -> commit velocity (sub, $ef!=0)", cells: { [loc_40]: 0x31, [loc_ef]: 0x22, [loc_43]: 0x00, [loc_60]: 0x05, [HEAD_VELOCITY_SEED]: 0x03, [loc_f0]: 0x00, [loc_70]: 0x00 } },
    { tag: "orient < 0x30, position < 0xf8 -> noop", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0x00, [loc_f0]: 0x00 } },
    { tag: "position >= 0xf8 but tick phase busy -> noop", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x01 } },
    { tag: "slot too old ($9a >= 0x0b) -> noop", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x00, [loc_88]: 0x00, [loc_9a]: 0x0b }, rng: 0x00 },
    { tag: "RNG low bits set -> noop", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x00, [loc_88]: 0x00, [loc_9a]: 0x05 }, rng: 0x03 },
    { tag: "reseed (wide slot, +sign), then commit", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x00, [loc_88]: 0x00, [loc_9a]: 0x05, [loc_ab]: 0x08, [loc_43]: 0x00 }, rng: 0x00 },
    { tag: "reseed (wide slot, -sign)", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x00, [loc_88]: 0x00, [loc_9a]: 0x05, [loc_ab]: 0x08, [loc_43]: 0x00 }, rng: 0x80 },
    { tag: "reseed (narrow slot)", cells: { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x00, [loc_88]: 0x00, [loc_9a]: 0x05, [loc_ab]: 0x01, [loc_43]: 0x00 }, rng: 0x04 },
  ];
  for (const s of arms) {
    const o = seed(s.cells, s.rng);
    const c = seed(s.cells, s.rng);
    oracle(o); steerHeadAndSeedVelocity(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
  console.log("  CRAFTED: steerHeadAndSeedVelocity == oracle on all 11 arms");
});

test("TEETH: a skipped reseed store ($b8) is caught by the RAM diff", () => {
  const cells = { [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0xf8, [loc_f0]: 0x00, [loc_00]: 0x00, [loc_88]: 0x00, [loc_9a]: 0x05, [loc_ab]: 0x08, [loc_43]: 0x00, [loc_b8]: 0x00 };
  const o = seed(cells, 0x00);
  oracle(o);
  assert.equal(o.mem.read8(loc_b8), 0x14, "precondition: oracle armed $b8 on the reseed path");
  assert.notEqual(0x00, o.mem.read8(loc_b8), "the RAM diff FAILED to distinguish a skipped $b8 arm");
  console.log("  TEETH: the reseed $b8 arm carries a distinguishing value");
});

test("SP-TOOTH: the dispatching rewrite is seam-placeable, and a leaked push is refused", () => {
  const m = seed({ [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0x00, [loc_f0]: 0x00 }); // noop path, SP unmoved
  const r = seamPlaceable(withOmittedRet, steerHeadAndSeedVelocity, TARGET, m);
  assert.equal(r.placeable, true, `steerHeadAndSeedVelocity must be seam-placeable; got: ${r.error}`);
  const leaky = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, leaky, TARGET, seed({ [loc_40]: 0x00, [loc_ef]: 0x00, [loc_70]: 0x00, [loc_f0]: 0x00 }));
  assert.equal(bad.placeable, false, "the SP tooth FAILED to refuse a leaked push16");
  console.log("  SP-TOOTH: dispatching leaf placeable; leaked push refused");
});
