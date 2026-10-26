// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceLevelCounter -- from the $4e gate and a >=2 test on $06, derives a 0..2 step, subtracts
// it from $06, and either seeds intro cells (gate clear) or sets status bits, zeroes cells, bumps a 16-bit
// tally at $040c,x and clamps $0100. Live-out is memory only, so each side runs on a clone and the contract
// is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-c81b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c81b } from "../../translated/loc_c81b.js";
import { advanceLevelCounter } from "../advanceLevelCounter.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, MODE_DELAY_TIMER, STATUS_FLAGS, PHASE_COUNTER, HEARTBEAT_ACCUM_LO, HEARTBEAT_ACCUM_OVERFLOW, ACTIVE_SLOT_COUNT, INPUT_EDGE_FLAGS, SPINNER_ACCUM, loc_100, SPIKED_SEGMENT_COUNT, COORD_ACC_LO, COORD_ACC_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc81b;
const oracle = atEntry(loc_c81b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// gate=0x60, $06=5 -> step=2; $05=0 -> |0xc0; x clamps to 3; $040f++; $0100=0x10+1+1=0x12
const seed = (m) => {
  m.mem.write8(INPUT_EDGE_FLAGS, 0x60);
  m.mem.write8(PHASE_COUNTER, 0x05);
  m.mem.write8(STATUS_FLAGS, 0x00);
  m.mem.write8(HEARTBEAT_ACCUM_LO, 0x77); m.mem.write8(HEARTBEAT_ACCUM_OVERFLOW, 0x77); m.mem.write8(GAME_MODE, 0x77);
  m.mem.write8(COORD_ACC_LO + 3, 0x00); m.mem.write8(COORD_ACC_HI + 3, 0x00);
  m.mem.write8(loc_100, 0x10);
};

test("CAPTURE: real 0xc81b dispatches -- advanceLevelCounter == oracle in RAM (-stack) + exit X/Y", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o);
    const [rx, ry] = advanceLevelCounter(c);
    assert.equal(ramDiff(o, c), null);
    // Live-out: the module's returned [X,Y] equal the oracle's registers at RTS.
    assert.equal(rx, o.regs.x, "exit X matches oracle register");
    assert.equal(ry, o.regs.y, "exit Y matches oracle register");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gate/step path sets $3e, $05|=0xc0, zeroes $16/$18/$00, bumps $040f, clamps $0100", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const [rx, ry] = advanceLevelCounter(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after step path");
  assert.equal(c.mem.read8(INPUT_EDGE_FLAGS), 0x00, "$4e cleared");
  assert.equal(c.mem.read8(PHASE_COUNTER), 0x03, "$06 -= 2");
  assert.equal(c.mem.read8(ACTIVE_SLOT_COUNT), 0x01, "$3e = step-1");
  assert.equal(c.mem.read8(STATUS_FLAGS), 0xc0, "$05 |= 0xc0");
  assert.equal(c.mem.read8(HEARTBEAT_ACCUM_LO), 0x00, "$16 cleared");
  assert.equal(c.mem.read8(COORD_ACC_LO + 3), 0x01, "$040f bumped");
  assert.equal(c.mem.read8(loc_100), 0x12, "$0100 clamped sum");
  // Live-out on the step=2 path: X = ldx #3 (step-1=1 -> 3), Y = step = 2.
  assert.equal(rx, o.regs.x, "exit X matches oracle register");
  assert.equal(ry, o.regs.y, "exit Y matches oracle register");
  assert.equal(rx, 0x03, "exit X = 0x03 on the step=2 path");
  assert.equal(ry, 0x02, "exit Y = step = 2");
});

test("TEETH-RET: a wrong exit-register model diverges from the oracle registers", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const [rx, ry] = advanceLevelCounter(c);
  // The real return matches the oracle's registers at RTS...
  assert.equal(rx, o.regs.x);
  assert.equal(ry, o.regs.y);
  // ...but a twin that returned entry X / Y=0 (forgetting the main-path work)
  // would be caught: on the step=2 path the real exit is X=3, Y=2.
  const wrongX = c.regs.x; // entry X (unchanged live-in), != main-path exit 3
  const wrongY = 0x00;     // pre-bump Y, != step 2
  assert.notEqual(wrongX, o.regs.x, "a stale entry-X return would be caught");
  assert.notEqual(wrongY, o.regs.y, "a pre-bump Y=0 return would be caught");
});

test("TEETH: a twin that clears $4e but skips the status block diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { m.mem8[INPUT_EDGE_FLAGS] = 0x00; }; // BUG: none of the step/status work
  broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped status block");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, advanceLevelCounter, TARGET, m);
  assert.equal(r.placeable, true, `advanceLevelCounter must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
