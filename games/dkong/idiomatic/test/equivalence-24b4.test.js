// SPDX-License-Identifier: GPL-3.0-only
/**
 * retireBarrelIntoOilDrum — memory-equivalent to the frozen oracle at ROM 0x24B4 — the
 * object-retirement gate: an object whose OBJ_Y has reached 232 with its OBJ_X inside the 32..41
 * band is retired (slot freed, column blanked, impact sound asserted, two mode latches armed) and
 * handed to the shared object-sprite tail WITHOUT returning to the caller; anything else returns
 * untouched. ATTRACT ONLY — credited play and boards 2-4 are NOT covered (this walk runs on 25m).
 *
 * What this gate covers:
 *   1. EQUAL (captured): a 1200-frame attract run dispatches 0x24B4 1154 times (first at frame 613)
 *      across five OBJ_ARRAY_67 record bases. EVERY dispatch is replayed inline — no sampling, which
 *      is load-bearing: attract's entire coverage of the band's high edge (one OBJ_X == 42) and of
 *      the retirement arm is one dispatch each, and two twins are caught by exactly those. Each
 *      replay isolates ONE dispatch (candidate called on a fresh override-free machine; re-entries
 *      run the ORACLE on both sides).
 *   2. EQUAL (crafted): five arms for what attract cannot produce, each ONE poke on a real capture,
 *      each proved non-vacuous by counting the dispatches on which the craft moves the oracle:
 *        (a) bandBelow — bottom with OBJ_X below the band.
 *        (b) edgeJustAbove — one row short of the threshold, inside the band.
 *        (c) edgeAtThreshold — exactly at the threshold, inside the band.
 *        (d) retireBaseKind — retirement of a kind-0 record (attract's one retirement is kind 1), so
 *            the phase write is skipped.
 *        (e) retireAlreadyLatched — latch already holding 2, so the latch write is skipped and its
 *            value must survive (reachability not claimed; the arm pins the comparison).
 *   3. CONTRACT: work/sprite/video RAM MINUS the stack scratch below the entry SP plus the returned protocol value. The
 *      dissolved candidate is a plain JS call owning no guest stack; the oracle still splices through
 *      it (its retire arm pops the caller's return), so SP, pc and dead scratch below SP legitimately
 *      differ and are excluded.
 *   4. LIVE — retired (see the skip below).
 *   5. TEETH — the test asserts WHICH half catches each. Five escape natural and are caught by a
 *      crafted arm (Y threshold low->b, Y threshold high->c, band low edge dropped->a, phase write
 *      unconditional->d, one-shot latch dropped->e); three are caught naturally (band high edge off
 *      by one -> RAM on the single OBJ_X == 42; column blank dropped -> RAM; wrong protocol value ->
 *      the RETURN comparison). The old "leaked return bracket" twin is retired (pc-only, no longer
 *      produced or compared).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-24b4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_24b4 as oracle } from "../../translated/loc_24b4.js";
import { retireBarrelIntoOilDrum } from "../retireBarrelIntoOilDrum.js";
import { OBJ_ACTIVE, OBJ_X, OBJ_Y, OBJ_ARRAY_67, SND_TRIGGER, STACK_SCRATCH } from "../names.js";
import { runCycleFree } from "../../../../core/frame-stepped.js";
import manifest from "../../manifest.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x24b4;
// The frozen walk's loop-back into the per-slot step, stubbed on both clones so each side publishes
// exactly the slot under test and stops (the dissolved chain no longer loops back through the tail).
const WALK_LOOPBACK = 0x1f83;
const ATTRACT_FRAMES = 1200;

// The routine's own constants, restated here so a twin that changes one is compared against a
// number this file owns rather than against the file under test.
const BOTTOM_ROW = 232;
const BAND_LO = 32;
const BAND_HI = 42;
const OBJ_KIND = 0x15;
const PHASE_BITS = 0x62b9;
const MODE_LATCH = 0x6348;
const IMPACT_SOUND = SND_TRIGGER + 2;

// Attract is deterministic, so these are exact. Asserted, not merely printed — a sweep that
// silently stops dispatching would otherwise read as green.
const CAPTURED_DISPATCHES = 1154; // cycle-accurate runFrames, 1200 frames
const LIVE_DISPATCHES = 1183; // cycle-free runCycleFree, 1200 frames (a different frame clock)
// The natural arm census, which is what makes the "one dispatch each" claim above checkable.
const NATURAL_ARMS = { "ret above the bottom": 1130, "ret past the band": 23, "ret below the band": 0, retire: 1 };
const RECORD_BASES = 5; // OBJ_ARRAY_67 records 0..4, the ones attract's walk reaches

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- rehosting: a fresh, override-free machine carrying `src`'s state --------------

/**
 * Copy a machine's state into a FRESH Machine with no overrides (the oracle and the dissolved
 * candidate both run directly on it — the oracle as a plain call, the candidate as a JS import).
 *
 * Not `clone()`: clone rebuilds from `this.assets`, so it would carry the capturing hook and
 * every replay would re-enter it. `fn` stays as an optional override for completeness, but the
 * sweep passes null: no seam is installed, so the frozen tail the oracle splices into resolves
 * to its ORACLE routine, matching the frozen tail the candidate calls.
 */
