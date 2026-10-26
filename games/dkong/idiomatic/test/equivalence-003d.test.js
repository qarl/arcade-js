// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for addStrided (ROM 0x003d) — the shared "add C to a strided
 * run of bytes" memory primitive (`for k in 0..B-1: (HL + k*DE) += C`, 8-bit wrap).
 *
 * Unlike the pure-leaf exemplar (0x2333), this routine WRITES MEMORY, so it is
 * gated on memory-equivalence, not on a returned scalar, and every case runs on a
 * FRESH clone (the exemplar's single reused clone is only safe for a read-only leaf):
 *
 *   1. EQUAL (real captured dispatches) — hook 0x003d in a real attract run and
 *      clone the machine at each true dispatch. Attract exercises only the rst-0x38
 *      arm (B=0x0A, C=0xFC, DE=4, HL=0x690b — the stride-4 sprite-field fill during
 *      board setup). For each capture, run the ORACLE on one clone and addStrided on
 *      another and confirm they leave identical RAM (minus the stack scratch below the entry SP) + pc + SP +
 *      declared live-out (A/B/HL).
 *
 *   2. EQUAL (crafted direct-call arms + edges) — attract never reaches the direct
 *      `call 0x003d` sites, so craft them (real captured RAM, surgically poked regs):
 *      B=2 with C=0x28/0x10/0xF8 (loc_1880, loc_0d5f — all pass B=2), the B=0 →
 *      256-pass edge, an 8-bit add-wrap (C=0xF0), and a non-4 stride. Each is
 *      compared identically on both sides.
 *
 *   3. TEETH (real + crafted) — a deliberately-broken twin that steps HL by 1 instead
 *      of by DE MUST be caught (it writes the wrong addresses whenever DE != 1).
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs one m.ret() on the idiomatic clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally) — the only place the stack is touched.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-003d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_003d as oracle } from "../../translated/loc_003d.js";
import { addStrided } from "../addStrided.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x003d;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region excluded by the standard gate. sub_003d pushes nothing, so it
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
 * and declared live-out A/B/HL. Returns a list of human-readable mismatches (empty
 * when equal), so a single call proves — or disproves — equivalence on one entry.
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
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x003d in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game
 * proceeds undisturbed. m.call(0x003d) resolves through the routine registry the
 * override overlays, so BOTH the direct-call sites and the rst-0x38 fall-through
 * (loc_0038 → call 0x003d) are captured here.
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

/** Broken twin: steps HL by 1 instead of by DE — writes the wrong run whenever DE != 1. */
function brokenAddStrided(m) {
  const { regs, mem } = m;
  const addend = regs.c;
  const count = regs.b === 0 ? 256 : regs.b;
  let ptr = regs.hl;
  let a = 0;
  for (let i = 0; i < count; i++) {
    a = (addend + mem.read8(ptr)) & 0xff;
    mem.write8(ptr, a);
    ptr = (ptr + 1) & 0xffff; // BUG: should step by regs.de
  }
  regs.a = a;
  regs.hl = ptr;
  regs.b = 0;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): addStrided == oracle on every captured 0x003d entry", () => {
  const caps = captureDispatches(64, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x003d dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, addStrided); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const { regs } = caps[0];
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical ` +
      `(sample B=${hx(regs.b)} C=${hx(regs.c)} DE=0x${regs.de.toString(16)} HL=0x${regs.hl.toString(16)})`,
  );
});

// -- 2. EQUAL (crafted direct-call arms + edges) ------------------------------

test("EQUAL (crafted): the direct-call arms and the B/C/DE edges match the oracle", () => {
  const caps = captureDispatches(1, 1500);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Each craft: real captured RAM, one surgical register poke, a safe stack pointer
  // so the oracle's `ret` pops harmless (STACK_SCRATCH, excluded) bytes.
  const craft = (b, c, de, hl) => {
    const e = seed.clone();
    e.regs.b = b; e.regs.c = c; e.regs.de = de; e.regs.hl = hl;
    e.regs.sp = 0x6bfe;
    return e;
  };

  // The three direct `call 0x003d` sites all pass B=2 (bc=0x0228/0x0210/0x02f8 —
  // B is the HIGH byte); the rest are edge cases attract's rst-only arm never hits.
  const cases = [
    { name: "loc_1880 direct  (B=2, C=0x28, DE=4)",  e: craft(0x02, 0x28, 0x0004, 0x6903) },
    { name: "loc_0d5f run A   (B=2, C=0x10, DE=4)",  e: craft(0x02, 0x10, 0x0004, 0x6900) },
    { name: "loc_0d5f run B   (B=2, C=0xf8, DE=4)",  e: craft(0x02, 0xf8, 0x0004, 0x6903) },
    { name: "B=0 -> 256 passes (C=1, DE=1)",          e: craft(0x00, 0x01, 0x0001, 0x6800) },
    { name: "8-bit add wrap   (C=0xf0, DE=4)",        e: craft(0x08, 0xf0, 0x0004, 0x6900) },
    { name: "non-4 stride     (C=0x28, DE=0x00ff)",   e: craft(0x03, 0x28, 0x00ff, 0x6100) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, addStrided);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} direct-call arms + edges identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-stride twin is CAUGHT", () => {
  const caps = captureDispatches(8, 1500);
  assert.ok(caps.length >= 1, "need a real capture (DE=4, count>1) to catch the wrong-stride bug");

  // Real dispatches all have DE=4, count=0x0A, so stride-1 diverges immediately.
  let caughtReal = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenAddStrided).length > 0) caughtReal++;
  }
  assert.ok(
    caughtReal === caps.length,
    `the twin escaped detection on ${caps.length - caughtReal}/${caps.length} real dispatches — the gate is worthless`,
  );

  // And on a crafted non-4-stride arm, for good measure.
  const seed = caps[0].clone();
  seed.regs.b = 0x03; seed.regs.c = 0x28; seed.regs.de = 0x00ff; seed.regs.hl = 0x6910; seed.regs.sp = 0x6bfe;
  const craftedDiffs = contractDiffs(seed, brokenAddStrided);
  assert.ok(craftedDiffs.length > 0, "the twin escaped detection on the crafted non-4-stride arm");

  console.log(
    `  TEETH: wrong-stride twin caught on all ${caps.length} real dispatches ` +
      `(e.g. ${contractDiffs(caps[0], brokenAddStrided)[0]}) and on the crafted arm`,
  );
});
