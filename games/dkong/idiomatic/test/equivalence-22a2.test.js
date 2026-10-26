// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for raise50mObjectAndPark (ROM 0x22A2) — one idle-then-retract tick for a
 * BOARD_OBJ_SCRATCH object, parking it back in state 0 at the TOP of its travel. The position
 * counter is a screen Y and larger Y is LOWER on screen, so the counter's minimum (0x68) is the
 * object's highest point and stepping the counter down moves the object UP.
 *
 * raise50mObjectAndPark is an arm of the dispatch50mObjectState object state machine. It is entered with the object
 * record base on the stack (the oracle's `pop hl`); the idiomatic routine takes that base
 * as a parameter. Its whole memory-observable effect factorises into two paths, each a
 * function of ONE record byte, so a crafted sweep is a PROOF, not a sample:
 *
 *   IDLE PATH — the +4 countdown decrements to nonzero: writes only field +4, and the
 *               written byte depends ONLY on the +4 value.
 *   FIRE PATH — the +4 countdown underflows to zero: reloads +4, steps the +3 position
 *               DOWN, mirrors it to a sprite cell (publish50mObjectYToSprite), and — only when the new
 *               position equals 0x68 — resets field +1 to 0x80 and the state byte (+0) to
 *               0. Everything past the reload depends ONLY on the +3 position value.
 *
 * The two BOARD_OBJ_SCRATCH records the game actually uses (0x6280 / 0x6288) between them
 * exercise BOTH sprite slots publish50mObjectYToSprite can pick: +3 of 0x6280 is 0x6283 (bit 3 clear ->
 * 0x6947), +3 of 0x6288 is 0x628b (bit 3 set -> 0x694b). So sweeping both records over all
 * 256 countdown values and all 256 position values covers the entire observable space.
 *
 * The oracle brackets its display-mirror call with a pushed return address; the idiomatic
 * routine direct-calls publish50mObjectYToSprite, dropping that push. Its dead scratch byte lands in
 * STACK_SCRATCH, which the memory-equivalence contract excludes (mirrors equivalence-0350).
 * The oracle's entry `pop hl` and terminal `ret` only READ the stack, so they never affect
 * compared memory; live-out is memory-only, so pc/SP are not compared.
 *
 *   1. EQUAL (crafted, exhaustive) — raise50mObjectAndPark == oracle on RAM − the stack scratch below the caller frame across both
 *      sweeps on both records (1024 combos), plus non-vacuity: the oracle really mirrors the
 *      byte to the record's selected sprite cell (leaving the other untouched) and really
 *      rewrites +1 and +0 on the reset.
 *
 *   2. TEETH — three deliberately-broken twins the same sweeps MUST catch:
 *        (a) wrong reload   — reloads the countdown to 0x03 instead of 0x02.
 *        (b) counter goes up — steps the position +3 UP instead of DOWN.
 *        (c) dropped reset  — skips the field +1 = 0x80 write on the reset.
 *
 *   3. REALISM — hook 0x22A2 in a real attract run; document the (zero) natural dispatches
 *      (dispatch50mObjectState's board gate is closed in attract) and verify any that DO occur match.
 *
 * HOLE — NO REAL DISPATCH IS EVER REPLAYED. Job 3 runs a plain ATTRACT session (2000 frames),
 * where the board gate is shut, so it can only ever record zero. Real dispatches DO occur, and
 * freely, on a credited 50m board: the four-state cycle has been traced live on one. This gate
 * replays NONE of them. The crafted sweep is exhaustive over the routine's own input surface
 * and is sound as far as it goes, but "exhaustive by factorisation" is not the same claim as
 * "replayed against real entries", and only the first is made here.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-22a2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_22a2 as oracle } from "../../translated/loc_22a2.js";
import { raise50mObjectAndPark } from "../raise50mObjectAndPark.js";
import { publish50mObjectYToSprite } from "../publish50mObjectYToSprite.js"; // the mirror the broken twins still call
import { STACK_SCRATCH, BOARD_OBJ_SCRATCH, SPRITE_BUFFER } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x22a2;

// The two records dispatch50mObjectState dispatches (odd/even frame parity). Between them their +3 field
// selects both of publish50mObjectYToSprite's sprite slots.
const RECORDS = [BOARD_OBJ_SCRATCH, BOARD_OBJ_SCRATCH + 8]; // 0x6280, 0x6288

// publish50mObjectYToSprite's two destination cells (+3 field of sprite records 17/18 inside SPRITE_BUFFER).
const DEST_BIT3_CLEAR = SPRITE_BUFFER + 17 * 4 + 3; // 0x6947 — chosen by 0x6280's +3 (0x6283)
const DEST_BIT3_SET = SPRITE_BUFFER + 18 * 4 + 3; // 0x694b — chosen by 0x6288's +3 (0x628b)
const spriteDest = (recordBase) => (((recordBase + 3) & 0x08) !== 0 ? DEST_BIT3_SET : DEST_BIT3_CLEAR);
const spriteOther = (recordBase) => (spriteDest(recordBase) === DEST_BIT3_SET ? DEST_BIT3_CLEAR : DEST_BIT3_SET);

// Distinct sentinels seeded so every write the routine makes is observable: a wrong or
// missing store shows up as a real RAM difference rather than aliasing the value already there.
const STATE_SENTINEL = 0xaa; // field +0 (reset writes 0x00)
const FIELD1_SENTINEL = 0x55; // field +1 (reset writes 0x80)
const SPRITE_SENTINEL = 0x11; // both sprite cells (mirror writes one)

// The oracle pops the record base off the stack, then pushes/pops a return address around
// its mirror call and finally returns; point SP at the stack scratch so those bytes stay
// well clear of I/O and the record/sprite regions.
const SP_TOP = 0x6c00;
const CALLER_RET = 0x199e; // plausible target for the terminal return (pc is not compared)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const POPPED_ARG = 2;

// First RAM byte that differs between two machines, skipping the stack scratch below the caller frame. { addr, a, b } | null.
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

// A real, self-consistent machine: boot + a stretch of attract so surrounding work RAM holds
// realistic values. 0x22A2's body is never reached here; it is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * A crafted entry: a clone of `base` with the object record fields seeded (countdown and
 * position from the sweep, +0/+1 to sentinels), both sprite cells seeded to a sentinel, and
 * the oracle's stack set up — caller return then the record base, so the top holds the base
 * for the oracle's `pop hl`. Frame machinery is neutralised so the oracle's steps/returns
 * cannot fire an NMI or push a frame.
 */
