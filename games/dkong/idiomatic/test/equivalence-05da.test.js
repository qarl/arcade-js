// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for drawHighScore (ROM 0x05DA) — the shared tail that repaints the
 * high-score readout. It hard-wires the render SOURCE to the high score's most-significant
 * pair (HIGH_SCORE + 2 = 0x60BA) and hands off to the fixed-column packed-BCD renderer
 * (0x0578, renderBcdColumnFixedCell), which forces the destination column (0x7641) and
 * paints the six digits climbing that column. The incoming source register is a don't-care:
 * this routine overwrites it on every entry — that fixed override is the whole point of the
 * routine and the thing this gate has to pin.
 *
 * Because the routine ends by tail-jumping into the renderer (whose shared loop performs the
 * final `ret`), it is gated on MEMORY-EQUIVALENCE — RAM − the stack scratch below the entry SP + pc + SP + the
 * registers it reproduces — not a returned scalar, and every case runs on a FRESH clone. The
 * idiomatic routine models the Z80 `ret` as a plain JS return (no stack modelling), so the
 * harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP up with
 * the oracle. The renderer's per-digit push16/call/ret nets to zero on SP and touches only
 * bytes inside STACK_SCRATCH, excluded by the contract.
 *
 * GROUNDING — attract reaches 0x05DA (the high-score redraw), rendering the machine's default
 * record 7650, so the gate is real-grounded on that captured state. Crafted arms then vary
 * what attract holds fixed: the counter digits, a WRONG incoming source register (proving the
 * fixed 0x60BA override), and a WRONG incoming destination cell (proving the renderer's
 * default fixed-column entry).
 *
 *   1. EQUAL (real) — every real captured 0x05DA dispatch reproduced exactly.
 *   2. EQUAL (crafted) — differing-nibble digits, the 7650 default, an all-9s counter, and
 *      an entry with garbage incoming source/column registers, each seeded from real attract
 *      RAM. Identical on both sides.
 *   3. TEETH — two twins the gate MUST catch:
 *      (a) keeps the caller's stale source register instead of forcing 0x60BA, so it renders
 *          a DIFFERENT counter (the neighbouring score bytes) into the same cells; and
 *      (b) enters the renderer in caller-column mode (enteredAt057C = true), skipping the
 *          fixed 0x7641 store, so it renders into whatever stale destination the caller left.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-05da.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_05da as oracle } from "../../translated/loc_05da.js";
