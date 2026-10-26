// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_138f (ROM 0x138F) — the timed in-game sub-state transition
 * that branches on player 2's saved context.
 *
 * loc_138f WRITES memory (SUBSTATE_TIMER 0x6009 and, on the expiry frame, GAME_SUBSTATE
 * 0x600A) and is NOT a leaf (it runs the `rst 0x18` gate, tickSubstateTimer), so it is
 * gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Its entire
 * logic is (a) the timer gate — only the frame SUBSTATE_TIMER decrements to 0 does the
 * rest run — and (b) a single non-zero test of P2_CONTEXT (0x6048) that picks the next
 * sub-state (0x17 if live, 0x14 if dead).
 *
 * A 6000-frame attract run dispatches 0x138f ZERO times (its sub-state is reached only in
 * a credited game's death/game-over path, GAME_STATE 3), so — exactly as docs/decompiler-pipeline
 * prescribes for arms attract never reaches — the gate is CRAFTED: a real booted attract
 * machine, cloned, with the three input bytes surgically poked, then oracle-vs-idiomatic
 * on independent fresh clones. Because the logic inputs are small, the crafted sweeps are
 * EXHAUSTIVE, which is stronger than any single captured dispatch:
 *
 *   1. STRUCTURE — on a crafted expiry entry, confirm the oracle's push target lands
 *      inside STACK_SCRATCH (so excluding stack cannot mask a real diff) and that the
 *      idiomatic side models neither SP nor pc, then confirm game-visible RAM is identical.
 *
 *   2. TIMER (exhaustive) — sweep SUBSTATE_TIMER 0..255 at a LIVE and a DEAD P2 context.
 *      Pins the gate: only value 1 expires (re-arm 0x6009 -> 1 AND write 0x600A); every
 *      other value just decrements 0x6009 and leaves 0x600A untouched. Both arms asserted.
 *
 *   3. P2_CONTEXT (exhaustive) — at the expiry value (timer 1) sweep P2_CONTEXT 0..255.
 *      Pins the non-zero -> 0x17 / zero -> 0x14 branch over every possible context byte;
 *      both target sub-states asserted present.
 *
 *   4. TEETH — two twins the sweeps MUST catch: (a) an inverted branch (0x14/0x17 swapped)
 *      caught by the P2 sweep, naming 0x600A; (b) a dropped timer re-arm caught by the
 *      TIMER sweep at expiry, naming 0x6009.
 *
 *   5. REALISM — hook 0x138f over a long attract run; replay any real dispatch if one
 *      occurs, else record that attract never reaches this sub-state (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-138f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_138f as oracle } from "../../translated/loc_138f.js";
import { loc_138f as idiomatic } from "../loc_138f.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, GAME_SUBSTATE, P2_CONTEXT } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x138f;
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH, headroom both sides for the oracle push/pop
const SUB_SENTINEL = 0x99; // a GAME_SUBSTATE value that is neither 0x14 nor 0x17, so any
                           //   wrongful write to it on a non-expiry frame is visible
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). This is the "real state + surgical nudge" the
// crafted-entry method wants — the base is genuine work RAM, only the three inputs move.
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

