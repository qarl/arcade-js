// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for flagObjectTargetOverlap (ROM 0x2c91) — the overlap-flag tail of the
 * dig/projectile-spawn path. It reads the tracked object (PLAYER_Y/PLAYER_X) and the
 * freshly-placed target cell (HAZARD_X/HAZARD_Y), publishes a 0/1 overlap flag to
 * MOVE_BLOCK_FLAG, then hands off to the idiomatic record builder stageDigObjectSpriteRecord
 * (ROM 0x2bd3), which continues into 0x2f71 and unwinds to flagObjectTargetOverlap's caller.
 *
 * CONTRACT. flagObjectTargetOverlap has NO register live-ins — every input is read from RAM — and its
 * only own side effect is the MOVE_BLOCK_FLAG byte; the record-build tail is delegated to the
 * idiomatic stageDigObjectSpriteRecord, which is memory-equivalent to the oracle's tail
 * but returns via plain JS rather than the Z80 stack dance. So the gate is a RAM-only
 * diff via dumpState: pc/SP and value-registers are the dead Z80 trace and are NOT
 * compared (the idiomatic tail deliberately does not reproduce them), and the
 * stack scratch below the entry SP is excluded for the same reason (nothing
 * flagObjectTargetOverlap touches lives there).
 *
 * REACHABILITY. This tail is genuinely reached in attract (~62 dispatches per 3000
 * frames), so the entry is captured live via the dispatch/​m.call override hook, then
 * the four input bytes are swept identically on both sides to exercise the overlap
 * window (the natural entry never overlaps, so the flag=1 arm is crafted).
 *
 * Checks:
 *   0. HARNESS   — capture a real 0x2c91 entry; the oracle run is deterministic
 *      (oracle vs oracle over the whole state is identical). Proves the capture/clone
 *      plumbing reaches a real state and the delegated tail is stable.
 *   1. EQUAL (real entry) — flagObjectTargetOverlap == oracle over RAM (minus stack scratch below the entry SP).
 *   2. EQUAL (branch/boundary/wrap set) — crafted inputs that hit every arm of the
 *      overlap test (row-miss, X-not-right, X-in-band, X-past-band, both wraps).
 *   3. EQUAL (sweep) — exhaustive over the compared X axis for every boundary cell X,
 *      plus an exhaustive row-equality sweep including the +12 wrap. MOVE_BLOCK_FLAG also
 *      cross-checked against a from-first-principles truth table each time.
 *   4. TEETH (inverted flag) — a twin that publishes the opposite flag is CAUGHT at
 *      MOVE_BLOCK_FLAG, in BOTH directions (overlap input and non-overlap input).
 *   5. TEETH (band off-by-one) — a twin whose X window is one pixel too wide is CAUGHT
 *      at MOVE_BLOCK_FLAG on the exact boundary cell it mis-classifies.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2c91.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c91 as oracle } from "../../translated/loc_2c91.js";
import { flagObjectTargetOverlap as idiomatic } from "../flagObjectTargetOverlap.js";
import { makeMachineFactory } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import { PLAYER_Y, PLAYER_X, HAZARD_X, HAZARD_Y, MOVE_BLOCK_FLAG } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x2c91;
// Stack window at the top of The Pit's work RAM; only the part below the entry SP is dead scratch.
// The delegated tail uses it identically on both arms; nothing flagObjectTargetOverlap writes lives here.
const STACK_LO = 0x8380;
const STACK_HI = 0x8400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Hook 0x2c91 in a real attract run and clone the machine at its first entry — a
 * genuine dig-spawn state (valid stack with a return address, live object/cell bytes).
 * The wrapper snapshots then runs the oracle so attract proceeds.
 */
function captureRealEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING stack scratch
 * below the entry SP. Null when otherwise identical.
 */
function ramDiffExStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Seed a clone of `entry` with the four overlap inputs (or leave them as captured). */
function seedInputs(entry, inputs) {
  const seed = entry.clone();
  if (inputs) {
    seed.mem.write8(PLAYER_X, inputs.objY);
    seed.mem.write8(HAZARD_Y, inputs.tgtY);
    seed.mem.write8(PLAYER_Y, inputs.objX);
    seed.mem.write8(HAZARD_X, inputs.tgtX);
  }
  return seed;
}

/** Run oracle vs `fn` on identical clones of a seeded state; return the RAM diff + the two machines. */
function compare(entry, inputs, fn) {
  const seed = seedInputs(entry, inputs);
  const o = seed.clone();
  oracle(o);
  const c = seed.clone();
  fn(c);
  return { ram: ramDiffExStack(o, c, seed.regs.sp), o, c };
}

/**
 * The overlap decision, re-derived from first principles (independent of the routine):
 * rows coincide when the cell row + 12 lands exactly on the object row, and the object
 * X sits in the 8-pixel band just right of the cell X.
 */
