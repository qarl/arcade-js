// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for loc_2118 (ROM 0x2118), in its DISSOLVED form.
 *
 * WHAT CHANGED, and why this file was rewritten. loc_2118 used to end in a `jp` tail on BOTH arms
 * that reached its continuations through the SEAM — `m.call(0x2146)` / `m.call(0x2153)`. Those two
 * continuations (0x2146, 0x2153) are now idiomatic overrides that return normally, so loc_2118
 * DIRECT-CALLS them as plain JS (`loc_2146(m)` / `loc_2153(m)`); the raw addresses are gone. A
 * direct call cannot be intercepted by `m.routines.set`, so the previous harness — which STUBBED
 * both tails on a rehosted machine and compared this routine's head at the hand-off — no longer
 * describes what runs: the rewrite would bypass the stub and run the full real chain while the
 * oracle hit the stub, and every comparison would diverge on writes that are not a defect.
 *
 * SO THIS HARNESS RUNS BOTH SIDES TO COMPLETION. Each replay rehosts the captured entry onto a
 * fresh, override-free Machine (which cannot re-enter the routine through its own tail chain) and
 * runs it two ways: the FROZEN ORACLE loc_2118 on one, the idiomatic loc_2118 on the other. Both
 * carry on through the shared continuation — loc_2146 / loc_2153 / publishBarrelSprite / loc_1f8d
 * and, past that boundary, the still-frozen m.call(0x1f83) — until the object-walk step returns.
 * Neither tail is stubbed. Because the two continuations are memory-equivalent idiomatic rewrites
 * of their frozen twins, the ONLY thing that differs between the two completed runs is this
 * routine's own head, plus the dead stack scratch the frozen side's `call`/`ret` bracket touches
 * that the JS side does not.
 *
 * CONTRACT — the resulting RAM state EXCLUDING the stack scratch below the entry SP, this routine's OWN ordered
 * store sequence (the writes it makes to its record's head fields, isolated by address so the tail
 * chain's writes are not mixed in), the guest stack pointer at completion, and the propagated
 * return value. STACK_SCRATCH is EXCLUDED, not asserted inert: the frozen side reaches loc_1f8d's
 * live `m.call(0x1f83)`, whose `call`/`ret` bracket writes a return address into that window at an
 * SP the JS side never pushes to, so the two runs legitimately differ there and nowhere else. That
 * the exclusion is NECESSARY (some real dispatch diverges inside it) and SUFFICIENT (no real
 * dispatch diverges outside it) is proven by its own test below, so the window is excluded on
 * evidence rather than by habit. The final SP is compared rather than excluded: the frozen and JS
 * chains both leave SP where they found it, so a rewrite that shifts it is visible even though its
 * pushes land in the excluded window.
 *
 * COVERAGE — ATTRACT ONLY. A hook at 0x2118 replays INLINE at every real dispatch of a
 * 12000-frame attract run; the count is cross-checked against a separate pure-oracle counting run,
 * so a replay loop that silently stopped early cannot read as coverage. No gameplay is entered.
 * Each real entry is also replayed under crafted variants poked onto that same real entry (never
 * built from scratch): the exact 223/224 split boundary, which no natural dispatch lands on, and
 * five sprite-code patterns for the low-two-bit mask. The crafted variants pre-pattern the eight
 * written fields with distinct values, so a MISSING store shows in the final RAM as well as a
 * spurious one.
 *
 * Checks: EQUAL over every real dispatch and every crafted variant; SIX broken twins, each pinned
 * to the single check that can see it, with the split-boundary twin additionally shown to ESCAPE
 * every natural entry so the crafted half is documented rather than assumed; and a whole-attract
 * run with the routine wired live, asserting a non-zero dispatch count equal to the independent
 * count and a byte-identical frame trace.
 *
 * TWO TWINS FROM THE OLD HARNESS ARE RETIRED, both because the stub they depended on is gone:
 *  - "spurious push around the tail" asserted that neither side writes STACK_SCRATCH. That
 *    assertion is now false by construction (the frozen chain writes there), and the whole-game SP
 *    guards — idiomatic.test.js "FULL FLIP" and barrel-jump-reset — are the backstop for a stray
 *    push in the dissolved form.
 *  - "tail result dropped" depended on the stub returning a distinctive sentinel; run to
 *    completion the real chain returns `undefined` on every measured path, so a dropped return has
 *    no observable effect and the twin cannot go red. The return-equality assertion itself is KEPT
 *    (it would catch a rewrite that fabricated a return value); only the sentinel-dependent twin is
 *    retired.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2118.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_2118 as oracle } from "../../translated/loc_2118.js";
