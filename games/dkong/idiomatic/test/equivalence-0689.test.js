// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stampTwoDigitField (ROM 0x0689) — the shared two-cell stamp tail of the
 * BCD field writer renderBonusDisplay: the high-digit tile (incoming A) into 0x74E6 (written first), then
 * the low-digit tile (incoming B) into 0x74C6, one screen column earlier on the rotated tilemap.
 *
 * loc_0689 WRITES two video-RAM cells and reads its two tiles from registers live-in (A, B). It
 * reads NO RAM and calls nothing. Its declared LIVE-OUT is memory-only (A ends = B, but the
 * caller reads no register afterward, and it sets no flag), so it is validated on RAM (minus
 * STACK_SCRATCH) + pc + SP via capture/clone/replay. NEVER the full register file, NEVER cycles.
 *
 * The idiomatic routine models the Z80 stack as the JS call stack (no ret of its own), so the
 * harness performs ONE m.ret() on the candidate clone to line pc + SP up with the oracle. The
 * oracle's net stack effect is exactly that one `ret` (the 0x0690 return; nothing is pushed).
 * Every case runs on a FRESH clone (the routine writes memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0689 in a real attract run and clone at each true
 *      dispatch (task entry 10 renders the two-digit field), spanning distinct digit pairs.
 *      Oracle vs candidate on fresh clones, whole contract.
 *
 *   2. CRAFTED — reposed on a real capture: the leading-zero-suppress high tile A=0x10 (renderBonusDisplay's
 *      suppress arm), and an arbitrary A != B sentinel pair, each on a sentinel-painted 0x74 page
 *      so the exact stored bytes and cells are pinned.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on a sentinel-painted entry:
 *      (a) wrong-cell: stamps the high tile at 0x74E4 instead of 0x74E6.
 *      (b) duplicate: stamps the high tile into BOTH cells (drops the low tile) — caught on an
 *          A != B entry where 0x74C6 should hold B.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0689.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0689 as oracle } from "../../translated/loc_0689.js";
import { stampTwoDigitField } from "../stampTwoDigitField.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0689;
const CAP_FRAMES = 2000; // task entry 10 renders the field a dozen times within this window
const HIGH_DIGIT_CELL = 0x74e6;
const LOW_DIGIT_CELL = 0x74c6;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the one return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/** Hook 0x0689 in a real attract run and clone the machine at up to K real dispatches. */
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

/** Clone `base` and pose the two tile registers A / B — a real state, surgical nudge. */
function poseRegs(base, { a, b }) {
  const w = base.clone();
  if (a !== undefined) w.regs.a = a & 0xff;
  if (b !== undefined) w.regs.b = b & 0xff;
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x74) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------

/** BUG: stamps the high tile at 0x74E4 instead of 0x74E6. */
function teethWrongCell(m) {
  const { regs, mem } = m;
  mem.write8(0x74e4, regs.a); // BUG: should be 0x74E6
  regs.a = regs.b;
  mem.write8(LOW_DIGIT_CELL, regs.a);
}

/** BUG: stamps the high tile into BOTH cells (drops the `ld a,b`, losing the low tile). */
function teethDuplicate(m) {
  const { regs, mem } = m;
  mem.write8(HIGH_DIGIT_CELL, regs.a);
  mem.write8(LOW_DIGIT_CELL, regs.a); // BUG: should write B, not A
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): stampTwoDigitField == oracle on every captured 0x0689 entry", () => {
  const caps = captureDispatches(256, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x0689 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, stampTwoDigitField); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = [...new Set(caps.map((c) => `A=${hb(c.regs.a)} B=${hb(c.regs.b)}`))];
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; distinct in-shapes:\n    ` + shapes.join("\n    "));
});

// -- 2. CRAFTED ---------------------------------------------------------------

test("CRAFTED: the suppress-arm A=0x10 tile and an A!=B sentinel pair match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) leading-zero-suppress high tile (renderBonusDisplay enters here with A=0x10, a blank tile).
  {
    const w = poseRegs(base, { a: 0x10, b: 0x07 });
    paintPage(w, 0x74, 0xaa);
    const diffs = contractDiffs(w, stampTwoDigitField);
    assert.equal(diffs.length, 0, `A=0x10 suppress arm: ${diffs.join("; ")}`);
  }

  // (b) arbitrary A != B pair, sentinel page so both distinct stores are pinned.
  {
    const w = poseRegs(base, { a: 0x5a, b: 0xa5 });
    paintPage(w, 0x74, 0xbb);
    const diffs = contractDiffs(w, stampTwoDigitField);
    assert.equal(diffs.length, 0, `A!=B pair: ${diffs.join("; ")}`);
    // Sanity: confirm the oracle really wrote the two distinct tiles into the two cells.
    const oc = w.clone();
    oracle(oc);
    assert.equal(oc.mem.read8(HIGH_DIGIT_CELL) & 0xff, 0x5a, "high cell != A");
    assert.equal(oc.mem.read8(LOW_DIGIT_CELL) & 0xff, 0xa5, "low cell != B");
  }

  console.log("  CRAFTED: A=0x10 suppress arm and an A!=B sentinel pair — identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-cell twin and the duplicate twin are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) wrong-cell: oracle writes 0x74E6; the twin writes 0x74E4, so on a sentinel page the two
  //     cells diverge from the oracle's.
  const wc = poseRegs(base, { a: 0x5a, b: 0xa5 });
  paintPage(wc, 0x74, 0xcc);
  const dWrong = contractDiffs(wc, teethWrongCell);
  assert.notEqual(dWrong.length, 0, "the gate FAILED to catch the wrong-cell twin — it is worthless");

  // (b) duplicate: on an A != B entry the oracle stores B into 0x74C6 but the twin stores A, so
  //     the low cell diverges.
  const dp = poseRegs(base, { a: 0x5a, b: 0xa5 });
  paintPage(dp, 0x74, 0xdd);
  const dDup = contractDiffs(dp, teethDuplicate);
  assert.notEqual(dDup.length, 0, "the gate FAILED to catch the duplicate twin — it is worthless");

  console.log(`  TEETH: wrong-cell caught (${dWrong[0]}); duplicate caught (${dDup[0]})`);
});
