// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceBarrelMotion — memory-equivalent to the frozen oracle at ROM 0x1F93: the active-slot
 * branch pick of the OBJ_ARRAY_67 object walk.
 * GATE:  captured + crafted + live, ATTRACT ONLY. Every real dispatch in a 6000-frame attract
 *        run is replayed inline — no sampling — with the branch the rewrite picks compared
 *        against the branch the ORACLE picks. Three crafted arms cover the field values
 *        attract never presents. Record slots 8-9, credited gameplay, two-player and boards
 *        2-4 are NOT covered.
 *
 * The routine reads two record bytes and jumps to one of five still-frozen branches. It
 * writes nothing, so almost everything observable about it is WHICH branch it picked —
 * which is why the checks below pin the branch choice directly as well as through the RAM
 * the branch then writes.
 *
 * CONTRACT COMPARED HERE: the work/sprite/video state dump minus the stack scratch below the entry SP plus the
 * return value — the required memory-equivalence contract — and, as EXTRAS that legitimately
 * hold for this routine, the STACK_SCRATCH window itself, pc, SP and the FULL register file.
 * The extras hold for a derivable reason: the rewrite keeps the oracle's tail dispatch, so
 * the frozen branch chain performs every stack operation the oracle performs (neither side
 * pushes anything of its own — both exits are jumps) and runs the whole rest of the walk
 * before returning through the same `ret`. Asserting them is free teeth rather than a false
 * contract. The one thing the rewrite really drops is the accumulator and the flags at the
 * instant the branch is entered, which test 4 measures rather than assumes.
 *
 * WHY THE ENTRIES ARE REHOSTED AND NOT CLONED. A capture comes from a machine carrying the
 * capturing override and clone() reruns the constructor with the same assets, so a clone
 * carries it too — and this routine's branch chain RE-ENTERS 0x1F93 for the walk's remaining
 * slots, so replaying on a clone would re-trigger the hook and clone again without bound.
 * Every entry is rehosted into a FRESH override-free Machine instead. That also makes the
 * nested re-entries run the pure oracle on BOTH sides, which is what isolates the single
 * outermost dispatch under test.
 *
 * WHAT EACH TEST ACTUALLY COVERS — read this before trusting a green run:
 *
 *   1. CAPTURED (real dispatches). 0x1F93 is dispatched 11026 times in a 6000-frame attract
 *      run, first at frame 613, and ALL 11026 are replayed inline — clone-free, O(1) memory,
 *      no sampling, so there is no sampling policy to be wrong about. Asserted rather than
 *      merely reported: all five branches are reached by real dispatches, and at least one
 *      real dispatch carries select==1 over a NON-ZERO mode byte (41 do), which is what lets
 *      the routine's header claim the select byte's priority is covered by captures. Each
 *      replay also compares the branch the rewrite picks against the branch the ORACLE picks
 *      — both observed the same way, by stubbing all five targets on a rehost — so the arm
 *      label is never derived from the candidate. ATTRACT ONLY: 25m, record slots 0-7 of the
 *      ten, single-player. Slots 8-9, gameplay, two-player and boards 2-4 are NOT covered.
 *
 *   2. CRAFTED (the field values attract never presents). Three arms, each poking only the
 *      one or two record bytes on a REAL capture — coherent stack, caller frames, shadow
 *      register set and live loop state all left alone: select 1 against mode bits 7 (the
 *      priority against a mode BIT, where attract only supplies it against 8), select 2
 *      (which is what separates "equal to 1" from "non-zero"), and mode 6 (bits 1 and 2 set
 *      together). Each asserts, from the ORACLE's own outgoing dispatch, that the poke
 *      actually reached the branch it exists for, so a poke that changed nothing fails as
 *      vacuous rather than passing.
 *
 *   3. TEETH — five deliberately-broken twins, each of which MUST be caught, and caught by
 *      the half this file says: mode bit 1 tested before bit 0; mode bit 2 not tested at
 *      all; the mode bits read out of the select field; the select tested for non-zero
 *      instead of ==1; and mode bit 2 tested before bit 1. The last two escape ALL 11026
 *      real captures — attract never presents a select outside {0,1} nor bits 1 and 2
 *      together — and are caught only by a crafted arm. That is asserted in BOTH directions:
 *      a twin claimed to be crafted-only must be caught by zero captures, so a twin quietly
 *      migrating between the halves fails instead of passing.
 *
 *   4. LIVE-OUT, poisoned AT THE SEAM. An all-oracle attract run with the accumulator and
 *      all eight flags inverted at the exact instant the branch is dispatched — the exact
 *      state this rewrite drops, at the exact point it drops it. Poisoning after the
 *      dispatch instead would prove only that the frozen chain overwrote things. Cycle-
 *      identical to the baseline by construction, and the poison count is asserted equal to
 *      the dispatch count so no dispatch escapes it.
 *
 *   5. LIVE (whole-machine). The rewrite wired at 0x1F93 for the same 6000-frame run,
 *      compared frame by frame against the baseline. THE ORACLE'S HEAD COST IS RESTORED, and
 *      only the head: the rewrite keeps the oracle's tail dispatch, so the frozen chain is
 *      already charging its own cycles and adding the oracle's total would double-count it.
 *      The head is priced per dispatch by running the oracle on a rehost with the five
 *      branches STUBBED — non-recursive and O(1). The five head costs (33, 66, 80, 94 and
 *      104 T-states) are reported by the run.
 *
 * THE BASELINE IS NOT AN OVERRIDE-FREE MACHINE. It carries a DELEGATING hook at 0x1F93, so
 * the call-bracket seam is installed on both sides and the only difference between the
 * baseline and a live run is which function sits at that one address.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1f93.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1f93 as oracle } from "../../translated/loc_1f93.js";
