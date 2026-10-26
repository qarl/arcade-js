// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_056b (ROM 0x056B) — pick one of two destination video
 * columns from a zero/nonzero selector, then render a 3-byte packed-BCD counter up
 * that column. The routine sets IX = 0x7781 (selector zero) or 0x7521 (selector
 * nonzero) and joins the shared renderer at its caller-supplied-column entry (0x057C):
 * ex de,hl -> source; ld de,0xffe0 -> -0x20 row stride; ld bc,0x0304 -> B=3 bytes; then
 * the expansion loop paints six digits climbing the chosen column.
 *
 * Like the renderer it tails into (renderBcdColumn 0x057c, renderBcdColumnFixedCell
 * 0x0578, expandBcdDigits 0x0583, storeDigitAndAdvance 0x0593), this routine WRITES
 * MEMORY and loops, so it is gated on memory-equivalence (RAM - the stack scratch below the entry SP + pc +
 * SP + reproduced registers), not a returned scalar, and every case runs on a FRESH
 * clone.
 *
 * The oracle draw_056b tail-calls draw_0578(true) -> loop_0583, whose final `ret` pops
 * the caller-return and is the ONE net stack change on every path; the per-digit
 * push16/call/ret pairs cancel and touch only bytes inside STACK_SCRATCH. The idiomatic
 * routine models no stack (a plain JS return + a direct renderBcdColumn call), so the
 * harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP up
 * with the oracle.
 *
 * GROUNDING — attract dispatches 0x056B (the demo racks up score, which drives
 * entry_051c -> 0x056b), so real captured dispatches ground the gate. Crafted entries
 * then pin what the real states may not vary:
 *   1. EQUAL (real) — every real captured 0x056B dispatch reproduced exactly.
 *   2. EQUAL (crafted) — BOTH selector arms forced (zero -> 0x7781, nonzero -> 0x7521)
 *      over a differing-nibble source so the high-then-low digit swap is observable,
 *      each seeded from real captured RAM, identical on both sides.
 *   3. TEETH — two twins the gate MUST catch: (a) one that SWAPS the two columns (zero
 *      -> 0x7521, nonzero -> 0x7781), caught wherever the selector decides the column;
 *      (b) one with the WRONG zero-arm column constant (0x7761 instead of 0x7781),
 *      caught on a selector-zero entry.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-056b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_056b as oracle } from "../../translated/loc_056b.js";
import { loc_056b } from "../loc_056b.js";
import { renderBcdColumn } from "../renderBcdColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x056b; // the column-selecting BCD renderer front end
const COLUMN_IF_ZERO = 0x7781;    // destination column the oracle picks when the selector is zero
const COLUMN_IF_NONZERO = 0x7521; // destination column the oracle picks when the selector is nonzero
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region the standard gate excludes. The oracle's per-digit push16/pop touch
 * only bytes inside it.
 */
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

/** Run the ORACLE on a fresh clone. Its shared loop performs the final `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM - the stack scratch below the entry SP, pc, SP, and
 * every register the routine reproduces (A/B/HL/IX/DE). LIVE-OUT is memory-only — the
 * caller reads no output register — but the registers are reproduced identically to the
 * oracle and pinned here for extra teeth (the twins are caught via IX as well as RAM).
 * Returns human-readable mismatches (empty = equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  let c;
  try {
    c = runCandidate(entry, fn);
  } catch (e) {
    // A candidate that FAULTS where the oracle succeeds (an off-map write to a stale
    // destination, say) is definitively not memory-equivalent — fail loudly.
    return [`candidate threw: ${e.message}`];
  }
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`);
  if (o.regs.hl !== c.regs.hl) diffs.push(`HL oracle=0x${o.regs.hl.toString(16)} cand=0x${c.regs.hl.toString(16)}`);
  if (o.regs.ix !== c.regs.ix) diffs.push(`IX oracle=0x${o.regs.ix.toString(16)} cand=0x${c.regs.ix.toString(16)}`);
  if (o.regs.de !== c.regs.de) diffs.push(`DE oracle=0x${o.regs.de.toString(16)} cand=0x${c.regs.de.toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook the target 0x056B in a real attract run and clone the machine at up to K real
 * dispatches. The wrapper snapshots the entry state, then runs the oracle so the host
 * game proceeds. The host is local, so it (and its per-frame buffer) is released when
 * this returns.
 */
function captureTargetStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return caps;
}

/** The destination column the oracle establishes for a given entry's selector (A). */
function expectedColumn(entry) {
  return entry.regs.a === 0 ? COLUMN_IF_ZERO : COLUMN_IF_NONZERO;
}

// -- broken twins -------------------------------------------------------------

/**
 * Broken twin (a): SWAPS the two columns — selector zero picks the nonzero column and
 * vice versa. Renders the digits into the wrong column whenever the selector decides it;
 * caught via RAM (wrong cells) and IX.
 */
function brokenSwappedColumns(m) {
  const { regs } = m;
  regs.ix = regs.a === 0 ? COLUMN_IF_NONZERO : COLUMN_IF_ZERO; // BUG: columns swapped
  renderBcdColumn(m);
}

/**
 * Broken twin (b): WRONG zero-arm column constant — 0x7761 (one tilemap row off) instead
 * of 0x7781. Renders the selector-zero case into a column shifted by a row; caught via
 * RAM and IX on a selector-zero entry.
 */
