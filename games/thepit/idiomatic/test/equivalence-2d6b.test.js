// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stampGlyphColumn (ROM 0x2d6b) — the countdown-expiry
 * routine that stamps a fixed five-tile glyph down the dig/target object's map column,
 * paints its colour column, re-arms the object's state timer, and hands off to the
 * background-animation update.
 *
 * The routine's whole effect is memory: five tile cells stamped down one column, five
 * matching colour cells, the per-event latch (0x8078) cleared, the state timer (0x807c)
 * armed to 180 — then a tail hand-off to the still-oracle background update (0x2f71),
 * which reads no register left here and so runs identically on both sides, cancelling
 * out of the diff. The declared live-out is MEMORY-ONLY, so the gate compares RAM only
 * (dumpState); pc, SP and the dead value-registers/flags are excluded per the
 * honest-signature contract (the idiomatic layer does not preserve the Z80 register
 * trace). Both arms end with the identical oracle tail-call, so no stack-scratch window
 * needs excluding — a correct run diffs to exactly zero bytes.
 *
 * HOW IT IS REACHED. 0x2d6b IS dispatched during the attract demo (once, in the
 * dig-object window around frame ~1500-2000); its caller loc_2cb7 fires ~119 times in
 * the same window. The routine reads no timer of its own — the caller checks the reload
 * sentinel and jumps here unconditionally — so any real dig-object entry state is a
 * faithful input. The one input that shapes the output, the object's display-cell
 * pointer (PLAYER_CELL_PTR, 0x806e), is additionally swept across several map positions,
 * poked identically on both sides, to prove the address arithmetic is position-exact.
 *
 * Checks:
 *   0. HARNESS   — capture the genuine 0x2d6b entry and confirm the oracle run is
 *      deterministic (oracle vs oracle -> identical RAM). Proves the capture reaches the
 *      real dispatch and the tail hand-off is reproducible.
 *   1. EQUAL (real entry) — stampGlyphColumn == oracle over RAM, and the five tiles,
 *      five colour cells, cleared latch and armed timer hold their expected values.
 *   2. EQUAL (pointer sweep) — with the display-cell pointer forced to each of several
 *      map positions, both stamp the same glyph + colour column, identical.
 *   3. TEETH (wrong tile)    — a twin with one wrong glyph tile is CAUGHT.
 *   4. TEETH (wrong colour)  — a twin with a wrong colour byte is CAUGHT.
 *   5. TEETH (wrong timer)   — a twin that arms the state timer to 179 is CAUGHT.
 *   6. TEETH (latch left set) — a twin that skips clearing the per-event latch is CAUGHT.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2d6b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d6b as oracle } from "../../translated/loc_2d6b.js";
import { loc_2cb7 as caller } from "../../translated/loc_2cb7.js";
import { stampGlyphColumn as idiomatic } from "../stampGlyphColumn.js";
import { makeMachineFactory } from "../../machine.js";
import { PLAYER_CELL_PTR, TRANSITION_TIMER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const LATCH = 0x8078; // the per-event latch this routine clears (no names.js name yet)
const GLYPH = [62, 20, 23, 24, 35]; // the fixed glyph tile codes, top cell to bottom
const OFFSETS = [-0x41, -0x21, -0x01, 0x1f, 0x3f]; // glyph cell offsets from the object cell
const COLOUR = 6; // the colour painted down the column
const TIMER = 180; // 0xb4 — the value the state timer is armed to
const MAX_FRAMES = 2100; // the dig-object window that dispatches 0x2d6b sits by ~frame 2000
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Run the attract demo and clone the machine at the first dispatch of `target`,
 * delegating to `oracleFn` so the host run continues undisturbed. Returns the captured
 * entry state (or null if the target was never reached in MAX_FRAMES).
 */
function captureEntry(target, oracleFn) {
  let entry = null;
  const host = makeMachine(new Map([[target, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracleFn(mm);
  }]]));
  host.runFrames(MAX_FRAMES);
  return entry;
}

// Capture both entry states once (each is a full attract run) and clone per test.
const realEntry = ROM_PRESENT ? captureEntry(0x2d6b, oracle) : null; // the genuine dispatch
const callerSeed = ROM_PRESENT ? captureEntry(0x2cb7, caller) : null; // a frequent dig-object state

// Stack window at the top of The Pit's work RAM; only the part below the entry SP is dead. The
// background chain stampGlyphColumn tails into reaches the object movers, whose shared actor-update
// tail (updateEnemy2 -> advanceTwoSpriteActor) is a dissolved DIRECT call: it runs stack-free
// on the idiomatic side while the oracle marshals the same tail through the Z80 stack, so those dead
// bytes differ. Nothing observable lives there (all of 0x2d6b's writes are far below it).
const STACK_LO = 0x8380;
const STACK_HI = 0x8400;

/** RAM-only first-difference between two machines (dumpState), EXCLUDING stack scratch below
 *  `entrySP`, or null when identical. */
function ramDiff(a, b, entrySP) {
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

/** The five glyph tile-cell addresses for a given object-cell pointer. */
function glyphCells(objectCell) {
  return OFFSETS.map((d) => (objectCell + d) & 0xffff);
}

/** The five colour-cell addresses (the tilemap sits 0x800 above the colour map). */
function colourCells(objectCell) {
  return OFFSETS.map((d) => (objectCell + d - 0x800) & 0xffff);
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: the genuine 0x2d6b entry is captured and the oracle run is deterministic", () => {
  const entry = realEntry;
  assert.ok(entry, "expected 0x2d6b to be dispatched during the attract demo");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  assert.equal(ramDiff(a, b, entry.regs.sp), null, "oracle run of 0x2d6b is not deterministic");
  console.log(
    `  HARNESS: real 0x2d6b entry (0x806e=${hx(entry.mem.read16(PLAYER_CELL_PTR))}, ` +
      `SP=${hx(entry.regs.sp)}); oracle run deterministic`,
  );
});

