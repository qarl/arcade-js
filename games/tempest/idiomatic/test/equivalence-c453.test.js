// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for snapCoordUpToReference (ROM 0xc453-0xc471) -- when $5b==0 and $57 sits less than 0x0c above $5f,
// set $57 = $5f + 0x0f (capped at 0xf0); otherwise leave $57 alone. Live-out is memory only ($57), so each
// side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: it omits the ROM
// ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP. No POKEY/clock read.
// Run: node --test games/tempest/idiomatic/test/equivalence-c453.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c453 } from "../../translated/loc_c453.js";
import { snapCoordUpToReference } from "../snapCoordUpToReference.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { OBJ_DEPTH, DEPTH_LO, DEPTH_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc453;
const oracle = atEntry(loc_c453);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

const seed = (m, guard, m57, m5f) => {
  m.mem.write8(DEPTH_LO, guard);
  m.mem.write8(OBJ_DEPTH, m57);
  m.mem.write8(DEPTH_HI, m5f);
};
// [guard, $57, $5f]: guarded, far-above (no bump), below (bump), close-above (bump), clamp ceiling.
const CASES = [
  [0x01, 0x40, 0x40], [0x00, 0x80, 0x40], [0x00, 0x20, 0x40],
  [0x00, 0x48, 0x40], [0x00, 0xf5, 0xf5], [0x00, 0xe8, 0xe1],
];

test("CAPTURE: real 0xc453 dispatches -- snapCoordUpToReference == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); snapCoordUpToReference(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: guard/window/clamp branches all match the oracle in RAM", () => {
  for (const [g, s57, s5f] of CASES) {
    const o = new Machine(ROM, OPTS); seed(o, g, s57, s5f);
    const c = new Machine(ROM, OPTS); seed(c, g, s57, s5f);
    oracle(o); snapCoordUpToReference(c);
    const label = `g=${g} $57=0x${s57.toString(16)} $5f=0x${s5f.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM diverged: ${label}`);
    assert.equal(c.mem.read8(OBJ_DEPTH), o.mem.read8(OBJ_DEPTH), `$57 diverged: ${label}`);
  }
});

test("TEETH: a twin that never applies the 0xf0 cap diverges from the oracle", () => {
  const [g, s57, s5f] = [0x00, 0xff, 0xff]; // below+within window -> bump; sum 0x10e must clamp to 0xf0
  const o = new Machine(ROM, OPTS); seed(o, g, s57, s5f);
  const c = new Machine(ROM, OPTS); seed(c, g, s57, s5f);
  oracle(o);
  const broken = (m) => { m.mem8[OBJ_DEPTH] = (m.mem8[DEPTH_HI] + 0x0f) & 0xff; }; // BUG: no ceiling -> 0x0e
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing 0xf0 cap");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, snapCoordUpToReference, TARGET, m);
  assert.equal(r.placeable, true, `snapCoordUpToReference must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
