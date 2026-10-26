// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stepInitialDown (ROM 0x4f26) — steps a caller's bounded cyclic
 * index down one notch and requests sound 8.
 *
 * The routine has two observable effects: a MEMORY effect (the sound request fills a ring
 * slot and advances the write pointer, via the shared enqueue) and a REGISTER LIVE-OUT
 * (the stepped index the caller reads back). The honest signature surfaces the live-in
 * index as a parameter and the new index as the RETURN, so the gate compares RAM + pc + SP
 * AND asserts the returned index against the value the oracle leaves in the index register.
 * The oracle's other exit registers and flags are dead and excluded.
 *
 * WHY A CRAFTED ENTRY. 0x4f26 is never dispatched in a boot/attract run (a probe over 3000
 * frames sees 0), so the capture/replay harness cannot hook it directly. Per the
 * crafted-entry method the gate runs it from a REAL captured sound-request state: the
 * sibling stub 0x4c57 (command 2) IS reached during attract, and its entry is a faithful
 * machine — a valid stack with a return address and an in-play ring pointer. Crucially
 * 0x4f26 never calls 0x4c57, so cloning that entry introduces no registry recursion (0x4f26
 * requests its sound through 0x4c6f, a different stub). The two inputs that shape the output
 * — the index and the ring write pointer — are then swept identically on both sides: the
 * index EXHAUSTIVELY over all 256 values, the pointer over all 8 slots (pinning the 7 -> 0
 * wrap).
 *
 * ONE WRINKLE — the oracle path (0x4f26 calls 0x4c6f -> shared enqueue 0x4ca5) parks dead
 * bytes on the stack that the stack-free idiomatic JS does not reproduce: the enqueue saves
 * and restores two register pairs (4 bytes) and 0x4f26's own call pushes a 2-byte return
 * address, so six dead bytes sit just below the entry stack pointer. The Pit's stack is real
 * diffed work RAM, so the RAM diff excludes exactly that [SP-6, SP) window (classic dead
 * stack scratch, overwritten before anything reads it) and compares everything else
 * byte-for-byte. The idiomatic routine models its return as a plain JS return, so the
 * contract check does one m.ret() on the candidate after the call to line pc + SP up with
 * the oracle (which rets internally).
 *
 * Checks:
 *   0. HARNESS — capture a real 0x4c57 sound-request entry and confirm the oracle run of
 *      0x4f26 is deterministic (oracle vs oracle -> identical whole state).
 *   1. EQUAL (real entry) — stepInitialDown == oracle over RAM (outside the stack scratch) + pc +
 *      SP, and the returned index matches the oracle's stepped index.
 *   2. EQUAL (exhaustive index sweep 0..255 x ring pointer 0..7) — for every index and every
 *      write pointer, the returned index and the filled/advanced ring match the oracle. This
 *      pins the in-range step, the off-sentinel re-entry at the top, the floor -> off drop,
 *      and the 7 -> 0 ring wrap.
 *   3. TEETH (wrong sound) — a twin that requests sound 7 instead of 8 is CAUGHT by the RAM
 *      diff at the ring slot.
 *   4. TEETH (wrong step) — a twin that steps the index UP instead of down is CAUGHT by the
 *      returned-index assertion (a bug the RAM diff alone would miss, since the index is a
 *      register live-out, not RAM).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4f26.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4f26 as oracle } from "../../translated/loc_4f26.js";
import { stepInitialDown as idiomatic } from "../stepInitialDown.js";
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
const STACK_SCRATCH = 6; // dead bytes below entry SP: enqueue's 2 saved pairs (4) + 0x4f26's call return (2)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

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
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch bytes the
 * oracle's call + register saves park just below the entry stack pointer (which the
 * stack-free idiomatic JS does not reproduce). Null when otherwise identical.
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