function expectedFlag({ objY, tgtY, objX, tgtX }) {
  const rowsAlign = u8(tgtY + 12) === objY;
  const rightOfCell = tgtX < objX;
  const withinBand = u8(tgtX + 8) >= objX;
  return rowsAlign && rightOfCell && withinBand ? 1 : 0;
}

// -- 0. HARNESS ---------------------------------------------------------------

test("HARNESS: a real 0x2c91 entry is captured and the oracle run is deterministic", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "expected 0x2c91 to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  assert.equal(ramDiffExStack(a, b, entry.regs.sp), null, "oracle run of 0x2c91 is not deterministic");
  console.log(
    `  HARNESS: captured a real 0x2c91 entry (SP=${hx(entry.regs.sp)}); ` +
      `PLAYER_X=${entry.mem.read8(PLAYER_X)} HAZARD_Y=${entry.mem.read8(HAZARD_Y)} ` +
      `PLAYER_Y=${entry.mem.read8(PLAYER_Y)} HAZARD_X=${entry.mem.read8(HAZARD_X)}; oracle deterministic`,
  );
});

// -- 1. EQUAL on the real captured entry --------------------------------------

test("EQUAL (real entry): flagObjectTargetOverlap == oracle over RAM (minus stack scratch below the entry SP)", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2c91 entry");

  const { ram, c } = compare(entry, null, idiomatic);
  assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);

  const inputs = {
    objY: entry.mem.read8(PLAYER_X),
    tgtY: entry.mem.read8(HAZARD_Y),
    objX: entry.mem.read8(PLAYER_Y),
    tgtX: entry.mem.read8(HAZARD_X),
  };
  assert.equal(c.mem.read8(MOVE_BLOCK_FLAG), expectedFlag(inputs), "published overlap flag mismatch");
  console.log(`  EQUAL/real: identical over RAM; MOVE_BLOCK_FLAG = ${c.mem.read8(MOVE_BLOCK_FLAG)}`);
});

// -- 2. EQUAL on a crafted branch/boundary/wrap set ---------------------------

test("EQUAL (branch/boundary/wrap set): every arm of the overlap test matches the oracle", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2c91 entry");

  // Aligned rows: tgtY=100 -> tgtY+12=112, so objY=112 makes rows coincide.
  // Wrapped rows: tgtY=249 -> (249+12)&0xff = 5, so objY=5 coincides only via wrap.
  const cases = [
    { name: "row miss (off by one)", i: { objY: 113, tgtY: 100, objX: 105, tgtX: 100 }, flag: 0 },
    { name: "aligned, X not right of cell (equal)", i: { objY: 112, tgtY: 100, objX: 100, tgtX: 100 }, flag: 0 },
    { name: "aligned, X left of cell", i: { objY: 112, tgtY: 100, objX: 90, tgtX: 100 }, flag: 0 },
    { name: "aligned, X just right (in band)", i: { objY: 112, tgtY: 100, objX: 101, tgtX: 100 }, flag: 1 },
    { name: "aligned, X at far band edge (+8)", i: { objY: 112, tgtY: 100, objX: 108, tgtX: 100 }, flag: 1 },
    { name: "aligned, X one past band (+9)", i: { objY: 112, tgtY: 100, objX: 109, tgtX: 100 }, flag: 0 },
    { name: "row wrap aligns (+12 wraps)", i: { objY: 5, tgtY: 249, objX: 105, tgtX: 100 }, flag: 1 },
    { name: "band wrap: high cellX, no overlap", i: { objY: 112, tgtY: 100, objX: 253, tgtX: 250 }, flag: 0 },
  ];

  for (const { name, i, flag } of cases) {
    assert.equal(expectedFlag(i), flag, `truth-table sanity: ${name}`);
    const { ram, c } = compare(entry, i, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
    assert.equal(c.mem.read8(MOVE_BLOCK_FLAG), flag, `${name}: MOVE_BLOCK_FLAG`);
  }
  console.log(`  EQUAL/crafted: all ${cases.length} branch/boundary/wrap cases identical to the oracle`);
});

// -- 3. EQUAL across a sweep of the compared axes -----------------------------

