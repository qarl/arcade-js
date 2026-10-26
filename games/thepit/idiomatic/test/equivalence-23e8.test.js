// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for seedMountainErosion (ROM 0x23e8) — the tilemap-setup routine that
 * seeds a write pointer + a countdown, conditionally cues a sound, and conditionally
 * stamps a two-tile "cap" into the tilemap.
 *
 * Its whole effect is memory: the pointer at 0x8065, the countdown at 0x8067, the two
 * tilemap cells 0x90e4 / 0x90c4, and — on the cued arm — the sound ring. Its declared
 * live-out is MEMORY-ONLY, so the gate compares the observable RAM effect and does NOT
 * compare pc / SP / value registers: the idiomatic routine is plain JS (it delegates the
 * sound cue to requestSound21 and returns), so it never runs the oracle's Z80 ret and
 * leaves the exit registers and return path (dead scratch) untouched.
 *
 * REAL DISPATCHES. 0x23e8 is dispatched repeatedly during a plain boot/attract run
 * (8 within 1500 frames, 21 within 3000), all at entry SP 0x83fd. Those real states cover
 * the pointer + countdown writes and BOTH head-cell arms (one dispatch finds 0x90e4 != 0xfe
 * -> early return; the rest find 0xfe -> the two-tile stamp). They do NOT present the sound
 * trigger tile (0x9264 reads 0x2c, not 0x32), so the sound arm is reached with a CRAFTED
 * entry: a real state with 0x9264 poked to 0x32 identically on both sides.
 *
 * ONE WRINKLE — the dead stack scratch. On the cued arm the oracle marks the sound call
 * with a pushed return address and the shared enqueue saves/restores two register pairs,
 * so the oracle parks up to six dead bytes just below the entry stack pointer that the
 * stack-free idiomatic JS does not reproduce. They are classic dead stack scratch
 * (overwritten before anything reads them), so the RAM diff excludes the [SP-8, SP)
 * window and compares everything else byte-for-byte. On the non-cued arms nothing is
 * pushed, so that window is identical on both sides anyway.
 *
 * Checks:
 *   0. HARNESS   — capture real 0x23e8 entries and confirm the oracle run is
 *                  deterministic (oracle vs oracle -> identical whole state incl. pc).
 *   1. EQUAL     — seedMountainErosion == oracle over every real captured dispatch; both head-cell
 *                  arms are exercised, with positive checks on the pointer + countdown.
 *   2. EQUAL     — a crafted entry forces the sound arm (0x9264 = 0x32): identical RAM
 *                  outside the stack scratch, and the ring slot + pointer hold the cue.
 *   3. EQUAL     — crafted matrix over both conditionals x a countdown sweep (including a
 *                  byte-wrapping subtraction), all identical.
 *   4. TEETH     — wrong countdown (two per unit instead of four) is CAUGHT at 0x8067.
 *   5. TEETH     — wrong tilemap pointer is CAUGHT at 0x8065.
 *   6. TEETH     — a dropped second tile stamp is CAUGHT at 0x90c4 (patch arm).
 *   7. TEETH     — a dropped sound cue is CAUGHT at the sound ring pointer (cued arm).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-23e8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23e8 as oracle } from "../../translated/loc_23e8.js";
import { seedMountainErosion as idiomatic } from "../seedMountainErosion.js";
import { requestSound21 } from "../requestSound21.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { SOUND_HEAD, SOUND_RING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x23e8;
const PTR = 0x8065; // seeded tilemap write pointer (16-bit)
const PTR_VAL = 0x9104; // the fixed tilemap address it points at
const COUNTDOWN = 0x8067; // the countdown byte
const PARAM = 0x804f; // gameplay parameter (minuend of the countdown)
const COUNTER = 0x8028; // counter (x4 subtrahend of the countdown)
const TRIGGER_CELL = 0x9264; // marker cell; holding 0x32 cues the sound
const TRIGGER_TILE = 0x32;
const HEAD_CELL = 0x90e4; // patched to 0xae while it holds the 0xfe marker
const ABOVE_CELL = 0x90c4; // the cell one row above, patched to 0xac
const HEAD_MARKER = 0xfe;
const SOUND_CMD = 21; // requestSound21
const PENDING = SOUND_CMD | 0x80; // 0x95 — the byte queued (high bit marks it pending)
const STACK_SKIP = 8; // exclude [SP-8, SP): the oracle's cued-arm dead stack scratch
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Expected countdown, the oracle's arithmetic reduced to one byte. */
function expectedCountdown(m) {
  return (m.mem.read8(PARAM) - 4 * m.mem.read8(COUNTER)) & 0xff;
}

// -- helpers ------------------------------------------------------------------

