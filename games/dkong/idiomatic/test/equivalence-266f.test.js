// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_266f (ROM 0x266F) — the "Y below 0xC0" arm of loc_262f: force
 * object-2's step-direction latch (M50_OBJ2_STEP_DIR, 0x62A3) negative unless its sign bit
 * is already set, then run the shared publish/animate tail (loc_264c).
 *
 * loc_266f WRITES MEMORY (the latch, on the not-yet-negative arm) and then tails into the
 * shared publish/animate routine, so it is gated on memory-equivalence — RAM (minus the dead
 * STACK_SCRATCH) + pc + SP. LIVE-OUT is memory-only: the tail's exit successor (sub_2AD3)
 * reloads the accumulator with Mario's X before reading it, so no register this routine
 * leaves is consumed downstream.
 *
 * The oracle is a tail-jump chain (loc_262f -> loc_266f -> the shared tail -> `ret`) that
 * nets exactly ONE caller-return pop. The idiomatic routine models the whole chain with
 * direct JS calls and a plain return (no stack modelling), so the harness performs ONE
 * m.ret() on the candidate AFTER the call to line pc + SP up with the oracle. Every nested
 * push the tail makes lands in STACK_SCRATCH and is excluded. Every case runs on FRESH clones
 * (the routine writes memory).
 *
 * Plain attract never dispatches 0x266F (0×): the whole sub_25F2 object cascade is board-2
 * gated (`ld a,0x02 / rst 0x30`) and attract plays 25m. So real dispatch states are
 * reproduced by running the TRANSLATED caller loc_262f on clones of a booted machine with
 * object-2's Y forced below 0xC0 (so loc_262f branches here) and 0x266F hooked to snapshot
 * each true entry — the same drive-the-caller technique the sibling 0x264C/0x268D tests use.
 * That capture also proves the sole caller enters with the latch pointer fixed at
 * M50_OBJ2_STEP_DIR, which is why this routine addresses that named cell directly.
 *
 *   1. REACHABILITY — 0x266F is dispatched 0× in a plain attract run (documents the
 *      non-executing board-2 frontier), yet driving loc_262f yields real entries for BOTH
 *      arms (latch sign clear and set).
 *   2. EQUAL (captured) — loc_266f == oracle on every real loc_262f dispatch, across both arms.
 *   3. EQUAL (crafted) — poke the latch sign (both arms, plus the 0x7F/0x80/0xC0 boundaries)
 *      and the frame counter (odd -> the tail's publish arm; even, low 5 bits != 0 -> the tail
 *      leaves the latch; even, low 5 bits == 0 -> the tail advances the sprite pair) on a real
 *      attract base; assert the full contract AND the intended effect (sign clear -> latch
 *      forced 0xFF; sign set -> latch untouched).
 *   4. TEETH — two broken twins, each MUST be caught:
 *      (a) inverted sign test (forces the latch when it is ALREADY negative) — caught at
 *          0x62A3 on a sign-set entry, where the oracle leaves the latch alone.
 *      (b) dropped force-negative write (never stamps 0xFF) — caught at 0x62A3 on a sign-clear
 *          entry, where the oracle forces the latch negative.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-266f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_266f as oracle } from "../../translated/loc_266f.js";
import { loc_262f } from "../../translated/loc_262f.js";
import { loc_266f } from "../loc_266f.js";
import { loc_264c } from "../loc_264c.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, M50_OBJ2_STEP_DIR, FRAME } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x266f;
const RET_ADDR = 0x25fb;        // sub_25F2_body's site right after `call 0x262f` — the real caller return
const OBJ2_Y = 0x6205;          // object-2's Y; loc_262f branches here when it is below 0xC0
const LATCH = M50_OBJ2_STEP_DIR; // 0x62A3 — object-2's step-direction latch (this routine's cell)
const SHADOW_POS = 0x63a5;      // the tail's published +step shadow (no names.js name)
const SHADOW_NEG = 0x63a4;      // the tail's published −step shadow (no names.js name)

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

