// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_16d0 (ROM 0x16D0) — the "hit the boundary" entry of the stepKongWalk
 * group-slide family. loc_16d0 writes 1 to object #1's even-frame countdown (0x62A0) — which
 * schedules an immediate underflow on the next even frame, so loc_2602 reloads the period and
 * REVERSES the step-direction sign at 0x62A1 — then falls into stepKongWalk to run this frame's
 * motion tick (advance object #1, shift the 10-record sprite-object block one step along X).
 *
 * loc_16d0 WRITES MEMORY and CALLS a sub-routine (stepKongWalk, and through it loc_2602 / addStrided),
 * so it is gated on memory-equivalence — RAM (minus the stack scratch below the entry SP) — never the register file.
 * LIVE-OUT is memory-only: the family is dispatched from the in-game substate table and
 * tail-returns through the NMI dispatcher, which reads no register/flag it leaves (A/B/C/DE/HL are
 * dead ABI), so they are deliberately NOT compared. Every case runs on FRESH clones (writes memory).
 *
 * pc and SP are NOT compared. Through stepKongWalk, loc_2602 now calls the idiomatic
 * signStepHalfRate (0x26E9) as a plain JS leaf, so the guest-stack `ret` the frozen sub_26e9 used
 * to supply as the family's single net return is gone (documented in equivalence-16d5): the
 * idiomatic path pushes/pops nothing and ends SP two below the oracle (pc likewise at entry). A
 * pure seam artifact — every transient oracle push lands inside STACK_SCRATCH, which the RAM diff
 * excludes, and the whole-game SP guards (idiomatic.test.js "FULL FLIP", barrel-jump-reset)
 * back-stop any stray push. SP is staged deep in STACK_SCRATCH for exactly that reason.
 *
 *   0. REACHABILITY — plain attract never dispatches 0x16d0 (0×/2500 frames, asserted): the
 *      sub_25f2 object cascade the family drives runs only in real gameplay. So the gate is
 *      crafted-entry.
 *
 *   1. EQUAL (FRAME sweep) — for all 256 FRAME values × memory configs, loc_16d0 == oracle.
 *      Covers parity (even → the write-1 countdown underflows → reload 0x80 + reverse; odd →
 *      loc_2602 publishes ±1 → block shift), both step signs, and block-X seeded at wrap edges.
 *
 *   2. EQUAL (block-X wrap sweep) — at an ODD frame (publish nonzero) on both step signs, set
 *      every record's X byte to v and sweep v over 0..255, exercising addStrided's 8-bit wrap
 *      through the loc_16d0 → stepKongWalk glue.
 *
 *   3. EQUAL (direction sweep) — at an EVEN frame (the write-1 countdown always underflows),
 *      sweep 0x62A1 over all 256 values, driving reverseStepDirection's both arms (+2 if the
 *      sign was set, else -2) through loc_16d0.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught by the RAM diff on entries
 *      loc_16d0 itself passes:
 *      (a) skip-the-write twin — omits the 0x62A0 := 1 store (i.e. behaves like the plain
 *          stepKongWalk arm); with 0x62A0 pre-seeded to a value != 1 the countdown/reverse diverges;
 *      (b) wrong-value twin — writes 0 to 0x62A0 instead of 1 (the dispatcher's cleared value),
 *          so the next even-frame decrement wraps to 0xFF instead of underflowing to reload.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-16d0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16d0 as oracle } from "../../translated/loc_16d0.js";
import { loc_16d0 } from "../loc_16d0.js";
import { stepKongWalk } from "../stepKongWalk.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x16d0;
const FRAME_ADDR = 0x601a;
const CD_ADDR = 0x62a0; // object #1 even-frame countdown — the byte loc_16d0 writes to 1
const DIR_ADDR = 0x62a1; // object #1 signed step-direction (bit7 = sign)
const BLOCK = 0x6908; // SPRITE_OBJ_BLOCK — 10 records × 4 bytes; byte +0 = X
const P_ADDR = 0x69e5; // loc_2602's loc_26a6 sprite-pair counter bytes (32nd-frame arm)
const P4_ADDR = 0x69e9;
const SAFE_SP = 0x6bfe; // deep in STACK_SCRATCH — the oracle's transient pushes are excluded

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

/** Run the ORACLE on a fresh clone. It tail-calls stepKongWalk, which performs the net `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone. The idiomatic path touches the guest stack nowhere, so pc/SP
 *  are a seam artifact (see the header) and are neither reconciled nor compared. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** Compare candidate vs oracle over the memory-equivalence contract: RAM − the stack scratch below the entry SP. No
 *  pc/SP (a seam artifact of the dissolved calls — see the header); live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/** A realistic booted machine, a few hundred attract frames in. */
function bootedMachine(maxFrames) {
  const m = new Machine(ROM);
  m.runFrames(maxFrames);
  return m;
}

