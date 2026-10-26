// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for fillDescendingColumn (ROM 0x0514) — the 3-cell descending fill.
 *
 * sub_0514 WRITES memory (A, A-1, A-2 into HL, HL+DE, HL+2·DE) and reads HL/A/DE. Its
 * declared LIVE-OUT is memory + A / HL / B (A = start-3 8-bit, HL = start + 3·DE 16-bit,
 * B = 0); DE is preserved and the flags are dead. So it is validated on RAM (minus
 * STACK_SCRATCH) + pc + SP + those three registers via capture/clone/replay — NEVER the
 * full register file, NEVER cycles.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so the
 * harness performs ONE m.ret() on the idiomatic clone AFTER the call to line pc + SP up
 * with the oracle (which rets internally). The oracle only READS the stack (the ret pop),
 * and every fill target lies in colour RAM (0x74xx–0x77xx), far from the 0x6bxx stack, so
 * the stack region is byte-equal on both sides regardless and is excluded by the contract
 * exactly as intended. Every case runs on a FRESH clone (a reused clone is only safe for a
 * read-only leaf; this routine writes memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0514 in a real attract run and clone the
 *      machine at each true dispatch. Attract reaches it via loc_04a3 (HL=0x75C4, A=0x10,
 *      DE=0x20). Oracle vs candidate on fresh clones.
 *
 *   2. EQUAL (caller shapes) — the caller shapes attract does not exercise, reposed on a
 *      real captured base: loc_04be (A=0xDF@0x7623), loc_04f1 (A=0xEF@0x7583),
 *      loc_17b6/spawnInterludeHeart (A=0x10@0x7623) — each with the canonical DE=0x20 stride.
 *
 *   3. EQUAL (crafted edges) — the arithmetic edges: the A 8-bit dec-underflow (A=0x01 ->
 *      writes 0x01/0x00/0xFF, HL advanced 3·DE), and a non-0x20 stride (DE=0x0080) that
 *      pins DE is honored, not a hard-coded 0x20. Both on a sentinel-painted target so any
 *      missed / extra / misplaced write or wrong value bites the RAM gate.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) ascending: the value goes UP (A, A+1, A+2) instead of DOWN — caught on a
 *          sentinel entry, where cells 2 and 3 (and the final A) diverge from the oracle.
 *      (b) fixed-stride: steps by a hard-coded 0x20 regardless of DE — caught on the
 *          non-0x20-stride entry, where its writes land on the wrong cells and HL ends
 *          at start + 3·0x20 instead of start + 3·DE.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0514.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0514 as oracle } from "../../translated/loc_0514.js";
import { fillDescendingColumn } from "../fillDescendingColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0514;
const CAP_FRAMES = 1200; // attract reaches loc_04a3 -> 0x0514 well within this window
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and
 * the declared live-out registers A / HL / B. The rest of the register file and the
 * flags are deliberately NOT compared — that is the memory-equivalence gate. Returns a
 * list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if ((o.regs.a & 0xff) !== (c.regs.a & 0xff)) diffs.push(`A oracle=${hx(o.regs.a & 0xff)} cand=${hx(c.regs.a & 0xff)}`);
  if ((o.regs.hl & 0xffff) !== (c.regs.hl & 0xffff)) diffs.push(`HL oracle=${hx(o.regs.hl)} cand=${hx(c.regs.hl)}`);
  if ((o.regs.b & 0xff) !== (c.regs.b & 0xff)) diffs.push(`B oracle=${hx(o.regs.b & 0xff)} cand=${hx(c.regs.b & 0xff)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x0514 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Single runFrames() call — frame-by-frame stepping shifts NMI timing and
 * takes a different attract branch (see docs/decompiler-pipeline).
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

// -- crafted-entry builders ---------------------------------------------------

/** Clone `base` and pose HL/A/DE — a real state with a surgical register nudge. */
function poseRegs(base, { hl, a, de }) {
  const w = base.clone();
  w.regs.hl = hl & 0xffff;
  w.regs.a = a & 0xff;
  w.regs.de = de & 0xffff;
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x75) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------

/** BUG: the value ASCENDS (A, A+1, A+2) instead of descending. */
function teethAscending(m) {
  const { regs, mem } = m;
  let addr = regs.hl & 0xffff;
  let val = regs.a & 0xff;
  const stride = regs.de & 0xffff;
  for (let pass = 0; pass < 3; pass++) {
    mem.write8(addr, val);
    addr = (addr + stride) & 0xffff;
    val = (val + 1) & 0xff; // BUG: should DESCEND (val - 1)
  }
  regs.a = val;
  regs.hl = addr;
  regs.b = 0;
}

/** BUG: steps by a hard-coded 0x20, ignoring the caller's DE stride. */
function teethFixedStride(m) {
  const { regs, mem } = m;
  let addr = regs.hl & 0xffff;
  let val = regs.a & 0xff;
  for (let pass = 0; pass < 3; pass++) {
    mem.write8(addr, val);
    addr = (addr + 0x20) & 0xffff; // BUG: should be the caller's DE
    val = (val - 1) & 0xff;
  }
  regs.a = val;
  regs.hl = addr;
  regs.b = 0;
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): fillDescendingColumn == oracle on every captured 0x0514 entry", () => {
  const caps = captureDispatches(64, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x0514 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, fillDescendingColumn); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = [...new Set(caps.map((c) => `HL=${hx(c.regs.hl)} A=${hx(c.regs.a & 0xff)} DE=${hx(c.regs.de)}`))];
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; distinct shapes:\n    ` + shapes.join("\n    "));
});

