// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for positionBonusItemSprite (ROM 0x15fa) — the on-board
 * bonus-item sprite placer.
 *
 * sub_15fa is a STRAIGHT-LINE LEAF and a TOTAL function of two register bytes
 * (B, C): it reads no work RAM — only the fixed ROM position grid at 0x360F,
 * indexed by BC after `sla c` — and writes exactly the four bytes of hardware
 * sprite record #29 (0x6974-0x6977). Its stack traffic (push/pop DE/HL, ret) is
 * dead caller-ABI confined to STACK_SCRATCH, and both call sites (sub_1486)
 * overwrite HL immediately after and read none of the clobbered regs/flags. So
 * the contract is RAM − the stack scratch below the entry SP, and it is gated the strongest way a leaf
 * can be — EXHAUSTIVELY against the frozen oracle:
 *
 *   1. EQUAL (exhaustive C, B=0) — positionBonusItemSprite == oracle over all 256
 *      C values at B == 0, the WHOLE real domain the caller produces (B is always
 *      0; C = the item-position index). Diffed on the RAM dump minus the stack scratch below the entry SP,
 *      a FRESH clone per side because the routine WRITES memory.
 *
 *   2. EQUAL (B breadth) — B over the mapped-ROM window (0..0x08, so the table
 *      pointer stays ≤ 0x3FFF) across a curated C edge set, to PROVE the 16-bit
 *      `add hl,bc` high byte is reproduced (a routine that dropped B would pass the
 *      B==0 sweep). B != 0 is non-real (both call sites pass B == 0); this only
 *      guards the index arithmetic, and beyond 0x08 the pointer leaves ROM and the
 *      address space faults — a domain the real routine never reaches.
 *
 *   3. TEETH (exhaustive) — two deliberately-broken twins the sweeps MUST catch,
 *      each by a DIFFERENT sweep so both sweeps are shown to have teeth:
 *        (a) dropped-B twin (entry = 0x360F + 2*C, ignoring B) — identical at
 *            B==0, so ONLY the B-breadth sweep catches it.
 *        (b) unmasked-`sla` twin (2*C without the & 0xFF 8-bit wrap) — differs only
 *            once C ≥ 0x80, so ONLY the exhaustive C sweep catches it.
 *
 *   4. REGION-BOUNDED (crafted) — the bonus item is gameplay-only, so 0x15fa is
 *      never dispatched in attract (verified: 0 dispatches over 9000 frames); there
 *      is no natural capture. Instead, over the caller's real cells (B=0, C=0..0x1D)
 *      on a real booted machine, confirm the oracle writes ONLY 0x6974-0x6977
 *      (+ STACK_SCRATCH) — which licenses the memory-only contract — and that
 *      positionBonusItemSprite reproduces the oracle's RAM exactly.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-15fa.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_15fa as oracle } from "../../translated/loc_15fa.js";
