// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1bf2 (ROM 0x1BF2) — the airborne handler's leftward-nudge arm.
 *
 * loc_1bf2 is entered by a tail branch from the airborne handler advanceMarioAirborneFrame, carrying the
 * position gate's LEFT verdict in the register bank (both the frozen ROM 0x1BB2 oracle this
 * suite replays against and the idiomatic advanceMarioAirborneFrame hand it over that way):
 *
 *   verdict not raised -> hand straight on to the airborne dispatch 0x1C05, changing nothing
 *   verdict raised     -> MARIO_AIR_VX := 0xFF80 (half a pixel per frame leftward),
 *                         clear MARIO_SPRITE_CODE's facing bit, then the 0x1BD8 tail
 *
 * The 0x1BD8 tail is direct-called (it has an idiomatic file); the 0x1C05 tail is still the
 * frozen oracle and stays a registry call. Either way the whole chain below runs on BOTH sides
 * of every comparison here, so a wrong hand-off surfaces as divergent RAM downstream rather
 * than staying local.
 *
 * MEMORY-EQUIVALENCE CONTRACT. RAM − the stack scratch below the entry SP [0x6be0,0x6c00), plus the forwarded return
 * value; live-out is otherwise memory-only. pc/SP/registers/flags are NOT compared: the tail
 * m.call(0x1C05) was dissolved to a direct loc_1c05 call, so they are seam artifacts (whole-game
 * SP-inertness guards SP), and no register/flag/pose/velocity survives past the branch — every
 * decision is written to RAM. The dissolution also leaves the oracle's guest-stack return marker
 * unmatched inside STACK_SCRATCH, which the contract already excludes.
 *
 *   1. REALISM (captured) — hook 0x1BF2 in a real attract run: 360 dispatches, of which a
 *      120-dispatch sample is replayed in full. All 360 take the NOT-raised arm (checked on
 *      every dispatch, not just the sample): plain attract never gets Mario airborne past the
 *      gate's right-hand limit, so the raised arm is genuinely unreached there. The same tally
 *      pins the other fact the routine's header leans on — the context-block base register is
 *      Mario's block on every one of the 360.
 *
 *   2. REALISM (captured under a control poke) — the raised arm is NOT dead code, and it is
 *      not covered by fabrication: holding MARIO_X past the gate's right-hand limit in an
 *      otherwise untouched attract run makes the REAL ROM take the raised arm 2713 times.
 *      Those real dispatches are captured and replayed as their own suite.
 *
 *   3. EXHAUSTIVE (crafted from real bases) — the verdict register is the routine's only
 *      decision input, so it is swept over ALL 256 values from a real captured base, crossed
 *      with the facing bit set/clear (the poked run only ever presents it clear, so the
 *      bit-CLEAR semantics are only observable here) and with MARIO_FATAL_FALL 0/1 so both of
 *      the 0x1BD8 tail's own arms run. 1024 cases, identical on both sides.
 *
 *   4. TEETH — five broken twins, each MUST be caught:
 *      (a) inverted verdict test        — nudges when it should skip.
 *      (b) any-nonzero verdict test     — invisible to attract (verdict is always 0 there);
 *                                         ONLY the exhaustive sweep catches it.
 *      (c) wrong drift sign (0x0080)    — caught at MARIO_X: the tail's integrator applies the
 *                                         stamped velocity on the same frame, so a flipped
 *                                         sign moves Mario the wrong way immediately.
 *      (d) dropped facing-bit clear     — invisible unless the bit was set, so ONLY the
 *                                         crafted facing-set cases catch it.
 *      (e) wrong tail (0x1C05 on the raised arm) — skips the arc re-base.
 *
 *      Each twin is otherwise byte-for-byte the real routine, tail included, so the one
 *      difference under test is the only difference there is.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1bf2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1bf2 as oracle } from "../../translated/loc_1bf2.js";
import { loc_1bf2 } from "../loc_1bf2.js";
import { reverseMarioVerticalArc } from "../reverseMarioVerticalArc.js"; // ROM 0x1BD8 — the real routine's tail, so each twin differs in exactly one way
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_ACTIVE,
  MARIO_X,
  MARIO_AIR_VX_HI,
  MARIO_AIR_VX_LO,
  MARIO_SPRITE_CODE,
  MARIO_FATAL_FALL,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1bf2;
