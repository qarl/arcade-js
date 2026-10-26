// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for renderBcdColumn (ROM 0x057c) — the caller-supplied entry into
 * the packed-BCD renderer: a 3-instruction prologue (ex de,hl → HL=source; ld de,0xffe0
 * → -0x20 row stride; ld bc,0x0304 → B=3 bytes) that falls into the shared expansion
 * loop expandBcdDigits (0x0583), painting six digits up a video column.
 *
 * Like expandBcdDigits (0x0583) and storeDigitAndAdvance (0x0593), this routine WRITES
 * MEMORY and loops, so it is gated on memory-equivalence (RAM − the stack scratch below the entry SP + pc + SP
 * + reproduced registers), not a returned scalar, and every case runs on a FRESH clone.
 *
 * GROUNDING — why crafted-entry, and why it is still real. Attract never dispatches
 * 0x057c: its one direct caller, sub_1486's on-board bonus-item VALUE display, runs only
 * when a prize is collected, and the 25m attract demo never collects one (probed: 0
 * dispatches of 0x057c over 15,000 attract frames). But the code sub_057c falls into —
 * the shared loop at 0x0583 — IS reached in attract, rendering the score/high-score/
 * credit columns with real VRAM destinations. So this gate seeds entries from REAL
 * captured machine states at 0x0583 and reconstructs the sub_057c ENTRY that produced
 * each: sub_057c's live-in is DE = source pointer, IX = destination cell, so setting
 * DE := the captured HL (the real source pointer) and keeping IX := the captured IX (the
 * real dest) rebuilds a genuine sub_057c call over real game RAM.
 *
 *   1. EQUAL (real-grounded) — for each real 3-byte 0x0583 capture (the 6-digit score /
 *      high-score renders, IX = 0x7641 / 0x7781, source = 0x60ba / 0x60b4), reconstruct
 *      the sub_057c entry and confirm renderBcdColumn == oracle over the full contract.
 *
 *   2. EQUAL (crafted arms) — arms the real loop states do not vary, each seeded from real
 *      captured RAM with surgical pokes: the exact sub_1486 production source pointer
 *      (DE = 0x01bf), a second real destination (the credit column IX = 0x74bf), and a
 *      writable source with differing nibbles (0x93 / 0x2a / 0xf0) so the high-then-low
 *      nibble swap is observable. Each compared identically on both sides.
 *
 *   3. TEETH — a twin with the WRONG stride magnitude (ld de,-0x10 instead of -0x20) still
 *      climbs the column (every write stays on-map) but lands digits 2..6 at the wrong
 *      cells, so the final IX is start−0x60 not start−0xC0. It MUST be caught on every entry.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so the
 * harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP up
 * with the oracle (which rets internally). The oracle's per-digit push16/call/ret nets to
 * zero on SP and touches only bytes below SP=0x6BFE — inside STACK_SCRATCH, excluded by
 * the standard gate.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-057c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_057c as oracle } from "../../translated/loc_057c.js";