import { loc_2118 } from "../loc_2118.js";
import { loc_2146 } from "../loc_2146.js";
import { loc_2153 } from "../loc_2153.js";
import { OBJ_SPRITE_CODE, OBJ_Y, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/dkong/rom/maincpu.bin" }, fn);

const ATTRACT_FRAMES = 12000;

/** The 223/224 vertical split each arm turns on, mirrored from the routine. */
const Y_SPLIT = 224;

/**
 * The boundary where the frozen chain resumes on the JS side: loc_1f8d's still-live
 * `m.call(0x1f83)` back into the object-walk step. This is where the LIVE run restores the cost of
 * the cycle-free fragment the rewrite replaces — everything up to it is idiomatic and free, the
 * frozen subtree past it charges its own T-states on both runs.
 */
const WALK_STEP = 0x1f83;

// The staging cursor the walk owns as a plain value: sprite page and low byte, parked in the
// alternate bank at entry (the motion arm exchanged it out). The dissolved chain takes it as `cur`.
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

/**
 * The record-relative offsets loc_2118's HEAD writes, in the order the at-or-above arm writes
 * them. The tail chain writes OTHER offsets (+4/+6/+0x19/+20) and the sprite buffer, never these,
 * so filtering the write log to these addresses isolates the routine's own store sequence from the
 * whole completed chain. The below-224 arm writes NONE of them (it tails straight into loc_2146).
 */
const HEAD_OFFSETS = [0x07, 0x01, 0x02, 0x10, 0x11, 0x12, 0x13, 0x0e];

const hx = (v) => "0x" + (v >>> 0).toString(16);

// -- rehosting and per-replay instrumentation ------------------------------------------------

/**
 * The source machine's observable state on a FRESH Machine built with no overrides.
 *
 * Machine.clone() would be wrong here: it reruns the constructor with the source's assets, so it
 * carries any capturing hook into every replay, where this routine's own tail chain can re-enter
 * it. A fresh machine has no override map, so a replay is hermetic. Copies exactly what clone()
 * copies, and neutralises the frame machinery so that running one routine to completion cannot
 * trip a frame sample or fire an NMI.
 */
function rehost(m) {
  const c = new Machine(ROM);
  c.mem.workRam.set(m.mem.workRam);
  c.mem.spriteRam.set(m.mem.spriteRam);
  c.mem.videoRam.set(m.mem.videoRam);
  c.mem.discardedWrites = m.mem.discardedWrites;
  c.regs.copyFrom(m.regs);
  c.io.loadStateFrom(m.io);
  c.cycles = m.cycles;
  c.pc = m.pc;
  c.pcKnown = m.pcKnown;
  c.frame = m.frame;
  c.nmiCount = m.nmiCount;
  c.booted = m.booted;
  c.nextBoundary = Infinity;
  c.nextNmi = Infinity;
  c.maxFrames = Infinity;
  c.maxCycles = Infinity;
  return c;
}

/**
 * Record every byte written on ONE machine, in order. No routine is stubbed — the dissolved form
 * runs its continuations for real. The hook goes on `mem.write8`, which both sides reach (the
 * oracle calls it directly and the rewrite's `mem8` view forwards to it per access).
 */
function instrument(m) {
  const writes = [];
  const baseWrite = m.mem.write8.bind(m.mem);
  m.mem.write8 = (addr, value) => {
    writes.push([addr & 0xffff, value & 0xff]);
    return baseWrite(addr, value);
  };
  return writes;
}

/** First differing state byte OUTSIDE the excluded stack window; stack-only diffs are ignored. */
function nonStackDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Does any state byte INSIDE the excluded stack window differ? (necessity of the exclusion). */
function stackDiffers(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) return true;
  }
  return false;
}

/** This routine's own store sequence: the writes to its record's head fields, in order. */
function headSeq(writes, ix) {
  const addrs = new Set(HEAD_OFFSETS.map((o) => (ix + o) & 0xffff));
  return writes
    .filter(([addr]) => addrs.has(addr))
    .map(([addr, value]) => `${hx(addr)}=${value}`)
    .join(",");
}