function rehost(src, fn) {
  const c = new Machine(ROM, fn ? { overrides: new Map([[TARGET, fn]]) } : {});
  c.mem.workRam.set(src.mem.workRam);
  c.mem.spriteRam.set(src.mem.spriteRam);
  c.mem.videoRam.set(src.mem.videoRam);
  c.mem.discardedWrites = src.mem.discardedWrites;
  c.regs.copyFrom(src.regs);
  c.io.loadStateFrom(src.io);
  c.cycles = src.cycles;
  c.pc = src.pc;
  c.pcKnown = src.pcKnown;
  c.frame = src.frame;
  c.nmiCount = src.nmiCount;
  c.booted = src.booted;
  // Pin the scheduler off, exactly as clone() does: a replay must not fire an NMI or sample a
  // frame of its own.
  c.nextBoundary = Infinity;
  c.nextNmi = Infinity;
  c.maxFrames = Infinity;
  c.maxCycles = Infinity;
  return c;
}

/** Which arm the ORACLE's own gate conditions select for this entry state. Never the candidate's. */
function armOf(mm) {
  const record = mm.regs.ix;
  if (mm.mem8[(record + OBJ_Y) & 0xffff] < BOTTOM_ROW) return "ret above the bottom";
  const column = mm.mem8[(record + OBJ_X) & 0xffff];
  if (column >= BAND_HI) return "ret past the band";
  if (column < BAND_LO) return "ret below the band";
  return "retire";
}

// -- the sweep: replay INLINE at every real dispatch ---------------------------

/**
 * Boot attract with a hook at 0x24B4 that, at EVERY real dispatch, rehosts the machine twice,
 * runs the oracle on one and `candidate` on the other, compares, and throws both away before
 * letting the host continue on the oracle. O(1) memory, every dispatch replayed.
 *
 * `prep` is applied identically to both sides, which is how a crafted arm is built on a REAL
 * captured state (coherent stack, live walk registers, the caller's shadow bank) rather than
 * from scratch.
 */
