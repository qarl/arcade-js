// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stampFixedFrameAndResolveTile (ROM 0x186a) — the thin frame-prologue that stamps a
 * fixed animation frame code into the actor's sprite-frame byte and then hands off to the
 * shared position/tile tail resolveObjectTile.
 *
 * The routine's declared live-out is MEMORY-ONLY: the sprite-frame byte it writes plus
 * everything the shared tail writes. It has no live registers of its own, so the gate compares
 * RAM only (dumpState), never the Z80 pc/SP/register/cycle trace the idiomatic layer drops.
 *
 * THE STACK SCRATCH. stampFixedFrameAndResolveTile's own tail is now dissolved: where the frozen oracle hands off to
 * the shared tail through a stack-threaded jump, the idiomatic arm calls the already-idiomatic,
 * stack-free tail resolveObjectTile directly. The two therefore leave different dead bytes just below the
 * entry stack pointer (The Pit's stack is real diffed work RAM, entry SP ~0x83fd here) — classic
 * dead scratch the oracle's deeper call chain parks and the stack-free idiomatic never writes,
 * overwritten by the caller's next push before anything reads it. The diff excludes exactly that
 * [SP-8, SP) window and compares everything else byte-for-byte; the real outputs all sit far
 * below the stack (the sprite-frame byte 0x8069 plus the tail's 0x80xx/video-RAM writes), so the
 * window can never hide one — the teeth confirm it.
 *
 * A WRINKLE THE TEETH HANDLE. The frame the routine stamps is a DEFAULT: on almost every tile
 * the tail's classifier recomputes the actor frame and overwrites 0x8069, so the stamp is dead
 * (memory-equivalent whatever value it held). Across a full attract run the stamp survives on
 * exactly 1 of ~521 dispatches — the state where the tile routes past the classifier. So the
 * gate takes teeth from two directions: a twin that skips the tail hand-off entirely (caught by
 * the tail's own writes, which fire on every entry), and a wrong-frame twin replayed on that one
 * real captured state where the stamp survives (caught at the sprite-frame byte).
 *
 * The entries are REAL: 0x186a is dispatched by the movement/state dispatcher during the attract
 * demo, so the gate captures those live states via the registry hook and replays each in
 * isolation — no crafting required, including the survive-state used for the frame teeth.
 *
 * Four checks:
 *   0. HARNESS  — capture real 0x186a dispatches from attract; confirm the oracle run is
 *      deterministic (oracle vs oracle over one entry -> identical RAM).
 *   1. EQUAL    — stampFixedFrameAndResolveTile == oracle over RAM across every captured entry; and on the one entry
 *      where the stamp survives, the idiomatic run leaves the chosen frame code (52).
 *   2. TEETH    — a twin that skips the shared-tail hand-off is CAUGHT (the tail's writes are
 *      missing), proving the delegation half of the routine is under the gate.
 *   3. TEETH    — a wrong-frame twin (stamps 53), replayed on the real survive-state, is CAUGHT
 *      at the sprite-frame byte, proving the stamp half is under the gate where it is observable.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-186a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_186a as oracle } from "../../translated/loc_186a.js";
import { stampFixedFrameAndResolveTile as idiomatic } from "../stampFixedFrameAndResolveTile.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { PLAYER_FACING } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x186a;
const TAIL = 0x186f; // the shared position/tile tail stampFixedFrameAndResolveTile hands off to (still the oracle)
const STACK_SCRATCH = 8; // dead bytes the oracle's stack-threaded tail hand-off parks just below
// entry SP (the diff at entry 212 sits at SP-6, 0x83f7..0x83fc); the idiomatic tail is stack-free
const FRAME_CODE = 52; // 0x34 — the fixed animation frame this prologue stamps
const WRONG_FRAME = 53; // a deliberately-wrong frame for the payload teeth
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so
// build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Run attract with 0x186a hooked; clone the machine at every real dispatch (a genuine mid-demo state each).
 *  The wrapper always runs the oracle so the demo proceeds undisturbed. */
function captureRealEntries(maxFrames) {
  const entries = [];
  const snapshot = new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return entries;
}

/** First differing RAM byte between two machines, EXCLUDING the dead stack scratch the oracle's stack-threaded tail
 *  hand-off parks just below the entry stack pointer (which the stack-free idiomatic tail resolveObjectTile does not
 *  reproduce). Null when otherwise identical. */
function stateDiffOutsideStack(o, c, entrySP) {
  const da = o.dumpState();
  const db = c.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = o.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Replay one captured entry through the oracle and through `fn` on two independent clones and return the first
 *  differing RAM byte OUTSIDE the dead stack scratch [entrySP-8, entrySP) (null == memory-equivalent). */
function ramDiff(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  return stateDiffOutsideStack(o, c, sp);
}

/** Find the captured entry whose final RAM DEPENDS on the stamped frame (the tile routes past the classifier, so the
 *  stamp survives): vary the stamped byte and see the full-RAM result move. Null if none in the window. */
function findFrameSurviveEntry(entries) {
  for (const entry of entries) {
    const a = entry.clone();
    a.mem.write8(PLAYER_FACING, FRAME_CODE);
    a.call(TAIL);
    const b = entry.clone();
    b.mem.write8(PLAYER_FACING, FRAME_CODE ^ 0x40);
    b.call(TAIL);
    if (firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off))) return entry;
  }
  return null;
}

test("HARNESS: real 0x186a dispatches are captured from attract and the oracle run is deterministic", () => {
  const entries = captureRealEntries(6000);
  assert.ok(entries.length > 0, "expected 0x186a to be dispatched during attract");

  const a = entries[0].clone();
  oracle(a);
  const b = entries[0].clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  console.log(
    `  HARNESS: captured ${entries.length} real 0x186a entries ` +
      `(first: PLAYER_FACING=${hx(entries[0].mem.read8(PLAYER_FACING))}); oracle run deterministic`,
  );
});

test("EQUAL: stampFixedFrameAndResolveTile == oracle over RAM on every captured attract entry", () => {
  const entries = captureRealEntries(6000);
  assert.ok(entries.length > 0, "need captured 0x186a entries");

  for (let i = 0; i < entries.length; i++) {
    const d = ramDiff(entries[i], idiomatic);
    assert.equal(
      d,
      null,
      d && `entry ${i}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} cand=${d.b}`,
    );
  }

  // Positive check on the one state where the stamp survives the tail: the idiomatic run leaves
  // the chosen frame code in the sprite-frame byte (elsewhere the classifier overwrites it, so a
  // blanket "== 52" would be wrong — that is the whole point of the survive-state).
  const survive = findFrameSurviveEntry(entries);
  assert.ok(survive, "expected one attract dispatch whose stamped frame survives the tail");
  const c = survive.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(PLAYER_FACING), FRAME_CODE, "survive-state: sprite-frame byte not left at the chosen frame");

  console.log(`  EQUAL: ${entries.length} real entries all memory-equivalent; survive-state frame -> ${hx(FRAME_CODE)}`);
});