import { drawHighScore } from "../drawHighScore.js";
import { renderBcdColumnFixedCell } from "../renderBcdColumnFixedCell.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, HIGH_SCORE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x05da; // the high-score redraw tail
const HS_MSB = HIGH_SCORE + 2; // 0x60BA — the source pointer this routine forces
const HS_COLUMN = 0x7641; // the fixed base destination cell the renderer forces (video RAM)
// The six digit cells painted: base 0x7641 climbing by -0x20 (one tilemap row) per digit.
const DEST_CELLS = [0x7641, 0x7621, 0x7601, 0x75e1, 0x75c1, 0x75a1];
const SENTINEL = 0xee; // a non-digit tile pre-written to the dest cells to make the paint observable
const SAFE_SP = 0x6bfe; // inside STACK_SCRATCH: the renderer's pushes/pops + the final ret land here
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead stack
 * region the standard gate excludes (the renderer's internal per-digit push16/pop lives there).
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

/**
 * Non-vacuity probe: pre-write the six destination cells to a non-digit SENTINEL on a clone,
 * run the oracle, and confirm every one was overwritten (so the redraw genuinely painted the
 * column — a same-value write over already-correct screen RAM would otherwise hide it).
 */
function paintsColumn(entry) {
  const c = entry.clone();
  for (const cell of DEST_CELLS) c.mem.write8(cell, SENTINEL);
  oracle(c);
  return DEST_CELLS.every((cell) => c.mem.read8(cell) !== SENTINEL);
}

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
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and every
 * register the routine reproduces (A/B/HL/IX/DE). LIVE-OUT is memory-only — the caller reads no
 * output register — but the registers are reproduced identically to the oracle and pinned here
 * for extra teeth. Returns human-readable mismatches (empty = equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  let c;
  try {
    c = runCandidate(entry, fn);
  } catch (e) {
    // A candidate that FAULTS where the oracle succeeds is definitively not memory-equivalent.
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

// -- capture / base -----------------------------------------------------------

function captureTargetStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[TARGET, (mm, ...args) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return caps;
}

function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// A crafted 0x05DA entry: real attract RAM, a safe stack, chosen high-score bytes, and chosen
// GARBAGE incoming source/column registers (both are overwritten by a correct routine, so a
// pass proves the overrides fire).
function craft(base, { hs, srcReg = 0x1234, colReg = 0x7521, extra } = {}) {
  const e = base.clone();
  e.regs.sp = SAFE_SP;
  e.regs.de = srcReg; // incoming source — a correct routine forces HS_MSB over it
  e.regs.ix = colReg; // incoming column — a correct routine forces 0x7641 over it
  if (hs) { e.mem.write8(0x60b8, hs[0]); e.mem.write8(0x60b9, hs[1]); e.mem.write8(0x60ba, hs[2]); }
  if (extra) extra(e);
  return e;
}

// -- broken twins -------------------------------------------------------------

function brokenKeepSource(m) {
  // BUG: the `regs.de = HIGH_SCORE + 2` source override is missing.
  renderBcdColumnFixedCell(m);
}

function brokenCallerColumn(m) {
  const { regs } = m;
  regs.de = HS_MSB; // correct source (HIGH_SCORE + 2)
  renderBcdColumnFixedCell(m, true); // BUG: enteredAt057C = true skips the fixed-column store
}

// -- 1. EQUAL (real) ----------------------------------------------------------

test("EQUAL (real): drawHighScore == oracle on real captured 0x05DA dispatches", () => {
  const caps = captureTargetStates(16, 6000);
  assert.ok(caps.length >= 1, "expected >=1 real 0x05DA dispatch in attract — grounding assumption broke");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, drawHighScore);
    assert.equal(diffs.length, 0, `de=0x${entry.regs.de.toString(16)} ix=0x${entry.regs.ix.toString(16)}: ${diffs.join("; ")}`);
    assert.ok(paintsColumn(entry), "captured 0x05DA dispatch painted no high-score column cell — grounding is vacuous");
  }
  console.log(`  EQUAL/real: ${caps.length} real dispatch(es) identical to the oracle (renders HIGH_SCORE up 0x${HS_COLUMN.toString(16)})`);
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): varied digits + garbage incoming registers all match the oracle", () => {
  const base = attractBase();

  const cases = [
    { name: "differing-nibble digits (0x50/0x76/0x91)", hs: [0x91, 0x76, 0x50] },
    { name: "default record 7650 (0x50/0x76/0x00)", hs: [0x50, 0x76, 0x00] },
    { name: "all-nines counter (0x99/0x99/0x99)", hs: [0x99, 0x99, 0x99] },
    { name: "all-zero counter (0x00/0x00/0x00)", hs: [0x00, 0x00, 0x00] },
    // Garbage incoming source AND column: a correct routine overwrites both, so it must still
    // render HIGH_SCORE up 0x7641 — the override is what makes this a shared tail.
    { name: "garbage incoming DE/IX (0x0000 / 0x7fff)", hs: [0x12, 0x34, 0x56], srcReg: 0x0000, colReg: 0x7fff },
  ];

  for (const { name, hs, srcReg, colReg } of cases) {
    const entry = craft(base, { hs, srcReg, colReg });
    const diffs = contractDiffs(entry, drawHighScore);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    assert.ok(paintsColumn(entry), `${name}: the high-score column was not painted`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the stale-source twin and the caller-column twin are CAUGHT", () => {
  const base = attractBase();

  // (a) Stale-source twin. Distinct bytes at the high score (0x60B8..0x60BA) vs the neighbouring
  //     score bytes (0x60B5..0x60B7); incoming DE points at the neighbour (0x60B7, as the real
  //     dispatch does). The correct routine forces 0x60BA; the twin renders 0x60B7 downward.
  const staleEntry = craft(base, {
    hs: [0x50, 0x76, 0x00], // high score = 7650
    srcReg: 0x60b7,         // stale caller source — the neighbouring counter
    extra: (e) => { e.mem.write8(0x60b5, 0x11); e.mem.write8(0x60b6, 0x22); e.mem.write8(0x60b7, 0x33); },
  });
  assert.equal(contractDiffs(staleEntry, drawHighScore).length, 0, "correct routine diverged on the stale-source entry setup");
  const staleDiffs = contractDiffs(staleEntry, brokenKeepSource);
  assert.ok(staleDiffs.length > 0, "the stale-source twin escaped — the fixed HIGH_SCORE override is unguarded");
  // The divergence is a wrong digit tile somewhere in the high-score column (firstRamDiff reports
  // the lowest-addressed cell, i.e. the top of the column).
  const staleAddr = parseInt(staleDiffs[0].match(/RAM@0x([0-9a-f]+)/)?.[1] ?? "0", 16);
  assert.ok(DEST_CELLS.includes(staleAddr), `expected the stale-source diff in the high-score column ${DEST_CELLS.map((c) => "0x" + c.toString(16))}, got ${staleDiffs[0]}`);

  // (b) Caller-column twin: correct source, but enters in caller-column mode with a WRONG stale
  //     destination cell (0x7521, valid video RAM). It paints there instead of 0x7641.
  const colEntry = craft(base, { hs: [0x91, 0x76, 0x50], srcReg: 0x1234, colReg: 0x7521 });
  assert.equal(contractDiffs(colEntry, drawHighScore).length, 0, "correct routine diverged on the caller-column entry setup");
  const colDiffs = contractDiffs(colEntry, brokenCallerColumn);
  assert.ok(colDiffs.length > 0, "the caller-column twin escaped — the fixed-column entry is unguarded");

  console.log(`  TEETH: stale-source caught (${staleDiffs[0]}); caller-column caught (${colDiffs[0]})`);
});
