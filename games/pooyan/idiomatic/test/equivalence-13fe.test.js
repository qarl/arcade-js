// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorPositionByVelocity (Pooyan) — advance an actor's X (rec+0x05) by its velocity
 * (rec+0x0a), spending a lap/lifetime (rec+0x06) when the ROM `cp b` sets carry (current X below the
 * negated velocity). The advanced X is handed to the (already idiomatic) latchActorStepThenDispatchByStageCountdown, which stashes it
 * into rec+0x05 and tails into the countdown-gated dispatch; advanceActorPositionByVelocity forwards that result.
 *
 * REGISTER BRIDGE: rec = m.regs.ix, threaded to latchActorStepThenDispatchByStageCountdown. Cases are CRAFTED. Compared on RAM
 * (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the delegate's push/ret drop
 * out of the diff. STAGE_COUNTDOWN selects latchActorStepThenDispatchByStageCountdown's own delegate (both already idiomatic); it is
 * held at the spawn/queue gate here so the outcome is deterministic — latchActorStepThenDispatchByStageCountdown's own gate covers the
 * below-three path.
 *
 * Jobs: 1. EQUAL (wrap + no-wrap); 2. WRITE-SET (rec+0x05 always; rec+0x06 only on the wrap);
 * 3. TEETH (a corrupted advanced-X is caught; the wrap gate is load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-13fe.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13fe as oracle } from "../../translated/loc_13fe.js";
import { advanceActorPositionByVelocity } from "../advanceActorPositionByVelocity.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STAGE_COUNTDOWN } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; // an actor record (safe RAM, clear of STACK_SCRATCH)
const SP0 = 0x8ff0; // inside STACK_SCRATCH
const X = REC + 0x05;
const LAP = REC + 0x06;
const VEL = REC + 0x0a;
const GATE_COUNTDOWN = 0x05; // >= 3: latchActorStepThenDispatchByStageCountdown takes the spawn/queue gate (deterministic here)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** cp b sets carry (wrap -> dec lap) when x < ((-vel) & 0xff). */
function seat({ vel, x, lap = 0x0a } = {}) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem.write8(VEL, vel);
  m.mem.write8(X, x);
  m.mem.write8(LAP, lap);
  m.mem.write8(STAGE_COUNTDOWN, GATE_COUNTDOWN);
  return m;
}

// vel=0x02 -> (-vel)&0xff = 0xfe. x=0x10 < 0xfe -> wrap; x=0xff >= 0xfe -> no wrap.
const craftWrap = () => seat({ vel: 0x02, x: 0x10 });
const craftNoWrap = () => seat({ vel: 0x02, x: 0xff });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceActorPositionByVelocity == oracle in RAM (−stack)", () => {
  for (const [name, craft] of [["wrap", craftWrap], ["no-wrap", craftNoWrap]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    advanceActorPositionByVelocity(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: wrap + no-wrap identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: rec+0x05 := advanced X always; rec+0x06 decremented only on a wrap", () => {
  const w = craftWrap();
  oracle(w);
  assert.equal(w.mem.read8(X), (0x10 + 0x02) & 0xff, "advanced X stashed at rec+0x05");
  assert.equal(w.mem.read8(LAP), 0x09, "lap counter 0x0a -> 0x09 on wrap");

  const n = craftNoWrap();
  oracle(n);
  assert.equal(n.mem.read8(X), (0xff + 0x02) & 0xff, "advanced X (wrapped byte) stashed at rec+0x05");
  assert.equal(n.mem.read8(LAP), 0x0a, "lap counter untouched with no wrap");
  console.log("  WRITE-SET: rec+0x05 always; rec+0x06-- only on wrap");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted advanced-X is CAUGHT; the wrap gate is load-bearing", () => {
  const o = craftWrap();
  const c = craftWrap();
  oracle(o);
  advanceActorPositionByVelocity(c);
  c.mem.write8(X, (o.mem.read8(X) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted advanced-X");
  assert.equal(d.addr, X, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  const wrap = craftWrap();
  const noWrap = craftNoWrap();
  oracle(wrap);
  oracle(noWrap);
  assert.notEqual(ramDiffMinusStack(wrap, noWrap), null, "wrap and no-wrap branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; wrap gate load-bearing`);
});
