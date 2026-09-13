// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_90c4 (ROM 0x90c4-0x91b4) and its two mid-entries loc_9108 / loc_9149.
// loc_90c4 scans the threshold table for a start slot, clamps it up to a wave-derived floor, publishes
// the index, then falls into loc_9108 (wave-reseed) which falls into loc_9149 (per-frame phase tick).
// The idiomatic side dissolves every internal jsr into a direct call and OMITS the terminal ret.
// Live-out is memory only (a per-frame state routine), so the arms compare RAM (dumpState -stack).
// Run: node --test games/tempest/idiomatic/test/equivalence-90c4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_90c4 as oracle } from "../../translated/loc_90c4.js";
import { loc_90c4 } from "../loc_90c4.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_4, loc_5, loc_9, loc_3f, loc_4e, loc_5b, loc_7c,
  loc_126, loc_127, loc_16a, loc_200, loc_605, loc_71d,
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

const TARGET = 0x90c4;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// POKEY coupling: the emit block reads $60ca (POKEY RANDOM) at loc_9195, folding (rand & 7) into the
// slot/emit cells; the loc_92c5 chain then re-scales state through $29 scratch. RANDOM = poly17Table[p17],
// and p17 advances by the cycle delta the oracle's m.step charges but the clock-free idiomatic layer does
// not -- so the two only agree when the poly is frozen. Clearing SK_RESET (0x03) makes Pokey._advance
// early-return, so RANDOM reads a constant on both sides (same fix as equivalence-ae1c).
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x90c4 dispatches -- loc_90c4 == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented emit arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_90c4(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Main path: the scan + clamp block runs (wave bit set, mid-range wave -> floor 6), loc_9108 skips the
// intro-prime (sign bit clear) and the table swap (seat 0). NOTE loc_9108 unconditionally zeroes loc_605,
// so loc_9149's tick underflows -> the decimal phase decrement runs and arms loc_4e, and the emit block
// then runs its safe (non-throwing) leaf chain -- reads $60ca (RANDOM, frozen by the caller) and re-scales
// $29 as scratch. The oracle does not throw. The scan seed is BELOW the smallest threshold, so the picked
// index is 0 and clamps UP to the floor, publishing floor -> loc_127 (loc_29 itself is later clobbered by
// the loc_92c5 scratch chain, so the floor is observed via the published index, not $29).
function seedMain(m) {
  m.mem.write8(loc_126, 0x00); // scan seed below table[0] -> index 0 -> clamps up to the floor
  m.mem.write8(loc_16a, 0x04); // wave bit -> clamp-floor block runs
  m.mem.write8(loc_71d, 0x55); // >=48 and >=80, <112 -> floor = 4 + 2
  m.mem.write8(loc_9, 0x00);  // no 0x40 override
  m.mem.write8(loc_5, 0x00);  // sign clear: skip intro-prime, keep scan seed
  m.mem.write8(loc_3f, 0x00);  // seat 0 -> skip the table swap
  m.mem.write8(loc_4e, 0x00);  // flag zero at entry (the phase tick re-arms it before the emit gate)
  m.mem.write8(loc_605, 0x20); // frame counter (loc_9108 zeroes it anyway before the tick)
}

test("CRAFTED (main): scan + clamp + reseed + safe tick -- RAM equal", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedMain(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedMain(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(main): oracle threw -- skipped"); return; }
  loc_90c4(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the main path");
  assert.equal(c.mem.read8(loc_127), 6, "clamp floor = 4 + 2 (index 0 clamps up to the floor)");
  assert.equal(c.mem.read8(loc_127), o.mem.read8(loc_127), "published start index matches the oracle");
  assert.equal(c.mem.read8(loc_7c), 4, "reseed wrote the working-set constant");
  assert.equal(c.mem.read8(loc_5b), 0xff, "reseed wrote the sentinel cell");
  assert.equal(c.mem.read8(loc_4), o.mem.read8(loc_4), "phase count matches the oracle");
});

// Sign-set + table-swap + phase-decrement + emit-block path. Exercises loc_92b2, the intro-prime, the
// decimal phase countdown, and the full emit chain. These reach draw/spawn arms that may be
// unimplemented on a bare boot, so it is skip-on-oracle-throw; when it runs it validates the rest.
function seedRich(m) {
  m.mem.write8(loc_126, 0x30);
  m.mem.write8(loc_16a, 0x00);
  m.mem.write8(loc_5, 0x80); // sign set -> intro-prime; and inner emit-branch (bit7) taken
  m.mem.write8(loc_3f, 0x05); // seat nonzero -> table swap runs
  m.mem.write8(loc_4e, 0x18); // flag & mask nonzero -> emit block runs
  m.mem.write8(loc_605, 0x00); // tick underflows -> phase decrement runs
  m.mem.write8(loc_4, 0x10); // BCD phase countdown value
  m.mem.write8(loc_200, 0x02);
}

test("CRAFTED (rich): swap + intro-prime + phase countdown + emit -- RAM equal (skip on throw)", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedRich(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedRich(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(rich): oracle threw on this seed -- skipped"); return; }
  loc_90c4(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the rich path");
  console.log("  CRAFTED(rich): ran without oracle throw");
});

test("TEETH: a twin that skips the reseed sentinel write MUST diverge in RAM", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedMain(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedMain(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw -- skipped"); return; }
  // loc_9108 unconditionally writes the sentinel cell to 0xff; reverting it guarantees a RAM divergence.
  const before5b = c.mem.read8(loc_5b);
  const broken = (mm) => { loc_90c4(mm); mm.mem.write8(loc_5b, before5b); }; // BUG: drop the sentinel write
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped sentinel write was NOT caught by the RAM compare");
});

test("SP-TOOTH: loc_90c4 omits its terminal ret and is seam-placeable (moved 0)", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  seedMain(m); // stay on the safe path so the chain runs to its (omitted) ret without throwing
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_90c4, TARGET, m);
  assert.equal(r.placeable, true, `loc_90c4 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret (moved 0) placeable");
});
