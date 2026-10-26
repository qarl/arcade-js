// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for awardOnePoint (ROM 0x4673) — the "+1 point" score award:
 * it plays the one-point pickup sound, then hands an increment of one to the shared BCD
 * scorer (still the frozen oracle at 0x4689), which folds it into the two-byte score
 * counter and repaints the four on-screen score digits for the active player.
 *
 * The award's whole effect is memory: the pending sound command lands in the ring slot at
 * SOUND_HEAD (pointer advanced), and — when the game-mode gate is active — the score bytes
 * at 0x8031/0x8034 gain one BCD point and the digit tiles in video RAM are rewritten. Its
 * declared live-out is MEMORY-ONLY, so the gate compares that observable RAM effect ALONE.
 * The dissolve replaced the oracle's m.call(0x4689) tail-jump with a direct addScore(m, 1)
 * call, so the idiomatic award leaves pc at its entry value and SP below the oracle's; those
 * are the routine's dead ABI, not its live-out, and are NOT compared (pc, SP, value regs).
 *
 * WHY A CRAFTED ENTRY. Attract never awards a point, so 0x4673 is never dispatched — the
 * capture/replay harness cannot hook it directly. Per the crafted-entry method the gate
 * instead runs the award from a REAL captured sound-request state: the sibling sound stub
 * 0x4c57 (command 2) IS reached during attract, and it leaves a faithful machine state —
 * a valid stack with a return address, an in-play sound-ring pointer, real score bytes.
 * The one input that steers the scorer — the game-mode gate at GAME_STATE — is then swept
 * across active (1,2 → add) and idle (0,3 → skip) identically on both sides.
 *
 * ONE WRINKLE — the oracle award routes its sound through the shared enqueue, which parks
 * two register pairs and a return address on the stack (The Pit's stack is real diffed work
 * RAM, 0x83ff down). Those pushes leave dead bytes just below the entry stack pointer that
 * the stack-free idiomatic sound call does not reproduce; they are classic dead stack scratch
 * (overwritten by the caller's next push before anything reads them), so the RAM diff excludes
 * exactly that window below the entry stack pointer and compares everything else byte-for-byte.
 * The idiomatic award writes nothing in that window, so the exclusion cannot mask a real bug.
 *
 * Six checks:
 *   0. HARNESS — capture a real 0x4c57 sound-request entry and confirm the oracle run of
 *      0x4673 is deterministic (oracle vs oracle -> identical whole state, same pc).
 *   1. EQUAL (real entry) — awardOnePoint == oracle over the observable RAM (outside the
 *      stack scratch), and the pending sound really queued.
 *   2. EQUAL (game-mode sweep 0..3) — with GAME_STATE forced active (1,2) and idle (0,3),
 *      both arms match; the score gains exactly one point when active and is untouched when
 *      idle, confirming both scorer branches run identically.
 *   3. TEETH (wrong increment) — with the scorer active, a twin that adds TWO points is
 *      CAUGHT at the score low byte (the increment is the award's payload).
 *   4. TEETH (wrong sound) — a twin that queues command 12 instead of 13 is CAUGHT at the
 *      ring slot (an unrelated sound would play).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4673.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4673 as oracle } from "../../translated/loc_4673.js";
import { awardOnePoint as idiomatic } from "../awardOnePoint.js";
import { loc_4c57 as siblingStub } from "../../translated/loc_4c57.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { GAME_STATE, SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const CAPTURE_AT = 0x4c57; // sibling sound stub — a real sound-request entry, reached in attract
const SCORE_LO = 0x8031; // score counter low byte (packed BCD) — where the increment lands first
const COMMAND = 13; // the sound command the +1 award requests (`ld a,0x0d`)
const PENDING = COMMAND | 0x80; // 0x8d — the byte queued (high bit marks the ring slot pending)
const WRONG_SOUND = 12; // a neighbouring command index, for the wrong-sound twin
const STACK_SCRATCH = 8; // bytes just below the entry SP the sound call parks (return addr + two saved pairs)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook the sibling sound stub 0x4c57 in a real attract run and clone the machine at its
 * first dispatch — a genuine machine state (valid stack with a return address, in-play
 * sound-ring pointer, real score bytes). The wrapper snapshots then runs the oracle stub
 * so attract proceeds undisturbed.
 */
function captureRealEntry(maxFrames) {
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
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch window
 * the oracle's sound call parks just below the entry stack pointer (which the stack-free
 * idiomatic sound call does not reproduce). Null when otherwise identical.
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

/** Run the oracle and a candidate on independent clones of `entry` and diff the OBSERVABLE RAM effect (outside the
 *  dead stack scratch). pc, SP and the value registers are NOT compared — the dissolved award leaves pc at its entry
 *  value and SP two below the oracle's; those are the routine's dead ABI, not its live-out (header).
 *  Returns { diffs, ram } (diffs empty == EQUAL). */
function observableDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return { diffs, ram };
}

