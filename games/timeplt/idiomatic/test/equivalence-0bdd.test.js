// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0bdd — memory-equivalent to the frozen oracle at ROM 0x0BDD.
 *
 * GATE: crafted-entry, and the craft is a NUDGE ON A REAL STATE. 0x0BDD is word 0 of the command
 *   ring's handler table at 0x0BBC, and no poster in the image puts command 0 on the ring, so no
 *   shipped tape dispatches it. The craft rewrites command 1 to command 0 as each post enters the
 *   ring (the poster at 0x0038), leaving the argument alone: the drain loop then hands this handler
 *   the very caption numbers the game asks drawTextRunByIndex to paint, from a coherent machine.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — every crafted dispatch of two sessions, oracle against rewrite on clones of the
 *      same machine, identical outside a two-byte dead scratch window below the entry stack
 *      pointer. Counts are measured and asserted.
 *   2. NEITHER SHIPPED TAPE REACHES IT UNNUDGED, asserted, so the craft is justified by a check.
 *   3. NOT VACUOUS — a candidate that does nothing is caught on a character-plane cell.
 *   4. IT PAINTS THE RECORD — the oracle's writes are exactly the record's glyph run, one cell per
 *      glyph stepping 32 bytes back from the record's start cell, character plane only. This is
 *      the predicate a MAME tap held on all 32 caption records with command 0 injected into the
 *      ring, so the oracle is pinned to the hardware, not only the rewrite to the oracle.
 *   5. RECORD NUMBER — every number the table can be indexed by whose record names a destination in
 *      the character plane; the rest are skipped and COUNTED.
 *   6. RUN LENGTH — the terminating code moved along the run, empty run included.
 *   7. REGISTERS — only the declared excluded set may diverge; the drain loop reloads every one.
 *   8. TEETH — seven twins, each caught on its own exact count.
 *
 * HOLE: the stack. The rewrite models no return, so it is never wired into a crafted live run in
 * place of the oracle here; arm 7 pins sp in the excluded set.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0bdd.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_0bdd } from "../loc_0bdd.js";
import { loc_0bdd as oracle } from "../../translated/loc_0bdd.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { fetchWideTableWord } from "../fetchWideTableWord.js";
import { u16 } from "../../../../core/int.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { buildRoutines } from "../../routines.js";

const TARGET = 0x0bdd;
const POSTER = 0x0038;
const NUDGED_FROM = 1;
const NUDGED_TO = 0;

const RECORD_TABLE = 0x0c50;
const RUN_STARTS_AT = 3;
const END_OF_TEXT = 185;
const BLANK = 241;
const COLOUR_PLANE = 0xa000;
const CHARACTER_PLANE = 0xa400;
const CHARACTER_PLANE_END = 0xa7ff;

const SCRATCH_BYTES = 2;

/** Registers the rewrite may leave diverged: the drain loop reloads all of these before reading. */
const EXCLUDED = ["a", "f", "h", "l", "sp"];

/** Crafted dispatches each session produces. Measured; a move here is a finding, not a nuisance. */
const CRAFTED = { attract: 528, "coin-start": 226 };

const TAPES = [
  ["attract", { tape: [] }],
  ["coin-start", {}],
];

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical");
const inPlane = (a) => a >= CHARACTER_PLANE && a <= CHARACTER_PLANE_END;

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function outsideScratch(a, b, sp) {
  return allDiffs(a, b).filter((d) => d.addr < sp - SCRATCH_BYTES || d.addr >= sp);
}

function compare(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return outsideScratch(a, b, sp)[0] ?? null;
}

