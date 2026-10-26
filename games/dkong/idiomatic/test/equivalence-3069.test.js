// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceSequenceStepWhenTimerExpires (ROM 0x3069) — the timed INDIRECT step-advance that
 * bumps the byte SEQ_ADVANCE_PTR points at once the sub-state timer expires.
 *
 * advanceSequenceStepWhenTimerExpires's entire observable behaviour is a function of just two inputs: the gate byte
 * SUBSTATE_TIMER (0x6009), ticked down through the rst-0x18 helper, and the byte at
 * *(SEQ_ADVANCE_PTR) — the word stored at 0x63C0 names the target address, and the body
 * increments the byte THERE (never 0x63C0 itself) only on the frame the counter reaches
 * zero. It returns a constant true on both paths (it cannot skip its own caller), so
 * nothing downstream consumes a return and the contract is memory. Everything else the
 * oracle touches — the rst's pushed 0x306A return byte, SP/PC, HL/A/F — is the Z80
 * caller-skip mechanism the direct-call model replaces; with SP parked deep in work RAM
 * those pushes land in STACK_SCRATCH, which the contract excludes. That leaves the
 * strongest gate available:
 *
 *   1. EQUAL (exhaustive) — advanceSequenceStepWhenTimerExpires == oracle over ALL 256×256 combos of
 *      (SUBSTATE_TIMER, target byte) with the pointer aimed at a real step cell, compared
 *      on RAM (minus the stack scratch below the entry SP). 65,536 is the complete input space for that pointer —
 *      a proof of the gate polarity and the inc-with-wrap, not a sample.
 *
 *   2. INDIRECTION (crafted) — force expiry and sweep the pointer over several distinct
 *      work-RAM targets; advanceSequenceStepWhenTimerExpires == oracle each time, the increment lands at *(0x63C0),
 *      and 0x63C0/0x63C1 are left untouched — pinning the `ld hl,(nn)` indirect load.
 *
 *   3. TEETH (exhaustive) — three deliberately-broken twins the sweep MUST catch:
 *        (a) inverted polarity — increments while the counter is still counting and skips
 *            on expiry; caught at the target byte (gate==1 vs gate!=1 disagree).
 *        (b) direct-not-indirect — increments 0x63C0 itself instead of the byte it points
 *            at; caught at 0x63C0 (the twin touches the pointer cell the oracle leaves alone).
 *        (c) double-increment — adds 2 instead of 1; caught at the target byte on expiry.
 *
 *   4. REALISM (VACUOUS in attract, and it says so) — an attract run produces ZERO natural
 *      0x3069 dispatches, so this check asserts nothing about real entry states; the
 *      exhaustive sweep above is the whole proof. The capture is kept and any dispatch that
 *      DID appear would be verified, but none is required.
 *
 *      DO NOT read that zero as "dead code". 0x3069 is on a LIVE dispatch path in credited
 *      play — it is reached through a jump table off the substate dispatch, and fires tens of
 *      times per credited game, first during the opening cutscene and again in the
 *      board-advance state. That is the HOLE in this gate: real gameplay entry states are not
 *      captured or replayed here. The exhaustive sweep covers the routine's whole input space
 *      (the timer byte and the pointed-at byte), so the hole costs coverage of the
 *      surrounding machine state, not of the routine's own behaviour.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3069.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3069 as oracle } from "../../translated/loc_3069.js";
import { advanceSequenceStepWhenTimerExpires } from "../advanceSequenceStepWhenTimerExpires.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { SUBSTATE_TIMER, SEQ_ADVANCE_PTR, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3069;
// A real step cell the pointer aims at in the main sweep (INTRO_STEP 0x6385); far from the
// gate byte 0x6009 and the pointer cell 0x63C0, so nothing aliases.
const PTR_TARGET = 0x6385;
// The oracle's `rst 0x18` pushes 0x306A at SP-2 and its callee pops it back; point SP into
// work RAM so those stack reads stay valid (never I/O). The pushed bytes land in
// STACK_SCRATCH, which the contract excludes, so they never affect the compared state.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const setPtr = (m, addr) => {
  m.mem.write8(SEQ_ADVANCE_PTR, addr & 0xff); // little-endian, like `ld hl,(nn)`
  m.mem.write8(SEQ_ADVANCE_PTR + 1, (addr >> 8) & 0xff);
};

/** First differing RAM byte between two machines, EXCLUDING the stack scratch below the entry SP, or null. */
function ramDiffNoStack(mA, mB, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = mA.dumpState();
  const b = mB.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = mA.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { offset: i, addr, a: a[i], b: b[i] };
  }
  return null;
}

