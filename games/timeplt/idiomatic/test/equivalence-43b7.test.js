// SPDX-License-Identifier: GPL-3.0-only
/**
 * armMotherShipOrStep against the frozen oracle: one booted machine, cloned and poked to land each of the five
 * exits — wave-hold set, a special already armed, an off-phase frame, an occupied bank, and the spawn.
 * Every arm compares the whole work-RAM dump, the stack scratch both sides push masked off; registers,
 * the flag byte and the stack pointer are excluded, and the teeth below prove each gate condition is
 * independently load-bearing.
 *
 * DISSOLVED FORM: the active arm's `m.call(loc_43f0)` is dissolved to a direct `loc_43f0(m)`
 * (frogger call=0 form). The caller no longer dispatches the stepper through the routine map, so this
 * arm can no longer be stubbed via the registry — it runs the REAL stepper on both sides and compares
 * work RAM with the stack scratch masked (the ROM's call pushes a return frame the direct JS call does
 * not). The stepper's own byte-equivalence is proven by equivalence-43f0.test.js; here we only prove the
 * caller reaches it and returns its result.
 *
 * NO REGISTER IS LIVE AT EXIT, measured on the ORACLE (DEAD AT EXIT): wrapped in the all-frozen game,
 * every register it leaves — the record/entry pair the occupied and spawn arms seat included — is
 * complemented on the way out (assertDeadAtExit) and nothing differs, the stack page included, over the
 * driven session and three quota-spent holds (the ship armed and stepped in eras 0, 2 and 4), while a
 * complemented stack pointer is heard at once. The rewrite hands the pair to the retirer and to the
 * stepper as arguments and leaves no register behind, so registers are not compared.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { armMotherShipOrStep } from "../armMotherShipOrStep.js";
import { loc_43b7 as oracle } from "../../translated/loc_43b7.js";
import { retireEntryPairIntoCooldown } from "../retireEntryPairIntoCooldown.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { assertDeadAtExit } from "./_deadAtExit.js";

const TARGET = 0x43b7;
const STEP_ACTIVE = 0x43f0;

const WAVE_HOLD = 0xacc6;
const SPECIAL_ACTIVE = 0xad0d;
const FRAME_TICK = 0xa980;
const SPAWN_GATE = 0xad02;
const RECORD = 0xa8a0;
const RECORD_STRIDE = 0x10;
const FIRE_BYTE = 0x04;
const HELD = 0xff;
const PHASE_DUE = 0x05;
const PHASE_OFF = 0x00;
const OCCUPIED = 0x99;
const A_LIVE = 0x42;
const FIRE_WRONG = 0x06;

const BOOT_FRAMES = 700;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** The sessions DEAD AT EXIT poisons over (JS frames): driven, and the kill quota spent in three eras. */
const DEAD_FRAMES = 3000;
const QUOTA_SPENT = { addr: SPAWN_GATE, val: 0, frame: 621, dur: null };
const DEAD_SESSIONS = {
  driven: [],
  "armed, era 0": [QUOTA_SPENT],
  "armed, era 2": [QUOTA_SPENT, { addr: 0xad04, val: 2, frame: 701, dur: null }],
  "armed, era 4": [QUOTA_SPENT, { addr: 0xad04, val: 4, frame: 701, dur: null }],
};
/** Every register the oracle can leave behind, the stack pointer apart. */
const LEFT_BEHIND = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy", "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_"];
const ARM_NAMES = ["hold", "active", "phase", "occupied", "spawn"];

// ── one booted machine, cloned per arm ────────────────────────────────────────────────────────

