// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for animateIntroClimbStep (ROM 0x0AE8) — step 2 of the opening
 * Kong-climb cutscene: `call 0x306F` (animate the block) / `call z,0x304A` (16th-tick
 * scroll) / `cp 0x5D` on the climbing figure's Y — stay in step 2 while >= 0x5D, else
 * advance INTRO_STEP and arm the next phase.
 *
 * loc_0ae8 WRITES memory and is NOT a leaf: it calls animateSpriteObjectBlock (0x306F,
 * which stirs the PRNG + edits the sprite block) and scrollClimbGraphicStep (0x304A, which
 * writes video RAM). So it is gated by capture / clone / replay (docs/decompiler-pipeline) on MEMORY-
 * equivalence against the frozen oracle — RAM − the stack scratch below the entry SP — never the full register
 * file and never cycles, with a FRESH clone per case. Its four branch combinations are the
 * cross of two independent data-dependent branches: `call z,0x304A` (taken iff
 * (0x62AF & 0x0F)==0, the 16th-tick scroll) and `ret nc` (exit-A "still climbing" iff
 * 0x690B >= 0x5D, else exit-B "topped out": arm SUBSTATE_TIMER, inc INTRO_STEP, seed
 * SEQ_ADVANCE_PTR). animateIntroClimbStep models no Z80 stack, so — unlike the oracle's
 * push16/call/ret — it leaves SP and pc at entry; the oracle's stack churn is confined to
 * STACK_SCRATCH, which is exactly why the contract excludes that region and the replay does
 * not compare SP/pc against the oracle.
 *
 * loc_0ae8 dispatches ZERO times in plain attract (the intro cutscene is a credited game's
 * per-board head, GAME_SUBSTATE 7), so it is validated on a DRIVEN coin+start run plus
 * crafted entries for the arm the run never reaches:
 *
 *   1. REALISM (captured driven dispatches) — drive coin+start into a credited game so the
 *      opening cutscene plays, hook 0x0ae8, and clone the machine at every real dispatch.
 *      Replay oracle-vs-idiomatic on fresh clones and prove RAM(−stack) identical; assert
 *      the natural distribution actually exercised the scroll arm and the exit-A arm (so an
 *      EQUAL result is not vacuous), and that the idiomatic side left SP/pc untouched.
 *
 *   2. CRAFTED (forced exit-B, incl. the never-natural combo) — the run tops the climb out
 *      only once, and never on a scroll tick. On real captured states poke the two inputs
 *      identically on both sides to force: (a) call-skipped AND exit-B, and (b) the
 *      never-natural call-taken AND exit-B. Prove RAM(−stack) identical AND that the oracle
 *      really took the advance path (INTRO_STEP+1, SUBSTATE_TIMER=0x20, SEQ_ADVANCE_PTR=0x6385).
 *
 *   3. TEETH — two twins the cases above MUST catch: (a) a dropped INTRO_STEP advance,
 *      caught by a forced exit-B naming 0x6385; (b) a wrong scroll gate (& 0x07 for & 0x0F),
 *      caught by a forced scroll-boundary entry naming the scroll index 0x638E.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0ae8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ae8 as oracle } from "../../translated/loc_0ae8.js";
import { animateIntroClimbStep as idiomatic } from "../animateIntroClimbStep.js";
import { animateSpriteObjectBlock } from "../animateSpriteObjectBlock.js";
import { scrollClimbGraphicStep } from "../scrollClimbGraphicStep.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, INTRO_STEP, SEQ_ADVANCE_PTR, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0ae8;
const TICK_COUNTER = 0x62af; // the 1-in-16 tick counter animateSpriteObjectBlock bumps
const CLIMBER_Y = SPRITE_OBJ_BLOCK + 3; // 0x690B — record 0's Y byte
const SCROLL_INDEX = 0x638e; // scrollClimbGraphicStep's per-step scroll counter
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A coin+start tape (as in the 0x0a76 dispatcher test): coin on IN2 bit7 at frame 10,
// start1 on IN2 bit2 at frame 30. This credits + starts a game so GAME_STATE reaches 3,
// the opening cutscene (sub-state 7) plays, and 0x0ae8 dispatches while INTRO_STEP == 2.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Drive a coin+start game and clone the machine at every real 0x0ae8 dispatch (dispatchGameState
 * consults m.overrides for the computed target before dispatching, so an override at 0x0ae8 is
 * hit). The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Capturing is gated off after the host run so the isolated replays below cannot
 * pollute it.
 */
function captureDrivenDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

