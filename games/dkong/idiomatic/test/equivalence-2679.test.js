// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2679 (ROM 0x2679) — object-3's timed step-direction reversal
 * in the 50m object cascade, then the shared publish/animate tail (loc_268d).
 *
 * loc_2679 WRITES MEMORY (the reversal-timer countdown at 0x62A5, and — on expiry, via
 * reverseStepDirection — the M50_OBJ3_STEP_DIR latch), so it is gated on memory-equivalence:
 * RAM (minus the stack scratch below the entry SP) + pc + SP. LIVE-OUT is memory-only — the tail's exit
 * successor (sub_2AD3) reloads the accumulator with Mario's X before reading it, so no
 * register this routine leaves is consumed downstream.
 *
 * The oracle is a tail-jump chain (sub_2679 → the shared tail → `ret`), so it nets exactly
 * ONE caller-return pop. The idiomatic routine models the whole chain with direct JS calls
 * and a plain return (no stack modelling), so the harness performs ONE m.ret() on the
 * candidate AFTER the call to line pc + SP up with the oracle. The oracle's own push16(0x268D)
 * bracket around its 0x26DE call, and every nested push the tail makes, land in STACK_SCRATCH
 * and are excluded. Every case runs on FRESH clones (the routine writes memory).
 *
 * Plain attract never dispatches 0x2679 (0×): the whole sub_25F2 object cascade is board-2
 * gated (`rst 0x30` mask 0x02) and attract plays 25m. So the gate is crafted-entry: real
 * attract-base machines with a surgical poke of the frame counter (odd → tail, even → tick),
 * the countdown (still-counting / exact expiry / the 0 → 255 byte wrap seam), and the
 * step-direction latch sign (both reverse arms), plus the tail gate open (low 5 bits == 2) so
 * the sprite-pair-advance path is exercised through this routine too.
 *
 *   1. REACHABILITY — 0x2679 is dispatched 0× in a plain attract run (documents the
 *      non-executing board-2 frontier), which is why the gate is crafted-entry.
 *   2. EQUAL (crafted) — loc_2679 == oracle over every arm (odd skip, even tick, both reverse
 *      arms on expiry, the 0 → 255 wrap seam, and the tail-gate-open advance), on the full
 *      contract, with the intended effect asserted against the oracle.
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) dropped countdown reload — caught at 0x62A5 on expiry (oracle 0xFF vs twin 0x00);
 *      (b) dropped direction reversal — caught at 0x62A6 on expiry (oracle 0xFE vs twin 0x00);
 *      (c) inverted frame-parity gate (ticks on odd, skips on even) — caught at 0x62A5 on an
 *          even frame (oracle decremented vs twin untouched).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2679.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2679 as oracle } from "../../translated/loc_2679.js";
import { loc_2679 } from "../loc_2679.js";
import { loc_268d } from "../loc_268d.js";
import { reverseStepDirection } from "../reverseStepDirection.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, FRAME, M50_OBJ3_STEP_DIR } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2679;
const RET_ADDR = 0x25fe;        // sub_25F2_body's site right after `call 0x2679`
const TIMER = 0x62a5;           // object-3's reversal-timer countdown (no names.js name)
const SHADOW = 0x63a6;          // the tail's published step shadow (no names.js name)
const PAIR_P = 0x69f5;          // the tail's sprite-pair counter (advanced only when the gate opens)
const PAIR_P4 = 0x69f9;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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

/** Run the ORACLE on a fresh clone. Its terminal `ret` pops, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model the tail-jump chain's terminal `ret` with one
 * m.ret() so pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the
 * JS call stack, so it never touches pc/SP itself — the harness supplies the one caller return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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

// -- fixtures -----------------------------------------------------------------

/** A realistic booted machine, a few hundred attract frames in. */
function bootedMachine(frames) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m;
}

/**
 * Stamp a crafted 0x2679 dispatch onto a clone of the base: a stack with the real caller
 * return (0x25FE) staged in STACK_SCRATCH so the terminal `ret` has a sane, excluded target,
 * then the frame counter, the reversal-timer countdown, the direction latch, and the tail's
 * sprite-pair counters + shadow seed. clone() already neutralises the frame machinery
 * (nextNmi/nextBoundary = Infinity); re-asserted here so no stray NMI can masquerade as a
 * side effect while the oracle steps.
 */
