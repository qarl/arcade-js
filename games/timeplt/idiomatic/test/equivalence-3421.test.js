// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3421 — memory-equivalent to the frozen oracle at ROM 0x3421.
 *
 * GATE: every dispatch of two real tapes replayed, plus crafted entries over poisoned tilemap
 *   planes. What it exercises, holes stated:
 *
 *   1. CORPUS — every dispatch of the shared coin -> start tape and of undriven attract, each a
 *      whole-state-dump comparison outside the scratch window.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-2, SP): the oracle pushes one
 *      return address for the table lookup it delegates. Every arm asserts nothing escapes it.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to exactly {a, f, sp}. The
 *      accumulator is in that set because the painter this entry hands over to leaves the run's
 *      terminating code there and the rewrite of that painter does not model it; both cursors
 *      the painter leaves ARE reproduced and compared.
 *   4. THE CAPTION LANDS — over poisoned planes, the cells that change are a contiguous run in
 *      each plane, and every colour cell holds the SAME value. Measured off the ORACLE.
 *   5. THE RECORD'S OWN COLOUR IS NOT USED — the record's colour byte is poked to a value the
 *      clock cannot produce; the painted colour must not follow it, and a twin that reads the
 *      record instead must. That is a prediction that could have come out the other way.
 *   6. EXHAUSTIVE over the clock — all 256 values of the cell the colour is derived from, and the
 *      colour actually painted is read back for each, so the phase and the mask are both pinned.
 *   7. TEETH — seven twins, each caught somewhere in the clock sweep.
 *
 * HOLE: which record index the real dispatches present is asserted as a set and is narrow; the
 * crafted arms hold it at whatever the capture had rather than sweeping it, because an arbitrary
 * index walks a record that is not a caption record at all. Nothing here says what the caption
 * says, nor what the counter it takes its colour from is counting.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3421.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3421 } from "../loc_3421.js";
import { loc_3421 as oracle } from "../../translated/loc_3421.js";
import { drawTextRun } from "../drawTextRun.js";
import { fetchWideTableWord } from "../fetchWideTableWord.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";

const TARGET = 0x3421;

const RECORDS = 0x0c50;
const DESTINATION_BYTES = 2;
const STORED_COLOUR_BYTES = 1;
const COLOUR_CLOCK = 0xad0c;
const COLOUR_PHASE = 5;
const COLOUR_MASK = 0x0f;

const COLOUR_PLANE = 0xa000;
const CHARACTER_PLANE = 0xa400;
const PLANE_BYTES = 0x400;
const POISON = 0x5a;

const SCRATCH_BYTES = 2;
const EXCLUDED = ["a", "f", "sp"];

const DISPATCHES = { shared: 18, attract: 11 };
const TAPES = [["shared", {}], ["attract", { tape: [] }]];

/** A colour no four-bit value can be, so a twin reading the record's byte shows up at once. */
const IMPOSSIBLE_COLOUR = 0x77;

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

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  corpusCache = TAPES.map(([label, opts]) => {
    const states = [];
    const indices = new Set();
    const clocks = new Set();
    const host = makeMachine(
      new Map([[TARGET, (mm) => {
        states.push(mm.clone());
        indices.add(mm.regs.a);
        clocks.add(mm.mem8[COLOUR_CLOCK]);
        return oracle(mm);
      }]]),
      opts,
    );
    const frames = host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the ${label} session stopped early: ${host.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, `the ${label} session ran short`);
    assert.equal(states.length, DISPATCHES[label], `the ${label} dispatch count moved`);
    return { label, states, indices, clocks };
  });
  return corpusCache;
}

const anEntry = () => corpus()[0].states[0];

/** The record this entry's captured index selects — the same arithmetic the routine uses. */
function selectedRecord(m) {
  return m.mem16[u16(RECORDS + 2 * m.regs.a)];
}

/** A real captured machine with both planes poisoned and the clock forced. */
function craft(clock) {
  const m = anEntry().clone();
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) m.mem8[a] = POISON;
  m.mem8[COLOUR_CLOCK] = clock;
  return m;
}

/** Every plane cell the ORACLE moves off the marker, and what it left there. */
function oracleWriteSet(machine) {
  const m = machine.clone();
  oracle(m);
  const glyphs = [];
  const colours = [];
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) {
    if (m.mem8[a] === POISON) continue;
    (a >= CHARACTER_PLANE ? glyphs : colours).push(a);
  }
  return { glyphs, colours, read: (a) => m.mem8[a] };
}

function sweepCaught(candidate) {
  let caught = 0;
  for (let clock = 0; clock < 256; clock++) if (unitDiff(candidate, craft(clock))) caught++;
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of corpus()) {
    assert.ok(s.states.length > 0, `vacuous: the ${s.label} tape never reached the routine`);
    for (const state of s.states) {
      const d = unitDiff(loc_3421, state);
      assert.equal(d, null, `${s.label}: ${show(d)}`);
    }
    total += s.states.length;
  }
  const indices = [...new Set(corpus().flatMap((s) => [...s.indices]))].sort((x, y) => x - y);
  const clocks = new Set(corpus().flatMap((s) => [...s.clocks]));
  console.log(
    `  CORPUS: ${total} real dispatches, identical on each; record indices {${indices}}, ` +
      `${clocks.size} distinct clock values`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(0));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on a register");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: the accumulator, the flag byte, sp, pc and one push", { skip }, () => {
  const entry = craft(0);
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_3421(b);
  assert.deepEqual(REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]), EXCLUDED,
    "the excluded register set changed shape");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.deepEqual(allDiffs(a, b).filter((d) => !inScratch(d.addr, sp)), [],
    "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}, pc, and [SP-${SCRATCH_BYTES}, SP)`);
});