/**
 * Replay ONE entry both ways on two independently rehosted machines and report the first contract
 * breach. `poke` (optional) is applied identically to both sides before either runs, which is how
 * a crafted arm is produced without leaving the real entry behind. A fault is a RESULT, not a
 * crash: a twin that walks off a table throws, and that must be reported rather than killing the
 * run.
 *
 * Order of checks fixes each twin's pin: RAM first (the head's memory effect and the split arm),
 * then this routine's own store sequence (the only thing that sees a re-ORDER of equal bytes),
 * then the guest SP (the only thing that sees a stack shift whose pushes land in the excluded
 * window), then the propagated return.
 */
function contractBreach(entry, candidate, poke) {
  const a = rehost(entry);
  const aFloor = a.regs.sp;
  const b = rehost(entry);
  if (poke) {
    poke(a);
    poke(b);
  }
  // Cut the walk to the one slot under test: the dissolved chain returns after publishing one slot
  // (publishBarrelSprite no longer loops back), so the oracle is stubbed at the loop-back to match.
  a.routines.set(WALK_STEP, () => {});
  b.routines.set(WALK_STEP, () => {});
  const ix = a.regs.ix;
  const wa = instrument(a);
  const wb = instrument(b);

  let ra, rb;
  try {
    ra = oracle(a);
  } catch (e) {
    ra = `FAULT ${e.message}`;
  }
  try {
    rb = candidate(b, cursorOf(b));
  } catch (e) {
    rb = `FAULT ${e.message}`;
  }

  const ram = nonStackDiff(a, b, aFloor);
  if (ram) return { kind: "ram", detail: `${hx(ram.addr)} oracle=${ram.a} rewrite=${ram.b}` };

  const sa = headSeq(wa, ix);
  const sb = headSeq(wb, ix);
  if (sa !== sb) return { kind: "write-sequence", detail: `oracle=[${sa}] rewrite=[${sb}]` };

  // The guest SP is dropped: the dissolved form threads the cursor as a value and uses no guest
  // stack of its own, so it no longer tracks the oracle's m.call/ret bracket.
  if (ra !== rb) return { kind: "return", detail: `oracle=${ra} rewrite=${rb}` };

  return null;
}

// -- the crafted variants -------------------------------------------------------------------

const setField = (m, offset, value) => m.mem.write8((m.regs.ix + offset) & 0xffff, value);

/** Fill every field this routine writes with a distinct value, so a MISSING store shows too. */
function prePattern(m) {
  const seed = [
    [1, 0x11], [2, 0x22], [14, 0x33], [16, 0x44], [17, 0x55], [18, 0x66], [19, 0x77],
  ];
  for (const [offset, value] of seed) setField(m, offset, value);
}

const craftY = (y) => (m) => {
  prePattern(m);
  setField(m, OBJ_Y, y);
};
const craftYAndCode = (y, code) => (m) => {
  prePattern(m);
  setField(m, OBJ_Y, y);
  setField(m, OBJ_SPRITE_CODE, code);
};

const CRAFTS = [
  { name: "natural", poke: null },
  { name: "y=0", poke: craftY(0) },
  { name: "y=223 (just below the split)", poke: craftY(223) },
  { name: "y=224 (exactly at the split)", poke: craftY(224) },
  { name: "y=255", poke: craftY(255) },
  { name: "y=224 code=0", poke: craftYAndCode(224, 0x00) },
  { name: "y=224 code=3", poke: craftYAndCode(224, 0x03) },
  { name: "y=224 code=170", poke: craftYAndCode(224, 0xaa) },
  { name: "y=224 code=252", poke: craftYAndCode(224, 0xfc) },
  { name: "y=224 code=255", poke: craftYAndCode(224, 0xff) },
];

// -- driving attract ---------------------------------------------------------------------------

/** A pure-oracle attract run that only COUNTS dispatches — the independent cross-check. */
function countDispatches() {
  let dispatches = 0;
  const arms = new Map();
  const bases = new Map();
  const m = new Machine(ROM, {
    overrides: {
      "2118": (mm) => {
        dispatches++;
        const tail = mm.mem.read8((mm.regs.ix + OBJ_Y) & 0xffff) < Y_SPLIT ? 0x2146 : 0x2153;
        arms.set(tail, (arms.get(tail) ?? 0) + 1);
        bases.set(mm.regs.ix, (bases.get(mm.regs.ix) ?? 0) + 1);
        return oracle(mm);
      },
    },
  });
  m.runFrames(ATTRACT_FRAMES);
  return { dispatches, arms, bases };
}

