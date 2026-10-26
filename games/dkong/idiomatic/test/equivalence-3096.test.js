// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for xorMaskStridedPair (ROM 0x3096) — the "XOR mask C into two
 * bytes at HL, stride DE" read-modify-write primitive (`mem[HL] ^= C; mem[HL+DE] ^= C`).
 *
 * Like its sibling addStrided (0x003d) this routine WRITES MEMORY, so it is gated on
 * memory-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — not on a returned scalar,
 * and every case runs on a FRESH clone. LIVE-OUT is memory-only: the sole caller
 * (sub_306f) overwrites A and HL right after each `call 0x3096` and never reads B or a
 * flag before overwriting it, so A/B/HL and the add-hl carry are DEAD and deliberately
 * NOT compared (comparing them would false-fail — the idiomatic routine leaves the
 * register file untouched by design).
 *
 * REACHABILITY: 0x3096 is not wired into the live dispatcher (reached only via sub_306f,
 * whose body runs 1-in-8 and lives in the untranslated 1977 subtree). A real attract run
 * dispatches it ZERO times (measured over 2000 frames), so there are no real captures to
 * replay. Instead this is a CRAFTED-ENTRY gate: seed from a REAL captured RAM snapshot —
 * hooked at the sibling 0x003d, which fires during board setup with the 0x6908 sprite
 * block live (exactly the region sub_306f targets) — then surgically poke the three
 * live-ins (HL, C, DE) to the sole caller's values and to edge cases. Each is compared
 * identically on both sides.
 *
 *   1. EQUAL (crafted caller sites + edges) — the two real sub_306f sites (HL=0x6909 /
 *      0x691d, C=0x81, DE=4) plus XOR-identity (C=0), toggle-all (C=0xff), stride 1, and
 *      two larger strides in other work-RAM regions. Each: run the ORACLE on one clone
 *      and xorMaskStridedPair on another and confirm identical RAM + pc + SP.
 *
 *   2. TEETH (wrong stride) — a twin that steps HL by 1 instead of DE MUST be caught on
 *      the DE=4 caller sites (it writes 0x690a instead of 0x690d).
 *
 *   3. TEETH (store, not XOR) — a twin that STORES C instead of XOR-ing it MUST be caught
 *      on realistic nonzero sprite data, proving the read-modify-write is load-bearing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3096.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3096 as oracle } from "../../translated/loc_3096.js";
import { xorMaskStridedPair } from "../xorMaskStridedPair.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const SEED_TARGET = 0x003d; // the sibling we hook to obtain realistic sprite-block RAM
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
 *  idiomatic routine replaces the Z80 stack with the JS call stack, so it does not touch pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the memory-only contract: RAM − the stack scratch below the entry SP, pc,
 * and SP. A/B/HL and flags are DEAD (the sole caller overwrites them before reading) and
 * are intentionally omitted. Returns human-readable mismatches (empty when equal).
 */
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

// -- capture (seed only) ------------------------------------------------------

/**
 * Hook the sibling 0x003d in a real attract run and clone the machine at up to K real
 * dispatches. 0x003d fires during board setup with the 0x6908 sprite block populated, so
 * these clones carry realistic RAM in the exact region sub_3096 toggles. We only need a
 * live machine state to seed crafted entries from — 0x3096 itself is never dispatched.
 */