/** Run the ORACLE on a fresh clone. Its tail-jump chain rets internally, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

// Run a candidate on a fresh clone, then model the tail-jump chain's terminal `ret` with one m.ret() so pc + SP
// match the oracle's (the idiomatic routine never touches pc/SP itself — the harness supplies the one caller return).
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

// Reproduce REAL 0x266F dispatches by running the translated loc_262f on clones of a booted machine, with 0x266F
// hooked to snapshot each true entry. object-2's Y (0x6205) is forced below 0xC0 so loc_262f branches here, and the
// latch is seeded to cover BOTH arms (sign bit clear and set). SP is set into the excluded stack region.
function captureDispatches(booted) {
  const caps = [];
  const hook = (mm) => { caps.push(mm.clone()); return oracle(mm); };
  const drive = (latch) => {
    const e = booted.clone();
    e.mem.write8(OBJ2_Y, 0x00);       // Y < 0xC0 -> loc_262f branches to loc_266f
    e.mem.write8(LATCH, latch);       // seed the sign bit both ways across drives
    e.regs.sp = 0x6bfe;               // into STACK_SCRATCH -> the tail's ret target is excluded
    e.routines.set(TARGET, hook);
    loc_262f(e);
  };
  for (const v of [0x00, 0x40, 0x7f]) drive(v); // sign clear -> force-negative arm
  for (const v of [0x80, 0xc0, 0xff]) drive(v); // sign set   -> leave-alone arm
  return caps;
}

// Stamp a crafted 0x266F dispatch onto a clone of the base: a stack with the real caller return (0x25FB) staged in
// STACK_SCRATCH so the terminal `ret` has a sane, excluded target, the caller's latch pointer in hl (the oracle reads
// the sign bit through it), the frame counter, and the latch value. nextNmi/nextBoundary = Infinity is re-asserted
// so no stray NMI can masquerade as a side effect while the oracle steps.
function craft(base, { frame, latch }) {
  const e = base.clone();
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);            // SP -> 0x6BFE, return address inside STACK_SCRATCH
  e.regs.hl = LATCH;            // the caller enters with the latch pointer here
  e.mem.write8(FRAME, frame);
  e.mem.write8(LATCH, latch);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x266F is a non-executing frontier in attract, reachable via loc_262f", () => {
  let attractCount = 0;
  const snap = new Map([[TARGET, (mm) => { attractCount++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.equal(attractCount, 0, "0x266F should NOT dispatch in plain attract (the sub_25F2 cascade is board-2 gated)");

  const caps = captureDispatches(bootedMachine(500));
  assert.ok(caps.length >= 6, "expected real 0x266F entries from driving loc_262f");
  const arms = new Set(caps.map((c) => (c.mem.read8(LATCH) & 0x80) !== 0));
  assert.equal(arms.size, 2, "captured entries must cover BOTH arms (sign bit clear and set)");
  console.log(`  REACHABILITY: 0× in 1500 attract frames; ${caps.length} entries via loc_262f (both arms)`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_266f == oracle on every real loc_262f dispatch", () => {
  const caps = captureDispatches(bootedMachine(500));
  let force = 0, leave = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_266f); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if ((cap.mem.read8(LATCH) & 0x80) === 0) force++; else leave++;
  }
  assert.ok(force > 0 && leave > 0, "expected both arms among the captured dispatches");
  console.log(`  EQUAL/captured: ${caps.length} dispatches identical (${force} force-negative, ${leave} leave-alone)`);
});

// -- 3. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): both arms across the sign boundary, and all three tail arms, match", () => {
  const base = bootedMachine(400).clone();

  const cases = [
    // EVEN frame, low 5 bits != 0 -> the tail leaves the latch alone, so the final latch
    // reflects THIS routine's own action exactly.
    { name: "sign clear (0x00) -> forced 0xFF", opts: { frame: 0x02, latch: 0x00 },
      after: (o) => assert.equal(o.mem.read8(LATCH), 0xff, "latch forced negative") },
    { name: "sign clear at 0x7F boundary -> forced 0xFF", opts: { frame: 0x02, latch: 0x7f },
      after: (o) => assert.equal(o.mem.read8(LATCH), 0xff, "0x7F is still sign-clear -> forced") },
    { name: "sign set at 0x80 boundary -> untouched", opts: { frame: 0x02, latch: 0x80 },
      after: (o) => assert.equal(o.mem.read8(LATCH), 0x80, "0x80 is sign-set -> left alone") },
    { name: "sign set (0xC0) -> untouched", opts: { frame: 0x02, latch: 0xc0 },
      after: (o) => assert.equal(o.mem.read8(LATCH), 0xc0, "sign-set latch left alone (no 0xFF stamp)") },

    // ODD frame -> the tail's publish arm reduces the (now forced) latch to a unit step and
    // publishes both polarities. Proves the forced 0xFF feeds the tail correctly.
    { name: "odd frame publish arm, sign clear", opts: { frame: 0x01, latch: 0x00 },
      after: (o) => {
        assert.equal(o.mem.read8(LATCH), 0xff, "forced 0xFF, reduced to -1 by the publish arm");
        assert.equal(o.mem.read8(SHADOW_POS), 0xff, "+shadow published -1");
        assert.equal(o.mem.read8(SHADOW_NEG), 0x01, "−shadow published +1 (negation)");
      } },

    // EVEN frame, low 5 bits == 0 -> the tail advances object-2's sprite pair (the contract
    // covers that block); the latch is still left alone, so the force is visible.
    { name: "even frame low5==0 advance arm, sign clear", opts: { frame: 0x00, latch: 0x00 },
      after: (o) => assert.equal(o.mem.read8(LATCH), 0xff, "forced 0xFF, tail leaves it on an even frame") },
  ];

  for (const { name, opts, after } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_266f);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    if (after) after(runOracle(entry), entry);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (force/leave across the sign boundary, publish + leave + advance tail arms) identical`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): inverts the sign test — forces the latch when it is ALREADY negative. */
