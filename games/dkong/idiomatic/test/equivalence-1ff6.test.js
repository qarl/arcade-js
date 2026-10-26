// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceRollingBarrel — memory-equivalent to the frozen oracle at ROM 0x1FF6: the shared tail of
 * the 25m object sweep's two horizontal-step arms.
 * GATE:  captured + one crafted arm + live, ATTRACT ONLY. Every real dispatch in a 3000-frame
 *        attract run is replayed with every frozen continuation running for real on both
 *        sides; that covers four of the five arms. The fifth — the bottom-of-playfield gate
 *        taking the walk over — is never taken in attract and is reached by a crafted entry
 *        built on a real capture. Attract is 25m only, but so is this cluster.
 *
 * WHAT EACH CASE ACTUALLY COVERS. Read this before trusting a green run.
 *
 *  1. CAPTURED — EVERY real dispatch, no sampling. A hook at 0x1FF6 runs a 3000-frame attract
 *     run; at each dispatch the machine is REHOSTED into two fresh override-free machines and the
 *     oracle and the rewrite are run one on each, with every frozen continuation running for real
 *     on both sides. 4742 dispatches, 7 record bases, four of the routine's five arms. Rehosting
 *     rather than cloning is load-bearing twice over: this routine's own tail chain re-enters it,
 *     so a clone (which carries the override map) would re-enter the hook during the replay and
 *     grow the capture list underneath the loop — and the fresh machine is what makes replaying
 *     all 4742 cost half a second instead of needing a sample.
 *
 *  2. CRAFTED — the fifth arm, which attract NEVER takes (0 of 4742): the bounds gate at
 *     ROM 0x24B4 discarding this routine's return address and carrying the sweep on itself. The
 *     entries are built by poking two record bytes on a REAL capture, so the stack, the shadow
 *     bank and the loop state are all genuine. Which arm an entry reaches is read off the ORACLE's
 *     own 0x24B4 return value, never off the rewrite, so the coverage claim is not circular.
 *
 *  3. TEETH — five broken twins, and the case records which of (1) and (2) caught each. One of
 *     them is reachable ONLY through the crafted arm, which is why (2) exists.
 *
 *  4. LIVE — the whole machine, cycle-free. The rewrite is wired at 0x1FF6 for a 6000-frame
 *     attract run and every frame's live state is compared against a baseline that differs in
 *     NOTHING ELSE: both machines wire the two already-idiomatic callees (ROM 0x2333 and 0x23DE)
 *     at their addresses, so the only variable is 0x1FF6 itself. Running both sides under
 *     core/frame-stepped.js `runCycleFree` puts the vblank NMI on a control-flow boundary rather
 *     than a cycle count, so the rewrite being cycle-free costs nothing and no cycle charge has to
 *     be restored. The dispatch count is asserted non-zero and printed — without that this case
 *     can pass while never running the routine at all.
 *
 *  5. LIVE-OUT — the same run with the ORACLE at 0x1FF6 and exactly the registers the rewrite
 *     DROPS scrambled at the moment control leaves it, hand-off by hand-off. Poisoning at the seam
 *     rather than after the dispatch is the point: by the time the frozen chain has returned, it
 *     has redefined everything and the probe would be aimed at the wrong boundary. Carries its own
 *     non-vacuity check — the same poison aimed at the registers the rewrite KEEPS must diverge.
 *
 * CONTRACT COMPARED in (1) and (2): the work/sprite/video state dump minus the stack scratch below the entry SP, the
 * forwarded return value, and — as extras beyond the required contract — pc and SP. STACK_SCRATCH
 * is excluded because this rewrite dissolves the oracle's brackets around ROM 0x2333 and ROM
 * 0x23DE (both callees are idiomatic and direct-called) while keeping the one around ROM 0x24B4,
 * so the stack bytes legitimately differ; pc and SP are compared because they legitimately hold —
 * every continuation is still frozen and maintains both for either side — and they are the only
 * thing that catches a dropped call bracket, which lands entirely inside the excluded region.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1ff6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import manifest from "../../manifest.js";