/**
 * Hook 0x23e8 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots then runs the oracle so attract proceeds undisturbed.
 */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return caps;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack scratch the
 * oracle parks just below the entry stack pointer on the cued arm (which the stack-free
 * idiomatic JS does not reproduce). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SKIP, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two clones of one entry state and diff the observable
 * RAM effect (outside the stack scratch). pc / SP / value registers are the declared-dead
 * live-out and are not compared. Returns { diffs, ram } (diffs empty == EQUAL).
 */
function contractDiffs(entry, fn) {
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

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: real 0x23e8 entries are captured and the oracle run is deterministic", () => {
  const caps = captureEntries(25, 1500);
  assert.ok(caps.length >= 1, "expected 0x23e8 to be dispatched during boot/attract");

  const entry = caps[0];
  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(
    `  HARNESS: captured ${caps.length} real 0x23e8 entries (SP=${hx(entry.regs.sp)}); ` +
      "oracle run deterministic",
  );
});

// -- 1. EQUAL on every real captured dispatch --------------------------------

test("EQUAL (real entries): seedMountainErosion == oracle over every real dispatch; both head-cell arms", () => {
  const caps = captureEntries(25, 1500);
  assert.ok(caps.length >= 1, "need at least one captured 0x23e8 entry");

  let patchArm = 0;
  let earlyReturnArm = 0;
  for (const entry of caps) {
    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, `real entry (SP=${hx(entry.regs.sp)}): ${diffs.join("; ")}`);

    // Positive checks on the always-taken writes.
    const c = entry.clone();
    idiomatic(c);
    assert.equal(c.mem.read16(PTR), PTR_VAL, "tilemap pointer not seeded");
    assert.equal(c.mem.read8(COUNTDOWN), expectedCountdown(entry), "countdown byte wrong");

    if (entry.mem.read8(HEAD_CELL) === HEAD_MARKER) patchArm++;
    else earlyReturnArm++;
  }
  assert.ok(patchArm > 0, "no real entry exercised the tile-stamp arm (0x90e4 == 0xfe)");
  assert.ok(earlyReturnArm > 0, "no real entry exercised the early-return arm (0x90e4 != 0xfe)");
  console.log(
    `  EQUAL/real: ${caps.length} dispatches identical (${patchArm} stamp, ${earlyReturnArm} early-return); ` +
      "pointer + countdown verified",
  );
});

// -- 2. EQUAL on a crafted entry that forces the sound arm -------------------

test("EQUAL (crafted sound arm): 0x9264 = 0x32 cues the sound, identical outside the stack scratch", () => {
  const caps = captureEntries(25, 1500);
  assert.ok(caps.length >= 1, "need a captured 0x23e8 entry to craft from");

  const entry = caps[0].clone();
  entry.mem.write8(TRIGGER_CELL, TRIGGER_TILE); // force the sound arm on both sides
  const head = entry.mem.read8(SOUND_HEAD);

  const { diffs } = contractDiffs(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive: the cue landed in the ring and the write pointer advanced.
  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(SOUND_RING + head), PENDING, `ring slot ${head} not filled with the cue`);
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, "sound write pointer did not advance");
  console.log(
    `  EQUAL/sound: cued arm identical outside [SP-8,SP); slot ${head} = ${hx(PENDING)}, pointer -> ${(head + 1) % 8}`,
  );
});

// -- 3. EQUAL across a crafted matrix + countdown sweep ----------------------

test("EQUAL (crafted matrix): both conditionals x a countdown sweep are all identical", () => {
  const caps = captureEntries(25, 1500);
  assert.ok(caps.length >= 1, "need a captured 0x23e8 entry to craft from");
  const seed = caps[0];

  // (counter, param) pairs — the last forces a byte-wrapping subtraction (16 - 4*80).
  const sums = [[3, 55], [0, 0], [1, 200], [80, 16], [64, 5]];
  let n = 0;
  for (const trigger of [TRIGGER_TILE, 0x00]) {
    for (const head of [HEAD_MARKER, 0x00]) {
      for (const [counter, param] of sums) {
        const entry = seed.clone();
        entry.mem.write8(TRIGGER_CELL, trigger);
        entry.mem.write8(HEAD_CELL, head);
        entry.mem.write8(COUNTER, counter);
        entry.mem.write8(PARAM, param);

        const { diffs } = contractDiffs(entry, idiomatic);
        assert.equal(
          diffs.length,
          0,
          `trigger=${hx(trigger)} head=${hx(head)} counter=${counter} param=${param}: ${diffs.join("; ")}`,
        );
        n++;
      }
    }
  }
  console.log(`  EQUAL/matrix: ${n} crafted combinations identical (sound x stamp x countdown, incl. byte wrap)`);
});

// -- 4. TEETH: wrong countdown -----------------------------------------------

