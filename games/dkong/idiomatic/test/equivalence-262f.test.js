// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_262f (ROM 0x262F) — the SECOND per-frame driver in sub_25f2's
 * timed-object cascade. It picks an arm by Mario's vertical position, then runs the shared
 * publish/animate tail loc_264c:
 *   - MARIO_Y below 0xC0 (Mario high) -> loc_266f (force object-2's step-direction negative),
 *   - MARIO_Y at/above 0xC0 -> on EVEN frames tick the M50_OBJ2_REVERSE_TIMER (0x62A2) down
 *     (reload 0xC0 + reverse M50_OBJ2_STEP_DIR (0x62A3) on underflow); an ODD frame skips the
 *     timer and drops straight into the tail.
 *
 * loc_262f WRITES MEMORY and tail-calls idiomatic sub-routines, so it is gated on memory-
 * equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never the register file.
 * LIVE-OUT is memory-only: every exit is a tail-call into loc_264c whose successor reloads
 * the accumulator before reading it, so A/HL/flags are dead ABI. Each of the three direct
 * callees (loc_266f, reverseStepDirection, loc_264c) is idiomatic and touches no stack, so
 * loc_262f performs ZERO stack ops; the oracle nets exactly ONE caller-return `ret` on every
 * path (its internal push16(0x264c)/sub_26de bracket cancels, then loc_264c's terminal `ret`
 * pops the caller). So runCandidate does ONE m.ret() after the call to line pc + SP up with
 * the oracle; the oracle's push/ret churn all lands inside the excluded STACK_SCRATCH.
 *
 *   0. REACHABILITY — plain attract never dispatches 0x262F (0× / 2500 frames, asserted):
 *      the whole sub_25f2 object cascade is board-2 gated (`rst 0x30` mask 0x02) and attract
 *      plays 25m. That is why the gate is crafted-entry (pokes on a real booted machine).
 *
 *   1. EQUAL (FRAME sweep, Mario low) — for all 256 FRAME values × memory configs (timer
 *      about-to-underflow vs mid; latch sign clear vs set; ring-valued sprite counters),
 *      Mario forced at/below the threshold, confirm loc_262f == oracle. Covers even/odd
 *      parity, every FRAME & 0x1F residue (the tail's 32nd-frame advance gate), the underflow
 *      reload+reverse arm, and both latch signs.
 *
 *   2. EQUAL (FRAME sweep, Mario high) — the same 256 FRAME values × latch sign {clear,set}
 *      with Mario ABOVE the threshold, exercising the loc_266f arm (force-negative when the
 *      sign is clear, leave when set) across the tail's publish and advance frames.
 *
 *   3. EQUAL (reverse-timer sweep) — at a fixed EVEN frame (0x02, advance gate shut for a
 *      clean read), Mario low, sweep all 256 timer values on BOTH latch signs; exercises the
 *      dec / underflow-to-0 / reload-0xC0 / reverseStepDirection arm at its one triggering
 *      value and everywhere else. Asserts the underflow entry reloads 0xC0 + reverses 0x62A3.
 *
 *   4. EQUAL (crafted arms) — drive each of the four arms with an effect assertion: Mario-high
 *      force-negative, Mario-high already-negative, Mario-low odd publish-only, Mario-low even
 *      advance, Mario-low even underflow (both latch signs), and underflow coincident with the
 *      advance arm (reloaded 0xC0 drives the loc_26a6 direction).
 *
 *   5. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) inverted Mario-position branch (takes loc_266f when Mario is LOW) — caught at the
 *          reverse-timer 0x62A2 (correct runs the timer, the twin never touches it);
 *      (b) inverted even/odd parity (ticks the timer on ODD frames) — caught at 0x62A2 on an
 *          even frame (correct decs, the twin skips to the tail);
 *      (c) dropped step-direction reverse (skips reverseStepDirection on underflow) — caught
 *          at the latch 0x62A3 (correct reverses, the twin leaves it).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-262f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_262f as oracle } from "../../translated/loc_262f.js";