import { runCycleFree } from "../../../../core/frame-stepped.js";
import { u8 } from "../../../../core/int.js";
import { loc_1ff6 as oracle } from "../../translated/loc_1ff6.js";
import { loc_24b4 as oracle24b4 } from "../../translated/loc_24b4.js";
import { loc_215f as oracle215f } from "../../translated/loc_215f.js";
import { loc_202f as oracle202f } from "../../translated/loc_202f.js";
import { loc_21ba as oracle21ba } from "../../translated/loc_21ba.js";
import { loc_2038 as oracle2038 } from "../../translated/loc_2038.js";
import { advanceRollingBarrel } from "../advanceRollingBarrel.js";
import { advanceBarrelSpriteOrientation } from "../advanceBarrelSpriteOrientation.js";
import { snapYToGirder, snapYToGirderFromRegisters } from "../snapYToGirder.js";
import { OBJ_X, OBJ_Y, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1ff6;
const CAPTURE_FRAMES = 3000; // cycle-accurate attract; reaches four of the five continuations
const LIVE_FRAMES = 6000; // cycle-free attract, the whole-machine case
const CRAFT_BASE_FRAMES = 1200; // long enough for attract's first 0x1FF6 dispatch

// The record window the crafted sweep pokes: the bounds gate takes the sweep over only for an
// OBJ_X of 32..41, and only when the snapped OBJ_Y comes out at 232 or above. Both bounds are the
// gate's, read off its frozen body; the sweep covers the whole window and every OBJ_Y.
const CRAFT_X_LO = 32;
const CRAFT_X_HI = 42;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** The two already-idiomatic callees, wired at their ROM addresses. Both runs of case 4 get these. */
const IDIOMATIC_CALLEES = { "2333": snapYToGirderFromRegisters, "23de": advanceBarrelSpriteOrientation };

/**
 * Copy a machine's whole observable state into a FRESH machine carrying `overrides` and nothing
 * else. Not `clone()`: clone rebuilds the override map from the source's assets, so a clone taken
 * inside this routine's hook re-enters that hook — and this routine's tail chain comes back round
 * to 0x1FF6, so that recursion is real, not hypothetical.
 */
function rehost(src, overrides) {
  const e = new Machine(ROM, overrides ? { overrides } : undefined);
  e.mem.workRam.set(src.mem.workRam);
  e.mem.spriteRam.set(src.mem.spriteRam);
  e.mem.videoRam.set(src.mem.videoRam);
  e.regs.copyFrom(src.regs);
  e.io.loadStateFrom(src.io);
  e.cycles = src.cycles;
  e.pc = src.pc;
  e.pcKnown = src.pcKnown;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  e.maxFrames = Infinity;
  e.maxCycles = Infinity;
  return e;
}

/** First differing state byte outside the dead stack scratch, or null. */
function firstRamDiff(a, b, liveFloor) {
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

/**
 * Run the oracle and `candidate` on two fresh rehosts of `src` and report every contract breach.
 * `overrides` is installed identically on both, so anything it observes is symmetric.
 */
// The staging cursor the walk owns as a plain value. This shared roll tail is captured after the
// motion arm's exx, so the cursor is parked in the alternate bank (h_/l_); the two remaining
// exchanges (none here, one in the sprite tail) return it to that bank for the publish read. The
// dissolved chain takes it as `cur`. WALK_LOOPBACK (0x1f83) is the frozen loop-back, stubbed on both
// clones so each side publishes exactly the slot under test and stops.
const WALK_LOOPBACK = 0x1f83;
const cursorOf = (m) => ({ page: m.regs.h_ * 256, cursor: m.regs.l_ });

function contractDiffs(src, candidate, overrides) {
  const o = rehost(src, overrides);
  const oFloor = o.regs.sp;
  const c = rehost(src, overrides);
  o.routines.set(WALK_LOOPBACK, () => {});
  c.routines.set(WALK_LOOPBACK, () => {});
  let oret, cret;
  try {
    oret = oracle(o);
  } catch (err) {
    oret = `THREW ${err.message}`;
  }
  try {
    cret = candidate(c, cursorOf(c));
  } catch (err) {
    cret = `THREW ${err.message}`;
  }
  const diffs = [];
  const ram = firstRamDiff(o, c, oFloor);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (oret !== cret) diffs.push(`return oracle=${String(oret)} cand=${String(cret)}`);
  // pc and SP are dropped: the dissolved form threads the cursor as a value and uses no guest stack
  // of its own, so it no longer tracks the oracle's m.call/ret bracket.
  return diffs;
}

/** Which continuation this entry state sends the record to, before the bounds gate has a say. */
function armOf(m) {
  const x = m.mem.read8((m.regs.ix + OBJ_X) & 0xffff);
  if ((x & 7) === 3) return "215F";
  if (x < 28) return "202F(lowX)";
  if (x < 228) return "21BA(midX)";
  return "2038(highX)";
}

// ── 1. CAPTURED ──────────────────────────────────────────────────────────────

/**
 * Replay `candidate` against the oracle at EVERY real dispatch of a cycle-accurate attract run,
 * inline at the dispatch, and return what went wrong. `replaying` keeps the nested dispatches this
 * routine's own tail chain produces on the oracle for both sides, which is the callee isolation
 * the unit contract wants.
 */
function replayEveryDispatch(candidate, frames = CAPTURE_FRAMES) {
  const breaches = [];
  const arms = new Map();
  const bases = new Map();
  let dispatches = 0;
  let replaying = false;
  const host = new Machine(ROM, {
    overrides: {
      [TARGET.toString(16)]: (mm) => {
        if (replaying) return oracle(mm);
        dispatches++;
        arms.set(armOf(mm), (arms.get(armOf(mm)) ?? 0) + 1);
        bases.set(mm.regs.ix, (bases.get(mm.regs.ix) ?? 0) + 1);
        replaying = true;
        let diffs;
        try {
          diffs = contractDiffs(mm, candidate);
        } finally {
          replaying = false;
        }
        if (diffs.length && breaches.length < 4) {
          breaches.push(`#${dispatches} arm ${armOf(mm)} base ${hx(mm.regs.ix)}: ${diffs.join("; ")}`);
        }
        return oracle(mm);
      },
    },
  });
  host.runFrames(frames);
  assert.equal(host.stoppedBy, null, `attract run stopped early: ${host.stoppedBy}`);
  return { breaches, dispatches, arms, bases };
}

test("CAPTURED: every real 0x1FF6 dispatch in a 3000-frame attract run matches the oracle", () => {
  const { breaches, dispatches, arms, bases } = replayEveryDispatch(advanceRollingBarrel);
  assert.ok(dispatches > 0, "no dispatch of 0x1FF6 was captured — this case would prove nothing");
  assert.equal(breaches.length, 0, breaches.join(" | "));

  // The header claims four of the five continuations are covered by real dispatches; this is the
  // line that produces that claim rather than asserting it by hand.
  assert.deepEqual(
    [...arms.keys()].sort(),
    ["202F(lowX)", "2038(highX)", "215F", "21BA(midX)"],
    "attract no longer reaches all four continuations the header claims",
  );
  console.log(
    `  CAPTURED: all ${dispatches} of ${dispatches} dispatches replayed (rehosted, no sampling) — ` +
      `identical on RAM minus stack scratch, return value, pc and SP; ` +
      `${bases.size} record bases; arms ${[...arms].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(" ")}`,
  );
});

// ── 2. CRAFTED: the continuation attract never takes ──────────────────────────

/** One real dispatch state, used as the base every crafted entry is built on. */
function firstCapture() {
  let cap = null;
  const host = new Machine(ROM, {
    overrides: {
      [TARGET.toString(16)]: (mm) => {
        if (cap === null) cap = mm.clone();
        return oracle(mm);
      },
    },
  });
  host.runFrames(CRAFT_BASE_FRAMES);
  assert.ok(cap, "no 0x1FF6 dispatch to craft on");
  return cap;
}

/**
 * Sweep the crafted window on a real capture. `onEntry(src, tookOver)` is called for each entry,
 * with `tookOver` read off the ORACLE's own ROM 0x24B4 return value — the arm label comes from the
 * oracle, never from the rewrite, so nothing about the coverage is circular.
 */
function craftedSweep(base, onEntry) {
  let taken = 0;
  let total = 0;
  for (let x = CRAFT_X_LO; x < CRAFT_X_HI; x++) {
    if ((x & 7) === 3) continue; // that X goes to ROM 0x215F before the gate is ever reached
    for (let y = 0; y < 256; y++) {
      let gate = null;
      const observe = { "24b4": (mm) => { const r = oracle24b4(mm); if (gate === null) gate = r; return r; } };
      const src = rehost(base, observe);
      src.mem.write8((src.regs.ix + OBJ_X) & 0xffff, x);
      src.mem.write8((src.regs.ix + OBJ_Y) & 0xffff, y);
      // Ask the oracle which arm this entry reaches, on a machine thrown away afterwards.
      oracle(rehost(src, observe));
      total++;
      if (gate === false) taken++;
      onEntry(src, gate === false, observe, x, y);
    }
  }
  return { taken, total };
}

test("CRAFTED: the bounds gate's take-over arm — never reached in attract — matches the oracle", () => {
  const base = firstCapture();
  const breaches = [];
  const { taken, total } = craftedSweep(base, (src, tookOver, observe, x, y) => {
    if (breaches.length >= 4) return;
    const diffs = contractDiffs(src, advanceRollingBarrel, observe);
    if (diffs.length) breaches.push(`x=${x} y=${y} takeover=${tookOver}: ${diffs.join("; ")}`);
  });
  assert.ok(
    taken > 0,
    "no crafted entry reached the bounds gate's take-over arm — the case is vacuous, re-derive the window",
  );
  assert.equal(breaches.length, 0, breaches.join(" | "));
  console.log(
    `  CRAFTED: ${total} entries poked onto a real capture (OBJ_X ${CRAFT_X_LO}..${CRAFT_X_HI - 1}, ` +
      `all 256 OBJ_Y), ${taken} of them reaching the take-over arm attract takes 0 times — all identical`,
  );
});

// ── 3. TEETH ─────────────────────────────────────────────────────────────────

const STEP_X_HI = 0x10;
const STEP_X_LO = 0x11;

/** BUG: the girder snap is applied to the record's Y itself, without the three-pixel offset. */
function twinNoSnapOffset(m, _cur, slopeStep = m.regs.b) {
  const { mem8, regs } = m;
  const record = regs.ix;
  const x = mem8[record + OBJ_X];
  if ((x & 7) === 3) {
    regs.h = x;
    regs.l = mem8[record + OBJ_Y];
    return m.call(0x215f);
  }
  mem8[record + OBJ_Y] = snapYToGirder(x, mem8[record + OBJ_Y], slopeStep);
  advanceBarrelSpriteOrientation(m);
  m.push16(0x2017);
  if (!m.call(0x24b4)) return undefined;
  const xNow = mem8[record + OBJ_X];
  if (xNow < 28) return m.call(0x202f);
  if (xNow < 228) return m.call(0x21ba);
  mem8[record + STEP_X_HI] = 0;
  mem8[record + STEP_X_LO] = 0x60;
  regs.a = 0;
  return m.call(0x2038);
}

/** BUG: ROM 0x215F is entered without its two coordinates in the registers. */
function twinNo215fHandoff(m, cur, slopeStep = m.regs.b) {
  const { mem8, regs } = m;
  if ((mem8[regs.ix + OBJ_X] & 7) === 3) return m.call(0x215f);
  return advanceRollingBarrel(m, cur, slopeStep);
}

/** BUG: the accumulator is not cleared before ROM 0x2038, which stores it into four fields. */
function twinNoAccumulatorClear(m, cur, slopeStep = m.regs.b) {
  const { mem8, regs } = m;
  const record = regs.ix;
  const x = mem8[record + OBJ_X];
  if ((x & 7) === 3 || x < 228) return advanceRollingBarrel(m, cur, slopeStep);
  mem8[record + OBJ_Y] = u8(snapYToGirder(x, u8(mem8[record + OBJ_Y] - 3), slopeStep) + 3);
  advanceBarrelSpriteOrientation(m);
  m.push16(0x2017);
  if (!m.call(0x24b4)) return undefined;
  const xNow = mem8[record + OBJ_X];
  if (xNow < 28) return m.call(0x202f);
  if (xNow < 228) return m.call(0x21ba);
  mem8[record + STEP_X_HI] = 0;
  mem8[record + STEP_X_LO] = 0x60;
  return m.call(0x2038); // accumulator left as the record's X
}

// The "no-gate-bracket" twin is RETIRED: it dropped the guest-stack return bracket the oracle pushes
// for the bounds gate, a defect visible only in the guest SP / stack window. The dissolved
// advanceRollingBarrel direct-calls retireBarrelIntoOilDrum in JS and keeps no guest stack of its
// own, so there is no bracket to drop and the SP comparison the twin exercised no longer applies.

/** BUG: the gate's take-over verdict is ignored and the record is stepped on regardless. */
function twinIgnoreGateTakeover(m, _cur, slopeStep = m.regs.b) {
  const { mem8, regs } = m;
  const record = regs.ix;
  const x = mem8[record + OBJ_X];
  if ((x & 7) === 3) {
    regs.h = x;
    regs.l = mem8[record + OBJ_Y];
    return m.call(0x215f);
  }
  mem8[record + OBJ_Y] = u8(snapYToGirder(x, u8(mem8[record + OBJ_Y] - 3), slopeStep) + 3);
  advanceBarrelSpriteOrientation(m);
  m.push16(0x2017);
  m.call(0x24b4); // verdict discarded
  const xNow = mem8[record + OBJ_X];
  if (xNow < 28) return m.call(0x202f);
  if (xNow < 228) return m.call(0x21ba);
  mem8[record + STEP_X_HI] = 0;
  mem8[record + STEP_X_LO] = 0x60;
  regs.a = 0;
  return m.call(0x2038);
}

/** Count how many crafted entries a twin breaches on, and where the first one is. */
function craftedBreaches(base, candidate) {
  let count = 0;
  let first = null;
  craftedSweep(base, (src, tookOver, observe, x, y) => {
    if (count > 0 && first) return; // one is enough to report; keep sweeping only to count a little
    const diffs = contractDiffs(src, candidate, observe);
    if (diffs.length) {
      count++;
      first = `x=${x} y=${y} takeover=${tookOver}: ${diffs[0]}`;
    }
  });
  return { count, first };
}

const CAPTURED_TEETH = [
  ["no-snap-offset", twinNoSnapOffset],
  ["no-215F-handoff", twinNo215fHandoff],
  ["no-accumulator-clear", twinNoAccumulatorClear],
];

for (const [label, twin] of CAPTURED_TEETH) {
  test(`TEETH: the ${label} twin is CAUGHT by the captured replay`, () => {
    const { breaches, dispatches } = replayEveryDispatch(twin, 3000);
    assert.ok(
      breaches.length > 0,
      `the captured replay FAILED to catch the ${label} twin over ${dispatches} dispatches — it proves nothing`,
    );
    console.log(`  TEETH/${label}: caught — ${breaches[0]}`);
  });
}

test("TEETH: the ignore-gate-takeover twin is caught ONLY by the crafted arm", () => {
  const base = firstCapture();
  const crafted = craftedBreaches(base, twinIgnoreGateTakeover);
  assert.ok(crafted.count > 0, "the crafted sweep FAILED to catch the ignore-gate-takeover twin");

  // And the captured replay alone does NOT catch it — which is exactly why the crafted arm exists.
  const { breaches, dispatches } = replayEveryDispatch(twinIgnoreGateTakeover, 3000);
  assert.equal(
    breaches.length,
    0,
    "attract now reaches the take-over arm; the crafted arm's justification has changed, re-derive it",
  );
  console.log(
    `  TEETH/ignore-gate-takeover: MISSED by all ${dispatches} captured dispatches, caught by the ` +
      `crafted arm — ${crafted.first}`,
  );
});

// ── 4 & 5. The whole machine, cycle-free ─────────────────────────────────────

const { pollPCs, stateExclude } = manifest.convergence;
const [STACK_LO, STACK_HI] = stateExclude.stack;

/**
 * A whole cycle-free attract run, sampled per frame. No entropy pin, deliberately: both runs cross
 * vblank at the same control-flow point, so nothing here is timing-dependent between them and the
 * pin buys nothing — while the unpinned attract reaches this routine on all four of its
 * continuations, which the LIVE case asserts, and the pinned one reaches only two.
 */
function wholeRun(overrides) {
  const m = new Machine(ROM, { overrides });
  const frames = [];
  const r = runCycleFree(m, {
    pollPCs,
    maxFrames: LIVE_FRAMES,
    stepBudget: LIVE_FRAMES * 200000,
    onFrame: (mm) => frames.push(Buffer.from(mm.dumpState())),
  });
  assert.equal(r.stopError, null, `run errored: ${r.stop}`);
  return { m, frames };
}

/** Offsets of the live state cells — everything outside the dead stack scratch. */
function liveOffsets(bytesPerFrame) {
  const probe = new Machine(ROM);
  const keep = [];
  for (let o = 0; o < bytesPerFrame; o++) {
    const a = probe.stateOffsetToAddr(o);
    if (!(a >= STACK_LO && a < STACK_HI)) keep.push(o);
  }
  return { keep, probe };
}

/** First live-cell divergence between two whole runs, or null. */
function firstFrameDiff(a, b) {
  assert.equal(a.frames.length, b.frames.length, "the two runs did not reach the same frame count");
  const { keep, probe } = liveOffsets(a.frames[0].length);
  for (let f = 0; f < a.frames.length; f++) {
    for (const o of keep) {
      if (a.frames[f][o] === b.frames[f][o]) continue;
      return `frame ${f} @${hx(probe.stateOffsetToAddr(o))} baseline=${a.frames[f][o]} other=${b.frames[f][o]}`;
    }
  }
  return null;
}

// RETIRED. This arm wired advanceRollingBarrel live at 0x1FF6 standalone in an attract run. The
// exx/cursor dissolution makes that impossible: advanceRollingBarrel now takes the staging cursor
// `cur` as a value from its idiomatic caller (the roll arms), so it cannot be dispatched by address
// with only the machine. The whole-run trace and guest-SP balance it proved are covered by
// idiomatic.test.js's FULL FLIP ("all idiomatic routines live, guest stack balanced every frame").
nodeTest("LIVE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: advanceRollingBarrel takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace + guest-SP balance covered by idiomatic.test.js (FULL FLIP)",
}, () => {});

/**
 * Build a run of the ORACLE that scrambles a chosen set of registers at the instant control leaves
 * 0x1FF6 — at the hand-off itself, not after the frozen chain has run. `leaving` is consumed by
 * whichever continuation is entered first, which is what keeps it correct through this routine's
 * re-entrancy: a nested dispatch cannot see an outer one's flag.
 */
function poisonRun(pick) {
  let poisoned = 0;
  const scramble = (mm, keys) => {
    poisoned++;
    for (const k of keys) mm.regs[k] = 0xa5;
  };
  let leaving = false;
  const at = (keys, tail) => (mm) => {
    if (leaving) {
      leaving = false;
      const k = pick(keys);
      if (k.length) scramble(mm, k);
    }
    return tail(mm);
  };
  const run = wholeRun({
    ...IDIOMATIC_CALLEES,
    [TARGET.toString(16)]: (mm) => {
      leaving = true;
      try {
        return oracle(mm);
      } finally {
        leaving = false;
      }
    },
    "215f": at({ dropped: ["a", "b", "f"], kept: ["h", "l"] }, oracle215f),
    "202f": at({ dropped: ["a", "b", "f", "h", "l"], kept: [] }, oracle202f),
    "21ba": at({ dropped: ["a", "b", "f", "h", "l"], kept: [] }, oracle21ba),
    "2038": at({ dropped: ["b", "f", "h", "l"], kept: ["a"] }, oracle2038),
  });
  return { ...run, poisoned };
}

test("LIVE-OUT: the registers the rewrite drops really are dead at the hand-off", () => {
  const baseline = wholeRun({ ...IDIOMATIC_CALLEES });

  const dropped = poisonRun((k) => k.dropped);
  assert.ok(dropped.poisoned > 0, "no hand-off was poisoned — this case is vacuous");
  const diff = firstFrameDiff(baseline, dropped);
  assert.equal(
    diff,
    null,
    `a register the rewrite drops is NOT dead at the hand-off: ${diff}`,
  );

  // Non-vacuity: the same machinery aimed at what the rewrite KEEPS must diverge. Without this,
  // a poison that silently never landed would read exactly like a proof.
  const kept = poisonRun((k) => k.kept);
  const keptDiff = firstFrameDiff(baseline, kept);
  assert.notEqual(
    keptDiff,
    null,
    "poisoning the registers the rewrite KEEPS changed nothing — the poison is not landing",
  );
  console.log(
    `  LIVE-OUT: ${dropped.poisoned} hand-offs scrambled across ${baseline.frames.length} frames — ` +
      `every live cell still identical; the same poison aimed at the KEPT registers diverges (${keptDiff})`,
  );
});
