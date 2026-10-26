// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for renderScoreReadouts (ROM 0x4cca) — the score-readout
 * painter that lays the three numeric readouts (label tiles + value digits) into
 * their on-screen display cells, delegating the digit split to unpackScoreDigits.
 *
 * The routine WRITES MEMORY (the label cells, the digit cells, and the shared
 * value-staging slot) and reads no register on entry, so it is gated on
 * MEMORY-equivalence — RAM only. pc and SP are EXCLUDED: the idiomatic layer drops
 * the Z80 pc/register trace, and the oracle's third readout reaches the digit
 * unpacker by falling through so the unpacker's tail return unwinds to the caller —
 * a control-flow shape the stack-free JS deliberately does not reproduce. The oracle
 * also parks one 2-byte return address just below the entry stack pointer (its per-
 * readout call push, popped again immediately); that window is dead scratch the
 * stack-free JS never writes, so the RAM diff excludes exactly [entrySP-2, entrySP)
 * and compares everything else byte-for-byte.
 *
 * Entries: the routine is dispatched ONCE during the cold-boot readout bring-up,
 * with all three records zeroed — that covers the leading-zero-blank arm on every
 * readout but not the full-digit arm, so the value arms are also swept with CRAFTED
 * entries: a real captured state with distinct non-zero record values poked
 * identically on both sides.
 *
 *   0. HARNESS — capture the real boot dispatch and confirm the oracle run is
 *      deterministic (oracle vs oracle -> identical RAM). Proves the plumbing.
 *   1. EQUAL (real dispatch) + NON-VACUOUS — renderScoreReadouts == oracle over RAM
 *      (outside the stack scratch), and the readout cells actually changed vs entry.
 *   2. EQUAL (crafted value sweep) — over record-value sets that hit both the
 *      leading-zero-blank and full-six-digit arms, with distinct values per readout
 *      so a readout mix-up would show, the two agree byte-for-byte.
 *   3. TEETH (skips the third readout) — a twin that renders only two readouts MUST
 *      be caught in the third readout's cells.
 *   4. TEETH (byte-swapped value) — a twin that stages each value high<->low MUST be
 *      caught in the digit cells wherever a value's two bytes differ.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4cca.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4cca as oracle } from "../../translated/loc_4cca.js";
import { renderScoreReadouts as idiomatic } from "../renderScoreReadouts.js";
import { unpackScoreDigits } from "../unpackScoreDigits.js";
import { makeMachineFactory } from "../../machine.js";
import { SCORE_DISPLAY_LOW } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4cca;
const SOURCE_BASE = 0x8039; // first source record (label tiles + 2-byte value)
const SOURCE_STRIDE = 5;
const LABEL_DEST_BASE = 0x8283; // first readout's display cell
const DEST_STRIDE = 9;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Boot the machine, hook 0x4cca, and clone it at its single real dispatch (fires
 * once during the cold-boot readout bring-up). The wrapper snapshots the entry, then
 * runs the oracle so the host boot proceeds undisturbed.
 */
function captureEntry(maxFrames) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  makeMachine(snap).runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the 2 dead stack-scratch
 * bytes the oracle's per-readout call push parks just below the entry stack pointer
 * (the stack-free idiomatic JS never writes them). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 2, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle on one clone and a candidate on another, and return the first
 *  game-visible RAM diff (outside the dead stack window), or null. */
function replayDiff(entry, candidate) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  candidate(c);
  return ramDiffOutsideStack(o, c, sp);
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: the real boot dispatch is captured and the oracle run is deterministic", () => {
  const entry = captureEntry(200);
  assert.ok(entry, "expected 0x4cca to be dispatched during the cold-boot readout bring-up");

  const bad = replayDiff(entry, oracle);
  assert.equal(bad, null, bad && `oracle run not deterministic: diff at ${hx(bad.addr)}`);
  console.log(`  HARNESS: captured a real 0x4cca entry (SP=${hx(entry.regs.sp)}); oracle run deterministic`);
});

// -- 1. EQUAL on the real boot dispatch + NON-VACUOUS ------------------------

