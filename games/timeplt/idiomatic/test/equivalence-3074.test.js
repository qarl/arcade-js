// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3074 — memory-equivalent to the frozen oracle at ROM 0x3074.
 *
 * ★ WHAT REACHES THIS ADDRESS, AND WHY NO REAL CAPTURE IS POSSIBLE HERE. Decoding the image from
 *   EVERY byte offset — which over-generates and cannot under-generate — finds exactly one
 *   transfer to 0x3074 in the whole 24KB, a `djnz` at 0x3081, and 0x307F..0x3089 is a CAPTION
 *   RECORD rather than instructions: a destination, a colour, then glyph codes. So that transfer
 *   is a decode of data and not a real entry. The genuine way in is a fall-through from 0x306A,
 *   four instructions that load the two coordinate registers off the sprite entry and point HL at
 *   a table — and 0x306A has no transcribed routine, which is why 0x3074 stands alone at all.
 *   Both tapes therefore dispatch it zero times, asserted in arm 1, and the crafted entries below
 *   REPRODUCE that prologue so the state they present is the one the fall-through would.
 *
 * GATE: crafted entries from a real end-of-session machine, over painted sprite bands.
 *
 *   1. UNREACHED, ASSERTED — both tapes throw "never entered".
 *   2. THE TWO BYTES LAND — measured off the ORACLE over a painted band: exactly two cells move,
 *      and they are the two coordinates of the entry ONE STRIDE ON, not of the entry passed in.
 *   3. THE CROSS — sprite entries, record bases and table pointers, each a whole-state-dump
 *      comparison; the coordinate registers loaded from the entry exactly as the prologue does.
 *   4. EXHAUSTIVE over the displacement — all 256 values of the table byte the pointer selects,
 *      poked into a scratch cell so the wrap of the sum is covered rather than argued.
 *   5. REGISTERS ARE EXCLUDED, DELIBERATELY, and pinned. The cursor pair the routine advances IS
 *      reproduced and compared; the flag byte and the pair the frozen advance happens to leave a
 *      stride in are not, since the rewrite reaches the advance through the decompiled twin.
 *   6. TEETH — seven twins, each with its exact catch count over the cross.
 *
 * HOLE: no real dispatch, so nothing here says which displacements a live game presents; and
 * nothing establishes what the table at the pointer the prologue loads is for. The prologue is
 * reproduced from the four instructions preceding this entry, which is a reading of the image
 * and not an observation.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3074.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3074 } from "../loc_3074.js";
import { loc_3074 as oracle } from "../../translated/loc_3074.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3074;

const ENTRY_STRIDE = 2;
const SECOND_AXIS_OFFSET = 49;
const RECORD_STRIDE = 16;

/** The table pointer the fall-through prologue loads, and two neighbours of it. */
const PROLOGUE_TABLE = 0x086e;
const TABLES = [PROLOGUE_TABLE, PROLOGUE_TABLE + 1, PROLOGUE_TABLE + 2];

const ENTRIES = [0xaa10, 0xaa1a, 0xaa28, 0xaa60, 0xaa00, 0xaa7e];
const RECORDS = [0xa800, 0xa850, 0xa900];
const CROSS_SIZE = ENTRIES.length * RECORDS.length * TABLES.length;

/** A scratch cell in work RAM, used only to hold a poked displacement the pointer can select. */
const SCRATCH_SOURCE = 0xafc0;

const PAINT_EITHER_SIDE = 4;
const EXCLUDED = ["f", "d", "e", "sp"];

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

let backdropCache = null;
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

/** A non-zero marker derived from the address, so no two painted bytes collide. */
const marker = (addr) => ((addr & 0xff) ^ 0x5a) || 0x5a;

/** The bytes a wrong offset could plausibly land on: both coordinates of two adjacent entries. */
function bandCells(entry) {
  const out = [];
  for (let d = -PAINT_EITHER_SIDE; d <= ENTRY_STRIDE + PAINT_EITHER_SIDE; d++) {
    out.push(entry + d, entry + SECOND_AXIS_OFFSET + d);
  }
  return out.sort((x, y) => x - y);
}

/**
 * A real machine with the band painted and the fall-through prologue reproduced: the two
 * coordinate registers loaded off the entry, and the table pointer in place.
 */
