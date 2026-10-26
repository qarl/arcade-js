// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2602 (ROM 0x2602) — the first per-frame driver in sub_25f2's
 * timed-object cascade: even-frame 0x62A0 countdown (reload 0x80 + reverse 0x62A1's sign
 * on underflow), a per-frame loc_26e9(0x62A1) -> 0x63A3 publish, and an every-32nd-frame
 * loc_26a6 advance of the sprite-anim pair at 0x69E4.
 *
 * loc_2602 WRITES MEMORY and CALLS three sub-routines, so it is gated on memory-equivalence
 * — RAM (minus the stack scratch below the entry SP) — never the register file. LIVE-OUT is memory-only: both `ret`
 * exits feed sub_25f2's next `call`, which reads no register/flag this routine leaves (on the
 * early-return arm the oracle even leaves A = FRAME & 0x1F, which nothing reads), so A/HL/flags
 * are deliberately NOT compared. Every case runs on FRESH clones (the routine writes memory).
 * pc and SP are NOT compared either. loc_2602 now calls the idiomatic signStepHalfRate (0x26E9)
 * as a plain JS leaf: it no longer performs the guest-stack `ret` the frozen loc_26e9 used to
 * supply as sub_2602's single net return, so the idiomatic run ends SP two below the oracle
 * (pc likewise at entry). That is a pure seam artifact — the oracle's internal call pushes/pops
 * land within STACK_SCRATCH, which the RAM diff excludes — and the whole-game SP guards
 * (idiomatic.test.js "FULL FLIP", barrel-jump-reset) back-stop any stray push.
 *
 *   0. REACHABILITY — plain attract never dispatches 0x2602 (0× / 2500 frames, asserted):
 *      the sub_25f2 object cascade runs only in real gameplay. That is why the gate is
 *      crafted-entry (pokes on a real booted machine), not real-dispatch.
 *
 *   1. EQUAL (FRAME sweep) — for all 256 FRAME values × a set of memory configs (countdown
 *      about-to-underflow vs not, direction sign set vs clear), confirm loc_2602 == oracle.
 *      This covers even/odd parity (the countdown gate + loc_26e9's parity), every FRAME &
 *      0x1F residue (the loc_26a6 32nd-frame gate), and both direction arms.
 *
 *   2. EQUAL (countdown sweep) — at a fixed EVEN frame, sweep all 256 countdown (0x62A0)
 *      values on BOTH direction signs, exercising the dec / underflow-to-0 / reload-0x80 /
 *      reverseStepDirection arm at its one triggering value and everywhere else.
 *
 *   3. EQUAL (loc_26a6 advance) — at FRAME with (& 0x1F == 1) so the 32nd-frame arm fires,
 *      sweep the sprite-pair counters (ring seams + off-ring) × both direction signs,
 *      confirming the loc_26a6 integration (HL=0x69E4, DE=0x62A1) matches the oracle.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) inverted countdown parity (ticks 0x62A0 on ODD frames instead of even — a
 *          plausible `jp c` carry-sense confusion) — caught by the RAM diff at 0x62A0;
 *      (b) wrong 32nd-frame gate (advances loc_26a6 when FRAME & 0x1F == 0 instead of == 1)
 *          — caught by the RAM diff at the 0x69E4 sprite-pair counters.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2602.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2602 as oracle } from "../../translated/loc_2602.js";
import { loc_2602 } from "../loc_2602.js";
import { reverseStepDirection } from "../reverseStepDirection.js";
import { loc_26a6 } from "../loc_26a6.js";
import { loc_26e9 } from "../../translated/loc_26e9.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2602;
const FRAME_ADDR = 0x601a;
const CD_ADDR = 0x62a0; // even-frame countdown
const DIR_ADDR = 0x62a1; // signed step-direction / loc_26a6 arm-select
const PUB_ADDR = 0x63a3; // loc_26e9 publish cell
const PAIR_BASE = 0x69e4; // loc_26a6 sprite-pair base -> counters at 0x69E5 / 0x69E9
const P_ADDR = 0x69e5;
const P4_ADDR = 0x69e9;
const SAFE_SP = 0x6bfe; // deep inside STACK_SCRATCH — the oracle's internal pushes are excluded

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

/**
 * Run a candidate on a fresh clone. The idiomatic routine models its own return as a JS
 * return and calls the idiomatic signStepHalfRate (0x26E9) as a plain JS leaf, so it touches
 * the guest stack nowhere. pc/SP therefore diverge from the oracle by the dissolved call's
 * single net return; they are a seam artifact (see the header) and are neither reconciled nor
 * compared. A pop reads the stack but never writes it, so the RAM contract needs no reconcile.
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
 * A crafted entry: a real booted machine with the object's state bytes poked to a chosen
 * configuration and SP staged deep in STACK_SCRATCH (so the oracle's internal call pushes
 * are excluded from the RAM diff). `cfg` fields default to leaving the byte untouched only
 * where undefined.
 */