/** One session with command 1 posts rewritten to command 0; every dispatch compared. */
function replaySession(opts, candidate, { nudge = true } = {}) {
  const base = buildRoutines();
  const poster = base.get(POSTER);
  const overrides = new Map();
  if (nudge) {
    overrides.set(POSTER, (mm) => {
      const command = mm.regs.d;
      if (command === NUDGED_FROM) mm.regs.d = NUDGED_TO;
      const r = poster(mm);
      mm.regs.d = command;
      return r;
    });
  }
  let dispatches = 0;
  let caught = 0;
  let entry = null;
  const records = new Set();
  overrides.set(TARGET, (mm) => {
    dispatches++;
    records.add(mm.regs.a);
    if (entry === null) entry = mm.clone();
    if (compare(candidate, mm)) caught++;
    return oracle(mm);
  });
  const m = makeMachine(overrides, opts);
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "session ran short");
  return { dispatches, caught, entry, records };
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_0bdd) }));
  return cache;
}

const entryState = () => sessions()[0].entry;

/** The record the captured entry is handed, its start cell, and where its run starts. */
function realRecord() {
  const entry = entryState();
  const record = entry.mem16[RECORD_TABLE + 2 * entry.regs.a];
  return { record, start: entry.mem16[record], runStart: u16(record + RUN_STARTS_AT) };
}

function withPokedImage(m, addr, value, body) {
  const image = m.mem.rom;
  const was = image[addr];
  image[addr] = value;
  try {
    return body();
  } finally {
    image[addr] = was;
  }
}

function naturalLength() {
  const { runStart } = realRecord();
  const image = entryState().mem.rom;
  let n = 0;
  while (image[runStart + n] !== END_OF_TEXT) n++;
  return n;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: every crafted dispatch of two sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reached the routine`);
    assert.equal(s.dispatches, CRAFTED[s.label], `the ${s.label} crafted dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  const records = new Set(sessions().flatMap((s) => [...s.records]));
  console.log(`  CORPUS: ${total} crafted dispatches identical; caption numbers ${[...records].join(",")}`);
});

test("UNNUDGED, NEITHER SHIPPED TAPE REACHES IT: the craft is what buys the entry", { skip }, () => {
  for (const [label, opts] of TAPES) {
    const r = replaySession(opts, loc_0bdd, { nudge: false });
    assert.equal(r.dispatches, 0, `the ${label} tape now dispatches command 0 on its own`);
  }
  console.log("  UNNUDGED: both shipped tapes dispatch it 0 times in the entry budget");
});

