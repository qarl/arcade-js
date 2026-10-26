// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loadSpriteObjectBlock (ROM 0x004e) — the fixed-destination
 * sprite-object-block LDIR (`ld de,0x6908 / ld bc,0x28 / ldir`).
 *
 * sub_004e WRITES memory (40 bytes into SPRITE_OBJ_BLOCK) and its source is an
 * implicit input (HL, caller-supplied), so it is validated by capture/clone/replay
 * on a FRESH clone per case — never by reusing one machine, and never on the full
 * register file or cycles. The contract compared is RAM (minus the stack scratch below the entry SP) + the
 * declared live-out registers HL/DE/BC:
 *
 *   1. REALISM — hook 0x004e in a real attract run and clone the machine at each real
 *      dispatch (48 fire over 2000 frames, from 5 ROM-template sources). For each,
 *      run oracle vs loadSpriteObjectBlock on two fresh clones and confirm identical
 *      RAM (ex-stack) + HL/DE/BC.
 *
 *   2. CRAFTED (source breadth) — attract only ever feeds a handful of ROM templates,
 *      so poke HL at a scratch region seeded with distinctive byte patterns (identical
 *      on both sides) to prove the copy is faithful for ARBITRARY content, plus an
 *      OVERLAP case (source one byte below the destination) that only a forward copy —
 *      the `ldir` semantics — reproduces.
 *
 *   3. TEETH — a deliberately-broken twin (off-by-one length: copies 0x27 bytes, not
 *      0x28) MUST be caught, both on real captures and on a crafted entry rigged so the
 *      dropped byte is guaranteed to differ (so the RAM gate bites, not only the regs).
 *
 * NOT COMPARED, deliberately: SP and PC. The oracle's terminal `ret` pops the stack
 * (SP += 2) and vectors PC to the return address; the idiomatic layer drops that
 * stack/PC bookkeeping (the JS call stack replaces it), so those are dead ABI here.
 * Cycles and the full register file are likewise never compared (docs/decompiler-pipeline). Flags and A
 * are untouched by BOTH sides (the oracle's ldirAt models no flags).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-004e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_004e as oracle } from "../../translated/loc_004e.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { Machine } from "../../machine.js";
import { SPRITE_OBJ_BLOCK, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x004e;
const OBJ_BLOCK_BYTES = 0x28; // 10 sprite records x 4 bytes
const LIVE_REGS = ["hl", "de", "bc"]; // the LDIR's terminal register outputs

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
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

/** First declared-live-out register that differs, or null. */
function firstLiveRegDiff(a, b) {
  for (const k of LIVE_REGS) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing,
 * stateful routine demands a fresh clone per side) and diff the contract.
 */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { ram: firstRamDiffOutsideStack(a, b, entry.regs.sp), reg: firstLiveRegDiff(a, b) };
}

/**
 * Hook 0x004e in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop.
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
 * Build a crafted entry from a real capture: point HL at a scratch source region and
 * seed [srcBase, srcBase+40) with `pattern(i)`, so both sides copy identical content.
 * srcBase defaults clear of the destination; pass an overlapping base to test that too.
 */
function craftEntry(base, srcBase, pattern) {
  const w = base.clone();
  w.regs.hl = srcBase;
  for (let i = 0; i < OBJ_BLOCK_BYTES; i++) {
    w.mem.write8((srcBase + i) & 0xffff, pattern(i) & 0xff);
  }
  return w;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x004e dispatches — RAM (ex-stack) + HL/DE/BC match the oracle", () => {
  const caps = captureDispatches(64, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x004e dispatch during attract");

  for (const cap of caps) {
    const { ram, reg } = diffAgainstOracle(cap, loadSpriteObjectBlock);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b} (HL_in=${hx(cap.regs.hl)})`);
    assert.equal(reg, null, reg && `reg ${reg && reg.reg} diff: oracle=${hx(reg.a)} cand=${hx(reg.b)} (HL_in=${hx(cap.regs.hl)})`);
  }
  console.log(`  REALISM: ${caps.length} real 0x004e dispatches — identical RAM (ex-stack) + HL/DE/BC`);
});

// -- 2. CRAFTED (source breadth + overlap) ------------------------------------

test("CRAFTED: arbitrary source patterns (+ an overlap case) match the oracle", () => {
  const [base] = captureDispatches(1, 2000);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const SRC = 0x6100; // work-RAM scratch, clear of the 0x6908-0x692F destination
  const patterns = [
    (i) => i, // ascending 0x00..0x27
    (i) => OBJ_BLOCK_BYTES - 1 - i, // descending
    () => 0xff, // all ones
    () => 0x00, // all zeros
    (i) => (i & 1) ? 0x5a : 0xa5, // alternating
  ];

  for (const pattern of patterns) {
    const w = craftEntry(base, SRC, pattern);
    const { ram, reg } = diffAgainstOracle(w, loadSpriteObjectBlock);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
    assert.equal(reg, null, reg && `reg ${reg && reg.reg} diff: oracle=${hx(reg.a)} cand=${hx(reg.b)}`);
  }

  // OVERLAP: source one byte below the destination — a forward memmove. A reverse or
  // block copy would diverge here; the oracle's `ldir` and our loop are both forward.
  const overlap = craftEntry(base, SPRITE_OBJ_BLOCK - 1, (i) => (0x40 + i) & 0xff);
  const { ram, reg } = diffAgainstOracle(overlap, loadSpriteObjectBlock);
  assert.equal(ram, null, ram && `overlap RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  assert.equal(reg, null, reg && `overlap reg diff`);

  console.log(`  CRAFTED: ${patterns.length} source patterns + 1 overlap case identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: off-by-one length — copies 0x27 bytes, dropping the last. */
function brokenLoad(m) {
  const { regs, mem } = m;
  let src = regs.hl;
  let dst = SPRITE_OBJ_BLOCK;
  for (let i = 0; i < OBJ_BLOCK_BYTES - 1; i++) { // BUG: should be OBJ_BLOCK_BYTES
    mem.write8(dst, mem.read8(src));
    src = (src + 1) & 0xffff;
    dst = (dst + 1) & 0xffff;
  }
  regs.hl = src;
  regs.de = dst;
  regs.bc = 0;
}

test("TEETH: the off-by-one twin is CAUGHT — on real captures and with a rigged RAM diff", () => {
  // On real captures: the short copy leaves HL/DE one short (and usually 0x692F stale).
  const caps = captureDispatches(64, 2000);
  let caughtOnCapture = false;
  for (const cap of caps) {
    const { ram, reg } = diffAgainstOracle(cap, brokenLoad);
    if (ram || reg) { caughtOnCapture = true; break; }
  }
  assert.ok(caughtOnCapture, "the gate FAILED to catch the off-by-one twin on real captures — it is worthless");

  // Rigged crafted entry so the RAM gate ITSELF bites (not only the register compare):
  // pre-clear the destination to 0x00 and give the source a nonzero last byte, so the
  // dropped byte at 0x692F is guaranteed to differ oracle-vs-broken.
  const [base] = captureDispatches(1, 2000);
  const w = base.clone();
  for (let i = 0; i < OBJ_BLOCK_BYTES; i++) w.mem.write8((SPRITE_OBJ_BLOCK + i) & 0xffff, 0x00);
  const SRC = 0x6100;
  w.regs.hl = SRC;
  for (let i = 0; i < OBJ_BLOCK_BYTES; i++) w.mem.write8((SRC + i) & 0xffff, (i + 1) & 0xff); // 0x01..0x28, all nonzero

  const { ram, reg } = diffAgainstOracle(w, brokenLoad);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch the dropped last byte");
  assert.equal(ram.addr, (SPRITE_OBJ_BLOCK + OBJ_BLOCK_BYTES - 1) & 0xffff, "the diff must be the dropped byte at 0x692F");
  assert.notEqual(reg, null, "the register gate should also flag HL/DE as short");
  console.log(`  TEETH: off-by-one twin caught on captures AND by RAM at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
