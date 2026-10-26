// SPDX-License-Identifier: GPL-3.0-only
/**
 * runGameplayFrame — memory-equivalent to the frozen oracle at ROM 0x197A: one frame of play,
 * the fixed-order subsystem update with its three abandon gates and its death hand-off.
 * GATE:  real captures + crafted arms on top of real captures + live-wire. The captured
 *        replays are ATTRACT ONLY: every natural dispatch in an 8000-frame attract run is replayed
 *        inline, oracle against rewrite on byte-identical clones, compared on RAM −
 *        STACK_SCRATCH and the return value. ALL of them enter through the attract task at ROM
 *        0x1977; none enters through the in-game dispatch (ROM 0x00CA's game-state-3 arm),
 *        because attract never enters that state — both counts are asserted in the gate. The
 *        in-game entry path is covered only by the live-wire arm's whole-run comparison.
 *        Attract reaches three of the five arms; the board-won and bonus-expired abandons it
 *        never reaches are driven by poking one or two bytes onto REAL captured entries.
 *
 * The routine's own contribution is a fixed call ORDER, three gates that can abandon the rest of
 * the frame, and a death hand-off at the end; the arithmetic all belongs to the twenty-six
 * callees, each of which is gated separately and all of which are idiomatic and direct-called
 * here (ROM 0x1F72 is the idiomatic update25mBarrels).
 *
 *   1. CAPTURE + INLINE REPLAY — an 8000-frame attract run with 0x197A hooked. EVERY dispatch is
 *      replayed, not a sample: at each one the entry state is cloned twice, the oracle runs on one
 *      clone and runGameplayFrame on the other, they are compared, and the clones are dropped before the
 *      host continues on the oracle. Each dispatch is labelled by which addresses the ORACLE goes
 *      on to call, so the arm labels come from the oracle's behaviour and never from the
 *      candidate's. Compared on RAM − the stack scratch below the entry SP and on the return value.
 *      SP IS DELIBERATELY NOT COMPARED IN THIS ARM, and the reason is worth stating: in this
 *      harness only 0x197A is wired, so the candidate's transitive callees run in a half-wired
 *      world — idiomatic dispatchBoardCollision pushes one word for a board-collision handler
 *      whose frozen oracle (ROM 0x2880) pops two, because the second is a bracket only a
 *      translated caller opens. That is a property of the partial wiring, not of this routine, and
 *      all of it lands inside STACK_SCRATCH. Arm 3 runs the FULLY wired configuration instead and
 *      asserts SP is pinned there.
 *
 *   2. CRAFTED ARMS — attract reaches three of the five arms (see the counts the run prints). The
 *      board-won abandon and the bonus-expired abandon it never reaches, and the death hand-off it
 *      reaches only a handful of times in 8000 frames. Those three are driven by poking ONE or TWO
 *      bytes on top of a REAL captured entry, identically on both sides, and the test asserts from
 *      the ORACLE's call sequence that the poke really did land the intended arm — a crafted arm
 *      that silently failed to arm would otherwise read as coverage.
 *
 *   3. LIVE-WIRE — runGameplayFrame drives a whole CREDITED run under the coroutine engine on the
 *      shipping map (resolveAllIdiomatic), entered through the in-game dispatcher — the one live
 *      entry that still goes through the installed override (attract reaches it by a direct call
 *      from runAttractDemoFrame). The control is the same run with the frozen oracle behind the
 *      same override; in BOTH runs every callee runs whatever the shipping map gives it (minus
 *      TARGET_SUBTREE, removed in both by liveRun; each callee has its own gate), so this arm checks
 *      the routine's own order and gates, not its callees. Every live cell must match, the dispatch
 *      counts must match, and the rewrite must never move the guest SP.
 *
 *   4. TEETH — five broken twins, and the arm that catches each is asserted, not assumed. One is
 *      caught only by a crafted arm (attract never reaches the board-won abandon, so the natural
 *      captures are shown to MISS it); one is invisible to RAM and caught only by the return
 *      assertion; the dropped-bracket twin is retired (see its skip).
 *
 * Isolated replays use clone(), whose frame machinery is neutralised (nextNmi / nextBoundary =
 * Infinity), so an m.step inside the oracle cannot trip a live NMI whose handler would write RAM
 * and masquerade as an oracle side effect.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-197a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_197a as oracle } from "../../translated/loc_197a.js";
import { loc_1977 as oracle1977 } from "../../translated/loc_1977.js";
import { runGameplayFrame } from "../runGameplayFrame.js";
import { Machine, resolveAllIdiomatic } from "../../machine.js";
import manifest from "../../manifest.js";
import { installEntropyPin } from "../../../../core/entropy-pin.js";
import { runIdiomaticGame } from "../../../../core/frame-stepped.js";
import {
  BONUS_EXPIRED_STEP, MARIO_ACTIVE, MARIO_AIRBORNE, MARIO_Y, SND_TRIGGER, STACK_SCRATCH,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x197a;
const CAPTURE_FRAMES = 8000; // the attract capture + inline replay run
const CRAFT_FRAMES = 2000; // the shorter run the crafted arms take their real entry states from
const CRAFT_ENTRIES = 120; // how many real entry states the crafted arms are built on
const LIVE_FRAMES = 3000; // the live-wire run and its frozen control

const { nmiReturnPC } = manifest.convergence.idiomatic;
const hx = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/**
 * The five ways out of the cascade, in the order the routine can take them. The labels are derived
 * from the ORACLE's outgoing calls on the dispatch being replayed, so they describe what really
 * happened rather than what the candidate decided to do.
 */