/** Broken twin: stamps the frame but forgets to hand off to the shared tail. */
function twinNoTail(m) {
  const { mem8 } = m;
  mem8[PLAYER_FACING] = FRAME_CODE;
  // BUG: no `return m.call(0x186f)` — the whole cell-rebuild / tile-read / classify is skipped.
}

test("TEETH (no tail): a twin that skips the shared-tail hand-off is CAUGHT by the tail's writes", () => {
  const entries = captureRealEntries(6000);
  assert.ok(entries.length > 0, "need a captured 0x186a entry to seed the teeth check");

  const d = ramDiff(entries[0], twinNoTail);
  assert.notEqual(d, null, "the gate FAILED to catch the missing-tail twin — it proves nothing");
  console.log(`  TEETH/tail: missing-tail twin caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: stamps the WRONG frame code, then the same shared-tail hand-off. */
function twinWrongFrame(m) {
  const { mem8 } = m;
  mem8[PLAYER_FACING] = WRONG_FRAME; // BUG: wrong animation frame code (should be 52)
  return m.call(TAIL);
}

test("TEETH (wrong frame): a wrong-frame twin is CAUGHT at the sprite-frame byte on the survive-state", () => {
  const entries = captureRealEntries(6000);
  const survive = findFrameSurviveEntry(entries);
  assert.ok(survive, "need the real survive-state (a dispatch whose stamped frame is not overwritten)");

  const d = ramDiff(survive, twinWrongFrame);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong-frame twin — it proves nothing");
  assert.equal(
    d.addr,
    PLAYER_FACING,
    `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_FACING)})`,
  );
  console.log(`  TEETH/frame: wrong-frame twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
