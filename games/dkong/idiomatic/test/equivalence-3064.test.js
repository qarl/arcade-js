// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for copyByteDisplaced (ROM 0x3064) — the "copy one byte from
 * HL+BC to HL+BC+DE" addressing primitive (`mem[HL+BC+DE] = mem[HL+BC]`, both adds
 * 16-bit and wrapping).
 *
 * Like addStrided (0x003d) and unlike the pure-leaf exemplar (0x2333), this routine
 * WRITES MEMORY, so it is gated on memory-equivalence — RAM (minus the stack scratch below the entry SP) +
 * pc + SP — not on a returned scalar, and every case runs on a FRESH clone (a reused
 * clone is only safe for a read-only leaf). Its declared LIVE-OUT is memory-only (the
 * one byte at HL+BC+DE); the oracle's residual HL/A/F are dead at the sole call site,
 * so the contract deliberately does NOT compare them. BC/DE are read-only on both
 * sides (neither implementation writes them), so they pass through identically.
 *
 *   1. EQUAL (real captured dispatches) — plain attract never reaches 0x3064 (0×): it
 *      runs only inside the game-state cascade that drives its sole caller loc_304a.
 *      So the real dispatch states are reproduced by capturing a realistic booted
 *      machine at loc_0fd7 (reached in plain attract), then running the TRANSLATED
 *      loc_304a on clones with the effect index 0x638E seeded across values, hooking
 *      0x3064 to snapshot each true dispatch. That yields the exact (HL,BC,DE,SP,
 *      video-RAM) loc_304a feeds it in play (HL=0x7600/0x75C0, DE=0xFFE0, SP pointing
 *      at the pushed return address). For each, oracle vs copyByteDisplaced must leave
 *      identical RAM + pc + SP.
 *
 *   2. EQUAL (crafted edge arms) — arms the caller's two fixed sites never exercise:
 *      a forward DE, a large DE, an HL+BC 16-bit wrap (source computed in ROM, copied
 *      into work RAM), a DE=0 self-copy, and a copy entirely within work RAM. Real
 *      captured RAM, surgical register pokes, a safe (excluded) stack pointer.
 *
 *   3. TEETH (crafted sentinel + real) — a deliberately-broken twin that DROPS the
 *      displacement (writes to HL+BC, forgetting the +DE) MUST be caught. A byte-
 *      relocation bug is invisible whenever source and dest already hold equal bytes,
 *      so the guaranteed catch is on CRAFTED entries with distinct sentinel bytes at
 *      source and dest; it is additionally shown caught on the real dispatches whose
 *      video RAM distinguishes it.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs one m.ret() on the candidate clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally) — the only place the stack is touched.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3064.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3064 as oracle } from "../../translated/loc_3064.js";
import { loc_0fd7 } from "../../translated/loc_0fd7.js";
import { loc_304a } from "../../translated/loc_304a.js";
import { copyByteDisplaced } from "../copyByteDisplaced.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3064;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP match the oracle's (the
 *  idiomatic routine replaces the Z80 stack with the JS call stack, so it never touches pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the memory-only contract: RAM − the stack scratch below the entry SP, pc, and SP;
 *  HL/A/F are intentionally NOT compared. Returns a list of human-readable mismatches (empty when equal). */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

