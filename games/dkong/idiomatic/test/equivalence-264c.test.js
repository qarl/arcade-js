// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_264c (ROM 0x264C) — publish object-2's ±1 step to BOTH its
 * shadows (0x63A5 = step, 0x63A4 = its negation) every frame, and on every 32nd frame
 * advance object-2's mirrored sprite-code pair (loc_26a6) one step, then re-stamp the
 * pair's low cell with the high cell's value with the flip bit cleared.
 *
 * The routine WRITES MEMORY, so it is gated on memory-equivalence — RAM (minus the dead
 * STACK_SCRATCH) + pc + SP. LIVE-OUT is memory-only: the value it leaves in the
 * accumulator is dead (the sole exit successor sub_2679 reloads the accumulator with the
 * frame counter on its first instruction, and recomputes flags), so no register is
 * compared. The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling),
 * so the harness does one m.ret() on the candidate AFTER the call to line pc + SP up with
 * the oracle (which rets internally, and whose two dissolved callee brackets leave only
 * dead STACK_SCRATCH). Every case runs on FRESH clones.
 *
 * Plain attract never dispatches 0x264C (0×): the whole sub_25F2 object cascade is board-2
 * gated (`rst 0x30` mask 0x02) and attract plays 25m. So real dispatch states are reproduced
 * by running the TRANSLATED caller loc_262f on clones of a booted machine with 0x264C hooked
 * to snapshot each true entry — exactly like 0x268D/0x26A6/0x3064. loc_262f reaches the tail
 * on an ODD frame by a direct tail-jump (there the internal 32-frame gate is shut → the
 * publish-then-return arm) and on an EVEN frame whose low 5 bits are zero via its 0x62A2
 * countdown (there the gate opens → the sprite-pair-advance arm).
 *
 *   1. REACHABILITY — 0x264C is dispatched 0× in a plain attract run (documents the
 *      non-executing frontier), yet driving loc_262f yields real entries for BOTH arms.
 *   2. EQUAL (captured) — loc_264c == oracle on every captured loc_262f dispatch, across
 *      both arms.
 *   3. EQUAL (crafted) — poke the frame counter, the direction latch's sign (both shadows),
 *      the reverse-timer's direction bit (both loc_26a6 arms), the sprite-pair counters
 *      (ordinary steps + all four wrap seams), and the shadow seeds on a real attract base;
 *      assert the full contract AND the intended effect (odd → latch + both shadows get
 *      ±1/∓1, counters untouched; even → both shadows 0, latch untouched, counters stepped
 *      and the low cell re-stamped with the flip bit cleared).
 *   4. TEETH — three broken twins, each MUST be caught:
 *      (a) dropped negate-publish (writes the raw step to 0x63A4) — caught at 0x63A4 where
 *          the negation differs from the step.
 *      (b) dropped frame gate (always advances the sprite pair) — caught at the sprite-pair
 *          counters on an odd frame, where the oracle leaves them untouched.
 *      (c) dropped flip-bit mask (stores the raw high-cell value) — caught at the low cell
 *          on an advance case where the high-cell value has its top bit set.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-264c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_264c as oracle } from "../../translated/loc_264c.js";
import { loc_262f } from "../../translated/loc_262f.js";
import { loc_264c } from "../loc_264c.js";
import { signStepHalfRate } from "../signStepHalfRate.js";
import { loc_26a6 } from "../loc_26a6.js";
import { u8 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, M50_OBJ2_STEP_DIR, FRAME } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x264c;
const RET_ADDR = 0x25fb;        // sub_25F2_body's `call 0x2679` — the real successor
const SHADOW_POS = 0x63a5;      // object-2's published +step shadow (no names.js name)
const SHADOW_NEG = 0x63a4;      // object-2's published −step shadow (no names.js name)
const SELECT = 0x62a2;          // object-2's reverse-timer; loc_26a6 direction = its top bit
const PAIR_BASE = 0x69ec;       // sprite-pair base; low = +1, high = +5
const PAIR_LOW = 0x69ed;
const PAIR_HIGH = 0x69f1;

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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP match
 * the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack, so it
 * never touches pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only (A is NOT compared). */
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
 * Reproduce REAL 0x264C dispatches by running the translated loc_262f on clones of a booted
 * machine, with 0x264C hooked to snapshot each true entry. Y (0x6205) is forced >= 0xC0 so
 * loc_262f stays on the tail path (it branches to loc_266f below 0xC0). An ODD frame
 * tail-jumps straight in with the internal gate shut (the publish arm); an EVEN frame whose
 * low 5 bits are zero reaches the tail through the 0x62A2 countdown and opens the gate (the
 * advance arm) — the countdown is seeded so its post-decrement value is nonzero, taking the
 * direct tail-jump. SP is set into the excluded stack region so all the tail's push/ret churn
 * is dead scratch.
 */
