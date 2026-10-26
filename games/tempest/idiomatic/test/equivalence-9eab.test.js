// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for keepClimberFlipBitByDepth (ROM 0x9eab-0x9ed6) -- per-slot(x) bit6 keeper on $0283,x, gated by $0111.
// Writes memory only (A at RTS is incidental), so each side runs on a clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam completes it, so the
// arms compare RAM (-stack), NOT pc/SP. No POKEY/clock read.
// Run: node --test games/tempest/idiomatic/test/equivalence-9eab.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9eab } from "../../translated/loc_9eab.js";
import { keepClimberFlipBitByDepth } from "../keepClimberFlipBitByDepth.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { TUBE_GEOM_FLAG, ENEMY_SLOT_FLAGS, ENEMY_SEGMENT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9eab;
const oracle = atEntry(loc_9eab);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9eab dispatches -- keepClimberFlipBitByDepth == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); keepClimberFlipBitByDepth(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gate-off no-op; bit6-set clears at depth>=0x0e; bit6-clear sets at depth==0", () => {
  const X = 3;
  // [ gate, flag($0283,x), depth($02b9,x), expected flag ]
  const cases = [
    [0x00, 0x40, 0x20, 0x40], // gate off -> untouched
    [0x01, 0x40, 0x0e, 0x00], // bit6 set, depth 0x0e -> clear bit6
    [0x01, 0x40, 0x0d, 0x40], // bit6 set, depth 0x0d < 0x0e -> keep
    [0x01, 0x00, 0x00, 0x40], // bit6 clear, depth 0 -> set bit6
    [0x01, 0x00, 0x05, 0x00], // bit6 clear, depth != 0 -> keep clear
    [0x01, 0xbf, 0x0e, 0xbf], // bit6 already clear (0xbf), depth 0x0e -> unchanged (only sets on depth 0)
  ];
  for (const [gate, flag, depth, exp] of cases) {
    const seed = (m) => {
      m.mem.write8(TUBE_GEOM_FLAG, gate);
      m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, flag);
      m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, depth);
    };
    const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
    const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
    oracle(o); keepClimberFlipBitByDepth(c);
    assert.equal(ramDiff(o, c), null, `RAM equal: gate=${gate} flag=0x${flag.toString(16)} depth=0x${depth.toString(16)}`);
    assert.equal(c.mem.read8((ENEMY_SLOT_FLAGS + X) & 0xffff), exp, `flag result: gate=${gate} flag=0x${flag.toString(16)} depth=0x${depth.toString(16)}`);
  }
});

test("TEETH: a twin that always clears bit6 (ignores the depth test) diverges from the oracle", () => {
  const X = 3;
  const seed = (m) => {
    m.mem.write8(TUBE_GEOM_FLAG, 0x01);
    m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, 0x40);
    m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, 0x0d); // depth < 0x0e -> oracle KEEPS bit6
  };
  const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
  const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
  oracle(o);
  const broken = (m) => { m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, m.mem.read8((ENEMY_SLOT_FLAGS + X) & 0xffff) & 0xbf); }; // BUG: clear unconditionally
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the unconditional bit6 clear");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, keepClimberFlipBitByDepth, TARGET, m);
  assert.equal(r.placeable, true, `keepClimberFlipBitByDepth must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