test("EQUAL (sweep): exhaustive over the X axis at every boundary cell + exhaustive row equality", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2c91 entry");

  // Sweep A — rows aligned (objY=112, tgtY=100): every objectX 0..255 against the
  // boundary/wrap cell-X values. This walks the whole X decision incl. the +8 wrap.
  const cellXs = [0, 1, 2, 3, 50, 100, 124, 125, 126, 127, 128, 200, 244, 247, 248, 249, 250, 251, 252, 253, 254, 255];
  let checked = 0;
  for (const tgtX of cellXs) {
    for (let objX = 0; objX < 256; objX++) {
      const i = { objY: 112, tgtY: 100, objX, tgtX };
      const { ram, c } = compare(entry, i, idiomatic);
      assert.equal(ram, null, ram && `X-sweep objX=${objX} tgtX=${tgtX}: RAM diff at ${hx(ram.addr)}`);
      assert.equal(c.mem.read8(MOVE_BLOCK_FLAG), expectedFlag(i), `X-sweep objX=${objX} tgtX=${tgtX}: flag`);
      checked++;
    }
  }

  // Sweep B — exhaustive row equality: for two object rows (one aligned normally, one
  // only via the +12 wrap), sweep tgtY 0..255 with an in-band X pair. rowsAlign is true
  // for exactly one tgtY per objY; every other tgtY must publish 0.
  for (const objY of [112, 5]) {
    for (let tgtY = 0; tgtY < 256; tgtY++) {
      const i = { objY, tgtY, objX: 105, tgtX: 100 };
      const { ram, c } = compare(entry, i, idiomatic);
      assert.equal(ram, null, ram && `row-sweep objY=${objY} tgtY=${tgtY}: RAM diff at ${hx(ram.addr)}`);
      assert.equal(c.mem.read8(MOVE_BLOCK_FLAG), expectedFlag(i), `row-sweep objY=${objY} tgtY=${tgtY}: flag`);
      checked++;
    }
  }
  console.log(`  EQUAL/sweep: ${checked} crafted states identical to the oracle (X axis + row equality, incl. wraps)`);
});

// -- 4. TEETH: an inverted flag is caught in both directions ------------------

/** Broken twin: correct overlap logic, but publishes the OPPOSITE flag. */
function twinInvertedFlag(m) {
  const { mem8 } = m;
  const rowsAlign = u8(mem8[HAZARD_Y] + 12) === mem8[PLAYER_X];
  const rightOfCell = mem8[HAZARD_X] < mem8[PLAYER_Y];
  const withinBand = u8(mem8[HAZARD_X] + 8) >= mem8[PLAYER_Y];
  const overlaps = rowsAlign && rightOfCell && withinBand;
  mem8[MOVE_BLOCK_FLAG] = overlaps ? 0 : 1; // BUG: flag inverted
  return m.call(0x2bd3);
}

test("TEETH (inverted flag): a twin that publishes the wrong flag is CAUGHT at MOVE_BLOCK_FLAG", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2c91 entry for the teeth check");

  const overlapInput = { objY: 112, tgtY: 100, objX: 105, tgtX: 100 }; // flag should be 1
  const missInput = { objY: 113, tgtY: 100, objX: 105, tgtX: 100 }; // flag should be 0

  for (const [label, i] of [["overlap", overlapInput], ["non-overlap", missInput]]) {
    const { ram } = compare(entry, i, twinInvertedFlag);
    assert.ok(ram, `${label}: gate FAILED to catch the inverted-flag twin — it proves nothing`);
    assert.equal(ram.addr, MOVE_BLOCK_FLAG, `${label}: teeth caught ${hx(ram.addr)} (expected ${hx(MOVE_BLOCK_FLAG)})`);
  }
  console.log(`  TEETH/inverted: caught at ${hx(MOVE_BLOCK_FLAG)} on both an overlap and a non-overlap input`);
});

// -- 5. TEETH: a one-pixel-too-wide band is caught at its boundary ------------

/** Broken twin: X window one pixel too wide (+9 instead of +8). */
function twinWideBand(m) {
  const { mem8 } = m;
  const rowsAlign = u8(mem8[HAZARD_Y] + 12) === mem8[PLAYER_X];
  const rightOfCell = mem8[HAZARD_X] < mem8[PLAYER_Y];
  const withinBand = u8(mem8[HAZARD_X] + 9) >= mem8[PLAYER_Y]; // BUG: band too wide
  const overlaps = rowsAlign && rightOfCell && withinBand;
  mem8[MOVE_BLOCK_FLAG] = overlaps ? 1 : 0;
  return m.call(0x2bd3);
}

test("TEETH (band off-by-one): a one-pixel-too-wide window is CAUGHT at the boundary cell", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2c91 entry for the teeth check");

  // objX = cellX + 9: the oracle says out-of-band (flag 0); the too-wide twin says 1.
  const boundary = { objY: 112, tgtY: 100, objX: 109, tgtX: 100 };
  assert.equal(expectedFlag(boundary), 0, "boundary sanity: oracle should not overlap at +9");

  const { ram } = compare(entry, boundary, twinWideBand);
  assert.ok(ram, "gate FAILED to catch the too-wide-band twin — it proves nothing");
  assert.equal(ram.addr, MOVE_BLOCK_FLAG, `teeth caught ${hx(ram.addr)} (expected ${hx(MOVE_BLOCK_FLAG)})`);
  console.log(`  TEETH/band: too-wide window caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
