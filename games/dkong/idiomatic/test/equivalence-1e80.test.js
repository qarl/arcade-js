// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for completeRivetBoardWhenCleared (ROM 0x1e80) — the rivet-board arm
 * of Mario's per-frame position check (sub_1e57). It reads RIVETS_LEFT (0x6290): while
 * any rivets remain it returns "keep going" (a normal single-level return); the frame
 * the count reaches zero it tails into enterBoardAdvanceAndUnwind (0x1e85), which writes
 * GAME_SUBSTATE (0x600A) := 0x16 and UNWINDS two levels out of the movement cascade.
 * In direct-call form both non-local exits are a boolean — the routine returns true on
 * the normal path and false (the unwind / caller-skip signal) on the won path.
 *
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the
 * boolean signal, compared directly against the oracle's own boolean return.
 *
 * The two paths leave DIFFERENT Z80 stack effects: the normal path is one `ret` (pops
 * the own return, one level up), the won path is `pop hl` + `ret` (discards the own
 * return, then returns to the grandparent — two levels up). The SAME staged stack serves
 * both: the own return sits on top, the grandparent return just below, both inside
 * STACK_SCRATCH (excluded from the RAM diff by contract). The idiomatic routine models
 * no stack — control flow is the JS call stack — so runCandidate replays the net stack
 * effect the oracle's control-flow outcome implies, keyed on the boolean it returned:
 * true -> one `ret`; false -> one discarded pop + one `ret`.
 *
 * A long attract run dispatches 0x1e80 ZERO times: sub_1e57 only jumps here when BOARD
 * (0x6227) is the rivet board, and attract only ever plays the girder board (25m). So —
 * exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the
 * gate is CRAFTED: a real booted attract machine, cloned, with a controlled return stack
 * and RIVETS_LEFT / GAME_SUBSTATE poked, then oracle-vs-idiomatic on independent fresh
 * clones. The only input is the one byte RIVETS_LEFT, so the sweep over all 256 values
 * is EXHAUSTIVE.
 *
 *   1. EQUAL (exhaustive/crafted) — all 256 RIVETS_LEFT values; RAM + pc + SP identical,
 *      and the idiomatic boolean equals the oracle's. Non-vacuity is asserted at both
 *      poles: on the won value (0) the oracle writes 0x600A := 0x16, unwinds SP by 4, and
 *      returns to the grandparent (false); on a non-zero value it writes nothing, rets one
 *      level (false-SP), and returns true — so the stack exclusion and the boolean are
 *      both load-bearing.
 *
 *   2. TEETH — five deliberately-broken twins, each MUST be caught:
 *      (a) dropped-write — never writes GAME_SUBSTATE on the won path; caught at 0x600A.
 *      (b) wrong-substate — writes 0x17 instead of 0x16; caught at 0x600A.
 *      (c) stray-pop — pops an extra stack word it must not; caught by the SP diff.
 *      (d) inverted-test — treats a non-zero rivet count as "won"; caught by RAM/pc/SP
 *          and the boolean all at once.
 *      (e) no-unwind — returns true on the won path instead of false; the boolean forces
 *          the wrong (single-ret) stack model, caught by pc + SP and the boolean.
 *
 *   3. REALISM — hook 0x1e80 over a long attract run; replay any real dispatch, else
 *      record that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e80.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e80 as oracle } from "../../translated/loc_1e80.js";
import { completeRivetBoardWhenCleared } from "../completeRivetBoardWhenCleared.js";
import { enterBoardAdvanceAndUnwind } from "../enterBoardAdvanceAndUnwind.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, RIVETS_LEFT, GAME_SUBSTATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e80;
const BOARD_ADVANCE_SUBSTATE = 0x16;
const NON_ADVANCE_SENTINEL = 0x0c; // any GAME_SUBSTATE != 0x16 so the won-path write is observable
const GRAND_RET = 0x1234; // the grandparent return the won-path unwind lands on
const OWN_RET = 0x1e84;   // the "own" return: the normal path rets here, the won path discards it
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const ENTRY_SP = SP_TOP - 4;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region excluded by contract — the staged/popped returns live there). */
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