// A realistic booted machine, captured at loc_0fd7 (reached in plain attract) — the same seed the optimized loc_304a
// suite uses. Its clones drive loc_304a below.
function captureBooted(maxFrames) {
  let entry = null;
  const snap = new Map([[0x0fd7, (mm) => { if (entry === null) entry = mm.clone(); return loc_0fd7(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  if (entry === null) throw new Error("loc_0fd7 never entered — cannot seed real 0x3064 dispatches");
  return entry;
}

/**
 * Reproduce the REAL 0x3064 dispatch states: for each effect-index seed, clone the
 * booted machine, seed 0x638E, and run the TRANSLATED loc_304a with 0x3064 hooked to
 * snapshot each true dispatch. loc_304a m.call(0x3064)s twice (HL=0x7600 then 0x75C0),
 * with the caller's real BC/DE and a genuine pushed return address on the stack — so
 * each snapshot is the exact state the routine meets in play, not a fabrication.
 */
function captureRealDispatches(booted, seeds) {
  const caps = [];
  for (const seed of seeds) {
    const c = booted.clone();
    c.mem.write8(0x638e, seed);
    c.routines.set(TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); });
    loc_304a(c);
  }
  return caps;
}

/** Broken twin: drops the displacement — writes to HL+BC instead of HL+BC+DE. */
function brokenCopyByteDisplaced(m) {
  const { regs, mem } = m;
  const src = (regs.hl + regs.bc) & 0xffff;
  mem.write8(src, mem.read8(src)); // BUG: dest should be (src + regs.de) & 0xffff
}

const SEEDS = Array.from({ length: 24 }, (_, i) => (1 + i * 11) & 0xff); // 24 seeds → 48 dispatches

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): copyByteDisplaced == oracle on every captured 0x3064 entry", () => {
  const booted = captureBooted(600);
  const caps = captureRealDispatches(booted, SEEDS);
  assert.ok(caps.length >= 2, "expected real 0x3064 dispatches from loc_304a");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, copyByteDisplaced); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const { regs } = caps[0];
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical ` +
      `(sample HL=0x${regs.hl.toString(16)} BC=0x${regs.bc.toString(16)} DE=0x${regs.de.toString(16)})`,
  );
});

// -- 2. EQUAL (crafted edge arms) ---------------------------------------------

test("EQUAL (crafted): the address-wrap / displacement edges match the oracle", () => {
  const booted = captureBooted(600);
  const seed = booted.clone();

  // Each craft: real captured RAM, surgical register pokes, a safe stack pointer so
  // the oracle's `ret` pops harmless (STACK_SCRATCH, excluded) bytes.
  const craft = (hl, bc, de) => {
    const e = seed.clone();
    e.regs.hl = hl; e.regs.bc = bc; e.regs.de = de;
    e.regs.sp = 0x6bfe;
    return e;
  };

  const cases = [
    { name: "forward DE               (dst = src+0x40, video RAM)",  e: craft(0x7500, 0x0020, 0x0040) },
    { name: "large DE                 (dst = src+0x100)",            e: craft(0x7480, 0x0010, 0x0100) },
    { name: "HL+BC 16-bit wrap        (src=0x0020 ROM -> dst=0x6020 RAM)", e: craft(0xfff0, 0x0030, 0x6000) },
    { name: "DE=0 self-copy           (src == dst, no-op)",         e: craft(0x7600, 0x0010, 0x0000) },
    { name: "within work RAM          (src=0x6120, dst=0x6160)",    e: craft(0x6100, 0x0020, 0x0040) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, copyByteDisplaced);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} address-wrap / displacement edges identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the displacement-dropping twin is CAUGHT", () => {
  const booted = captureBooted(600);
  const seed = booted.clone();

  // GUARANTEED catch: distinct sentinel bytes at source and dest, so a twin that
  // writes to the source (dropping +DE) leaves the dest at its sentinel while the
  // oracle overwrites it — a diff that cannot coincide away.
  const craftSentinel = (hl, bc, de) => {
    const e = seed.clone();
    e.regs.hl = hl; e.regs.bc = bc; e.regs.de = de; e.regs.sp = 0x6bfe;
    const src = (hl + bc) & 0xffff, dst = (src + de) & 0xffff;
    e.mem.write8(src, 0xa5);
    e.mem.write8(dst, 0x5a);
    return e;
  };
  const sentinels = [
    craftSentinel(0x7620, 0x0000, 0xffe0), // -0x20 (the caller's real displacement)
    craftSentinel(0x7500, 0x0020, 0x0040), // forward
    craftSentinel(0x7480, 0x0010, 0x0100), // large
  ];
  for (const e of sentinels) {
    assert.ok(
      contractDiffs(e, brokenCopyByteDisplaced).length > 0,
      "the displacement-dropping twin escaped the sentinel gate — it is worthless",
    );
    // and the correct routine is still EQUAL on the very same entry
    assert.equal(contractDiffs(e, copyByteDisplaced).length, 0, "copyByteDisplaced must pass the sentinel entry");
  }

  // Corroboration on real dispatches: caught wherever the caller's video RAM has
  // dest != source at the copied cell (a strict subset, but must be non-empty).
  const caps = captureRealDispatches(booted, SEEDS);
  const caughtReal = caps.filter((cap) => contractDiffs(cap, brokenCopyByteDisplaced).length > 0).length;
  assert.ok(caughtReal > 0, "the twin was not caught on ANY real dispatch — corroboration failed");

  console.log(
    `  TEETH: displacement-dropping twin caught on all ${sentinels.length} sentinel entries ` +
      `and on ${caughtReal}/${caps.length} real dispatches`,
  );
});