/**
 * A crafted entry: a real booted machine with object #1's state, the sprite-object block's X
 * fields, and FRAME poked to a chosen configuration, SP staged deep in STACK_SCRATCH so the
 * oracle's transient pushes are excluded from the RAM diff. `cd` seeds 0x62A0 BEFORE loc_16d0
 * overwrites it (matters only for the skip-the-write teeth twin). Undefined fields keep the
 * booted byte. `blockX` (when given) sets EVERY record's X byte to that value.
 */
function craft(seed, { frame, cd, dir, blockX, p, p4 }) {
  const e = seed.clone();
  if (frame !== undefined) e.mem.write8(FRAME_ADDR, frame);
  if (cd !== undefined) e.mem.write8(CD_ADDR, cd);
  if (dir !== undefined) e.mem.write8(DIR_ADDR, dir);
  if (blockX !== undefined) {
    for (let i = 0; i < 10; i++) e.mem.write8(BLOCK + i * 4, blockX);
  }
  if (p !== undefined) e.mem.write8(P_ADDR, p);
  if (p4 !== undefined) e.mem.write8(P4_ADDR, p4);
  e.regs.sp = SAFE_SP;
  return e;
}

// -- broken twins -------------------------------------------------------------

/** Broken twin (a): skips the 0x62A0 := 1 store — behaves exactly like the plain stepKongWalk arm. */
function brokenSkipWrite(m) {
  stepKongWalk(m); // BUG: never arms the countdown, so no direction reversal is scheduled
}

/** Broken twin (b): writes 0 to 0x62A0 instead of 1 (the dispatcher's cleared value). */
function brokenWrongValue(m) {
  m.mem.write8(CD_ADDR, 0x00); // BUG: 0 wraps to 0xFF next even frame instead of underflowing
  stepKongWalk(m);
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: attract never dispatches 0x16d0 (crafted-entry gate)", () => {
  let count = 0;
  const overrides = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.equal(count, 0, `expected 0x16d0 to be unreached in attract, saw ${count} dispatches`);
  console.log(`  REACHABILITY: 0x16d0 dispatched 0× in 2500 attract frames — crafted-entry gate justified`);
});

// -- 1. EQUAL (FRAME sweep) ---------------------------------------------------