function craft(seed, { frame, cd, dir, p, p4 }) {
  const e = seed.clone();
  if (frame !== undefined) e.mem.write8(FRAME_ADDR, frame);
  if (cd !== undefined) e.mem.write8(CD_ADDR, cd);
  if (dir !== undefined) e.mem.write8(DIR_ADDR, dir);
  if (p !== undefined) e.mem.write8(P_ADDR, p);
  if (p4 !== undefined) e.mem.write8(P4_ADDR, p4);
  e.regs.sp = SAFE_SP;
  e.regs.hl = PAIR_BASE; // arbitrary live-in; both sides start identical, dead at exit
  e.regs.de = DIR_ADDR;
  return e;
}

// -- broken twins -------------------------------------------------------------

/** Broken twin (a): ticks the 0x62A0 countdown on ODD frames instead of even. */
function brokenParity(m) {
  const { regs, mem } = m;
  if ((mem.read8(FRAME_ADDR) & 0x01) === 1) { // BUG: == 1 should be == 0
    const next = (mem.read8(CD_ADDR) - 1) & 0xff;
    mem.write8(CD_ADDR, next);
    if (next === 0) {
      mem.write8(CD_ADDR, 0x80);
      regs.hl = DIR_ADDR;
      reverseStepDirection(m);
    }
  }
  regs.hl = DIR_ADDR;
  loc_26e9(m);
  mem.write8(PUB_ADDR, regs.a);
  if ((mem.read8(FRAME_ADDR) & 0x1f) !== 0x01) return;
  regs.de = DIR_ADDR;
  regs.hl = PAIR_BASE;
  loc_26a6(m);
}

/** Broken twin (b): fires the loc_26a6 advance on FRAME & 0x1F == 0 instead of == 1. */
function brokenGate(m) {
  const { regs, mem } = m;
  if ((mem.read8(FRAME_ADDR) & 0x01) === 0) {
    const next = (mem.read8(CD_ADDR) - 1) & 0xff;
    mem.write8(CD_ADDR, next);
    if (next === 0) {
      mem.write8(CD_ADDR, 0x80);
      regs.hl = DIR_ADDR;
      reverseStepDirection(m);
    }
  }
  regs.hl = DIR_ADDR;
  loc_26e9(m);
  mem.write8(PUB_ADDR, regs.a);
  if ((mem.read8(FRAME_ADDR) & 0x1f) !== 0x00) return; // BUG: == 0 should be == 1
  regs.de = DIR_ADDR;
  regs.hl = PAIR_BASE;
  loc_26a6(m);
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: attract never dispatches 0x2602 (crafted-entry gate)", () => {
  let count = 0;
  const overrides = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.equal(count, 0, `expected 0x2602 to be unreached in attract, saw ${count} dispatches`);
  console.log(`  REACHABILITY: 0x2602 dispatched 0x times in 2500 attract frames — crafted-entry gate justified`);
});

// -- 1. EQUAL (FRAME sweep) ---------------------------------------------------

