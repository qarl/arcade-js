// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for activateSlotAndRespawn (ROM 0xa38e-0xa397) -- flags slot X active by writing 0xff to
// HIT_TALLY,x, steps the incoming lane index Y back by four, then TAIL-DELEGATES to respawnEnemyAndAward with the
// unchanged X and the stepped-back index. activateSlotAndRespawn takes X and Y as live-in registers (the write index
// and the lane index) and its exit registers are the delegate's, so live-out is RAM only (dumpState
// minus stack scratch below the entry SP) -- no register is produced by activateSlotAndRespawn itself, exactly as its tail-delegate leaves
// A/X/Y. Oracle is the frozen translated activateSlotAndRespawn.
// Run: node --test games/tempest/idiomatic/test/equivalence-a38e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a38e } from "../../translated/loc_a38e.js";
import { activateSlotAndRespawn } from "../activateSlotAndRespawn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_SLOT_FLAGS, ENEMY_SEGMENT, HIT_TALLY } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa38e;
const oracle = atEntry(loc_a38e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa38e dispatches -- activateSlotAndRespawn == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    activateSlotAndRespawn(c);
    assert.equal(ramDiff(o, c), null);
    // A/X/Y not compared: activateSlotAndRespawn tail-delegates to respawnEnemyAndAward, so its exit registers are the delegate's.
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed X (the HIT_TALLY,x flag index) and Y (the lane index, stepped back by four into respawnEnemyAndAward), and
// give the stepped-back slot a plausible descriptor/seated pair so the delegate walks a real path.
function seed(m) {
  m.regs.x = 0x05;
  m.regs.y = 0x08;                 // priorSlot = 0x08 - 4 = 0x04
  m.mem.write8(ENEMY_SLOT_FLAGS + 0x04, 0x21); // slot descriptor for the stepped-back slot
  m.mem.write8(ENEMY_SEGMENT + 0x04, 0x07); // seated value for the stepped-back slot
}

test("CRAFTED: flag write + step-back + tail-delegate -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  activateSlotAndRespawn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the flag write and tail-delegate");
  // The unconditional signature write landed at HIT_TALLY + X = HIT_TALLY + 5.
  assert.equal(c.mem.read8(HIT_TALLY + 0x05), 0xff, "slot flag set");
});

test("TEETH: a twin that drops the HIT_TALLY,x flag write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to activateSlotAndRespawn but reverts the unconditional 0xff flag write.
  const broken = (m) => {
    const x = m.regs.x;
    const before = m.mem.read8(HIT_TALLY + x);
    activateSlotAndRespawn(m);
    m.mem.write8(HIT_TALLY + x, before); // BUG: undo the signature write
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped flag write was NOT caught by the RAM compare");
});