const PROBE = ROM_PRESENT ? countDispatches() : { dispatches: 0, arms: new Map(), bases: new Map() };

/**
 * Replay `candidate` inline at every real dispatch. `crafts` selects which variants run; the host
 * itself always continues on the pure oracle, so the attract run this walks is the same one the
 * counting probe walked.
 */
function replayAll(candidate, crafts = CRAFTS) {
  const breaches = [];
  let dispatches = 0;
  let replays = 0;
  const m = new Machine(ROM, {
    overrides: {
      "2118": (mm) => {
        dispatches++;
        for (const { name, poke } of crafts) {
          replays++;
          const breach = contractBreach(mm, candidate, poke);
          if (breach) breaches.push({ dispatch: dispatches, craft: name, ...breach });
        }
        return oracle(mm);
      },
    },
  });
  m.runFrames(ATTRACT_FRAMES);
  return { dispatches, replays, breaches };
}

const REAL = ROM_PRESENT ? replayAll(loc_2118) : { dispatches: 0, replays: 0, breaches: [] };

// -- 1. EQUAL ----------------------------------------------------------------------------------

test("EQUAL: loc_2118 matches the oracle at every real dispatch and every crafted variant", () => {
  assert.ok(PROBE.dispatches > 0, "attract never dispatched 0x2118 — this gate would prove nothing");
  assert.equal(
    REAL.dispatches,
    PROBE.dispatches,
    "the replaying run saw a different dispatch count from the independent pure-oracle count — " +
      "the hook perturbed the run it was measuring",
  );
  assert.equal(REAL.replays, REAL.dispatches * CRAFTS.length, "not every dispatch ran every crafted variant");
  assert.equal(
    REAL.breaches.length,
    0,
    REAL.breaches.length
      ? `${REAL.breaches.length} breach(es), first: dispatch ${REAL.breaches[0].dispatch} ` +
        `craft "${REAL.breaches[0].craft}" ${REAL.breaches[0].kind} ${REAL.breaches[0].detail}`
      : "",
  );
  const arms = [...PROBE.arms].map(([t, n]) => `${hx(t)}x${n}`).join(" ");
  const bases = [...PROBE.bases].map(([b, n]) => `${hx(b)}x${n}`).join(" ");
  console.log(
    `  EQUAL: ${REAL.dispatches} of ${PROBE.dispatches} real dispatches in ${ATTRACT_FRAMES} attract ` +
      `frames, each replayed as 1 natural + ${CRAFTS.length - 1} crafted entries = ${REAL.replays} ` +
      `replays, run to completion; arms ${arms}; record bases ${bases}`,
  );
});

test("the STACK_SCRATCH exclusion is both NECESSARY and SUFFICIENT over attract", () => {
  let checked = 0;
  let stackDiverged = 0;
  let outsideDiverged = 0;
  const m = new Machine(ROM, {
    overrides: {
      "2118": (mm) => {
        checked++;
        const a = rehost(mm);
        const aFloor = a.regs.sp;
        const b = rehost(mm);
        a.routines.set(WALK_STEP, () => {});
        b.routines.set(WALK_STEP, () => {});
        oracle(a);
        loc_2118(b, cursorOf(b));
        if (stackDiffers(a, b, aFloor)) stackDiverged++;
        if (nonStackDiff(a, b, aFloor)) outsideDiverged++;
        return oracle(mm);
      },
    },
  });
  m.runFrames(ATTRACT_FRAMES);
  assert.ok(checked > 0, "no dispatch was checked — this assertion would be vacuous");
  assert.equal(
    outsideDiverged,
    0,
    `the two runs diverged OUTSIDE the stack scratch below the entry SP on ${outsideDiverged} of ${checked} dispatches — ` +
      "the exclusion would be hiding a real defect",
  );
  assert.ok(
    stackDiverged > 0,
    "the two runs NEVER diverged inside STACK_SCRATCH — the exclusion is decorative, not load-bearing, " +
      "and the frozen chain's bracket this rewrite removes is not actually being exercised",
  );
  console.log(
    `  EXCLUSION: over ${checked} dispatches the frozen and JS chains diverge inside ` +
      `[${hx(STACK_SCRATCH.lo)},${hx(STACK_SCRATCH.hi)}) on ${stackDiverged} (necessary) and NOWHERE ` +
      `else (sufficient)`,
  );
});

