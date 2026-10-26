// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_268d (ROM 0x268D) — publish object-3's ±1 step to its
 * 0x63A6 shadow every frame, and on every 32nd frame advance object-3's mirrored
 * sprite-code pair (loc_26a6) one step.
 *
 * The routine WRITES MEMORY, so it is gated on memory-equivalence — RAM (minus the dead
 * STACK_SCRATCH) + pc + SP. LIVE-OUT is memory-only: the step it leaves in the
 * accumulator is dead (the sole exit successor sub_2AD3 reloads the accumulator with
 * Mario's X on its first instruction, and recomputes flags), so no register is compared.
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so the
 * harness does one m.ret() on the candidate AFTER the call to line pc + SP up with the
 * oracle (which rets internally). Every case runs on FRESH clones.
 *
 * Plain attract never dispatches 0x268D (0×): the whole sub_25F2 object cascade is
 * board-2 gated (`rst 0x30` mask 0x02) and attract plays 25m. So real dispatch states are
 * reproduced by running the TRANSLATED caller loc_2679 on clones of a booted machine with
 * 0x268D hooked to snapshot each true entry — exactly like 0x26A6/0x3064. loc_2679 reaches
 * the tail on an EVEN frame via its 0x62A5 countdown (there the frame gate opens → the
 * sprite-pair-advance arm) and on an ODD frame by a direct tail-jump (there the gate is
 * shut → the publish-then-return arm).
 *
 *   1. REACHABILITY — 0x268D is dispatched 0× in a plain attract run (documents the
 *      non-executing frontier), yet driving loc_2679 yields real entries for BOTH arms.
 *   2. EQUAL (captured) — loc_268d == oracle on every captured loc_2679 dispatch, across
 *      both arms.
 *   3. EQUAL (crafted) — poke the frame counter, the direction latch's sign (both loc_26a6
 *      arms), the sprite-pair counters (ordinary steps + all four wrap seams), and the
 *      shadow seed on a real attract base; assert the full contract AND the intended
 *      effect (odd → latch+shadow get ±1, counters untouched; even → shadow 0, latch
 *      untouched, counters stepped).
 *   4. TEETH — two broken twins, each MUST be caught:
 *      (a) dropped shadow publish — caught at 0x63A6 where the step differs from the seed.
 *      (b) dropped frame gate (always advances the sprite pair) — caught at the sprite-pair
 *          counters on an odd frame, where the oracle leaves them untouched.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-268d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_268d as oracle } from "../../translated/loc_268d.js";
import { loc_2679 } from "../../translated/loc_2679.js";
import { loc_268d } from "../loc_268d.js";
import { signStepHalfRate } from "../signStepHalfRate.js";
import { loc_26a6 } from "../loc_26a6.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, M50_OBJ3_STEP_DIR, FRAME } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x268d;
const RET_ADDR = 0x25fe;       // sub_25F2_body's `call 0x2AD3` — the real successor
const SHADOW = 0x63a6;         // object-3's published step shadow (no names.js name)
const PAIR_BASE = 0x69f4;      // sprite-pair base; P = +1, P+4 = +5
const PAIR_P = 0x69f5;
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it never touches pc/SP itself — the harness supplies the return).
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
 * Reproduce REAL 0x268D dispatches by running the translated loc_2679 on clones of a
 * booted machine, with 0x268D hooked to snapshot each true entry. An EVEN frame whose low
 * 5 bits are 2 reaches the tail through the 0x62A5 countdown and opens the frame gate (the
 * sprite-pair-advance arm); an ODD frame tail-jumps straight in with the gate shut (the
 * publish-then-return arm). SP is set into the excluded stack region so all the tail's
 * push/ret churn is dead scratch.
 */
function captureDispatches(booted) {
  const caps = [];
  const hook = (mm) => { caps.push(mm.clone()); return oracle(mm); };
  const drive = (frame) => {
    const e = booted.clone();
    e.mem.write8(FRAME, frame);
    e.regs.sp = 0x6bfe;
    e.routines.set(TARGET, hook);
    loc_2679(e);
  };
  for (const f of [0x02, 0x22, 0x42]) drive(f); // even, (FRAME & 0x1F)==2 -> advance arm
  for (const f of [0x01, 0x03, 0x21]) drive(f); // odd -> publish-then-return arm
  return caps;
}