test("EQUAL (real dispatch): renderScoreReadouts == oracle over RAM, and it is non-vacuous", () => {
  const entry = captureEntry(200);
  assert.ok(entry, "need a real 0x4cca dispatch");

  const bad = replayDiff(entry, idiomatic);
  assert.equal(bad, null, bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // NON-VACUOUS: the routine actually rewrote the readout cells vs the captured entry
  // (at boot every record value is zero, so this is the label copy + the two trailing
  // blank digit cells appearing where the strip was the blank tile).
  const o = entry.clone();
  oracle(o);
  let changed = 0;
  for (let k = 0; k < DEST_STRIDE * 3; k++) {
    if (o.mem.read8(LABEL_DEST_BASE + k) !== entry.mem.read8(LABEL_DEST_BASE + k)) changed++;
  }
  assert.ok(changed > 0, "expected the readout cells to change from the entry state (non-vacuous)");
  console.log(`  EQUAL/real: RAM byte-identical (outside stack scratch); ${changed} readout cells changed vs entry`);
});

// -- 2. EQUAL across crafted record-value sets -------------------------------

// Distinct label tiles per readout so a readout mix-up shows in the label cells,
// and value triples chosen to hit both digit arms on each readout.
const LABELS = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
const VALUE_SETS = [
  [0x1234, 0x5678, 0x9abc], // all full six digits, all distinct
  [0x0089, 0x0007, 0x0000], // leading-zero-blank arm on every readout (top byte 0)
  [0xffff, 0x0000, 0x1000], // max, all-zero, boundary (top digit exactly non-zero)
  [0x000f, 0xf000, 0x0f0f], // nibble edges across both bytes
];

/** Poke a full set of three records (distinct labels + the given values) into a clone. */
function craft(entry, values) {
  const e = entry.clone();
  for (let r = 0; r < 3; r++) {
    const base = SOURCE_BASE + r * SOURCE_STRIDE;
    e.mem.write8(base + 0, LABELS[r][0]);
    e.mem.write8(base + 1, LABELS[r][1]);
    e.mem.write8(base + 2, LABELS[r][2]);
    e.mem.write16(base + 3, values[r]); // little-endian, matching the staging move
  }
  return e;
}

test("EQUAL (crafted value sweep): distinct-per-readout values on both digit arms are identical", () => {
  const seed = captureEntry(200);
  assert.ok(seed, "need a captured entry to craft from");

  for (const values of VALUE_SETS) {
    const entry = craft(seed, values);
    const bad = replayDiff(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `values=${values.map(hx)}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
  }
  console.log(`  EQUAL/crafted: ${VALUE_SETS.length} distinct record-value sets identical to the oracle`);
});

// -- 3. TEETH: a twin that skips the third readout ---------------------------

/** Broken twin: renders only the first two readouts, leaving the third's cells stale. */
function twinSkipsThird(m) {
  const { mem8, mem16, regs } = m;
  for (let r = 0; r < 2; r++) { // BUG: should be 3
    const source = SOURCE_BASE + r * SOURCE_STRIDE;
    const labelDest = LABEL_DEST_BASE + r * DEST_STRIDE;
    for (let i = 0; i < 3; i++) mem8[labelDest + i] = mem8[source + i];
    mem16[SCORE_DISPLAY_LOW] = mem16[source + 3];
    regs.hl = labelDest + 3;
    unpackScoreDigits(m);
  }
}

test("TEETH (skips third readout): a two-readout twin is CAUGHT, and its third readout is left stale", () => {
  const entry = craft(captureEntry(200), [0x1234, 0x5678, 0x9abc]);
  const bad = replayDiff(entry, twinSkipsThird);
  assert.notEqual(bad, null, "the gate FAILED to catch a twin that skips a readout — it is worthless");

  // Independently confirm the actual effect: the third readout's display cells are
  // left stale by the twin (the first diff the scan reports happens to be the shared
  // value-staging slot the twin also stops re-staging — a real cell, not stack scratch).
  const thirdBase = LABEL_DEST_BASE + 2 * DEST_STRIDE;
  const o = entry.clone(); oracle(o);
  const c = entry.clone(); twinSkipsThird(c);
  let thirdDiffers = false;
  for (let k = 0; k < DEST_STRIDE; k++) {
    if (o.mem.read8(thirdBase + k) !== c.mem.read8(thirdBase + k)) thirdDiffers = true;
  }
  assert.ok(thirdDiffers, "the skip twin should leave the third readout's cells stale");
  console.log(`  TEETH/skip: skipped-readout twin caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b}); third readout left stale`);
});

// -- 4. TEETH: a twin that stages each value byte-swapped --------------------

/** Broken twin: stages each value with its two bytes swapped, so the digits are wrong
 *  wherever a value's high and low bytes differ. */
function twinSwapsValueBytes(m) {
  const { mem8, mem16, regs } = m;
  for (let r = 0; r < 3; r++) {
    const source = SOURCE_BASE + r * SOURCE_STRIDE;
    const labelDest = LABEL_DEST_BASE + r * DEST_STRIDE;
    for (let i = 0; i < 3; i++) mem8[labelDest + i] = mem8[source + i];
    const lo = mem8[source + 3], hi = mem8[source + 4];
    mem16[SCORE_DISPLAY_LOW] = (lo << 8) | hi; // BUG: bytes swapped
    regs.hl = labelDest + 3;
    unpackScoreDigits(m);
  }
}

test("TEETH (byte-swapped value): a value-endianness twin is CAUGHT, and its digit cells diverge", () => {
  const entry = craft(captureEntry(200), [0x1234, 0x5678, 0x9abc]);
  const bad = replayDiff(entry, twinSwapsValueBytes);
  assert.notEqual(bad, null, "the gate FAILED to catch a byte-swapped-value twin — it is worthless");

  // Confirm the swap actually corrupts the rendered digits, not just the shared staging
  // slot the scan reports first: every readout here has distinct value bytes, so all
  // three sets of digit cells differ from the oracle.
  const o = entry.clone(); oracle(o);
  const c = entry.clone(); twinSwapsValueBytes(c);
  let digitCellsDiffer = false;
  for (let r = 0; r < 3; r++) {
    const digitBase = LABEL_DEST_BASE + 3 + r * DEST_STRIDE;
    for (let k = 0; k < 6; k++) {
      if (o.mem.read8(digitBase + k) !== c.mem.read8(digitBase + k)) digitCellsDiffer = true;
    }
  }
  assert.ok(digitCellsDiffer, "the byte-swap should corrupt the rendered digit cells");
  console.log(`  TEETH/swap: byte-swapped-value twin caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b}); digit cells diverge`);
});