let base = null;
function captureBase() {
  if (base) return base;
  const m = makeMachine();
  const frames = m.runFrames(BOOT_FRAMES);
  assert.equal(m.stoppedBy, null, `boot stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, BOOT_FRAMES, "boot ran short");
  base = m.clone();
  return base;
}

/** A booted clone poked so the routine reaches the spawn: hold clear, no armed special, on phase,
 * bank empty. */
function spawnReady() {
  const m = captureBase().clone();
  m.mem8[WAVE_HOLD] = 0x00;
  m.mem8[SPECIAL_ACTIVE] = 0x00;
  m.mem8[FRAME_TICK] = PHASE_DUE;
  m.mem8[SPAWN_GATE] = 0x00;
  m.mem8[RECORD] = 0x00;
  m.mem8[RECORD + RECORD_STRIDE] = 0x00;
  return m;
}

function craftArm(name) {
  const m = spawnReady();
  if (name === "hold") m.mem8[WAVE_HOLD] = HELD;
  else if (name === "active") m.mem8[SPECIAL_ACTIVE] = A_LIVE;
  else if (name === "phase") m.mem8[FRAME_TICK] = PHASE_OFF;
  else if (name === "occupied") m.mem8[RECORD] = OCCUPIED;
  return m;
}

/** Whole-dump oracle-vs-candidate on independent clones, the stack scratch both sides push masked off
 * (the active arm's ROM `call` pushes a return frame the dissolved direct call does not; every other arm
 * pushes nothing, so its scratch set is empty and the diff is exact). Identical throws count as equal. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const scratch = new Set();
  const track = (mm) => {
    const push = mm.push16.bind(mm);
    mm.push16 = (v) => { const sp = (mm.regs.sp - 2) & 0xffff; scratch.add(sp).add((sp + 1) & 0xffff); push(v); };
  };
  track(a); track(b);
  let ea, eb;
  try { oracle(a); } catch (e) { ea = e; }
  try { candidate(b); } catch (e) { eb = e; }
  if (ea || eb) {
    if (ea && eb && String(ea) === String(eb)) return null;
    return { addr: null, a: ea ? `threw ${ea.message}` : "returned", b: eb ? `threw ${eb.message}` : "returned" };
  }
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), (addr) => scratch.has(addr));
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

/** Arms where a twin's RAM parts from the oracle's, over the five crafted entries. */
function caughtOn(candidate) {
  return ARM_NAMES.filter((arm) => unitDiff(candidate, craftArm(arm)) !== null);
}

// ── the gate ──────────────────────────────────────────────────────────────────────────────────

test("EQUAL on every exit arm: work RAM identical to the oracle", { skip }, () => {
  for (const arm of ARM_NAMES) {
    const d = unitDiff(armMotherShipOrStep, craftArm(arm));
    assert.equal(d, null, `arm ${arm} diverged: ${show(d)}`);
  }
  console.log(`  EQUAL: ${ARM_NAMES.length} arms, whole-dump identical`);
});

test("NON-VACUOUS: the two writing arms move memory, the three ret arms move none", { skip }, () => {
  const fp = Object.fromEntries(ARM_NAMES.map((a) => [a, footprint(craftArm(a))]));
  assert.ok(fp.active > 0 && fp.spawn > 0, "a writing arm moved nothing, so its comparison is vacuous");
  for (const arm of ["hold", "phase", "occupied"]) {
    assert.equal(fp[arm], 0, `the ${arm} arm wrote to memory; it is meant to be a bare ret`);
  }
  console.log(`  NON-VACUOUS: footprints ${ARM_NAMES.map((a) => `${a}=${fp[a]}`).join(" ")}`);
});

test("REAL TAIL: the armed-special arm runs the true stepper and still agrees", { skip }, () => {
  const m = spawnReady(); // no stub: the real registry dispatches the stepper end to end
  m.mem8[SPECIAL_ACTIVE] = A_LIVE;
  const d = unitDiff(armMotherShipOrStep, m);
  assert.equal(d, null, `the real stepper tail diverged: ${show(d)}`);
  console.log("  REAL TAIL: the true stepper subtree ran on both sides, byte-identical");
});

test("DEAD AT EXIT: no register the oracle leaves is heard, and a complemented stack pointer is", { skip }, () => {
  // assertDeadAtExit: every session reaches this routine and nothing differs, the stack page
  // included; beside the helper's own SP flip, a COMPLEMENTED stack pointer at the same exit must be
  // heard in game data (dataOnly) in every session, as before.
  assertDeadAtExit({
    at: TARGET, poison: LEFT_BEHIND, frames: DEAD_FRAMES, reachEvery: true,
    sessions: Object.entries(DEAD_SESSIONS).map(([label, pokes]) => ({ label, pokes })),
    controls: [{
      label: "complemented SP", poison: ["sp"], expect: "heard", every: true, reachEvery: true, dataOnly: true,
    }],
  });
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

function spawn(m) {
  const { regs, mem8 } = m;
  regs.ix = RECORD;
  regs.iy = 0xaa24;
  mem8[SPECIAL_ACTIVE] = HELD;
  mem8[RECORD + FIRE_BYTE] = 0x07;
  return retireEntryPairIntoCooldown(m);
}

/** BUG: does nothing, so no arm spawns or steps. */
function brokenNoOp() {}
/** BUG: spawns without checking the wave-hold flag. */
function brokenIgnoresHold(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[SPECIAL_ACTIVE];
  if (regs.a !== 0) return m.call(STEP_ACTIVE);
  if ((mem8[FRAME_TICK] & 0x07) !== PHASE_DUE) return;
  if ((mem8[SPAWN_GATE] | mem8[RECORD] | mem8[RECORD + RECORD_STRIDE]) !== 0) return;
  return spawn(m);
}
/** BUG: spawns instead of deferring to the stepper when a special is armed. */
function brokenIgnoresActive(m) {
  const { mem8 } = m;
  if (mem8[WAVE_HOLD] === HELD) return;
  if ((mem8[FRAME_TICK] & 0x07) !== PHASE_DUE) return;
  if ((mem8[SPAWN_GATE] | mem8[RECORD] | mem8[RECORD + RECORD_STRIDE]) !== 0) return;
  return spawn(m);
}
/** BUG: spawns on every frame, not one in eight. */
function brokenIgnoresPhase(m) {
  const { regs, mem8 } = m;
  if (mem8[WAVE_HOLD] === HELD) return;
  regs.a = mem8[SPECIAL_ACTIVE];
  if (regs.a !== 0) return m.call(STEP_ACTIVE);
  if ((mem8[SPAWN_GATE] | mem8[RECORD] | mem8[RECORD + RECORD_STRIDE]) !== 0) return;
  return spawn(m);
}
/** BUG: spawns over an occupied bank. */
function brokenIgnoresOccupancy(m) {
  const { regs, mem8 } = m;
  if (mem8[WAVE_HOLD] === HELD) return;
  regs.a = mem8[SPECIAL_ACTIVE];
  if (regs.a !== 0) return m.call(STEP_ACTIVE);
  if ((mem8[FRAME_TICK] & 0x07) !== PHASE_DUE) return;
  return spawn(m);
}
/** BUG: arms the fire byte with the wrong value. */
function brokenWrongFire(m) {
  const { regs, mem8 } = m;
  if (mem8[WAVE_HOLD] === HELD) return;
  regs.a = mem8[SPECIAL_ACTIVE];
  if (regs.a !== 0) return m.call(STEP_ACTIVE);
  if ((mem8[FRAME_TICK] & 0x07) !== PHASE_DUE) return;
  regs.ix = RECORD;
  regs.iy = 0xaa24;
  if ((mem8[SPAWN_GATE] | mem8[RECORD] | mem8[RECORD + RECORD_STRIDE]) !== 0) return;
  mem8[SPECIAL_ACTIVE] = HELD;
  mem8[RECORD + FIRE_BYTE] = FIRE_WRONG;
  return retireEntryPairIntoCooldown(m);
}

const TWINS = [
  ["no-op", brokenNoOp, ["active", "spawn"]],
  ["ignores-hold", brokenIgnoresHold, ["hold"]],
  ["ignores-active", brokenIgnoresActive, ["active"]],
  ["ignores-phase", brokenIgnoresPhase, ["phase"]],
  ["ignores-occupancy", brokenIgnoresOccupancy, ["occupied"]],
  ["wrong-fire", brokenWrongFire, ["spawn"]],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on exactly ${expected.join(", ")}`, { skip }, () => {
    const got = caughtOn(twin);
    assert.deepEqual(got, expected, `the ${label} twin's caught arms moved: ${got.join(", ")}`);
    console.log(`  TEETH/${label}: caught on ${got.join(", ") || "nothing"}`);
  });
}