/**
 * Compare a candidate against the oracle over the memory-equivalence contract for one entry:
 * RAM (outside the stack scratch) + pc + SP + the returned index. The index arrives from the
 * caller and is read back, so it is the routine's register live-out and asserted; the oracle
 * leaves it in the index register. The oracle rets internally; the candidate models its
 * return with one m.ret() so pc + SP line up. Returns { diffs, ram, ret }.
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  const ret = fn(c, c.regs.c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (ret !== o.regs.c) diffs.push(`index oracle=${o.regs.c} cand=${ret}`);
  return { diffs, ram, ret };
}

test("HARNESS: a real 0x4c57 sound-request entry is captured and the oracle run of 0x4f26 is deterministic", () => {
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
      `SOUND_HEAD=${entry.mem.read8(SOUND_HEAD)}); oracle run of 0x4f26 deterministic`,
  );
});

test("EQUAL (real entry): stepInitialDown == oracle over RAM + pc + SP + returned index", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs } = contractDiffs(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive checks: sound 8 really was queued (pending), and the pointer advanced.
  const c = entry.clone();
  idiomatic(c, c.regs.c);
  assert.equal(c.mem.read8(SOUND_RING + head), 8 | 0x80, `ring slot ${head} not filled with pending sound 8`);
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, `write pointer did not advance from ${head}`);
  console.log(`  EQUAL/real: identical over RAM+pc+SP+index; sound 8 queued at slot ${head}, pointer -> ${(head + 1) % 8}`);
});

test("EQUAL (exhaustive index 0..255 x ring pointer 0..7): returned index + ring match the oracle", () => {
  const seed = captureRealSoundRequestEntry(1500);
  assert.ok(seed, "need a captured 0x4c57 entry to craft the sweep from");

  let sawTopReentry = false; // off (255) -> top of range (35)
  let sawFloorOff = false; //   bottom of range (10) -> off (255)
  for (let head = 0; head < 8; head++) {
    for (let index = 0; index < 256; index++) {
      const entry = seed.clone();
      entry.mem.write8(SOUND_HEAD, head);
      entry.regs.c = index;

      const { diffs, ret } = contractDiffs(entry, idiomatic);
      assert.equal(diffs.length, 0, `index=${index} head=${head}: ${diffs.join("; ")}`);

      if (index === 255) { assert.equal(ret, 35); sawTopReentry = true; }
      if (index === 10) { assert.equal(ret, 255); sawFloorOff = true; }

      // The sound request is unconditional: every input fills the slot with pending sound 8.
      const c = entry.clone();
      idiomatic(c, c.regs.c);
      assert.equal(c.mem.read8(SOUND_RING + head), 8 | 0x80, `index=${index} head=${head}: sound 8 not queued`);
      assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, `index=${index} head=${head}: pointer did not advance/wrap`);
    }
  }
  assert.ok(sawTopReentry, "sweep never exercised the off -> top re-entry");
  assert.ok(sawFloorOff, "sweep never exercised the floor -> off drop");
  console.log("  EQUAL/sweep: all 256 indices x 8 ring pointers match the oracle (in-range step, off->top, floor->off, ring wrap)");
});

/** Broken twin: requests sound 7 (a sibling's index) instead of 8; index math correct. */
function twinWrongSound(m, index) {
  requestSound8(m); // request 8...
  const { mem } = m; // ...then overwrite the just-filled slot with 7 (a wrong-sound bug)
  const slot = (mem.read8(SOUND_HEAD) + 7) % 8; // the slot enqueue just wrote (pointer already advanced)
  mem.write8(SOUND_RING + slot, 7 | 0x80);
  if (index === 255) return 35;
  const stepped = index - 1;
  return stepped > 9 ? stepped : 255;
}

test("TEETH (wrong sound): a twin that queues sound 7 instead of 8 is CAUGHT at the ring slot", () => {
  const entry = captureRealSoundRequestEntry(1500);
  assert.ok(entry, "need a captured 0x4c57 entry to seed the teeth check");
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs, ram } = contractDiffs(entry, twinWrongSound);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-sound twin — it proves nothing");
  assert.equal(
    ram && ram.addr,
    SOUND_RING + head,
    `teeth caught the wrong address ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );
  console.log(`  TEETH/sound: wrong-sound twin caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

/** Broken twin: steps the index UP instead of down (sound correct). Caught by the return. */
function twinWrongStep(m, index) {
  requestSound8(m);
  if (index === 255) return 35;
  const stepped = index + 1; // BUG: steps up, not down
  return stepped > 9 ? stepped : 255;
}

test("TEETH (wrong step): a twin that steps the index up instead of down is CAUGHT by the returned index", () => {
  const seed = captureRealSoundRequestEntry(1500);
  assert.ok(seed, "need a captured 0x4c57 entry to seed the teeth check");

  // Use an in-range index so the up/down difference is observable (e.g. 20 -> 19 vs 21).
  const entry = seed.clone();
  entry.regs.c = 20;

  const { diffs, ret } = contractDiffs(entry, twinWrongStep);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the wrong-step twin — it proves nothing");
  assert.ok(
    diffs.some((d) => d.startsWith("index ")),
    `the wrong step must surface as an index difference, got: ${diffs.join("; ")}`,
  );
  console.log(`  TEETH/step: wrong-step twin caught by the returned index (twin=${ret}, oracle stepped 20 -> 19)`);
});