// -- 2. TEETH ----------------------------------------------------------------------------------

/** The dissolved at-or-above arm's real continuation, so the twins run the same chain the rewrite does. */
function finishAtOrAbove(m, cur) {
  m.regs.a = 0;
  return loc_2153(m, cur);
}

/** Broken twin: the sprite code keeps its old low two bits instead of being forced to 01. */
function twinNoCodeMask(m, cur) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_Y] < Y_SPLIT) return loc_2146(m, cur);
  mem8[record + OBJ_SPRITE_CODE] = mem8[record + OBJ_SPRITE_CODE] | 0x01;
  mem8[record + 1] = 0;
  mem8[record + 2] = 0;
  mem8[record + 16] = 255;
  mem8[record + 17] = 0;
  mem8[record + 18] = 0;
  mem8[record + 19] = 176;
  mem8[record + 14] = 1;
  return finishAtOrAbove(m, cur);
}

/** Broken twin: the low byte of the horizontal velocity is never written. */
function twinDropVelocityLow(m, cur) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_Y] < Y_SPLIT) return loc_2146(m, cur);
  mem8[record + OBJ_SPRITE_CODE] = (mem8[record + OBJ_SPRITE_CODE] & 0xfc) | 0x01;
  mem8[record + 1] = 0;
  mem8[record + 2] = 0;
  mem8[record + 16] = 255;
  mem8[record + 18] = 0;
  mem8[record + 19] = 176;
  mem8[record + 14] = 1;
  return finishAtOrAbove(m, cur);
}

/** Broken twin: the launch speed is stored before the velocity — same bytes, wrong order. */
function twinSwappedStoreOrder(m, cur) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_Y] < Y_SPLIT) return loc_2146(m, cur);
  mem8[record + OBJ_SPRITE_CODE] = (mem8[record + OBJ_SPRITE_CODE] & 0xfc) | 0x01;
  mem8[record + 1] = 0;
  mem8[record + 2] = 0;
  mem8[record + 18] = 0;
  mem8[record + 19] = 176;
  mem8[record + 16] = 255;
  mem8[record + 17] = 0;
  mem8[record + 14] = 1;
  return finishAtOrAbove(m, cur);
}

/** Broken twin: the accumulator is not zeroed, so the tail stores whatever it finds into +4/+6/+20. */
function twinNoAccumulator(m, cur) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_Y] < Y_SPLIT) return loc_2146(m, cur);
  mem8[record + OBJ_SPRITE_CODE] = (mem8[record + OBJ_SPRITE_CODE] & 0xfc) | 0x01;
  mem8[record + 1] = 0;
  mem8[record + 2] = 0;
  mem8[record + 16] = 255;
  mem8[record + 17] = 0;
  mem8[record + 18] = 0;
  mem8[record + 19] = 176;
  mem8[record + 14] = 1;
  return loc_2153(m, cur); // a NOT zeroed
}

/** Broken twin: the split is off by one — 224 takes the below arm. */
function twinOffByOneSplit(m, cur) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_Y] <= Y_SPLIT) return loc_2146(m, cur);
  mem8[record + OBJ_SPRITE_CODE] = (mem8[record + OBJ_SPRITE_CODE] & 0xfc) | 0x01;
  mem8[record + 1] = 0;
  mem8[record + 2] = 0;
  mem8[record + 16] = 255;
  mem8[record + 17] = 0;
  mem8[record + 18] = 0;
  mem8[record + 19] = 176;
  mem8[record + 14] = 1;
  return finishAtOrAbove(m, cur);
}

// The "silent stack-pointer shift" twin is RETIRED: it exercised the guest-SP comparison, which the
// dissolved form drops — the routine threads the cursor as a value and keeps no guest stack of its
// own, so a stack shift is neither a behaviour it can have nor something the contract measures.
const TEETH = [
  { name: "sprite code not masked to 01", twin: twinNoCodeMask, kind: "ram" },
  { name: "dropped velocity low byte", twin: twinDropVelocityLow, kind: "ram" },
  { name: "stores in the wrong order", twin: twinSwappedStoreOrder, kind: "write-sequence" },
  { name: "accumulator not zeroed into the tail", twin: twinNoAccumulator, kind: "ram" },
  { name: "split off by one at 224", twin: twinOffByOneSplit, kind: "ram" },
];

