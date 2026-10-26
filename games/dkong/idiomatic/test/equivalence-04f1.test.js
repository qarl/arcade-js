// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for paintColorColumnAndBlinkOff (ROM 0x04f1) — the rivet-board
 * colour-cycle arm: preset A=0xEF, paint a 3-cell descending colour column at 0x7583
 * (stride DE live-in), then FALL INTO loc_04f9 (blink OFF) to clear bit 7 of the two
 * decorative-sprite code bytes 0x6901 and 0x6905 (record 1 via the shared store tail).
 *
 * loc_04f1 WRITES memory (three colour cells via sub_0514, plus 0x6901/0x6905 via the
 * blink-off arm) and reads registers live-in (DE = the fill stride, C = the store's toggle
 * phase; it sets its own A and HL). Its declared LIVE-OUT is memory-only — the exit tail is
 * memory-only and its caller reads no register afterward — so it is validated on RAM (minus
 * STACK_SCRATCH) + pc + SP via capture/clone/replay. NEVER the full register file, NEVER
 * cycles.
 *
 * The idiomatic routine models the Z80 stack as the JS call stack (no push16/ret of its
 * own), so the harness performs ONE m.ret() on the idiomatic clone after the call to line
 * pc + SP up with the oracle. The oracle's net stack effect is exactly one return: it
 * push16s a link address, sub_0514 rets it back, then it falls into loc_04f9 -> loc_04ac
 * which rets the caller's address — push + two rets = one net pop. The oracle's pushed link
 * byte lands in STACK_SCRATCH (excluded by the contract) and is set/read identically per
 * side. Every case runs on a FRESH clone (a reused clone is only safe for a read-only leaf;
 * this routine writes memory).
 *
 * loc_04f1 is NOT reached in attract (asserted below: 0 real dispatches over the capture
 * run — the 100m rivet board and the X >= 0x80 arm are cold in a 25m attract). So realism
 * comes from crafted entries reposed on real captured colour-cycle bases: hook the reached
 * sibling 0x04a3, whose captured machine carries a genuine in-play colour page, sprite
 * buffer, sweep counter C, and DE = 0x20.
 *
 *   1. CRAFTED (real bases) — over captured 0x04a3 bases x a (v1,v5,C) matrix at the live
 *      DE=0x20 shape: (a) the oracle's write footprint is a subset of the five cells
 *      {0x7583, 0x75A3, 0x75C3, 0x6901, 0x6905}; (b) arms exercised — the colour cells become
 *      0xEF/0xEE/0xED, bit 7 is cleared on both sprite bytes, and the toggle store arm occurs;
 *      (c) a fresh-clone whole-contract diff (RAM − the stack scratch below the entry SP + pc + SP) is empty.
 *
 *   2. CRAFTED (unreached arms) — the once-per-sweep tile-toggle store ((C & 0x47) == 0x40,
 *      verified to genuinely XOR 0x03 at 0x6905) and a non-0x20 stride (DE=0x0080 -> the fill
 *      lands at 0x7583/0x7603/0x7683), pinning DE is honored end-to-end.
 *
 *   3. TEETH — two deliberately-broken twins, one per half, each MUST be caught:
 *      (a) wrong-column: paints 0x7580 instead of 0x7583, so the colour cells diverge.
 *      (b) blink-ON: forces bit 7 SET (OR 0x80) instead of clear (AND 0x7F), so the sprite
 *          code bytes' bit 7 diverges.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04f1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04f1 as oracle } from "../../translated/loc_04f1.js";
import { loc_04a3 as oracle04a3 } from "../../translated/loc_04a3.js";
import { paintColorColumnAndBlinkOff } from "../paintColorColumnAndBlinkOff.js";
import { fillDescendingColumn } from "../fillDescendingColumn.js";
import { blinkSpritePairOff } from "../blinkSpritePairOff.js";
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

const TARGET = 0x04f1; // the routine under test — NOT reached in attract
const CAP_TARGET = 0x04a3; // the reached sibling we hook for realistic colour-cycle bases
const CAP_FRAMES = 1200; // attract reaches loc_0486 -> 0x04a3 well within this window

const COLOR_COLUMN_TOP = 0x7583;
const SPRITE0_CODE = SPRITE_BUFFER + 1; // 0x6901 — record #0's code byte
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905 — record #1's code byte

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// The three colour cells the fill lays down for a given stride, and their descending values.
const colorCells = (de) => [
  COLOR_COLUMN_TOP,
  (COLOR_COLUMN_TOP + de) & 0xffff,
  (COLOR_COLUMN_TOP + 2 * de) & 0xffff,
];
const COLOR_VALUES = [0xef, 0xee, 0xed]; // A, A-1, A-2 with A = 0xEF

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

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. The
 * register file and flags are deliberately NOT compared — live-out is memory-only.
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