/**
 * Run the oracle and the candidate on two FRESH clones of `entry` (the routine WRITES
 * memory, so a clone per side) and diff RAM minus the stack scratch below the entry SP. advanceSequenceStepWhenTimerExpires returns a
 * constant true nothing consumes, so RAM is the whole contract.
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return ramDiffNoStack(a, b, entry.regs.sp);
}

/** A synthetic entry: the gate byte and target byte set, the pointer aimed at `ptr`, a safe stack. */
function makeEntry(base, timer, targetByte, ptr = PTR_TARGET) {
  const e = base.clone();
  e.mem.write8(SUBSTATE_TIMER, timer);
  setPtr(e, ptr);
  e.mem.write8(ptr, targetByte);
  e.regs.sp = SAFE_SP;
  return e;
}

// Sweep a candidate against the oracle over all 65,536 (timer, targetByte) combos with the pointer aimed at
// PTR_TARGET. Returns the first RAM mismatch (minus stack), or null, plus the count compared.
function sweep(base, candidate) {
  let count = 0;
  for (let timer = 0; timer < 256; timer++) {
    for (let tb = 0; tb < 256; tb++) {
      const ram = runPair(makeEntry(base, timer, tb), candidate);
      count++;
      if (ram) return { mismatch: { timer, tb, ram }, count };
    }
  }
  return { mismatch: null, count };
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): advanceSequenceStepWhenTimerExpires == oracle over all 65,536 (0x6009, target-byte) combos", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, advanceSequenceStepWhenTimerExpires);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `RAM diverges at 0x6009=${hx(mismatch.timer)} target=${hx(mismatch.tb)}: ` +
        `0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`,
  );
  assert.equal(count, 256 * 256, "must have compared all 65,536 (timer, target-byte) combos");

  // Non-vacuity: the routine really did the work on both sides.
  // Expiry (timer==1): 0x6009 -> 0 and the target byte -> tb+1.
  for (const tb of [0x00, 0x01, 0x7f, 0xff]) {
    const a = makeEntry(base, 1, tb); // oracle
    const b = makeEntry(base, 1, tb); // candidate
    oracle(a);
    advanceSequenceStepWhenTimerExpires(b);
    assert.equal(a.mem.read8(SUBSTATE_TIMER), 0, "oracle must tick 0x6009 to 0 on expiry");
    assert.equal(b.mem.read8(SUBSTATE_TIMER), 0, "advanceSequenceStepWhenTimerExpires must tick 0x6009 to 0 on expiry");
    assert.equal(a.mem.read8(PTR_TARGET), (tb + 1) & 0xff, `oracle must inc target (tb ${hx(tb)})`);
    assert.equal(b.mem.read8(PTR_TARGET), (tb + 1) & 0xff, `advanceSequenceStepWhenTimerExpires must inc target (tb ${hx(tb)})`);
  }
  // Not expired (timer==2): 0x6009 -> 1 and the target byte is left alone.
  {
    const a = makeEntry(base, 2, 0x33); // oracle
    const b = makeEntry(base, 2, 0x33); // candidate
    assert.equal(oracle(a), true, "oracle returns constant true (never skips its caller)");
    assert.equal(advanceSequenceStepWhenTimerExpires(b), true, "advanceSequenceStepWhenTimerExpires returns constant true (never skips its caller)");
    assert.equal(a.mem.read8(SUBSTATE_TIMER), 1, "oracle must decrement 0x6009 while counting");
    assert.equal(b.mem.read8(SUBSTATE_TIMER), 1, "advanceSequenceStepWhenTimerExpires must decrement 0x6009 while counting");
    assert.equal(a.mem.read8(PTR_TARGET), 0x33, "oracle must NOT inc target while counting");
    assert.equal(b.mem.read8(PTR_TARGET), 0x33, "advanceSequenceStepWhenTimerExpires must NOT inc target while counting");
  }
  console.log(`  EQUAL/exhaustive: ${count} (timer, target-byte) combos — RAM (minus stack) identical to the oracle`);
});

// -- 2. INDIRECTION (crafted pointer sweep) -----------------------------------

test("INDIRECTION: the increment follows *(0x63C0) and leaves 0x63C0 untouched", () => {
  const base = new Machine(ROM).clone();
  // Distinct work-RAM targets, all away from the gate byte and the pointer cell.
  const targets = [0x6385, 0x6388, 0x6100, 0x6410, 0x6a00];
  const TB = 0x40;
  for (const ptr of targets) {
    const entry = makeEntry(base, 1, TB, ptr); // timer==1 -> expiry, so the inc fires
    const ram = runPair(entry, advanceSequenceStepWhenTimerExpires);
    assert.equal(
      ram,
      null,
      ram && `RAM diverges with pointer ${hx(ptr >> 8)}${hx(ptr)} at 0x${(ram.addr ?? 0).toString(16)}`,
    );
    // Prove the follow explicitly on the candidate.
    const b = entry.clone();
    advanceSequenceStepWhenTimerExpires(b);
    assert.equal(b.mem.read8(ptr), (TB + 1) & 0xff, `must inc the byte AT *(0x63C0)=0x${ptr.toString(16)}`);
    assert.equal(b.mem.read8(SEQ_ADVANCE_PTR), ptr & 0xff, "0x63C0 (pointer lo) must be untouched");
    assert.equal(b.mem.read8(SEQ_ADVANCE_PTR + 1), (ptr >> 8) & 0xff, "0x63C1 (pointer hi) must be untouched");
  }
  console.log(`  INDIRECTION: ${targets.length} pointer targets — inc follows *(0x63C0), pointer cell untouched`);
});

