// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stepKongWalk (ROM 0x16D5) — drive sub_25f2's object #1, then slide its
 * 10-sprite group one step along X. stepKongWalk calls loc_2602 (which republishes the object's
 * signed per-frame step into 0x63A3), reads that step into C, then via the rst-0x38 stride-4/
 * count-10 form of addStrided adds C to byte +0 (the X field) of each of the 10 records in
 * SPRITE_OBJ_BLOCK (0x6908 … 0x692C).
 *
 * stepKongWalk WRITES MEMORY and CALLS two sub-routines, so it is gated on memory-equivalence —
 * RAM (minus the stack scratch below the entry SP) — never the register file. LIVE-OUT is memory-only: stepKongWalk is
 * the tail of the dispatchKongWalkFrame substate family, dispatched from the in-game substate
 * table and tail-returning through the NMI dispatcher, which reads no register/flag it leaves
 * (A/B/C/DE/HL are dead ABI), so they are deliberately NOT compared. Every case runs on FRESH
 * clones (the routine writes memory).
 *
 * pc and SP are NOT compared. The idiomatic loc_2602 now calls the idiomatic signStepHalfRate
 * (0x26E9) as a plain JS leaf, so the guest-stack `ret` the frozen sub_26e9 used to supply as
 * stepKongWalk's single net return is gone: the idiomatic path pushes nothing and returns
 * nothing on the guest stack (addStrided is also pure), so it ends SP two below the oracle (pc
 * likewise at entry). That is a pure seam artifact — the oracle's transient pushes land inside
 * STACK_SCRATCH, which the RAM diff excludes — and the whole-game SP guards (idiomatic.test.js
 * "FULL FLIP", barrel-jump-reset) back-stop any stray push.
 *
 *   0. REACHABILITY — plain attract never dispatches 0x16d5 (0×/2500 frames, asserted). The
 *      operative reason is the sub-state, not the object cascade: this family hangs off the
 *      board-cleared sub-state 0x16 (its 50m step table at ROM 0x1637), and attract never
 *      reaches that sub-state at all because it never completes a board. (stepKongWalk's own
 *      internal `call 0x2602` would register on a 0x2602 dispatch hook; equivalence-2602
 *      already shows 0x2602 is 0× in attract, corroborating this.) So the gate is
 *      crafted-entry, and real interlude dispatches are a coverage hole it does not replay.
 *
 *   1. EQUAL (FRAME sweep) — for all 256 FRAME values × memory configs, stepKongWalk == oracle.
 *      Covers parity (even → publish 0 → no shift; odd → publish ±1 → ±1 shift), every
 *      FRAME & 0x1F residue (loc_2602's 32nd-frame sprite-anim arm), both step signs, and
 *      block-X bytes seeded at wrap edges (0x00 / 0xFF).
 *
 *   2. EQUAL (block-X wrap sweep) — at an ODD frame (publish nonzero) on both step signs,
 *      set every record's X byte to v and sweep v over 0..255, exercising addStrided's 8-bit
 *      +1 / −1 wrap on every byte value through the stepKongWalk glue.
 *
 *   3. EQUAL (countdown sweep) — at an EVEN frame, sweep 0x62A0 on both direction signs,
 *      driving loc_2602's dec / underflow-to-0 / reload-0x80 / reverse arm through stepKongWalk.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught by the RAM diff:
 *      (a) wrong-base twin — shifts SPRITE_BUFFER (0x6900) instead of the block (0x6908);
 *      (b) wrong-addend twin — shifts by (step − 1) instead of step.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-16d5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16d5 as oracle } from "../../translated/loc_16d5.js";
import { stepKongWalk } from "../stepKongWalk.js";
import { loc_2602 } from "../loc_2602.js";
import { addStrided } from "../addStrided.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x16d5;
const FRAME_ADDR = 0x601a;
const CD_ADDR = 0x62a0; // object #1 even-frame countdown
const DIR_ADDR = 0x62a1; // object #1 signed step-direction (bit7 = sign)
const PUB_ADDR = 0x63a3; // the publish cell loc_2602 writes and stepKongWalk reads as C
const BLOCK = 0x6908; // SPRITE_OBJ_BLOCK — 10 records × 4 bytes; byte +0 = X
const PAIR_BASE = 0x69e4; // loc_2602's loc_26a6 sprite-pair base
const P_ADDR = 0x69e5;
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