function brokenInvertedSign(m) {
  const { mem } = m;
  if ((mem.read8(LATCH) & 0x80) !== 0) mem.write8(LATCH, 0xff); // BUG: should force when CLEAR
  return loc_264c(m);
}

/** Broken twin (b): drops the force-negative write — never stamps 0xFF. */
function brokenNoWrite(m) {
  // BUG: dropped the `if sign clear -> latch = 0xFF` write
  return loc_264c(m);
}

test("TEETH: the inverted-sign and dropped-force-negative twins are CAUGHT", () => {
  const base = bootedMachine(400).clone();

  // (a) inverted sign: a sign-SET latch on an even frame — the oracle leaves 0x62A3 at 0xC0, the twin stamps it to 0xFF.
  const inv = craft(base, { frame: 0x02, latch: 0xc0 });
  assert.equal(runOracle(inv).mem.read8(LATCH), 0xc0, "oracle should leave the sign-set latch alone here");
  const invDiffs = contractDiffs(inv, brokenInvertedSign);
  assert.ok(invDiffs.length > 0, "the inverted-sign twin escaped — the gate is worthless");
  assert.ok(invDiffs[0].startsWith(`RAM@${hx(LATCH)}`), `expected the diff at ${hx(LATCH)}, got ${invDiffs[0]}`);
  assert.equal(contractDiffs(inv, loc_266f).length, 0, "loc_266f must still pass this entry");

  // (b) dropped write: a sign-CLEAR latch on an even frame — the oracle forces 0x62A3 to 0xFF, the twin leaves it 0x00.
  const drop = craft(base, { frame: 0x02, latch: 0x00 });
  assert.equal(runOracle(drop).mem.read8(LATCH), 0xff, "oracle should force the latch negative here");
  const dropDiffs = contractDiffs(drop, brokenNoWrite);
  assert.ok(dropDiffs.length > 0, "the dropped-force-negative twin escaped — the gate is worthless");
  assert.ok(dropDiffs[0].startsWith(`RAM@${hx(LATCH)}`), `expected the diff at ${hx(LATCH)}, got ${dropDiffs[0]}`);
  assert.equal(contractDiffs(drop, loc_266f).length, 0, "loc_266f must still pass this entry");

  console.log(`  TEETH: inverted-sign caught (${invDiffs[0]}); dropped-force-negative caught (${dropDiffs[0]})`);
});