function craft(base, { frame, timer, latch, p = 0x40, p4 = 0x80, shadow = 0x00 }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);            // SP -> 0x6BFE, return address inside STACK_SCRATCH
  e.mem.write8(FRAME, frame);
  e.mem.write8(TIMER, timer);
  e.mem.write8(M50_OBJ3_STEP_DIR, latch);
  e.mem.write8(PAIR_P, p);
  e.mem.write8(PAIR_P4, p4);
  e.mem.write8(SHADOW, shadow);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2679 is a non-executing frontier in attract (board-2 gated)", () => {
  let attractCount = 0;
  const snap = new Map([[TARGET, (mm) => { attractCount++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.equal(attractCount, 0, "0x2679 should NOT dispatch in plain attract (the sub_25F2 cascade is board-2 gated)");
  console.log(`  REACHABILITY: 0× in 1500 attract frames — the gate is crafted-entry`);
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): loc_2679 == oracle across every arm, with the intended effect asserted", () => {
  const base = bootedMachine(500).clone();

  const cases = [
    // ODD frame -> straight to tail; this routine does NOT touch its own countdown.
    { name: "odd frame -> tail, countdown untouched",
      opts: { frame: 0x01, timer: 0x05, latch: 0x00 },
      after: (o, e) => assert.equal(o.mem.read8(TIMER), e.mem.read8(TIMER), "odd frame must not tick the countdown") },

    // EVEN frame, still counting -> tick to nonzero, tail; no reload, no reverse.
    { name: "even frame, still counting -> tick only",
      opts: { frame: 0x04, timer: 0x05, latch: 0x00 },
      after: (o) => assert.equal(o.mem.read8(TIMER), 0x04, "countdown decremented by one") },

    // EVEN frame, exact expiry, latch non-negative (bit7 clear) -> reload 255 + reverse to -2.
    { name: "even frame, expiry, latch +ve -> reload + reverse to 0xFE",
      opts: { frame: 0x04, timer: 0x01, latch: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0xff, "countdown reloaded to 255 on expiry");
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), 0xfe, "step direction reversed to -2");
      } },

    // EVEN frame, exact expiry, latch negative (bit7 set) -> reload 255 + reverse to +2.
    { name: "even frame, expiry, latch -ve -> reload + reverse to 0x02",
      opts: { frame: 0x04, timer: 0x01, latch: 0x80 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0xff, "countdown reloaded to 255 on expiry");
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), 0x02, "step direction reversed to +2");
      } },

    // EVEN frame, countdown already 0 -> byte-wraps to 255 (nonzero) -> tail. The u8 wrap is
    // what keeps this OFF the expiry path: no reload, and crucially NO reverse (latch stays).
    { name: "even frame, 0 -> 255 wrap seam -> tick only (no reverse)",
      opts: { frame: 0x04, timer: 0x00, latch: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(TIMER), 0xff, "0 decrements to 255 (byte wrap)");
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), 0x00, "the wrap seam must NOT reverse the latch");
      } },

    // EVEN frame with the tail gate OPEN (low 5 bits == 2), on expiry: this routine reverses
    // the latch, then the tail advances object-3's mirrored sprite pair.
    { name: "even frame low5==2, expiry -> reverse + tail sprite-pair advance",
      opts: { frame: 0x02, timer: 0x01, latch: 0x00, p: 0x40, p4: 0x80 },
      after: (o, e) => {
        assert.equal(o.mem.read8(TIMER), 0xff, "countdown reloaded to 255");
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), 0xfe, "step direction reversed to -2");
        assert.notEqual(o.mem.read8(PAIR_P), e.mem.read8(PAIR_P), "the tail advanced the sprite pair");
      } },
  ];

  for (const { name, opts, after } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_2679);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    if (after) after(runOracle(entry), entry);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (odd skip, even tick, both reverse arms, 0→255 wrap, tail advance) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): on expiry, reverses but drops the countdown reload. */
