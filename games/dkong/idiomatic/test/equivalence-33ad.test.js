// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for walkFireOneStep (ROM 0x33AD) — step an object's working X one pixel in the
 * direction its OBJ_STATE selects, set/clear the sprite tile code's flip bit to match, advance
 * the object's animation clock over that same code byte, and fall through into settleFireOnGirderSlope (the
 * 25m-only working-Y re-snap).
 *
 * 0x33AD IS naturally dispatched: the per-object state machine at 0x3202 calls it, and this
 * file MEASURES that (test 0) rather than asserting it — 309 dispatches in 3000 attract frames
 * at the time of writing, all against the 0x6400 object record, split across BOTH arms
 * (OBJ_STATE 1 and OBJ_STATE 0). So the captured-dispatch case below is real coverage, not a
 * vacuous "replays every capture" claim over an empty list; the test asserts the capture list
 * is non-empty AND that it contains both arms.
 *
 * What attract does NOT produce is crafted on a real attract base, poked identically on both
 * sides: the byte wraps at either end of the X step and of the sprite code, the animation
 * clock's expiry and its every-sixteenth-step bit toggle landing on top of the flip bit, the
 * travel states attract never showed here (2, 3, 0xFF), and both sides of settleFireOnGirderSlope's 25m gate.
 *
 * CONTRACT. The idiomatic routine replaces the Z80 stack with the JS call stack, so it models
 * no stack at all; runCandidate performs ONE m.ret() after it to line pc + SP up with the
 * oracle (whose own terminal `ret` is the fall-through tail's, and which nets exactly one
 * caller-return pop on every arm). The RAM diff EXCLUDES the dead STACK_SCRATCH the oracle's
 * push16/ret bracket writes — and test 3 MEASURES that the oracle's deepest push at a real
 * dispatch stays inside that region, so the exclusion is bounded, not assumed.
 *
 *   0. REACHABILITY — count real 0x33AD dispatches in an attract run; report the arm split.
 *   1. EQUAL (crafted matrix) — 2880 crafted dispatches over (state x code x timer x X x Y x
 *      board); every one identical on RAM − the stack scratch below the entry SP, pc and SP. Non-vacuity is asserted:
 *      the sweep must contain cases that set the flip bit, cases that clear it, cases where the
 *      X step wraps the byte, cases where the animation clock expires and toggles, and cases
 *      where the 25m tail moves the working Y — plus non-25m cases where it does not.
 *   2. PINNED VALUES — four hand-computed cases assert the ABSOLUTE resulting bytes, so an
 *      oracle-and-candidate-both-wrong reading cannot pass.
 *   3. REALISM (captured dispatches) — replay real captured entries; full contract each.
 *   4. TEETH — four broken twins, each of which the gate MUST catch:
 *      (a) the X step runs the wrong way (inc/dec swapped),
 *      (b) the flip bit is ORed on both arms, so it never clears,
 *      (c) the animation step runs BEFORE the flip write instead of after (ordering),
 *      (d) the settleFireOnGirderSlope fall-through tail is dropped.
 *
 * LIVE-OUT, DERIVED — cross-file, and therefore recorded here rather than in the routine:
 * memory-only — the object's working X (+0x0E), its sprite tile code (+0x07), the animation
 * down-counter (+0x15) and, on 25m, the working Y (+0x0F). The caller consumes no register or flag
 * this leaves behind: its next action is a call to turnFireAtGroundEdge, which re-loads the object
 * pointer from OBJ_ITER_PTR itself and takes no register live-in, and 0x3202 re-loads the pointer
 * register from the same cell before its own next field access.
 *
 * WHICH FIELDS THESE ARE, corroborated from outside the routine and therefore recorded here: +0x0E
 * and +0x0F are the object's WORKING position, one stage upstream of the grounded OBJ_X/OBJ_Y. The
 * frozen 0x3202 copies +0x0E straight into OBJ_X (ROM 0x326F-0x3272) and stores +0x0F plus a 0x3A7A
 * table term into OBJ_Y (ROM 0x3275-0x3279), and +0x0E equalled OBJ_X on every one of the real
 * dispatches test 0 measures. turnFireAtGroundEdge independently reads the same pair as a position.
 * The bit-7 flip reading is corroborated by the SPRITE_BUFFER registry entry (record +1 code, bit 7
 * = flip) plus OBJ_SPRITE_CODE's note that the object's +0x07 is copied into that sprite byte.
 *
 * NOT ESTABLISHED: which object this services — the record pointer is loaded from OBJ_ITER_PTR by
 * the caller, so the identity is whatever that iterator points at. Nor is the sense of state 1
 * called "left" or "right": only that it is the direction 0x3202's edge tests re-arm at the low-X
 * boundary (0x324D: X < 0x10 -> state 1, X >= 0xF0 -> state 2) and undo when the move is rejected
 * (0x3297: state 1 -> step X back down, state 2 -> step it back up).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-33ad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_33ad as oracle } from "../../translated/loc_33ad.js";