test("NOT VACUOUS: a candidate that does nothing is caught on a character-plane cell", { skip }, () => {
  const d = compare(() => {}, entryState());
  assert.notEqual(d, null, "the masked diff passed a no-op, so memory is NOT the gate here");
  assert.ok(inPlane(d.addr), `the no-op is caught at ${hex4(d.addr)}, outside the plane written`);
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("IT PAINTS THE RECORD: the glyph run, one cell a glyph, character plane only", { skip }, () => {
  let checked = 0;
  for (let number = 0; number < 256; number++) {
    const before = entryState().clone();
    const record = before.mem16[RECORD_TABLE + 2 * number];
    const start = before.mem16[record];
    if (!inPlane(start)) continue;
    const expected = new Map();
    for (let i = 0, p = u16(record + RUN_STARTS_AT); before.mem8[p] !== END_OF_TEXT; i++, p = u16(p + 1)) {
      expected.set(u16(start - 32 * i), before.mem8[p]);
    }
    before.regs.a = number;
    const after = before.clone();
    oracle(after);
    const sp = before.regs.sp;
    for (const d of outsideScratch(before, after, sp)) {
      assert.ok(inPlane(d.addr), `record ${number}: wrote outside the character plane at ${hex4(d.addr)}`);
      assert.equal(d.b, expected.get(d.addr), `record ${number}: ${hex4(d.addr)} is not that record's glyph`);
    }
    for (const [addr, glyph] of expected) {
      assert.equal(after.mem8[addr], glyph, `record ${number}: ${hex4(addr)} does not hold its glyph`);
    }
    checked++;
  }
  assert.ok(checked > 1, "vacuous: fewer than two records checked");
  console.log(`  PAINTS: ${checked} records, each exactly its glyph run and no colour cell`);
});

test("RECORD NUMBER: every entry of the table whose record lies in the character plane", { skip }, () => {
  const entry = entryState();
  let swept = 0;
  let skipped = 0;
  for (let number = 0; number < 256; number++) {
    const record = entry.mem16[RECORD_TABLE + 2 * number];
    if (!inPlane(entry.mem16[record])) {
      skipped++;
      continue;
    }
    const machine = entry.clone();
    machine.regs.a = number;
    const d = compare(loc_0bdd, machine);
    assert.equal(d, null, `record number ${number}: ${show(d)}`);
    swept++;
  }
  assert.ok(swept > 1, "only one record number was sweepable, so this arm discriminates nothing");
  console.log(`  RECORD NUMBER: ${swept} records swept, ${skipped} skipped as out of the plane`);
});

test("RUN LENGTH: the terminating code moved along the run, empty run included", { skip }, () => {
  const { runStart } = realRecord();
  const natural = naturalLength();
  for (let length = 0; length <= natural; length++) {
    withPokedImage(entryState(), runStart + length, END_OF_TEXT, () => {
      const d = compare(loc_0bdd, entryState());
      assert.equal(d, null, `run length ${length}: ${show(d)}`);
    });
  }
  console.log(`  RUN LENGTH: lengths 0..${natural} identical`);
});

test("REGISTERS: only the declared excluded set diverges", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_0bdd(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(moved.filter((k) => !EXCLUDED.includes(k)), [], `diverged: ${moved.join(",")}`);
  console.log(`  REGISTERS: diverged ${moved.join(",") || "none"}, all excluded`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** Shared walk for the twins: `store(m, cell, glyph)` paints, `step` moves the cursor. */
function walk(m, caption, { from = RUN_STARTS_AT, store, step = (c) => advanceCharCursor(m, c), last = false }) {
  const record = fetchWideTableWord(m, RECORD_TABLE, caption);
  let cursor = m.mem16[record];
  let next = u16(record + from);
  for (;;) {
    const glyph = m.mem8[next];
    const done = glyph === END_OF_TEXT;
    if (done && !last) break;
    store(m, cursor, glyph);
    next = u16(next + 1);
    cursor = step(cursor);
    if (done) break;
  }
}

const paint = (m, cell, glyph) => { m.mem8[cell] = glyph; };

const TWINS = [
  ["no-op", () => {}, 9],
  ["writes-the-blank", (m, c = m.regs.a) => walk(m, c, { store: (mm, cell) => { mm.mem8[cell] = BLANK; } }), 9],
  ["also-writes-colour", (m, c = m.regs.a) => walk(m, c, {
    store: (mm, cell, glyph) => { mm.mem8[cell] = glyph; mm.mem8[cell - CHARACTER_PLANE + COLOUR_PLANE] ^= 1; },
  }), 9],
  ["includes-the-colour-byte", (m, c = m.regs.a) => walk(m, c, { from: RUN_STARTS_AT - 1, store: paint }), 10],
  ["cursor-stuck", (m, c = m.regs.a) => walk(m, c, { store: paint, step: (cur) => cur }), 8],
  ["cursor-backwards", (m, c = m.regs.a) => walk(m, c, { store: paint, step: (cur) => u16(cur + 32) }), 8],
  ["writes-the-terminator", (m, c = m.regs.a) => walk(m, c, { store: paint, last: true }), 10],
];

/** Every state a twin is judged on: the real entry, and the run-length pokes over it. */
function twinCaught(candidate) {
  const { runStart } = realRecord();
  const natural = naturalLength();
  let caught = 0;
  if (compare(candidate, entryState())) caught++;
  for (let length = 0; length <= natural; length++) {
    withPokedImage(entryState(), runStart + length, END_OF_TEXT, () => {
      if (compare(candidate, entryState())) caught++;
    });
  }
  return caught;
}

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count`, { skip }, () => {
    assert.equal(twinCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} judged states`);
  });
}
