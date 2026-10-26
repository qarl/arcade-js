// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for spawnTwinActor (ROM 0x3984) — the pending-spawn init of a
 * two-body actor (figure + twin).
 *
 * spawnTwinActor stamps an eight-cell tile block into video+colour RAM, seeds a primary
 * actor record and its mirrored twin, then hands off to stageActorSpriteRecords
 * (ROM 0x3a4c) to stage both records into the sprite buffer. Its contract is
 * OBSERVABLE MEMORY: the tile+colour block, the two seeded records, and the two
 * staged sprite records the hand-off writes.
 *
 * THE DISSOLVE. The idiomatic routine used to end with `return m.call(0x3a4c)`,
 * invoking the still-translated copier through the registry so its `ret` returned
 * to our caller. That stale boundary is gone: it now imports and directly calls the
 * already-decompiled stageActorSpriteRecords(m). The removed boundary was a TAIL
 * JUMP (`jp 0x3a4c`), which — unlike a `call` — pushes NOTHING onto the stack, so
 * there is no dead stack scratch to reconcile (STACK_SCRATCH = 0 below). The ONLY
 * ABI divergence the dissolve introduces is pc/SP: the oracle path still runs the
 * copier's internal `ret` (and, on the not-pending early-return, its own `ret z`),
 * while the stack-free idiomatic routine models both as a plain JS return. Each
 * oracle path performs exactly ONE `ret`, so — as in equivalence-4c5f.test.js after
 * the sound-stub dissolve — the gate runs one m.ret() on the candidate to line pc +
 * SP up with the oracle, then compares RAM (outside the empty stack window) + pc +
 * SP. Value registers are dead ABI and excluded.
 *
 * Inputs are CAPTURED, not constructed: the routine is hooked in a real attract run
 * and the machine is cloned at every true dispatch. In a 4000-frame run it is entered
 * ~173 times — most with no pending spawn (early-return) and two with a pending
 * request that run the full spawn body. Both classes are replayed.
 *
 *   1. EQUAL — for every captured dispatch, run oracle vs spawnTwinActor on independent
 *      clones of the same entry state and diff RAM + pc + SP; all must be identical.
 *      Asserts at least one body-run capture is present, so the spawn body (and the
 *      dissolved hand-off) is actually exercised.
 *   2. TEETH (wrong timer seed) — a twin that seeds the actor timer one off, but ONLY
 *      on the body-run dispatches, MUST be caught at the timer byte. Because it
 *      diverges only when the body runs, catching it also proves a real body-run
 *      state was captured (an all-early-return set would let it pass).
 *   3. TEETH (mis-staged hand-off) — a twin whose staged sprite record is off by one
 *      (as a mis-wired or wrong-argument callee would produce), only on body-run,
 *      MUST be caught at the sprite slot. This is the dissolve-specific tooth: it
 *      proves the gate still watches the copier's staged output, so a broken direct
 *      call cannot slip through.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-3984.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3984 as oracle } from "../../translated/loc_3984.js";
import { spawnTwinActor as idiomatic } from "../spawnTwinActor.js";
import { makeMachineFactory } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x3984;
const REQUEST = 0x810d; // the pending-spawn request byte read at entry
const TIMER = 0x8112; // primary actor countdown timer (a body-only write)
const SPRITE_SLOT = 0x8238; // first staged sprite byte, written by the copier hand-off
const FRAMES = 4000;

// The removed boundary was a TAIL JUMP (jp 0x3a4c): it pushes nothing, so no dead
// stack scratch is parked below SP and the whole stack region compares byte-for-byte.
// (Contrast equivalence-4c5f.test.js, whose dissolved call left 4 pushed bytes.)
const STACK_SCRATCH = 0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- capture every real dispatch of 0x3984 from a live attract run -----------
// The hook clones the pristine machine at each entry (before the oracle runs), then
// delegates to the oracle so the host game continues undisturbed.
const captures = [];
if (ROM_PRESENT) {
  const makeMachine = await makeMachineFactory(ROM);
  const hook = new Map([[TARGET, (mm) => {
    captures.push({ entry: mm.clone(), pending: mm.mem.read8(REQUEST) !== 0 });
    return oracle(mm);
  }]]);
  makeMachine(hook).runFrames(FRAMES);
}