function sweepAttract(candidate, { prep = null, frames = ATTRACT_FRAMES } = {}) {
  let dispatches = 0;
  const breaches = [];
  const arms = new Map();
  const bases = new Map();
  let firstFrame = null;
  // A crafted arm is worthless if it changes nothing; count the dispatches on which it moves the
  // ORACLE's own result, so non-vacuity is a measurement rather than an assumption.
  let prepChangedOracle = 0;

  const tally = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

  const host = new Machine(ROM, { overrides: new Map([[TARGET, (mm) => {
    dispatches++;
    if (firstFrame === null) firstFrame = mm.frames.length;
    tally(bases, mm.regs.ix);

    // The dissolved rewrite is a DIRECT JS call (oracle runs the guest-stack path): it owns no guest
    // stack, so SP/pc aren't compared — the contract is RAM − the stack scratch below the entry SP + the returned protocol value.
    const a = rehost(mm, null); // oracle, run directly (still splices through the guest stack)
    const b = rehost(mm, null); // candidate, called directly
    // Cut the walk to the one slot under test: the dissolved chain publishes one slot and returns (no
    // loop-back), so the oracle is stubbed at the loop-back to match.
    a.routines.set(WALK_LOOPBACK, () => {});
    b.routines.set(WALK_LOOPBACK, () => {});
    if (prep) { prep(a); prep(b); }
    const arm = armOf(a);
    tally(arms, arm);
    // The staging cursor arrives as a value, parked in the alternate bank at entry; reconstruct it
    // AFTER the craft.
    const cur = { page: b.regs.h_ * 256, cursor: b.regs.l_ };

    const dead = deadStackBelow(STACK_SCRATCH, a.regs.sp);
    let oracleValue, oracleDump;
    try {
      oracleValue = oracle(a);
      oracleDump = a.dumpState();
    } catch (err) {
      // The oracle faulting on a crafted state is a defect in the ARM, not in the candidate.
      throw new Error(`the oracle threw on dispatch #${dispatches} (${arm}): ${err.message}`);
    }

    let breach = null;
    try {
      const candidateValue = candidate(b, cur);
      const candidateDump = b.dumpState();
      for (let i = 0; i < oracleDump.length; i++) {
        if (oracleDump[i] === candidateDump[i]) continue;
        const addr = a.stateOffsetToAddr(i);
        // The oracle's splice pops the guest stack; the rewrite does not — dead scratch, excluded.
        if (dead(addr)) continue;
        breach = { kind: "RAM", addr, a: oracleDump[i], b: candidateDump[i] };
        break;
      }
      if (!breach && oracleValue !== candidateValue) {
        breach = { kind: "return", addr: null, a: String(oracleValue), b: String(candidateValue) };
      }
    } catch (err) {
      // A twin handed a state it should never have accepted can walk off the end of a ROM table
      // and THROW rather than diverge. A fault is a result, so record it as the breach.
      breach = { kind: "threw", addr: null, a: "-", b: err.message };
    }

    if (prep) {
      // Same entry, same oracle, WITHOUT the craft: if the result is identical the craft did
      // nothing on this dispatch.
      const plain = rehost(mm, null);
      oracle(plain);
      const p = plain.dumpState();
      for (let i = 0; i < p.length; i++) if (p[i] !== oracleDump[i]) { prepChangedOracle++; break; }
    }

    if (breach) breaches.push({ dispatch: dispatches, arm, base: mm.regs.ix, ...breach });
    return oracle(mm); // the HOST always runs the oracle, so attract proceeds normally
  }]]) });
  host.runFrames(frames);

  return { dispatches, breaches, arms, bases, firstFrame, prepChangedOracle };
}

const describe = (b) =>
  `dispatch #${b.dispatch} (${b.arm}, base ${hx(b.base)}): ${b.kind}` +
  `${b.addr === null ? "" : "@" + hx(b.addr)} oracle=${b.a} cand=${b.b}`;

// -- the crafted arms ----------------------------------------------------------

const put = (mm, off, v) => { mm.mem8[(mm.regs.ix + off) & 0xffff] = v; };
const BELOW_BAND = BAND_LO - 1;
const INSIDE_BAND = 36;
const WELL_BELOW_BOTTOM = 240;
const ALREADY_LATCHED = 2; // a value neither 0 nor the 1 this routine writes

const CRAFTS = {
  bandBelow: (mm) => { put(mm, OBJ_Y, WELL_BELOW_BOTTOM); put(mm, OBJ_X, BELOW_BAND); },
  edgeJustAbove: (mm) => { put(mm, OBJ_Y, BOTTOM_ROW - 1); put(mm, OBJ_X, INSIDE_BAND); },
  edgeAtThreshold: (mm) => {
    put(mm, OBJ_Y, BOTTOM_ROW); put(mm, OBJ_X, INSIDE_BAND); put(mm, OBJ_KIND, 1);
    mm.mem8[MODE_LATCH] = 0;
  },
  retireBaseKind: (mm) => {
    put(mm, OBJ_Y, WELL_BELOW_BOTTOM); put(mm, OBJ_X, INSIDE_BAND); put(mm, OBJ_KIND, 0);
    mm.mem8[MODE_LATCH] = 0;
  },
  retireAlreadyLatched: (mm) => {
    put(mm, OBJ_Y, WELL_BELOW_BOTTOM); put(mm, OBJ_X, INSIDE_BAND); put(mm, OBJ_KIND, 1);
    mm.mem8[MODE_LATCH] = ALREADY_LATCHED;
  },
};
/** The arm each craft is supposed to drive — asserted, so a craft that stops working is loud. */
const CRAFT_ARM = {
  bandBelow: "ret below the band",
  edgeJustAbove: "ret above the bottom",
  edgeAtThreshold: "retire",
  retireBaseKind: "retire",
  retireAlreadyLatched: "retire",
};

// Node's test runner evaluates the module top to bottom, so these run once at load.
const NATURAL = ROM_PRESENT ? sweepAttract(retireBarrelIntoOilDrum) : null;
const CRAFTED = ROM_PRESENT
  ? Object.fromEntries(Object.entries(CRAFTS).map(([k, prep]) => [k, sweepAttract(retireBarrelIntoOilDrum, { prep })]))
  : null;

