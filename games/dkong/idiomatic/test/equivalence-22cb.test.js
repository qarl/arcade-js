// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_22cb (ROM 0x22CB) — the object-velocity setup dispatcher.
 *
 * loc_22cb reads a mode latch (0x6348) and, when it is set, the current DIFFICULTY
 * (0x6380), and dispatches to one of four sibling arms, each of which seeds the object
 * record's two velocity fields (+0x11 magnitude, +0x10 direction sign):
 *
 *   mode latch clear             -> loc_22e1  (magnitude from LEVEL)
 *   set, difficulty 1-2          -> loc_22f6  (magnitude from RANDOM)
 *   set, difficulty 3-4          -> loc_2303  (RANDOM magnitude, direction toward player)
 *   set, difficulty 5            -> loc_231a  (both fields from the player X offset)
 *
 * Each ARM is proven exhaustively in its own gate (equivalence-22e1 / -22f6 / -2303 /
 * -231a). This gate proves the DISPATCH: that loc_22cb selects the right arm for every
 * (mode, difficulty). To make a mis-dispatch observable, the arms' input cells
 * (LEVEL / RANDOM / MARIO_X / the record's own X) are pinned to values that make the four
 * arms write DISTINCT (dir, mag) byte pairs — so routing to the wrong arm diverges in the
 * record:
 *
 *   loc_22e1 -> (0x00, 0xE9)   loc_22f6 -> (0xFF, 0x5A)
 *   loc_2303 -> (0x01, 0x5A)   loc_231a -> (0x00, 0x80)
 *
 * (No two share BOTH bytes, so any pair is separated by +0x10 or +0x11.)
 *
 * The oracle's difficulty arms take the rst-0x28 inline-table dispatch, which PUSHES the
 * table base (0x22D7) to the stack before popping it back; the idiomatic routine models no
 * stack (a plain JS switch + direct arm calls), so that push is a dissolved write. It lands
 * in the dead STACK_SCRATCH region (SP aimed there), which the memory-equivalence contract
 * excludes. Live-out is memory-only (the caller discards the result), so pc/SP are not
 * compared. The mode-0 arm makes no stack write at all.
 *
 *   1. EQUAL (crafted sweep) — over mode x difficulty x record pointer, loc_22cb == oracle
 *      on RAM (minus the stack scratch below the entry SP); plus a non-vacuity check that the oracle actually wrote
 *      the expected arm's bytes (so each arm is genuinely exercised).
 *   2. TEETH — four broken dispatch twins, each of which the sweep MUST catch.
 *   3. REALISM — hook 0x22CB in a real attract run and replay any captured dispatches; plus
 *      crafted dispatches on a real attract base so the proof is anchored in-distribution.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-22cb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_22cb as oracle } from "../../translated/loc_22cb.js";
import { loc_22cb } from "../loc_22cb.js";
import { loc_22e1 } from "../loc_22e1.js";
import { loc_22f6 } from "../loc_22f6.js";
import { loc_2303 } from "../loc_2303.js";
import { loc_231a } from "../loc_231a.js";
import { STACK_SCRATCH, DIFFICULTY, LEVEL, RANDOM, MARIO_X, OBJ_X } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x22cb;
const MODE_LATCH = 0x6348; // the velocity-mode latch loc_22cb dispatches on (unnamed in names.js)
const SAFE_SP = 0x6bf8;    // the rst-0x28 push (0x22D7) lands at 0x6BF6/0x6BF7, inside STACK_SCRATCH

// Object-record pointers (IX live-in). Both are real stride-0x20 object arrays, so +0x10/+0x11
// fit inside the record and every touched cell lands in work RAM without colliding with the
// pinned input cells (0x6018 / 0x6203 / 0x6229 / 0x6348 / 0x6380) or the stack scratch.
const IX_POINTERS = [0x6400, 0x6700];

// The arms' inputs, pinned so the four arms write distinct (dir @ +0x10, mag @ +0x11) pairs.
const IN = { level: 0x03, random: 0x5a, marioX: 0x60, objX: 0x40 };

// The (dir, mag) byte pair each arm writes for IN, by hand from the arm formulas:
//   22e1: LEVEL 3 -> higher-level magnitude 0xE9 (odd) -> dir (0xE9&1)-1 = 0x00
//   22f6: RANDOM 0x5A -> mag 0x5A (even) -> dir (0x5A&1)-1 = 0xFF
//   2303: mag = RANDOM 0x5A; dir = (MARIO_X 0x60 < objX 0x40)? 0xFF : 0x01 = 0x01
//   231a: offset u8(0x60-0x40)=0x20, topTwoBits=0; dir = (0x60<0x40?0xFC:0)|0 = 0x00;
//         mag = (0x20<<2)|0 = 0x80
const ARM_OUTPUT = {
  "22e1": { dir: 0x00, mag: 0xe9 },
  "22f6": { dir: 0xff, mag: 0x5a },
  "2303": { dir: 0x01, mag: 0x5a },
  "231a": { dir: 0x00, mag: 0x80 },
};