const ARMS = ["abort@1e8c", "abort@1e57", "abort@1a07", "ret-nz@19ca", "full-tail"];

/** Watch a machine's dispatches for the duration of `body`, and label the arm from them. */
function armOfOracleRun(m) {
  const dispatch = m.call;
  const called = [];
  m.call = (addr, ...rest) => { called.push(addr); return dispatch.call(m, addr, ...rest); };
  let ret, threw = null;
  try { ret = oracle(m); } catch (e) { threw = e; } finally { m.call = dispatch; }
  const arm = !called.includes(0x1ac3) ? "abort@1e8c"
    : !called.includes(0x1a07) ? "abort@1e57"
      : !called.includes(0x2fcb) ? "abort@1a07"
        : !called.includes(0x011c) ? "ret-nz@19ca"
          : "full-tail";
  return { arm, ret, threw };
}

/** First differing RAM byte OUTSIDE the dead stack scratch, or null; also counts excluded bytes. */
function ramDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  let excluded = 0;
  let diff = null;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) { excluded++; continue; }
    if (diff === null) diff = { addr, a: a[i], b: b[i] };
  }
  return { diff, excluded };
}

/**
 * Replay one entry state both ways on byte-identical clones. A THROW IS A RESULT, not a crash: a
 * broken twin can walk a ROM table off its end rather than diverge, and the run must report that as
 * the breach instead of dying.
 */
function replayOne(entry, candidate, label) {
  const a = entry.clone();
  const b = entry.clone();
  const { arm, ret: want, threw: oracleThrew } = armOfOracleRun(a);
  let got, candThrew = null;
  try { got = candidate(b); } catch (e) { candThrew = e; }
  const where = `${label}[${arm}]`;

  if ((oracleThrew === null) !== (candThrew === null)) {
    return { arm, failure: `${where}: ${oracleThrew ? "the oracle" : "the candidate"} threw and the other did not — ${(oracleThrew ?? candThrew).message}` };
  }
  if (oracleThrew !== null) return { arm, failure: null }; // both threw identically — nothing to compare
  if (got !== want) {
    return { arm, failure: `${where}: return value ${String(got)} — the oracle returns ${String(want)}` };
  }
  const { diff, excluded } = ramDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
  if (diff !== null) {
    return { arm, failure: `${where}: RAM at ${hx(diff.addr)} oracle=${diff.a} candidate=${diff.b}` };
  }
  return { arm, failure: null, excluded, lowSp: Math.min(a.regs.sp, b.regs.sp) };
}