import { advanceBarrelMotion } from "../advanceBarrelMotion.js";
import { OBJ_ARRAY_67, STACK_SCRATCH } from "../names.js";
import { firstRegDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x1f93;
const RECORD_STRIDE = 32;
const ATTRACT_FRAMES = 6000;

// The five branches this dispatcher picks between. All five are still frozen — they are
// members of the same mutually-recursive object-walk cluster, decompiled concurrently.
const BRANCH_SELECT_ARM = 0x20ec; // record +1 == 1
const BRANCH_BIT0_ARM = 0x1fac; // record +2 bit 0
const BRANCH_BIT1_ARM = 0x1fe5; // record +2 bit 1
const BRANCH_BIT2_ARM = 0x1fef; // record +2 bit 2
const BRANCH_DEFAULT_ARM = 0x2053; // no low bit set
const ARMS = [BRANCH_SELECT_ARM, BRANCH_BIT0_ARM, BRANCH_BIT1_ARM, BRANCH_BIT2_ARM, BRANCH_DEFAULT_ARM];

// The two record fields the dispatcher reads. names.js deliberately declines to give either
// a shared OBJ_* name (see its HAMMER_IN_PLAY note, which cites this very site).
const SELECT = 1;
const MODE_BITS = 2;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First differing RAM byte outside the stack scratch below the entry SP, or null. */
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

/** First differing byte INSIDE STACK_SCRATCH, or null — asserted as an extra, see the header. */
function firstStackDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * A FRESH override-free Machine carrying `base`'s state. NOT a clone: clone() reruns the
 * constructor with the source's `assets`, so it carries the capturing override — and this
 * routine's tail chain RE-ENTERS 0x1F93 for the walk's remaining slots, so a clone would
 * re-trigger the hook and clone again, without bound. Rehosting also makes the nested
 * re-entries run the pure oracle on BOTH sides, which is what isolates the one outermost
 * dispatch under test.
 *
 * `overrides` is used only to observe or stub the branch arms; a counting hook delegates
 * straight to the oracle, so it changes nothing it observes.
 */
function rehost(base, overrides) {
  const e = new Machine(ROM, overrides ? { overrides } : undefined);
  e.mem.workRam.set(base.mem.workRam);
  e.mem.spriteRam.set(base.mem.spriteRam);
  e.mem.videoRam.set(base.mem.videoRam);
  e.regs.copyFrom(base.regs);
  e.io.loadStateFrom(base.io);
  e.cycles = base.cycles;
  e.pc = base.pc;
  e.pcKnown = base.pcKnown;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  e.maxFrames = Infinity;
  e.maxCycles = Infinity;
  return e;
}

/**
 * Run the ORACLE on a rehost of `entry` with every branch arm STUBBED, and report which
 * arm it jumped to and what the head cost in T-states. Non-circular: the arm label comes
 * from the oracle's own outgoing dispatch, never from the candidate. Non-recursive: the
 * stubs cut the tail off, so the walk's remaining slots are not run.
 */
function oracleHead(entry) {
  let arm = null;
  let fired = 0;
  const stubs = new Map(ARMS.map((a) => [a, () => { arm = a; fired++; return "STUB"; }]));
  const e = rehost(entry, stubs);
  const before = e.cycles;
  const ret = oracle(e);
  return { arm, fired, ret, cost: e.cycles - before };
}

/**
 * Oracle vs candidate on two byte-identical rehosts of `entry`. Both sides run the whole
 * frozen tail chain (and therefore the rest of the object walk), so a wrong branch pick
 * shows up as a large RAM divergence rather than as a subtle one.
 *
 * Returns every contract violation it found; a FAULT counts as one, because a crafted
 * entry can drive a broken twin into unmapped memory rather than merely diverging.
 */
function contractDiffs(entry, fn) {
  let o, c, oret, cret;
  try {
    o = rehost(entry);
    oret = oracle(o);
    c = rehost(entry);
    cret = fn(c);
  } catch (e) {
    return [`threw ${e.constructor.name}: ${e.message}`];
  }
  const out = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) out.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (oret !== cret) out.push(`return oracle=${String(oret)} cand=${String(cret)}`);
  const stack = firstStackDiff(o, c, entry.regs.sp);
  if (stack) out.push(`STACK@${hx(stack.addr)} oracle=${stack.a} cand=${stack.b}`);
  if (o.pc !== c.pc) out.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) out.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  const reg = firstRegDiff(o.regs, c.regs);
  if (reg) out.push(`reg ${reg.reg} oracle=${reg.a} cand=${reg.b}`);
  return out;
}