const FACING_BIT = 0x80; // horizontal-flip bit of MARIO_SPRITE_CODE (1 = facing right)
const OFF_SCREEN_RIGHT = 0xf0; // past limitMarioHorizontalTravel's 0xEA right-hand limit — forces the raised verdict

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First differing RAM byte OUTSIDE the stack scratch below the entry SP (the declared contract). */
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

/**
 * Run one implementation on a fresh clone of the entry state. Both sides are handed the SAME
 * context-block accessor the frozen ROM 0x1BB2 oracle passes its tail branch — a closure over
 * the clone's own live base register, so neither side can be advantaged by it. The idiomatic
 * routine ignores it (it names its cells and its tail names its own), which is exactly the
 * difference under test.
 */
function run(entry, fn) {
  const c = entry.clone();
  const value = fn(c, (field) => (c.regs.ix + field) & 0xffff);
  return { c, value };
}

/** The declared contract: RAM − the stack scratch below the entry SP plus the forwarded return value (pc/SP excluded — seam artifacts). */
function contractDiffs(entry, fn) {
  const o = run(entry, oracle);
  const c = run(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.c, c.c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  // pc/SP dropped: the tail m.call(0x1C05) was dissolved to a direct loc_1c05 call, so pc and
  // SP are now seam artifacts, never game live-outs; the whole-game SP-inertness tests guard SP.
  if (o.value !== c.value) diffs.push(`return oracle=${o.value} cand=${c.value}`);
  return diffs;
}

/**
 * Run a real attract session with 0x1BF2 hooked, cloning the machine at each dispatch that
 * passes `keep`. `pokes` is the machine's own poke tape — used by suite 2 to hold Mario past
 * the gate's right-hand limit so the REAL ROM drives the raised arm.
 */
function captureDispatches({ frames = 6000, limit = 120, pokes = null, keep = () => true } = {}) {
  const caps = [];
  const verdicts = new Map(); // every dispatch's verdict register, cloned or not
  const bases = new Set(); // every dispatch's context-block base register
  let total = 0;
  const overrides = new Map([[TARGET, (mm, accessor) => {
    total++;
    verdicts.set(mm.regs.e, (verdicts.get(mm.regs.e) ?? 0) + 1);
    bases.add(mm.regs.ix);
    if (keep(mm) && caps.length < limit) caps.push(mm.clone());
    return oracle(mm, accessor);
  }]]);
  const host = new Machine(ROM, { overrides });
  if (pokes) host.pokes = pokes;
  host.runFrames(frames);
  return { caps, total, verdicts, bases };
}

// One plain-attract capture run, shared by the suites that only need realistic BASE states
// (the crafted sweep and the teeth). Suite 1 does its own run so its count is its own.
let attractCache = null;
const attractCaptures = () => (attractCache ??= captureDispatches({ limit: 60 }));

// -- 1. REALISM (captured, plain attract) -------------------------------------

test("REALISM: real captured 0x1BF2 attract dispatches — loc_1bf2 matches the oracle chain", () => {
  const { caps, total, verdicts, bases } = captureDispatches({});
  assert.ok(caps.length >= 1, "expected at least one real 0x1BF2 dispatch during attract");

  // The header's two standing claims, checked over EVERY dispatch of the run (not just the
  // replayed sample): the context-block base is pinned to Mario, and plain attract only ever
  // supplies the not-raised verdict — which is why the raised arm needs suites 2 and 3.
  assert.deepEqual([...bases], [MARIO_ACTIVE], "the base register must be pinned to Mario's context block");
  assert.deepEqual([...verdicts.keys()], [0], "plain attract only ever supplies the not-raised verdict");
  assert.equal(verdicts.get(0), total);

  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_1bf2);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
  }
  console.log(`  REALISM/attract: ${total} real 0x1BF2 dispatches, all not-raised, base pinned to Mario; ${caps.length} replayed identical`);
});

// -- 2. REALISM (captured, raised arm driven by a control poke) ----------------

test("REALISM: the raised arm is REACHABLE — real poked-run 0x1BF2 dispatches match the oracle", () => {
  const pokes = [{ addr: MARIO_X, val: OFF_SCREEN_RIGHT, frame: 1500, dur: 3000 }];
  let raised = 0;
  const { caps, total } = captureDispatches({
    pokes,
    keep: (mm) => { if (mm.regs.e !== 1) return false; raised++; return true; },
  });
  assert.ok(raised > 100, `holding MARIO_X past the gate limit must drive the raised arm, got ${raised}`);
  assert.ok(caps.length >= 50, `expected a real sample of raised dispatches, got ${caps.length}`);

  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_1bf2);
    assert.equal(diffs.length, 0, `captured raised dispatch: ${diffs.join("; ")}`);
    // The raised arm's whole point: the oracle really does stamp the leftward drift here.
    const after = run(entry, oracle).c;
    assert.equal(after.mem.read8(MARIO_AIR_VX_HI), 0xff);
    assert.equal(after.mem.read8(MARIO_AIR_VX_LO), 0x80);
  }
  console.log(`  REALISM/poked: raised arm taken ${raised} of ${total} real dispatches; ${caps.length} replayed identical`);
});

