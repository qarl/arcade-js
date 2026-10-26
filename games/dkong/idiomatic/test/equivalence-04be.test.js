// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runRivetColorCycleBlink (ROM 0x04be) — the rivet-board branch of the
 * per-frame colour-cycle blink driver. It unconditionally repaints two 3-cell descending
 * colour columns (A at 0x7623, B at 0x7583, the descending value carried across the pair, at
 * the live-in one-row stride), then routes the decorative sprite-pair blink three ways on the
 * sweep counter's phase bit and Mario's screen half:
 *
 *   - phase bit clear                 -> blinkSpritePairByX (blink by X, no repaint)
 *   - phase bit set, X >= 128 (right) -> paintColorColumnAndBlinkOff (repaint B, blink OFF)
 *   - phase bit set, X <  128 (left)  -> repaint A brighter (223..) then blinkSpritePairOn
 *
 * The routine WRITES memory (six colour cells, a third of them repainted on two arms, plus the
 * two sprite code bytes 0x6901/0x6905) and reads two register live-ins (the sweep counter and
 * the stride) plus Mario's X. Its declared LIVE-OUT is memory-only, so it is validated on RAM
 * (minus the stack scratch below the entry SP) + pc + SP via capture/clone/replay. NEVER the full register file,
 * NEVER cycles.
 *
 * The idiomatic routine models the Z80 stack as the JS call stack (no push/ret of its own), so
 * the harness performs ONE m.ret() on the candidate clone after the call to line pc + SP up
 * with the oracle. The oracle's net stack effect on every arm is exactly one return: each
 * internal fill pushes a link and returns it (net zero), and the tail hand-off eventually
 * returns the caller's own address (one net pop). Every case runs on a FRESH clone (a reused
 * clone is only safe for a read-only leaf; this routine writes memory).
 *
 * loc_04be is NOT reached in attract (asserted below: 0 real dispatches — the 100m rivet board
 * is cold in a 25m attract). So realism comes from crafted entries reposed on real captured
 * colour-cycle bases: hook the reached sibling 0x04a3, whose captured machine carries a genuine
 * in-play colour page, sprite buffer, sweep counter and one-row stride.
 *
 *   1. CRAFTED (real bases) — over captured 0x04a3 bases x a (sweep, X, v1, v5) matrix at the
 *      live one-row stride: (a) the oracle's write footprint is a subset of the eight cells it
 *      owns; (b) all three arms and both blink sub-arms run (blink cleared, blink set, column A
 *      and column B each repainted brighter); (c) a fresh-clone whole-contract diff (RAM −
 *      STACK_SCRATCH + pc + SP) is empty.
 *
 *   2. CRAFTED (arms) — a non-one-row stride (pins the stride is honoured end to end) and a
 *      toggle-phase sweep counter (drives the store tail's once-per-sweep tile toggle) match
 *      the oracle.
 *
 *   3. TEETH — three deliberately-broken twins, one per decision point, each MUST be caught:
 *      (a) wrong-phase-bit: reads bit 5 instead of bit 6 to split the phase.
 *      (b) boundary-flipped X: uses ">" instead of ">=" at the 128 screen-half split.
 *      (c) dropped-second-column: skips the unconditional column-B repaint.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-04be.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04be as oracle } from "../../translated/loc_04be.js";