// Which arm the correct dispatch selects for a (mode, difficulty).
function expectedArm(mode, difficulty) {
  if (mode === 0) return "22e1";
  return difficulty <= 2 ? "22f6" : difficulty <= 4 ? "2303" : "231a";
}

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const hx16 = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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
 * A synthetic dispatch entry: a clone of `base` with the record pointer in IX, the mode
 * latch + difficulty poked, all four arm inputs pinned to IN, a stack aimed at the dead
 * scratch, and the frame machinery neutralised so the oracle's step machinery cannot fire
 * an NMI.
 */
function makeEntry(base, ix, mode, difficulty) {
  const e = base.clone();
  e.regs.ix = ix;
  e.regs.sp = SAFE_SP;
  e.mem.write8(MODE_LATCH, mode);
  e.mem.write8(DIFFICULTY, difficulty);
  e.mem.write8(LEVEL, IN.level);
  e.mem.write8(RANDOM, IN.random);
  e.mem.write8(MARIO_X, IN.marioX);
  e.mem.write8((ix + OBJ_X) & 0xffff, IN.objX);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

/** Run oracle vs candidate on two byte-identical entries; diff RAM − the stack scratch below the entry SP. */
function runPair(base, ix, mode, difficulty, candidate) {
  const a = makeEntry(base, ix, mode, difficulty);
  const aFloor = a.regs.sp;
  const b = makeEntry(base, ix, mode, difficulty);
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, aFloor);
}

// mode x difficulty x pointer sweep. Modes span 0 (level arm) and three nonzero values;
// difficulties span the whole 1..5 dispatch. Returns the first mismatch or null.
const MODES = [0x00, 0x01, 0x80, 0xff];
const DIFFICULTIES = [1, 2, 3, 4, 5];

function fullSweep(base, candidate) {
  let count = 0;
  for (const ix of IX_POINTERS) {
    for (const mode of MODES) {
      for (const difficulty of DIFFICULTIES) {
        const ram = runPair(base, ix, mode, difficulty, candidate);
        count++;
        if (ram) return { mismatch: { ix, mode, difficulty, ram }, count };
      }
    }
  }
  return { mismatch: null, count };
}