/**
 * Run attract with 0x197A hooked and replay EVERY dispatch inline against `candidate`. O(1) memory:
 * nothing is retained between dispatches. Once a breach is found the replaying stops and the host
 * finishes on the pure oracle, so a teeth pass costs about as much as a plain attract run.
 */
function captureAndReplay(candidate, frames = CAPTURE_FRAMES) {
  const armTotals = new Map(ARMS.map((a) => [a, 0]));
  let total = 0, firstFrame = null, failure = null, excluded = 0, lowSp = 0x10000;
  // Which of the two entry paths each dispatch arrived on. Both hooks delegate to the oracle, so
  // the host run is byte-for-byte the run it would be with no hook at all.
  let viaAttractTask = 0, viaInGameDispatch = 0, insideAttractTask = false;

  const attractTaskHook = (mm) => {
    insideAttractTask = true;
    try { return oracle1977(mm); } finally { insideAttractTask = false; }
  };

  const hook = (mm) => {
    if (firstFrame === null) firstFrame = mm.frames.length;
    total++;
    if (insideAttractTask) viaAttractTask++; else viaInGameDispatch++;
    if (failure === null) {
      const r = replayOne(mm, candidate, `captured dispatch #${total - 1}`);
      armTotals.set(r.arm, armTotals.get(r.arm) + 1);
      if (r.failure !== null) failure = r.failure;
      else { excluded += r.excluded; lowSp = Math.min(lowSp, r.lowSp); }
    }
    return oracle(mm); // the host run is driven by the oracle exactly as with no hook at all
  };

  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, hook], [0x1977, attractTaskHook]]),
  });
  host.runFrames(frames);
  return {
    total, firstFrame, armTotals, failure, excluded, lowSp,
    viaAttractTask, viaInGameDispatch, stoppedBy: host.stoppedBy ?? null,
  };
}

/** A handful of REAL entry states, for the crafted arms to be built on. */
function captureEntries(n = CRAFT_ENTRIES, frames = CRAFT_FRAMES) {
  const kept = [];
  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => { if (kept.length < n) kept.push(mm.clone()); return oracle(mm); }]]),
  });
  host.runFrames(frames);
  return kept;
}

/**
 * The three arms attract does not (or barely) produce. Each poke is applied to a REAL capture, on
 * the shared base BEFORE either side is cloned from it, so both sides see exactly the same entry.
 */
const CRAFTS = [
  {
    name: "board won: Mario up on the rescue row",
    arm: "abort@1e57",
    // The girder board's win test compares Mario's screen Y against the rescue row; attract plays
    // the girder board but never climbs that far. The bonus-expired machine is armed at its INIT
    // step in the same breath — NOT to reach that arm (the board-won abandon happens first) but to
    // MANUFACTURE AN OBSERVABLE: with the step idle, everything the abandon skips is a no-op on
    // this state, so a routine that ignored the abandon would leave RAM identical and the arm
    // would have no teeth. Armed, the very next thing the skip suppresses writes two bytes.
    poke: (mm) => { mm.mem.write8(MARIO_Y, 0x20); mm.mem.write8(BONUS_EXPIRED_STEP, 1); },
    everyEntry: true,
  },
  {
    name: "bonus expired: the wait-and-exit step, Mario grounded",
    arm: "abort@1a07",
    // The bonus-expired machine's last step takes the death exit once Mario is on the ground.
    // Attract's bonus never expires, so the step byte stays at its idle value.
    poke: (mm) => { mm.mem.write8(BONUS_EXPIRED_STEP, 3); mm.mem.write8(MARIO_AIRBORNE, 0); },
    everyEntry: false, // the movement update can launch Mario again before the step is reached
  },
  {
    name: "death hand-off: Mario already inactive at entry",
    arm: "full-tail",
    poke: (mm) => mm.mem.write8(MARIO_ACTIVE, 0),
    everyEntry: false, // a frame that revives him leaves the ordinary end-of-frame arm
  },
];