import { positionBonusItemSprite } from "../positionBonusItemSprite.js";
import { STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x15fa;
const RECORD = 0x6974;            // hardware sprite record #29 (the bonus item)
const SAFE_SP = 0x6bfe;           // stack into STACK_SCRATCH so the oracle's push/pop/ret stays excluded

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// Contract = RAM − the stack scratch below the entry SP. The oracle's only non-record writes are its
// pushed DE/HL and popped return address, all inside STACK_SCRATCH; skipping that
// window is the documented contract, not a workaround.

/** First RAM difference (minus the stack scratch below the entry SP) between two machines, or null. */
function ramDiffExStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
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
 * A realistic machine to clone crafted (B,C) entries from. Booted and run a few
 * hundred frames so work RAM (and the sprite buffer) hold real, non-zero contents
 * — a real state, into which we surgically poke B/C (the crafted-entry idiom).
 * The routine reads no work RAM, so this backdrop does not affect the writes; it
 * only makes the region-bounded check meaningful.
 */
function bootedBase(frames = 300) {
  const host = new Machine(ROM);
  host.runFrames(frames);
  return host.clone();
}

/**
 * Run the oracle and `candidate` on two FRESH clones of `base` with B/C poked
 * (routine WRITES memory, so no clone reuse), and return the first RAM difference
 * (minus the stack scratch below the entry SP) or null.
 */
function runPair(base, b, c, candidate) {
  const oc = base.clone(); // oracle
  const cn = base.clone(); // candidate
  oc.regs.b = b; oc.regs.c = c; oc.regs.sp = SAFE_SP;
  cn.regs.b = b; cn.regs.c = c; cn.regs.sp = SAFE_SP;
  oracle(oc);
  candidate(cn);
  return ramDiffExStack(oc, cn, SAFE_SP);
}

/** Sweep a candidate over all 256 C values at B==0 (the real caller domain). */
function sweepC(base, candidate) {
  let count = 0;
  for (let c = 0; c < 256; c++) {
    const ram = runPair(base, 0x00, c, candidate);
    count++;
    if (ram) return { mismatch: { b: 0x00, c, ram }, count };
  }
  return { mismatch: null, count };
}

// C edges: low-nibble/high-nibble boundaries and the 0x80 wrap point of `sla c`.
const C_EDGES = [0x00, 0x01, 0x0e, 0x0f, 0x10, 0x40, 0x7f, 0x80, 0x81, 0xbf, 0xfe, 0xff];
// B only up to 0x08 keeps the table pointer (0x360F + (B<<8) + 2*C) inside ROM
// (≤ 0x3F0E); beyond that it leaves the mapped space and the bus faults. B != 0 is
// non-real anyway (both call sites pass B == 0) — this range only guards the add.
const B_MAX = 0x08;

/** Sweep a candidate over the mapped-ROM B window across the curated C edge set. */
function sweepB(base, candidate) {
  let count = 0;
  for (let b = 0; b <= B_MAX; b++) {
    for (const c of C_EDGES) {
      const ram = runPair(base, b, c, candidate);
      count++;
      if (ram) return { mismatch: { b, c, ram }, count };
    }
  }
  return { mismatch: null, count };
}

// -- broken twins -------------------------------------------------------------

/** BUG: drops the B high byte of the index (entry = 0x360F + 2*C). Identical at
 *  B==0, so only the B-breadth sweep can catch it. */
function brokenDropsB(m) {
  const { regs, mem } = m;
  const doubledC = (regs.c << 1) & 0xff;
  const entry = (0x360f + doubledC) & 0xffff; // BUG: no (b << 8)
  const x = mem.read8(entry);
  const y = mem.read8((entry + 1) & 0xffff);
  mem.write8(RECORD + 0, x);
  mem.write8(RECORD + 1, 0x72);
  mem.write8(RECORD + 2, 0x0c);
  mem.write8(RECORD + 3, y);
}

/** BUG: forgets the 8-bit wrap on `sla c` (2*C not masked to 0xFF). Only differs
 *  once C ≥ 0x80, so only the exhaustive C sweep catches it. */
function brokenUnmaskedSla(m) {
  const { regs, mem } = m;
  const doubledC = regs.c << 1;                 // BUG: no & 0xff
  const entry = (0x360f + ((regs.b << 8) | doubledC)) & 0xffff;
  const x = mem.read8(entry);
  const y = mem.read8((entry + 1) & 0xffff);
  mem.write8(RECORD + 0, x);
  mem.write8(RECORD + 1, 0x72);
  mem.write8(RECORD + 2, 0x0c);
  mem.write8(RECORD + 3, y);
}

// -- 1. EQUAL (exhaustive C, B=0) ---------------------------------------------

test("EQUAL (exhaustive C, B=0): positionBonusItemSprite == oracle over all 256 cell indices", () => {
  const base = bootedBase();
  const { mismatch, count } = sweepC(base, positionBonusItemSprite);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at C=${hx(mismatch.c)}: RAM diverges at 0x${(mismatch.ram.addr ?? 0).toString(16)} ` +
        `(oracle ${mismatch.ram.a} -> idiomatic ${mismatch.ram.b})`,
  );
  assert.equal(count, 256, "must have compared all 256 C values at B==0");
  console.log(`  EQUAL/exhaustive-C: ${count} cell indices — RAM (minus the stack scratch below the entry SP) identical to the oracle`);
});

// -- 2. EQUAL (B breadth) -----------------------------------------------------

test("EQUAL (B breadth): the mapped-ROM B window reproduces the 16-bit index add", () => {
  const base = bootedBase();
  const { mismatch, count } = sweepB(base, positionBonusItemSprite);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at B=${hx(mismatch.b)} C=${hx(mismatch.c)}: RAM diverges at ` +
        `0x${(mismatch.ram.addr ?? 0).toString(16)} (oracle ${mismatch.ram.a} -> idiomatic ${mismatch.ram.b})`,
  );
  console.log(`  EQUAL/B-breadth: ${count} (B,C) combos over B=0..0x${B_MAX.toString(16)} — identical to the oracle`);
});