function captureSeeds(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[SEED_TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    // do NOT run the oracle here — leaving 0x003d unexecuted is fine; we just want the
    // entry RAM. The host run may stop early at an untranslated stub; that is expected.
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  try { host.runFrames(maxFrames); } catch { /* attract may reach an untranslated stub */ }
  return caps;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin: steps the pointer by 1 instead of by DE — wrong second address when DE != 1. */
function brokenWrongStride(m) {
  const { regs, mem } = m;
  const mask = regs.c;
  let ptr = regs.hl;
  for (let i = 0; i < 2; i++) {
    mem.write8(ptr, mem.read8(ptr) ^ mask);
    ptr = (ptr + 1) & 0xffff; // BUG: should step by regs.de
  }
}

/** Broken twin: STORES C instead of XOR-ing it — drops the read-modify-write. */
function brokenStoreNotXor(m) {
  const { regs, mem } = m;
  const mask = regs.c;
  let ptr = regs.hl;
  for (let i = 0; i < 2; i++) {
    mem.write8(ptr, mask); // BUG: plain store, not `read ^ mask`
    ptr = (ptr + regs.de) & 0xffff;
  }
}

// -- 1. EQUAL (crafted caller sites + edges) ----------------------------------

test("EQUAL (crafted): the sub_306f caller sites and the C/DE/HL edges match the oracle", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need one real 0x003d capture to seed crafted entries with real RAM");
  const seed = seeds[0];

  // Each craft: real captured RAM, surgical live-in pokes, a safe stack pointer so the
  // oracle's `ret` pops harmless (STACK_SCRATCH, excluded) bytes on both sides.
  const craft = (hl, c, de) => {
    const e = seed.clone();
    e.regs.hl = hl; e.regs.c = c; e.regs.de = de;
    e.regs.sp = 0x6bfe;
    return e;
  };

  const cases = [
    { name: "sub_306f site A   (HL=0x6909, C=0x81, DE=4)", e: craft(0x6909, 0x81, 0x0004) },
    { name: "sub_306f site B   (HL=0x691d, C=0x81, DE=4)", e: craft(0x691d, 0x81, 0x0004) },
    { name: "XOR identity      (HL=0x6909, C=0x00, DE=4)", e: craft(0x6909, 0x00, 0x0004) },
    { name: "toggle all bits   (HL=0x6910, C=0xff, DE=4)", e: craft(0x6910, 0xff, 0x0004) },
    { name: "stride 1 adjacent (HL=0x6100, C=0x3c, DE=1)", e: craft(0x6100, 0x3c, 0x0001) },
    { name: "large stride/region (HL=0x6200, C=0xa5, DE=0x10)", e: craft(0x6200, 0xa5, 0x0010) },
    { name: "high work-RAM/stride 32 (HL=0x6a00, C=0x5a, DE=0x20)", e: craft(0x6a00, 0x5a, 0x0020) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, xorMaskStridedPair);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} caller sites + edges identical to the oracle (RAM+pc+SP)`);
});

// -- 2. TEETH (wrong stride) --------------------------------------------------

test("TEETH: the wrong-stride twin is CAUGHT on the DE=4 caller sites", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture to build the DE=4 caller case");
  const mk = (hl) => {
    const e = seeds[0].clone();
    e.regs.hl = hl; e.regs.c = 0x81; e.regs.de = 0x0004; e.regs.sp = 0x6bfe;
    return e;
  };

  const a = contractDiffs(mk(0x6909), brokenWrongStride);
  const b = contractDiffs(mk(0x691d), brokenWrongStride);
  assert.ok(a.length > 0, "wrong-stride twin escaped detection on HL=0x6909 (DE=4) — the gate is worthless");
  assert.ok(b.length > 0, "wrong-stride twin escaped detection on HL=0x691d (DE=4) — the gate is worthless");
  console.log(`  TEETH/stride: wrong-stride twin caught (e.g. ${a[0]})`);
});

// -- 3. TEETH (store, not XOR) ------------------------------------------------

test("TEETH: the store-instead-of-XOR twin is CAUGHT (the RMW is load-bearing)", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture with nonzero sprite data");
  const e = seeds[0].clone();
  e.regs.hl = 0x6909; e.regs.c = 0x81; e.regs.de = 0x0004; e.regs.sp = 0x6bfe;

  // Guard: store(C) and (byte ^ C) differ iff byte != 0, so at least one target byte must
  // be nonzero, else the teeth is vacuous (store == xor when the existing byte is 0).
  const b0 = e.mem.read8(0x6909), b1 = e.mem.read8(0x690d);
  assert.ok(b0 !== 0 || b1 !== 0,
    "seed target bytes are both zero — cannot distinguish store from XOR");

  const diffs = contractDiffs(e, brokenStoreNotXor);
  assert.ok(diffs.length > 0, "store-instead-of-XOR twin escaped detection — the RMW is not being tested");
  console.log(`  TEETH/store: store-not-XOR twin caught (${diffs[0]}) on bytes ${hx(b0)}/${hx(b1)}`);
});