/** Replay one crafted arm over every captured entry. Returns the first breach and the arm tally. */
function replayCrafted(entries, craft, candidate) {
  let failure = null, armed = 0;
  for (let i = 0; i < entries.length; i++) {
    const base = entries[i].clone();
    craft.poke(base);
    const r = replayOne(base, candidate, `${craft.name} #${i}`);
    if (r.arm === craft.arm) armed++;
    if (failure === null && r.failure !== null) failure = r.failure;
  }
  return { failure, armed };
}

// -- 1. CAPTURE + INLINE REPLAY -----------------------------------------------

test("CAPTURED DISPATCHES: runGameplayFrame matches the oracle on every natural dispatch (RAM − the stack scratch below the entry SP + return)", () => {
  const r = captureAndReplay(runGameplayFrame);

  assert.equal(r.stoppedBy, null, `capture run stopped early: ${r.stoppedBy}`);
  assert.ok(r.total > 0, "0x197A is dispatched every gameplay frame; zero means the attract chain regressed");
  assert.equal(r.failure, null, "runGameplayFrame diverged from the oracle on a real captured dispatch");

  // What attract actually reaches, asserted rather than described — if the demo ever stops
  // producing one of these the header's coverage claim must change with it.
  const seen = ARMS.filter((a) => r.armTotals.get(a) > 0);
  assert.deepEqual(
    seen, ["abort@1e8c", "ret-nz@19ca", "full-tail"],
    `attract is expected to reach exactly these three arms; saw ${seen.join(",")}`,
  );
  // The exclusion has to actually cover both sides' stack traffic, or it is hiding a difference
  // rather than tolerating a known-dead one.
  assert.ok(
    r.lowSp >= STACK_SCRATCH.lo,
    `stack traffic reached ${hx(r.lowSp)}, below STACK_SCRATCH ${hx(STACK_SCRATCH.lo)} — the exclusion no longer covers it`,
  );
  // WHICH ENTRY PATH THIS COVERS, asserted rather than asserted-by-omission. There are exactly two
  // references to 0x197A in the tree: the attract task's tail at ROM 0x1977, and ROM 0x00CA's
  // game-state-3 dispatch. Attract never enters game state 3, so the second is NOT covered here —
  // this pins that limitation down instead of leaving the header to claim otherwise.
  assert.equal(r.viaAttractTask, r.total, "some dispatch arrived by a path this run does not account for");
  assert.equal(r.viaInGameDispatch, 0, "attract reached the in-game entry path — the header's coverage limitation is now wrong");

  console.log(
    `  CAPTURED: all ${r.total} of ${r.total} natural dispatches replayed over ${CAPTURE_FRAMES} attract ` +
      `frames (first at frame ${r.firstFrame}; arms: ${ARMS.map((a) => `${a}=${r.armTotals.get(a)}`).join(" ")}); ` +
      `RAM − the stack scratch below the entry SP and return value identical; ${r.excluded} byte(s) of excluded stack ` +
      `scratch, low-water SP ${hx(r.lowSp)}. Entry path: ${r.viaAttractTask} via the attract task ` +
      `(ROM 0x1977), ${r.viaInGameDispatch} via the in-game dispatch — the in-game path is NOT covered.`,
  );
});

// -- 2. CRAFTED ARMS ----------------------------------------------------------

test("CRAFTED ARMS: the two abandons attract never reaches, and the death hand-off it barely reaches", () => {
  const entries = captureEntries();
  assert.equal(entries.length, CRAFT_ENTRIES, "did not capture the intended number of real entry states");

  for (const craft of CRAFTS) {
    const { failure, armed } = replayCrafted(entries, craft, runGameplayFrame);
    // A poke that failed to arm the intended branch would leave this case replaying the SAME arm
    // the natural captures already cover, while reading as new coverage.
    assert.ok(armed > 0, `"${craft.name}" never produced the ${craft.arm} arm — the crafted entry is not arming anything`);
    if (craft.everyEntry) {
      assert.equal(armed, entries.length, `"${craft.name}" was expected to arm on every entry; armed ${armed}/${entries.length}`);
    }
    assert.equal(failure, null, `runGameplayFrame diverged from the oracle on the crafted "${craft.name}" arm`);
    console.log(`  CRAFTED/${craft.name}: ${armed} of ${entries.length} real entries took the ${craft.arm} arm, all identical`);
  }
});