/** Run the ORACLE on a fresh clone. It performs its own net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone. The idiomatic stepKongWalk touches the guest stack nowhere
 * (its callees are pure JS leaves), so pc/SP are a seam artifact (see the header) and are neither
 * reconciled nor compared. A pop reads the stack but never writes it, so the RAM contract needs
 * no reconciliation.
 */
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
 * oracle's transient pushes are excluded from the RAM diff. Undefined fields leave the byte as
 * the booted machine had it. `blockX` (when given) sets EVERY record's X byte to that value.
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

/** Broken twin (a): shifts SPRITE_BUFFER (0x6900) instead of SPRITE_OBJ_BLOCK (0x6908). */
function brokenBase(m) {
  const { regs, mem } = m;
  loc_2602(m);
  regs.c = mem.read8(PUB_ADDR);
  regs.de = 0x0004;
  regs.b = 0x0a;
  regs.hl = 0x6900; // BUG: should be 0x6908
  addStrided(m);
}

/** Broken twin (b): shifts by (step − 1) instead of the published step. */
function brokenAddend(m) {
  const { regs, mem } = m;
  loc_2602(m);
  regs.c = (mem.read8(PUB_ADDR) - 1) & 0xff; // BUG: off-by-one addend
  regs.de = 0x0004;
  regs.b = 0x0a;
  regs.hl = BLOCK;
  addStrided(m);
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: attract never dispatches 0x16d5 (crafted-entry gate)", () => {
  let count = 0;
  const overrides = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.equal(count, 0, `expected 0x16d5 to be unreached in attract, saw ${count} dispatches`);
  console.log(`  REACHABILITY: 0x16d5 dispatched 0× in 2500 attract frames — crafted-entry gate justified`);
});

// -- 1. EQUAL (FRAME sweep) ---------------------------------------------------

