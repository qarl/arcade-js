// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for storeDigitAndAdvance (ROM 0x0593) — the BCD-counter renderer's
 * innermost leaf: mask A to one nibble, store it at [IX], advance IX by DE.
 *
 * Like addStrided (0x003d) and unlike the pure-leaf exemplar (0x2333), this routine
 * WRITES MEMORY, so it is gated on memory-equivalence (not on a returned scalar) and
 * every case runs on a FRESH clone (a reused clone is only safe for a read-only leaf):
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0593 in a real attract run and clone
 *      the machine at each true dispatch. Attract renders the high-score column
 *      (IX = 0x7641, DE = 0xFFE0, A = a packed score byte). For each capture, run the
 *      ORACLE on one clone and storeDigitAndAdvance on another and confirm they leave
 *      identical RAM (minus the stack scratch below the entry SP) + pc + SP + declared live-out (A, IX).
 *
 *   2. EQUAL (crafted arms) — the value/stride edges attract never varies, seeded from
 *      real captured RAM with surgical register pokes: a down/positive stride, an A
 *      whose high nibble must be masked away (proving `and 0x0f`), and the IX-advance
 *      16-bit wrap. Each compared identically on both sides.
 *
 *   3. TEETH (real + crafted) — a twin that stores A UNMASKED (skips `and 0x0f`) MUST
 *      be caught: it writes the wrong byte AND leaves the wrong A whenever A's high
 *      nibble is nonzero (which the real score bytes 0x67/0x76 are).
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs one m.ret() on the candidate clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally) — the only place the stack is touched.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0593.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0593 as oracle } from "../../translated/loc_0593.js";
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

const TARGET = 0x0593;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region excluded by the standard gate. sub_0593 pushes nothing, so it
 * never writes the stack anyway; the exclusion just follows the contract.
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

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc +
 * SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP,
 * and declared live-out A/IX. Returns a list of human-readable mismatches (empty when
 * equal), so a single call proves — or disproves — equivalence on one entry.
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.regs.ix !== c.regs.ix) diffs.push(`IX oracle=0x${o.regs.ix.toString(16)} cand=0x${c.regs.ix.toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x0593 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game
 * proceeds undisturbed. m.call(0x0593) resolves through the routine registry the
 * override overlays, so the digit renderers' two call sites (loop_0583, sub_057c) are
 * all captured here.
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

/** Broken twin: stores A UNMASKED (skips `and 0x0f`) — wrong byte + wrong A whenever A's high nibble is set. */
function brokenStoreDigit(m) {
  const { regs, mem } = m;
  const digit = regs.a; // BUG: should be regs.a & 0x0f
  mem.write8(regs.ix, digit);
  regs.ix = (regs.ix + regs.de) & 0xffff;
  regs.a = digit;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): storeDigitAndAdvance == oracle on every captured 0x0593 entry", () => {
  const caps = captureDispatches(64, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x0593 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, storeDigitAndAdvance); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const { regs } = caps[0];
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical ` +
      `(sample A=${hx(regs.a)} IX=0x${regs.ix.toString(16)} DE=0x${regs.de.toString(16)})`,
  );
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): the value/stride edges match the oracle", () => {
  const caps = captureDispatches(1, 1500);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Each craft: real captured RAM, surgical register pokes, a safe stack pointer so
  // the oracle's `ret` pops harmless (STACK_SCRATCH, excluded) bytes on both sides.
  const craft = (a, ix, de) => {
    const e = seed.clone();
    e.regs.a = a; e.regs.ix = ix; e.regs.de = de;
    e.regs.sp = 0x6bfe;
    return e;
  };

  const cases = [
    { name: "down/positive stride (DE=+0x20)",   e: craft(0x35, 0x7640, 0x0020) },
    { name: "high nibble masked away (A=0xF9)",  e: craft(0xf9, 0x7641, 0xffe0) },
    { name: "high nibble masked away (A=0xAB)",  e: craft(0xab, 0x76a0, 0xffe0) },
    { name: "IX-advance 16-bit wrap",            e: craft(0x07, 0x7700, 0xf000) }, // 0x7700 -> 0x6700
    { name: "digit 0, up-a-row (A=0x00)",        e: craft(0x00, 0x7641, 0xffe0) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, storeDigitAndAdvance);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} value/stride edges identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the unmasked-store twin is CAUGHT", () => {
  const caps = captureDispatches(16, 1500);
  assert.ok(caps.length >= 1, "need real captures to catch the missing-mask bug");

  // Real dispatches include score bytes with a nonzero high nibble (e.g. 0x67, 0x76),
  // where storing A unmasked writes the wrong byte and leaves the wrong A.
  let caughtReal = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenStoreDigit).length > 0) caughtReal++;
  }
  assert.ok(caughtReal >= 1, "the unmasked twin escaped detection on every real dispatch — the gate is worthless");

  // And on a crafted high-nibble arm, where the miss is guaranteed.
  const seed = caps[0].clone();
  seed.regs.a = 0xf9; seed.regs.ix = 0x7641; seed.regs.de = 0xffe0; seed.regs.sp = 0x6bfe;
  const craftedDiffs = contractDiffs(seed, brokenStoreDigit);
  assert.ok(craftedDiffs.length > 0, "the unmasked twin escaped detection on the crafted high-nibble arm");

  console.log(
    `  TEETH: unmasked twin caught on ${caughtReal}/${caps.length} real dispatches ` +
      `and on the crafted arm (${craftedDiffs.join("; ")})`,
  );
});