// -- 3. LIVE-WIRE -------------------------------------------------------------

// The 0x197A gameplay-frame subtree's barrel/object callees; liveRun deletes them from the override map
// in both runs (0x1F8D has no override, so its delete is a no-op). Entered through the registry from the
// frozen oracle, an idiomatic body would not consume the call bracket the oracle opens -- a HALF-WIRED
// stack artifact, not a routine defect. In the LIVE-WIRE run no registry call reaches any of them: the
// others' idiomatic callers reach them by direct import, and 0x1F8D's callers (ROM 0x1F72, 0x1F83,
// 0x21BA) run as idiomatic overrides that never call it. 0x1F72 is not in the list: the rewrite calls
// update25mBarrels directly, and the frozen control's call to it is bracketed and consumed like any
// other wired override.
const TARGET_SUBTREE = [
  0x062a, 0x1c05, 0x1f8d, 0x1fac, 0x2053, 0x2101, 0x2118, 0x2146, 0x2153, 0x215f, 0x2b1c,
];
// Coin then 1P start (IN2 bit7 / bit2), then walk right and jump so play is not idle.
const IN2 = 0x7d00, IN0 = 0x7c00;
const CREDITED_TAPE = [
  { frame: 200, port: IN2, bits: 0x80, dur: 8 },
  { frame: 300, port: IN2, bits: 0x04, dur: 8 },
  { frame: 600, port: IN0, bits: 0x01, dur: 400 },
  { frame: 1100, port: IN0, bits: 0x10, dur: 4 },
];
const GUEST_SP = 0x6c00; // seated for the frozen control only: the idiomatic engine never uses a guest stack

/**
 * One CREDITED run under the coroutine engine on the shipping map (resolveAllIdiomatic) with the
 * subtree frozen and `candidate` wired at 0x197A behind a dispatch counter. In play the in-game
 * dispatcher reaches 0x197A through the installed override -- the one live entry that still goes
 * through the registry, since attract calls runAttractDemoFrame -> runGameplayFrame directly. The
 * frozen oracle `ret`s into a continuation, so its arm pushes one (`bracket`) and restores the entry
 * SP after; the guest SP is seated once at power-on. The rewrite neither pushes nor pops, and its SP
 * is asserted unmoved -- the control's is harness-managed, so only the candidate's is evidence.
 */
async function liveRun(candidate, bracket, frames = LIVE_FRAMES) {
  const ov = await resolveAllIdiomatic();
  assert.equal(ov.has(TARGET), true, "0x197A should be in ROUTINES");
  for (const a of TARGET_SUBTREE) ov.delete(a);
  let dispatches = 0;
  ov.set(TARGET, (mm) => {
    dispatches++;
    if (!bracket) return candidate(mm);
    // The frozen control: open the continuation its `ret` consumes, then restore the entry SP, since
    // an oracle arm that tail-jumps onward (no `ret` of its own) leaves that word unconsumed.
    const sp0 = mm.regs.sp;
    mm.push16(0x0000);
    try { return candidate(mm); } finally { mm.regs.sp = sp0; }
  });
  const m = new Machine(ROM, { overrides: ov });
  installEntropyPin(m, manifest.entropyPin);
  m.inputTape = CREDITED_TAPE.map((t) => ({ ...t }));
  const trace = [];
  const spTrace = [];
  const sps = new Set();
  const r = runIdiomaticGame(m, {
    bootAddr: 0x0000,
    nmiReturnPC,
    maxFrames: frames,
    onFrame: (mm, frame) => {
      if (frame === 0) mm.regs.sp = GUEST_SP;
      mm.applyInputs(frame);
      trace.push(Buffer.from(mm.dumpState()));
      sps.add(mm.regs.sp);
      spTrace.push(mm.regs.sp);
    },
  });
  return { m, trace, dispatches, sps, spTrace, run: r };
}