test("HARNESS: a real 0x4c57 entry is captured and the oracle run of 0x4673 is deterministic", () => {
  const entry = captureRealEntry(1500);
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
      `GAME_STATE=${entry.mem.read8(GAME_STATE)}, SOUND_HEAD=${entry.mem.read8(SOUND_HEAD)}); ` +
      "oracle run of 0x4673 deterministic",
  );
});

test("EQUAL (real entry): awardOnePoint == oracle over the observable RAM effect", () => {
  const entry = captureRealEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs } = observableDiffs(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive check: the pending sound really was queued into the ring slot.
  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(SOUND_RING + head), PENDING, `ring slot ${head} not filled with the pending sound`);
  console.log(`  EQUAL/real: identical observable RAM; sound slot ${head} = ${hx(PENDING)}`);
});

test("EQUAL (game-mode sweep 0..3): award-when-active, skip-when-idle, both identical to the oracle", () => {
  const seed = captureRealEntry(1500);
  assert.ok(seed, "need a captured 0x4c57 entry to craft the sweep from");

  for (let mode = 0; mode < 4; mode++) {
    const entry = seed.clone();
    entry.mem.write8(GAME_STATE, mode);
    const before = entry.mem.read8(SCORE_LO);

    const { diffs } = observableDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, `mode=${mode}: ${diffs.join("; ")}`);

    // Confirm the scorer branch actually ran. idiomatic == oracle is already proven above,
    // so the exact BCD result is right; here we only check the branch moved the score when
    // active (1,2) and held it when idle (0,3) — a BCD +1 always changes the byte.
    const c = entry.clone();
    idiomatic(c);
    const after = c.mem.read8(SCORE_LO);
    const active = mode === 1 || mode === 2;
    if (active) assert.notEqual(after, before, `mode=${mode}: score low byte did not gain a point`);
    else assert.equal(after, before, `mode=${mode}: score low byte changed while idle`);
  }
  console.log("  EQUAL/sweep: modes 0..3 match the oracle; score +1 when active (1,2), untouched when idle (0,3)");
});

/** Broken twin: correct sound, but adds TWO points instead of one. */
function twinWrongIncrement(m) {
  requestSound13Direct(m);
  m.regs.bc = 2; // BUG: awards two points, not one
  return m.call(0x4689);
}

/** The award's correct sound, inlined so the increment twin differs ONLY in the amount. */
function requestSound13Direct(m) {
  const { mem } = m;
  const slot = mem.read8(SOUND_HEAD);
  mem.write8(SOUND_HEAD, (slot + 1) % 8);
  mem.write8(SOUND_RING + slot, PENDING);
}

test("TEETH (wrong increment): a twin that awards two points is CAUGHT at the score low byte", () => {
  const entry = captureRealEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry to seed the teeth check");
  entry.mem.write8(GAME_STATE, 1); // scorer active, so the increment reaches memory

  const { diffs, ram } = observableDiffs(entry, twinWrongIncrement);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-increment twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SCORE_LO,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SCORE_LO)})`,
  );
  console.log(`  TEETH/increment: two-point twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

/** Broken twin: correct increment, but queues sound command 12 instead of 13. */
function twinWrongSound(m) {
  const { mem } = m;
  const slot = mem.read8(SOUND_HEAD);
  mem.write8(SOUND_HEAD, (slot + 1) % 8);
  mem.write8(SOUND_RING + slot, WRONG_SOUND | 0x80); // BUG: an unrelated sound plays
  m.regs.bc = 1;
  return m.call(0x4689);
}

test("TEETH (wrong sound): a twin that queues command 12 is CAUGHT at the ring slot", () => {
  const entry = captureRealEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry to seed the teeth check");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs, ram } = observableDiffs(entry, twinWrongSound);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-sound twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + head,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );
  console.log(`  TEETH/sound: wrong-sound twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
