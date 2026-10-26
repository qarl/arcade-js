// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1e6d (ROM 0x1E6D) — the board-won interior of Mario's per-frame
 * position check (sub_1e57). It writes Mario's sprite-record code byte
 * (MARIO_SPRITE_RECORD + SPRITE_CODE = 0x694D) to a bare facing value chosen by the carry
 * the caller hands it (carry set -> 0x00, carry clear -> 0x80 = the horizontal-flip bit),
 * then tail-calls enterBoardAdvanceAndUnwind (0x1E85), which stamps GAME_SUBSTATE (0x600A)
 * := 0x16 and UNWINDS out of the movement cascade. In direct-call form that non-local exit
 * is a boolean — the idiomatic routine returns the callee's false (the caller-skip signal).
 *
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the boolean
 * unwind signal. Live-out is memory-only otherwise (see the routine header).
 *
 * A long attract run dispatches 0x1E6D ZERO times (attract never completes a board / never
 * rescues Pauline), so — exactly as docs/decompiler-pipeline prescribes for arms attract
 * never reaches — the gate is CRAFTED: a real booted attract machine, cloned, with a
 * controlled return stack staged in STACK_SCRATCH, a sprite-code sentinel and a
 * GAME_SUBSTATE sentinel poked, and the carry driven BOTH ways, then oracle-vs-idiomatic on
 * independent fresh clones. The carry is the only input; both arms are swept.
 *
 * The oracle tail-calls 0x1E85, whose two-level unwind (discard own return `pop hl`, then
 * `ret` to the grandparent) is modeled on the candidate as one discarded pop + one net
 * return, so pc + SP line up; the discarded return and the popped bytes both sit in
 * STACK_SCRATCH (excluded by contract). loc_1e6d itself pushes/pops nothing.
 *
 *   1. EQUAL (crafted) — both carry arms, several GAME_SUBSTATE sentinels; RAM + pc + SP
 *      identical, the idiomatic routine returns false, and the oracle's outputs are asserted
 *      (0x694D == carry ? 0x00 : 0x80, 0x600A == 0x16, SP advanced by 4, pc == the staged
 *      grandparent return) so EQUAL is not vacuous and the stack exclusion is load-bearing.
 *
 *   2. TEETH — four deliberately-broken twins, each MUST be caught:
 *      (a) inverted-flip — writes 0x80 on carry set / 0x00 on carry clear; caught at 0x694D.
 *      (b) dropped-sprite-write — never writes 0x694D; caught at 0x694D (sentinel remains).
 *      (c) dropped-board-advance — never enters the advance sub-state; caught at 0x600A.
 *      (d) no-unwind — returns true instead of false; caught by the boolean signal check.
 *
 *   3. REALISM — hook 0x1E6D over a long attract run; replay any real dispatch, else record
 *      that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e6d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e6d as oracle } from "../../translated/loc_1e6d.js";
import { loc_1e6d } from "../loc_1e6d.js";
import { enterBoardAdvanceAndUnwind } from "../enterBoardAdvanceAndUnwind.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, GAME_SUBSTATE, MARIO_SPRITE_RECORD, SPRITE_CODE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e6d;
const BOARD_ADVANCE_SUBSTATE = 0x16;
const SPRITE_FLAG = MARIO_SPRITE_RECORD + SPRITE_CODE; // 0x694D — the sprite-code / mirror byte
const GRAND_RET = 0x1234; // the grandparent return the unwind lands on (compared both sides)
const OWN_RET = 0x1e78;   // the "own" return the oracle's 0x1E85 tail discards (`pop hl`)
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const F_C = 0x01;         // carry is bit 0 of the flag byte
const SENTINEL_SPRITE = 0x37; // != 0x00 and != 0x80, so BOTH carry arms write observably
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region excluded by contract — the unwind's popped bytes live there). */
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

/** Run the ORACLE on a fresh clone. loc_1e6d writes the flip byte, then tail-calls the
 *  translated 0x1E85 (resolved through the oracle table), which does `pop hl` then `ret`
 *  — so SP += 4 and pc becomes the staged grandparent return. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model the oracle's two-level unwind with one
 *  discarded pop + one net return so pc + SP align (the idiomatic routine uses the JS call
 *  stack and returns a boolean; it never touches pc/SP itself). Returns {c, ret}. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.pop16(); // discard the own return (models 0x1E85's `pop hl`)
  c.ret();   // net return to the grandparent (models 0x1E85's `ret`)
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hx(ram.a & 0xff)} cand=${hx(ram.b & 0xff)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

/** A fresh crafted entry: real attract RAM, a controlled return stack (own return then
 *  grandparent return staged in STACK_SCRATCH), the carry set/cleared, a sprite-code
 *  sentinel and a GAME_SUBSTATE sentinel poked so both writes are observable. */