const describe = (mm) =>
  mm &&
  `at pointer=${hx16(mm.ix)} mode=${hx(mm.mode)} difficulty=${mm.difficulty}: ` +
    `RAM diverges at ${hx16(mm.ram.addr ?? 0)} (${mm.ram.a}->${mm.ram.b})`;

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL (crafted): loc_22cb == oracle across mode x difficulty x pointer", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, loc_22cb);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, IX_POINTERS.length * MODES.length * DIFFICULTIES.length,
    "must have compared the whole mode x difficulty x pointer sweep");

  // Non-vacuity: for each combo the ORACLE actually wrote the expected arm's bytes, so the
  // dispatch is genuinely exercised (each of the four arms is reached) — a green sweep is
  // then loc_22cb reproducing the right arm, not both sides doing nothing.
  const armsSeen = new Set();
  for (const ix of IX_POINTERS) {
    for (const mode of MODES) {
      for (const difficulty of DIFFICULTIES) {
        const arm = expectedArm(mode, difficulty);
        const out = ARM_OUTPUT[arm];
        const e = makeEntry(base, ix, mode, difficulty);
        oracle(e);
        assert.equal(e.mem.read8((ix + 0x11) & 0xffff), out.mag,
          `mode=${hx(mode)} diff=${difficulty}: expected arm ${arm} magnitude ${hx(out.mag)} at +0x11`);
        assert.equal(e.mem.read8((ix + 0x10) & 0xffff), out.dir,
          `mode=${hx(mode)} diff=${difficulty}: expected arm ${arm} direction ${hx(out.dir)} at +0x10`);
        armsSeen.add(arm);
      }
    }
  }
  assert.deepEqual([...armsSeen].sort(), ["22e1", "22f6", "2303", "231a"],
    "the sweep must exercise all four dispatch arms");
  console.log(`  EQUAL/crafted: ${count} (pointer, mode, difficulty) combos — RAM == oracle; all four arms exercised`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** BUG (a): ignores the mode latch — always takes the difficulty dispatch. Caught at mode 0
 *  (oracle picks the level arm loc_22e1, the twin picks a difficulty arm). */
function brokenIgnoreMode(m) {
  const objRecord = m.regs.ix;
  const d = m.mem.read8(DIFFICULTY);
  return d <= 2 ? loc_22f6(m, objRecord) : d <= 4 ? loc_2303(m) : loc_231a(m);
}

/** BUG (b): inverts the mode test — takes the level arm when the latch is SET. Caught at
 *  every nonzero mode (oracle takes a difficulty arm, the twin takes loc_22e1). */
function brokenInvertedMode(m) {
  const objRecord = m.regs.ix;
  if (m.mem.read8(MODE_LATCH) !== 0) return loc_22e1(m, objRecord);
  const d = m.mem.read8(DIFFICULTY);
  return d <= 2 ? loc_22f6(m, objRecord) : d <= 4 ? loc_2303(m) : loc_231a(m);
}

/** BUG (c): off-by-one difficulty index (skips the `dec` — uses difficulty as the index).
 *  Caught at difficulty 2 (oracle loc_22f6, twin loc_2303) and 4 (oracle loc_2303, twin
 *  loc_231a). */
function brokenOffByOneDifficulty(m) {
  const objRecord = m.regs.ix;
  if (m.mem.read8(MODE_LATCH) === 0) return loc_22e1(m, objRecord);
  const d = m.mem.read8(DIFFICULTY);
  return d <= 1 ? loc_22f6(m, objRecord) : d <= 3 ? loc_2303(m) : loc_231a(m);
}

/** BUG (d): misroutes difficulty 5 to the 3/4 arm. Caught at difficulty 5 (oracle loc_231a,
 *  twin loc_2303). */
function brokenDifficulty5(m) {
  const objRecord = m.regs.ix;
  if (m.mem.read8(MODE_LATCH) === 0) return loc_22e1(m, objRecord);
  const d = m.mem.read8(DIFFICULTY);
  return d <= 2 ? loc_22f6(m, objRecord) : loc_2303(m); // BUG: difficulty 5 falls here, not loc_231a
}

test("TEETH: the ignore-mode twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenIgnoreMode);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an ignored mode latch — worthless");
  console.log(`  TEETH/ignore-mode: caught — ${describe(mismatch)}`);
});

test("TEETH: the inverted-mode twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenInvertedMode);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted mode test — worthless");
  console.log(`  TEETH/inverted-mode: caught — ${describe(mismatch)}`);
});

test("TEETH: the off-by-one difficulty twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenOffByOneDifficulty);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an off-by-one difficulty index — worthless");
  console.log(`  TEETH/off-by-one: caught — ${describe(mismatch)}`);
});

test("TEETH: the difficulty-5-misrouted twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenDifficulty5);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a misrouted difficulty 5 — worthless");
  console.log(`  TEETH/difficulty-5: caught — ${describe(mismatch)}`);
});

// -- 3. REALISM (captured + crafted on a real base) ---------------------------

test("REALISM: real captured 0x22CB dispatches — loc_22cb matches the oracle's RAM", () => {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(3000);

  for (const cap of caps) {
    const a = cap.clone(); a.nextNmi = Infinity; a.nextBoundary = Infinity;
    const b = cap.clone(); b.nextNmi = Infinity; b.nextBoundary = Infinity;
    oracle(a);
    loc_22cb(b);
    const ram = firstRamDiff(a, b, cap.regs.sp);
    assert.equal(ram, null,
      ram && `real dispatch (pointer=${hx16(a.regs.ix)}) diverges at ${hx16(ram.addr ?? 0)} (${ram.a}->${ram.b})`);
  }
  console.log(`  REALISM: ${caps.length} real 0x22CB dispatches over 3000 attract frames — RAM == oracle`);
});

test("CRAFTED REALISM: crafted dispatches on a real attract-base machine match the oracle", () => {
  const host = new Machine(ROM);
  host.runFrames(180);
  const attractBase = host.clone();

  let n = 0;
  for (const ix of IX_POINTERS) {
    for (const mode of MODES) {
      for (const difficulty of DIFFICULTIES) {
        const ram = runPair(attractBase, ix, mode, difficulty, loc_22cb);
        n++;
        assert.equal(ram, null,
          ram && `crafted (pointer=${hx16(ix)} mode=${hx(mode)} diff=${difficulty}) diverges at ${hx16(ram.addr ?? 0)} (${ram.a}->${ram.b})`);
      }
    }
  }
  console.log(`  CRAFTED REALISM: ${n} crafted dispatches on a real attract base — RAM == oracle`);
});