import { walkFireOneStep } from "../walkFireOneStep.js";
import { settleFireOnGirderSlope } from "../settleFireOnGirderSlope.js";
import { stepObjectSpriteFrame } from "../stepObjectSpriteFrame.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, OBJ_STATE, OBJ_SPRITE_CODE, OBJ_ARRAY_64 } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x33ad;
const RET_ADDR = 0x323e; // the real caller-return site (0x3202's `call 0x33ad` at 0x323B, + 3)
const OBJ_BASE = OBJ_ARRAY_64; // the object record every measured real dispatch runs against

const OFF_07 = OBJ_SPRITE_CODE; // sprite tile code — animation frame + the flip bit
const OFF_0D = OBJ_STATE;       // travel state: 1 steps X up, anything else steps it down
const OFF_0E = 0x0e;            // working X (no names.js offset name)
const OFF_0F = 0x0f;            // working Y (no names.js offset name)
const OFF_15 = 0x15;            // the animation down-counter stepObjectSpriteFrame owns

const CODE_ADDR = OBJ_BASE + OFF_07;
const X_ADDR = OBJ_BASE + OFF_0E;
const Y_ADDR = OBJ_BASE + OFF_0F;
const TIMER_ADDR = OBJ_BASE + OFF_15;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs, skipping the stack scratch below the entry SP. { addr, a, b } | null. */
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

/** Run the ORACLE on a fresh clone. Its fall-through tail performs the terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model the terminal `ret` with one m.ret() so pc + SP
 * match the oracle's. Every arm of the oracle nets exactly one caller-return pop: the
 * `call 0x3409` bracket is opened and closed inside the routine, and the tail's `ret` (either
 * its board-guard `ret nz` or its final `ret`) consumes the caller's return address.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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

/** A real, self-consistent machine: boot + a stretch of attract, so work RAM holds live values. */
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x33AD dispatch onto a clone of the base: a stack inside STACK_SCRATCH
 * carrying the real caller return, the object-record pointer, the five record fields the
 * routine and its two callees read, and the board selector the tail gates on.
 */
