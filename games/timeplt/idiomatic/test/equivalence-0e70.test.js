// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintQuadTile — memory-equivalent to the frozen oracle at ROM 0x0E70.
 *
 * ★ NOT REACHED BY EITHER TAPE, AND THAT IS ASSERTED. The only call sites sit inside the routine
 *   at ROM 0x0DD7, on arms that fire only when the value it decomposes has a non-zero count of
 *   tens or of thirties; neither the shared coin -> start tape nor undriven attract produces one
 *   in the harness's frame budget. Arm 1 asserts unitEquivalence throws "never entered" on both,
 *   so the crafted entries below are known to be necessary rather than convenient.
 *
 * GATE: crafted entries over poisoned tilemap planes. The entry is BUILT, not captured: a real
 *   machine cloned at the end of the shared tape's session, with both planes filled with a marker
 *   and only the three arguments moved. What it exercises, holes stated:
 *
 *   1. UNREACHED, ASSERTED — both tapes throw.
 *   2. THE BLOCK LANDS — over poisoned planes exactly eight cells change, four in each plane, and
 *      they are the four the file names and their twins a fixed distance lower. Measured off the
 *      ORACLE, so the shape of the block is not taken from the rewrite.
 *   3. THE CROSS — every combination of a spread of cursor positions, tile bases and colours,
 *      each a whole-state-dump comparison outside the scratch window.
 *   4. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-8, SP): the oracle pushes a
 *      return address for each of the three cursor steps it delegates. An upper bound, and every
 *      arm asserts nothing escapes it.
 *   5. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to a fixed shape. The accumulator
 *      is in that set for a reason worth stating: the cursor steps the oracle delegates to leave
 *      their own arithmetic in it, and the rewrite does not model that. The cursor itself IS
 *      reproduced and compared. The colour pointer the oracle leaves in HL is excluded because it
 *      is dead: 5a measures it.
 *   5a. HL IS DEAD AT EXIT, CRAFTED — no tape session dispatches this routine, so the deadness is
 *      measured on crafted entries of its only caller, the frozen 0x0DD7, at every input value that
 *      reaches it: HL complemented each time this routine hands back changes nothing the caller
 *      leaves (whole dump, every register, pc), while DE complemented at the same exit, and SP
 *      moved there, are both heard.
 *   6. WRAPPING — a cursor at the very end of the character plane, so the block's arithmetic is
 *      exercised where it crosses out of the plane rather than only in the middle of it.
 *   7. TEETH — twins, each with its exact catch count over the cross asserted.
 *
 * HOLE: no real dispatch anywhere in this file, so nothing here says which values a caller really
 * presents, and the tile codes and colours swept are chosen rather than observed. Nothing
 * establishes what the four tiles look like on screen either.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0e70.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { paintQuadTile } from "../paintQuadTile.js";
import { loc_0e70 as oracle } from "../../translated/loc_0e70.js";
import { loc_0dd7 as caller } from "../../translated/loc_0dd7.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";

const TARGET = 0x0e70;

const LINE_STRIDE = 32;
const COLOUR_PLANE_BELOW = 1024;

const COLOUR_PLANE = 0xa000;
const CHARACTER_PLANE = 0xa400;
const PLANE_BYTES = 0x400;
const POISON = 0x5a;

const SCRATCH_BYTES = 8;
const EXCLUDED = ["a", "f", "sp", "h", "l"];

/** The only caller, and the input values that take it through this routine (a non-zero count of
 *  tens or thirties), plus values that do not, which must not dispatch it. */
const CALLER = 0x0dd7;
const CALLER_VALUES = [10, 14, 20, 29, 30, 37, 45, 59, 60, 75, 90, 99, 100, 255];

/** Where a caller inside the character plane could plausibly put the block. */
const CURSORS = [0xa463, 0xa401, 0xa41f, 0xa480, 0xa4a1, 0xa600, 0xa7e0, 0xa7fe];
const TILES = [0, 0x23, 0xce, 0xfd, 0xff];
const COLOURS = [0, 0x11, 0x16, 0xff];
const CROSS_SIZE = CURSORS.length * TILES.length * COLOURS.length;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr >= sp - SCRATCH_BYTES && addr < sp;

let backdropCache = null;
/** A real end-of-session machine, produced by the shared tape and nothing else. */
function backdrop() {
  if (backdropCache === null) {
    const m = makeMachine();
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the backdrop session stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the backdrop session ran short");
    backdropCache = m.clone();
  }
  return backdropCache;
}