/** First frame+byte where two traces differ, split into live cells and dead stack scratch. */
function firstTraceDiff(base, other, offToAddr, floors) {
  let full = null;
  for (let f = 0; f < Math.min(base.length, other.length); f++) {
    const a = base[f], b = other[f];
    const dead = deadStackBelow(STACK_SCRATCH, floors[f]);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      const d = { frame: f, addr: offToAddr(i), a: a[i], b: b[i] };
      if (full === null) full = d;
      if (!dead(d.addr)) return { full, live: d };
    }
  }
  return { full, live: null };
}

test("LIVE-WIRE: runGameplayFrame, dispatched by the in-game table, drives a credited run identically to the frozen oracle", async () => {
  const ctl = await liveRun(oracle, true);
  assert.equal(ctl.run.stopError, null, `frozen-control run errored: ${ctl.run.stop}`);
  assert.ok(ctl.run.frames >= LIVE_FRAMES, `frozen control covered only ${ctl.run.frames}/${LIVE_FRAMES} frames`);

  const cand = await liveRun(runGameplayFrame, false);
  assert.equal(cand.run.stopError, null, `live-wire run errored: ${cand.run.stop}`);
  assert.ok(cand.run.frames >= LIVE_FRAMES, `live-wire run covered only ${cand.run.frames}/${LIVE_FRAMES} frames`);
  // Without this the arm can pass while the routine never runs at all.
  assert.ok(cand.dispatches > 0, "the override was never dispatched — this arm would be vacuous");
  assert.equal(cand.dispatches, ctl.dispatches, "the rewrite ran a different number of times than the oracle did");

  // THE STACK ASSERTION. The rewrite must leave the guest SP exactly where it was seated.
  assert.deepEqual([...cand.sps], [GUEST_SP], `live-wire moved the guest SP: ${[...cand.sps].map(hx).join(",")}`);

  const d = firstTraceDiff(ctl.trace, cand.trace, (o) => ctl.m.stateOffsetToAddr(o), frameFloors(ctl.spTrace, cand.spTrace));
  assert.equal(
    d.live, null,
    d.live && `frame ${d.live.frame} diverged at ${hx(d.live.addr)}: frozen=${d.live.a} live-wire=${d.live.b}`,
  );
  console.log(
    `  LIVE-WIRE: ${cand.dispatches} in-game dispatches over ${LIVE_FRAMES} credited frames — every live cell ` +
      "identical to the frozen oracle, guest SP never moved" +
      (d.full ? ` (dead stack scratch differs, first at frame ${d.full.frame}, ${hx(d.full.addr)})` : ""),
  );
});

// -- 4. TEETH -----------------------------------------------------------------

// Each twin is a copy of the real routine with ONE thing wrong. They call the same idiomatic
// callees the real file does, so what is being tested is the sequencing and the guards.
import { dispatchEffectState } from "../dispatchEffectState.js";
import { runHitEffectInsteadOfPlay } from "../runHitEffectInsteadOfPlay.js";
import { dispatchMarioMovement } from "../dispatchMarioMovement.js";
import { update25mBarrels } from "../update25mBarrels.js";
import { driveBarrelRelease } from "../driveBarrelRelease.js";
import { scheduleBarrelRelease } from "../scheduleBarrelRelease.js";
import { updateFires } from "../updateFires.js";
import { update75mActorObjects } from "../update75mActorObjects.js";
import { update50mMovingObjects } from "../update50mMovingObjects.js";
import { raisePeriodicObjectSpawnRequests } from "../raisePeriodicObjectSpawnRequests.js";
import { driveHammerSprite } from "../driveHammerSprite.js";
import { dispatch50mObjectState } from "../dispatch50mObjectState.js";
import { collectEdgeRivet } from "../collectEdgeRivet.js";
import { startMarioFallWhenGroundGivesWay } from "../startMarioFallWhenGroundGivesWay.js";
import { beginMarioFall } from "../beginMarioFall.js";
import { service75mBoard } from "../service75mBoard.js";
import { update50mConveyorObjects } from "../update50mConveyorObjects.js";
import { scanObjectsAtMarioX } from "../scanObjectsAtMarioX.js";
import { slide50mSpriteRowAndServiceColorCycle } from "../slide50mSpriteRowAndServiceColorCycle.js";
import { killMarioOnObjectCollision } from "../killMarioOnObjectCollision.js";
import { recordHammerHitOnObject } from "../recordHammerHitOnObject.js";
import { checkBoardWonByType } from "../checkBoardWonByType.js";
import { dispatchBonusExpiredStep } from "../dispatchBonusExpiredStep.js";
import { tickTimedBoardBonus } from "../tickTimedBoardBonus.js";
import { silenceSound } from "../silenceSound.js";
import { advanceSubstateAndArmTimer } from "../advanceSubstateAndArmTimer.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { frameFloors } from "./_frame-sp.js";