function makeEntry(base, recordBase, countdown, position) {
  const e = base.clone();
  const at = (n) => (recordBase & 0xff00) | ((recordBase + n) & 0xff);
  e.mem.write8(at(0), STATE_SENTINEL);
  e.mem.write8(at(1), FIELD1_SENTINEL);
  e.mem.write8(at(3), position);
  e.mem.write8(at(4), countdown);
  e.mem.write8(DEST_BIT3_CLEAR, SPRITE_SENTINEL);
  e.mem.write8(DEST_BIT3_SET, SPRITE_SENTINEL);
  e.regs.sp = SP_TOP;
  e.push16(CALLER_RET); // for the terminal `ret`
  e.push16(recordBase); // top of stack -> the oracle's `pop hl`
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle and a candidate on two FRESH, byte-identical crafted entries (the routine WRITES memory) and diff
// the memory-equivalence contract. Returns the RAM diff (or null) and the oracle machine (non-vacuity).
function runPair(base, recordBase, countdown, position, candidate) {
  const a = makeEntry(base, recordBase, countdown, position); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, recordBase, countdown, position); // candidate
  oracle(a);
  candidate(b, recordBase);
  return { ram: firstRamDiff(a, b, aFloor + POPPED_ARG), a };
}

// The two disjoint sweeps over both records: the first candidate-vs-oracle mismatch (or null) and the total combos compared.
function fullSweep(base, candidate) {
  let count = 0;
  for (const recordBase of RECORDS) {
    // Sweep A — the countdown over all 256 values (position fixed to a value that does NOT
    // hit the reset sentinel on the single fire this sweep triggers, at countdown == 1).
    for (let t = 0; t < 256; t++) {
      const { ram } = runPair(base, recordBase, t, 0x40, candidate);
      count++;
      if (ram) return { mismatch: { recordBase, countdown: t, position: 0x40, ram }, count };
    }
    // Sweep B — the fire path: countdown == 1 so it underflows, position over all 256 values
    // (covers the descend/mirror for every position and the reset at position 0x68).
    for (let p = 0; p < 256; p++) {
      const { ram } = runPair(base, recordBase, 1, p, candidate);
      count++;
      if (ram) return { mismatch: { recordBase, countdown: 1, position: p, ram }, count };
    }
  }
  return { mismatch: null, count };
}

const describeMismatch = (mm) =>
  mm &&
  `at record=${hx(mm.recordBase)} countdown=${hx(mm.countdown)} position=${hx(mm.position)}: ` +
    `RAM diverges at ${hx(mm.ram.addr ?? 0)} (oracle=${mm.ram.a} cand=${mm.ram.b})`;

// -- 1. EQUAL (crafted, exhaustive) -------------------------------------------