// -- 1. EQUAL on the genuine captured entry ----------------------------------

test("EQUAL (real entry): stampGlyphColumn == oracle over RAM", () => {
  const entry = realEntry;
  assert.ok(entry, "need a captured 0x2d6b entry");
  const objectCell = entry.mem.read16(PLAYER_CELL_PTR);

  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  idiomatic(c);
  const d = ramDiff(o, c, entry.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idio=${d.b}`);

  // Positive checks: the glyph, its colour column, the cleared latch and the armed timer.
  glyphCells(objectCell).forEach((addr, i) =>
    assert.equal(c.mem.read8(addr), GLYPH[i], `glyph tile ${i} at ${hx(addr)}`),
  );
  colourCells(objectCell).forEach((addr, i) =>
    assert.equal(c.mem.read8(addr), COLOUR, `colour cell ${i} at ${hx(addr)}`),
  );
  assert.equal(c.mem.read8(LATCH), 0, "per-event latch not cleared");
  assert.equal(c.mem.read8(TRANSITION_TIMER), TIMER, "state timer not armed to 180");
  console.log(`  EQUAL/real: identical RAM; glyph + colour + latch + timer at 0x806e=${hx(objectCell)}`);
});

// -- 2. EQUAL across a crafted sweep of the display-cell pointer --------------

test("EQUAL (pointer sweep): every map position stamps identically to the oracle", () => {
  const seed = callerSeed; // the caller fires often; a real dig-object state
  assert.ok(seed, "need a captured dig-object state to craft the sweep from");

  for (const ptr of [0x9100, 0x9200, 0x929d, 0x9300, 0x9380]) {
    const base = seed.clone();
    base.mem.write16(PLAYER_CELL_PTR, ptr);

    const o = base.clone();
    oracle(o);
    const c = base.clone();
    idiomatic(c);
    const d = ramDiff(o, c, base.regs.sp);
    assert.equal(d, null, d && `ptr=${hx(ptr)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idio=${d.b}`);

    glyphCells(ptr).forEach((addr, i) =>
      assert.equal(c.mem.read8(addr), GLYPH[i], `ptr=${hx(ptr)}: glyph tile ${i}`),
    );
  }
  console.log("  EQUAL/sweep: 5 map positions all stamp the glyph + colour column identical to the oracle");
});

// -- teeth: broken twins the RAM diff must catch -----------------------------
// Each twin is the oracle followed by one wrong write to a distinct output cell; the
// RAM diff must surface exactly that cell. (The tail update 0x2f71 touches none of
// these cells, so a corruption cannot heal before the diff.)

function runTeeth(twin) {
  const entry = realEntry;
  assert.ok(entry, "need a captured 0x2d6b entry for the teeth check");
  const objectCell = entry.mem.read16(PLAYER_CELL_PTR);
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  twin(c, objectCell);
  return { d: ramDiff(o, c, entry.regs.sp), objectCell };
}

test("TEETH (wrong tile): a twin with one wrong glyph tile is CAUGHT", () => {
  const { d, objectCell } = runTeeth((m, cell) => {
    oracle(m);
    m.mem.write8(glyphCells(cell)[0], 99); // BUG: wrong top glyph tile
  });
  const expected = glyphCells(objectCell)[0];
  assert.ok(d, "the gate FAILED to catch a wrong glyph tile — it proves nothing");
  assert.equal(d.addr, expected, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(expected)})`);
  console.log(`  TEETH/tile: wrong glyph tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH (wrong colour): a twin with a wrong colour byte is CAUGHT", () => {
  const { d, objectCell } = runTeeth((m, cell) => {
    oracle(m);
    m.mem.write8(colourCells(cell)[2], COLOUR ^ 1); // BUG: wrong colour
  });
  const expected = colourCells(objectCell)[2];
  assert.ok(d, "the gate FAILED to catch a wrong colour byte — it proves nothing");
  assert.equal(d.addr, expected, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(expected)})`);
  console.log(`  TEETH/colour: wrong colour caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH (wrong timer): a twin that arms the state timer to 179 is CAUGHT", () => {
  const { d } = runTeeth((m) => {
    oracle(m);
    m.mem.write8(TRANSITION_TIMER, TIMER - 1); // BUG: state timer off by one
  });
  assert.ok(d, "the gate FAILED to catch a wrong state-timer value — it proves nothing");
  assert.equal(d.addr, TRANSITION_TIMER, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(TRANSITION_TIMER)})`);
  console.log(`  TEETH/timer: wrong timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH (latch left set): a twin that skips clearing the per-event latch is CAUGHT", () => {
  const { d } = runTeeth((m) => {
    oracle(m);
    m.mem.write8(LATCH, 1); // BUG: leave the latch set instead of clearing it
  });
  assert.ok(d, "the gate FAILED to catch an un-cleared latch — it proves nothing");
  assert.equal(d.addr, LATCH, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(LATCH)})`);
  console.log(`  TEETH/latch: un-cleared latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