/** The middle of the cascade, shared by every twin so each one differs in exactly one thing. */
function body(m) {
  dispatchMarioMovement(m);
  // The 25m object walk is now fully idiomatic: a direct call, no guest-stack bracket (the dissolved
  // update25mBarrels drives a JS for-loop and rets through JS, so 0x1F72 no longer needs a bracket).
  update25mBarrels(m);
  driveBarrelRelease(m);
  scheduleBarrelRelease(m);
  updateFires(m);
  update75mActorObjects(m);
  update50mMovingObjects(m);
  raisePeriodicObjectSpawnRequests(m);
  driveHammerSprite(m);
  dispatch50mObjectState(m);
  collectEdgeRivet(m);
  startMarioFallWhenGroundGivesWay(m);
  beginMarioFall(m);
  service75mBoard(m);
  update50mConveyorObjects(m);
  scanObjectsAtMarioX(m);
  slide50mSpriteRowAndServiceColorCycle(m);
  killMarioOnObjectCollision(m);
  recordHammerHitOnObject(m);
}

/** Twin (a): the effect-latch gate's decision is ignored — the frame runs on top of the effect. */
function brokenNoLatchGuard(m) {
  dispatchEffectState(m);
  runHitEffectInsteadOfPlay(m);
  body(m);
  if (!checkBoardWonByType(m)) return;
  if (!dispatchBonusExpiredStep(m)) return;
  tickTimedBoardBonus(m);
  if (m.mem8[MARIO_ACTIVE] !== 0) return;
  silenceSound(m);
  m.mem8[SND_TRIGGER + 2] = 3;
  return advanceSubstateAndArmTimer(m);
}

/** Twin (b): the board-won gate's decision is ignored — the frame keeps going after the win. */
function brokenNoBoardWonGuard(m) {
  dispatchEffectState(m);
  if (!runHitEffectInsteadOfPlay(m)) return;
  body(m);
  checkBoardWonByType(m);
  if (!dispatchBonusExpiredStep(m)) return;
  tickTimedBoardBonus(m);
  if (m.mem8[MARIO_ACTIVE] !== 0) return;
  silenceSound(m);
  m.mem8[SND_TRIGGER + 2] = 3;
  return advanceSubstateAndArmTimer(m);
}

/** Twin (c): the death hand-off runs unconditionally, whether or not Mario is still active. */
function brokenUnconditionalDeathTail(m) {
  dispatchEffectState(m);
  if (!runHitEffectInsteadOfPlay(m)) return;
  body(m);
  if (!checkBoardWonByType(m)) return;
  if (!dispatchBonusExpiredStep(m)) return;
  tickTimedBoardBonus(m);
  silenceSound(m);
  m.mem8[SND_TRIGGER + 2] = 3;
  return advanceSubstateAndArmTimer(m);
}

/** Twin (d): propagates a boolean instead of returning nothing. RAM is IDENTICAL — at the seam a
 *  `false` would make this routine look caller-skip-capable and discard a stack word it does not
 *  owe. Only the return assertion can see it. */