test("EQUAL (FRAME sweep): loc_2602 == oracle over all 256 FRAME values × memory configs", () => {
  const seed = bootedMachine(400).clone();
  // Memory configs: countdown about-to-underflow (0x01) vs mid (0x08); direction sign
  // clear (0x05) vs set (0x85); with ring-valued sprite counters so loc_26a6 also steps.
  const cfgs = [
    { cd: 0x01, dir: 0x05, p: 0x51, p4: 0xd1 },
    { cd: 0x01, dir: 0x85, p: 0x51, p4: 0xd1 },
    { cd: 0x08, dir: 0x05, p: 0x50, p4: 0xd2 },
    { cd: 0x08, dir: 0x85, p: 0x52, p4: 0xd0 },
  ];
  let count = 0, mismatch = null;
  for (let frame = 0; frame < 256 && !mismatch; frame++) {
    for (const cfg of cfgs) {
      const e = craft(seed, { frame, ...cfg });
      const diffs = contractDiffs(e, loc_2602);
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
  console.log(`  EQUAL/frame-sweep: ${count} (FRAME × config) entries identical to the oracle`);
});

// -- 2. EQUAL (countdown sweep) -----------------------------------------------

test("EQUAL (countdown sweep): all 256 countdown values on both direction signs match the oracle", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  for (const dir of [0x05, 0x85]) { // sign clear / set — reverseStepDirection reads bit 7
    for (let cd = 0; cd < 256 && !mismatch; cd++) {
      const e = craft(seed, { frame: 0x00, cd, dir, p: 0x51, p4: 0xd1 }); // even frame -> countdown runs
      const diffs = contractDiffs(e, loc_2602);
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
  // Prove the underflow arm was actually exercised (cd==1 on an even frame -> reload + reverse).
  const under = craft(seed, { frame: 0x00, cd: 0x01, dir: 0x05, p: 0x51, p4: 0xd1 });
  const o = runOracle(under);
  assert.equal(o.mem.read8(CD_ADDR), 0x80, "underflow entry must reload 0x62A0 to 0x80");
  assert.equal(o.mem.read8(DIR_ADDR), 0xfe, "underflow entry must reverse 0x62A1 (clear sign -> -2)");
  console.log(`  EQUAL/countdown-sweep: ${count} countdown values identical; underflow reloads 0x80 + reverses 0x62A1`);
});

// -- 3. EQUAL (loc_26a6 advance) ----------------------------------------------

test("EQUAL (loc_26a6 advance): the 32nd-frame sprite-pair step matches the oracle", () => {
  const seed = bootedMachine(400).clone();
  // FRAME & 0x1F == 1 fires loc_26a6; these frames are all odd, so the countdown is skipped.
  const frames = [0x01, 0x21, 0x41, 0x81, 0xe1];
  const ring = [0x40, 0x4f, 0x50, 0x51, 0x52, 0x53, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3, 0xa0];
  let count = 0, mismatch = null;
  outer: for (const frame of frames) {
    for (const dir of [0x05, 0x85]) {
      for (const p of ring) {
        for (const p4 of ring) {
          const e = craft(seed, { frame, dir, p, p4 });
          const diffs = contractDiffs(e, loc_2602);
          count++;
          if (diffs.length) { mismatch = { frame, dir, p, p4, diffs }; break outer; }
        }
      }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch FRAME=${hx(mismatch.frame)} dir=${hx(mismatch.dir)} P=${hx(mismatch.p)} P+4=${hx(mismatch.p4)}: ${mismatch.diffs.join("; ")}`,
  );
  // Confirm loc_26a6 actually moved a counter on at least one entry (else the arm was dead).
  const e = craft(seed, { frame: 0x01, dir: 0x05, p: 0x51, p4: 0xd1 });
  const o = runOracle(e);
  assert.ok(
    o.mem.read8(P_ADDR) !== 0x51 || o.mem.read8(P4_ADDR) !== 0xd1,
    "the loc_26a6 advance arm must have stepped a sprite-pair counter",
  );
  console.log(`  EQUAL/26a6-advance: ${count} (frame × dir × ring²) entries identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: inverted-parity and wrong-gate twins are CAUGHT (loc_2602 passes the same entries)", () => {
  const seed = bootedMachine(400).clone();

  // (a) parity twin: caught on an EVEN frame (oracle decrements 0x62A0, twin does not).
  const evenEntry = craft(seed, { frame: 0x00, cd: 0x08, dir: 0x05, p: 0x51, p4: 0xd1 });
  assert.ok(contractDiffs(evenEntry, brokenParity).length > 0, "parity twin escaped an even-frame entry");
  assert.equal(contractDiffs(evenEntry, loc_2602).length, 0, "loc_2602 must pass the even-frame entry");

  // Corroborate the parity twin across the whole FRAME range (caught on every frame:
  // even -> oracle decs, twin doesn't; odd -> twin decs, oracle doesn't).
  let parityCases = 0, parityCaught = 0;
  for (let frame = 0; frame < 256; frame++) {
    const e = craft(seed, { frame, cd: 0x08, dir: 0x05, p: 0x51, p4: 0xd1 });
    parityCases++;
    if (contractDiffs(e, brokenParity).length > 0) parityCaught++;
  }
  assert.equal(parityCaught, parityCases, `parity twin escaped on ${parityCases - parityCaught}/${parityCases} frames`);

  // (b) gate twin: caught wherever the loc_26a6 arm fires on the wrong frame. FRAME & 0x1F
  // == 0 (twin fires, oracle doesn't) and == 1 (oracle fires, twin doesn't) both diverge.
  let gateCases = 0, gateCaught = 0;
  for (const frame of [0x00, 0x01, 0x20, 0x21, 0x40, 0x41]) {
    const e = craft(seed, { frame, cd: 0x08, dir: 0x05, p: 0x51, p4: 0xd1 });
    gateCases++;
    if (contractDiffs(e, brokenGate).length > 0) gateCaught++;
    assert.equal(contractDiffs(e, loc_2602).length, 0, `loc_2602 must pass FRAME=${hx(frame)}`);
  }
  assert.ok(gateCaught > 0, "the wrong-gate twin escaped every tested frame — the gate is worthless");

  console.log(
    `  TEETH: parity twin caught on all ${parityCases} frames; wrong-gate twin caught on ${gateCaught}/${gateCases} frames`,
  );
});
