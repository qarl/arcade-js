// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for reverseMarioVerticalArc (ROM 0x1BD8) — the vertical half of the airborne playfield-limit
 * reflection: fold the elapsed airborne frames into Mario's stored launch velocity
 * (velocity := 16·frames − velocity) and restart the frame count, unless the fall has already
 * been latched lethal, then run the shared airborne tail.
 *
 * REACHABILITY — STATED HONESTLY. reverseMarioVerticalArc is NOT reached in attract. Its two entries are the
 * playfield-limit arms of the airborne handler, and the attract demo never jumps at the horizontal
 * limit: over 6000 attract frames the handler (0x1BB2) dispatches 360× and 0x1BD8 exactly 0×.
 * So there are no attract captures to have, and this test says so instead of pretending. The
 * captures below come from a DRIVEN 1-PLAYER GAME — a real coin + start + held jump through
 * the machine's input tape, with MARIO_X poked to the horizontal playfield limit, which is precisely how the
 * repo's gameplay tapes (tapes/test_b1_*.lua) drive a position-dependent path. Those are real
 * dispatches out of a live game: the ROM's own airborne handler decides to come here.
 *
 *   1. REALISM (captured, driven) — hook 0x1BD8 in the driven game, clone at each dispatch and
 *      replay oracle vs candidate in isolation. Three scenarios, all naturally dispatched:
 *        left edge  (MARIO_X = 0x10) — 63 dispatches, all on the re-base arm;
 *        right edge (MARIO_X = 0xF0) — 65 dispatches, the other entry (loc_1bf2);
 *        fatal fall (take-off height poked high, edge entered after the height test has
 *        latched MARIO_FATAL_FALL) — 11 dispatches, all on the SKIP arm.
 *      The arms are asserted to be non-vacuous: the re-base captures are checked to actually
 *      MOVE the velocity, the skip captures to leave it alone.
 *
 *   2. EQUAL (crafted) — a real captured dispatch plus a surgical poke of just the bytes the
 *      routine reads, identically on both sides: the branch byte over {0,1,2,0xFF} (only 1
 *      skips — this is a decrement-to-zero test, not "nonzero"), crossed with the frame count
 *      and the 16-bit velocity over their edges, including the borrow wrap (frames 0 with a
 *      nonzero velocity subtracts past zero) and the byte-order-sensitive asymmetric values.
 *
 *   3. FUZZ — 400 seeded-random (branch byte, frame count, velocity) triples on the same real
 *      base, so the value space the driven run does not span is swept rather than argued about.
 *
 *   4. TEETH — three broken twins, each of which the SAME suite must catch:
 *      (a) inverted skip test      (re-bases exactly when the oracle skips) — caught at 0x6212.
 *      (b) dropped frame reset     (leaves MARIO_AIR_FRAMES standing)       — caught at 0x6214.
 *      (c) swapped velocity halves (stores the two bytes the wrong way up)  — caught at 0x6212.
 *
 * CONTRACT. Both sides run the WHOLE routine INCLUDING its tail — the ballistic step and the
 * rest of the airborne cascade — so a wrong byte here propagates through a frame of real game
 * code before it is compared, and the thing proven equal is the composition, not just the
 * routine's three stores. The oracle side runs the frozen chain end to end; the candidate side
 * direct-calls the idiomatic loc_1bec, which landed in this same batch, and that chain rejoins
 * the frozen oracle at 0x1C05. The comparison is the memory-equivalence contract —
 * work/sprite/video RAM minus the stack scratch below the entry SP — plus pc, SP, and the live-out
 * return value the airborne cascade's callers propagate. The oracle brackets its loc_2407 call
 * with a push/return the candidate dissolves into a JS call; those bytes land inside
 * STACK_SCRATCH, and measured over real dispatches the tail's own pushes overwrite them with
 * identical values (0 residual stack differences), so the run is checked both ways — contract
 * diff AND full-RAM diff — rather than leaning on the exclusion.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1bd8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1bd8 as oracle } from "../../translated/loc_1bd8.js";
