// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for paintColorColumnAndHoldBlink (ROM 0x04a3) — the colour-cycle
 * blink driver's "leave-as-is" arm: paint a 3-cell descending colour column at 0x75C4
 * (fill value A + stride DE live-in), then commit sprite record #1's code (0x6905)
 * unchanged through the shared blink-store tail loc_04ac.
 *
 * loc_04a3 WRITES memory (three colour cells via sub_0514, plus 0x6905 via loc_04ac) and
 * reads registers live-in (A = fill value, DE = stride, C = the store's toggle phase). Its
 * declared LIVE-OUT is memory-only — the tail loc_04ac is memory-only and its caller reads
 * no register afterward — so it is validated on RAM (minus the stack scratch below the entry SP) + pc + SP via
 * capture/clone/replay. NEVER the full register file, NEVER cycles.
 *
 * The idiomatic routine models the Z80 stack as the JS call stack (no push16/ret of its
 * own), so the harness performs ONE m.ret() on the idiomatic clone after the call to line
 * pc + SP up with the oracle. The oracle's net stack effect is exactly one return: it
 * push16s a link address, sub_0514 rets it back, then it falls into loc_04ac which rets
 * the caller's address — push + two rets = one net pop. The oracle's pushed link byte
 * lands in STACK_SCRATCH (excluded by the contract) and is set/read identically per side.
 * Every case runs on a FRESH clone (a reused clone is only safe for a read-only leaf; this
 * routine writes memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x04a3 in a real attract run and clone the
 *      machine at each true dispatch. Attract reaches it via loc_0486 (HL set to 0x75C4,
 *      A=0x10, DE=0x20). Oracle vs candidate on fresh clones, whole contract.
 *
 *   2. CRAFTED (unreached arms) — reposed on a real captured base: the A=0xEF sweep-phase
 *      fill value (loc_0486's bit-6 arm), the once-per-sweep tile-toggle store phase
 *      ((C & 0x47) == 0x40, verified to genuinely XOR 0x03 at 0x6905), and a non-0x20
 *      stride (DE=0x0080) that pins DE is honored — each on sentinel-painted targets.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on a sentinel entry:
 *      (a) wrong-column: paints 0x75C0 instead of 0x75C4, so the colour cells diverge.
 *      (b) always-toggle: XORs 0x6905 unconditionally (ignoring the phase gate), so on a
 *          non-toggle entry (C=0x00) the sprite code's low two bits diverge.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04a3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04a3 as oracle } from "../../translated/loc_04a3.js";
import { paintColorColumnAndHoldBlink } from "../paintColorColumnAndHoldBlink.js";
import { fillDescendingColumn } from "../fillDescendingColumn.js";
import { storeBlinkSpriteCode } from "../storeBlinkSpriteCode.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x04a3;
const CAP_FRAMES = 1200; // attract reaches loc_0486 -> 0x04a3 well within this window
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905
const COLOR_COLUMN_TOP = 0x75c4;

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

/** Run the ORACLE on a fresh clone. It performs its own net `ret`, so pc/SP advance. */
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
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. The
 * register file and flags are deliberately NOT compared — live-out is memory-only. Returns
 * a list of human-readable mismatches (empty when equal).
 */
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

/**
 * Hook 0x04a3 in a real attract run and clone the machine at up to K real dispatches.
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

/** Clone `base` and pose the live-in registers A / DE / C — a real state, surgical nudge. */
function poseRegs(base, { a, de, c }) {
  const w = base.clone();
  if (a !== undefined) w.regs.a = a & 0xff;
  if (de !== undefined) w.regs.de = de & 0xffff;
  if (c !== undefined) w.regs.c = c & 0xff;
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x75) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------

// The twins reuse the real fill/store semantics for the parts they do NOT break, so the
// only divergence is the injected bug.

/** BUG: paints the colour column at 0x75C0 instead of 0x75C4 (wrong cells). */
function teethWrongColumn(m) {
  const { regs, mem } = m;
  regs.hl = 0x75c0; // BUG: should be 0x75C4
  fillDescendingColumn(m);
  regs.a = mem.read8(SPRITE1_CODE);
  storeBlinkSpriteCode(m);
}

function teethAlwaysToggle(m) {
  const { regs, mem } = m;
  regs.hl = COLOR_COLUMN_TOP;
  fillDescendingColumn(m);
  const code = mem.read8(SPRITE1_CODE);
  mem.write8(SPRITE1_CODE, code ^ 0x03); // BUG: unconditional toggle, no (C & 0x47)==0x40 gate
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): paintColorColumnAndHoldBlink == oracle on every captured 0x04a3 entry", () => {
  const caps = captureDispatches(256, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x04a3 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, paintColorColumnAndHoldBlink); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = [...new Set(caps.map((c) => `A=${hb(c.regs.a)} DE=${hx(c.regs.de)} C=${hb(c.regs.c)}`))];
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; distinct in-shapes:\n    ` + shapes.join("\n    "));
});

// -- 2. CRAFTED (unreached arms) ----------------------------------------------

test("CRAFTED: the A=0xEF fill, the toggle-phase store, and a non-0x20 stride match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) A=0xEF sweep-phase fill value (loc_0486's bit-6 arm). Sentinel the colour pages so
  //     the exact three descending values (0xEF/0xEE/0xED) and addresses are pinned.
  {
    const w = poseRegs(base, { a: 0xef, de: 0x0020 });
    paintPage(w, 0x75, 0xaa);
    paintPage(w, 0x76, 0xaa);
    const diffs = contractDiffs(w, paintColorColumnAndHoldBlink);
    assert.equal(diffs.length, 0, `A=0xEF arm: ${diffs.join("; ")}`);
  }

  // (b) Once-per-sweep tile-toggle store phase: (C & 0x47) == 0x40 makes loc_04ac XOR 0x03
  //     into 0x6905. Verify the oracle genuinely takes the toggle path here, then match.
  {
    const w = poseRegs(base, { a: 0x10, de: 0x0020, c: 0x40 });
    const before = w.mem.read8(SPRITE1_CODE) & 0xff;
    const oc = w.clone();
    oracle(oc);
    assert.equal(
      oc.mem.read8(SPRITE1_CODE) & 0xff,
      (before ^ 0x03) & 0xff,
      "toggle store arm not exercised for C=0x40 (0x6905 was not XORed 0x03)",
    );
    const diffs = contractDiffs(w, paintColorColumnAndHoldBlink);
    assert.equal(diffs.length, 0, `toggle-phase store: ${diffs.join("; ")}`);
  }

  // (c) Non-0x20 stride: DE=0x0080 -> the fill lands at 0x75C4/0x7644/0x76C4. Pins that DE
  //     is honored end-to-end (a fixed-0x20 fill would write the wrong cells / HL).
  {
    const w = poseRegs(base, { a: 0x30, de: 0x0080 });
    paintPage(w, 0x75, 0xbb);
    paintPage(w, 0x76, 0xbb);
    const diffs = contractDiffs(w, paintColorColumnAndHoldBlink);
    assert.equal(diffs.length, 0, `non-0x20 stride: ${diffs.join("; ")}`);
  }

  console.log("  CRAFTED: A=0xEF fill, toggle-phase store, and non-0x20 stride — identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-column twin and the always-toggle twin are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) wrong-column: oracle writes 0x75C4/0x75E4/0x7604; the twin writes 0x75C0/0x75E0/
  //     0x7600. On a sentinel page the untouched real cells diverge from the oracle's.
  const wc = poseRegs(base, { a: 0x10, de: 0x0020 });
  paintPage(wc, 0x75, 0xcc);
  paintPage(wc, 0x76, 0xcc);
  const dWrong = contractDiffs(wc, teethWrongColumn);
  assert.notEqual(dWrong.length, 0, "the gate FAILED to catch the wrong-column twin — it is worthless");

  // (b) always-toggle: on a non-toggle phase (C=0x00) the oracle stores 0x6905 unchanged,
  //     but the twin XORs 0x03 — so the sprite code's low two bits diverge. Sentinel 0x6905
  //     so the exact stored byte is pinned (0x5A vs 0x59).
  const at = poseRegs(base, { a: 0x10, de: 0x0020, c: 0x00 });
  at.mem.write8(SPRITE1_CODE, 0x5a);
  const dTog = contractDiffs(at, teethAlwaysToggle);
  assert.notEqual(dTog.length, 0, "the gate FAILED to catch the always-toggle twin — it is worthless");

  console.log(`  TEETH: wrong-column caught (${dWrong[0]}); always-toggle caught (${dTog[0]})`);
});