function craft(cursor, tile, colour) {
  const m = backdrop().clone();
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) m.mem8[a] = POISON;
  m.regs.de = cursor;
  m.regs.b = tile;
  m.regs.c = colour;
  return m;
}

function unitDiff(candidate, cursor, tile, colour) {
  const a = craft(cursor, tile, colour);
  const b = craft(cursor, tile, colour);
  const sp = a.regs.sp;
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

function crossCaught(candidate) {
  let caught = 0;
  for (const cursor of CURSORS) {
    for (const tile of TILES) {
      for (const colour of COLOURS) if (unitDiff(candidate, cursor, tile, colour)) caught++;
    }
  }
  return caught;
}

/** Every plane cell the ORACLE moves off the marker, given one set of arguments. */
function oracleWriteSet(cursor, tile, colour) {
  const m = craft(cursor, tile, colour);
  oracle(m);
  const out = [];
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) {
    if (m.mem8[a] !== POISON) out.push(a);
  }
  return { cells: out, read: (a) => m.mem8[a] };
}

let callerEntryCache = null;
/** The first real dispatch of the caller in the shared tape's session. */
function callerEntry() {
  if (callerEntryCache === null) {
    const m = makeMachine(new Map([[CALLER, (mm) => {
      if (callerEntryCache === null) callerEntryCache = mm.clone();
      return caller(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
    assert.notEqual(callerEntryCache, null, "the shared tape never dispatched the caller");
  }
  return callerEntryCache;
}

/** The frozen caller run on a crafted value, with `poison` applied each time this routine hands
 *  back. Returns the machine and how many hand-backs were poisoned. */
function callerRun(value, poison) {
  const m = callerEntry().clone();
  m.regs.a = value;
  let exits = 0;
  if (poison) {
    const frozen = m.routines.get(TARGET);
    m.routines = new Map(m.routines);
    m.routines.set(TARGET, (mm, ...args) => {
      const r = frozen(mm, ...args);
      exits++;
      poison(mm);
      return r;
    });
  }
  let threw = null;
  try { caller(m); } catch (e) { threw = String(e).slice(0, 60); }
  return { m, exits, threw };
}

/** Whether a poisoned caller run differs from the clean one anywhere: dump, registers, pc, a throw. */
function heardAtExit(value, poison) {
  const clean = callerRun(value, null);
  const run = callerRun(value, poison);
  const differs = run.threw !== null || allDiffs(clean.m, run.m).length > 0 ||
    REG_FIELDS.some((k) => clean.m.regs[k] !== run.m.regs[k]) || clean.m.pc !== run.m.pc;
  return { differs, exits: run.exits };
}

// ── the routine is unreached, and that is asserted ──────────────────────────────────────

test("UNREACHED: neither tape dispatches it, so the crafted entries are necessary", { skip }, () => {
  for (const [label, opts] of [["coin -> start", {}], ["undriven attract", { tape: [] }]]) {
    assert.throws(
      () => unitEquivalence((ov) => makeMachine(ov, opts), TARGET, oracle, paintQuadTile, {
        maxFrames: ENTRY_FRAMES,
      }),
      /never entered/,
      `${label} unexpectedly reached the routine — this gate should become a real capture`,
    );
  }
  console.log("  UNREACHED: both tapes throw 'never entered' — crafted entries it is");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("THE BLOCK LANDS: eight cells, four per plane, in the shape this file names", { skip }, () => {
  const cursor = CURSORS[0];
  const tile = 0x23;
  const colour = 0x16;
  const { cells, read } = oracleWriteSet(cursor, tile, colour);

  const quarters = [cursor, u16(cursor - 1), u16(cursor - 1 + LINE_STRIDE), u16(cursor + LINE_STRIDE)];
  const expected = [...quarters, ...quarters.map((c) => u16(c - COLOUR_PLANE_BELOW))]
    .sort((x, y) => x - y);
  assert.deepEqual(cells, expected, "the oracle's write-set is not the block this file describes");
  assert.deepEqual(quarters.map(read), [tile + 1, tile, tile + 2, tile + 3],
    "the four tile codes are not the run this file describes");
  assert.ok(quarters.every((c) => read(u16(c - COLOUR_PLANE_BELOW)) === colour),
    "a colour cell holds something other than the colour the caller supplied");
  console.log(`  LANDS: ${cells.length} cells — ${quarters.map(hex4).join(" ")} and their twins`);
});

test("THE CROSS: every cursor x tile x colour comparison is identical", { skip }, () => {
  for (const cursor of CURSORS) {
    for (const tile of TILES) {
      for (const colour of COLOURS) {
        const d = unitDiff(paintQuadTile, cursor, tile, colour);
        assert.equal(d, null, `${hex4(cursor)}/${tile}/${colour}: ${show(d)}`);
      }
    }
  }
  console.log(`  CROSS: ${CROSS_SIZE} crafted comparisons identical`);
});

test("HL IS DEAD AT EXIT: complemented where this hands back, its only caller leaves nothing different", { skip }, () => {
  let exits = 0;
  let deHeard = 0;
  let spHeard = 0;
  for (const value of CALLER_VALUES) {
    const hl = heardAtExit(value, (mm) => { mm.regs.hl = mm.regs.hl ^ 0xffff; });
    assert.ok(hl.exits > 0, `value ${value} never reached this routine`);
    assert.equal(hl.differs, false, `value ${value}: HL complemented at the exit was heard`);
    exits += hl.exits;
    // CONTROLS, same instrument and exit: the cursor in DE, and SP.
    if (heardAtExit(value, (mm) => { mm.regs.de = mm.regs.de ^ 0xffff; }).differs) deHeard++;
    if (heardAtExit(value, (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; }).differs) spHeard++;
  }
  assert.equal(deHeard, CALLER_VALUES.length, "a complemented cursor went unheard, so the instrument is deaf");
  assert.equal(spHeard, CALLER_VALUES.length, "SP moved at the exit went unheard, so the poison never lands");
  assert.equal(heardAtExit(0, () => {}).exits, 0, "a value with no tens or thirties reached this routine");
  console.log(`  DEAD AT EXIT: HL complemented on ${exits} hand-backs over ${CALLER_VALUES.length} values, ` +
    "nothing differs; DE and SP at the same exit heard on every value");
});

test("EXCLUDED, deliberately: the accumulator, the flag byte, sp, pc and the scratch pushes", { skip }, () => {
  const cursor = CURSORS[0];
  const a = craft(cursor, 0x23, 0x16);
  const b = craft(cursor, 0x23, 0x16);
  const sp = a.regs.sp;
  oracle(a);
  paintQuadTile(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(moved.every((k) => EXCLUDED.includes(k)), `a register outside the set moved: ${moved}`);
  assert.equal(a.regs.de, b.regs.de, "the cursor is reproduced, not excluded");
  assert.equal(a.regs.de, u16(cursor + 2 * LINE_STRIDE), "the cursor did not come out two places on");
  assert.deepEqual(allDiffs(a, b).filter((d) => !inScratch(d.addr, sp)), [],
    "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: ${moved.join(", ")}, pc, and [SP-${SCRATCH_BYTES}, SP)`);
});

test("WRAPPING: a cursor at the end of the character plane behaves the same", { skip }, () => {
  const cursor = 0xa7fe;
  const d = unitDiff(paintQuadTile, cursor, 0x23, 0x16);
  assert.equal(d, null, `the wrapping case diverged — ${show(d)}`);
  const { cells } = oracleWriteSet(cursor, 0x23, 0x16);
  assert.ok(cells.length < 8, "this cursor was chosen because part of the block leaves the planes");
  console.log(`  WRAPPING: at ${hex4(cursor)} only ${cells.length} of 8 cells land inside the planes`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the four tile codes go to the four cells in a different order. */
function brokenTileOrder(m) {
  const { mem8, regs } = m;
  const cell = regs.de;
  const tile = regs.b;
  const quarters = [cell, u16(cell - 1), u16(cell - 1 + LINE_STRIDE), u16(cell + LINE_STRIDE)];
  mem8[quarters[0]] = tile;
  mem8[quarters[1]] = tile + 1;
  mem8[quarters[2]] = tile + 2;
  mem8[quarters[3]] = tile + 3;
  for (let i = 3; i >= 0; i--) mem8[u16(quarters[i] - COLOUR_PLANE_BELOW)] = regs.c;
  regs.hl = u16(cell - COLOUR_PLANE_BELOW);
  regs.de = u16(cell + 2 * LINE_STRIDE);
}

/** BUG: the second row is a line-stride the other way. */
function brokenSecondRow(m) {
  const { mem8, regs } = m;
  const cell = regs.de;
  const tile = regs.b;
  const quarters = [cell, u16(cell - 1), u16(cell - 1 - LINE_STRIDE), u16(cell - LINE_STRIDE)];
  mem8[quarters[0]] = tile + 1;
  mem8[quarters[1]] = tile;
  mem8[quarters[2]] = tile + 2;
  mem8[quarters[3]] = tile + 3;
  for (let i = 3; i >= 0; i--) mem8[u16(quarters[i] - COLOUR_PLANE_BELOW)] = regs.c;
  regs.hl = u16(cell - COLOUR_PLANE_BELOW);
  regs.de = u16(cell + 2 * LINE_STRIDE);
}

/** BUG: paints the tiles and forgets the colour. */
function brokenNoColour(m) {
  const { mem8, regs } = m;
  const cell = regs.de;
  const tile = regs.b;
  const quarters = [cell, u16(cell - 1), u16(cell - 1 + LINE_STRIDE), u16(cell + LINE_STRIDE)];
  mem8[quarters[0]] = tile + 1;
  mem8[quarters[1]] = tile;
  mem8[quarters[2]] = tile + 2;
  mem8[quarters[3]] = tile + 3;
  regs.hl = u16(cell - COLOUR_PLANE_BELOW);
  regs.de = u16(cell + 2 * LINE_STRIDE);
}

/** BUG: clears the plane bit instead of subtracting, so a colour-side cursor is not carried down. */
function brokenColourByMask(m) {
  const { mem8, regs } = m;
  const cell = regs.de;
  const tile = regs.b;
  const quarters = [cell, u16(cell - 1), u16(cell - 1 + LINE_STRIDE), u16(cell + LINE_STRIDE)];
  mem8[quarters[0]] = tile + 1;
  mem8[quarters[1]] = tile;
  mem8[quarters[2]] = tile + 2;
  mem8[quarters[3]] = tile + 3;
  for (let i = 3; i >= 0; i--) mem8[quarters[i] & ~COLOUR_PLANE_BELOW] = regs.c;
  regs.hl = u16(cell - COLOUR_PLANE_BELOW);
  regs.de = u16(cell + 2 * LINE_STRIDE);
}

/** BUG: leaves the cursor one place on instead of two, so a chained block overlaps. */
function brokenCursorStep(m) {
  paintQuadTile(m);
  m.regs.de = u16(m.regs.de - LINE_STRIDE);
}

/** HARMLESS: leaves the colour pointer where the last colour cell was. HL is dead where this hands
 *  back (the DEAD AT EXIT arm), so this is asserted caught nowhere rather than deleted. */
function brokenColourPointer(m) {
  paintQuadTile(m);
  m.regs.hl = u16(m.regs.hl + LINE_STRIDE);
}

/** BUG: the tile codes count down from the base rather than up. */
function brokenTilesDescend(m) {
  const { mem8, regs } = m;
  const cell = regs.de;
  const tile = regs.b;
  const quarters = [cell, u16(cell - 1), u16(cell - 1 + LINE_STRIDE), u16(cell + LINE_STRIDE)];
  mem8[quarters[0]] = tile - 1;
  mem8[quarters[1]] = tile;
  mem8[quarters[2]] = tile - 2;
  mem8[quarters[3]] = tile - 3;
  for (let i = 3; i >= 0; i--) mem8[u16(quarters[i] - COLOUR_PLANE_BELOW)] = regs.c;
  regs.hl = u16(cell - COLOUR_PLANE_BELOW);
  regs.de = u16(cell + 2 * LINE_STRIDE);
}

/**
 * Per twin, its EXACT catch count over the cross. A twin caught on the wrong set fails as loudly
 * as one not caught at all. The mask twin's 40 is the whole point of the arithmetic it breaks:
 * it survives every cursor that already has the plane bit set and dies on the ones that do not.
 */
const TWINS = [
  ["no-op", brokenNoOp, 160],
  ["tile-order", brokenTileOrder, 160],
  ["second-row-the-wrong-way", brokenSecondRow, 160],
  ["no-colour", brokenNoColour, 160],
  ["colour-by-mask-not-subtraction", brokenColourByMask, 40],
  ["cursor-one-place-short", brokenCursorStep, 160],
  ["colour-pointer-off (harmless)", brokenColourPointer, 0],
  ["tiles-descend", brokenTilesDescend, 160],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted comparisons`, { skip }, () => {
    assert.equal(crossCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${CROSS_SIZE} crafted comparisons`);
  });
}