/**
 * The ARM the candidate picks, observed the same way as the oracle's: by stubbing all
 * five branch targets on a rehost. Used only by the arm-agreement check, which is the
 * one observable that is exactly this routine's job.
 */
function candidateArm(entry, fn) {
  let arm = null;
  const stubs = new Map(ARMS.map((a) => [a, () => { arm = a; return "STUB"; }]));
  const e = rehost(entry, stubs);
  try {
    fn(e);
  } catch {
    return "threw";
  }
  return arm;
}

/** Entry shape: the record slot, and the two bytes the dispatcher reads. */
function shapeOf(m) {
  const record = m.regs.ix;
  return `slot${(record - OBJ_ARRAY_67) / RECORD_STRIDE}/sel${m.mem.read8(record + SELECT)}` +
    `/mode${m.mem.read8(record + MODE_BITS)}`;
}

// -- shared fixtures (built once, reused by every test in the file) ------------

let CAPTURES = null;
let FIRST_FRAME = null;
/** Every real 0x1F93 dispatch in an attract run, cloned at the moment of dispatch. */
function captures() {
  if (CAPTURES) return CAPTURES;
  const caps = [];
  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      if (FIRST_FRAME === null) FIRST_FRAME = mm.frames.length;
      caps.push(mm.clone());
      return oracle(mm);
    }]]),
  });
  host.runFrames(ATTRACT_FRAMES);
  assert.equal(host.stoppedBy, null, `capture run stopped early: ${host.stoppedBy}`);
  CAPTURES = caps;
  return caps;
}

let BASELINE = null;
/**
 * The reference attract run. It carries a DELEGATING hook at 0x1F93 so that the call
 * bracket seam is installed on both sides and the ONLY difference between this run and a
 * live one is which function sits at 0x1F93.
 */