function brokenReturnsBoolean(m) {
  dispatchEffectState(m);
  if (!runHitEffectInsteadOfPlay(m)) return false;
  body(m);
  if (!checkBoardWonByType(m)) return false;
  if (!dispatchBonusExpiredStep(m)) return false;
  tickTimedBoardBonus(m);
  if (m.mem8[MARIO_ACTIVE] !== 0) return true;
  silenceSound(m);
  m.mem8[SND_TRIGGER + 2] = 3;
  advanceSubstateAndArmTimer(m);
  return true;
}

// Twin (e) — the "dropped oracle-boundary return bracket before ROM 0x1F72" tooth — is RETIRED with
// this change: 0x1F72 (the 25m object walk) is now the idiomatic update25mBarrels, a JS for-loop that
// rets through JS and touches no guest stack, so there is no return bracket to drop and no stack
// imbalance for a live-wire run to catch. The bracket's removal is exactly this dissolution; the
// whole-frame guest-stack balance is proved by idiomatic.test.js's FULL FLIP.

test("TEETH: the captured-replay arm catches a dropped effect-latch guard and an unconditional death tail", () => {
  for (const [name, twin] of [
    ["dropped effect-latch guard", brokenNoLatchGuard],
    ["unconditional death tail", brokenUnconditionalDeathTail],
  ]) {
    const r = captureAndReplay(twin, CRAFT_FRAMES);
    assert.notEqual(r.failure, null, `the captured replay FAILED to catch "${name}" — worthless`);
    console.log(`  TEETH/${name}: caught — ${r.failure}`);
  }
});

test("TEETH: a dropped board-won guard ESCAPES every natural capture and is caught ONLY by the crafted arm", () => {
  // Half one: attract never wins a board, so the natural captures cannot see this.
  const natural = captureAndReplay(brokenNoBoardWonGuard, CRAFT_FRAMES);
  assert.ok(natural.total > 0, "the natural run captured nothing, so 'it escapes' would be vacuous");
  assert.equal(
    natural.failure, null,
    `this twin was expected to be invisible to the natural captures; if it is not, the coverage claim above is wrong (${natural.failure})`,
  );

  // Half two: the crafted board-won entry catches it.
  const entries = captureEntries();
  const craft = CRAFTS.find((c) => c.arm === "abort@1e57");
  const { failure, armed } = replayCrafted(entries, craft, brokenNoBoardWonGuard);
  assert.notEqual(failure, null, "the crafted board-won arm FAILED to catch a dropped board-won guard — worthless");
  console.log(
    `  TEETH/dropped board-won guard: invisible to all ${natural.total} natural dispatches, caught by ` +
      `the crafted arm (${armed}/${entries.length} armed) — ${failure}`,
  );
});

test("TEETH: a propagated boolean is invisible to the RAM diff and caught ONLY by the return assertion", () => {
  const r = captureAndReplay(brokenReturnsBoolean, CRAFT_FRAMES);
  assert.notEqual(r.failure, null, "the captured replay FAILED to catch a propagated boolean — worthless");
  assert.match(
    r.failure, /return value/,
    `expected the RETURN assertion to be what catches this twin, not the RAM diff (${r.failure})`,
  );
  console.log(`  TEETH/propagated boolean: caught — ${r.failure}`);
});

// RETIRED with twin (e): the object-walk return bracket this tooth dropped no longer exists — 0x1F72
// is the idiomatic update25mBarrels (a JS for-loop, no guest-stack ret). The whole-frame guest-stack
// balance is covered by idiomatic.test.js's FULL FLIP ("guest stack balanced every frame").
nodeTest("TEETH: retired — 0x1F72's return bracket is dissolved; FULL FLIP proves the frame's stack balance", {
  skip: "retired: the 25m object walk (0x1F72) is now idiomatic update25mBarrels with no guest-stack bracket to drop; whole-frame guest-stack balance covered by idiomatic.test.js (FULL FLIP)",
}, () => {});