// -- 2. EQUAL (caller shapes) -------------------------------------------------

test("EQUAL (caller shapes): the attract-unreached caller shapes match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const shapes = [
    { name: "loc_04a3 (live board-1)", hl: 0x75c4, a: 0x10, de: 0x0020 },
    { name: "loc_04be #1 / loc_17b6 / spawnInterludeHeart", hl: 0x7623, a: 0x10, de: 0x0020 },
    { name: "loc_04be tail (A=0xDF)", hl: 0x7623, a: 0xdf, de: 0x0020 },
    { name: "loc_04f1 (A=0xEF)", hl: 0x7583, a: 0xef, de: 0x0020 },
  ];
  for (const s of shapes) {
    const w = poseRegs(base, s);
    const diffs = contractDiffs(w, fillDescendingColumn);
    assert.equal(diffs.length, 0, `${s.name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/shapes: ${shapes.length} caller shapes — identical RAM + pc + SP + A/HL/B`);
});

// -- 3. EQUAL (crafted edges) -------------------------------------------------

test("EQUAL (crafted edges): the A dec-underflow and a non-0x20 stride match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) A 8-bit dec-underflow: A=0x01 -> writes 0x01, 0x00, 0xFF (0x00 wraps to 0xFF).
  //     Sentinel pages so the exact three values/addresses are pinned.
  {
    const w = poseRegs(base, { hl: 0x75c4, a: 0x01, de: 0x0020 });
    paintPage(w, 0x75, 0xaa);
    paintPage(w, 0x76, 0xaa);
    const diffs = contractDiffs(w, fillDescendingColumn);
    assert.equal(diffs.length, 0, `A dec-underflow: ${diffs.join("; ")}`);
  }

  // (b) Non-0x20 stride: DE=0x0080, HL=0x7440 -> writes at 0x7440, 0x74C0, 0x7540, all in
  //     colour RAM; HL ends 0x75C0. Pins that DE is honored (a fixed-0x20 rewrite fails here).
  {
    const w = poseRegs(base, { hl: 0x7440, a: 0x30, de: 0x0080 });
    paintPage(w, 0x74, 0xbb);
    paintPage(w, 0x75, 0xbb);
    const diffs = contractDiffs(w, fillDescendingColumn);
    assert.equal(diffs.length, 0, `non-0x20 stride: ${diffs.join("; ")}`);
  }

  console.log("  EQUAL/edges: A dec-underflow and non-0x20 stride — identical to the oracle");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the ascending-value twin and the fixed-stride twin are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) ascending-value caught on a sentinel entry: oracle writes 0x10/0x0F/0x0E, the twin
  //     writes 0x10/0x11/0x12, so 0x75E4 (cell 2) differs — and the final A (0x0D vs 0x13).
  const asc = poseRegs(base, { hl: 0x75c4, a: 0x10, de: 0x0020 });
  paintPage(asc, 0x75, 0xcc);
  paintPage(asc, 0x76, 0xcc);
  const dAsc = contractDiffs(asc, teethAscending);
  assert.notEqual(dAsc.length, 0, "the gate FAILED to catch the ascending-value twin — it is worthless");

  // (b) fixed-stride caught on the non-0x20-stride entry: DE=0x0080, so the oracle writes at
  //     0x7440/0x74C0/0x7540 (HL ends 0x75C0) but the twin writes at 0x7440/0x7460/0x7480
  //     (HL ends 0x74A0) — divergent cells and HL.
  const fs = poseRegs(base, { hl: 0x7440, a: 0x30, de: 0x0080 });
  paintPage(fs, 0x74, 0xdd);
  paintPage(fs, 0x75, 0xdd);
  const dFixed = contractDiffs(fs, teethFixedStride);
  assert.notEqual(dFixed.length, 0, "the gate FAILED to catch the fixed-stride twin — it is worthless");

  console.log(
    `  TEETH: ascending-value caught (${dAsc[0]}); fixed-stride caught (${dFixed[0]})`,
  );
});
