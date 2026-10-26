// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stepEnemyActorState (Pooyan) — the per-object state dispatcher.
 *
 * A record whose active flag (bit 0 of the two-byte header) is clear is skipped; a sub-state
 * (state byte & 0x1f) >= 0x11 is skipped; otherwise the matching sub-state handler runs on the
 * record. The oracle reaches each handler through the rst-28 trampoline (m.call(0x0028)); the
 * module imports each handler and calls it directly. Both sides clone one Machine, so a handler's
 * reads of shared RAM match.
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the handlers'
 * ret drops fall out of the diff. stepEnemyActorState has no register live-out (the caller brackets it with
 * exx and reloads its own registers), so every case is a memory poke.
 *
 * Jobs: 1. EQUAL across all 17 in-range sub-states and both guard-reject paths; 2. WRITE-SET
 * (a handler writes, a skipped record does not); 3. TEETH (a corrupted result is caught; distinct
 * sub-states route to distinct writes; the active-flag guard is load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-122c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_122c as oracle } from "../../translated/loc_122c.js";
import { stepEnemyActorState } from "../stepEnemyActorState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //   object-record table base (the sweep's first record)
const REC_HDR = 0x00; //  active-flag header byte
const REC_STATE = 0x02; // sub-state byte
const SP0 = 0x8ff0; //    inside STACK_SCRATCH
const STATE_COUNT = 0x11; // valid sub-states 0..0x10

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record header + sub-state and park SP in the dead-stack band. */
function seat({ active = 0x01, state = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem.write8(REC + REC_HDR, active);
  m.mem.write8(REC + REC_STATE, state);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: stepEnemyActorState == oracle in RAM (−stack), all sub-states + guards", () => {
  const cases = [];
  for (let s = 0; s < STATE_COUNT; s++) cases.push({ name: `state ${s}`, cfg: { state: s } });
  cases.push({ name: "inactive record (guard 1)", cfg: { active: 0x00, state: 0x04 } });
  cases.push({ name: "out-of-range state (guard 2)", cfg: { active: 0x01, state: 0x1f } });

  for (const { name, cfg } of cases) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    stepEnemyActorState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} cases identical (17 sub-states + 2 guard rejects, RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an in-range handler writes RAM; a skipped record does not", () => {
  // A dispatched handler mutates RAM.
  const live = seat({ active: 0x01, state: 0x00 });
  const before = live.dumpState().slice();
  stepEnemyActorState(live);
  const after = live.dumpState();
  let handlerWrote = false;
  for (let i = 0; i < after.length; i++) {
    const addr = live.stateOffsetToAddr(i);
    if (after[i] !== before[i] && !inDeadStack(addr)) { handlerWrote = true; break; }
  }
  assert.ok(handlerWrote, "an in-range sub-state handler must write RAM");

  // An inactive record is a no-op (outside the dead-stack band).
  const skip = seat({ active: 0x00, state: 0x00 });
  const skBefore = skip.dumpState().slice();
  stepEnemyActorState(skip);
  const skAfter = skip.dumpState();
  for (let i = 0; i < skAfter.length; i++) {
    const addr = skip.stateOffsetToAddr(i);
    if (inDeadStack(addr)) continue;
    assert.equal(skAfter[i], skBefore[i], `inactive record wrote at ${hx(addr ?? 0)}`);
  }
  console.log("  WRITE-SET: handler writes RAM; inactive record is a no-op");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: corruption caught; sub-states route distinctly; active guard load-bearing", () => {
  // A corrupted handler result is caught by the RAM diff.
  const o = seat({ active: 0x01, state: 0x00 });
  const c = seat({ active: 0x01, state: 0x00 });
  oracle(o);
  stepEnemyActorState(c);
  const target = REC + 0x11; // a byte state-0 (advanceActorStateOnTimerAndRestartAnim) writes
  c.mem.write8(target, (o.mem.read8(target) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted handler result");

  // Distinct sub-states must route to distinct handlers (different writes).
  const s0 = seat({ active: 0x01, state: 0x00 });
  const s6 = seat({ active: 0x01, state: 0x06 });
  oracle(s0);
  oracle(s6);
  assert.notEqual(ramDiffMinusStack(s0, s6), null, "distinct sub-states must produce distinct RAM");

  // The active-flag guard is load-bearing: active vs inactive differ.
  const on = seat({ active: 0x01, state: 0x00 });
  const off = seat({ active: 0x00, state: 0x00 });
  oracle(on);
  oracle(off);
  assert.notEqual(ramDiffMinusStack(on, off), null, "active and inactive records must differ");
  console.log(`  TEETH(RAM): corruption caught at ${hx(d.addr ?? 0)}; routing + active guard load-bearing`);
});
