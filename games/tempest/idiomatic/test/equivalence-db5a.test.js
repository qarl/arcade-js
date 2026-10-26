// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for beginEaromSequenceIfIdle -- when both guard bytes ($01ca | $01c7) are clear it runs the walk
// seeder (armEaromReadback) and then stamps $7c <- $01c9 and $00 <- 0x02; if either guard is set it returns
// with no writes. Live-out is memory only (A at RTS is an incidental byproduct), so the arms compare
// RAM (dumpState, minus stack scratch below the entry SP). The seeder's own effects land in RAM on both sides.
// Run: node --test games/tempest/idiomatic/test/equivalence-db5a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db5a } from "../../translated/loc_db5a.js";
import { beginEaromSequenceIfIdle } from "../beginEaromSequenceIfIdle.js";
import { armEaromReadback } from "../armEaromReadback.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, SEG_SPREAD_A_LO_4, EAROM_REGION_PENDING, PENDING_WORK_FLAGS, EAROM_MODE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdb5a;
const oracle = atEntry(loc_db5a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xdb5a dispatches -- beginEaromSequenceIfIdle == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); beginEaromSequenceIfIdle(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: guards clear -- seeder runs and $7c <- $01c9, $00 <- 0x02", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_MODE, 0x00);
    m.mem.write8(EAROM_REGION_PENDING, 0x00);
    m.mem.write8(PENDING_WORK_FLAGS, 0x77);
    m.mem.write8(SEG_SPREAD_A_LO_4, 0x11);
    m.mem.write8(GAME_MODE, 0x55);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); beginEaromSequenceIfIdle(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO_4), 0x77, "$7c <- $01c9");
  assert.equal(c.mem.read8(GAME_MODE), 0x02, "$00 <- 0x02");
});

test("CRAFTED: a guard set -- early return, $7c and $00 untouched", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_MODE, 0x40); // guard set
    m.mem.write8(EAROM_REGION_PENDING, 0x00);
    m.mem.write8(PENDING_WORK_FLAGS, 0x77);
    m.mem.write8(SEG_SPREAD_A_LO_4, 0x11);
    m.mem.write8(GAME_MODE, 0x55);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); beginEaromSequenceIfIdle(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after early return");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO_4), 0x11, "$7c untouched");
  assert.equal(c.mem.read8(GAME_MODE), 0x55, "$00 untouched");
});

test("TEETH: a twin that skips the $7c store (non-default seed) diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_MODE, 0x00);
    m.mem.write8(EAROM_REGION_PENDING, 0x00);
    m.mem.write8(PENDING_WORK_FLAGS, 0x77);
    m.mem.write8(SEG_SPREAD_A_LO_4, 0x11); // non-default so the skipped store shows
    m.mem.write8(GAME_MODE, 0x55);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    if ((m.mem8[EAROM_MODE] | m.mem8[EAROM_REGION_PENDING]) !== 0) return;
    armEaromReadback(m);
    m.mem8[GAME_MODE] = 0x02; // BUG: never stores $7c
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $7c store");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, beginEaromSequenceIfIdle, TARGET, m);
  assert.equal(r.placeable, true, `beginEaromSequenceIfIdle must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller placeable");
});
