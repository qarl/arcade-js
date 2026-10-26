// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceActorDescentStepAndLand (ROM 0x29a0) — the descent state handler for the actor
 * record at IX. It reseats the frame-hold, toggles the display tile every fourth frame, and drives
 * the descent counter down by two: at/above the floor it just returns; below it, a set gate byte
 * diverts to the countdown/redirect step, otherwise it reseeds the spawn timer, advances the state,
 * and runs two ROM self-checks — a running-sum block (miss -> loc_2ab3) and a byte-compare block
 * against a reference table (miss -> advanceLeadActorDescentToLanding); a clean pair enqueues the descent display command.
 *
 * SEATING: BALANCED — advanceActorDescentStepAndLand's own rets WIRE; the diversions are tail-jumps that forward the
 * delegatee's result. Compared per case on RAM (dumpState, minus stack scratch below the entry SP); advanceActorDescentStepAndLand has no
 * register live-out of its own. pc/SP/full register file are not compared.
 *
 * The self-check branches gate on ROM sums/tables that PASS for the intact image (verified: the
 * 0x20 bytes at 0x0879 sum to 0x37, and 0x2980.. equals 0x0859.. over 0x20). Both are in ROM, so
 * the branches are unreachable by poking RAM — ROM writes throw. To reach the sum miss we build a
 * SECOND base from a ROM copy with one summed byte bumped and compose the sibling idiomatic loc_2ab3
 * (self-contained). The cmp-miss guard (advanceLeadActorDescentToLanding) and the gate diversion (tickPhaseTimerAndMaybeRunResetScan) pull large
 * subtrees, so they are NOT composed here — their gate liveness is shown by the data invariants and
 * the sum-miss composition (a failed check skips the enqueue), leaving their execution to their own
 * per-routine gates.
 *
 * Jobs:
 *   1. DESCEND    — high counter, flip + no-flip frames: at/above the floor the handler returns;
 *                   oracle == idiomatic in RAM; the tile toggle is a positive control.
 *   2. SUCCESS    — intact ROM, below the floor, gate clear: both checks pass; the descent command
 *                   is enqueued and the state advanced; oracle == idiomatic; the enqueue is asserted.
 *   3. SUM-MISS   — tampered ROM: the sum check fails and both sides tail-jump into loc_2ab3;
 *                   oracle == idiomatic; positive control — the enqueue did NOT run and loc_2ab3
 *                   reseated the frame-hold to its own value.
 *   4. BRANCH-LIVE— the checks genuinely select the branch: intact sum==0x37 & tables match,
 *                   tampered do not, and intact-success vs sum-tampered land in DIFFERENT RAM.
 *   5. TEETH      — a wrong reseeded spawn-timer byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-29a0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_29a0 as oracle } from "../../translated/loc_29a0.js";
import { advanceActorDescentStepAndLand } from "../advanceActorDescentStepAndLand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  FORMATION_SPAWN_TIMER,
  FIELD_ATTRIB_SRC_B,
  DISPLAY_CMD_RING_WRITE_PTR,
  loc_8343,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const CKSUM_ADDR = 0x0879; // FIELD_ATTRIB_SRC_B: first byte of the summed block
const CKSUM_LEN = 0x20;
function romSum(rom) {
  let s = 0;
  for (let i = 0; i < CKSUM_LEN; i++) s = (s + rom[CKSUM_ADDR + i]) & 0xff;
  return s;
}
function tablesMatch(rom) {
  for (let i = 0; i < CKSUM_LEN; i++) if (rom[0x2980 + i] !== rom[0x0859 + i]) return false;
  return true;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
let TAMPERED_ROM = null;
let BASE_TAMPER = null;
if (ROM_PRESENT) {
  TAMPERED_ROM = ROM.slice();
  TAMPERED_ROM[CKSUM_ADDR] = (TAMPERED_ROM[CKSUM_ADDR] + 1) & 0xff; // sum 0x37 -> 0x38, check fails
  BASE_TAMPER = new Machine(TAMPERED_ROM).clone();
}

const REC = 0x8a80; //   the actor record advanceActorDescentStepAndLand operates on
const RING_SLOT = 0x88c0; // first ring slot (page 0x88 + ring start 0xc0)
const FRAME_HOLD = 0x11;
const ANIM_TICK = 0x0b;
const DISPLAY_TILE = 0x0f;
const DESCENT_COUNTER = 0x06;
const STATE_FIELD = 0x02;

/** A fresh clone off `base` with advanceActorDescentStepAndLand's record inputs seated. */
function craftFrom(base, { counter = 0x2c, tick = 0x00, tile = 0x15, gate = 0x00 } = {}) {
  const m = base.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff8; // inside STACK_SCRATCH
  m.mem.write8(loc_8343, gate);
  m.mem.write8(REC + DESCENT_COUNTER, counter);
  m.mem.write8(REC + ANIM_TICK, tick);
  m.mem.write8(REC + DISPLAY_TILE, tile);
  m.mem.write8(REC + STATE_FIELD, 0x00);
  m.mem.write8(REC + FRAME_HOLD, 0x00);
  // free ring slot so enqueueDisplayCommand actually enqueues on the success path
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, 0xc0);
  m.mem.write8(RING_SLOT, 0x80); // bit7 set => free
  return m;
}