test("EQUAL (FRAME sweep): loc_16d0 == oracle over all 256 FRAME values × memory configs", () => {
  const seed = bootedMachine(400).clone();
  // cd is seeded to a non-1 value so the skip-the-write teeth (below) has something to diverge on;
  // loc_16d0 overwrites it to 1, so the EQUAL comparison is unaffected by cd's seed.
  const cfgs = [
    { cd: 0x08, dir: 0x05, blockX: 0x00, p: 0x51, p4: 0xd1 }, // +1 from 0x00
    { cd: 0x08, dir: 0x85, blockX: 0x00, p: 0x50, p4: 0xd2 }, // −1 from 0x00 → wraps to 0xFF
    { cd: 0x08, dir: 0x05, blockX: 0xff, p: 0x52, p4: 0xd0 }, // +1 from 0xFF → wraps to 0x00
    { cd: 0x40, dir: 0x85, blockX: 0x80, p: 0x51, p4: 0xd1 }, // −1 sign, mid block
  ];
  let count = 0, mismatch = null;
  for (let frame = 0; frame < 256 && !mismatch; frame++) {
    for (const cfg of cfgs) {
      const e = craft(seed, { frame, ...cfg });
      const diffs = contractDiffs(e, loc_16d0);
      count++;
      if (diffs.length) { mismatch = { frame, cfg, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at FRAME=${hx(mismatch.frame)} cfg=${JSON.stringify(mismatch.cfg)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 4, "must have swept all 256 FRAME values × 4 configs");
  // Prove loc_16d0's distinguishing arm actually fired: on an EVEN frame the write-1 countdown
  // underflows, so the oracle reloads 0x62A0 to 0x80 (else this sweep would validate a dead write).
  const even = runOracle(craft(seed, { frame: 0x00, cd: 0x08, dir: 0x05, blockX: 0x40 }));
  assert.equal(even.mem.read8(CD_ADDR), 0x80, "even-frame loc_16d0 must underflow the armed countdown and reload 0x62A0 to 0x80");
  // And on an ODD frame the countdown decrement is skipped, so the armed 1 survives to next frame.
  const odd = runOracle(craft(seed, { frame: 0x03, cd: 0x08, dir: 0x05, blockX: 0x40 }));
  assert.equal(odd.mem.read8(CD_ADDR), 0x01, "odd-frame loc_16d0 must leave the armed countdown at 1 (decrement skipped)");
  console.log(`  EQUAL/frame-sweep: ${count} (FRAME × config) entries identical; even-underflow + odd-survive confirmed`);
});

// -- 2. EQUAL (block-X wrap sweep) --------------------------------------------

test("EQUAL (block-X wrap sweep): all 256 X values on both step signs match the oracle", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  // Odd frame so loc_2602 publishes ±1 (a real shift); sign chosen by DIR_ADDR bit 7.
  for (const dir of [0x05, 0x85]) {
    for (let v = 0; v < 256 && !mismatch; v++) {
      const e = craft(seed, { frame: 0x03, dir, blockX: v, cd: 0x08, p: 0x51, p4: 0xd1 });
      const diffs = contractDiffs(e, loc_16d0);
      count++;
      if (diffs.length) { mismatch = { v, dir, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at blockX=${hx(mismatch.v)} dir=${hx(mismatch.dir)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 block-X values on both signs");
  // Confirm both wrap edges were actually reached (0x00 −1 → 0xFF, 0xFF +1 → 0x00).
  const wrapDown = runOracle(craft(seed, { frame: 0x03, dir: 0x85, blockX: 0x00, cd: 0x08 }));
  const wrapUp = runOracle(craft(seed, { frame: 0x03, dir: 0x05, blockX: 0xff, cd: 0x08 }));
  assert.equal(wrapDown.mem.read8(BLOCK), 0xff, "block X 0x00 − 1 must wrap to 0xFF");
  assert.equal(wrapUp.mem.read8(BLOCK), 0x00, "block X 0xFF + 1 must wrap to 0x00");
  console.log(`  EQUAL/block-wrap: ${count} block-X values identical; both 8-bit wrap edges exercised`);
});

// -- 3. EQUAL (direction sweep) -----------------------------------------------

test("EQUAL (direction sweep): all 256 step-direction values on an even frame match the oracle", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  // Even frame: loc_16d0's write-1 countdown always underflows, so reverseStepDirection runs
  // over 0x62A1 every entry — sweep its input across all 256 to drive both reverse arms.
  for (let dir = 0; dir < 256 && !mismatch; dir++) {
    const e = craft(seed, { frame: 0x00, cd: 0x40, dir, blockX: 0x40, p: 0x51, p4: 0xd1 });
    const diffs = contractDiffs(e, loc_16d0);
    count++;
    if (diffs.length) { mismatch = { dir, diffs }; break; }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at dir=${hx(mismatch.dir)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256, "must have swept all 256 direction values");
  // Prove both reverse arms were exercised through loc_16d0 (sign clear → −2, sign set → +2).
  const posToNeg = runOracle(craft(seed, { frame: 0x00, cd: 0x40, dir: 0x00, blockX: 0x40 }));
  const negToPos = runOracle(craft(seed, { frame: 0x00, cd: 0x40, dir: 0x80, blockX: 0x40 }));
  assert.equal(posToNeg.mem.read8(DIR_ADDR), 0xfe, "even-frame underflow with sign clear must reverse 0x62A1 to −2 (0xFE)");
  assert.equal(negToPos.mem.read8(DIR_ADDR), 0x02, "even-frame underflow with sign set must reverse 0x62A1 to +2 (0x02)");
  console.log(`  EQUAL/direction-sweep: ${count} direction values identical; both reverse arms driven through loc_16d0`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: skip-the-write and wrong-value twins are CAUGHT (loc_16d0 passes the same entries)", () => {
  const seed = bootedMachine(400).clone();

  // Skip-the-write twin: with 0x62A0 seeded to a value != 1, omitting the arming store diverges —
  // on even frames the countdown/reverse differs, on odd frames the surviving 0x62A0 byte differs.
  let skipCases = 0, skipCaught = 0;
  for (const frame of [0x00, 0x02, 0x03, 0x05, 0x20, 0x21]) {
    for (const dir of [0x05, 0x85]) {
      const e = craft(seed, { frame, cd: 0x08, dir, blockX: 0x40, p: 0x51, p4: 0xd1 });
      skipCases++;
      if (contractDiffs(e, brokenSkipWrite).length > 0) skipCaught++;
      assert.equal(contractDiffs(e, loc_16d0).length, 0, `loc_16d0 must pass FRAME=${hx(frame)} dir=${hx(dir)}`);
    }
  }
  assert.equal(skipCaught, skipCases, `skip-the-write twin escaped ${skipCases - skipCaught}/${skipCases} entries`);

  // Wrong-value twin: writes 0 instead of 1. On even frames 0 → 0xFF (no reload) vs 1 → 0x00
  // (reload 0x80 + reverse); on odd frames the surviving byte is 0 vs 1. Diverges every entry.
  let valCases = 0, valCaught = 0;
  for (const frame of [0x00, 0x02, 0x03, 0x05, 0x20, 0x21]) {
    for (const dir of [0x05, 0x85]) {
      const e = craft(seed, { frame, cd: 0x08, dir, blockX: 0x40, p: 0x51, p4: 0xd1 });
      valCases++;
      if (contractDiffs(e, brokenWrongValue).length > 0) valCaught++;
      assert.equal(contractDiffs(e, loc_16d0).length, 0, `loc_16d0 must pass FRAME=${hx(frame)} dir=${hx(dir)}`);
    }
  }
  assert.equal(valCaught, valCases, `wrong-value twin escaped ${valCases - valCaught}/${valCases} entries`);

  console.log(
    `  TEETH: skip-the-write twin caught on all ${skipCases} entries; ` +
      `wrong-value twin caught on all ${valCases} entries`,
  );
});