import { loc_0583 as loopOracle } from "../../translated/loc_0583.js";
import { renderBcdColumn } from "../renderBcdColumn.js";
import { expandBcdDigits } from "../expandBcdDigits.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const LOOP = 0x0583; // the shared loop sub_057c falls into — reachable in attract
const TARGET = 0x057c; // sub_057c itself — NOT reached in attract (probed 0 dispatches)
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region excluded by the standard gate. The oracle's internal per-digit
 * push16/pop touches only bytes below SP=0x6BFE, all inside STACK_SCRATCH.
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
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and
 * every register the routine reproduces (A/B/HL/IX/DE). LIVE-OUT is memory-only — the
 * caller reloads A and reads no output register — but the registers are reproduced
 * identically to the oracle and pinned here for extra teeth (the wrong-stride twin is
 * caught via IX as well as via RAM). Returns human-readable mismatches (empty = equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
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
 * Hook the shared loop 0x0583 in a real attract run and clone the machine at up to K real
 * dispatches (0x057c itself is never dispatched in attract). The wrapper snapshots the
 * entry state, then runs the loop oracle so the host game proceeds undisturbed.
 */
function captureLoopStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[LOOP, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return loopOracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return caps;
}

function count057cDispatches(maxFrames) {
  let n = 0;
  const ov = new Map([[TARGET, (mm) => { n++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return n;
}

/**
 * Rebuild a genuine sub_057c entry from a real captured loop state: DE := the captured
 * source pointer (HL), IX := the captured destination cell, SP into STACK_SCRATCH so the
 * oracle's final `ret` pops identical excluded bytes on both sides. The prologue's
 * `ex de,hl` then restores HL := source, so the entry HL/B/C are don't-cares.
 */
function sub057cEntryFrom(loopCap) {
  const e = loopCap.clone();
  e.regs.de = loopCap.regs.hl; // the real source pointer
  e.regs.ix = loopCap.regs.ix; // the real destination cell
  e.regs.sp = 0x6bfe;
  return e;
}

function brokenStrideRender(m) {
  const { regs } = m;
  regs.exDeHl();
  regs.de = 0xfff0; // BUG: -0x10 (half-row step) instead of -0x20 (one full tilemap row)
  regs.bc = 0x0304;
  expandBcdDigits(m);
}

// -- 1. EQUAL (real-grounded) -------------------------------------------------

test("EQUAL (real-grounded): renderBcdColumn == oracle on reconstructed 0x0583 captures", () => {
  const notReached = count057cDispatches(15000);
  assert.equal(notReached, 0, "0x057c was expected NOT to be dispatched in attract — grounding assumption broke");

  const caps = captureLoopStates(64, 6000);
  const threeByte = caps.filter((c) => c.regs.b === 3); // sub_057c is a 3-byte / 6-digit renderer
  assert.ok(threeByte.length >= 1, "expected >=1 real 3-byte 0x0583 dispatch to ground the sub_057c reconstruction");

  for (const cap of threeByte) {
    const entry = sub057cEntryFrom(cap); // FRESH clones inside contractDiffs — entry untouched
    const diffs = contractDiffs(entry, renderBcdColumn);
    assert.equal(diffs.length, 0, `IX=0x${cap.regs.ix.toString(16)} src=0x${cap.regs.hl.toString(16)}: ${diffs.join("; ")}`);
  }
  const seen = new Set(threeByte.map((c) => `IX=0x${c.regs.ix.toString(16)},src=0x${c.regs.hl.toString(16)}`));
  console.log(`  EQUAL/real-grounded: ${threeByte.length} reconstructed dispatches identical (variants: ${[...seen].join(" | ")})`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): production source, source-wrap and differing-nibble arms match the oracle", () => {
  const caps = captureLoopStates(1, 6000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const craft = (mut) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    e.regs.ix = 0x7641; // a real VRAM destination cell
    mut(e);
    return e;
  };

  const cases = [
    // The exact sub_1486 production source pointer (ROM 0x01bf — the digit template).
    { name: "sub_1486 source DE=0x01bf", e: craft((e) => { e.regs.de = 0x01bf; }) },
    { name: "credit-column dest IX=0x74bf", e: craft((e) => { e.regs.ix = 0x74bf; e.regs.de = 0x60ba; }) },
    { name: "differing-nibble source (0x93/0x2a/0xf0)", e: craft((e) => {
        e.mem.write8(0x6100, 0xf0); e.mem.write8(0x6101, 0x2a); e.mem.write8(0x6102, 0x93);
        e.regs.de = 0x6102; // HL walks 0x6102(0x93) -> 0x6101(0x2a) -> 0x6100(0xf0)
      }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, renderBcdColumn);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-stride (down-column) twin is CAUGHT", () => {
  const caps = captureLoopStates(16, 6000);
  const threeByte = caps.filter((c) => c.regs.b === 3);
  assert.ok(threeByte.length >= 1, "need a real 3-byte capture to catch the wrong-stride twin");

  let caughtReal = 0;
  for (const cap of threeByte) {
    if (contractDiffs(sub057cEntryFrom(cap), brokenStrideRender).length > 0) caughtReal++;
  }
  assert.ok(caughtReal >= 1, "the wrong-stride twin escaped detection on every real-grounded entry — the gate is worthless");
  assert.equal(caughtReal, threeByte.length, "the wrong-stride twin must be caught on EVERY entry (it moves IX and cells)");

  // And on the crafted differing-nibble arm, where the wrong cells are guaranteed to differ.
  const seed = caps.find((c) => c.regs.b === 3).clone();
  seed.regs.sp = 0x6bfe;
  seed.regs.ix = 0x7641;
  seed.mem.write8(0x6100, 0xf0); seed.mem.write8(0x6101, 0x2a); seed.mem.write8(0x6102, 0x93);
  seed.regs.de = 0x6102;
  const craftedDiffs = contractDiffs(seed, brokenStrideRender);
  assert.ok(craftedDiffs.length > 0, "the wrong-stride twin escaped detection on the crafted differing-nibble arm");

  console.log(
    `  TEETH: wrong-stride twin caught on ${caughtReal}/${threeByte.length} real-grounded entries ` +
      `and on the crafted arm (${craftedDiffs.join("; ")})`,
  );
});