/** Every RAM addr (outside the stack scratch below the entry SP) whose byte the oracle changed on `entry`. */
function oracleWriteFootprint(entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const m = entry.clone();
  const before = m.dumpState();
  oracle(m);
  const after = m.dumpState();
  const addrs = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const addr = m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    addrs.push(addr);
  }
  return addrs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook the reached sibling 0x04a3 for realistic bases AND the unreached target 0x04f1 to
 * count its dispatches, in ONE attract run. The 0x04a3 wrapper snapshots the entry state
 * then runs its own oracle so the host proceeds undisturbed; the 0x04f1 wrapper counts (and
 * would run its oracle if ever hit). Single runFrames() call — frame-by-frame stepping
 * shifts NMI timing and takes a different attract branch (see docs/decompiler-pipeline).
 */
function captureRun(K, maxFrames) {
  const caps = [];
  let reachedTarget = 0;
  const overrides = new Map([
    [CAP_TARGET, (mm) => {
      if (caps.length < K) caps.push(mm.clone());
      return oracle04a3(mm);
    }],
    [TARGET, (mm) => {
      reachedTarget++;
      return oracle(mm);
    }],
  ]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return { caps, reachedTarget };
}

// -- crafted-entry builders ---------------------------------------------------

/** Clone `base` and pose the live-in registers DE / C plus the two sprite code bytes. */
function pose(base, { de, c, v1, v5 }) {
  const w = base.clone();
  if (de !== undefined) w.regs.de = de & 0xffff;
  if (c !== undefined) w.regs.c = c & 0xff;
  if (v1 !== undefined) w.mem.write8(SPRITE0_CODE, v1 & 0xff);
  if (v5 !== undefined) w.mem.write8(SPRITE1_CODE, v5 & 0xff);
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x75) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------
// Each twin reuses the real fill/store semantics for the half it does NOT break, so the only
// divergence is the injected bug.

/** BUG: paints the colour column at 0x7580 instead of 0x7583 (wrong cells). */
function teethWrongColumn(m) {
  const { regs } = m;
  regs.a = 0xef;
  regs.hl = 0x7580; // BUG: should be 0x7583
  fillDescendingColumn(m);
  blinkSpritePairOff(m);
}

/**
 * BUG: forces the flip/visibility bit SET (OR 0x80, "blink ON") instead of clear (AND 0x7F,
 * "blink OFF") on both sprite code bytes — the wrong blink arm. bit 7 of 0x6901/0x6905
 * diverges from the oracle unconditionally.
 */
function teethBlinkOn(m) {
  const { regs, mem } = m;
  regs.a = 0xef;
  regs.hl = COLOR_COLUMN_TOP;
  fillDescendingColumn(m);
  mem.write8(SPRITE0_CODE, mem.read8(SPRITE0_CODE) | 0x80); // BUG: OR 0x80, not AND 0x7F
  regs.a = mem.read8(SPRITE1_CODE) | 0x80; // BUG: OR 0x80, not AND 0x7F
  storeBlinkSpriteCode(m);
}

// -- 0. REACHABILITY + 1. CRAFTED (real bases) --------------------------------

test("CRAFTED (real bases): unreached in attract; crafted 0x04f1 entries on real 0x04a3 bases match the oracle", () => {
  const { caps, reachedTarget } = captureRun(6, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x04a3 dispatch to use as a realistic base");
  assert.equal(reachedTarget, 0, `loc_04f1 was dispatched ${reachedTarget}x in attract — expected 0 (unreached)`);

  const V1S = [0x00, 0x0a, 0x80, 0xff];
  const V5S = [0x00, 0x03, 0x80, 0xff];
  const CS = [0x00, 0x40]; // non-toggle + toggle-phase store
  const de = 0x0020;
  const allowed = new Set([...colorCells(de), SPRITE0_CODE, SPRITE1_CODE]);

  let cases = 0;
  let sawBit7Cleared = 0;
  let sawToggle = 0;
  for (const base of caps) {
    for (const c of CS) {
      for (const v1 of V1S) {
        for (const v5 of V5S) {
          const w = pose(base, { de, c, v1, v5 });

          // (a) FOOTPRINT: the oracle touches only the five cells this routine owns.
          for (const addr of oracleWriteFootprint(w)) {
            assert.ok(allowed.has(addr), `oracle wrote RAM at ${hx(addr)} (outside the 5-cell set) — model wrong`);
          }

          // (b) ARMS EXERCISED: colour cells 0xEF/0xEE/0xED; bit 7 cleared on both sprite bytes.
          const oc = w.clone();
          oracle(oc);
          const [c0, c1, c2] = colorCells(de);
          assert.equal(oc.mem.read8(c0) & 0xff, COLOR_VALUES[0], `colour cell ${hx(c0)} wrong`);
          assert.equal(oc.mem.read8(c1) & 0xff, COLOR_VALUES[1], `colour cell ${hx(c1)} wrong`);
          assert.equal(oc.mem.read8(c2) & 0xff, COLOR_VALUES[2], `colour cell ${hx(c2)} wrong`);
          assert.equal(oc.mem.read8(SPRITE0_CODE) & 0x80, 0, `blink bit not cleared on 0x6901 (v1=${hb(v1)})`);
          assert.equal(oc.mem.read8(SPRITE1_CODE) & 0x80, 0, `blink bit not cleared on 0x6905 (v5=${hb(v5)})`);
          if (v1 & 0x80) sawBit7Cleared++;
          if ((c & 0x47) === 0x40) sawToggle++;

          // (c) REALISM: fresh-clone whole-contract diff (RAM − STACK, pc, SP) is empty.
          const diffs = contractDiffs(w, paintColorColumnAndBlinkOff);
          assert.equal(diffs.length, 0, `v1=${hb(v1)} v5=${hb(v5)} c=${hb(c)}: ${diffs.join("; ")}`);
          cases++;
        }
      }
    }
  }
  assert.ok(sawBit7Cleared >= 1, "expected at least one sprite byte with bit 7 set to be cleared (arm exercised)");
  assert.ok(sawToggle >= 1, "expected the store tail's toggle arm ((C & 0x47) == 0x40) to be exercised");
  console.log(
    `  CRAFTED/real: ${cases} crafted entries on ${caps.length} real 0x04a3 bases — footprint ⊆ 5 cells, ` +
      `whole-contract identical (0x04f1 unreached: ${reachedTarget} dispatches)`,
  );
});

// -- 2. CRAFTED (unreached arms) ----------------------------------------------

test("CRAFTED (arms): the toggle-phase store and a non-0x20 stride match the oracle", () => {
  const { caps } = captureRun(1, CAP_FRAMES);
  const [base] = caps;
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) Once-per-sweep tile-toggle store: (C & 0x47) == 0x40 makes the tail XOR 0x03 into
  //     0x6905. Verify the oracle genuinely takes the toggle path (0x6905 = (v5 & 0x7f) ^ 0x03).
  {
    const v5 = 0x80;
    const w = pose(base, { de: 0x0020, c: 0x40, v1: 0x80, v5 });
    const oc = w.clone();
    oracle(oc);
    assert.equal(
      oc.mem.read8(SPRITE1_CODE) & 0xff,
      ((v5 & 0x7f) ^ 0x03) & 0xff,
      "toggle store arm not exercised for C=0x40 (0x6905 was not (v5 & 0x7f) ^ 0x03)",
    );
    const diffs = contractDiffs(w, paintColorColumnAndBlinkOff);
    assert.equal(diffs.length, 0, `toggle-phase store: ${diffs.join("; ")}`);
  }

  // (b) Non-0x20 stride: DE=0x0080 -> the fill lands at 0x7583/0x7603/0x7683. Pins that DE is
  //     honored end-to-end (a fixed-0x20 fill would write the wrong colour cells).
  {
    const de = 0x0080;
    const w = pose(base, { de, c: 0x00, v1: 0x00, v5: 0x00 });
    paintPage(w, 0x75, 0xbb);
    paintPage(w, 0x76, 0xbb);
    const oc = w.clone();
    oracle(oc);
    const [c0, c1, c2] = colorCells(de);
    assert.equal(oc.mem.read8(c0) & 0xff, COLOR_VALUES[0], `non-0x20 colour cell ${hx(c0)} wrong`);
    assert.equal(oc.mem.read8(c1) & 0xff, COLOR_VALUES[1], `non-0x20 colour cell ${hx(c1)} wrong`);
    assert.equal(oc.mem.read8(c2) & 0xff, COLOR_VALUES[2], `non-0x20 colour cell ${hx(c2)} wrong`);
    const diffs = contractDiffs(w, paintColorColumnAndBlinkOff);
    assert.equal(diffs.length, 0, `non-0x20 stride: ${diffs.join("; ")}`);
  }

  console.log("  CRAFTED/arms: toggle-phase store and non-0x20 stride — identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-column twin and the blink-ON twin are CAUGHT", () => {
  const { caps } = captureRun(1, CAP_FRAMES);
  const [base] = caps;
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) wrong-column: oracle writes 0x7583/0x75A3/0x75C3; the twin writes 0x7580/0x75A0/
  //     0x75C0. On a sentinel page the untouched real cells diverge from the oracle's.
  const wc = pose(base, { de: 0x0020, c: 0x00, v1: 0x0a, v5: 0x0a });
  paintPage(wc, 0x75, 0xcc);
  const dWrong = contractDiffs(wc, teethWrongColumn);
  assert.notEqual(dWrong.length, 0, "the gate FAILED to catch the wrong-column twin — it is worthless");

  // (b) blink-ON: oracle clears bit 7 of 0x6901/0x6905; the twin sets it. With sprite bytes
  //     posed bit-7 clear, the oracle leaves them clear and the twin sets bit 7 -> divergence.
  const bo = pose(base, { de: 0x0020, c: 0x00, v1: 0x0a, v5: 0x0a });
  const dBlink = contractDiffs(bo, teethBlinkOn);
  assert.notEqual(dBlink.length, 0, "the gate FAILED to catch the blink-ON twin — it is worthless");

  console.log(`  TEETH: wrong-column caught (${dWrong[0]}); blink-ON caught (${dBlink[0]})`);
});
