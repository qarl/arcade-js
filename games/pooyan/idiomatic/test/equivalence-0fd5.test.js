// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchMainLoopSubstate (ROM 0x0fd5) — the main-loop sub-state dispatcher. Selects one
 * of six handlers by (MAINLOOP_SUBSTATE_SELECTOR & 7) through the inline word table at 0x0fe3. States
 * 0/1 tail-hand to their handler; states 2..5 run the handler then the post-handler tail advanceObjectsAndRebuildSprites.
 * The module expresses the seated tail as a plain sequential call. Compared: RAM (dumpState −
 * stack scratch below the entry SP) against the frozen translated oracle.
 *
 * Jobs: CRAFTED routing (0..5 × seatings) vs the oracle, SP-TOOTH (tail dispatch seats cleanly),
 * GUARD-SLACK (6/7 raise), TEETH (dropped tail + mis-route caught).
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fd5.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_0fd5 as oracle } from "../../translated/loc_0fd5.js";
import { dispatchMainLoopSubstate } from "../dispatchMainLoopSubstate.js";
import { queueBonusStageTallyDisplayOnDelay } from "../queueBonusStageTallyDisplayOnDelay.js";
import { runActivePlayFrame } from "../runActivePlayFrame.js";
import { advanceObjectsAndRebuildSprites } from "../advanceObjectsAndRebuildSprites.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  MAINLOOP_SUBSTATE_SELECTOR,
  SUBSTATE_FIELD1_COUNTER,
  HUNTER_SPAWN_SUBCOUNTER,
  SUBSTATE_FIELD2_VALUE,
  SUBSTATE_FIELD3_VALUE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const TARGET = 0x0fd5;
const SP0 = 0x8fe0; // inside STACK_SCRATCH, so the dispatcher's stack traffic is excluded from the diff
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const ramDiffMinusStack = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), inDeadStack);
const runGuarded = (fn, m) => { try { fn(m); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; } };
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// Seatings exercise both countdown branches (counter zero → expire/advance; nonzero → tick) and give
// the HUD-repaint handler (state 3) non-trivial field values.
const SEATINGS = [
  ["counter=0", [[SUBSTATE_FIELD1_COUNTER, 0], [HUNTER_SPAWN_SUBCOUNTER, 3], [SUBSTATE_FIELD2_VALUE, 7], [SUBSTATE_FIELD3_VALUE, 2]]],
  ["counter=5", [[SUBSTATE_FIELD1_COUNTER, 5], [HUNTER_SPAWN_SUBCOUNTER, 12], [SUBSTATE_FIELD2_VALUE, 0x2a], [SUBSTATE_FIELD3_VALUE, 0]]],
  ["counter=1", [[SUBSTATE_FIELD1_COUNTER, 1], [HUNTER_SPAWN_SUBCOUNTER, 1], [SUBSTATE_FIELD2_VALUE, 0], [SUBSTATE_FIELD3_VALUE, 9]]],
];

function craft(state, seat) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, 0xfffc); // caller's seated continuation
  m.regs.hl = 0x1234; m.regs.a = 0xaa; m.regs.bc = 0xbeef; // poison: the module reads no register on entry
  m.mem8[MAINLOOP_SUBSTATE_SELECTOR] = state & 0xff;
  if (seat) for (const [addr, val] of seat) m.mem8[addr] = val;
  return m;
}

test("CRAFTED: each selector 0..5 routes identically to the oracle (states 2..5 include the advanceObjectsAndRebuildSprites tail)", () => {
  for (const state of [0, 1, 2, 3, 4, 5]) {
    for (const [label, seat] of SEATINGS) {
      const o = craft(state, seat); oracle(o);
      const c = craft(state, seat);
      const rc = runGuarded(dispatchMainLoopSubstate, c);
      assert.equal(rc.threw, false, `state ${state} [${label}]: module threw: ${rc.msg}`);
      const d = ramDiffMinusStack(o, c);
      assert.equal(d, null, d && `state ${state} [${label}]: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log("  CRAFTED: selectors 0..5 routed identically to the oracle");
});

test("SP-TOOTH: the tail dispatch is seam-placeable on a crafted state", () => {
  const r = seamPlaceable(withOmittedRet, dispatchMainLoopSubstate, TARGET, craft(2, SEATINGS[0][1]));
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: tail dispatch seats cleanly (SP net-zero)");
});

test("GUARD-SLACK: selectors whose low three bits are 6 or 7 (past the 6-entry table) raise", () => {
  for (const state of [0x06, 0x07, 0x0e, 0xff]) { // &7 -> 6,7,6,7
    assert.throws(() => dispatchMainLoopSubstate(craft(state, SEATINGS[0][1])), /guard-slack/, `selector ${hx(state)} must throw`);
  }
  console.log("  GUARD-SLACK: (selector & 7) of 6/7 raise");
});

test("TEETH: a dropped tail and a mis-route are both caught", () => {
  // (a) BUG: state 2 drops the advanceObjectsAndRebuildSprites tail — the seated-tail-drop the oracle was fixed to avoid.
  const droppedTail = (m) => {
    switch (m.mem8[MAINLOOP_SUBSTATE_SELECTOR] & 7) {
      case 2: return queueBonusStageTallyDisplayOnDelay(m); // BUG: no advanceObjectsAndRebuildSprites
      default: return advanceObjectsAndRebuildSprites(m);
    }
  };
  {
    const o = craft(2, SEATINGS[0][1]); oracle(o);
    const c = craft(2, SEATINGS[0][1]);
    const rc = runGuarded(droppedTail, c);
    const caught = rc.threw || ramDiffMinusStack(o, c) !== null;
    assert.equal(caught, true, "the gate FAILED to catch a dropped advanceObjectsAndRebuildSprites tail");
  }
  // (b) BUG: state 0 routed to the wrong handler.
  const misRoute = (m) => {
    switch (m.mem8[MAINLOOP_SUBSTATE_SELECTOR] & 7) {
      case 0: return runActivePlayFrame(m); // BUG: state 0 -> runActivePlayFrame
      default: throw new Error("guard-slack");
    }
  };
  {
    const o = craft(0, SEATINGS[0][1]); oracle(o);
    const c = craft(0, SEATINGS[0][1]);
    const rc = runGuarded(misRoute, c);
    const caught = rc.threw || ramDiffMinusStack(o, c) !== null;
    assert.equal(caught, true, "the gate FAILED to catch a mis-routed state 0");
  }
  console.log("  TEETH: dropped tail + mis-route caught");
});