import { loc_262f } from "../loc_262f.js";
import { loc_266f } from "../loc_266f.js";
import { reverseStepDirection } from "../reverseStepDirection.js";
import { loc_264c } from "../loc_264c.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_Y,
  FRAME,
  M50_OBJ2_REVERSE_TIMER,
  M50_OBJ2_STEP_DIR,
  M50_OBJ2_STEP_POS,
  M50_OBJ2_STEP_NEG,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x262f;
const RET_ADDR = 0x25fb;   // sub_25f2_body's site right after `call 0x262f` (its `call 0x2679`)
const TIMER = M50_OBJ2_REVERSE_TIMER; // 0x62A2 — even-frame countdown / loc_26a6 direction select
const LATCH = M50_OBJ2_STEP_DIR;      // 0x62A3 — signed step-direction latch
const SHADOW_POS = M50_OBJ2_STEP_POS; // 0x63A5 — published +step shadow (written by the tail)
const SHADOW_NEG = M50_OBJ2_STEP_NEG; // 0x63A4 — published −step shadow (written by the tail)
const PAIR_LOW = 0x69ed;   // object-2's sprite-pair low cell (base 0x69EC + 1)
const PAIR_HIGH = 0x69f1;  // object-2's sprite-pair high cell (base 0x69EC + 5)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so
 * pc + SP match the oracle's. loc_262f replaces the Z80 stack with the JS call stack and
 * touches no stack itself (all three callees are idiomatic), so the harness supplies the
 * one caller-return `ret` the oracle nets on every path.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only (A is NOT compared). */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- fixtures -----------------------------------------------------------------

/** A realistic booted machine, a few hundred attract frames in. */
function bootedMachine(frames) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m;
}

/**
 * Stamp a crafted 0x262F dispatch onto a clone of the base: a stack with a plausible caller
 * return (so the terminal `ret` has a sane, excluded target), then every cell the routine
 * and its tail read — Mario's Y (the arm selector), the frame counter, the reverse-timer,
 * the step-direction latch, the two sprite-pair counters, and the two shadow seeds.
 */
function craft(base, { marioY = 0xd0, frame = 0x00, timer = 0x08, latch = 0x05, p = 0x51, p4 = 0xd1, sPos = 0x00, sNeg = 0x00 }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);           // SP -> 0x6BFE, return address in STACK_SCRATCH
  e.mem.write8(MARIO_Y, marioY);
  e.mem.write8(FRAME, frame);
  e.mem.write8(TIMER, timer);
  e.mem.write8(LATCH, latch);
  e.mem.write8(PAIR_LOW, p);
  e.mem.write8(PAIR_HIGH, p4);
  e.mem.write8(SHADOW_POS, sPos);
  e.mem.write8(SHADOW_NEG, sNeg);
  return e;
}

// -- broken twins (each mirrors loc_262f with one bug) ------------------------

/** Broken twin (a): inverts the Mario-position branch — loc_266f when Mario is LOW. */
function brokenInvertedYBranch(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_Y) >= 0xc0) return loc_266f(m); // BUG: should be `< 0xc0`
  if ((mem.read8(FRAME) & 0x01) !== 0) return loc_264c(m);
  const next = (mem.read8(TIMER) - 1) & 0xff;
  mem.write8(TIMER, next);
  if (next !== 0) return loc_264c(m);
  mem.write8(TIMER, 0xc0);
  regs.hl = LATCH;
  reverseStepDirection(m);
  return loc_264c(m);
}

/** Broken twin (b): ticks the reverse-timer on ODD frames instead of even. */
function brokenInvertedParity(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_Y) < 0xc0) return loc_266f(m);
  if ((mem.read8(FRAME) & 0x01) === 0) return loc_264c(m); // BUG: `=== 0` should be `!== 0`
  const next = (mem.read8(TIMER) - 1) & 0xff;
  mem.write8(TIMER, next);
  if (next !== 0) return loc_264c(m);
  mem.write8(TIMER, 0xc0);
  regs.hl = LATCH;
  reverseStepDirection(m);
  return loc_264c(m);
}

