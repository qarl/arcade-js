// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for beginLeadActorLiftOnClear (ROM 0x2442, Pooyan) — the lead-actor state-0 handler
 * (record based at IX = ACTOR_TABLE = 0x8a80). It idles while either tamper-strike counter
 * (TAMPER_STRIKES_SLOTSWEEP 0x89e8 / TAMPER_STRIKES_ROM 0x89ef) is nonzero. Otherwise it seeds
 * the record's frame-delay field (+0x11 = 0x10), advances the state (+0x02), snapshots the whole
 * 0x18-byte lead record into ACTOR_TABLE_SLOT1 (0x8a98), drops the +0x04 position field by 0x10,
 * loads the shape table via seedFourRecordsAndCopyDisplayTiles, and — unless WAVE_TEARDOWN_STATE (0x8f24) is set — queues
 * the tile-run sound via queueSoundRun26.
 *
 * The contract is RAM (dumpState, minus stack scratch below the entry SP) only; this is reached by tail dispatch and
 * the per-frame driver reads no register back. pc/SP/cycles are not compared. seedFourRecordsAndCopyDisplayTiles and queueSoundRun26
 * are deep leaves, so EQUAL runs both sides under try/catch and requires the same completion path,
 * comparing RAM whenever both complete. The direct field footprint is asserted on the teardown
 * path (0x8f24 != 0), where queueSoundRun26 is skipped and only seedFourRecordsAndCopyDisplayTiles's +0x0f-per-record writes occur.
 *
 * Jobs:
 *   1. EQUAL — full path, teardown path (0x8f24 set), and the early-idle path (0x89e8 set).
 *   2. FOOTPRINT — beginLeadActorLiftOnClear's own field writes (frame-delay, state, position drop, snapshot).
 *   3. TEETH — a twin that writes the wrong frame-delay byte, and a twin that ignores the idle
 *      gate, are both CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2442.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2442 as oracle } from "../../translated/loc_2442.js";
import { beginLeadActorLiftOnClear } from "../beginLeadActorLiftOnClear.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ACTOR_TABLE,
  ACTOR_TABLE_SLOT1,
  TAMPER_STRIKES_SLOTSWEEP,
  TAMPER_STRIKES_ROM,
  WAVE_TEARDOWN_STATE,
  BOARD_CLEAR_FLAG,
  TAMPER_STRIKES_TERMINATOR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ACTOR_TABLE; // 0x8a80
const FRAME_DELAY = REC + 0x11;
const STATE = REC + 0x02;
const POS = REC + 0x04;
const ORIG_STATE = 0x00;
const ORIG_POS = 0x50;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IX at the lead record and the gate cells seated. */
function craft({ idle = false, teardown = false } = {}) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(TAMPER_STRIKES_SLOTSWEEP, idle ? 0x01 : 0x00);
  m.mem.write8(TAMPER_STRIKES_ROM, 0x00);
  m.mem.write8(WAVE_TEARDOWN_STATE, teardown ? 0x01 : 0x00);
  m.mem.write8(BOARD_CLEAR_FLAG, 0x00); //          keep copyDisplayTilesIntoActorRecords off its board-reset tail
  m.mem.write8(TAMPER_STRIKES_TERMINATOR, 0x00); // (partner of the divert OR)
  m.mem.write8(STATE, ORIG_STATE);
  m.mem.write8(POS, ORIG_POS);
  m.mem.write8(FRAME_DELAY, 0x00);
  m.regs.sp = 0x8fe0; // dead stack for the nested calls
  return m;
}

/** Run oracle and module on identical clones; assert same completion path + RAM match when both finish. */
function assertEqualPath(opts, label) {
  const o = craft(opts);
  const c = craft(opts);
  let oThrew = false;
  let cThrew = false;
  try { oracle(o); } catch { oThrew = true; }
  try { beginLeadActorLiftOnClear(c); } catch { cThrew = true; }
  assert.equal(oThrew, cThrew, `${label}: oracle and module must take the same completion path`);
  if (!oThrew) {
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  return { o, c, oThrew };
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: full / teardown / early-idle paths — beginLeadActorLiftOnClear == oracle in RAM (−stack)", () => {
  assertEqualPath({}, "full");
  assertEqualPath({ teardown: true }, "teardown");
  const { o, c } = assertEqualPath({ idle: true }, "early-idle");
  // the idle path writes nothing: the frame-delay field stays as seeded on both sides
  assert.equal(o.mem.read8(FRAME_DELAY), 0x00, "idle path must not seed the frame delay");
  assert.equal(c.mem.read8(FRAME_DELAY), 0x00, "module idle path must not seed the frame delay");
  console.log("  EQUAL: full, teardown, early-idle identical (RAM −stack)");
});

// -- 2. FOOTPRINT -------------------------------------------------------------

test("FOOTPRINT: beginLeadActorLiftOnClear's own field writes (teardown path, queueSoundRun26 skipped)", () => {
  const m = craft({ teardown: true });
  oracle(m);
  const g = (a) => m.mem.read8(a);
  assert.equal(g(FRAME_DELAY), 0x10, "frame-delay field seeded");
  assert.equal(g(STATE), (ORIG_STATE + 1) & 0xff, "state advanced");
  assert.equal(g(POS), (ORIG_POS - 0x10) & 0xff, "position dropped one row");
  assert.equal(g(ACTOR_TABLE_SLOT1 + 0x11), 0x10, "snapshot carried the frame-delay into slot 1");
  assert.equal(g(ACTOR_TABLE_SLOT1 + 0x02), (ORIG_STATE + 1) & 0xff, "snapshot carried the advanced state");
  console.log("  FOOTPRINT: +0x11/+0x02/+0x04 + slot-1 snapshot match");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong frame-delay byte is CAUGHT by the RAM diff", () => {
  const o = craft({ teardown: true });
  const c = craft({ teardown: true });
  oracle(o);
  beginLeadActorLiftOnClear(c);
  c.mem.write8(FRAME_DELAY, 0x00); // BUG: must be 0x10
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong frame-delay — it is worthless");
  assert.equal(d.addr, FRAME_DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(frame-delay): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: acts even while a tamper strike is pending (ignores the idle gate). */
function brokenIgnoreIdle(m, rec = m.regs.ix) { m.mem.write8(rec + 0x11, 0x10); }

test("TEETH: ignoring the idle gate is CAUGHT", () => {
  const o = craft({ idle: true });
  const c = craft({ idle: true });
  oracle(o); // idles: writes nothing
  brokenIgnoreIdle(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped idle-gate — it is worthless");
  assert.equal(d.addr, FRAME_DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(idle-gate): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