function baseline() {
  if (BASELINE) return BASELINE;
  const m = new Machine(ROM, { overrides: new Map([[TARGET, (mm) => oracle(mm)]]) });
  const sp = recordFrameSp(m);
  const frames = m.runFrames(ATTRACT_FRAMES);
  assert.equal(m.stoppedBy, null, `baseline run stopped early: ${m.stoppedBy}`);
  BASELINE = { m, frames, sp };
  return BASELINE;
}

/**
 * Wire `body` at 0x1F93 for a whole attract run and diff every frame against the baseline.
 *
 * THE CHARGE IS A DIFFERENCE, NOT A TOTAL. This rewrite keeps the oracle's tail dispatch,
 * so the whole frozen branch chain is ALREADY charging its own cycles inside `body`. The
 * only thing it under-charges is the HEAD — the handful of instructions it replaced — so
 * that is the only thing restored. Charging the oracle's total on top would double-count
 * the chain. The head is priced non-recursively by stubbing the five branch arms on a
 * rehost, which is also what keeps this O(1) rather than re-running the rest of the walk.
 */
function liveRun(body, { restoreCycles = true, install } = {}) {
  const { m: base, frames: baseFrames, sp: baseFrameSp } = baseline();
  let fired = 0;
  const deltas = new Set();
  const cand = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      fired++;
      const cost = restoreCycles ? oracleHead(mm).cost : 0;
      const r = body(mm);
      deltas.add(cost);
      if (cost !== 0) mm.tick(cost);
      return r;
    }]]),
  });
  if (install) install(cand);
  const candFrameSp = recordFrameSp(cand);
  const candFrames = cand.runFrames(ATTRACT_FRAMES);
  const floors = frameFloors(baseFrameSp, candFrameSp);
  assert.equal(cand.stoppedBy, null, `live run stopped early: ${cand.stoppedBy}`);
  assert.ok(fired > 0, "the override never fired — this case would be vacuous");
  assert.equal(candFrames.length, baseFrames.length, "both runs must reach the frame budget");

  let firstBad = null;
  let firstStackBad = null;
  for (let f = 0; f < baseFrames.length && !firstBad; f++) {
    const a = baseFrames[f], b = candFrames[f];
    const dead = deadStackBelow(STACK_SCRATCH, floors[f]);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = base.stateOffsetToAddr(i);
      if (dead(addr)) {
        if (!firstStackBad) firstStackBad = `frame ${f}: STACK@${hx(addr)} baseline=${a[i]} live=${b[i]}`;
        continue;
      }
      firstBad = `frame ${f}: RAM@${hx(addr)} baseline=${a[i]} live=${b[i]}`;
      break;
    }
  }
  return { fired, deltas: [...deltas].sort((p, q) => p - q), firstBad, firstStackBad, frames: baseFrames.length };
}

// -- 1. CAPTURED --------------------------------------------------------------