// -- 3. EXHAUSTIVE (crafted from a real base) ---------------------------------

test("EXHAUSTIVE: all 256 verdict values × facing bit × fatal-fall match the oracle", () => {
  const { caps } = attractCaptures();
  const base = caps[caps.length - 1];
  const basePose = base.mem.read8(MARIO_SPRITE_CODE);

  let cases = 0;
  for (let verdict = 0; verdict < 256; verdict++) {
    for (const facing of [0, FACING_BIT]) {
      for (const fatal of [0, 1]) {
        const entry = base.clone();
        entry.regs.e = verdict;
        entry.mem.write8(MARIO_SPRITE_CODE, (entry.mem.read8(MARIO_SPRITE_CODE) & ~FACING_BIT) | facing);
        entry.mem.write8(MARIO_FATAL_FALL, fatal);
        const diffs = contractDiffs(entry, loc_1bf2);
        assert.equal(diffs.length, 0, `verdict=${verdict} facing=${facing} fatal=${fatal}: ${diffs.join("; ")}`);
        cases++;
      }
    }
  }

  // Positive assertions on the raised arm, so a green sweep is not just "two wrongs agreeing":
  // the facing bit is CLEARED (not stored), and only verdict 1 does anything at all.
  const facingSet = base.clone();
  facingSet.regs.e = 1;
  facingSet.mem.write8(MARIO_SPRITE_CODE, basePose | FACING_BIT);
  const raisedAfter = run(facingSet, loc_1bf2).c;
  assert.equal(raisedAfter.mem.read8(MARIO_SPRITE_CODE) & FACING_BIT, 0, "the raised arm must clear the facing bit");
  assert.equal(raisedAfter.mem.read8(MARIO_SPRITE_CODE) & 0x7f, basePose & 0x7f,
    "the raised arm must preserve the pose bits under the facing bit");

  const notRaised = base.clone();
  notRaised.regs.e = 2;
  notRaised.mem.write8(MARIO_AIR_VX_HI, 0x5a);
  const skippedAfter = run(notRaised, loc_1bf2).c;
  assert.equal(skippedAfter.mem.read8(MARIO_AIR_VX_HI), 0x5a, "a not-raised verdict must leave the drift alone");

  // STACK RESIDUE not asserted: the dissolved tail leaves the oracle's guest-stack return marker
  // in STACK_SCRATCH (excluded by the contract above), not a defect.

  console.log(`  EXHAUSTIVE: ${cases} crafted verdict/facing/fatal-fall cases identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): inverted verdict test — nudges on every verdict except the raised one. */
function brokenInvertedVerdict(m) {
  const { regs, mem } = m;
  if (regs.e === 1) return m.call(0x1c05);
  mem.write8(MARIO_AIR_VX_HI, 0xff);
  mem.write8(MARIO_AIR_VX_LO, 0x80);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & ~FACING_BIT);
  return reverseMarioVerticalArc(m);
}

/** Broken twin (b): treats ANY nonzero verdict as raised — invisible to attract (verdict 0). */
function brokenAnyNonzeroVerdict(m) {
  const { regs, mem } = m;
  if (regs.e === 0) return m.call(0x1c05);
  mem.write8(MARIO_AIR_VX_HI, 0xff);
  mem.write8(MARIO_AIR_VX_LO, 0x80);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & ~FACING_BIT);
  return reverseMarioVerticalArc(m);
}

/** Broken twin (c): drift sign flipped — pushes RIGHT out of the screen instead of back in. */
function brokenDriftSign(m) {
  const { regs, mem } = m;
  if (regs.e !== 1) return m.call(0x1c05);
  mem.write8(MARIO_AIR_VX_HI, 0x00); // BUG: +0x0080, not −0x0080
  mem.write8(MARIO_AIR_VX_LO, 0x80);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & ~FACING_BIT);
  return reverseMarioVerticalArc(m);
}

/** Broken twin (d): drops the facing-bit clear — only visible when the bit was already set. */
function brokenDroppedFacingClear(m) {
  const { regs, mem } = m;
  if (regs.e !== 1) return m.call(0x1c05);
  mem.write8(MARIO_AIR_VX_HI, 0xff);
  mem.write8(MARIO_AIR_VX_LO, 0x80);
  // BUG: MARIO_SPRITE_CODE left as it stands
  return reverseMarioVerticalArc(m);
}

/** Broken twin (e): raised arm takes the wrong tail — skips the 0x1BD8 arc rebase. */
function brokenWrongTail(m) {
  const { regs, mem } = m;
  if (regs.e !== 1) return m.call(0x1c05);
  mem.write8(MARIO_AIR_VX_HI, 0xff);
  mem.write8(MARIO_AIR_VX_LO, 0x80);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & ~FACING_BIT);
  return m.call(0x1c05); // BUG: should be the 0x1BD8 tail
}

test("TEETH: five broken twins are each CAUGHT by this suite", () => {
  const { caps } = attractCaptures();
  const base = caps[caps.length - 1];

  const craft = ({ verdict, facing = 0, fatal = 0 }) => {
    const e = base.clone();
    e.regs.e = verdict;
    e.mem.write8(MARIO_SPRITE_CODE, (e.mem.read8(MARIO_SPRITE_CODE) & ~FACING_BIT) | facing);
    e.mem.write8(MARIO_FATAL_FALL, fatal);
    return e;
  };

  // (a) inverted verdict: a REAL attract dispatch (verdict 0) already catches it — the twin
  //     nudges where the oracle does nothing.
  const invDiffs = contractDiffs(caps[0], brokenInvertedVerdict);
  assert.ok(invDiffs.length > 0, "the inverted-verdict twin escaped — the gate is worthless");

  // (b) any-nonzero verdict: attract can NEVER catch this (verdict is always 0 and 0 is
  //     handled identically); it is the exhaustive sweep that bites, at verdict 2.
  const anyOnAttract = contractDiffs(caps[0], brokenAnyNonzeroVerdict);
  assert.equal(anyOnAttract.length, 0, "expected the any-nonzero twin to be INVISIBLE to attract dispatches");
  const anyDiffs = contractDiffs(craft({ verdict: 2 }), brokenAnyNonzeroVerdict);
  assert.ok(anyDiffs.length > 0, "the any-nonzero twin escaped — the exhaustive sweep is worthless");

  // (c) drift sign: caught at MARIO_X — the 0x1BD8 tail's integrator applies the stamped
  //     velocity straight away, so a flipped sign moves Mario the wrong way on the same frame.
  const signDiffs = contractDiffs(craft({ verdict: 1 }), brokenDriftSign);
  assert.ok(signDiffs.length > 0, "the drift-sign twin escaped — the gate is worthless");
  assert.ok(signDiffs[0].startsWith(`RAM@${hx(MARIO_X)}`),
    `expected the drift-sign diff at ${hx(MARIO_X)}, got ${signDiffs[0]}`);

  // (d) dropped facing clear: invisible when the bit is already clear (which is all the real
  //     poked-run dispatches ever show), caught by the crafted facing-set case.
  const facingClearEntry = craft({ verdict: 1, facing: 0 });
  assert.equal(contractDiffs(facingClearEntry, brokenDroppedFacingClear).length, 0,
    "expected the dropped-facing-clear twin to be INVISIBLE when the bit is already clear");
  const facingDiffs = contractDiffs(craft({ verdict: 1, facing: FACING_BIT }), brokenDroppedFacingClear);
  assert.ok(facingDiffs.length > 0, "the dropped-facing-clear twin escaped — the facing sweep is worthless");
  assert.ok(facingDiffs[0].startsWith(`RAM@${hx(MARIO_SPRITE_CODE)}`),
    `expected the facing diff at ${hx(MARIO_SPRITE_CODE)}, got ${facingDiffs[0]}`);

  // (e) wrong tail: the 0x1BD8 rebase never runs, so the ballistic block diverges.
  const tailDiffs = contractDiffs(craft({ verdict: 1 }), brokenWrongTail);
  assert.ok(tailDiffs.length > 0, "the wrong-tail twin escaped — the gate is worthless");

  console.log(`  TEETH: inverted (${invDiffs[0]}); any-nonzero (${anyDiffs[0]}); ` +
    `sign (${signDiffs[0]}); facing (${facingDiffs[0]}); wrong-tail (${tailDiffs[0]})`);
});