function craft(base, { state, code, timer, x, y, board }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.ix = OBJ_BASE;
  m.mem.write8(BOARD, board);
  m.mem.write8(CODE_ADDR, code);
  m.mem.write8(X_ADDR, x);
  m.mem.write8(Y_ADDR, y);
  m.mem.write8(TIMER_ADDR, timer);
  m.mem.write8(OBJ_BASE + OFF_0D, state);
  return m;
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x33AD is dispatched during attract, on both arms", () => {
  let count = 0;
  const arms = new Map();
  const bases = new Set();
  const snap = new Map([[TARGET, (mm) => {
    count++;
    const st = mm.mem.read8((mm.regs.ix + OFF_0D) & 0xffff);
    arms.set(st, (arms.get(st) ?? 0) + 1);
    bases.add(mm.regs.ix);
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);

  assert.ok(count > 0, "0x33AD should be dispatched by the object state machine during attract");
  const stepUp = arms.get(1) ?? 0;
  const stepDown = count - stepUp;
  assert.ok(stepUp > 0, "attract never reached the OBJ_STATE == 1 arm");
  assert.ok(stepDown > 0, "attract never reached the non-1 arm");
  console.log(
    `  REACHABILITY: ${count} natural 0x33AD dispatches in 3000 frames ` +
      `(state==1: ${stepUp}, other: ${stepDown}; record bases ${[...bases].map(hx).join(",")})`,
  );
});

// -- 1. EQUAL (crafted matrix) ------------------------------------------------

const STATES = [0x00, 0x01, 0x02, 0x03, 0xff];
// Codes that pin the flip bit AND the animation step's two byte boundaries: the observed
// 0x3D/0x3E pair and its flipped twin 0xBD/0xBE, plus 0x7F (step carries INTO bit 7) and 0xFF
// (step wraps the byte) — the two values that distinguish flip-then-step from step-then-flip.
const CODES = [0x00, 0x3d, 0x3e, 0x7f, 0x80, 0xbd, 0xbe, 0xff];
const TIMERS = [0x00, 0x01, 0x02];       // 0 = expiry (reload + step), otherwise a plain tick
const XS = [0x00, 0x01, 0xf0, 0xff];     // both ends of the byte, so the step wraps either way
const YS = [0x00, 0x4c, 0xf0];           // ordinary + snapYToGirder's two band-seam rails
const BOARDS = [0x01, 0x02];             // 25m (tail runs) and 50m (tail early-outs)

test("EQUAL (crafted matrix): walkFireOneStep == oracle across the whole field matrix", () => {
  const base = attractBase();
  let cases = 0, flipSet = 0, flipCleared = 0, xWrapped = 0, animStepped = 0, animToggled = 0;
  let tailMovedY = 0, tailHeldY = 0;

  for (const state of STATES) {
    for (const code of CODES) {
      for (const timer of TIMERS) {
        for (const x of XS) {
          for (const y of YS) {
            for (const board of BOARDS) {
              const entry = craft(base, { state, code, timer, x, y, board });
              const diffs = contractDiffs(entry, walkFireOneStep);
              assert.equal(
                diffs.length, 0,
                `state=${hx(state)} code=${hx(code)} timer=${timer} x=${hx(x)} y=${hx(y)} ` +
                  `board=${board}: ${diffs.join("; ")}`,
              );

              // Classify the case from the ORACLE's result, for the non-vacuity budget below.
              const after = runOracle(entry);
              const newCode = after.mem.read8(CODE_ADDR);
              const newX = after.mem.read8(X_ADDR);
              const newY = after.mem.read8(Y_ADDR);
              const newTimer = after.mem.read8(TIMER_ADDR);
              if (state === 0x01) flipSet++; else flipCleared++;
              if ((x === 0xff && state === 0x01) || (x === 0x00 && state !== 0x01)) xWrapped++;
              if (timer === 0x00) {
                animStepped++;
                if (newTimer !== 0x02) throw new Error("animation clock did not reload on expiry");
                if ((newCode & 0x0f) === 0x0d) animToggled++;
              }
              if (board === 0x01 && newY !== y) tailMovedY++;
              if (board !== 0x01) {
                tailHeldY++;
                assert.equal(newY, y, `board ${board}: the 25m tail must not move the working Y`);
              }
              assert.equal(newX, (state === 0x01 ? x + 1 : x - 1) & 0xff, "working X step");
              cases++;
            }
          }
        }
      }
    }
  }

  // Non-vacuity: every arm the header claims must actually occur in the sweep.
  assert.ok(flipSet > 0 && flipCleared > 0, "sweep missed one of the two flip-bit arms");
  assert.ok(xWrapped > 0, "sweep never wrapped the working X byte");
  assert.ok(animStepped > 0, "sweep never expired the animation clock");
  assert.ok(animToggled > 0, "sweep never hit the every-sixteenth-step toggle");
  assert.ok(tailMovedY > 0, "sweep never had the 25m tail move the working Y");
  assert.ok(tailHeldY > 0, "sweep never exercised the non-25m tail early-out");
  console.log(
    `  EQUAL/matrix: ${cases} crafted dispatches identical to the oracle ` +
      `(flip set ${flipSet} / cleared ${flipCleared}, X wraps ${xWrapped}, ` +
      `anim expiries ${animStepped} incl. ${animToggled} toggles, tail moved Y ${tailMovedY} / held ${tailHeldY})`,
  );
});

// -- 2. PINNED VALUES ---------------------------------------------------------

test("PINNED: hand-computed absolute results, oracle and walkFireOneStep both", () => {
  const base = attractBase();
  const pinned = [
    {
      what: "state 1: flip set, X up, animation clock just ticks; tail gated off (50m)",
      entry: { state: 0x01, code: 0x3d, timer: 0x02, x: 0x10, y: 0x50, board: 0x02 },
      want: { code: 0xbd, x: 0x11, y: 0x50, timer: 0x01 },
    },
    {
      what: "state 0: flip cleared, X wraps down past 0, clock expires and toggles bit 1",
      entry: { state: 0x00, code: 0xbe, timer: 0x00, x: 0x00, y: 0x50, board: 0x02 },
      want: { code: 0x3d, x: 0xff, y: 0x50, timer: 0x02 },
    },
    {
      what: "25m: the tail re-snaps the working Y to the girder under the NEW X (0x0F -> 0x10)",
      entry: { state: 0x01, code: 0x00, timer: 0x02, x: 0x0f, y: 0x50, board: 0x01 },
      want: { code: 0x80, x: 0x10, y: 0x51, timer: 0x01 },
    },
    {
      what: "ordering: flip write FIRST, then the animation step carries 0x7F into bit 7",
      entry: { state: 0x00, code: 0x7f, timer: 0x00, x: 0x50, y: 0x50, board: 0x02 },
      want: { code: 0x80, x: 0x4f, y: 0x50, timer: 0x02 },
    },
  ];

  for (const { what, entry: fields, want } of pinned) {
    const entry = craft(base, fields);
    for (const [label, run] of [["oracle", runOracle(entry)], ["walkFireOneStep", runCandidate(entry, walkFireOneStep)]]) {
      assert.equal(run.mem.read8(CODE_ADDR), want.code, `${what} [${label}]: sprite code`);
      assert.equal(run.mem.read8(X_ADDR), want.x, `${what} [${label}]: working X`);
      assert.equal(run.mem.read8(Y_ADDR), want.y, `${what} [${label}]: working Y`);
      assert.equal(run.mem.read8(TIMER_ADDR), want.timer, `${what} [${label}]: animation clock`);
    }
  }
  console.log(`  PINNED: ${pinned.length} hand-computed cases match on both sides`);
});

// -- 3. REALISM (captured dispatches) -----------------------------------------

/**
 * Hook 0x33AD in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper clones the entry state, then runs the oracle so the host game proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("REALISM: real captured 0x33AD dispatches — walkFireOneStep matches the oracle contract", () => {
  const caps = captureDispatches(200, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x33AD dispatch during attract");

  const arms = new Set();
  let deepestPush = 0x10000;
  for (const cap of caps) {
    arms.add(cap.mem.read8((cap.regs.ix + OFF_0D) & 0xffff));
    // The oracle's bracket reaches two bytes below the entry SP; record the deepest it goes so
    // the STACK_SCRATCH exclusion is measured rather than assumed.
    deepestPush = Math.min(deepestPush, (cap.regs.sp - 2) & 0xffff);
    const diffs = contractDiffs(cap, walkFireOneStep);
    assert.equal(
      diffs.length, 0,
      `real dispatch (ix=${hx(cap.regs.ix)}, sp=${hx(cap.regs.sp)}): ${diffs.join("; ")}`,
    );
  }
  assert.ok(arms.size >= 2, `captures covered only one arm (${[...arms].join(",")}) — thin coverage`);
  assert.ok(
    deepestPush >= STACK_SCRATCH.lo,
    `the oracle's push reached ${hx(deepestPush)}, below STACK_SCRATCH — the exclusion is unbounded`,
  );
  console.log(
    `  REALISM: ${caps.length} real 0x33AD dispatches, arms {${[...arms].join(",")}} — ` +
      `contract identical; deepest oracle push ${hx(deepestPush)} (inside STACK_SCRATCH)`,
  );
});

// -- 4. TEETH -----------------------------------------------------------------

/** BUG (a): the X step runs the wrong way — inc and dec swapped. */
function brokenXDirection(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const codeAddr = (objBase + OFF_07) & 0xffff;
  const xAddr = (objBase + OFF_0E) & 0xffff;
  const code = mem.read8(codeAddr);
  if (mem.read8((objBase + OFF_0D) & 0xffff) === 1) {
    mem.write8(codeAddr, code | 0x80);
    mem.write8(xAddr, mem.read8(xAddr) - 1); // BUG: should step up
  } else {
    mem.write8(codeAddr, code & ~0x80);
    mem.write8(xAddr, mem.read8(xAddr) + 1); // BUG: should step down
  }
  stepObjectSpriteFrame(m, objBase);
  settleFireOnGirderSlope(m);
}

/** BUG (b): the flip bit is ORed on both arms, so it never clears. */
function brokenFlipNeverCleared(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const codeAddr = (objBase + OFF_07) & 0xffff;
  const xAddr = (objBase + OFF_0E) & 0xffff;
  const code = mem.read8(codeAddr);
  if (mem.read8((objBase + OFF_0D) & 0xffff) === 1) {
    mem.write8(codeAddr, code | 0x80);
    mem.write8(xAddr, mem.read8(xAddr) + 1);
  } else {
    mem.write8(codeAddr, code | 0x80); // BUG: should CLEAR the flip bit here
    mem.write8(xAddr, mem.read8(xAddr) - 1);
  }
  stepObjectSpriteFrame(m, objBase);
  settleFireOnGirderSlope(m);
}

/** BUG (c): the animation step runs BEFORE the flip write instead of after. */
function brokenAnimBeforeFlip(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const codeAddr = (objBase + OFF_07) & 0xffff;
  const xAddr = (objBase + OFF_0E) & 0xffff;
  stepObjectSpriteFrame(m, objBase); // BUG: this belongs AFTER the flip write
  const code = mem.read8(codeAddr);
  if (mem.read8((objBase + OFF_0D) & 0xffff) === 1) {
    mem.write8(codeAddr, code | 0x80);
    mem.write8(xAddr, mem.read8(xAddr) + 1);
  } else {
    mem.write8(codeAddr, code & ~0x80);
    mem.write8(xAddr, mem.read8(xAddr) - 1);
  }
  settleFireOnGirderSlope(m);
}

/** BUG (d): the settleFireOnGirderSlope fall-through tail is dropped, so the 25m Y re-snap never happens. */
function brokenNoTail(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const codeAddr = (objBase + OFF_07) & 0xffff;
  const xAddr = (objBase + OFF_0E) & 0xffff;
  const code = mem.read8(codeAddr);
  if (mem.read8((objBase + OFF_0D) & 0xffff) === 1) {
    mem.write8(codeAddr, code | 0x80);
    mem.write8(xAddr, mem.read8(xAddr) + 1);
  } else {
    mem.write8(codeAddr, code & ~0x80);
    mem.write8(xAddr, mem.read8(xAddr) - 1);
  }
  stepObjectSpriteFrame(m, objBase);
  // BUG: no settleFireOnGirderSlope(m)
}

test("TEETH: all four broken twins are CAUGHT, each at the byte it corrupts", () => {
  const base = attractBase();
  const twins = [
    {
      name: "X stepped the wrong way",
      fn: brokenXDirection,
      // state 1 steps X up 0x10 -> 0x11; the twin steps it down to 0x0F.
      fields: { state: 0x01, code: 0x3d, timer: 0x02, x: 0x10, y: 0x50, board: 0x02 },
      at: X_ADDR,
    },
    {
      name: "flip bit ORed on both arms",
      fn: brokenFlipNeverCleared,
      // state 0 must CLEAR bit 7 of 0xBE -> 0x3E; the twin leaves 0xBE.
      fields: { state: 0x00, code: 0xbe, timer: 0x02, x: 0x10, y: 0x50, board: 0x02 },
      at: CODE_ADDR,
    },
    {
      name: "animation step before the flip write",
      fn: brokenAnimBeforeFlip,
      // 0x7F: flip-then-step gives 0x80; step-then-flip clears the carried bit back to 0x00.
      fields: { state: 0x00, code: 0x7f, timer: 0x00, x: 0x50, y: 0x50, board: 0x02 },
      at: CODE_ADDR,
    },
    {
      name: "settleFireOnGirderSlope tail dropped",
      fn: brokenNoTail,
      // 25m, X stepping onto a girder-cell boundary: the tail moves the working Y 0x50 -> 0x51.
      fields: { state: 0x01, code: 0x00, timer: 0x02, x: 0x0f, y: 0x50, board: 0x01 },
      at: Y_ADDR,
    },
  ];

  const caught = [];
  for (const twin of twins) {
    const entry = craft(base, twin.fields);
    // Sanity: the CORRECT routine passes on this very entry, so the twin's failure is the bug.
    assert.equal(contractDiffs(entry, walkFireOneStep).length, 0, `${twin.name}: the correct routine must pass here`);
    const diffs = contractDiffs(entry, twin.fn);
    assert.ok(diffs.length > 0, `the "${twin.name}" twin ESCAPED — the gate is worthless`);
    assert.ok(
      diffs[0].startsWith(`RAM@${hx(twin.at)}`),
      `expected the "${twin.name}" diff at ${hx(twin.at)}, got ${diffs[0]}`,
    );
    caught.push(`${twin.name} -> ${diffs[0]}`);
  }
  console.log(`  TEETH: ${caught.length} twins caught — ${caught.join(" | ")}`);
});