test("EQUAL (exhaustive): raise50mObjectAndPark == oracle across both sweeps on both records", () => {
  const base = attractBase();

  const { mismatch, count } = fullSweep(base, raise50mObjectAndPark);
  assert.equal(mismatch, null, describeMismatch(mismatch));
  assert.equal(count, RECORDS.length * (256 + 256), "must have compared the full factored input space");

  // Non-vacuity, per record: on a descend the oracle mirrors the stepped position to the
  // record's selected sprite cell and leaves the other cell at its sentinel; on a reset it
  // rewrites +1 and +0.
  for (const recordBase of RECORDS) {
    const dest = spriteDest(recordBase);
    const other = spriteOther(recordBase);

    // descend (position 0x40 -> 0x3f); no reset.
    const { a: descend } = runPair(base, recordBase, 1, 0x40, raise50mObjectAndPark);
    assert.equal(descend.mem.read8(dest), 0x3f, `oracle must mirror the stepped position to ${hx(dest)}`);
    assert.equal(descend.mem.read8(other), SPRITE_SENTINEL, `oracle must leave ${hx(other)} untouched`);
    assert.equal(descend.mem.read8((recordBase + 3) & 0xffff), 0x3f, "oracle must step the position DOWN");

    // reset (position 0x69 -> 0x68 == the bottom sentinel).
    const { a: reset } = runPair(base, recordBase, 1, 0x69, raise50mObjectAndPark);
    assert.equal(reset.mem.read8((recordBase + 1) & 0xffff), 0x80, "oracle must set field +1 to 0x80 on reset");
    assert.equal(reset.mem.read8(recordBase & 0xffff), 0x00, "oracle must clear the state byte on reset");
  }

  console.log(`  EQUAL/exhaustive: ${count} crafted (record, countdown, position) combos — RAM identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** BUG (a): reloads the countdown to 0x03 instead of 0x02. */
function brokenWrongReload(m, recordBase) {
  const { mem } = m;
  const field = (n) => (recordBase & 0xff00) | ((recordBase + n) & 0xff);
  const countdown = (mem.read8(field(4)) - 1) & 0xff;
  mem.write8(field(4), countdown);
  if (countdown !== 0) return;
  mem.write8(field(4), 0x03); // BUG: should reload 0x02
  const position = (mem.read8(field(3)) - 1) & 0xff;
  mem.write8(field(3), position);
  publish50mObjectYToSprite(m, field(3));
  if (position !== 0x68) return;
  mem.write8(field(1), 0x80);
  mem.write8(field(0), 0x00);
}

/** BUG (b): steps the position +3 UP instead of DOWN. */
function brokenCounterUp(m, recordBase) {
  const { mem } = m;
  const field = (n) => (recordBase & 0xff00) | ((recordBase + n) & 0xff);
  const countdown = (mem.read8(field(4)) - 1) & 0xff;
  mem.write8(field(4), countdown);
  if (countdown !== 0) return;
  mem.write8(field(4), 0x02);
  const position = (mem.read8(field(3)) + 1) & 0xff; // BUG: +1 instead of -1
  mem.write8(field(3), position);
  publish50mObjectYToSprite(m, field(3));
  if (position !== 0x68) return;
  mem.write8(field(1), 0x80);
  mem.write8(field(0), 0x00);
}

/** BUG (c): drops the field +1 = 0x80 write on the reset. */
function brokenDroppedReset(m, recordBase) {
  const { mem } = m;
  const field = (n) => (recordBase & 0xff00) | ((recordBase + n) & 0xff);
  const countdown = (mem.read8(field(4)) - 1) & 0xff;
  mem.write8(field(4), countdown);
  if (countdown !== 0) return;
  mem.write8(field(4), 0x02);
  const position = (mem.read8(field(3)) - 1) & 0xff;
  mem.write8(field(3), position);
  publish50mObjectYToSprite(m, field(3));
  if (position !== 0x68) return;
  // BUG: field(1) = 0x80 write dropped
  mem.write8(field(0), 0x00);
}

test("TEETH: the wrong-reload twin is CAUGHT", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenWrongReload);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong countdown reload — worthless");
  console.log(`  TEETH/reload: caught — ${describeMismatch(mismatch)}`);
});

test("TEETH: the counter-goes-up twin is CAUGHT", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenCounterUp);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted position step — worthless");
  console.log(`  TEETH/counter: caught — ${describeMismatch(mismatch)}`);
});

test("TEETH: the dropped-reset twin is CAUGHT", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenDroppedReset);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped reset write — worthless");
  assert.equal((mismatch.ram.addr - 1) & 0xffff, mismatch.recordBase & 0xffff, "the dropped-reset diff must land on field +1");
  console.log(`  TEETH/reset: caught — ${describeMismatch(mismatch)}`);
});

// -- 3. REALISM (natural dispatches) ------------------------------------------

test("REALISM: 0x22A2 attract dispatches match the oracle (attract never reaches it)", () => {
  let count = 0;
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    count++;
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  for (const cap of caps) {
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    a.nextNmi = Infinity; a.nextBoundary = Infinity;
    b.nextNmi = Infinity; b.nextBoundary = Infinity;
    const recordBase = b.mem.read8(b.regs.sp) | (b.mem.read8((b.regs.sp + 1) & 0xffff) << 8);
    oracle(a);
    raise50mObjectAndPark(b, recordBase);
    const ram = firstRamDiff(a, b, cap.regs.sp + POPPED_ARG);
    assert.equal(ram, null, ram && `real dispatch diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} cand=${ram.b})`);
  }

  console.log(
    `  REALISM: ${count} natural 0x22A2 dispatches in 2000 attract frames` +
      (count === 0
        ? " (none — dispatch50mObjectState's board gate is closed in attract; the exhaustive crafted sweep covers the full observable space)"
        : " (all matched the oracle)"),
  );
});