// -- 1. DESCEND ---------------------------------------------------------------

test("DESCEND: at/above the floor the handler returns; tile flip identical to oracle", () => {
  const cases = [
    { name: "flip frame", counter: 0x50, tick: 0x03, tile: 0x15 }, // tick+1 &3 == 0 -> flip 0x15->0x1e
    { name: "no-flip frame", counter: 0x50, tick: 0x05, tile: 0x15 }, // tick+1 &3 != 0 -> no flip
  ];
  for (const c of cases) {
    const o = craftFrom(BASE, c);
    const k = craftFrom(BASE, c);
    oracle(o);
    advanceActorDescentStepAndLand(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `${c.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
    assert.equal(k.mem.read8(REC + DESCENT_COUNTER), 0x4e, `${c.name}: counter dropped by two`);
  }
  const flip = craftFrom(BASE, { counter: 0x50, tick: 0x03, tile: 0x15 });
  advanceActorDescentStepAndLand(flip);
  assert.equal(flip.mem.read8(REC + DISPLAY_TILE), 0x1e, "the flip frame toggled the tile");
  console.log("  DESCEND: return path identical (flip + no-flip)");
});

// -- 2. SUCCESS ---------------------------------------------------------------

test("SUCCESS: below the floor, clean checks enqueue the command; oracle == idiomatic", () => {
  const o = craftFrom(BASE, { counter: 0x2c });
  const k = craftFrom(BASE, { counter: 0x2c });
  oracle(o);
  advanceActorDescentStepAndLand(k);
  const d = ramDiffMinusStack(o, k);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(k.mem.read8(FORMATION_SPAWN_TIMER), 0x30, "spawn timer reseeded to base");
  assert.equal(k.mem.read8(REC + FRAME_HOLD), 0x18, "frame-hold stretched");
  assert.equal(k.mem.read8(RING_SLOT), 0x06, "enqueueDisplayCommand enqueued the command high byte 0x06");
  assert.equal(k.mem.read8(RING_SLOT + 1), 0x14, "enqueueDisplayCommand enqueued the command low byte 0x14");
  console.log("  SUCCESS: both checks pass -> descent command enqueued, identical to oracle");
});

// -- 3. SUM-MISS --------------------------------------------------------------

test("SUM-MISS: tampered ROM -> tail-jump loc_2ab3; oracle == idiomatic; enqueue skipped", () => {
  const o = craftFrom(BASE_TAMPER, { counter: 0x2c });
  const k = craftFrom(BASE_TAMPER, { counter: 0x2c });
  const ro = oracle(o);
  const rc = advanceActorDescentStepAndLand(k);
  const d = ramDiffMinusStack(o, k);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(rc, ro, "the tail-jump must forward loc_2ab3's result unchanged");
  assert.equal(k.mem.read8(RING_SLOT), 0x80, "the enqueue must be skipped on the sum-miss branch");
  assert.equal(k.mem.read8(REC + FRAME_HOLD), 0x02, "loc_2ab3 reseated the frame-hold to its own value");
  console.log("  SUM-MISS: composed idiomatic loc_2ab3, enqueue skipped");
});

// -- 4. BRANCH-LIVE -----------------------------------------------------------

test("BRANCH-LIVE: the self-checks truly select the branch (intact passes, tampered diverges)", () => {
  assert.equal(romSum(ROM), 0x37, "intact ROM must sum to 0x37 (sum check passes)");
  assert.notEqual(romSum(TAMPERED_ROM), 0x37, "tampered ROM must not sum to 0x37 (sum check fails)");
  assert.equal(tablesMatch(ROM), true, "intact ROM: the compare tables must match (cmp check passes)");
  const intact = craftFrom(BASE, { counter: 0x2c });
  const tamper = craftFrom(BASE_TAMPER, { counter: 0x2c });
  advanceActorDescentStepAndLand(intact);
  advanceActorDescentStepAndLand(tamper);
  const d = ramDiffMinusStack(intact, tamper);
  assert.notEqual(d, null, "intact vs sum-tampered must diverge — else the sum branch is dead");
  console.log(`  BRANCH-LIVE: intact/tampered diverge at ${hx(d.addr ?? 0)} (enqueue vs loc_2ab3)`);
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: a wrong reseeded spawn-timer byte is CAUGHT by the RAM diff", () => {
  const o = craftFrom(BASE, { counter: 0x2c });
  const k = craftFrom(BASE, { counter: 0x2c });
  oracle(o);
  advanceActorDescentStepAndLand(k);
  k.mem.write8(FORMATION_SPAWN_TIMER, 0x00); // BUG: the spawn timer must reseed to 0x30
  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong spawn-timer byte — it is worthless");
  assert.equal(d.addr, FORMATION_SPAWN_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong spawn-timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