/**
 * Stamp a crafted 0x268D dispatch onto a clone of the base: a stack with a plausible
 * caller return (so the terminal `ret` has a sane, excluded target), the frame counter,
 * the direction latch's sign, the two sprite-pair counters, and a shadow seed.
 */
function craft(base, { frame, latch, p = 0x40, p4 = 0x80, shadow = 0x00 }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);              // SP -> 0x6BFE, return address in STACK_SCRATCH
  e.mem.write8(FRAME, frame);
  e.mem.write8(M50_OBJ3_STEP_DIR, latch);
  e.mem.write8(PAIR_P, p);
  e.mem.write8(PAIR_P4, p4);
  e.mem.write8(SHADOW, shadow);
  return e;
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x268D is a non-executing frontier in attract, reachable via loc_2679", () => {
  let attractCount = 0;
  const snap = new Map([[TARGET, (mm) => { attractCount++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.equal(attractCount, 0, "0x268D should NOT dispatch in plain attract (board-2 gated)");

  const caps = captureDispatches(bootedMachine(500));
  assert.ok(caps.length >= 6, "expected real 0x268D entries from driving loc_2679");
  const arms = new Set(caps.map((c) => (c.mem.read8(FRAME) & 0x1f) === 0x02));
  assert.equal(arms.size, 2, "captured entries must cover BOTH arms (gate open and shut)");
  console.log(`  REACHABILITY: 0× in 1500 attract frames; ${caps.length} entries via loc_2679 (both arms)`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_268d == oracle on every real loc_2679 dispatch", () => {
  const caps = captureDispatches(bootedMachine(500));
  let advance = 0, publishOnly = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_268d); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if ((cap.mem.read8(FRAME) & 0x1f) === 0x02) advance++; else publishOnly++;
  }
  console.log(`  EQUAL/captured: ${caps.length} dispatches identical (${advance} advance-arm, ${publishOnly} publish-only)`);
});

// -- 3. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): both arms, both loc_26a6 directions, and all four wrap seams match", () => {
  const base = bootedMachine(400).clone();

  const cases = [
    // ODD frame -> publish-then-return. signStepHalfRate rewrites the latch and the shadow
    // to a unit step; the sprite pair is untouched.
    { name: "odd, latch +ve -> step +1", opts: { frame: 0x01, latch: 0x00, shadow: 0x77 },
      after: (o, e) => {
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), 0x01, "latch -> +1");
        assert.equal(o.mem.read8(SHADOW), 0x01, "shadow -> +1");
        assert.equal(o.mem.read8(PAIR_P), e.mem.read8(PAIR_P), "P untouched on the publish arm");
        assert.equal(o.mem.read8(PAIR_P4), e.mem.read8(PAIR_P4), "P+4 untouched on the publish arm");
      } },
    { name: "odd, latch -ve -> step -1", opts: { frame: 0x21, latch: 0x80, shadow: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), 0xff, "latch -> -1");
        assert.equal(o.mem.read8(SHADOW), 0xff, "shadow -> -1");
      } },
    // EVEN frame, gate open -> advance. signStepHalfRate returns 0 (shadow 0, latch kept);
    // loc_26a6 steps the pair, direction from the latch sign.
    { name: "even, count-up (P+, P+4-)", opts: { frame: 0x02, latch: 0x00, p: 0x40, p4: 0x80, shadow: 0x77 },
      after: (o, e) => {
        assert.equal(o.mem.read8(SHADOW), 0x00, "even frame publishes a zero step");
        assert.equal(o.mem.read8(M50_OBJ3_STEP_DIR), e.mem.read8(M50_OBJ3_STEP_DIR), "latch kept on the even frame");
        assert.equal(o.mem.read8(PAIR_P), 0x41, "P counts up");
        assert.equal(o.mem.read8(PAIR_P4), 0x7f, "P+4 counts down");
      } },
    { name: "even, count-down (P-, P+4+)", opts: { frame: 0x22, latch: 0x80, p: 0x40, p4: 0x80 },
      after: (o) => {
        assert.equal(o.mem.read8(PAIR_P), 0x3f, "P counts down");
        assert.equal(o.mem.read8(PAIR_P4), 0x81, "P+4 counts up");
      } },
    // The four loc_26a6 wrap seams, reached through this routine on an even frame.
    { name: "even, count-up P seam  (0x52->0x53=>0x50)", opts: { frame: 0x02, latch: 0x00, p: 0x52, p4: 0x40 },
      after: (o) => assert.equal(o.mem.read8(PAIR_P), 0x50, "P wraps to 0x50") },
    { name: "even, count-up P+4 seam (0xD0->0xCF=>0xD2)", opts: { frame: 0x42, latch: 0x00, p: 0x40, p4: 0xd0 },
      after: (o) => assert.equal(o.mem.read8(PAIR_P4), 0xd2, "P+4 wraps to 0xD2") },
    { name: "even, count-down P seam (0x50->0x4F=>0x52)", opts: { frame: 0x02, latch: 0x80, p: 0x50, p4: 0x40 },
      after: (o) => assert.equal(o.mem.read8(PAIR_P), 0x52, "P wraps to 0x52") },
    { name: "even, count-down P+4 seam (0xD2->0xD3=>0xD0)", opts: { frame: 0x22, latch: 0x80, p: 0x40, p4: 0xd2 },
      after: (o) => assert.equal(o.mem.read8(PAIR_P4), 0xd0, "P+4 wraps to 0xD0") },
  ];

  for (const { name, opts, after } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_268d);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    if (after) after(runOracle(entry), entry);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (publish ±1, both advance directions, 4 wrap seams) identical`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops the shadow publish. */
function brokenNoPublish(m) {
  const { regs, mem } = m;
  regs.hl = M50_OBJ3_STEP_DIR;
  signStepHalfRate(m);
  // BUG: dropped mem.write8(SHADOW, regs.a)
  if ((mem.read8(FRAME) & 0x1f) !== 0x02) return;
  regs.hl = PAIR_BASE;
  regs.de = M50_OBJ3_STEP_DIR;
  loc_26a6(m);
}

/** Broken twin (b): drops the every-32nd-frame gate — always advances the sprite pair. */
function brokenNoGate(m) {
  const { regs, mem } = m;
  regs.hl = M50_OBJ3_STEP_DIR;
  signStepHalfRate(m);
  mem.write8(SHADOW, regs.a);
  // BUG: dropped the `if ((FRAME & 0x1F) !== 2) return;` gate
  regs.hl = PAIR_BASE;
  regs.de = M50_OBJ3_STEP_DIR;
  loc_26a6(m);
}

test("TEETH: the dropped-publish twin and the dropped-frame-gate twin are CAUGHT", () => {
  const base = bootedMachine(400).clone();

  // (a) dropped publish: an odd frame with latch +ve makes the oracle write 0x01 to the
  // shadow (seeded 0x00), so the twin's omission diverges exactly at 0x63A6.
  const pub = craft(base, { frame: 0x01, latch: 0x00, shadow: 0x00 });
  assert.equal(runOracle(pub).mem.read8(SHADOW), 0x01, "oracle should publish +1 to the shadow here");
  const pubDiffs = contractDiffs(pub, brokenNoPublish);
  assert.ok(pubDiffs.length > 0, "the dropped-publish twin escaped — the gate is worthless");
  assert.ok(pubDiffs[0].startsWith(`RAM@${hx(SHADOW)}`), `expected the diff at ${hx(SHADOW)}, got ${pubDiffs[0]}`);
  assert.equal(contractDiffs(pub, loc_268d).length, 0, "loc_268d must still pass this entry");

  // (b) dropped frame gate: an odd frame — the oracle early-returns and leaves the sprite
  // pair untouched, but the twin runs loc_26a6 and mutates it. Counters chosen so both P
  // and P+4 provably change (no wrap coincidence).
  const gate = craft(base, { frame: 0x03, latch: 0x00, p: 0x40, p4: 0x80 });
  const gateDiffs = contractDiffs(gate, brokenNoGate);
  assert.ok(gateDiffs.length > 0, "the dropped-frame-gate twin escaped — the gate is worthless");
  assert.ok(
    gateDiffs[0].startsWith(`RAM@${hx(PAIR_P)}`) || gateDiffs[0].startsWith(`RAM@${hx(PAIR_P4)}`),
    `expected the diff at the sprite-pair counters, got ${gateDiffs[0]}`,
  );
  assert.equal(contractDiffs(gate, loc_268d).length, 0, "loc_268d must still pass this entry");

  console.log(`  TEETH: dropped-publish caught (${pubDiffs[0]}); dropped-frame-gate caught (${gateDiffs[0]})`);
});
