// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceAttractToBoardBuildIfImageIntact (ROM 0x7071, Pooyan) — anti-tamper clone of advanceAttractSequenceToPlay.
 *
 * SEATING: BALANCED (plain ret / tail-calls) -> WIRE. Void handler: no register survives, LIVE-OUT is
 * memory only, comparison is RAM (dumpState) minus stack scratch below the entry SP. SP parked in STACK_SCRATCH so the
 * nested attract-step / word-lookup pushes drop out.
 *
 * Crafted paths (column integrity seeded intact so the row guard passes): the ANIM timer both ways
 * (skip vs call advanceAttractAnimationAndRepaint), always advanceFourObjectAnimsAndRebuildList, the SCRIPT_FRAME_TIMER ret, and the mid-block that seats
 * the next script pointer via fetchWordFromTableIndex then rets on the SCRIPT_COL_CHECK_TICK guard. The tail column
 * checksum (-> resetActorStateForBoard / resetToAttractScreenStart / blankRowThenFloodColorsAndAdvanceAttract) needs a matching (0x8f48) target block
 * and is left to those callees' own gates.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7071.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7071 as oracle } from "../../translated/loc_7071.js";
import { advanceAttractToBoardBuildIfImageIntact } from "../advanceAttractToBoardBuildIfImageIntact.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  HUD_INTEGRITY_STRIP_A,
  ANIM_FRAME_COUNTER,
  SCRIPT_FRAME_TIMER,
  ATTRACT_SUBSTATE,
  SCRIPT_COL_CHECK_TICK,
  SCRIPT_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the 11-cell integrity column equal (row guard passes) plus the timer cells this path reads. */
function seat(m, { anim = 0x03, frame = 0x03, tick = 0x02 } = {}) {
  m.regs.sp = SP0;
  for (let i = 0; i <= 10; i++) m.mem.write8(HUD_INTEGRITY_STRIP_A - i * 0x20, 0x00); // all equal
  m.mem.write8(ANIM_FRAME_COUNTER, anim);
  m.mem.write8(SCRIPT_FRAME_TIMER, frame);
  m.mem.write8(ATTRACT_SUBSTATE, 0x40);
  m.mem.write8(SCRIPT_COL_CHECK_TICK, tick);
  return m;
}

const CASES = {
  "anim skip, frame ret": (m) => seat(m, { anim: 0x03, frame: 0x03 }),
  "anim expiry -> advanceAttractAnimationAndRepaint, frame ret": (m) => seat(m, { anim: 0x01, frame: 0x03 }),
  "frame expiry -> mid-block, tick ret": (m) => seat(m, { anim: 0x03, frame: 0x01, tick: 0x02 }),
};

test("EQUAL: advanceAttractToBoardBuildIfImageIntact == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceAttractToBoardBuildIfImageIntact(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: timers tick; the mid-block reloads the frame timer and seats the script ptr", () => {
  const t = CASES["anim skip, frame ret"](BASE.clone());
  oracle(t);
  assert.equal(t.mem.read8(ANIM_FRAME_COUNTER), 0x02, "0x03 - 1 = 0x02");
  assert.equal(t.mem.read8(SCRIPT_FRAME_TIMER), 0x02, "0x03 - 1 = 0x02");

  const mid = CASES["frame expiry -> mid-block, tick ret"](BASE.clone());
  oracle(mid);
  assert.equal(mid.mem.read8(SCRIPT_FRAME_TIMER), 0x01, "frame timer reloaded to 0x01");
  assert.equal(mid.mem.read8(SCRIPT_COL_CHECK_TICK), 0x01, "0x02 - 1 = 0x01, rets before the checksum");
  console.log("  WRITE-SET: timers tick; mid-block reload + script ptr");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["frame expiry -> mid-block, tick ret"](BASE.clone());
  const c = CASES["frame expiry -> mid-block, tick ret"](BASE.clone());
  oracle(o);
  advanceAttractToBoardBuildIfImageIntact(c);
  c.mem.write8(SCRIPT_WRITE_PTR, (o.mem.read8(SCRIPT_WRITE_PTR) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, SCRIPT_WRITE_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the frame-timer decrement diverges", () => {
  const o = CASES["anim skip, frame ret"](BASE.clone());
  const c = CASES["anim skip, frame ret"](BASE.clone());
  oracle(o); // decrements SCRIPT_FRAME_TIMER 0x03 -> 0x02
  // twin: do nothing -> the seeded 0x03 survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped decrement must be caught by the RAM diff");
  console.log(`  TEETH(dec): caught at ${hx(d.addr ?? 0)}`);
});