/** Broken twin: subtracts two per unit instead of four (a plausible one-shift slip). */
function twinWrongCountdown(m) {
  const { mem } = m;
  mem.write16(PTR, PTR_VAL);
  mem.write8(COUNTDOWN, mem.read8(PARAM) - 2 * mem.read8(COUNTER)); // BUG: 2* should be 4*
  if (mem.read8(TRIGGER_CELL) === TRIGGER_TILE) requestSound21(m);
  if (mem.read8(HEAD_CELL) !== HEAD_MARKER) return;
  mem.write8(HEAD_CELL, 0xae);
  mem.write8(ABOVE_CELL, 0xac);
}

test("TEETH (wrong countdown): two-per-unit twin is CAUGHT at 0x8067", () => {
  const caps = captureEntries(25, 1500);
  const entry = caps.find((e) => e.mem.read8(COUNTER) !== 0) ?? caps[0];
  const { diffs, ram } = contractDiffs(entry, twinWrongCountdown);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a wrong countdown — it proves nothing");
  assert.equal(ram && ram.addr, COUNTDOWN, `caught wrong address ${ram ? hx(ram.addr) : "(none)"}`);
  console.log(`  TEETH/countdown: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

// -- 5. TEETH: wrong tilemap pointer -----------------------------------------

/** Broken twin: seeds the pointer one cell off. */
function twinWrongPointer(m) {
  const { mem } = m;
  mem.write16(PTR, PTR_VAL + 1); // BUG: 0x9105 instead of 0x9104
  mem.write8(COUNTDOWN, mem.read8(PARAM) - 4 * mem.read8(COUNTER));
  if (mem.read8(TRIGGER_CELL) === TRIGGER_TILE) requestSound21(m);
  if (mem.read8(HEAD_CELL) !== HEAD_MARKER) return;
  mem.write8(HEAD_CELL, 0xae);
  mem.write8(ABOVE_CELL, 0xac);
}

test("TEETH (wrong pointer): an off-by-one tilemap pointer is CAUGHT at 0x8065", () => {
  const caps = captureEntries(25, 1500);
  const { diffs, ram } = contractDiffs(caps[0], twinWrongPointer);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a wrong pointer — it proves nothing");
  assert.equal(ram && ram.addr, PTR, `caught wrong address ${ram ? hx(ram.addr) : "(none)"}`);
  console.log(`  TEETH/pointer: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

// -- 6. TEETH: dropped second tile stamp -------------------------------------

/** Broken twin: stamps the head cell but drops the cell one row above. */
function twinDroppedStamp(m) {
  const { mem } = m;
  mem.write16(PTR, PTR_VAL);
  mem.write8(COUNTDOWN, mem.read8(PARAM) - 4 * mem.read8(COUNTER));
  if (mem.read8(TRIGGER_CELL) === TRIGGER_TILE) requestSound21(m);
  if (mem.read8(HEAD_CELL) !== HEAD_MARKER) return;
  mem.write8(HEAD_CELL, 0xae); // BUG: forgets the 0x90c4 stamp
}

test("TEETH (dropped stamp): skipping the above-cell stamp is CAUGHT at 0x90c4", () => {
  const caps = captureEntries(25, 1500);
  const entry = caps[0].clone();
  entry.mem.write8(HEAD_CELL, HEAD_MARKER); // ensure the stamp arm is taken
  entry.mem.write8(ABOVE_CELL, 0x00); // known non-0xac value so a dropped stamp differs
  const { diffs, ram } = contractDiffs(entry, twinDroppedStamp);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a dropped tile stamp — it proves nothing");
  assert.equal(ram && ram.addr, ABOVE_CELL, `caught wrong address ${ram ? hx(ram.addr) : "(none)"}`);
  console.log(`  TEETH/stamp: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

// -- 7. TEETH: dropped sound cue ---------------------------------------------

/** Broken twin: does everything but the sound cue on the trigger arm. */
function twinNoSound(m) {
  const { mem } = m;
  mem.write16(PTR, PTR_VAL);
  mem.write8(COUNTDOWN, mem.read8(PARAM) - 4 * mem.read8(COUNTER));
  // BUG: no requestSound21 even though the trigger tile is present
  if (mem.read8(HEAD_CELL) !== HEAD_MARKER) return;
  mem.write8(HEAD_CELL, 0xae);
  mem.write8(ABOVE_CELL, 0xac);
}

test("TEETH (dropped sound): skipping the cue on the trigger arm is CAUGHT at the ring pointer", () => {
  const caps = captureEntries(25, 1500);
  const entry = caps[0].clone();
  entry.mem.write8(TRIGGER_CELL, TRIGGER_TILE); // force the sound arm
  const { diffs, ram } = contractDiffs(entry, twinNoSound);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a dropped sound cue — it proves nothing");
  assert.equal(ram && ram.addr, SOUND_HEAD, `caught wrong address ${ram ? hx(ram.addr) : "(none)"}`);
  console.log(`  TEETH/sound: caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
