// SPDX-License-Identifier: GPL-3.0-only
//
// STANDING WHOLE-GAME GATE for Time Pilot (the file done_gate's check_wholegame globs and runs).
// It drives the WHOLE WIRED IDIOMATIC machine under the clock-free coroutine engine (runIdiomaticGame,
// NOT runFrames) from reset, through boot -> attract -> coin -> start -> real play, and asserts the
// whole-machine invariants a regression in any spine routine would break:
//   * boot completes the full frame budget with NO translation gap (stopError null, frames == budget);
//   * the coin banks a credit (COIN_COUNTER_PULSES_OWED pulses, CREDIT_COUNT rises above its power-on value);
//   * play actually starts (PLAY_ACTIVE reaches its in-play 0xff -- the ONE cell that separates real
//     play from the attract demo, which runs the same round engine with the flag clear);
//   * gameplay ADVANCES (SEQUENCE_PHASE reaches the input-gated credit state 2, and the free-running
//     BCD frame counter takes many distinct values across the run);
//   * SP stays INERT: the vblank NMI is fired as a direct JS call (no guest push, no call/ret seam), so
//     neither the interrupt subtree nor any frame of the foreground moves the stack pointer. A layer
//     that still leans on a guest return slot -- an arm that returns through the interrupt's pushed
//     word -- walks SP up out of the stack and into sprite RAM, and this is where that shows.
//   * a LONG run stays placeable: attract and a driven session each run many thousands of NMIs, deep
//     enough that the era advances past the first two and the era-2+ object sweep runs -- the
//     time-accumulated paths the 600-ordinal arms never reach (runbook §4 "Driving coverage").
// Each live assertion carries a matching UNDRIVEN control (idle run): the coin never banks, play never
// starts, the credit state is never entered. That is what gives the gate teeth -- a mutant that clamps
// a cell to 0 fails the live arm; a mutant that pins it high unconditionally fails the idle arm.
//
// This is NOT the per-routine equivalence suite in games/timeplt/idiomatic/test/ (that compares the
// idiomatic layer against the translated oracle byte for byte). This gate asks a coarser, standing
// question: does the whole wired machine still boot and play? Skips cleanly when the ROM is absent (BYO).

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine, resolveAllIdiomatic } from "../machine.js";
import manifest from "../manifest.js";
import {
  COIN_COUNTER_PULSES_OWED,
  CREDIT_COUNT,
  PLAY_ACTIVE,
  SEQUENCE_PHASE,
  BCD_FRAME_COUNTER,
  ERA_INDEX,
  ATTACKER_SPAWN_SLOT_COUNT,
} from "../idiomatic/names.js";
import { runIdiomaticGame } from "../../../core/frame-stepped.js";