// -- 1. EQUAL, on every real attract dispatch ----------------------------------

test("EQUAL: retireBarrelIntoOilDrum matches the oracle on every one of the real attract dispatches", () => {
  assert.ok(NATURAL.dispatches > 0, "no dispatch of 0x24B4 was captured — the harness never engaged");
  assert.equal(
    NATURAL.dispatches, CAPTURED_DISPATCHES,
    `attract dispatched 0x24B4 ${NATURAL.dispatches} times, not the ${CAPTURED_DISPATCHES} this gate claims`,
  );
  assert.equal(
    NATURAL.breaches.length, 0,
    NATURAL.breaches.length ? `${NATURAL.breaches.length} breach(es), first: ${describe(NATURAL.breaches[0])}` : "",
  );

  // The arm census the header's "one dispatch each" claim rests on.
  for (const [arm, want] of Object.entries(NATURAL_ARMS)) {
    assert.equal(NATURAL.arms.get(arm) ?? 0, want, `attract took the "${arm}" arm ${NATURAL.arms.get(arm) ?? 0} times, not ${want}`);
  }
  assert.equal(NATURAL.bases.size, RECORD_BASES, `attract dispatched on ${NATURAL.bases.size} record bases, not ${RECORD_BASES}`);
  for (const [base] of NATURAL.bases) {
    assert.ok(base >= OBJ_ARRAY_67, `a captured record base ${hx(base)} is below OBJ_ARRAY_67`);
  }

  const census = [...NATURAL.arms].map(([a, n]) => `${a} x${n}`).join(", ");
  console.log(
    `  EQUAL: all ${NATURAL.dispatches} real 0x24B4 dispatches in ${ATTRACT_FRAMES} attract frames replayed inline ` +
      `(first at frame ${NATURAL.firstFrame}); ${NATURAL.bases.size} record bases; arms: ${census}; ` +
      "full state dump MINUS the stack scratch below the entry SP, plus the returned protocol value",
  );
});

// -- 3. EQUAL (crafted) --------------------------------------------------------

for (const name of Object.keys(CRAFTS)) {
  test(`EQUAL (crafted): the "${name}" arm — which attract never produces — matches the oracle`, () => {
    const s = CRAFTED[name];
    assert.ok(s.prepChangedOracle > 0, `the "${name}" craft changed nothing the oracle does — the arm would be vacuous`);
    assert.equal(s.arms.get(CRAFT_ARM[name]) ?? 0, s.dispatches,
      `the "${name}" craft was expected to drive the "${CRAFT_ARM[name]}" arm on every dispatch`);
    assert.equal(s.breaches.length, 0,
      s.breaches.length ? `${s.breaches.length} breach(es), first: ${describe(s.breaches[0])}` : "");
    console.log(
      `  EQUAL/crafted ${name}: ${s.dispatches} replays on the "${CRAFT_ARM[name]}" arm; ` +
        `the craft moves the oracle's own result on ${s.prepChangedOracle} of them`,
    );
  });
}

// -- 4. TEETH ------------------------------------------------------------------

/**
 * One parameterised twin body, so every twin differs from the real routine in EXACTLY the one
 * thing it names. It is written out longhand rather than wrapping retireBarrelIntoOilDrum because most of these
 * defects are in the gate conditions, which a wrapper cannot reach.
 */
function twinBody(m, { bottom = BOTTOM_ROW, high = (x) => x >= BAND_HI, low = (x) => x < BAND_LO,
  kindGate = true, oneShot = true, blankColumn = true } = {}) {
  const { mem8 } = m;
  const record = m.regs.ix;
  if (mem8[record + OBJ_Y] < bottom) return true;
  const column = mem8[record + OBJ_X];
  if (high(column)) return true;
  if (low(column)) return true;
  if (!kindGate || mem8[record + OBJ_KIND] !== 0) mem8[PHASE_BITS] = 3;
  mem8[record + OBJ_ACTIVE] = 0;
  if (blankColumn) mem8[record + OBJ_X] = 0;
  mem8[IMPACT_SOUND] = 3;
  m.regs.hl = m.pop16();
  if (!oneShot || mem8[MODE_LATCH] === 0) mem8[MODE_LATCH] = 1;
  m.call(0x21ba);
  return false;
}