function captureDispatches(booted) {
  const caps = [];
  const hook = (mm) => { caps.push(mm.clone()); return oracle(mm); };
  const drive = (frame) => {
    const e = booted.clone();
    e.mem.write8(FRAME, frame);
    e.mem.write8(0x6205, 0xc0);   // Y >= 0xC0 -> stay on the tail path, not loc_266f
    e.mem.write8(SELECT, 0x10);   // even path decrements this to 0x0F (nonzero) -> tail-jump
    e.regs.sp = 0x6bfe;
    e.routines.set(TARGET, hook);
    loc_262f(e);
  };
  for (const f of [0x00, 0x20, 0x40]) drive(f); // even, (FRAME & 0x1F)==0 -> advance arm
  for (const f of [0x01, 0x03, 0x21]) drive(f); // odd -> publish-then-return arm
  return caps;
}

/**
 * Stamp a crafted 0x264C dispatch onto a clone of the base: a stack with a plausible caller
 * return (so the terminal `ret` has a sane, excluded target), the frame counter, the
 * direction latch's sign, the reverse-timer (loc_26a6 direction select), the two sprite-pair
 * counters, and the two shadow seeds.
 */
function craft(base, { frame, latch, timer = 0x00, p = 0x40, p4 = 0x80, sPos = 0x00, sNeg = 0x00 }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);              // SP -> 0x6BFE, return address in STACK_SCRATCH
  e.mem.write8(FRAME, frame);
  e.mem.write8(M50_OBJ2_STEP_DIR, latch);
  e.mem.write8(SELECT, timer);
  e.mem.write8(PAIR_LOW, p);
  e.mem.write8(PAIR_HIGH, p4);
  e.mem.write8(SHADOW_POS, sPos);
  e.mem.write8(SHADOW_NEG, sNeg);
  return e;
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x264C is a non-executing frontier in attract, reachable via loc_262f", () => {
  let attractCount = 0;
  const snap = new Map([[TARGET, (mm) => { attractCount++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.equal(attractCount, 0, "0x264C should NOT dispatch in plain attract (board-2 gated)");

  const caps = captureDispatches(bootedMachine(500));
  assert.ok(caps.length >= 6, "expected real 0x264C entries from driving loc_262f");
  const arms = new Set(caps.map((c) => (c.mem.read8(FRAME) & 0x1f) === 0x00));
  assert.equal(arms.size, 2, "captured entries must cover BOTH arms (gate open and shut)");
  console.log(`  REACHABILITY: 0× in 1500 attract frames; ${caps.length} entries via loc_262f (both arms)`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_264c == oracle on every real loc_262f dispatch", () => {
  const caps = captureDispatches(bootedMachine(500));
  let advance = 0, publishOnly = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_264c); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if ((cap.mem.read8(FRAME) & 0x1f) === 0x00) advance++; else publishOnly++;
  }
  assert.ok(advance > 0 && publishOnly > 0, "expected both arms among the captured dispatches");
  console.log(`  EQUAL/captured: ${caps.length} dispatches identical (${advance} advance-arm, ${publishOnly} publish-only)`);
});

// -- 3. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): both arms, both loc_26a6 directions, and all four wrap seams match", () => {
  const base = bootedMachine(400).clone();

  const cases = [
    // ODD frame -> publish-then-return. signStepHalfRate rewrites the latch and BOTH shadows
    // to a unit step / its negation; the sprite pair is untouched.
    { name: "odd, latch +ve -> +1 / −1", opts: { frame: 0x01, latch: 0x00, sPos: 0x77, sNeg: 0x77 },
      after: (o, e) => {
        assert.equal(o.mem.read8(M50_OBJ2_STEP_DIR), 0x01, "latch -> +1");
        assert.equal(o.mem.read8(SHADOW_POS), 0x01, "+shadow -> +1");
        assert.equal(o.mem.read8(SHADOW_NEG), 0xff, "−shadow -> negation of +1");
        assert.equal(o.mem.read8(PAIR_LOW), e.mem.read8(PAIR_LOW), "low cell untouched on the publish arm");
        assert.equal(o.mem.read8(PAIR_HIGH), e.mem.read8(PAIR_HIGH), "high cell untouched on the publish arm");
      } },
    { name: "odd, latch -ve -> −1 / +1", opts: { frame: 0x21, latch: 0x80, sPos: 0x00, sNeg: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(M50_OBJ2_STEP_DIR), 0xff, "latch -> -1");
        assert.equal(o.mem.read8(SHADOW_POS), 0xff, "+shadow -> -1");
        assert.equal(o.mem.read8(SHADOW_NEG), 0x01, "−shadow -> negation of -1");
      } },
    // EVEN frame, gate open -> advance. signStepHalfRate returns 0 (both shadows 0, latch
    // kept); loc_26a6 steps the pair, direction from the reverse-timer's top bit, then the low
    // cell is re-stamped with the high cell's value (flip bit cleared).
    { name: "even, count-up (P+, P+4−)", opts: { frame: 0x00, latch: 0x00, timer: 0x00, p: 0x40, p4: 0x80, sPos: 0x77, sNeg: 0x77 },
      after: (o, e) => {
        assert.equal(o.mem.read8(SHADOW_POS), 0x00, "even frame publishes a zero +step");
        assert.equal(o.mem.read8(SHADOW_NEG), 0x00, "even frame publishes a zero −step");
        assert.equal(o.mem.read8(M50_OBJ2_STEP_DIR), e.mem.read8(M50_OBJ2_STEP_DIR), "latch kept on the even frame");
        assert.equal(o.mem.read8(PAIR_HIGH), 0x7f, "high cell counts down");
        assert.equal(o.mem.read8(PAIR_LOW), 0x7f, "low cell re-stamped with the high cell (0x7F & 0x7F)");
      } },
    { name: "even, count-down (P−, P+4+) with flip-bit mask", opts: { frame: 0x20, latch: 0x80, timer: 0x80, p: 0x40, p4: 0x80 },
      after: (o) => {
        assert.equal(o.mem.read8(PAIR_HIGH), 0x81, "high cell counts up");
        assert.equal(o.mem.read8(PAIR_LOW), 0x01, "low cell re-stamped with 0x81 & 0x7F = 0x01 (flip bit cleared)");
      } },
    // The four loc_26a6 wrap seams, reached through this routine on an even frame. The high
    // cell's seams survive in the low cell (re-stamped); the low cell's own seams are computed
    // by loc_26a6 then overwritten by the re-stamp, so the contract (not `after`) proves them.
    { name: "even, count-up high seam (0xD0->0xCF=>0xD2)", opts: { frame: 0x00, latch: 0x00, timer: 0x00, p: 0x40, p4: 0xd0 },
      after: (o) => {
        assert.equal(o.mem.read8(PAIR_HIGH), 0xd2, "high cell wraps to 0xD2");
        assert.equal(o.mem.read8(PAIR_LOW), 0x52, "low cell re-stamped with 0xD2 & 0x7F = 0x52");
      } },
    { name: "even, count-down high seam (0xD2->0xD3=>0xD0)", opts: { frame: 0x40, latch: 0x80, timer: 0x80, p: 0x40, p4: 0xd2 },
      after: (o) => {
        assert.equal(o.mem.read8(PAIR_HIGH), 0xd0, "high cell wraps to 0xD0");
        assert.equal(o.mem.read8(PAIR_LOW), 0x50, "low cell re-stamped with 0xD0 & 0x7F = 0x50");
      } },
    { name: "even, count-up low seam (0x52->0x53=>0x50)", opts: { frame: 0x00, latch: 0x00, timer: 0x00, p: 0x52, p4: 0x40 },
      after: (o) => assert.equal(o.mem.read8(PAIR_HIGH), 0x3f, "high cell steps down to 0x3F (low-cell seam proven by the contract)") },
    { name: "even, count-down low seam (0x50->0x4F=>0x52)", opts: { frame: 0x20, latch: 0x80, timer: 0x80, p: 0x50, p4: 0x40 },
      after: (o) => assert.equal(o.mem.read8(PAIR_HIGH), 0x41, "high cell steps up to 0x41 (low-cell seam proven by the contract)") },
  ];

  for (const { name, opts, after } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_264c);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    if (after) after(runOracle(entry), entry);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (publish ±1/∓1, both advance directions, flip-bit mask, 4 wrap seams) identical`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops the negation — publishes the raw step to the −shadow. */
function brokenNoNegate(m) {
  const { regs, mem } = m;
  regs.hl = M50_OBJ2_STEP_DIR;
  signStepHalfRate(m);
  const step = regs.a;
  mem.write8(SHADOW_POS, step);
  mem.write8(SHADOW_NEG, step); // BUG: should be u8(-step)
  if ((mem.read8(FRAME) & 0x1f) !== 0) return;
  regs.hl = PAIR_BASE;
  regs.de = SELECT;
  loc_26a6(m);
  mem.write8(PAIR_LOW, regs.a & 0x7f);
}

/** Broken twin (b): drops the every-32nd-frame gate — always advances the sprite pair. */
function brokenNoGate(m) {
  const { regs, mem } = m;
  regs.hl = M50_OBJ2_STEP_DIR;
  signStepHalfRate(m);
  const step = regs.a;
  mem.write8(SHADOW_POS, step);
  mem.write8(SHADOW_NEG, u8(-step));
  // BUG: dropped the `if ((FRAME & 0x1F) !== 0) return;` gate
  regs.hl = PAIR_BASE;
  regs.de = SELECT;
  loc_26a6(m);
  mem.write8(PAIR_LOW, regs.a & 0x7f);
}

/** Broken twin (c): drops the flip-bit mask — stores the raw high-cell value. */
function brokenNoMask(m) {
  const { regs, mem } = m;
  regs.hl = M50_OBJ2_STEP_DIR;
  signStepHalfRate(m);
  const step = regs.a;
  mem.write8(SHADOW_POS, step);
  mem.write8(SHADOW_NEG, u8(-step));
  if ((mem.read8(FRAME) & 0x1f) !== 0) return;
  regs.hl = PAIR_BASE;
  regs.de = SELECT;
  loc_26a6(m);
  mem.write8(PAIR_LOW, regs.a); // BUG: dropped & 0x7f
}

test("TEETH: the dropped-negate, dropped-frame-gate, and dropped-flip-bit-mask twins are CAUGHT", () => {
  const base = bootedMachine(400).clone();

  // (a) dropped negate: an odd frame with latch +ve makes the oracle write 0xFF to the
  // −shadow (step +1 negated), so the twin's raw 0x01 diverges exactly at 0x63A4.
  const neg = craft(base, { frame: 0x01, latch: 0x00, sPos: 0x00, sNeg: 0x00 });
  assert.equal(runOracle(neg).mem.read8(SHADOW_NEG), 0xff, "oracle should publish -1 to the −shadow here");
  const negDiffs = contractDiffs(neg, brokenNoNegate);
  assert.ok(negDiffs.length > 0, "the dropped-negate twin escaped — the gate is worthless");
  assert.ok(negDiffs[0].startsWith(`RAM@${hx(SHADOW_NEG)}`), `expected the diff at ${hx(SHADOW_NEG)}, got ${negDiffs[0]}`);
  assert.equal(contractDiffs(neg, loc_264c).length, 0, "loc_264c must still pass this entry");

  // (b) dropped frame gate: an odd frame — the oracle early-returns and leaves the sprite
  // pair untouched, but the twin runs loc_26a6 and mutates it. Counters chosen so both cells
  // provably change (no wrap coincidence).
  const gate = craft(base, { frame: 0x03, latch: 0x00, timer: 0x00, p: 0x40, p4: 0x80 });
  const gateDiffs = contractDiffs(gate, brokenNoGate);
  assert.ok(gateDiffs.length > 0, "the dropped-frame-gate twin escaped — the gate is worthless");
  assert.ok(
    gateDiffs[0].startsWith(`RAM@${hx(PAIR_LOW)}`) || gateDiffs[0].startsWith(`RAM@${hx(PAIR_HIGH)}`),
    `expected the diff at the sprite-pair counters, got ${gateDiffs[0]}`,
  );
  assert.equal(contractDiffs(gate, loc_264c).length, 0, "loc_264c must still pass this entry");

  // (c) dropped flip-bit mask: an even gate-open frame, count-down direction, high cell steps
  // 0x80 -> 0x81; the oracle re-stamps the low cell with 0x81 & 0x7F = 0x01, the twin with the
  // raw 0x81 — diverging exactly at the low cell.
  const mask = craft(base, { frame: 0x00, latch: 0x00, timer: 0x80, p: 0x40, p4: 0x80 });
  assert.equal(runOracle(mask).mem.read8(PAIR_LOW), 0x01, "oracle should re-stamp the low cell with the flip bit cleared");
  const maskDiffs = contractDiffs(mask, brokenNoMask);
  assert.ok(maskDiffs.length > 0, "the dropped-flip-bit-mask twin escaped — the gate is worthless");
  assert.ok(maskDiffs[0].startsWith(`RAM@${hx(PAIR_LOW)}`), `expected the diff at ${hx(PAIR_LOW)}, got ${maskDiffs[0]}`);
  assert.equal(contractDiffs(mask, loc_264c).length, 0, "loc_264c must still pass this entry");

  console.log(`  TEETH: dropped-negate caught (${negDiffs[0]}); dropped-frame-gate caught (${gateDiffs[0]}); dropped-flip-bit-mask caught (${maskDiffs[0]})`);
});