const bodyRuns = () => captures.filter((c) => c.pending).length;

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * window [entrySP - STACK_SCRATCH, entrySP). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Compare a candidate against the oracle over the observable-equivalence contract for one captured entry: RAM
 *  (outside the stack scratch) + pc + SP, after one m.ret() on the candidate to line pc + SP up (header).
 *  Returns { diffs, ram } (empty == EQUAL). */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

test("EQUAL: spawnTwinActor == oracle (RAM + pc + SP) on every captured attract dispatch", () => {
  assert.ok(captures.length > 0, `0x3984 was never dispatched in ${FRAMES} attract frames`);
  assert.ok(
    bodyRuns() > 0,
    "no captured dispatch ran the spawn body (all early-returns) — the body + hand-off are untested",
  );

  let firstDiff = null;
  for (let i = 0; i < captures.length && !firstDiff; i++) {
    const { diffs } = contractDiffs(captures[i].entry, idiomatic);
    if (diffs.length) firstDiff = { i, pending: captures[i].pending, diffs };
  }

  assert.equal(
    firstDiff,
    null,
    firstDiff &&
      `contract diff on capture #${firstDiff.i} (pending=${firstDiff.pending}): ${firstDiff.diffs.join("; ")}`,
  );
  console.log(
    `  EQUAL: ${captures.length} captured dispatches identical over RAM+pc+SP ` +
      `(${bodyRuns()} ran the spawn body + hand-off, ${captures.length - bodyRuns()} early-returned)`,
  );
});

/** Broken twin: the stack-free idiomatic routine, then the actor timer bumped by one —
 *  but only when a spawn was actually pending, so it diverges ONLY on a body-run. */
function twinWrongTimer(m) {
  const pending = m.mem.read8(REQUEST) !== 0;
  idiomatic(m);
  if (pending) m.mem.write8(TIMER, m.mem.read8(TIMER) + 1); // BUG: wrong seeded timer
}

test("TEETH (wrong timer seed): a body-only wrong timer seed is CAUGHT at the timer byte", () => {
  assert.ok(bodyRuns() > 0, "cannot exercise teeth: no body-run capture was recorded");

  let caught = null;
  for (let i = 0; i < captures.length && !caught; i++) {
    const { ram } = contractDiffs(captures[i].entry, twinWrongTimer);
    if (ram) caught = { i, pending: captures[i].pending, ram };
  }

  assert.notEqual(caught, null, "the gate FAILED to catch a wrong timer seed — it is worthless");
  assert.equal(caught.pending, true, "the teeth should bite only on a body-run dispatch");
  assert.equal(
    caught.ram.addr,
    TIMER,
    `teeth caught the wrong address ${hx(caught.ram.addr ?? 0)} (expected ${hx(TIMER)})`,
  );
  console.log(
    `  TEETH/timer: wrong timer seed caught on capture #${caught.i} at ${hx(caught.ram.addr)} ` +
      `(oracle=${caught.ram.a} broken=${caught.ram.b})`,
  );
});

/** Broken twin: the stack-free idiomatic routine, then the first staged sprite byte
 *  bumped by one — the output a mis-wired or wrong-argument copier would produce.
 *  Only diverges on a body-run (the early-return never stages). */
function twinMisstaged(m) {
  const pending = m.mem.read8(REQUEST) !== 0;
  idiomatic(m);
  if (pending) m.mem.write8(SPRITE_SLOT, m.mem.read8(SPRITE_SLOT) + 1); // BUG: wrong staged record
}

test("TEETH (mis-staged hand-off): a body-only wrong staged sprite record is CAUGHT at the sprite slot", () => {
  assert.ok(bodyRuns() > 0, "cannot exercise teeth: no body-run capture was recorded");

  let caught = null;
  for (let i = 0; i < captures.length && !caught; i++) {
    const { ram } = contractDiffs(captures[i].entry, twinMisstaged);
    if (ram) caught = { i, pending: captures[i].pending, ram };
  }

  assert.notEqual(caught, null, "the gate FAILED to catch a mis-staged hand-off — the dissolved call is unguarded");
  assert.equal(caught.pending, true, "the teeth should bite only on a body-run dispatch");
  assert.equal(
    caught.ram.addr,
    SPRITE_SLOT,
    `teeth caught the wrong address ${hx(caught.ram.addr ?? 0)} (expected ${hx(SPRITE_SLOT)})`,
  );
  console.log(
    `  TEETH/staging: mis-staged sprite record caught on capture #${caught.i} at ${hx(caught.ram.addr)} ` +
      `(oracle=${caught.ram.a} broken=${caught.ram.b})`,
  );
});