/** Twins whose defect ESCAPES every natural capture — both halves are asserted. */
const CRAFTED_ONLY_TWINS = [
  ["Y threshold one row low", (m) => twinBody(m, { bottom: BOTTOM_ROW - 1 }), "edgeJustAbove", "RAM"],
  ["Y threshold one row high", (m) => twinBody(m, { bottom: BOTTOM_ROW + 1 }), "edgeAtThreshold", "RAM"],
  ["band low edge dropped", (m) => twinBody(m, { low: () => false }), "bandBelow", "RAM"],
  ["phase write unconditional", (m) => twinBody(m, { kindGate: false }), "retireBaseKind", "RAM"],
  ["one-shot latch dropped", (m) => twinBody(m, { oneShot: false }), "retireAlreadyLatched", "RAM"],
];

for (const [name, twin, craft, kind] of CRAFTED_ONLY_TWINS) {
  test(`TEETH: the "${name}" twin ESCAPES every natural capture and is caught only by the "${craft}" arm`, () => {
    const natural = sweepAttract(twin);
    assert.equal(
      natural.breaches.length, 0,
      `the "${name}" twin was expected to escape all ${natural.dispatches} natural captures, but ` +
        `${natural.breaches.length} caught it — the crafted arm's premise is wrong`,
    );
    const crafted = sweepAttract(twin, { prep: CRAFTS[craft] });
    assert.ok(crafted.breaches.length > 0,
      `the "${craft}" arm failed to catch the "${name}" twin — that arm exists for exactly this`);
    assert.equal(crafted.breaches[0].kind, kind,
      `expected the "${name}" twin to be caught by ${kind}, got ${crafted.breaches[0].kind}`);
    console.log(
      `  TEETH/${name}: 0/${natural.dispatches} natural, ${crafted.breaches.length}/${crafted.dispatches} ` +
        `crafted (${describe(crafted.breaches[0])})`,
    );
  });
}

/** Twins the natural captures MUST catch, each by a named half of the contract. */
const NATURAL_TWINS = [
  ["band high edge off by one", (m) => twinBody(m, { high: (x) => x > BAND_HI }), "RAM", 1],
  ["column blank dropped", (m) => twinBody(m, { blankColumn: false }), "RAM", 1],
  ["wrong protocol value", (m, cur) => { retireBarrelIntoOilDrum(m, cur); return true; }, "return", 1],
  // The old "leaked return bracket" twin (seam-only, catchable only through pc/SP) is gone: the
  // dissolved rewrite has no guest-stack bracket to leak and the contract no longer compares SP/pc.
];

for (const [name, twin, kind, expected] of NATURAL_TWINS) {
  test(`TEETH: the "${name}" twin is caught by the natural captures, via ${kind}`, () => {
    const s = sweepAttract(twin);
    assert.ok(s.breaches.length > 0,
      `the "${name}" twin escaped all ${s.dispatches} natural captures — the gate is worthless`);
    assert.equal(s.breaches.length, expected,
      `expected the "${name}" twin to be caught on ${expected} of ${s.dispatches} dispatches, got ${s.breaches.length}`);
    for (const b of s.breaches) {
      assert.equal(b.kind, kind, `expected the "${name}" twin to be caught by ${kind}, got ${b.kind}`);
    }
    console.log(`  TEETH/${name}: ${s.breaches.length}/${s.dispatches} natural (${describe(s.breaches[0])})`);
  });
}

// -- 5. LIVE: wired live for a whole attract run -------------------------------

/**
 * Drive a whole attract run CYCLE-FREE — the frame boundary is the main loop's vblank poll, not
 * a T-state count — and sample every frame. Both sides use the same vehicle, so a cycle-free
 * rewrite shifts no interrupt and there is no cycle cost to restore.
 */
function runFramesCycleFree(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  const frames = [];
  const result = runCycleFree(m, {
    pollPCs: manifest.convergence.pollPCs,
    maxFrames: ATTRACT_FRAMES,
    stepBudget: ATTRACT_FRAMES * 200000,
    onFrame: (mm) => frames.push(Buffer.from(mm.dumpState())),
  });
  return { m, frames, result };
}

// RETIRED. This arm wired retireBarrelIntoOilDrum live at 0x24B4 standalone. The exx/cursor
// dissolution makes that impossible: on its retire arm the routine publishes a sprite, so it now
// takes the staging cursor `cur` as a value from its idiomatic caller (advanceRollingBarrel /
// loc_2053 / loc_2101) and cannot be dispatched by address with only the machine. The whole-run
// trace it proved is covered by idiomatic.test.js's FULL FLIP.
nodeTest("LIVE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: retireBarrelIntoOilDrum publishes on its retire arm and takes the staging cursor from its idiomatic caller; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {});