function craftEntry({ carry, substate }) {
  const e = base().clone();
  e.regs.sp = SP_TOP;
  e.push16(GRAND_RET); // -> 0x6bfa
  e.push16(OWN_RET);   // -> 0x6bf8 (the return 0x1E85 discards)
  e.regs.f = carry ? (e.regs.f | F_C) : (e.regs.f & ~F_C);
  e.mem.write8(SPRITE_FLAG, SENTINEL_SPRITE);
  e.mem.write8(GAME_SUBSTATE, substate);
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** (a) inverted-flip — writes 0x80 on carry set / 0x00 on carry clear (mapping reversed). */
function brokenInvertedFlip(m) {
  m.mem.write8(SPRITE_FLAG, m.regs.fC ? 0x80 : 0x00);
  return enterBoardAdvanceAndUnwind(m);
}

/** (b) dropped-sprite-write — advances the board but never writes the flip byte. */
function brokenDropSpriteWrite(m) {
  return enterBoardAdvanceAndUnwind(m);
}

/** (c) dropped-board-advance — writes the flip byte but never enters the advance sub-state. */
function brokenDropAdvance(m) {
  m.mem.write8(SPRITE_FLAG, m.regs.fC ? 0x00 : 0x80);
  return false;
}

/** (d) no-unwind — correct writes but signals "continue" (true) instead of "abort". */
function brokenNoUnwind(m) {
  m.mem.write8(SPRITE_FLAG, m.regs.fC ? 0x00 : 0x80);
  enterBoardAdvanceAndUnwind(m);
  return true;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): loc_1e6d == oracle on RAM+pc+SP for both carry arms and returns the unwind signal", () => {
  const sentinels = [0x0c, 0x0d, 0x00, 0xff, 0x08];
  let cases = 0;
  for (const carry of [true, false]) {
    for (const s of sentinels) {
      const entry = craftEntry({ carry, substate: s });

      const diffs = contractDiffs(entry, loc_1e6d);
      assert.equal(diffs.length, 0, `carry=${carry} sentinel ${hx(s)}: ${diffs.join("; ")}`);

      // The idiomatic routine must signal the unwind (caller-skip) with false.
      const { ret } = runCandidate(entry, loc_1e6d);
      assert.equal(ret, false, `carry=${carry} sentinel ${hx(s)}: idiomatic must return false (the unwind signal)`);

      // Oracle sanity — so EQUAL is not vacuous and the stack exclusion is load-bearing.
      const o = runOracle(entry);
      assert.equal(o.mem.read8(SPRITE_FLAG), carry ? 0x00 : 0x80, `carry=${carry}: oracle must set 0x694D to the facing value`);
      assert.equal(o.mem.read8(GAME_SUBSTATE), BOARD_ADVANCE_SUBSTATE, "oracle must set GAME_SUBSTATE := 0x16");
      assert.equal(o.regs.sp, SP_TOP, "oracle must unwind SP by 4 (0x1E85's pop hl + ret)");
      assert.equal(o.pc, GRAND_RET, "oracle must return to the staged grandparent address (two levels up)");
      assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");
      cases++;
    }
  }
  console.log(`  EQUAL/crafted: ${cases} cases (both carry arms × ${sentinels.length} sentinels) identical on RAM+pc+SP; idiomatic returns false; oracle 0x694D:={0x00|0x80}, 0x600A:=0x16, SP+4, pc->grandparent`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: inverted-flip, dropped-sprite-write, dropped-board-advance and no-unwind twins are CAUGHT", () => {
  // carry SET so the correct flip byte is 0x00 (the inverted twin then writes 0x80).
  const entry = craftEntry({ carry: true, substate: 0x0c });

  const inverted = contractDiffs(entry, brokenInvertedFlip);
  const dropWrite = contractDiffs(entry, brokenDropSpriteWrite);
  const dropAdvance = contractDiffs(entry, brokenDropAdvance);
  assert.ok(inverted.length > 0, "the inverted-flip twin escaped — the gate is worthless");
  assert.ok(dropWrite.length > 0, "the dropped-sprite-write twin escaped — the gate is worthless");
  assert.ok(dropAdvance.length > 0, "the dropped-board-advance twin escaped — the gate is worthless");
  // Confirm the twins are caught where expected.
  assert.ok(inverted[0].startsWith(`RAM@${hx(SPRITE_FLAG)}`), `inverted-flip should diverge at 0x694D, got ${inverted[0]}`);
  assert.ok(dropWrite[0].startsWith(`RAM@${hx(SPRITE_FLAG)}`), `dropped-sprite-write should diverge at 0x694D, got ${dropWrite[0]}`);
  assert.ok(dropAdvance[0].startsWith(`RAM@${hx(GAME_SUBSTATE)}`), `dropped-board-advance should diverge at GAME_SUBSTATE, got ${dropAdvance[0]}`);

  // (d) no-unwind: RAM+pc+SP are identical (the harness models the unwind either way), so
  // ONLY the boolean signal catches it.
  const goodRet = runCandidate(entry, loc_1e6d).ret;
  const badRet = runCandidate(entry, brokenNoUnwind).ret;
  assert.equal(goodRet, false, "the real routine must signal unwind (false)");
  assert.notEqual(badRet, false, "the no-unwind twin escaped the boolean check — the signal is not tested");

  console.log(
    `  TEETH: inverted-flip (${inverted[0]}), dropped-sprite-write (${dropWrite[0]}), ` +
      `dropped-board-advance (${dropAdvance[0]}), no-unwind (ret ${badRet} != false) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1E6D dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_1e6d);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x1E6D dispatches in 8000 attract frames — attract never completes a board / rescues; crafted entries are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1E6D dispatch(es) — RAM+pc+SP identical to the oracle`);
  }
});