function brokenNoReload(m) {
  const { regs, mem } = m;
  if ((mem.read8(FRAME) & 0x01) !== 0) return loc_268d(m);
  const remaining = u8(mem.read8(TIMER) - 1);
  mem.write8(TIMER, remaining);
  if (remaining !== 0) return loc_268d(m);
  // BUG: dropped mem.write8(TIMER, 0xff)
  regs.hl = M50_OBJ3_STEP_DIR;
  reverseStepDirection(m);
  return loc_268d(m);
}

/** Broken twin (b): on expiry, reloads but drops the direction reversal. */
function brokenNoReverse(m) {
  const { mem } = m;
  if ((mem.read8(FRAME) & 0x01) !== 0) return loc_268d(m);
  const remaining = u8(mem.read8(TIMER) - 1);
  mem.write8(TIMER, remaining);
  if (remaining !== 0) return loc_268d(m);
  mem.write8(TIMER, 0xff);
  // BUG: dropped the reverseStepDirection call
  return loc_268d(m);
}

/** Broken twin (c): inverts the frame-parity gate — ticks on odd frames, skips on even. */
function brokenInvertedParity(m) {
  const { regs, mem } = m;
  if ((mem.read8(FRAME) & 0x01) === 0) return loc_268d(m); // BUG: should skip on ODD
  const remaining = u8(mem.read8(TIMER) - 1);
  mem.write8(TIMER, remaining);
  if (remaining !== 0) return loc_268d(m);
  mem.write8(TIMER, 0xff);
  regs.hl = M50_OBJ3_STEP_DIR;
  reverseStepDirection(m);
  return loc_268d(m);
}

test("TEETH: the dropped-reload, dropped-reverse, and inverted-parity twins are all CAUGHT", () => {
  const base = bootedMachine(400).clone();

  // (a) dropped reload: on expiry the oracle reloads 0x62A5 to 255, the twin leaves it 0.
  const reload = craft(base, { frame: 0x04, timer: 0x01, latch: 0x00 });
  assert.equal(runOracle(reload).mem.read8(TIMER), 0xff, "oracle should reload the countdown here");
  const reloadDiffs = contractDiffs(reload, brokenNoReload);
  assert.ok(reloadDiffs.length > 0, "the dropped-reload twin escaped — the gate is worthless");
  assert.ok(reloadDiffs[0].startsWith(`RAM@${hx(TIMER)}`), `expected the reload diff at ${hx(TIMER)}, got ${reloadDiffs[0]}`);
  assert.equal(contractDiffs(reload, loc_2679).length, 0, "loc_2679 must still pass this entry");

  // (b) dropped reverse: on expiry the oracle flips 0x62A6 to 0xFE, the twin leaves it 0x00.
  const reverse = craft(base, { frame: 0x04, timer: 0x01, latch: 0x00 });
  assert.equal(runOracle(reverse).mem.read8(M50_OBJ3_STEP_DIR), 0xfe, "oracle should reverse the latch here");
  const reverseDiffs = contractDiffs(reverse, brokenNoReverse);
  assert.ok(reverseDiffs.length > 0, "the dropped-reverse twin escaped — the gate is worthless");
  assert.ok(reverseDiffs[0].startsWith(`RAM@${hx(M50_OBJ3_STEP_DIR)}`), `expected the reverse diff at ${hx(M50_OBJ3_STEP_DIR)}, got ${reverseDiffs[0]}`);
  assert.equal(contractDiffs(reverse, loc_2679).length, 0, "loc_2679 must still pass this entry");

  // (c) inverted parity: on an even frame the oracle ticks 0x62A5, the twin leaves it untouched.
  const parity = craft(base, { frame: 0x04, timer: 0x05, latch: 0x00 });
  const parityDiffs = contractDiffs(parity, brokenInvertedParity);
  assert.ok(parityDiffs.length > 0, "the inverted-parity twin escaped — the gate is worthless");
  assert.ok(parityDiffs[0].startsWith(`RAM@${hx(TIMER)}`), `expected the parity diff at ${hx(TIMER)}, got ${parityDiffs[0]}`);
  assert.equal(contractDiffs(parity, loc_2679).length, 0, "loc_2679 must still pass this entry");

  console.log(`  TEETH: dropped-reload caught (${reloadDiffs[0]}); dropped-reverse caught (${reverseDiffs[0]}); inverted-parity caught (${parityDiffs[0]})`);
});