test("EQUAL (FRAME sweep): stepKongWalk == oracle over all 256 FRAME values × memory configs", () => {
  const seed = bootedMachine(400).clone();
  // Configs: direction sign clear (+1) vs set (−1); block X seeded at both wrap edges so an
  // odd-frame shift crosses 0x00↔0xFF; countdown about-to-underflow vs mid; ring-valued
  // sprite-pair counters so loc_2602's 32nd-frame arm also steps.
  const cfgs = [
    { cd: 0x08, dir: 0x05, blockX: 0x00, p: 0x51, p4: 0xd1 }, // +1 from 0x00
    { cd: 0x08, dir: 0x85, blockX: 0x00, p: 0x50, p4: 0xd2 }, // −1 from 0x00 → wraps to 0xFF
    { cd: 0x08, dir: 0x05, blockX: 0xff, p: 0x52, p4: 0xd0 }, // +1 from 0xFF → wraps to 0x00
    { cd: 0x01, dir: 0x85, blockX: 0x80, p: 0x51, p4: 0xd1 }, // underflow arm on even frames
  ];
  let count = 0, mismatch = null;
  for (let frame = 0; frame < 256 && !mismatch; frame++) {
    for (const cfg of cfgs) {
      const e = craft(seed, { frame, ...cfg });
      const diffs = contractDiffs(e, stepKongWalk);
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
  // Prove the shift arm actually fired: on an ODD frame with +1, the oracle must have moved a
  // block X byte (else this whole sweep would be validating a dead shift).
  const odd = craft(seed, { frame: 0x03, dir: 0x05, blockX: 0x40, cd: 0x08 });
  const o = runOracle(odd);
  assert.equal(o.mem.read8(BLOCK), 0x41, "odd-frame +1 entry must shift block X byte +0 from 0x40 to 0x41");
  console.log(`  EQUAL/frame-sweep: ${count} (FRAME × config) entries identical; odd-frame shift confirmed live`);
});

// -- 2. EQUAL (block-X wrap sweep) --------------------------------------------

test("EQUAL (block-X wrap sweep): all 256 X values on both step signs match the oracle", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  // Odd frame so loc_2602 publishes ±1 (a real shift); sign chosen by DIR_ADDR bit 7.
  for (const dir of [0x05, 0x85]) {
    for (let v = 0; v < 256 && !mismatch; v++) {
      const e = craft(seed, { frame: 0x03, dir, blockX: v, cd: 0x08, p: 0x51, p4: 0xd1 });
      const diffs = contractDiffs(e, stepKongWalk);
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

// -- 3. EQUAL (countdown sweep) -----------------------------------------------

test("EQUAL (countdown sweep): all 256 countdown values on both direction signs match the oracle", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  for (const dir of [0x05, 0x85]) {
    for (let cd = 0; cd < 256 && !mismatch; cd++) {
      const e = craft(seed, { frame: 0x00, cd, dir, blockX: 0x40, p: 0x51, p4: 0xd1 }); // even → countdown runs
      const diffs = contractDiffs(e, stepKongWalk);
      count++;
      if (diffs.length) { mismatch = { cd, dir, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at countdown=${hx(mismatch.cd)} dir=${hx(mismatch.dir)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 countdown values on both signs");
  // Prove the underflow arm was exercised through stepKongWalk (cd==1 on even → reload + reverse).
  const under = runOracle(craft(seed, { frame: 0x00, cd: 0x01, dir: 0x05, blockX: 0x40 }));
  assert.equal(under.mem.read8(CD_ADDR), 0x80, "underflow entry must reload 0x62A0 to 0x80");
  assert.equal(under.mem.read8(DIR_ADDR), 0xfe, "underflow entry must reverse 0x62A1 (clear sign → −2)");
  console.log(`  EQUAL/countdown-sweep: ${count} countdown values identical; underflow reload+reverse driven through stepKongWalk`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: wrong-base and wrong-addend twins are CAUGHT (stepKongWalk passes the same entries)", () => {
  const seed = bootedMachine(400).clone();

  // Wrong-base twin: caught wherever the shift is nonzero (odd frame → publish ±1). It writes
  // 0x6900..0x6924 instead of 0x6908..0x692C, so the diff surfaces in the block bytes.
  let baseCases = 0, baseCaught = 0;
  for (const frame of [0x03, 0x05, 0x07, 0x21, 0x23]) {
    for (const dir of [0x05, 0x85]) {
      const e = craft(seed, { frame, dir, blockX: 0x40, cd: 0x08, p: 0x51, p4: 0xd1 });
      baseCases++;
      if (contractDiffs(e, brokenBase).length > 0) baseCaught++;
      assert.equal(contractDiffs(e, stepKongWalk).length, 0, `stepKongWalk must pass FRAME=${hx(frame)} dir=${hx(dir)}`);
    }
  }
  assert.equal(baseCaught, baseCases, `wrong-base twin escaped ${baseCases - baseCaught}/${baseCases} nonzero-shift entries`);

  // Wrong-addend twin (step − 1): caught on EVERY entry — even an even frame (publish 0) shifts
  // the block by −1 in the twin but 0 in the oracle.
  let addCases = 0, addCaught = 0;
  for (const frame of [0x00, 0x02, 0x03, 0x04, 0x05]) {
    for (const dir of [0x05, 0x85]) {
      const e = craft(seed, { frame, dir, blockX: 0x40, cd: 0x08, p: 0x51, p4: 0xd1 });
      addCases++;
      if (contractDiffs(e, brokenAddend).length > 0) addCaught++;
      assert.equal(contractDiffs(e, stepKongWalk).length, 0, `stepKongWalk must pass FRAME=${hx(frame)} dir=${hx(dir)}`);
    }
  }
  assert.equal(addCaught, addCases, `wrong-addend twin escaped ${addCases - addCaught}/${addCases} entries`);

  console.log(
    `  TEETH: wrong-base twin caught on all ${baseCases} nonzero-shift entries; ` +
      `wrong-addend twin caught on all ${addCases} entries`,
  );
});
