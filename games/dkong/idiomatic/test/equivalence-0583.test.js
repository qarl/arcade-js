// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for expandBcdDigits (ROM 0x0583) — the packed-BCD digit-expansion
 * loop: for each of B source bytes, emit the HIGH nibble then the LOW nibble through
 * storeDigitAndAdvance (0x0593), walking the source pointer HL backwards.
 *
 * Like storeDigitAndAdvance (0x0593) and unlike the pure-leaf exemplar (0x2333), this
 * routine WRITES MEMORY and loops, so it is gated on memory-equivalence (not a returned
 * scalar) and every case runs on a FRESH clone (a reused clone is only safe for a
 * read-only leaf):
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0583 in a real attract run and clone
 *      the machine at each true dispatch. Attract reaches BOTH entry paths: draw_0578's
 *      score column (IX=0x7641/0x7781, DE=0xFFE0, B=3) and sub_0616's one-byte value
 *      (HL=0x6001, IX=0x74BF, B=1). For each capture, run the ORACLE on one clone and
 *      expandBcdDigits on another and confirm identical RAM (minus the stack scratch below the entry SP) + pc +
 *      SP + declared live-out (A, B, HL, IX, DE).
 *
 *   2. EQUAL (crafted arms) — the counts/wraps attract never varies, seeded from real
 *      captured RAM with surgical pokes: B=2 and a larger B=5 (loop-count breadth), an
 *      HL dec-underflow (0x0000 -> 0xFFFF), and a source byte whose two nibbles differ
 *      (proving the high/low order and the nibble swap). Each compared identically on
 *      both sides.
 *
 *   3. TEETH (real + crafted) — a twin that stores the LOW nibble where the HIGH digit
 *      belongs (skips the nibble swap) MUST be caught: it writes the wrong cell whenever
 *      a source byte's two nibbles differ (which real score bytes and the crafted arm
 *      guarantee).
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so the
 * harness performs one m.ret() on the candidate clone AFTER the call to line pc + SP up
 * with the oracle (which rets internally). The oracle's per-digit call also pushes/pops,
 * but SP sits at 0x6BFE (inside STACK_SCRATCH) so those transient stack bytes are excluded
 * by the standard gate.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0583.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0583 as oracle } from "../../translated/loc_0583.js";
import { expandBcdDigits } from "../expandBcdDigits.js";
import { storeDigitAndAdvance } from "../storeDigitAndAdvance.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0583;
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
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
 * declared live-out A/B/HL/IX/DE. Returns human-readable mismatches (empty when equal).
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
 * Hook 0x0583 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Both call sites (draw_0578 fall-in, sub_0616 tail-jump) resolve here.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/**
 * Broken twin: stores the LOW nibble where the HIGH digit belongs (drops the nibble
 * swap), so the first cell of every byte holds the wrong digit whenever the byte's two
 * nibbles differ.
 */
function brokenExpand(m) {
  const { regs, mem } = m;
  do {
    regs.a = mem.read8(regs.hl); // BUG: no nibble swap — low nibble stored as the "high" cell
    storeDigitAndAdvance(m);
    regs.a = mem.read8(regs.hl);
    storeDigitAndAdvance(m);
    regs.hl = (regs.hl - 1) & 0xffff;
    regs.b = (regs.b - 1) & 0xff;
  } while (regs.b !== 0);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): expandBcdDigits == oracle on every captured 0x0583 entry", () => {
  const caps = captureDispatches(64, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0583 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, expandBcdDigits); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const seen = new Set(caps.map((c) => `IX=0x${c.regs.ix.toString(16)},B=${c.regs.b}`));
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical (variants: ${[...seen].join(" | ")})`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): loop-count and wrap edges match the oracle", () => {
  const caps = captureDispatches(1, 2000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Each craft: real captured RAM, surgical pokes, a safe stack pointer so the oracle's
  // final `ret` pops harmless (STACK_SCRATCH, excluded) bytes identically on both sides.
  // Optionally poke the source byte at HL so the nibble swap is observable.
  const craft = (mut) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe;
    mut(e);
    return e;
  };

  const cases = [
    { name: "B=2 (two source bytes)", e: craft((e) => { e.regs.b = 2; }) },
    { name: "B=5 (larger count)",     e: craft((e) => { e.regs.b = 5; }) },
    { name: "HL dec-underflow",       e: craft((e) => { e.regs.hl = 0x0000; e.regs.b = 1; }) },
    { name: "differing-nibble source (0x93), B=1",
      e: craft((e) => { e.regs.b = 1; e.mem.write8(e.regs.hl, 0x93); }) },
    { name: "high-nibble-set source (0xF0), B=1",
      e: craft((e) => { e.regs.b = 1; e.mem.write8(e.regs.hl, 0xf0); }) }, // high=F, low=0 — swap must produce F then 0
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, expandBcdDigits);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} count/wrap edges identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the no-swap (low-first) twin is CAUGHT", () => {
  const caps = captureDispatches(16, 2000);
  assert.ok(caps.length >= 1, "need real captures to catch the missing-swap bug");

  // Real dispatches render score bytes whose nibbles differ (e.g. 0x02, 0x2x), where
  // storing the low nibble as the high cell writes the wrong byte.
  let caughtReal = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenExpand).length > 0) caughtReal++;
  }
  assert.ok(caughtReal >= 1, "the no-swap twin escaped detection on every real dispatch — the gate is worthless");

  // And on a crafted differing-nibble arm, where the miss is guaranteed.
  const seed = caps[0].clone();
  seed.regs.sp = 0x6bfe;
  seed.regs.b = 1;
  seed.mem.write8(seed.regs.hl, 0x93); // high=9, low=3 — the wrong cell is guaranteed to differ
  const craftedDiffs = contractDiffs(seed, brokenExpand);
  assert.ok(craftedDiffs.length > 0, "the no-swap twin escaped detection on the crafted differing-nibble arm");

  console.log(
    `  TEETH: no-swap twin caught on ${caughtReal}/${caps.length} real dispatches ` +
      `and on the crafted arm (${craftedDiffs.join("; ")})`,
  );
});