function brokenZeroColumn(m) {
  const { regs } = m;
  regs.ix = regs.a === 0 ? 0x7761 : COLUMN_IF_NONZERO; // BUG: wrong zero-arm column
  renderBcdColumn(m);
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x056B is dispatched during boot/attract", () => {
  let count = 0;
  const ov = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(6000);
  assert.ok(count > 0, "0x056B should be dispatched — the attract demo scores, driving entry_051c -> 0x056b");
  console.log(`  REACHABILITY: ${count} natural 0x056B dispatches in 6000 frames`);
});

// -- 2. EQUAL (real) ----------------------------------------------------------

test("EQUAL (real): loc_056b == oracle on every real captured 0x056B dispatch", () => {
  const caps = captureTargetStates(64, 6000);
  assert.ok(caps.length >= 1, "expected >=1 real 0x056B dispatch in attract — grounding assumption broke");

  let zero = 0, nonzero = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_056b);
    assert.equal(
      diffs.length,
      0,
      `a=${hx(entry.regs.a)} de=0x${entry.regs.de.toString(16)}: ${diffs.join("; ")}`,
    );
    assert.equal(
      runOracle(entry).regs.ix,
      (expectedColumn(entry) - 0xc0) & 0xffff, // six -0x20 steps advance IX by 0xC0 past the base
      `selector ${hx(entry.regs.a)}: oracle did not render up the expected column`,
    );
    if (entry.regs.a === 0) zero++; else nonzero++;
  }
  console.log(`  EQUAL/real: ${caps.length} real dispatches identical (selector zero=${zero}, nonzero=${nonzero})`);
});

// -- 3. EQUAL (crafted, both selector arms) -----------------------------------

test("EQUAL (crafted): both selector arms match the oracle over a differing-nibble source", () => {
  const seed = captureTargetStates(1, 6000)[0];
  assert.ok(seed, "need one real capture to seed crafted entries with real RAM");

  // Seed from a real dispatch, put SP into STACK_SCRATCH so the oracle's final `ret`
  // pops identical excluded bytes on both sides, and lay down a differing-nibble source
  // (HL walks 0x6102 -> 0x6101 -> 0x6100 so all six digits differ).
  const craft = (selector) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    e.regs.a = selector;
    e.mem.write8(0x6100, 0xf0);
    e.mem.write8(0x6101, 0x2a);
    e.mem.write8(0x6102, 0x93);
    e.regs.de = 0x6102;
    return e;
  };

  const cases = [
    { name: "selector zero -> column 0x7781", selector: 0x00, column: COLUMN_IF_ZERO },
    { name: "selector one -> column 0x7521", selector: 0x01, column: COLUMN_IF_NONZERO },
    { name: "selector 0xff -> column 0x7521", selector: 0xff, column: COLUMN_IF_NONZERO },
  ];

  for (const { name, selector, column } of cases) {
    const entry = craft(selector);
    const diffs = contractDiffs(entry, loc_056b);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Confirm the oracle really rendered up the intended column (non-vacuity): the base
    // cell holds the high nibble of the top source byte (0x93 -> 0x9).
    assert.equal(runOracle(entry).mem.read8(column), 0x09, `${name}: base digit not written to the expected column`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (selector zero + two nonzero) identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the swapped-columns twin and the wrong-zero-column twin are CAUGHT", () => {
  const seed = captureTargetStates(1, 6000)[0];
  assert.ok(seed, "need one real capture to seed the teeth entries");

  const craft = (selector) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    e.regs.a = selector;
    e.mem.write8(0x6100, 0xf0);
    e.mem.write8(0x6101, 0x2a);
    e.mem.write8(0x6102, 0x93);
    e.regs.de = 0x6102;
    return e;
  };

  const zeroEntry = craft(0x00);
  const nonzeroEntry = craft(0x01);

  // (a) swapped-columns: on the selector-zero entry the oracle renders up 0x7781 while
  //     the twin renders up 0x7521, and vice versa on the nonzero entry — caught on both.
  const swapZero = contractDiffs(zeroEntry, brokenSwappedColumns);
  const swapNonzero = contractDiffs(nonzeroEntry, brokenSwappedColumns);
  assert.ok(swapZero.length > 0, "the swapped-columns twin escaped on the selector-zero entry — the gate is worthless");
  assert.ok(swapNonzero.length > 0, "the swapped-columns twin escaped on the selector-nonzero entry — the gate is worthless");

  // (b) wrong zero-arm column: the twin renders the selector-zero case up 0x7761 (a row
  //     off) instead of 0x7781 — caught on the selector-zero entry. On the nonzero entry
  //     it agrees with the oracle (both use 0x7521), which pins the catch to the zero arm.
  const zcolZero = contractDiffs(zeroEntry, brokenZeroColumn);
  const zcolNonzero = contractDiffs(nonzeroEntry, brokenZeroColumn);
  assert.ok(zcolZero.length > 0, "the wrong-zero-column twin escaped on the selector-zero entry — the zero-arm constant is unguarded");
  assert.equal(zcolNonzero.length, 0, "the wrong-zero-column twin should agree with the oracle on the nonzero arm (only the zero arm differs)");

  console.log(
    `  TEETH: swapped-columns caught (zero: ${swapZero[0]} | nonzero: ${swapNonzero[0]}); ` +
      `wrong-zero-column caught on the zero arm (${zcolZero[0]})`,
  );
});