function craft(entry, record, table) {
  const m = backdrop().clone();
  for (const a of bandCells(entry)) m.mem8[a] = marker(a);
  m.regs.iy = entry;
  m.regs.ix = record;
  m.regs.hl = table;
  m.regs.b = m.mem8[entry + SECOND_AXIS_OFFSET];
  m.regs.c = m.mem8[entry];
  return m;
}

function unitDiff(candidate, make) {
  const a = make();
  const b = make();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b)[0];
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

function crossCaught(candidate) {
  let caught = 0;
  for (const entry of ENTRIES) {
    for (const record of RECORDS) {
      for (const table of TABLES) {
        if (unitDiff(candidate, () => craft(entry, record, table))) caught++;
      }
    }
  }
  return caught;
}

/** The same crafted entry with the pointer aimed at a scratch cell holding a chosen byte. */
function craftDisplacement(displacement) {
  const m = craft(ENTRIES[0], RECORDS[0], PROLOGUE_TABLE);
  m.regs.hl = SCRATCH_SOURCE;
  m.mem8[SCRATCH_SOURCE] = displacement;
  return m;
}

// ── the routine is unreached, and that is asserted ──────────────────────────────────────

test("UNREACHED: neither tape dispatches it, so the crafted entries are necessary", { skip }, () => {
  for (const [label, opts] of [["coin -> start", {}], ["undriven attract", { tape: [] }]]) {
    assert.throws(
      () => unitEquivalence((ov) => makeMachine(ov, opts), TARGET, oracle, loc_3074, {
        maxFrames: ENTRY_FRAMES,
      }),
      /never entered/,
      `${label} unexpectedly reached the routine — this gate should become a real capture`,
    );
  }
  console.log("  UNREACHED: both tapes throw 'never entered' — crafted entries it is");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("THE TWO BYTES LAND: on the NEXT entry, and nowhere else in the band", { skip }, () => {
  const entry = ENTRIES[0];
  const before = craft(entry, RECORDS[0], PROLOGUE_TABLE);
  const after = before.clone();
  oracle(after);
  const moved = bandCells(entry).filter((a) => after.mem8[a] !== before.mem8[a]);
  const next = entry + ENTRY_STRIDE;
  assert.deepEqual(moved, [next, next + SECOND_AXIS_OFFSET].sort((x, y) => x - y),
    "the oracle's write-set inside the band is not the next entry's coordinate pair");
  assert.equal(after.mem8[next + SECOND_AXIS_OFFSET], before.mem8[entry + SECOND_AXIS_OFFSET],
    "one coordinate must be carried across unchanged");
  assert.equal(after.mem8[next],
    (before.mem8[entry] + before.mem8[PROLOGUE_TABLE]) & 0xff,
    "the other must be the entry's coordinate displaced by the byte the pointer selects");
  console.log(`  LANDS: ${moved.map(hex4).join(" ")} — the entry one stride on`);
});

test("THE CROSS: every entry x record x pointer comparison is identical", { skip }, () => {
  for (const entry of ENTRIES) {
    for (const record of RECORDS) {
      for (const table of TABLES) {
        const d = unitDiff(loc_3074, () => craft(entry, record, table));
        assert.equal(d, null, `${hex4(entry)}/${hex4(record)}/${hex4(table)}: ${show(d)}`);
      }
    }
  }
  console.log(`  CROSS: ${CROSS_SIZE} crafted comparisons identical`);
});

test("EXHAUSTIVE over the displacement: all 256 values of the selected byte", { skip }, () => {
  for (let displacement = 0; displacement < 256; displacement++) {
    const d = unitDiff(loc_3074, () => craftDisplacement(displacement));
    assert.equal(d, null, `displacement ${displacement}: ${show(d)}`);
  }
  const wrapped = craftDisplacement(255);
  const base = wrapped.mem8[ENTRIES[0]];
  oracle(wrapped);
  assert.equal(wrapped.mem8[ENTRIES[0] + ENTRY_STRIDE], (base + 255) & 0xff,
    "the sum must wrap at a byte rather than carrying");
  console.log("  EXHAUSTIVE: 256 displacements identical, and the wrap is asserted");
});

test("EXCLUDED, deliberately: the flag byte, one register pair, sp and pc", { skip }, () => {
  const a = craft(ENTRIES[0], RECORDS[0], PROLOGUE_TABLE);
  const b = a.clone();
  oracle(a);
  loc_3074(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(moved.every((k) => EXCLUDED.includes(k)), `a register outside the set moved: ${moved}`);
  assert.equal(a.regs.ix, b.regs.ix, "the record cursor is reproduced, not excluded");
  assert.equal(a.regs.iy, b.regs.iy, "the entry cursor is reproduced, not excluded");
  assert.equal(a.regs.ix, RECORDS[0] + RECORD_STRIDE, "the record cursor did not step a record on");
  assert.equal(a.regs.iy, ENTRIES[0] + ENTRY_STRIDE, "the entry cursor did not step an entry on");
  assert.equal(a.regs.a, b.regs.a, "the displaced coordinate is reproduced, not excluded");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: writes the pair onto the entry it was handed instead of the one a stride on. */
function brokenSameEntry(m) {
  const { mem8, regs } = m;
  regs.a = mem8[regs.hl] + regs.c;
  mem8[regs.iy + SECOND_AXIS_OFFSET] = regs.b;
  mem8[regs.iy] = regs.a;
  regs.ix = regs.ix + RECORD_STRIDE;
  regs.iy = regs.iy + ENTRY_STRIDE;
}

/** BUG: displaces the coordinate that should be carried across, and copies the other. */
function brokenAxesSwapped(m) {
  const { mem8, regs } = m;
  const next = regs.iy + ENTRY_STRIDE;
  regs.a = mem8[regs.hl] + regs.c;
  mem8[next + SECOND_AXIS_OFFSET] = regs.a;
  mem8[next] = regs.b;
  regs.ix = regs.ix + RECORD_STRIDE;
  regs.iy = regs.iy + ENTRY_STRIDE;
}

/** BUG: ignores the table and copies the coordinate straight across. */
function brokenNoDisplacement(m) {
  const { mem8, regs } = m;
  const next = regs.iy + ENTRY_STRIDE;
  regs.a = regs.c;
  mem8[next + SECOND_AXIS_OFFSET] = regs.b;
  mem8[next] = regs.a;
  regs.ix = regs.ix + RECORD_STRIDE;
  regs.iy = regs.iy + ENTRY_STRIDE;
}

/** BUG: reads the table one byte along. */
function brokenTableOffByOne(m) {
  const { mem8, regs } = m;
  const next = regs.iy + ENTRY_STRIDE;
  regs.a = mem8[regs.hl + 1] + regs.c;
  mem8[next + SECOND_AXIS_OFFSET] = regs.b;
  mem8[next] = regs.a;
  regs.ix = regs.ix + RECORD_STRIDE;
  regs.iy = regs.iy + ENTRY_STRIDE;
}

/** BUG: writes the pair and leaves both cursors where they were. */
function brokenNoAdvance(m) {
  const { mem8, regs } = m;
  const next = regs.iy + ENTRY_STRIDE;
  regs.a = mem8[regs.hl] + regs.c;
  mem8[next + SECOND_AXIS_OFFSET] = regs.b;
  mem8[next] = regs.a;
}

/** BUG: steps the record cursor by an entry stride rather than a record stride. */
function brokenRecordStride(m) {
  const { mem8, regs } = m;
  const next = regs.iy + ENTRY_STRIDE;
  regs.a = mem8[regs.hl] + regs.c;
  mem8[next + SECOND_AXIS_OFFSET] = regs.b;
  mem8[next] = regs.a;
  regs.ix = regs.ix + ENTRY_STRIDE;
  regs.iy = regs.iy + ENTRY_STRIDE;
}

const TWINS = [
  ["no-op", brokenNoOp, CROSS_SIZE],
  ["same-entry", brokenSameEntry, CROSS_SIZE],
  ["axes-swapped", brokenAxesSwapped, CROSS_SIZE],
  ["no-displacement", brokenNoDisplacement, CROSS_SIZE],
  ["table-off-by-one", brokenTableOffByOne, CROSS_SIZE],
  ["no-advance", brokenNoAdvance, CROSS_SIZE],
  ["record-stepped-by-an-entry", brokenRecordStride, CROSS_SIZE],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted comparisons`, { skip }, () => {
    assert.equal(crossCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${CROSS_SIZE}`);
  });
}