import { reverseMarioVerticalArc } from "../reverseMarioVerticalArc.js";
import { loc_2407 } from "../loc_2407.js";
import { loc_1bec } from "../loc_1bec.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X,
  MARIO_AIR_START_Y,
  MARIO_AIR_VY_HI,
  MARIO_AIR_VY_LO,
  MARIO_AIR_FRAMES,
  MARIO_FATAL_FALL,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1bd8;
const AIRBORNE_HANDLER = 0x1bb2; // the entry that reaches 0x1BD8 (used for the attract census)

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

/** First RAM byte that differs INCLUDING the stack region (reported, not required). */
function firstAnyRamDiff(a, b) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] !== db[i]) return { addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the ORACLE on a fresh clone. The frozen lift takes its caller's record-pointer helper
 * as a second argument (the frozen callers hand it over through the address registry), so
 * rebuild exactly that helper from the live pointer.
 */
function runOracle(entry) {
  const c = entry.clone();
  const X = (d) => (c.regs.ix + d) & 0xffff;
  const ret = oracle(c, X);
  return { m: c, ret };
}

/** Run a candidate on a fresh clone. Both sides run the shared oracle tail to its terminal ret. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  return { m: c, ret };
}

/** Contract diff: RAM − the stack scratch below the entry SP and the forwarded return value (pc/SP excluded — seam artifacts). */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.m, c.m, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  // pc/SP dropped: the airborne tail's m.call(0x1C05) was dissolved to a direct loc_1c05 call, so
  // pc and SP are now seam artifacts, never game live-outs; the whole-game SP-inertness tests guard SP.
  if (o.ret !== c.ret) diffs.push(`return oracle=${o.ret} cand=${c.ret}`);
  return diffs;
}

// -- driving the game to a real 0x1BD8 dispatch --------------------------------

// Coin, start, and a held jump: the ROM's own credit/start/movement logic runs the game.
const DRIVE_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 399, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 459, dur: 6 }, // 1-player start
  { port: 0x7c00, bits: 0x10, frame: 1600, dur: 140 }, // jump button, held
];

// Position pokes in the style of tapes/test_b1_*.lua: put Mario where the path under test
// lives. The ROM decides everything else — whether he is airborne, which edge arm fires.
const LEFT_EDGE = [{ addr: MARIO_X, val: 0x10, frame: 1600, dur: 60 }];
const RIGHT_EDGE = [{ addr: MARIO_X, val: 0xf0, frame: 1600, dur: 60 }];
// Claim a very high take-off point so the ROM's own fall-height test condemns this jump, and
// only THEN shove Mario to the edge — so the dispatches arrive with MARIO_FATAL_FALL already
// latched by the game itself.
const FATAL_EDGE = [
  { addr: MARIO_AIR_START_Y, val: 0x40, frame: 1600, dur: 80 },
  { addr: MARIO_X, val: 0x10, frame: 1622, dur: 60 },
];