import { loc_04a3 as oracle04a3 } from "../../translated/loc_04a3.js";
import { runRivetColorCycleBlink } from "../runRivetColorCycleBlink.js";
import { fillDescendingColumn } from "../fillDescendingColumn.js";
import { blinkSpritePairByX } from "../blinkSpritePairByX.js";
import { paintColorColumnAndBlinkOff } from "../paintColorColumnAndBlinkOff.js";
import { blinkSpritePairOn } from "../blinkSpritePairOn.js";
import { Machine } from "../../machine.js";
import { SPRITE_BUFFER, STACK_SCRATCH, MARIO_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x04be; // the routine under test — NOT reached in attract
const CAP_TARGET = 0x04a3; // the reached sibling we hook for realistic colour-cycle bases
const CAP_FRAMES = 1500; // attract reaches loc_0486 -> 0x04a3 well within this window

const COLUMN_A_TOP = 0x7623;
const COLUMN_B_TOP = 0x7583;
const SPRITE0_CODE = SPRITE_BUFFER + 1; // 0x6901 — record #0's code byte
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905 — record #1's code byte

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// The three cells a fill lays down from a given top at a given stride.
const cells = (top, de) => [top, (top + de) & 0xffff, (top + 2 * de) & 0xffff];

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
 * Hook the reached sibling 0x04a3 for realistic bases AND the unreached target 0x04be to count
 * its dispatches, in ONE attract run. The 0x04a3 wrapper snapshots the entry state then runs its
 * own oracle so the host proceeds undisturbed; the 0x04be wrapper counts (and would run its
 * oracle if ever hit). Single runFrames() call — frame-by-frame stepping shifts NMI timing.
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

// -- crafted-entry builder ----------------------------------------------------

/** Clone `base` and pose the live-in registers (sweep counter, stride), Mario's X, and the two
 *  sprite code bytes. */
function pose(base, { de, sweep, x, v1, v5 }) {
  const w = base.clone();
  if (de !== undefined) w.regs.de = de & 0xffff;
  if (sweep !== undefined) w.regs.c = sweep & 0xff;
  if (x !== undefined) w.mem.write8(MARIO_X, x & 0xff);
  if (v1 !== undefined) w.mem.write8(SPRITE0_CODE, v1 & 0xff);
  if (v5 !== undefined) w.mem.write8(SPRITE1_CODE, v5 & 0xff);
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x75) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// -- broken twins -------------------------------------------------------------
// Each twin reuses the real fill/blink callees so the only divergence is the injected bug.

function paintBothColumns(m) {
  const { regs } = m;
  regs.a = 16;
  regs.hl = COLUMN_A_TOP;
  fillDescendingColumn(m);
  regs.hl = COLUMN_B_TOP;
  fillDescendingColumn(m);
}

/** BUG: splits the phase on bit 5 (0x20) instead of bit 6 (0x40) of the sweep counter. */
function teethWrongPhaseBit(m) {
  const { regs, mem } = m;
  paintBothColumns(m);
  if ((regs.c & 0x20) === 0) { blinkSpritePairByX(m); return; } // BUG: 0x20, should be 0x40
  if (mem.read8(MARIO_X) >= 128) { paintColorColumnAndBlinkOff(m); return; }
  regs.a = 223;
  regs.hl = COLUMN_A_TOP;
  fillDescendingColumn(m);
  blinkSpritePairOn(m);
}

/** BUG: uses ">" instead of ">=" at the 128 screen-half split, mis-routing exactly at X == 128. */
function teethBoundaryX(m) {
  const { regs, mem } = m;
  paintBothColumns(m);
  if ((regs.c & 0x40) === 0) { blinkSpritePairByX(m); return; }
  if (mem.read8(MARIO_X) > 128) { paintColorColumnAndBlinkOff(m); return; } // BUG: > should be >=
  regs.a = 223;
  regs.hl = COLUMN_A_TOP;
  fillDescendingColumn(m);
  blinkSpritePairOn(m);
}

/** BUG: skips the unconditional second (column-B) repaint. */
function teethDropSecondColumn(m) {
  const { regs, mem } = m;
  regs.a = 16;
  regs.hl = COLUMN_A_TOP;
  fillDescendingColumn(m); // paints column A only — the column-B fill is dropped
  if ((regs.c & 0x40) === 0) { blinkSpritePairByX(m); return; }
  if (mem.read8(MARIO_X) >= 128) { paintColorColumnAndBlinkOff(m); return; }
  regs.a = 223;
  regs.hl = COLUMN_A_TOP;
  fillDescendingColumn(m);
  blinkSpritePairOn(m);
}

// -- 0. REACHABILITY + 1. CRAFTED (real bases) --------------------------------

test("CRAFTED (real bases): unreached in attract; crafted 0x04be entries on real 0x04a3 bases match the oracle", () => {
  const { caps, reachedTarget } = captureRun(6, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x04a3 dispatch to use as a realistic base");
  assert.equal(reachedTarget, 0, `loc_04be was dispatched ${reachedTarget}x in attract — expected 0 (unreached)`);

  const de = 0x0020; // the live one-row stride the driver stages
  // sweep phases: bit 6 clear (arm a) x2, bit 6 set incl. toggle-phase (arms b/c).
  const SWEEPS = [0x00, 0x07, 0x40, 0x41, 0x60];
  // X: left half, exact boundary (right), right half.
  const XS = [0x00, 0x7f, 0x80, 0x81, 0xff];
  const V1S = [0x00, 0x0a, 0x80, 0xff];
  const V5S = [0x00, 0x03, 0x80, 0xff];

  const colA = cells(COLUMN_A_TOP, de);
  const colB = cells(COLUMN_B_TOP, de);
  const allowed = new Set([...colA, ...colB, SPRITE0_CODE, SPRITE1_CODE]);

  let cases = 0;
  let sawBlinkCleared = 0, sawBlinkSet = 0, sawRepaintA = 0, sawRepaintB = 0;
  for (const base of caps) {
    for (const sweep of SWEEPS) {
      for (const x of XS) {
        for (const v1 of V1S) {
          for (const v5 of V5S) {
            const w = pose(base, { de, sweep, x, v1, v5 });

            // (a) FOOTPRINT: the oracle touches only the eight cells this routine owns.
            for (const addr of oracleWriteFootprint(w)) {
              assert.ok(allowed.has(addr), `oracle wrote RAM at ${hx(addr)} (outside the owned set) — model wrong`);
            }

            // (b) ARMS EXERCISED — read the oracle's outcome on this pose.
            const oc = w.clone();
            oracle(oc);
            const phaseSet = (sweep & 0x40) !== 0;
            if (phaseSet && x >= 128) {
              // arm b: column B repainted brighter (0xEF/0xEE/0xED), blink forced OFF.
              if (oc.mem.read8(colB[0]) === 0xef) sawRepaintB++;
              if ((oc.mem.read8(SPRITE0_CODE) & 0x80) === 0 && (oc.mem.read8(SPRITE1_CODE) & 0x80) === 0) sawBlinkCleared++;
            } else if (phaseSet) {
              // arm c: column A repainted brighter (0xDF/0xDE/0xDD), blink forced ON.
              if (oc.mem.read8(colA[0]) === 0xdf) sawRepaintA++;
              if ((oc.mem.read8(SPRITE0_CODE) & 0x80) !== 0) sawBlinkSet++;
            }

            // (c) REALISM: fresh-clone whole-contract diff (RAM − STACK, pc, SP) is empty.
            const diffs = contractDiffs(w, runRivetColorCycleBlink);
            assert.equal(diffs.length, 0, `sweep=${hb(sweep)} x=${hb(x)} v1=${hb(v1)} v5=${hb(v5)}: ${diffs.join("; ")}`);
            cases++;
          }
        }
      }
    }
  }
  assert.ok(sawRepaintB >= 1, "arm b never exercised (no column-B brighter repaint seen)");
  assert.ok(sawRepaintA >= 1, "arm c never exercised (no column-A brighter repaint seen)");
  assert.ok(sawBlinkCleared >= 1, "blink-OFF outcome never observed");
  assert.ok(sawBlinkSet >= 1, "blink-ON outcome never observed");
  console.log(
    `  CRAFTED/real: ${cases} crafted entries on ${caps.length} real 0x04a3 bases — footprint ⊆ 8 cells, ` +
      `all arms exercised, whole-contract identical (0x04be unreached: ${reachedTarget} dispatches)`,
  );
});

// -- 2. CRAFTED (arms) --------------------------------------------------------

test("CRAFTED (arms): a non-one-row stride and a toggle-phase counter match the oracle", () => {
  const { caps } = captureRun(1, CAP_FRAMES);
  const [base] = caps;
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) Non-one-row stride: DE=0x0080 -> the fills land at 0x7623/0x76A3/0x7723 and
  //     0x7583/0x7603/0x7683. Pins that the stride is honoured end to end (a fixed-0x20 fill
  //     would write the wrong cells). Sweep phase low so no arm repaints over the base fills.
  {
    const de = 0x0080;
    const w = pose(base, { de, sweep: 0x00, x: 0x00, v1: 0x00, v5: 0x00 });
    paintPage(w, 0x75, 0xbb);
    paintPage(w, 0x76, 0xbb);
    paintPage(w, 0x77, 0xbb);
    const oc = w.clone();
    oracle(oc);
    const colA = cells(COLUMN_A_TOP, de);
    const colB = cells(COLUMN_B_TOP, de);
    assert.equal(oc.mem.read8(colA[0]) & 0xff, 16, `non-0x20 column-A cell ${hx(colA[0])} wrong`);
    assert.equal(oc.mem.read8(colA[2]) & 0xff, 14, `non-0x20 column-A cell ${hx(colA[2])} wrong`);
    assert.equal(oc.mem.read8(colB[0]) & 0xff, 13, `non-0x20 column-B cell ${hx(colB[0])} wrong`);
    assert.equal(oc.mem.read8(colB[2]) & 0xff, 11, `non-0x20 column-B cell ${hx(colB[2])} wrong`);
    const diffs = contractDiffs(w, runRivetColorCycleBlink);
    assert.equal(diffs.length, 0, `non-0x20 stride: ${diffs.join("; ")}`);
  }

  // (b) Toggle-phase counter: sweep = 0x40 makes the shared store tail XOR 0x03 into 0x6905
  //     (advance the tile). With X on the left (arm c) the blink is forced ON first. Verify the
  //     oracle genuinely takes the toggle path, then the whole contract matches.
  {
    const v5 = 0x00;
    const w = pose(base, { de: 0x0020, sweep: 0x40, x: 0x00, v1: 0x00, v5 });
    const oc = w.clone();
    oracle(oc);
    // arm c stages 0x6905 as (v5 | 0x80); the toggle then flips its low two bits.
    assert.equal(
      oc.mem.read8(SPRITE1_CODE) & 0xff,
      ((v5 | 0x80) ^ 0x03) & 0xff,
      "toggle store arm not exercised for sweep=0x40 (0x6905 was not (v5 | 0x80) ^ 0x03)",
    );
    const diffs = contractDiffs(w, runRivetColorCycleBlink);
    assert.equal(diffs.length, 0, `toggle-phase counter: ${diffs.join("; ")}`);
  }

  console.log("  CRAFTED/arms: non-one-row stride and toggle-phase counter — identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-phase-bit, boundary-X, and dropped-column twins are CAUGHT", () => {
  const { caps } = captureRun(1, CAP_FRAMES);
  const [base] = caps;
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) wrong-phase-bit: sweep=0x40 has bit 6 set (arm b/c) but bit 5 clear, so the twin
  //     mis-reads it as phase-low and delegates to blinkSpritePairByX instead of repainting.
  const wp = pose(base, { de: 0x0020, sweep: 0x40, x: 0x00, v1: 0x0a, v5: 0x0a });
  paintPage(wp, 0x76, 0xcc); // sentinel so the missing column-A brighter repaint diverges
  const dPhase = contractDiffs(wp, teethWrongPhaseBit);
  assert.notEqual(dPhase.length, 0, "the gate FAILED to catch the wrong-phase-bit twin — it is worthless");

  // (b) boundary-X: at exactly X == 128 the real routine takes arm b (repaint B, blink OFF);
  //     the ">" twin takes arm c (repaint A, blink ON) instead.
  const wb = pose(base, { de: 0x0020, sweep: 0x40, x: 0x80, v1: 0x0a, v5: 0x0a });
  const dBound = contractDiffs(wb, teethBoundaryX);
  assert.notEqual(dBound.length, 0, "the gate FAILED to catch the boundary-X twin — it is worthless");

  // (c) dropped-second-column: the unconditional column-B repaint is skipped, so column B
  //     keeps the sentinel instead of 13/12/11. Phase low so neither arm repaints over it.
  const wd = pose(base, { de: 0x0020, sweep: 0x00, x: 0x00, v1: 0x0a, v5: 0x0a });
  paintPage(wd, 0x75, 0xcc); // column B lives on page 0x75
  const dDrop = contractDiffs(wd, teethDropSecondColumn);
  assert.notEqual(dDrop.length, 0, "the gate FAILED to catch the dropped-second-column twin — it is worthless");

  console.log(`  TEETH: wrong-phase-bit caught (${dPhase[0]}); boundary-X caught (${dBound[0]}); dropped-column caught (${dDrop[0]})`);
});