// -- 3. TEETH (exhaustive) ----------------------------------------------------

/** BUG (a): inverted polarity — increments while still counting, skips on expiry. Caught
 *  at the target byte (the gate==1 and gate!=1 cases disagree with the oracle). */
function brokenInvertedPolarity(m) {
  const { mem } = m;
  if (tickSubstateTimer(m)) return true; // BUG: skip on EXPIRY instead of continue
  const t = mem.read16(SEQ_ADVANCE_PTR);
  mem.write8(t, (mem.read8(t) + 1) & 0xff);
  return true;
}

/** BUG (b): direct-not-indirect — increments 0x63C0 itself instead of the byte it points
 *  at. Caught at 0x63C0 (the twin mutates the pointer cell the oracle leaves alone). */
function brokenDirectNotIndirect(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return true;
  mem.write8(SEQ_ADVANCE_PTR, (mem.read8(SEQ_ADVANCE_PTR) + 1) & 0xff); // BUG: incs the pointer cell
  return true;
}

/** BUG (c): double-increment — adds 2 instead of 1. Caught at the target byte on expiry. */
function brokenDoubleIncrement(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return true;
  const t = mem.read16(SEQ_ADVANCE_PTR);
  mem.write8(t, (mem.read8(t) + 2) & 0xff); // BUG: +2, not +1
  return true;
}

test("TEETH (exhaustive): the inverted-polarity twin is CAUGHT (wrong-frame advance)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenInvertedPolarity);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted gate — the polarity is unproven");
  assert.equal(mismatch.ram.addr, PTR_TARGET, "the inverted-polarity twin must diverge on the target byte");
  console.log(
    `  TEETH/polarity: caught after ${count} combos at 0x6009=${hx(mismatch.timer)} ` +
      `(target ${mismatch.ram.a}->${mismatch.ram.b})`,
  );
});

test("TEETH (exhaustive): the direct-not-indirect twin is CAUGHT (wrong address advanced)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenDirectNotIndirect);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a direct write — the indirect load is unproven");
  // On expiry the twin diverges at BOTH addresses: it leaves the real target *(0x63C0)
  // un-advanced AND mutates the pointer cell 0x63C0. The sweep reports the lower address
  // first (PTR_TARGET 0x6385 < 0x63C0), so accept either.
  assert.ok(
    mismatch.ram.addr === PTR_TARGET || mismatch.ram.addr === SEQ_ADVANCE_PTR,
    `the direct twin must diverge at the target or the pointer cell, got 0x${mismatch.ram.addr.toString(16)}`,
  );
  // Explicit demonstration on one expiry case: the twin touches 0x63C0 and NOT the target.
  const entry = makeEntry(base, 1, 0x40, PTR_TARGET);
  const b = entry.clone();
  brokenDirectNotIndirect(b);
  assert.equal(b.mem.read8(PTR_TARGET), 0x40, "direct twin must leave the real target un-advanced");
  assert.equal(b.mem.read8(SEQ_ADVANCE_PTR), (PTR_TARGET & 0xff) + 1, "direct twin must corrupt the pointer cell 0x63C0");
  console.log(`  TEETH/indirect: caught — twin advanced the pointer cell 0x63C0 and left the real target *(0x63C0) alone`);
});

test("TEETH (exhaustive): the double-increment twin is CAUGHT (wrong amount)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenDoubleIncrement);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a +2 increment — the exact +1 is unproven");
  assert.equal(mismatch.ram.addr, PTR_TARGET, "the double-increment twin must diverge on the target byte");
  console.log(`  TEETH/amount: caught — twin advanced by 2 at the target byte (${mismatch.ram.a}->${mismatch.ram.b})`);
});

// -- 4. REALISM (vacuous in attract) ------------------------------------------

/**
 * Hook 0x3069 in a real attract run. It fires 0 times there, so this check is VACUOUS as
 * written: any dispatch that did appear is verified, but none is required, and the exhaustive
 * sweep is the whole proof. It is NOT dead code — 0x3069 is dispatched in credited play, and
 * those entry states are the coverage this gate does not have.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("REALISM (vacuous in attract): zero natural dispatches to replay; any that appear match", () => {
  const caps = captureDispatches(64, 5000);
  for (const cap of caps) {
    const ram = runPair(cap, advanceSequenceStepWhenTimerExpires);
    assert.equal(ram, null, ram && `RAM diverges on real dispatch at 0x${(ram.addr ?? 0).toString(16)}`);
  }
  console.log(`  REALISM: ${caps.length} natural 0x3069 dispatches over 5000 attract frames (expected 0) — sweep is the proof`);
});