test("THE CAPTION LANDS: a run in each plane, and one colour across the whole of it", { skip }, () => {
  const entry = craft(0);
  const { glyphs, colours, read } = oracleWriteSet(entry);
  assert.ok(glyphs.length > 1, "no character run was painted: this gate has no teeth");
  assert.equal(colours.length, glyphs.length, "the two planes were not painted cell for cell");
  const laid = new Set(colours.map(read));
  assert.equal(laid.size, 1, `the caption was painted in ${laid.size} colours, not one`);
  assert.ok(colours.every((a) => glyphs.includes(a + PLANE_BYTES)),
    "a colour cell has no twin in the character plane");
  console.log(
    `  LANDS: ${glyphs.length} character cells from ${hex4(glyphs[0])}, all coloured ${[...laid]}`,
  );
});

test("THE RECORD'S OWN COLOUR IS NOT USED: poking it changes nothing", { skip }, () => {
  const entry = craft(0);
  const record = selectedRecord(entry);
  const storedColour = record + DESTINATION_BYTES;

  const image = entry.mem.rom;
  const was = image[storedColour];
  image[storedColour] = IMPOSSIBLE_COLOUR;
  try {
    const painted = new Set(oracleWriteSet(entry).colours.map(oracleWriteSet(entry).read));
    assert.ok(!painted.has(IMPOSSIBLE_COLOUR),
      "the caption was painted in the record's own colour byte, so this entry does NOT cycle and " +
        "the rewrite's colour arithmetic is describing something that does not happen");
    assert.equal(unitDiff(loc_3421, entry), null, "the rewrite diverged under the poke");
    assert.ok(sweepCaught(brokenUsesStoredColour) > 0, "the poked twin was not caught either");
  } finally {
    image[storedColour] = was;
  }
  console.log(`  STORED COLOUR: poked to ${hex4(IMPOSSIBLE_COLOUR)} at ${hex4(storedColour)}, unused`);
});

test("EXHAUSTIVE over the clock: 256 values, with the painted colour read back", { skip }, () => {
  for (let clock = 0; clock < 256; clock++) {
    const d = unitDiff(loc_3421, craft(clock));
    assert.equal(d, null, `clock=${clock}: ${show(d)}`);
    const { colours, read } = oracleWriteSet(craft(clock));
    assert.equal(read(colours[0]), (clock + COLOUR_PHASE) & COLOUR_MASK,
      `clock=${clock}: the painted colour is not the clock shifted and masked as this file says`);
  }
  console.log("  EXHAUSTIVE: 256 clock values identical, and the colour tracks each of them");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** The shared tail every twin below reaches: paint the record's run in a chosen colour. */
function paint(m, record, colour, glyphsAt) {
  const { mem16, regs } = m;
  regs.de = mem16[record];
  regs.hl = glyphsAt;
  regs.c = colour;
  drawTextRun(m);
}

function recordOf(m) {
  m.regs.hl = RECORDS;
  fetchWideTableWord(m);
  return m.regs.de;
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: uses the colour byte sitting in the record instead of the one derived from the clock. */
function brokenUsesStoredColour(m) {
  const record = recordOf(m);
  paint(m, record, m.mem8[record + DESTINATION_BYTES],
    u16(record + DESTINATION_BYTES + STORED_COLOUR_BYTES));
}

/** BUG: takes the clock straight, with no phase shift, so the cycle is out of step. */
function brokenNoPhase(m) {
  const record = recordOf(m);
  paint(m, record, m.mem8[COLOUR_CLOCK] & COLOUR_MASK,
    u16(record + DESTINATION_BYTES + STORED_COLOUR_BYTES));
}

/** BUG: no mask, so the whole byte goes out as a colour. */
function brokenNoMask(m) {
  const record = recordOf(m);
  paint(m, record, m.mem8[COLOUR_CLOCK] + COLOUR_PHASE,
    u16(record + DESTINATION_BYTES + STORED_COLOUR_BYTES));
}

/** BUG: starts the glyph run on the record's colour byte instead of past it. */
function brokenGlyphsOffByOne(m) {
  const record = recordOf(m);
  paint(m, record, (m.mem8[COLOUR_CLOCK] + COLOUR_PHASE) & COLOUR_MASK,
    u16(record + DESTINATION_BYTES));
}

/** BUG: starts the caption one cell along the line from where the record puts it. */
function brokenDestination(m) {
  const { mem16, regs } = m;
  const record = recordOf(m);
  regs.de = u16(mem16[record] + 1);
  regs.hl = u16(record + DESTINATION_BYTES + STORED_COLOUR_BYTES);
  regs.c = (m.mem8[COLOUR_CLOCK] + COLOUR_PHASE) & COLOUR_MASK;
  drawTextRun(m);
}

/** BUG: selects the record one entry along the table. */
function brokenRecordIndex(m) {
  const { regs } = m;
  regs.a = regs.a + 1;
  const record = recordOf(m);
  paint(m, record, (m.mem8[COLOUR_CLOCK] + COLOUR_PHASE) & COLOUR_MASK,
    u16(record + DESTINATION_BYTES + STORED_COLOUR_BYTES));
}

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["uses-the-stored-colour", brokenUsesStoredColour],
  ["no-phase-shift", brokenNoPhase],
  ["no-mask", brokenNoMask],
  ["glyphs-off-by-one", brokenGlyphsOffByOne],
  ["wrong-destination", brokenDestination],
  ["record-index-off-by-one", brokenRecordIndex],
]) {
  test(`TEETH: the ${label} twin is CAUGHT in the clock sweep`, { skip }, () => {
    const caught = sweepCaught(twin);
    assert.ok(caught > 0, `the sweep PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught on ${caught} of 256 clock values`);
  });
}