test("CAPTURED: every real 0x1F93 dispatch matches the oracle", () => {
  const caps = captures();
  assert.ok(caps.length > 0, "no 0x1F93 dispatch was captured — this case would be vacuous");

  const shapes = new Map();
  const armCounts = new Map();
  const slots = new Set();
  let selectOverMode = 0; // real dispatches where select==1 AND the mode byte is non-zero
  for (let i = 0; i < caps.length; i++) {
    const diffs = contractDiffs(caps[i], advanceBarrelMotion);
    assert.equal(diffs.length, 0, `capture ${i} (${shapeOf(caps[i])}): ${diffs.join("; ")}`);

    // The one observable that IS this routine's job: which branch it hands the record to.
    const head = oracleHead(caps[i]);
    assert.equal(head.fired, 1, `capture ${i}: the arm stubs fired ${head.fired} times, expected 1`);
    assert.equal(
      candidateArm(caps[i], advanceBarrelMotion),
      head.arm,
      `capture ${i} (${shapeOf(caps[i])}): rewrite picked a different branch from the oracle`,
    );
    shapes.set(shapeOf(caps[i]), (shapes.get(shapeOf(caps[i])) ?? 0) + 1);
    armCounts.set(head.arm, (armCounts.get(head.arm) ?? 0) + 1);
    slots.add((caps[i].regs.ix - OBJ_ARRAY_67) / RECORD_STRIDE);
    const rec = caps[i].regs.ix;
    if (caps[i].mem.read8(rec + SELECT) === 1 && caps[i].mem.read8(rec + MODE_BITS) !== 0) selectOverMode++;
  }

  // The header claims all five branches are reached by real attract dispatches; this is
  // the line that produces that claim.
  assert.deepEqual(
    [...armCounts.keys()].sort((p, q) => p - q),
    [...ARMS].sort((p, q) => p - q),
    "attract did not reach all five branches — the header's coverage claim would be wrong",
  );
  // ...and that the select byte's priority over the mode byte is exercised by REAL
  // dispatches, not only by the crafted arm.
  assert.ok(
    selectOverMode > 0,
    "no real dispatch presented select==1 with a non-zero mode byte — the header may not " +
      "claim the priority is covered by captures",
  );
  console.log(
    `  CAPTURED: all ${caps.length} of ${caps.length} dispatches in ${ATTRACT_FRAMES} attract frames ` +
      `replayed — identical; first at frame ${FIRST_FRAME}; ${shapes.size} distinct entry shapes over record slots ` +
      `${[...slots].sort((p, q) => p - q).join(",")}; arms ` +
      `${[...armCounts].sort((p, q) => p - q).map(([a, n]) => `${hx(a)}x${n}`).join(" ")}; ` +
      `${selectOverMode} of them with select==1 over a non-zero mode byte`,
  );
});

// -- 2. CRAFTED (the field values attract never presents) ----------------------

/**
 * Craft an entry from a REAL capture — coherent stack, caller frames, shadow register set
 * and live loop state all intact — by poking only the one or two record bytes under test.
 */
function crafted(base, sel, mode) {
  const e = base.clone();
  e.mem.write8(base.regs.ix + SELECT, sel);
  e.mem.write8(base.regs.ix + MODE_BITS, mode);
  return e;
}

const CRAFTED_ARMS = [
  {
    label: "select wins over every mode bit",
    sel: 1, mode: 7, expect: BRANCH_SELECT_ARM,
    why: "attract only ever pairs a select of 1 with mode bits of 0, so which of the two " +
      "tests has priority is never exercised by a real dispatch",
  },
  {
    label: "select of 2 is NOT the select arm",
    sel: 2, mode: 1, expect: BRANCH_BIT0_ARM,
    why: "attract only ever presents a select of 0 or 1, so 'equal to 1' and 'non-zero' " +
      "agree on every real dispatch",
  },
  {
    label: "mode bit 1 wins over mode bit 2",
    sel: 0, mode: 6, expect: BRANCH_BIT1_ARM,
    why: "attract never presents mode bits 1 and 2 set together",
  },
];