/** Broken twin (c): drops the step-direction reverse on the underflow arm. */
function brokenNoReverse(m) {
  const { mem } = m;
  if (mem.read8(MARIO_Y) < 0xc0) return loc_266f(m);
  if ((mem.read8(FRAME) & 0x01) !== 0) return loc_264c(m);
  const next = (mem.read8(TIMER) - 1) & 0xff;
  mem.write8(TIMER, next);
  if (next !== 0) return loc_264c(m);
  mem.write8(TIMER, 0xc0);
  // BUG: dropped `regs.hl = LATCH; reverseStepDirection(m);`
  return loc_264c(m);
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: attract never dispatches 0x262F (crafted-entry gate)", () => {
  let count = 0;
  const overrides = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.equal(count, 0, `expected 0x262F to be unreached in attract, saw ${count} dispatches`);
  console.log(`  REACHABILITY: 0x262F dispatched 0× in 2500 attract frames — crafted-entry gate justified`);
});

// -- 1. EQUAL (FRAME sweep, Mario low) ----------------------------------------

test("EQUAL (FRAME sweep, Mario low): loc_262f == oracle over all 256 FRAME values × configs", () => {
  const seed = bootedMachine(400).clone();
  const cfgs = [
    { timer: 0x01, latch: 0x05, p: 0x51, p4: 0xd1 }, // about-to-underflow, sign clear
    { timer: 0x01, latch: 0x85, p: 0x51, p4: 0xd1 }, // about-to-underflow, sign set
    { timer: 0x08, latch: 0x05, p: 0x50, p4: 0xd2 }, // mid, sign clear
    { timer: 0x08, latch: 0x85, p: 0x52, p4: 0xd0 }, // mid, sign set
  ];
  let count = 0, mismatch = null;
  for (let frame = 0; frame < 256 && !mismatch; frame++) {
    for (const cfg of cfgs) {
      const e = craft(seed, { marioY: 0xd0, frame, ...cfg });
      const diffs = contractDiffs(e, loc_262f);
      count++;
      if (diffs.length) { mismatch = { frame, cfg, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at FRAME=${hx(mismatch.frame)} cfg=${JSON.stringify(mismatch.cfg)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 4, "must have swept all 256 FRAME values × 4 configs");
  console.log(`  EQUAL/frame-sweep(low): ${count} (FRAME × config) entries identical to the oracle`);
});

// -- 2. EQUAL (FRAME sweep, Mario high) ---------------------------------------

test("EQUAL (FRAME sweep, Mario high): the loc_266f arm matches the oracle over all FRAME values", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  for (const latch of [0x05, 0x85]) { // sign clear -> force negative; sign set -> leave
    for (let frame = 0; frame < 256 && !mismatch; frame++) {
      const e = craft(seed, { marioY: 0x40, frame, latch, timer: 0x08, p: 0x51, p4: 0xd1 });
      const diffs = contractDiffs(e, loc_262f);
      count++;
      if (diffs.length) { mismatch = { frame, latch, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at FRAME=${hx(mismatch.frame)} latch=${hx(mismatch.latch)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 FRAME values × 2 latch signs");
  // Prove the Mario-high arm leaves the reverse-timer untouched (it never runs the countdown).
  const e = craft(seed, { marioY: 0x40, frame: 0x02, latch: 0x05, timer: 0x33 });
  assert.equal(runOracle(e).mem.read8(TIMER), 0x33, "Mario-high arm must not touch the reverse-timer");
  console.log(`  EQUAL/frame-sweep(high): ${count} (FRAME × latch) entries identical; loc_266f arm leaves the timer alone`);
});

// -- 3. EQUAL (reverse-timer sweep) -------------------------------------------

test("EQUAL (reverse-timer sweep): all 256 timer values on both latch signs match the oracle", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  for (const latch of [0x05, 0x85]) {
    for (let timer = 0; timer < 256 && !mismatch; timer++) {
      // Even frame 0x02: the countdown runs and the tail's 32nd-frame advance gate is shut.
      const e = craft(seed, { marioY: 0xd0, frame: 0x02, timer, latch, p: 0x51, p4: 0xd1 });
      const diffs = contractDiffs(e, loc_262f);
      count++;
      if (diffs.length) { mismatch = { timer, latch, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at timer=${hx(mismatch.timer)} latch=${hx(mismatch.latch)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 timer values on both signs");
  // Prove the underflow arm was exercised: timer 0x01 on an even frame -> reload 0xC0 + reverse.
  const under = craft(seed, { marioY: 0xd0, frame: 0x02, timer: 0x01, latch: 0x05 });
  const o = runOracle(under);
  assert.equal(o.mem.read8(TIMER), 0xc0, "underflow entry must reload 0x62A2 to 0xC0");
  assert.equal(o.mem.read8(LATCH), 0xfe, "underflow entry must reverse 0x62A3 (clear sign -> -2)");
  console.log(`  EQUAL/timer-sweep: ${count} timer values identical; underflow reloads 0xC0 + reverses 0x62A3`);
});

// -- 4. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted arms): all four arms match the oracle with the intended effect", () => {
  const base = bootedMachine(400).clone();

  const cases = [
    // Mario high, latch sign clear -> loc_266f forces it negative; odd frame publishes ±1.
    { name: "Mario-high force-negative (odd)", opts: { marioY: 0x40, frame: 0x01, latch: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(LATCH), 0xff, "latch forced negative then reduced to -1 on the odd frame");
        assert.equal(o.mem.read8(SHADOW_POS), 0xff, "+shadow -> -1");
        assert.equal(o.mem.read8(SHADOW_NEG), 0x01, "−shadow -> negation of -1");
      } },
    // Mario high, latch already negative, even frame -> left alone; tail publishes zeros.
    { name: "Mario-high already-negative (even)", opts: { marioY: 0x40, frame: 0x02, latch: 0x85, timer: 0x22 },
      after: (o) => {
        assert.equal(o.mem.read8(LATCH), 0x85, "already-negative latch left untouched on the even frame");
        assert.equal(o.mem.read8(SHADOW_POS), 0x00, "even frame publishes a zero +step");
        assert.equal(o.mem.read8(TIMER), 0x22, "loc_266f arm never touches the reverse-timer");
      } },
    // Mario low, odd frame -> tail publish-only; timer untouched, latch reduced to a unit step.
    { name: "Mario-low publish-only (odd)", opts: { marioY: 0xd0, frame: 0x03, latch: 0x00, timer: 0x44 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0x44, "odd frame skips the reverse-timer");
        assert.equal(o.mem.read8(LATCH), 0x01, "latch reduced to +1 (was non-negative)");
        assert.equal(o.mem.read8(SHADOW_POS), 0x01, "+shadow -> +1");
        assert.equal(o.mem.read8(SHADOW_NEG), 0xff, "−shadow -> negation of +1");
      } },
    // Mario low, even frame, timer nonzero, advance arm (FRAME & 0x1F == 0) -> pair steps.
    { name: "Mario-low advance (even, nonzero timer)", opts: { marioY: 0xd0, frame: 0x00, timer: 0x05, latch: 0x00, p: 0x51, p4: 0xd1 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0x04, "reverse-timer decremented (no underflow)");
        assert.equal(o.mem.read8(SHADOW_POS), 0x00, "even frame publishes a zero +step");
        assert.ok(o.mem.read8(PAIR_HIGH) !== 0xd1 || o.mem.read8(PAIR_LOW) !== 0x51, "the sprite pair was advanced");
      } },
    // Mario low, even frame, underflow -> reload 0xC0 + reverse (sign clear -> -2).
    { name: "Mario-low underflow, sign clear (even)", opts: { marioY: 0xd0, frame: 0x02, timer: 0x01, latch: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0xc0, "reverse-timer reloaded to 0xC0");
        assert.equal(o.mem.read8(LATCH), 0xfe, "step-direction reversed to -2 (clear sign)");
      } },
    // Mario low, even frame, underflow -> reverse (sign set -> +2).
    { name: "Mario-low underflow, sign set (even)", opts: { marioY: 0xd0, frame: 0x02, timer: 0x01, latch: 0x80 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0xc0, "reverse-timer reloaded to 0xC0");
        assert.equal(o.mem.read8(LATCH), 0x02, "step-direction reversed to +2 (set sign)");
      } },
    // Mario low, underflow coincident with the advance arm (frame 0x00): the reloaded 0xC0
    // (bit7 set) becomes the loc_26a6 direction select for the pair advance.
    { name: "Mario-low underflow + advance (frame 0x00)", opts: { marioY: 0xd0, frame: 0x00, timer: 0x01, latch: 0x00, p: 0x51, p4: 0xd1 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0xc0, "reverse-timer reloaded to 0xC0 before the advance");
        assert.equal(o.mem.read8(LATCH), 0xfe, "step-direction reversed to -2");
        assert.ok(o.mem.read8(PAIR_HIGH) !== 0xd1 || o.mem.read8(PAIR_LOW) !== 0x51, "the sprite pair was advanced");
      } },
  ];

  for (const { name, opts, after } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_262f);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    if (after) after(runOracle(entry));
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (Mario-high ×2, Mario-low publish/advance/underflow ×4, underflow+advance) identical`);
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: inverted-Y-branch, inverted-parity, and dropped-reverse twins are CAUGHT", () => {
  const base = bootedMachine(400).clone();

  // (a) inverted Mario-position branch: Mario LOW + even underflow. The correct routine runs
  // the reverse-timer (reload 0xC0), the twin diverts to loc_266f and never touches 0x62A2.
  const yb = craft(base, { marioY: 0xd0, frame: 0x02, timer: 0x01, latch: 0x00 });
  assert.equal(runOracle(yb).mem.read8(TIMER), 0xc0, "correct routine reloads the reverse-timer here");
  const ybDiffs = contractDiffs(yb, brokenInvertedYBranch);
  assert.ok(ybDiffs.length > 0, "the inverted-Y-branch twin escaped — the gate is worthless");
  assert.ok(ybDiffs[0].startsWith(`RAM@${hx(TIMER)}`), `expected the diff at ${hx(TIMER)}, got ${ybDiffs[0]}`);
  assert.equal(contractDiffs(yb, loc_262f).length, 0, "loc_262f must still pass this entry");

  // (b) inverted parity: Mario LOW on an EVEN frame. The correct routine decs 0x62A2, the twin
  // diverts to the tail and leaves it.
  const par = craft(base, { marioY: 0xd0, frame: 0x02, timer: 0x08, latch: 0x05 });
  const parDiffs = contractDiffs(par, brokenInvertedParity);
  assert.ok(parDiffs.length > 0, "the inverted-parity twin escaped — the gate is worthless");
  assert.ok(parDiffs[0].startsWith(`RAM@${hx(TIMER)}`), `expected the diff at ${hx(TIMER)}, got ${parDiffs[0]}`);
  assert.equal(contractDiffs(par, loc_262f).length, 0, "loc_262f must still pass this entry");
  // Corroborate: the parity twin is caught on every even frame across the timer path.
  let parityCases = 0, parityCaught = 0;
  for (let frame = 0; frame < 256; frame += 2) { // even frames -> correct decs, twin skips
    const e = craft(base, { marioY: 0xd0, frame, timer: 0x08, latch: 0x05 });
    parityCases++;
    if (contractDiffs(e, brokenInvertedParity).length > 0) parityCaught++;
  }
  assert.equal(parityCaught, parityCases, `parity twin escaped on ${parityCases - parityCaught}/${parityCases} even frames`);

  // (c) dropped reverse: Mario LOW + even underflow. The correct routine reverses 0x62A3, the
  // twin leaves it at the poked value.
  const rev = craft(base, { marioY: 0xd0, frame: 0x02, timer: 0x01, latch: 0x00 });
  assert.equal(runOracle(rev).mem.read8(LATCH), 0xfe, "correct routine reverses the latch to -2 here");
  const revDiffs = contractDiffs(rev, brokenNoReverse);
  assert.ok(revDiffs.length > 0, "the dropped-reverse twin escaped — the gate is worthless");
  assert.ok(revDiffs[0].startsWith(`RAM@${hx(LATCH)}`), `expected the diff at ${hx(LATCH)}, got ${revDiffs[0]}`);
  assert.equal(contractDiffs(rev, loc_262f).length, 0, "loc_262f must still pass this entry");

  console.log(
    `  TEETH: inverted-Y-branch caught (${ybDiffs[0]}); inverted-parity caught on all ${parityCases} even frames (${parDiffs[0]}); dropped-reverse caught (${revDiffs[0]})`,
  );
});