let _base = null;
function craftedBase() {
  if (!_base) {
    const caps = captureDrivenDispatches(1, 800);
    assert.ok(caps.length >= 1, "expected a real 0x0ae8 cutscene dispatch to craft from");
    _base = caps[0];
  }
  return _base;
}


test("REALISM: real captured cutscene 0x0ae8 dispatches — RAM(−stack) identical; SP/pc untouched", () => {
  const caps = captureDrivenDispatches(400, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x0ae8 dispatch during the opening cutscene");

  let compared = 0, exitA = 0, exitB = 0, scrolls = 0, spPcHeld = 0;
  for (const cap of caps) {
    const a = cap.clone(); // oracle
    const aFloor = a.regs.sp;
    const b = cap.clone(); // idiomatic

    // The idiomatic side models no Z80 stack — SP and pc must be exactly as at entry.
    const sp0 = b.regs.sp, pc0 = b.pc;
    oracle(a);
    idiomatic(b);
    if (b.regs.sp === sp0 && b.pc === pc0) spPcHeld++;

    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(
      bad,
      null,
      bad && `real-dispatch RAM diff at ${hx(bad.addr)}: oracle=${bad.a} idiomatic=${bad.b}`,
    );

    // Classify from the oracle so the coverage counts are non-vacuous.
    if (a.mem.read8(INTRO_STEP) !== cap.mem.read8(INTRO_STEP)) exitB++; else exitA++;
    if (a.mem.read8(SCROLL_INDEX) !== cap.mem.read8(SCROLL_INDEX)) scrolls++;
    compared++;
  }

  assert.equal(spPcHeld, compared, "animateIntroClimbStep must leave SP/pc untouched on every dispatch");
  assert.ok(exitA >= 1, "expected many exit-A (still-climbing) dispatches");
  assert.ok(scrolls >= 1, "expected the 16th-tick scroll arm to fire at least once naturally");
  console.log(
    `  REALISM: ${compared} real dispatches — RAM(−stack) identical; ` +
      `${exitA} exit-A, ${exitB} exit-B, ${scrolls} scroll ticks; SP/pc held on all`,
  );
});


/**
 * Force one branch combination onto a real captured state, identically on both sides.
 * `tick` is poked into 0x62AF (animateSpriteObjectBlock increments it, so the value
 * loc_0ae8 tests is tick+1) and `y` into 0x690B (the climb Y the `cp 0x5d` reads).
 * Returns [oracleClone, idiomaticClone] already run.
 */
function runCrafted(tick, y) {
  const a = craftedBase().clone(), b = craftedBase().clone();
  for (const m of [a, b]) {
    m.mem.write8(TICK_COUNTER, tick);
    m.mem.write8(CLIMBER_Y, y);
  }
  oracle(a);
  idiomatic(b);
  return [a, b];
}

test("CRAFTED: forced exit-B (call-skipped AND the never-natural call-taken) — RAM(−stack) identical", () => {
  // (a) call-SKIPPED + exit-B: 0x62AF 0x00 -> tick 0x01 (nibble 1, no scroll; and not an
  //     8th call, so 0x690B is untouched by 0x306F), 0x690B 0x59 (< 0x5D -> exit-B).
  const [a1, b1] = runCrafted(0x00, 0x59);
  const d1 = ramDiffMinusStack(a1, b1, craftedBase().regs.sp);
  assert.equal(d1.bad, null, d1.bad && `call-skipped exit-B RAM diff at ${hx(d1.bad.addr)} (oracle=${d1.bad.a} idiomatic=${d1.bad.b})`);
  // Non-vacuous: the oracle really took the advance path.
  assert.equal(a1.mem.read8(INTRO_STEP), (craftedBase().mem.read8(INTRO_STEP) + 1) & 0xff, "oracle must inc INTRO_STEP on exit-B");
  assert.equal(a1.mem.read8(SUBSTATE_TIMER), 0x20, "oracle must arm SUBSTATE_TIMER=0x20 on exit-B");
  assert.equal(a1.mem.read8(SEQ_ADVANCE_PTR), 0x85, "oracle must seed SEQ_ADVANCE_PTR lo = 0x85 (0x6385)");
  assert.equal(a1.mem.read8(SEQ_ADVANCE_PTR + 1), 0x63, "oracle must seed SEQ_ADVANCE_PTR hi = 0x63 (0x6385)");

  // (b) call-TAKEN + exit-B (never occurs naturally): 0x62AF 0x0F -> tick 0x10 (nibble 0 ->
  //     scroll; also an 8th call, so 0x306F scrolls the Y bytes up 4), 0x690B 0x59 -> 0x55
  //     after 0x306F, still < 0x5D -> exit-B. Exercises scroll AND advance in one frame.
  const [a2, b2] = runCrafted(0x0f, 0x59);
  const d2 = ramDiffMinusStack(a2, b2, craftedBase().regs.sp);
  assert.equal(d2.bad, null, d2.bad && `call-taken exit-B RAM diff at ${hx(d2.bad.addr)} (oracle=${d2.bad.a} idiomatic=${d2.bad.b})`);
  assert.equal(a2.mem.read8(INTRO_STEP), (craftedBase().mem.read8(INTRO_STEP) + 1) & 0xff, "combo: oracle must inc INTRO_STEP");
  assert.notEqual(a2.mem.read8(SCROLL_INDEX), craftedBase().mem.read8(SCROLL_INDEX), "combo: the scroll arm must have fired");
  console.log("  CRAFTED: call-skipped exit-B and call-taken exit-B — RAM(−stack) identical; advance path exercised");
});


/** Twin (a): drops the `inc (INTRO_STEP)` on exit-B — everything else faithful, so the
 *  cutscene would hang on step 2 forever. Only an exit-B case diverges (at 0x6385). */
function brokenDropAdvance(m) {
  const { mem } = m;
  animateSpriteObjectBlock(m);
  if ((mem.read8(TICK_COUNTER) & 0x0f) === 0) scrollClimbGraphicStep(m);
  if (mem.read8(CLIMBER_Y) >= 0x5d) return;
  mem.write8(SUBSTATE_TIMER, 0x20);
  // BUG: no INTRO_STEP advance
  mem.write16(SEQ_ADVANCE_PTR, INTRO_STEP);
}

/** Twin (b): gates the scroll on (0x62AF & 0x07) instead of & 0x0F — scrolls twice as
 *  often. Agrees with the oracle except when the tick's low nibble is exactly 0x08. */
function brokenScrollGate(m) {
  const { mem } = m;
  animateSpriteObjectBlock(m);
  if ((mem.read8(TICK_COUNTER) & 0x07) === 0) scrollClimbGraphicStep(m); // BUG: 0x07 should be 0x0f
  if (mem.read8(CLIMBER_Y) >= 0x5d) return;
  mem.write8(SUBSTATE_TIMER, 0x20);
  mem.write8(INTRO_STEP, (mem.read8(INTRO_STEP) + 1) & 0xff);
  mem.write16(SEQ_ADVANCE_PTR, INTRO_STEP);
}

test("TEETH (drop-advance): the dropped INTRO_STEP inc is CAUGHT on exit-B and names 0x6385", () => {
  // A forced exit-B (call-skipped): 0x62AF 0x00 -> tick 0x01, 0x690B 0x59 -> exit-B.
  const a = craftedBase().clone(), b = craftedBase().clone();
  const aFloor = a.regs.sp;
  for (const m of [a, b]) { m.mem.write8(TICK_COUNTER, 0x00); m.mem.write8(CLIMBER_Y, 0x59); }
  oracle(a);
  brokenDropAdvance(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the exit-B case FAILED to catch a dropped INTRO_STEP advance — it is worthless");
  assert.equal(bad.addr, INTRO_STEP, `expected the caught diff at 0x6385, got ${hx(bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at INTRO_STEP 0x6385 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (scroll-gate): the & 0x07 scroll gate is CAUGHT at a nibble-8 tick and names 0x638E", () => {
  // Force the tick loc_0ae8 tests to be 0x08 (low nibble 8): poke 0x62AF 0x07 -> +1 = 0x08.
  // 0x08 & 0x0F == 8 -> oracle SKIPS the scroll; 0x08 & 0x07 == 0 -> the twin SCROLLS.
  // 0x690B 0x80 keeps it exit-A (0x08 is an 8th call, so 0x306F drops Y to 0x7C, still >= 0x5D),
  // isolating the scroll difference at the scroll index 0x638E.
  const a = craftedBase().clone(), b = craftedBase().clone();
  const aFloor = a.regs.sp;
  for (const m of [a, b]) { m.mem.write8(TICK_COUNTER, 0x07); m.mem.write8(CLIMBER_Y, 0x80); }
  oracle(a);
  brokenScrollGate(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the nibble-8 case FAILED to catch a wrong scroll gate — it is worthless");
  assert.equal(bad.addr, SCROLL_INDEX, `expected the caught diff at the scroll index 0x638E, got ${hx(bad.addr)}`);
  console.log(`  TEETH/scroll-gate: caught at scroll index 0x638E (oracle=${bad.a} broken=${bad.b})`);
});