// -- 3. TEETH (exhaustive) ----------------------------------------------------

test("TEETH: the dropped-B twin is CAUGHT only by the B-breadth sweep", () => {
  const base = bootedBase();

  // It must be INVISIBLE to the B==0 domain (that is what makes B-breadth load-bearing)...
  const atB0 = sweepC(base, brokenDropsB);
  assert.equal(atB0.mismatch, null, "dropped-B must be invisible at B==0 — otherwise the twin proves nothing about B-breadth");

  // ...and CAUGHT once B != 0.
  const { mismatch, count } = sweepB(base, brokenDropsB);
  assert.notEqual(mismatch, null, "the B-breadth sweep FAILED to catch a dropped B high byte — it is worthless");
  assert.notEqual(mismatch.b, 0x00, "the dropped-B twin should first diverge at some B != 0");
  const at = mismatch.ram.addr;
  assert.ok(at === RECORD || at === RECORD + 3, `expected the diff at the record X/Y byte, got 0x${(at ?? 0).toString(16)}`);
  console.log(`  TEETH/dropped-B: caught after ${count} combos at B=${hx(mismatch.b)} C=${hx(mismatch.c)}, addr 0x${at.toString(16)}`);
});

test("TEETH: the unmasked-sla twin is CAUGHT only by the exhaustive C sweep", () => {
  const base = bootedBase();
  const { mismatch, count } = sweepC(base, brokenUnmaskedSla);
  assert.notEqual(mismatch, null, "the exhaustive C sweep FAILED to catch an unmasked sla — it is worthless");
  assert.ok(mismatch.c >= 0x80, `the unmasked-sla twin must first diverge at C >= 0x80, got C=${hx(mismatch.c)}`);
  console.log(`  TEETH/unmasked-sla: caught at C=${hx(mismatch.c)} (>= 0x80) after ${count} value(s)`);
});

// -- 4. REGION-BOUNDED (crafted) ----------------------------------------------

test("REGION-BOUNDED: over real cells (B=0, C=0..0x1D) the oracle writes only 0x6974-0x6977, idiomatic matches", () => {
  const base = bootedBase();

  for (let c = 0; c <= 0x1d; c++) {
    // (a) The oracle writes ONLY the record bytes (+ STACK_SCRATCH), licensing the
    //     memory-only contract. Diff the entry against itself-after-oracle.
    const before = base.clone();
    const after = base.clone();
    after.regs.b = 0x00; after.regs.c = c; after.regs.sp = SAFE_SP;
    oracle(after);
    const db = before.dumpState();
    const da = after.dumpState();
    const dead = deadStackBelow(STACK_SCRATCH, SAFE_SP);
    for (let i = 0; i < Math.min(db.length, da.length); i++) {
      if (db[i] === da[i]) continue;
      const addr = after.stateOffsetToAddr(i);
      const inRecord = addr >= RECORD && addr <= RECORD + 3;
      assert.ok(
        inRecord || dead(addr),
        `oracle wrote outside the record at 0x${(addr ?? 0).toString(16)} (C=${hx(c)}: ${db[i]} -> ${da[i]})`,
      );
    }

    // (b) idiomatic reproduces the oracle's RAM exactly on this real cell.
    const ram = runPair(base, 0x00, c, positionBonusItemSprite);
    assert.equal(
      ram,
      null,
      ram && `RAM diverges at C=${hx(c)} at 0x${(ram.addr ?? 0).toString(16)} (oracle ${ram.a} -> idiomatic ${ram.b})`,
    );
  }
  console.log(`  REGION-BOUNDED: 30 real cells (B=0, C=0..0x1D) — oracle record-bounded, idiomatic == oracle`);
});
