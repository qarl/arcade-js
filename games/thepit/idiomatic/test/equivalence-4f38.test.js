// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceInitialUp (ROM 0x4f38) — steps an object's cyclic index up
 * one notch and requests sound 8.
 *
 * The index is either DISENGAGED (the off value 255) or ENGAGED in the range 10..35.
 * Stepping up rolls the disengaged value over to re-enter the range at 10, and stepping
 * past the top of the range (above 35) disengages back to 255. The routine's genuine
 * inputs/outputs are: the index in (a register live-in) and the new index out (a register
 * live-out the caller reads), plus a memory side effect — sound command 8 dropped into the
 * sound ring. So the gate is the honest-signature contract: RAM (outside the transient
 * stack scratch) + pc + SP, PLUS the returned index (the register-C live-out), NOT the dead
 * value registers/flags the oracle leaves behind.
 *
 * WHY A CRAFTED ENTRY. This routine requests sound command 8, and attract never requests
 * command 8 (a probe over thousands of frames sees 0 dispatches of it), so advanceInitialUp is
 * never reached in a boot/attract run — the capture/replay harness cannot hook it directly.
 * Per the crafted-entry method the gate instead runs it from a REAL captured sound-request
 * state: the sibling sound stub 0x4c57 (command 2) IS reached during attract and shares the
 * same call convention, so its entry (a valid stack with a return address, an in-play ring
 * pointer) is a faithful state to run advanceInitialUp from. 0x4f38 never calls 0x4c57, so cloning
 * that entry introduces no registry recursion. The one input that shapes the index output —
 * the incoming index — is then swept EXHAUSTIVELY over all 256 values identically on both
 * sides, pinning the roll-over and the disengage boundaries.
 *
 * THE STACK SCRATCH. The Pit's stack is real diffed work RAM (0x83ff down). The oracle
 * pushes its own return address and the shared enqueue tail saves two register pairs — up
 * to six dead bytes parked just below the entry stack pointer that the stack-free idiomatic
 * never writes (classic dead stack scratch, overwritten by the caller's next push before
 * anything reads it). So the RAM diff excludes the [SP-8, SP) window and compares everything
 * else byte-for-byte. The idiomatic models its return as a plain JS return, so the contract
 * does one m.ret() on the candidate after the call to line pc + SP up with the oracle (which
 * rets internally).
 *
 * SIX checks:
 *   0. HARNESS — capture a real 0x4c57 sound-request entry and confirm the oracle run of
 *      advanceInitialUp is deterministic (oracle vs oracle -> identical whole state). Proves the
 *      capture/clone/diff plumbing reaches a real sound-request state.
 *   1. EQUAL (real entry) — advanceInitialUp == oracle over RAM + pc + SP + the new index, and the
 *      ring slot holds sound-8-pending with the pointer advanced.
 *   2. EQUAL (exhaustive index sweep 0..255) — for every incoming index, both leave identical
 *      state and hand back the same new index; the roll-over (255 -> 10), the disengage
 *      (>35 -> 255), and the plain in-range step are all exercised.
 *   3. TEETH (roll-over target) — a twin that re-enters the range at 11 instead of 10 is
 *      CAUGHT on the index live-out (the routine's core payload).
 *   4. TEETH (wrong sound) — a twin that requests command 7 instead of 8 is CAUGHT at the
 *      ring slot by the RAM diff.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4f38.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4f38 as oracle } from "../../translated/loc_4f38.js";
import { advanceInitialUp as idiomatic } from "../advanceInitialUp.js";
import { loc_4c57 as siblingStub } from "../../translated/loc_4c57.js";
import { requestSound8 } from "../requestSound8.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const CAPTURE_AT = 0x4c57; // sibling sound stub — a real sound-request entry, reached in attract
const SOUND8_PENDING = 8 | 0x80; // 0x88 — the byte this routine's sound request queues
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Hook the sibling sound stub 0x4c57 in a real attract run and clone the machine at its
 * first dispatch — a genuine sound-request state (valid stack with a return address, an
 * in-play ring pointer). The wrapper snapshots then runs the oracle so attract proceeds.
 */
function captureRealSoundRequestEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[CAPTURE_AT, (mm) => {
    if (entry === null) entry = mm.clone();
    return siblingStub(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack scratch the
 * oracle's own return-address push and the enqueue tail's register saves park just below
 * the entry stack pointer (which the stack-free idiomatic never writes). Null otherwise.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 8, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Compare a candidate against the oracle over the memory-equivalence contract for one entry:
 * RAM (outside the stack scratch) + pc + SP + the new index (register C — the genuine
 * live-out). The dead value registers/flags are excluded. The oracle rets internally; the
 * candidate models its return with one m.ret() so pc + SP line up. Returns { diffs, ram, ret,
 * oracleIndex } (diffs empty == EQUAL).
 */
function contract(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  const ret = fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (c.regs.c !== o.regs.c) diffs.push(`index oracle=${o.regs.c} cand=${c.regs.c}`);
  return { diffs, ram, ret, oracleIndex: o.regs.c };
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: a real 0x4c57 sound-request entry is captured and the oracle run of 0x4f38 is deterministic", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "expected the sibling sound stub 0x4c57 to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(
    `  HARNESS: captured a real 0x4c57 entry (SP=${hx(entry.regs.sp)}, ` +
      `SOUND_HEAD=${entry.mem.read8(SOUND_HEAD)}, C=${entry.regs.c}); oracle run of 0x4f38 deterministic`,
  );
});

// -- 1. EQUAL on the real captured sound-request entry -----------------------

test("EQUAL (real entry): advanceInitialUp == oracle over RAM + pc + SP + the new index", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs, ret, oracleIndex } = contract(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));
  assert.equal(ret, oracleIndex, `returned index ${ret} != oracle index ${oracleIndex}`);

  // Positive checks: sound 8 really was queued (pending) and the ring pointer advanced.
  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(SOUND_RING + head), SOUND8_PENDING, `ring slot ${head} not filled with sound 8`);
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, `write pointer did not advance from ${head}`);
  console.log(`  EQUAL/real: identical over RAM+pc+SP+index; new index ${oracleIndex}, slot ${head} = ${hx(SOUND8_PENDING)}`);
});

// -- 2. EQUAL across an exhaustive sweep of every incoming index 0..255 -------

test("EQUAL (index sweep 0..255): every incoming index steps identically and hands back the same new index", () => {
  const seed = captureRealSoundRequestEntry(1500);
  assert.ok(seed, "need a captured 0x4c57 entry to craft the sweep from");

  let checked = 0;
  let sawRollover = false; // 255 -> 10
  let sawDisengage = false; // stepping past 35 -> 255
  let sawPlainStep = false; // an ordinary in-range step

  for (let index = 0; index < 256; index++) {
    const entry = seed.clone();
    entry.regs.c = index;

    const { diffs, ret, oracleIndex } = contract(entry, idiomatic);
    assert.equal(diffs.length, 0, `index=${index}: ${diffs.join("; ")}`);
    assert.equal(ret, oracleIndex, `index=${index}: returned ${ret} != oracle ${oracleIndex}`);

    if (index === 255) {
      assert.equal(oracleIndex, 10, "disengaged value must roll over to the range bottom (10)");
      sawRollover = true;
    }
    if (index === 35) {
      assert.equal(oracleIndex, 255, "stepping past the top of the range must disengage (255)");
      sawDisengage = true;
    }
    if (index === 20) {
      assert.equal(oracleIndex, 21, "an in-range index must simply step up one");
      sawPlainStep = true;
    }
    checked++;
  }

  assert.equal(checked, 256, "must have swept every incoming index value");
  assert.ok(sawRollover && sawDisengage && sawPlainStep, "roll-over, disengage, and plain-step arms must all be covered");
  console.log(`  EQUAL/sweep: all ${checked} incoming indices identical (roll-over 255->10, disengage 36->255, plain step)`);
});

// -- 3. TEETH: a wrong roll-over target is caught on the index live-out -------

/** Broken twin: correct sound and step, but re-enters the range at 11 instead of 10. */
function twinWrongRollover(m, index = m.regs.c) {
  requestSound8(m);
  let next = (index + 1) % 256;
  if (next === 0) next = 11; // BUG: the roll-over must re-enter the range at 10, not 11
  if (next > 35) next = 255;
  m.regs.c = next;
  return next;
}

test("TEETH (roll-over): a twin that re-enters at 11 instead of 10 is CAUGHT on the new index", () => {
  const seed = captureRealSoundRequestEntry(1500);
  assert.ok(seed, "need a captured 0x4c57 entry to seed the teeth check");
  const entry = seed.clone();
  entry.regs.c = 255; // the disengaged value -> the roll-over path

  const { diffs, ram } = contract(entry, twinWrongRollover);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-roll-over twin — it proves nothing");
  assert.equal(ram, null, "the roll-over mutation must not move any RAM (it is a register live-out miss)");
  assert.ok(
    diffs.some((d) => d.startsWith("index ")),
    `teeth caught the wrong channel: ${diffs.join("; ")} (expected the index live-out)`,
  );

  assert.equal(contract(entry, idiomatic).diffs.length, 0, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/roll-over: wrong-roll-over twin caught on the index (${diffs.join("; ")})`);
});

// -- 4. TEETH: a wrong sound command is caught at the ring slot by the RAM diff

/** Broken twin: does the real work (correct index + sound 8), then overwrites the just-filled
 *  ring slot with a different command. */
function twinWrongSound(m) {
  const slot = m.mem.read8(SOUND_HEAD);
  const ret = idiomatic(m);
  m.mem.write8(SOUND_RING + slot, 7 | 0x80); // BUG: this routine must request sound 8, not 7
  return ret;
}

test("TEETH (wrong sound): a twin that requests command 7 is CAUGHT at the ring slot", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry to seed the teeth check");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs, ram } = contract(entry, twinWrongSound);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-sound twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + head,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );

  assert.equal(contract(entry, idiomatic).diffs.length, 0, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/sound: wrong-sound twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