const ROM_PATH = new URL("../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "ROM absent at games/timeplt/rom/maincpu.bin (BYO)" }, fn);

const { nmiReturnPC } = manifest.convergence.idiomatic;
const { actions } = manifest.inputs;

// The run length, in vblank-NMI ordinals -- the only clock a frame-stepped idiomatic run keeps. Boot
// burns no frames on a yield clock, so the tape rides ordinals, never a frame index. 600 ordinals is
// enough to boot, cross attract, take a coin, start, and settle into real play (measured below).
const NMIS = 600;

// The coin/start/play tape in NMI ordinals (the same shape the equivalence suite drives). Directions
// rotate on a period coprime with the fire period so they never phase-lock. Chosen ordinals: the coin
// banks near 101, play goes live near 161 (the assertions MEASURE that, they do not assume it).
const COIN_AT = 100, START_AT = 160, PLAY_FROM = 220, HOLD = 8, TURN = 97, FIRE_EVERY = 23, FIRE_FOR = 7;
const DIRECTIONS = [actions.up, actions.right, actions.down, actions.left];

function inputAt(n, live) {
  if (!live) return null;
  const a = {};
  const press = (act) => { a[act.port] = (a[act.port] || 0) | act.bit; };
  if (n >= COIN_AT && n < COIN_AT + HOLD) press(actions.coin);
  if (n >= START_AT && n < START_AT + HOLD) press(actions.start1);
  if (n >= PLAY_FROM) {
    press(DIRECTIONS[Math.floor((n - PLAY_FROM) / TURN) % 4]);
    if ((n - PLAY_FROM) % FIRE_EVERY < FIRE_FOR) press(actions.fire);
  }
  return a;
}

// Drive the whole wired idiomatic machine from reset for NMIS frames, folding the tape in when `live`.
// Returns the run result plus the whole-machine observations the assertions read. `mutate(mm, f)` is an
// OPTIONAL per-frame hook used ONLY by the teeth proof (below); production callers pass none.
async function runIdiomatic(live, mutate = null, nmis = NMIS) {
  const overrides = await resolveAllIdiomatic(new URL("../machine.js", import.meta.url));
  const m = await Machine.create(ROM, { overrides });

  const obs = {
    creditInit: null,
    creditMax: 0,
    coinEver: false,
    playEver: false, // PLAY_ACTIVE reached its in-play 0xff
    phaseCreditEver: false, // SEQUENCE_PHASE reached the credit / push-start state (2)
    phases: new Set(),
    bcdVals: new Set(),
    spFaults: [], // SP moved between two frame boundaries
    nmiFaults: [], // an NMI left SP somewhere other than where it found it
    spSeen: new Set(),
    eraMax: 0, // the highest ERA_INDEX seen at a frame boundary
    sweepEntries: 0, // times the era-2+ object sweep got past both of its guards (read below)
  };

  // The era-2+ sweep's entry reads the bank's slot count only after its era guard has passed, and runs
  // the per-slot sweep exactly when that read is nonzero. The count cell has other readers, so a read
  // is attributed to the sweep entry by the host call stack -- a rename of that entry turns this
  // positive control RED rather than silently vacuous.
  const realRead8 = m.mem.read8.bind(m.mem);
  m.mem.read8 = (addr) => {
    const v = realRead8(addr);
    if ((addr & 0xffff) === ATTACKER_SPAWN_SLOT_COUNT && v !== 0 &&
        new Error().stack.includes("sweepEra2PlusObjectBank")) obs.sweepEntries++;
    return v;
  };

  const hex = (v) => `0x${(v & 0xffff).toString(16).padStart(4, "0")}`;
  const realFire = m.fireNmi.bind(m);
  m.fireNmi = function () {
    const before = m.regs.sp;
    const r = realFire();
    if (m.regs.sp !== before) obs.nmiFaults.push(`${hex(before)} -> ${hex(m.regs.sp)}`);
    return r;
  };
  let prevSp = null;

  const run = runIdiomaticGame(m, {
    nmiReturnPC,
    maxFrames: nmis,
    onFrame: (mm, f) => {
      if (f < 1) return;
      mm.io.inputAssert = inputAt(f - 1, live);
      if (mutate) mutate(mm, f);
      const credit = mm.mem.read8(CREDIT_COUNT);
      const phase = mm.mem.read8(SEQUENCE_PHASE);
      if (obs.creditInit === null) obs.creditInit = credit;
      obs.creditMax = Math.max(obs.creditMax, credit);
      if (mm.mem.read8(COIN_COUNTER_PULSES_OWED)) obs.coinEver = true;
      if (mm.mem.read8(PLAY_ACTIVE) === 0xff) obs.playEver = true;
      if (phase === 2) obs.phaseCreditEver = true;
      obs.phases.add(phase);
      obs.bcdVals.add(mm.mem.read8(BCD_FRAME_COUNTER));
      obs.eraMax = Math.max(obs.eraMax, mm.mem.read8(ERA_INDEX));
      const sp = mm.regs.sp;
      obs.spSeen.add(sp);
      if (prevSp !== null && sp !== prevSp) obs.spFaults.push(`frame ${f}: ${hex(prevSp)} -> ${hex(sp)}`);
      prevSp = sp;
    },
  });

  return { m, run, obs };
}

test("boot runs the whole frame budget with no translation gap", async () => {
  const { run } = await runIdiomatic(true);
  assert.equal(
    run.stopError,
    null,
    `boot hit a translation gap / JS fault: ${run.stop}. A regression in a boot-path spine routine ` +
      "surfaces here as a NotImplemented (register it) or a real throw.",
  );
  assert.equal(
    run.frames,
    NMIS,
    `the coroutine run stopped early at frame ${run.frames} of ${NMIS}: ${run.stop}`,
  );
});

test("the coin banks a credit, and only when a coin is inserted", async () => {
  const played = await runIdiomatic(true);
  const idle = await runIdiomatic(false);

  assert.ok(
    played.obs.coinEver,
    "COIN_COUNTER_PULSES_OWED never pulsed on the driven run, so the coin path never ran",
  );
  assert.ok(
    played.obs.creditMax > played.obs.creditInit,
    `CREDIT_COUNT never rose above its power-on value ${played.obs.creditInit}; the coin did not bank a credit`,
  );
  // The control: without the coin press, no credit banks. This is what makes the arm above input-driven
  // rather than something the machine does on its own.
  assert.equal(idle.obs.coinEver, false, "the undriven run pulsed COIN_COUNTER_PULSES_OWED; the arm is not coin-driven");
  assert.equal(
    idle.obs.creditMax,
    idle.obs.creditInit,
    "the undriven run banked a credit; CREDIT_COUNT rose with no coin inserted",
  );
});

test("play actually starts, and the attract demo does not count as play", async () => {
  const played = await runIdiomatic(true);
  const idle = await runIdiomatic(false);

  assert.ok(
    played.obs.playEver,
    "PLAY_ACTIVE never reached 0xff on the driven run: coin+start did not carry the machine into real play",
  );
  // The demo runs the SAME round engine with PLAY_ACTIVE clear -- so the undriven run must never set it.
  // (It does reach SEQUENCE_PHASE 3, the round engine, which is exactly why phase alone is not a play test.)
  assert.equal(
    idle.obs.playEver,
    false,
    "the undriven attract demo set PLAY_ACTIVE=0xff; the play detector is counting the demo as a game",
  );
});

test("gameplay advances: the input-gated credit state is entered and the frame counter runs", async () => {
  const played = await runIdiomatic(true);
  const idle = await runIdiomatic(false);

  // A state transition a regression would break: the credit / push-start phase (2) is reached only by
  // driving a coin. The attract loop steps 0 -> 1 -> 3 and never visits 2.
  assert.ok(
    played.obs.phaseCreditEver,
    "SEQUENCE_PHASE never reached the credit state (2) on the driven run: the coin never advanced the sequence machine",
  );
  assert.equal(
    idle.obs.phaseCreditEver,
    false,
    "the undriven run entered the credit state (2) with no coin; the transition is not input-gated",
  );
  // A per-frame counter that keeps advancing: the free-running BCD frame counter must take many
  // distinct values across a 600-ordinal run. A stalled main loop would pin it.
  assert.ok(
    played.obs.bcdVals.size > 32,
    `BCD_FRAME_COUNTER took only ${played.obs.bcdVals.size} distinct values across ${NMIS} frames; the main loop is not advancing per frame`,
  );
});

test("SP stays inert: the interrupt is a direct call and nothing walks the stack pointer", async () => {
  const brief = (xs) => (xs.length <= 6 ? xs.join("; ") : `${xs.slice(0, 6).join("; ")} ... (${xs.length} in all)`);
  for (const live of [true, false]) {
    const { m, run, obs } = await runIdiomatic(live);
    const who = live ? "driven" : "undriven";
    assert.equal(run.stopError, null, `${who} run failed: ${run.stop}`);
    // Non-vacuity: the engine really took the direct-call branch, and the interrupt really fired.
    assert.equal(m.idiomaticNmi, true, "runIdiomaticGame did not select the direct-call interrupt");
    assert.ok(m.nmiCount >= NMIS - 1, `${who}: only ${m.nmiCount} interrupts fired`);
    assert.equal(obs.nmiFaults.length, 0, `${who}: the vblank NMI subtree moved SP: ${brief(obs.nmiFaults)}`);
    assert.equal(obs.spFaults.length, 0, `${who}: SP moved across a frame boundary: ${brief(obs.spFaults)}`);
    assert.equal(obs.spSeen.size, 1, `${who}: SP took ${obs.spSeen.size} values across the run`);
  }
});

// The long runs, in NMI ordinals. Attract crosses into the third era (ERA_INDEX 2) near ordinal 5000 and
// the driven tape near 12500 -- measured, and the positive controls below re-measure it every run. Both
// budgets leave thousands of ordinals of era-2+ play after that, which is where the object sweep runs.
const LONG_ATTRACT_NMIS = 12000;
const LONG_DRIVEN_NMIS = 30000;
const SWEPT_ERA = 2;

test("a long run stays placeable: attract and a driven session run deep, the era-2+ sweep included", async () => {
  const brief = (xs) => (xs.length <= 6 ? xs.join("; ") : `${xs.slice(0, 6).join("; ")} ... (${xs.length} in all)`);
  for (const [live, nmis] of [[false, LONG_ATTRACT_NMIS], [true, LONG_DRIVEN_NMIS]]) {
    const { run, obs } = await runIdiomatic(live, null, nmis);
    const who = live ? "driven" : "attract";
    // A dispatch that pops its caller's return slot surfaces here as the seam's placement error.
    assert.equal(run.stopError, null, `${who} long run failed at frame ${run.frames}: ${run.stop}`);
    assert.equal(run.frames, nmis, `${who}: the long run stopped at frame ${run.frames} of ${nmis}: ${run.stop}`);
    assert.equal(obs.nmiFaults.length, 0, `${who}: the vblank NMI subtree moved SP: ${brief(obs.nmiFaults)}`);
    assert.equal(obs.spFaults.length, 0, `${who}: SP moved across a frame boundary: ${brief(obs.spFaults)}`);
    assert.equal(obs.spSeen.size, 1, `${who}: SP took ${obs.spSeen.size} values across the run`);
    // Positive controls: the run reached the era whose sweep this arm exists for, and the sweep really
    // ran. Without them a run that never left the first eras would pass having proven nothing.
    assert.ok(obs.eraMax >= SWEPT_ERA, `${who}: ERA_INDEX peaked at ${obs.eraMax}; the run never reached era ${SWEPT_ERA}`);
    assert.ok(obs.sweepEntries > 0, `${who}: the era-2+ object sweep was never entered past its guards`);
    console.log(`  LONG/${who}: ${run.frames} frames, era peak ${obs.eraMax}, sweep entered ${obs.sweepEntries} times`);
  }
});