/** Two independent fresh clones of the base with identical input pokes (docs/decompiler-pipeline fresh
 *  clone per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(timer, p2, sub = SUB_SENTINEL) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(SUBSTATE_TIMER, timer);
    m.mem.write8(P2_CONTEXT, p2);
    m.mem.write8(GAME_SUBSTATE, sub);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: crafted expiry entry — game-visible RAM identical, SP/pc unmodelled by idiomatic", () => {
  const [a, b] = craftPair(1, 0x03); // timer 1 = expire; P2 live -> 0x17
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  assert.equal(a.mem.read8(GAME_SUBSTATE), 0x17, "oracle must advance GAME_SUBSTATE to 0x17 for a live P2");
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 1, "oracle must re-arm SUBSTATE_TIMER to 1 on expiry");

  // The oracle's push16 writes [SP-2, SP-1]; both must sit in STACK_SCRATCH, so excluding
  // the stack region in the diff cannot hide a real difference.
  assert.ok((SP_CRAFT - 2) >= STACK_SCRATCH.lo && SP_CRAFT <= STACK_SCRATCH.hi,
    `oracle push target must sit inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // idiomatic must model neither the stack nor the return: SP and pc unchanged from entry.
  const c = base().clone();
  c.mem.write8(SUBSTATE_TIMER, 1); c.mem.write8(P2_CONTEXT, 0x03); c.regs.sp = SP_CRAFT;
  const sp0 = c.regs.sp, pc0 = c.pc;
  idiomatic(c);
  assert.equal(c.regs.sp, sp0, "loc_138f must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "loc_138f must leave pc unchanged (no ret modelling)");
  console.log("  STRUCTURE: expiry entry game-visible-identical; idiomatic touches no SP/pc; push target in stack scratch");
});

// -- 2. TIMER (exhaustive) ----------------------------------------------------

test("TIMER (exhaustive): loc_138f == oracle over all 256 SUBSTATE_TIMER values (both P2 arms)", () => {
  for (const [label, p2] of [["P2-live", 0x03], ["P2-dead", 0x00]]) {
    let count = 0, expired = 0, counting = 0, mismatch = null;
    for (let t = 0; t < 256 && !mismatch; t++) {
      const [a, b] = craftPair(t, p2);
      const aFloor = a.regs.sp;
      oracle(a);
      idiomatic(b);
      const { bad } = ramDiffMinusStack(a, b, aFloor);
      count++;
      // Classify the arm from the oracle: expiry re-arms 0x6009 to 1 AND writes 0x600A.
      if (a.mem.read8(GAME_SUBSTATE) !== SUB_SENTINEL) expired++; else counting++;
      if (bad) mismatch = { t, bad };
    }
    assert.equal(mismatch, null,
      mismatch && `[${label}] mismatch at SUBSTATE_TIMER=${hx(mismatch.t)}: RAM diff at ` +
        `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
    assert.equal(count, 256, `[${label}] must have swept all 256 timer values`);
    assert.equal(expired, 1, `[${label}] exactly one value (1) must expire`);
    assert.equal(counting, 255, `[${label}] the other 255 values must merely count down`);
    console.log(`  TIMER/exhaustive [${label}]: 256 values — game-visible RAM identical (1 expiry, 255 counting)`);
  }
});

// -- 3. P2_CONTEXT (exhaustive) -----------------------------------------------

test("P2_CONTEXT (exhaustive): at expiry, loc_138f == oracle over all 256 context bytes (both target sub-states)", () => {
  let count = 0, live = 0, dead = 0, mismatch = null;
  for (let p2 = 0; p2 < 256 && !mismatch; p2++) {
    const [a, b] = craftPair(1, p2); // timer 1 forces the expiry / branch path
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    const sub = a.mem.read8(GAME_SUBSTATE);
    if (sub === 0x17) live++; else if (sub === 0x14) dead++;
    if (bad) mismatch = { p2, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at P2_CONTEXT=${hx(mismatch.p2)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 P2_CONTEXT values");
  assert.equal(dead, 1, "only P2_CONTEXT==0 takes the 0x14 (dead) arm");
  assert.equal(live, 255, "every non-zero P2_CONTEXT takes the 0x17 (live) arm");
  console.log(`  P2_CONTEXT/exhaustive: 256 values — game-visible RAM identical (live 0x17 x${live}, dead 0x14 x${dead})`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): inverts the branch — 0x14 when live, 0x17 when dead. Timer gate + re-arm are
 *  faithful, so the ONLY divergence is the GAME_SUBSTATE value on the expiry frame. */
function brokenInvertBranch(m) {
  const { mem } = m;
  const remaining = (mem.read8(SUBSTATE_TIMER) - 1) & 0xff;
  mem.write8(SUBSTATE_TIMER, remaining);
  if (remaining !== 0) return;
  mem.write8(SUBSTATE_TIMER, (mem.read8(SUBSTATE_TIMER) + 1) & 0xff);
  mem.write8(GAME_SUBSTATE, mem.read8(P2_CONTEXT) !== 0 ? 0x14 : 0x17); // BUG: swapped
}

/** Twin (b): drops the timer re-arm (`inc (hl)`). Branch is faithful, so on the expiry
 *  frame it leaves SUBSTATE_TIMER at 0 where the oracle re-arms it to 1. */
function brokenNoRearm(m) {
  const { mem } = m;
  const remaining = (mem.read8(SUBSTATE_TIMER) - 1) & 0xff;
  mem.write8(SUBSTATE_TIMER, remaining);
  if (remaining !== 0) return;
  // BUG: no re-arm here
  mem.write8(GAME_SUBSTATE, mem.read8(P2_CONTEXT) !== 0 ? 0x17 : 0x14);
}

test("TEETH (invert-branch): the swapped-branch twin is CAUGHT by the P2 sweep and names 0x600A", () => {
  let caught = null;
  for (let p2 = 0; p2 < 256 && !caught; p2++) {
    const [a, b] = craftPair(1, p2);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenInvertBranch(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { p2, bad };
  }
  assert.notEqual(caught, null, "the P2 sweep FAILED to catch an inverted branch — it is worthless");
  assert.equal(caught.bad.addr, GAME_SUBSTATE, `expected the caught diff at 0x600A, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/invert-branch: caught at P2_CONTEXT=${hx(caught.p2)} (0x600A oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

test("TEETH (drop-re-arm): the no-re-arm twin is CAUGHT by the TIMER sweep and names 0x6009", () => {
  let caught = null;
  for (let t = 0; t < 256 && !caught; t++) {
    const [a, b] = craftPair(t, 0x03);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenNoRearm(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { t, bad };
  }
  assert.notEqual(caught, null, "the TIMER sweep FAILED to catch a dropped re-arm — it is worthless");
  assert.equal(caught.bad.addr, SUBSTATE_TIMER, `expected the caught diff at 0x6009, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/drop-re-arm: caught at SUBSTATE_TIMER=${hx(caught.t)} (0x6009 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x138f dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x138f dispatches in 6000 attract frames — sub-state reached only in a credited game; crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x138f dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