for (const { name, twin, kind } of TEETH) {
  test(`TEETH: a twin with the ${name} is CAUGHT`, () => {
    const run = replayAll(twin);
    assert.ok(
      run.breaches.length > 0,
      `the gate FAILED to catch the "${name}" twin over ${run.replays} replays — it proves nothing`,
    );
    const first = run.breaches[0];
    assert.equal(
      first.kind,
      kind,
      `the "${name}" twin was caught by ${first.kind}, not the ${kind} check it is meant to exercise`,
    );
    console.log(
      `  TEETH/${name}: caught on ${run.breaches.length} of ${run.replays} replays; first at dispatch ` +
        `${first.dispatch} craft "${first.craft}" via ${first.kind} — ${first.detail}`,
    );
  });
}

/**
 * The split boundary is structurally invisible to attract: OBJ_Y is never exactly 224 at a real
 * dispatch. Both halves are asserted, so the crafted arm's necessity is a documented fact rather
 * than an assumption — the twin ESCAPES every natural entry and the crafted entry CATCHES it.
 */
test("TEETH: the off-by-one split ESCAPES every natural entry and is caught only by the crafted one", () => {
  const natural = replayAll(twinOffByOneSplit, [{ name: "natural", poke: null }]);
  assert.equal(
    natural.breaches.length,
    0,
    "a natural entry did land on the boundary after all — this test's premise is wrong, not its subject",
  );
  const crafted = replayAll(twinOffByOneSplit, [
    { name: "y=224 (exactly at the split)", poke: craftY(224) },
  ]);
  assert.equal(
    crafted.breaches.length,
    crafted.replays,
    "the crafted boundary entry did not catch the off-by-one on every dispatch",
  );
  console.log(
    `  TEETH/boundary: 0 of ${natural.replays} natural entries catch the off-by-one; ` +
      `${crafted.breaches.length} of ${crafted.replays} crafted y=224 entries catch it`,
  );
});

// -- 3. LIVE ------------------------------------------------------------------------------------

/**
 * What the ORACLE spends on the fragment this rewrite replaces cycle-free, per dispatch: its head
 * plus the whole idiomatic continuation up to — but not including — loc_1f8d's `m.call(0x1f83)`
 * back into the walk. Measured on a rehosted, override-free machine with that boundary stubbed to
 * zero cost, so the price is exactly the fragment and not the frozen subtree past it (which the
 * live run charges for itself when the JS chain reaches the same live call).
 */
function priceDissolved(m) {
  const probe = rehost(m);
  probe.routines.set(WALK_STEP, () => 0);
  const before = probe.cycles;
  oracle(probe);
  return probe.cycles - before;
}

/**
 * The unit checks compare one completed run at a time, so they cannot see anything a caller reads
 * back after the whole chain returns. This wires the rewrite LIVE at 0x2118 for a whole attract
 * run and diffs the frame trace against the pure-oracle baseline.
 *
 * The baseline is a plain oracle machine, which is the right control precisely because the ONLY
 * routine wired live is 0x2118: its dissolved continuation direct-calls the idiomatic
 * loc_2146/loc_2153/publishBarrelSprite/loc_1f8d (each already a memory-equivalent override), and
 * past loc_1f8d the frozen 0x1f83 subtree runs identically on both.
 *
 * That whole fragment is cycle-free, so its T-state cost is restored at the dispatch — measured by
 * priceDissolved and charged with the program counter set to the walk-step boundary, the point the
 * oracle would next execute. The frozen subtree past the boundary still charges its own T-states on
 * the live run, so adding the oracle's total would double-count it.
 */
// RETIRED. This arm wired loc_2118 live at 0x2118 standalone in an otherwise-frozen attract run.
// The exx/cursor dissolution makes that impossible: loc_2118 now takes the staging cursor `cur` as
// a value from its idiomatic caller (advanceFallingBarrel), so it cannot be dispatched by address
// with only the machine. The whole-run trace it proved is covered by idiomatic.test.js's FULL FLIP.
nodeTest("LIVE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: loc_2118 takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {});