/** Run the ORACLE on a fresh clone. On the normal path it does one `ret` (SP += 2); on
 *  the won path it tails into loc_1e85's `pop hl` + `ret` (SP += 4). Returns {c, ret}. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then replay the net Z80 stack effect its control-
 *  flow outcome implies so pc + SP line up with the oracle (the idiomatic routine uses
 *  the JS call stack and never touches pc/SP itself):
 *    true  (normal) -> one `ret`                     — pops the own return (one level up)
 *    false (unwind) -> one discarded pop + one `ret` — models loc_1e85's `pop hl` + `ret`
 *  Returns {c, ret}. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  if (ret === true) {
    c.ret();
  } else {
    c.pop16(); // discard the own return (models the oracle's `pop hl`)
    c.ret();   // net return to the grandparent (models the oracle's `ret`)
  }
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and the
 *  boolean caller-skip signal. */
function contractDiffs(entry, fn) {
  const { c: o, ret: oret } = runOracle(entry);
  const { c, ret } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hx(ram.a & 0xff)} cand=${hx(ram.b & 0xff)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (oret !== ret) diffs.push(`ret oracle=${oret} cand=${ret}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated).
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
 *  grandparent return staged in STACK_SCRATCH), RIVETS_LEFT and a GAME_SUBSTATE sentinel. */
function craftEntry(rivets, substate = NON_ADVANCE_SENTINEL) {
  const e = base().clone();
  e.regs.sp = SP_TOP;
  e.push16(GRAND_RET); // -> 0x6bfa (the won-path unwind target, two levels up)
  e.push16(OWN_RET);   // -> 0x6bf8 (the normal-path return / the won-path discard)
  e.mem.write8(RIVETS_LEFT, rivets);
  e.mem.write8(GAME_SUBSTATE, substate);
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** (a) dropped-write — won path returns false but never writes GAME_SUBSTATE. */
function brokenDropWrite(m) {
  if (m.mem.read8(RIVETS_LEFT) !== 0) return true;
  return false;
}

/** (b) wrong-substate — writes 0x17 instead of 0x16 on the won path. */
function brokenWrongSubstate(m) {
  if (m.mem.read8(RIVETS_LEFT) !== 0) return true;
  m.mem.write8(GAME_SUBSTATE, 0x17);
  return false;
}

/** (c) stray-pop — correct write + boolean but pops an extra stack word it must not; the
 *  harness then adds its pop+ret on top, so SP ends 2 short of the oracle. */
function brokenStrayPop(m) {
  if (m.mem.read8(RIVETS_LEFT) !== 0) return true;
  m.mem.write8(GAME_SUBSTATE, BOARD_ADVANCE_SUBSTATE);
  m.pop16();
  return false;
}

/** (d) inverted-test — treats a non-zero rivet count as "won" and vice-versa. */
function brokenInvertedTest(m) {
  if (m.mem.read8(RIVETS_LEFT) === 0) return true;
  return enterBoardAdvanceAndUnwind(m);
}

/** (e) no-unwind — won path writes the right byte but signals "continue" (true). */
function brokenNoUnwind(m) {
  if (m.mem.read8(RIVETS_LEFT) !== 0) return true;
  m.mem.write8(GAME_SUBSTATE, BOARD_ADVANCE_SUBSTATE);
  return true;
}

// -- 1. EQUAL (exhaustive / crafted) ------------------------------------------

test("EQUAL (exhaustive): completeRivetBoardWhenCleared == oracle on all 256 RIVETS_LEFT values (RAM+pc+SP+bool)", () => {
  for (let rivets = 0; rivets < 256; rivets++) {
    const entry = craftEntry(rivets);
    const diffs = contractDiffs(entry, completeRivetBoardWhenCleared);
    assert.equal(diffs.length, 0, `rivets=${hx(rivets)}: ${diffs.join("; ")}`);
  }

  // Non-vacuity at the won pole (rivets == 0): the board is completed and the cascade
  // unwinds two levels.
  const won = craftEntry(0);
  const { c: wonO, ret: wonRet } = runOracle(won);
  assert.equal(wonO.mem.read8(GAME_SUBSTATE), BOARD_ADVANCE_SUBSTATE, "won: oracle must set GAME_SUBSTATE := 0x16");
  assert.equal(wonO.regs.sp, SP_TOP, "won: oracle must unwind SP by 4 (pop hl + ret)");
  assert.equal(wonO.pc, GRAND_RET, "won: oracle must return to the staged grandparent (two levels up)");
  assert.equal(wonRet, false, "won: the caller-skip signal must be false (abort the cascade)");
  assert.equal(
    runCandidate(won, completeRivetBoardWhenCleared).ret,
    false,
    "won: idiomatic must return false (the unwind signal)",
  );

  // Non-vacuity on the normal pole (rivets != 0): nothing written, single-level return.
  const normal = craftEntry(5);
  const { c: normO, ret: normRet } = runOracle(normal);
  assert.equal(normO.mem.read8(GAME_SUBSTATE), NON_ADVANCE_SENTINEL, "normal: oracle must NOT touch GAME_SUBSTATE");
  assert.equal(normO.regs.sp, ENTRY_SP + 2, "normal: oracle must ret one level (SP += 2)");
  assert.equal(normO.pc, OWN_RET, "normal: oracle must return to the own return (one level up)");
  assert.equal(normRet, true, "normal: the caller-skip signal must be true (proceed)");

  assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");
  console.log(
    "  EQUAL/exhaustive: 256 RIVETS_LEFT values identical on RAM+pc+SP+bool; " +
      "won -> 0x600A:=0x16, SP+4, pc->grandparent, false; normal -> no write, SP+2, pc->own, true",
  );
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: dropped-write, wrong-substate, stray-pop, inverted-test and no-unwind twins are CAUGHT", () => {
  const won = craftEntry(0);        // won path — the write/unwind are observable
  const normal = craftEntry(5);     // normal path — the inverted-test wrongly "wins" here

  const dropWrite = contractDiffs(won, brokenDropWrite);
  const wrongSub = contractDiffs(won, brokenWrongSubstate);
  const strayPop = contractDiffs(won, brokenStrayPop);
  const inverted = contractDiffs(normal, brokenInvertedTest);
  const noUnwind = contractDiffs(won, brokenNoUnwind);

  assert.ok(dropWrite.length > 0, "the dropped-write twin escaped — the gate is worthless");
  assert.ok(wrongSub.length > 0, "the wrong-substate twin escaped — the gate is worthless");
  assert.ok(strayPop.length > 0, "the stray-pop twin escaped — the gate is worthless");
  assert.ok(inverted.length > 0, "the inverted-test twin escaped — the gate is worthless");
  assert.ok(noUnwind.length > 0, "the no-unwind twin escaped — the gate is worthless");

  // Confirm the twins are caught where expected.
  assert.ok(dropWrite[0].startsWith(`RAM@${hx(GAME_SUBSTATE)}`), `dropped-write should diverge at GAME_SUBSTATE, got ${dropWrite[0]}`);
  assert.ok(wrongSub[0].startsWith(`RAM@${hx(GAME_SUBSTATE)}`), `wrong-substate should diverge at GAME_SUBSTATE, got ${wrongSub[0]}`);
  assert.ok(strayPop.some((d) => d.startsWith("SP ")), `stray-pop should diverge on SP, got ${strayPop.join("; ")}`);
  assert.ok(inverted.some((d) => d.startsWith("ret ")), `inverted-test should diverge on the boolean, got ${inverted.join("; ")}`);
  assert.ok(noUnwind.some((d) => d.startsWith("ret ")), `no-unwind should diverge on the boolean, got ${noUnwind.join("; ")}`);
  assert.ok(noUnwind.some((d) => d.startsWith("SP ")), `no-unwind should also diverge on SP (wrong stack model), got ${noUnwind.join("; ")}`);

  console.log(
    `  TEETH: dropped-write (${dropWrite[0]}), wrong-substate (${wrongSub[0]}), ` +
      `stray-pop (${strayPop.find((d) => d.startsWith("SP "))}), ` +
      `inverted-test (${inverted.find((d) => d.startsWith("ret "))}), ` +
      `no-unwind (${noUnwind.find((d) => d.startsWith("ret "))}) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1e80 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    const diffs = contractDiffs(entry, completeRivetBoardWhenCleared);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x1e80 dispatches in 8000 attract frames — attract only plays the girder board; crafted entries are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1e80 dispatch(es) — RAM+pc+SP+bool identical to the oracle`);
  }
});