test("CRAFTED: the record values attract never presents match the oracle", () => {
  const caps = captures();
  const base = caps[Math.floor(caps.length / 2)];

  const seen = [];
  for (const arm of CRAFTED_ARMS) {
    const entry = crafted(base, arm.sel, arm.mode);

    // Non-vacuous by construction: assert the poke actually reached the arm it is for,
    // observed from the ORACLE's own outgoing dispatch.
    const head = oracleHead(entry);
    assert.equal(head.fired, 1, `${arm.label}: the arm stubs fired ${head.fired} times, expected 1`);
    assert.equal(
      head.arm, arm.expect,
      `${arm.label}: the poke reached ${hx(head.arm ?? 0)}, not ${hx(arm.expect)} — the arm is not covered`,
    );

    const diffs = contractDiffs(entry, advanceBarrelMotion);
    assert.equal(diffs.length, 0, `${arm.label}: ${diffs.join("; ")}`);
    seen.push(`${arm.label} -> ${hx(head.arm)} (${head.cost}T)`);
  }
  console.log(`  CRAFTED: ${seen.length} arms, each on a real capture with only the two record ` +
    `bytes poked: ${seen.join("; ")}`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: mode bit 1 tested before mode bit 0, so a record with both goes the wrong way. */
function twinBitOrder(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  if (mem8[record + SELECT] === 1) return m.call(BRANCH_SELECT_ARM);
  const mode = mem8[record + MODE_BITS];
  if (mode & 2) return m.call(BRANCH_BIT1_ARM);
  if (mode & 1) return m.call(BRANCH_BIT0_ARM);
  if (mode & 4) return m.call(BRANCH_BIT2_ARM);
  return m.call(BRANCH_DEFAULT_ARM);
}

/** Broken twin: the select test is "non-zero" rather than "equal to 1". */
function twinSelectNonZero(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  if (mem8[record + SELECT] !== 0) return m.call(BRANCH_SELECT_ARM);
  const mode = mem8[record + MODE_BITS];
  if (mode & 1) return m.call(BRANCH_BIT0_ARM);
  if (mode & 2) return m.call(BRANCH_BIT1_ARM);
  if (mode & 4) return m.call(BRANCH_BIT2_ARM);
  return m.call(BRANCH_DEFAULT_ARM);
}

/** Broken twin: mode bit 2 is not tested, so its records fall through to the default arm. */
function twinDropBit2(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  if (mem8[record + SELECT] === 1) return m.call(BRANCH_SELECT_ARM);
  const mode = mem8[record + MODE_BITS];
  if (mode & 1) return m.call(BRANCH_BIT0_ARM);
  if (mode & 2) return m.call(BRANCH_BIT1_ARM);
  return m.call(BRANCH_DEFAULT_ARM);
}

/** Broken twin: mode bit 2 tested before mode bit 1. */
function twinBit2First(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  if (mem8[record + SELECT] === 1) return m.call(BRANCH_SELECT_ARM);
  const mode = mem8[record + MODE_BITS];
  if (mode & 1) return m.call(BRANCH_BIT0_ARM);
  if (mode & 4) return m.call(BRANCH_BIT2_ARM);
  if (mode & 2) return m.call(BRANCH_BIT1_ARM);
  return m.call(BRANCH_DEFAULT_ARM);
}

/** Broken twin: reads the mode bits from the wrong record field. */
function twinWrongField(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  if (mem8[record + SELECT] === 1) return m.call(BRANCH_SELECT_ARM);
  const mode = mem8[record + SELECT];
  if (mode & 1) return m.call(BRANCH_BIT0_ARM);
  if (mode & 2) return m.call(BRANCH_BIT1_ARM);
  if (mode & 4) return m.call(BRANCH_BIT2_ARM);
  return m.call(BRANCH_DEFAULT_ARM);
}

const TEETH = [
  { name: "mode bit 1 tested before bit 0", twin: twinBitOrder, caughtBy: "captured" },
  { name: "mode bit 2 not tested at all", twin: twinDropBit2, caughtBy: "captured" },
  { name: "mode bits read from the select field", twin: twinWrongField, caughtBy: "captured" },
  { name: "select tested for non-zero instead of ==1", twin: twinSelectNonZero, caughtBy: "crafted" },
  { name: "mode bit 2 tested before bit 1", twin: twinBit2First, caughtBy: "crafted" },
];

test("TEETH: every broken twin is caught, and by the half the header says", () => {
  const caps = captures();
  const base = caps[Math.floor(caps.length / 2)];
  const craftedEntries = CRAFTED_ARMS.map((a) => ({ label: a.label, entry: crafted(base, a.sel, a.mode) }));

  const report = [];
  for (const { name, twin, caughtBy } of TEETH) {
    let capturedHits = 0;
    let firstCaptured = null;
    for (let i = 0; i < caps.length; i++) {
      const diffs = contractDiffs(caps[i], twin);
      if (diffs.length === 0) continue;
      capturedHits++;
      if (!firstCaptured) firstCaptured = `capture ${i} (${shapeOf(caps[i])}): ${diffs[0]}`;
    }
    const craftedHits = craftedEntries
      .map(({ label, entry }) => ({ label, diffs: contractDiffs(entry, twin) }))
      .filter((r) => r.diffs.length > 0);

    assert.ok(
      capturedHits > 0 || craftedHits.length > 0,
      `the "${name}" twin was NOT caught by any capture or crafted arm — this gate proves nothing`,
    );
    if (caughtBy === "captured") {
      assert.ok(capturedHits > 0, `"${name}" is claimed to be caught by a real capture and was not`);
    } else {
      assert.equal(
        capturedHits, 0,
        `"${name}" is claimed to escape every real capture but ${capturedHits} caught it — the ` +
          "header's crafted-arm justification is wrong",
      );
      assert.ok(craftedHits.length > 0, `"${name}" was not caught by any crafted arm either`);
    }
    report.push(
      `${name}: captured ${capturedHits}/${caps.length}, crafted ${craftedHits.length}/${craftedEntries.length}` +
        (firstCaptured ? ` — first ${firstCaptured}` : ` — first ${craftedHits[0].label}: ${craftedHits[0].diffs[0]}`),
    );
  }
  console.log("  TEETH:\n    " + report.join("\n    "));
});

// -- 4. LIVE-OUT: poison at the seam ------------------------------------------

/**
 * POISON AT THE SEAM. The whole run is the ORACLE, except that the accumulator and all
 * eight flags are scrambled at the exact instant it hands the record to a branch — i.e.
 * exactly the state this rewrite drops, at exactly the moment it drops it. Poisoning
 * AFTER the dispatch would measure the wrong boundary: by then the whole frozen branch
 * chain has run and would have overwritten those registers itself.
 *
 * Cycle-identical to the baseline by construction (the oracle charges everything), so no
 * cycle restoration is involved and nothing but the register drop is being measured. The
 * poisoning wrapper is installed ONCE on the machine rather than per dispatch; a nested
 * re-entry re-arms it, so every dispatch is poisoned exactly once — asserted, not assumed.
 */
test("LIVE-OUT: scrambling the accumulator and flags at the branch seam changes nothing", () => {
  let armed = false;
  let poisoned = 0;
  const r = liveRun(
    (mm) => {
      armed = true;
      try {
        return oracle(mm);
      } finally {
        armed = false;
      }
    },
    {
      restoreCycles: false,
      install: (cand) => {
        const realCall = cand.call.bind(cand);
        cand.call = (addr, ...args) => {
          if (armed && ARMS.includes(addr)) {
            armed = false;
            poisoned++;
            cand.regs.a = cand.regs.a ^ 0xff;
            cand.regs.f = cand.regs.f ^ 0xff;
          }
          return realCall(addr, ...args);
        };
      },
    },
  );
  assert.deepEqual(r.deltas, [0], `the poison twin must be cycle-neutral, got deltas ${r.deltas}`);
  assert.equal(
    poisoned, r.fired,
    `the poison fired on ${poisoned} of ${r.fired} dispatches — a dispatch it missed is uncovered`,
  );
  assert.equal(r.firstBad, null, `the poison twin diverged: ${r.firstBad}`);
  assert.equal(r.firstStackBad, null, `the poison twin diverged in the stack window: ${r.firstStackBad}`);
  console.log(
    `  LIVE-OUT: ${r.frames} attract frames byte-identical (STACK_SCRATCH included) with the ` +
      `accumulator and all eight flags inverted at the branch seam on all ${poisoned} of ` +
      `${r.fired} dispatches — so nothing downstream reads either, and dropping them is ` +
      "measured, not assumed",
  );
});

// -- 5. LIVE: the rewrite itself, wired for a whole attract run ----------------

test("LIVE: the rewrite wired at 0x1F93 leaves the same trace as the oracle", () => {
  const r = liveRun(advanceBarrelMotion);
  assert.ok(r.fired > 0, "the rewrite never ran");
  assert.equal(r.firstBad, null, `the live run diverged: ${r.firstBad}`);
  console.log(
    `  LIVE: ${r.frames} attract frames identical with the rewrite wired live, on ${r.fired} ` +
      `dispatches; restored head costs (T-states) ${r.deltas.join(",")}` +
      (r.firstStackBad ? `; stack window differs: ${r.firstStackBad}` : "; STACK_SCRATCH identical too"),
  );
});