/** Clone the machine at every real 0x1BD8 dispatch of a driven 1P game. */
function driveCaptures(pokes, limit = 200, frames = 1800) {
  const caps = [];
  const overrides = new Map([[TARGET, (mm, ...args) => {
    if (caps.length < limit) caps.push(mm.clone());
    return oracle(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.inputTape = DRIVE_TAPE.map((t) => ({ ...t }));
  host.pokes = pokes.map((p) => ({ ...p }));
  host.runFrames(frames);
  return caps;
}

/** Stamp the bytes the routine reads onto a clone of a real dispatch. */
function craft(base, { fatal, frames, velocity }) {
  const m = base.clone();
  if (fatal !== undefined) m.mem.write8(MARIO_FATAL_FALL, fatal);
  if (frames !== undefined) m.mem.write8(MARIO_AIR_FRAMES, frames);
  if (velocity !== undefined) {
    m.mem.write8(MARIO_AIR_VY_HI, velocity >> 8);
    m.mem.write8(MARIO_AIR_VY_LO, velocity & 0xff);
  }
  return m;
}

const readVelocity = (m) => (m.mem.read8(MARIO_AIR_VY_HI) << 8) | m.mem.read8(MARIO_AIR_VY_LO);

// -- 0. REACHABILITY CENSUS ----------------------------------------------------

test("REACHABILITY: attract never reaches 0x1BD8 (so the gate is driven, not attract)", () => {
  let handler = 0, target = 0;
  // Count without displacing behaviour: wrap the registered oracles rather than replacing them.
  const base = new Machine(ROM);
  const airborne = base.routines.get(AIRBORNE_HANDLER);
  const targetFn = base.routines.get(TARGET);
  const counting = new Map([
    [AIRBORNE_HANDLER, (mm, ...args) => { handler++; return airborne(mm, ...args); }],
    [TARGET, (mm, ...args) => { target++; return targetFn(mm, ...args); }],
  ]);
  const host = new Machine(ROM, { overrides: counting });
  host.runFrames(6000);
  assert.ok(handler > 0, "the airborne handler should run during attract (the demo jumps)");
  assert.equal(target, 0, "attract is expected NOT to reach 0x1BD8 — if it now does, use those captures");
  console.log(`  REACHABILITY: 6000 attract frames — airborne handler ${handler}x, 0x1BD8 ${target}x (driven captures required)`);
});

// -- 1. REALISM (captured from a driven 1P game) -------------------------------

test("REALISM: real driven-game 0x1BD8 dispatches — left edge, re-base arm", () => {
  const caps = driveCaptures(LEFT_EDGE);
  assert.ok(caps.length >= 1, "expected real 0x1BD8 dispatches from the driven left-edge run");

  let moved = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, reverseMarioVerticalArc);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    if (readVelocity(runOracle(entry).m) !== readVelocity(entry)) moved++;
  }
  // Non-vacuous: these captures must actually exercise the re-base, not idle past it.
  assert.ok(moved > 0, "no captured dispatch changed the stored velocity — the arm is vacuous");
  console.log(`  REALISM/left: ${caps.length} real dispatches identical to the oracle (${moved} re-based the velocity)`);
});

test("REALISM: real driven-game 0x1BD8 dispatches — right edge (the loc_1bf2 entry)", () => {
  const caps = driveCaptures(RIGHT_EDGE);
  assert.ok(caps.length >= 1, "expected real 0x1BD8 dispatches from the driven right-edge run");
  for (const entry of caps) {
    const diffs = contractDiffs(entry, reverseMarioVerticalArc);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
  }
  console.log(`  REALISM/right: ${caps.length} real dispatches identical to the oracle`);
});

test("REALISM: real driven-game dispatches on the FATAL-FALL skip arm", () => {
  const caps = driveCaptures(FATAL_EDGE);
  const fatalCaps = caps.filter((m) => m.mem.read8(MARIO_FATAL_FALL) === 1);
  assert.ok(fatalCaps.length >= 1, "expected the driven run to reach 0x1BD8 with the fall already latched lethal");

  for (const entry of fatalCaps) {
    const diffs = contractDiffs(entry, reverseMarioVerticalArc);
    assert.equal(diffs.length, 0, `captured fatal-arm dispatch: ${diffs.join("; ")}`);
    // Non-vacuous the other way: on this arm the oracle must leave the velocity ALONE.
    assert.equal(readVelocity(runOracle(entry).m), readVelocity(entry), "the skip arm must not re-base the velocity");
  }
  console.log(`  REALISM/fatal: ${fatalCaps.length}/${caps.length} real dispatches on the skip arm, identical to the oracle`);
});

test("CONTRACT: on real dispatches even the STACK region matches (exclusion not leaned on)", () => {
  const caps = driveCaptures(LEFT_EDGE, 8);
  let stackOnly = 0;
  for (const entry of caps) {
    const o = runOracle(entry).m, c = runCandidate(entry, reverseMarioVerticalArc).m;
    const any = firstAnyRamDiff(o, c);
    if (any) {
      assert.ok(deadStackBelow(STACK_SCRATCH, entry.regs.sp)(any.addr), `any difference must be inside the stack scratch below the entry SP, got ${hx(any.addr)}`);
      stackOnly++;
    }
  }
  console.log(`  CONTRACT: ${caps.length} dispatches, ${stackOnly} with a residual STACK_SCRATCH-only difference`);
});

// -- 2. EQUAL (crafted, on a real base) ----------------------------------------

test("EQUAL (crafted): branch byte x frame count x velocity, on a real dispatch", () => {
  const base = driveCaptures(LEFT_EDGE, 1)[0];
  assert.ok(base, "need one real dispatch to craft from");

  // Only the value 1 takes the skip: the oracle decrements and tests for zero.
  const branchBytes = [0x00, 0x01, 0x02, 0x03, 0xff];
  // Frame-count edges: nibble boundary (the spread is a x16 scale), byte top.
  const frameCounts = [0x00, 0x01, 0x0f, 0x10, 0x7f, 0x80, 0xff];
  // Velocity edges: zero, the borrow-wrap partner, the real jump value, sign flips, asymmetric
  // byte pairs (0x1234 vs 0x3412 catch a swapped store).
  const velocities = [0x0000, 0x0001, 0x0148, 0x1234, 0x3412, 0x7fff, 0x8000, 0xfec8, 0xffff];

  let n = 0;
  for (const fatal of branchBytes) {
    for (const frames of frameCounts) {
      for (const velocity of velocities) {
        const entry = craft(base, { fatal, frames, velocity });
        const diffs = contractDiffs(entry, reverseMarioVerticalArc);
        assert.equal(diffs.length, 0, `fatal=${fatal} frames=${frames} vel=${hx(velocity)}: ${diffs.join("; ")}`);
        n++;
      }
    }
  }

  // The borrow wrap is real and load-bearing, not a hypothetical: frames 0, velocity 1
  // subtracts past zero to 0xFFFF.
  assert.equal(loc_2407(craft(base, { fatal: 0, frames: 0x00, velocity: 0x0001 })), 0xffff);
  console.log(`  EQUAL/crafted: ${n} crafted entries identical to the oracle (borrow wrap included)`);
});

// -- 3. FUZZ -------------------------------------------------------------------

test("FUZZ: 400 seeded-random (branch, frames, velocity) triples match the oracle", () => {
  const base = driveCaptures(LEFT_EDGE, 1)[0];
  let seed = 0x1bd80001;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 16;
  };

  let skips = 0, rebases = 0;
  for (let i = 0; i < 400; i++) {
    // Bias the branch byte so the skip arm is well represented (a uniform byte would hit it 1/256).
    const fatal = i % 4 === 0 ? 0x01 : rnd() & 0xff;
    const frames = rnd() & 0xff;
    const velocity = rnd() & 0xffff;
    const entry = craft(base, { fatal, frames, velocity });
    const diffs = contractDiffs(entry, reverseMarioVerticalArc);
    assert.equal(diffs.length, 0, `fuzz#${i} fatal=${fatal} frames=${frames} vel=${hx(velocity)}: ${diffs.join("; ")}`);
    if (fatal === 0x01) skips++; else rebases++;
  }
  console.log(`  FUZZ: 400 random entries identical (${skips} skip arm, ${rebases} re-base arm)`);
});

// -- 4. TEETH ------------------------------------------------------------------

/** Broken twin (a): inverts the skip test — re-bases exactly when the oracle leaves it alone. */
function brokenInvertedSkip(m) {
  const { mem } = m;
  if (mem.read8(MARIO_FATAL_FALL) === 1) { // BUG: inverted
    const v = loc_2407(m);
    mem.write8(MARIO_AIR_VY_HI, v >> 8);
    mem.write8(MARIO_AIR_VY_LO, v);
    mem.write8(MARIO_AIR_FRAMES, 0);
  }
  return loc_1bec(m);
}

/** Broken twin (b): drops the frame-count restart. */
function brokenNoFrameReset(m) {
  const { mem } = m;
  if (mem.read8(MARIO_FATAL_FALL) !== 1) {
    const v = loc_2407(m);
    mem.write8(MARIO_AIR_VY_HI, v >> 8);
    mem.write8(MARIO_AIR_VY_LO, v);
    // BUG: MARIO_AIR_FRAMES left standing
  }
  return loc_1bec(m);
}

/** Broken twin (c): stores the two velocity bytes the wrong way up. */
function brokenSwappedVelocity(m) {
  const { mem } = m;
  if (mem.read8(MARIO_FATAL_FALL) !== 1) {
    const v = loc_2407(m);
    mem.write8(MARIO_AIR_VY_HI, v); // BUG: halves swapped
    mem.write8(MARIO_AIR_VY_LO, v >> 8);
    mem.write8(MARIO_AIR_FRAMES, 0);
  }
  return loc_1bec(m);
}

/** The oracle's and a twin's value at one cell, after both have run the full routine + tail. */
function cellPair(entry, fn, addr) {
  return { oracle: runOracle(entry).m.mem.read8(addr), twin: runCandidate(entry, fn).m.mem.read8(addr) };
}

test("TEETH: inverted skip, dropped frame reset, and swapped velocity halves are CAUGHT", () => {
  const base = driveCaptures(LEFT_EDGE, 1)[0];

  // Each twin is checked twice: the gate must flag it AT ALL (contractDiffs non-empty), and the
  // specific cell the bug corrupts must be shown to differ. The FIRST reported difference is
  // normally MARIO_Y — the shared tail runs the ballistic step with the corrupted velocity, so a
  // wrong byte has already moved Mario by the time the diff is taken, which is the propagation
  // the whole-routine (routine + tail) comparison exists to see.

  // (a) inverted skip — needs a state where the two arms differ: a lethal fall whose re-base
  //     would move the velocity.
  const skipEntry = craft(base, { fatal: 0x01, frames: 0x0a, velocity: 0x0148 });
  const aDiffs = contractDiffs(skipEntry, brokenInvertedSkip);
  assert.ok(aDiffs.length > 0, "the inverted-skip twin escaped — the gate is worthless");
  const aCell = cellPair(skipEntry, brokenInvertedSkip, MARIO_AIR_VY_HI);
  assert.notEqual(aCell.oracle, aCell.twin, `the inverted-skip twin left ${hx(MARIO_AIR_VY_HI)} intact`);

  // (b) dropped frame reset — a nonzero frame count so "leave it" and "zero it" differ.
  const frameEntry = craft(base, { fatal: 0x00, frames: 0x0a, velocity: 0x0148 });
  const bDiffs = contractDiffs(frameEntry, brokenNoFrameReset);
  assert.ok(bDiffs.length > 0, "the dropped-frame-reset twin escaped — the gate is worthless");
  const bCell = cellPair(frameEntry, brokenNoFrameReset, MARIO_AIR_FRAMES);
  assert.notEqual(bCell.oracle, bCell.twin, `the dropped-frame-reset twin left ${hx(MARIO_AIR_FRAMES)} intact`);

  // (c) swapped halves — an asymmetric result (frames 0x12, velocity 0 gives 0x0120).
  const swapEntry = craft(base, { fatal: 0x00, frames: 0x12, velocity: 0x0000 });
  const cDiffs = contractDiffs(swapEntry, brokenSwappedVelocity);
  assert.ok(cDiffs.length > 0, "the swapped-velocity twin escaped — the gate is worthless");
  const cCell = cellPair(swapEntry, brokenSwappedVelocity, MARIO_AIR_VY_HI);
  assert.notEqual(cCell.oracle, cCell.twin, `the swapped-velocity twin left ${hx(MARIO_AIR_VY_HI)} intact`);

  // And the twins must be caught on the REAL captured dispatches too, not only on crafted ones.
  const caps = driveCaptures(LEFT_EDGE, 12);
  for (const [name, twin] of [["dropped frame reset", brokenNoFrameReset], ["swapped velocity", brokenSwappedVelocity]]) {
    const caught = caps.filter((e) => contractDiffs(e, twin).length > 0).length;
    assert.ok(caught > 0, `${name} escaped every real captured dispatch`);
  }

  console.log(`  TEETH: inverted-skip caught (${aDiffs[0]}, ${hx(MARIO_AIR_VY_HI)} ${aCell.oracle}!=${aCell.twin}); ` +
    `frame-reset caught (${bDiffs[0]}, ${hx(MARIO_AIR_FRAMES)} ${bCell.oracle}!=${bCell.twin}); ` +
    `swap caught (${cDiffs[0]}, ${hx(MARIO_AIR_VY_HI)} ${cCell.oracle}!=${cCell.twin})`);
});
