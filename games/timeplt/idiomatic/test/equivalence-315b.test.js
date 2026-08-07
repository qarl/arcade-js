// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_315b — memory-equivalent to the frozen oracle at ROM 0x315B.
 *
 * GATE: poked-natural dispatch with a negative control, judged by a hand-rolled comparison rather
 *   than unitEquivalence — because THE DESTINATION REFUSES TO RUN. 0x315B is three bytes,
 *   `jp 0x3176`, and 0x3176 is a data table: loc_30a5 loads it with `ld hl,0x3176` at ROM 0x30B6
 *   and indexes it with `rst 0x18`, copying eight bytes out of it into 0xAA31 upward. Its
 *   transcription is therefore a decode of DATA and throws on entry. Both arms of this gate throw,
 *   so unitEquivalence — which cannot catch — is replaced here by an explicit two-clone run.
 *
 * WHY A POKE IS NEEDED, AND WHAT IT IS. Two guards jump here, at 0x30E9 and 0x30F5, and both test
 *   sentinel bytes in work RAM: 0xACC7 against 0x3B and 0xACC8 against 0x05 or 0x10. Routine
 *   0x15FE plants that pair from an (address, value) table at ROM 0x163F, so on
 *   an untampered image both tests pass and this arm is dead. Reaching the guards at all also
 *   needs the era index at or above four, because 0x30E0 diverts a lower one to 0x3117. The poke
 *   is therefore two cells: ERA_INDEX held at four, and one sentinel byte zeroed.
 *
 * What it exercises, holes stated:
 *   1. NEGATIVE CONTROL, TWO OF THEM — era four with the sentinels INTACT dispatches 0x315B zero
 *      times, and so does the untouched attract run. Both asserted. Without them the poked arm
 *      would not show that the guard is what holds the arm shut.
 *   2. IDENTICAL REFUSAL — from one captured entry, oracle and rewrite each get a pristine clone;
 *      both must throw, with the same message, and the state dumps must be byte-identical
 *      afterwards, so neither wrote anything on the way. The message names the cycle it happened
 *      on and that one number is masked out, because cycles are the proxy this contract drops.
 *   3. TEETH — a no-op twin (does not throw at all), a twin that transfers to real code instead,
 *      and a twin that throws an error of its own. Each is caught.
 *
 * HOLE: this proves the rewrite arrives where the original arrives, and nothing more. It does not
 * execute the destination — the destination is not code — and it does not claim what a cabinet
 * does on arrival, where those bytes would be fetched as instructions.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-315b.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_315b } from "../loc_315b.js";
import { loc_315b as oracle } from "../../translated/loc_315b.js";
import { ERA_INDEX } from "../names.js";
import { firstStateDiff } from "../../../../core/equivalence.js";

const TARGET = 0x315b;

/** The sentinel the first guard tests, and the era value that reaches that guard at all. */
const SENTINEL = 0xacc7;
const ERA_THAT_REACHES_THE_GUARD = 4;
const POKE_FROM_FRAME = 260;

/** Real code, used only as a broken twin's destination. */
const SOMEWHERE_ELSE = 0x309b;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

const poke = (addr, val) => ({ addr, val, frame: POKE_FROM_FRAME, dur: null });

/** Undriven attract with the named pokes held from `POKE_FROM_FRAME` onward. */
function attract(pokes, overrides) {
  const m = makeMachine(overrides, { tape: [] });
  if (pokes.length) m.pokes = pokes;
  return m;
}

const ERA_ONLY = [poke(ERA_INDEX, ERA_THAT_REACHES_THE_GUARD)];
const ERA_AND_CORRUPT = [...ERA_ONLY, poke(SENTINEL, 0x00)];

/** Dispatch count plus, when it fires, a pristine clone of the first entry. */
function session(pokes) {
  let entry = null;
  let hits = 0;
  const m = attract(pokes, new Map([[TARGET, (mm) => {
    hits += 1;
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]));
  let threw = null;
  try {
    m.runFrames(ENTRY_FRAMES);
  } catch (e) {
    threw = e;
  }
  return { hits, entry, threw };
}

let captured = null;
function entryState() {
  if (captured === null) captured = session(ERA_AND_CORRUPT).entry;
  assert.notEqual(captured, null, "vacuous: the poked run never dispatched the routine");
  return captured;
}

/**
 * The refusal names the cycle it happened on, and CYCLES ARE OUTSIDE THE CONTRACT: the frozen
 * original charges for its jump and the rewrite charges nothing, so the two counts differ by
 * exactly that instruction. Masking the count is dropping the cycle proxy, not weakening the
 * comparison — every other word of the message still has to match.
 */
const withoutTheCycle = (s) => (s === null ? null : s.replace(/at cycle \d+/, "at cycle <dropped>"));

/** Run `fn` on a pristine clone; report what it threw and the state it left. */
function attempt(fn) {
  const m = entryState().clone();
  let message = null;
  try {
    fn(m);
  } catch (e) {
    message = withoutTheCycle(e.message);
  }
  return { message, dump: m.dumpState(), machine: m };
}

// ── the controls ────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: untouched attract never dispatches it", { skip: SKIP }, () => {
  const s = session([]);
  assert.equal(s.hits, 0, "an untampered attract run must not reach this arm");
  console.log("  CONTROL: zero dispatches with nothing poked");
});

test("NEGATIVE CONTROL: era four with the sentinels intact never dispatches it", { skip: SKIP }, () => {
  const s = session(ERA_ONLY);
  assert.equal(s.hits, 0, "reaching the guard is not enough — the guard must also fail");
  console.log("  CONTROL: zero dispatches with the era poked but the sentinel intact");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("DISPATCHED once the sentinel is corrupt", { skip: SKIP }, () => {
  const s = session(ERA_AND_CORRUPT);
  assert.ok(s.hits > 0, "the poked run must reach the arm, or every arm below is vacuous");
  assert.notEqual(s.entry, null, "an entry must have been captured");
  console.log(`  DISPATCHED: ${s.hits} time(s) with ${hex4(SENTINEL)} zeroed`);
});

test("IDENTICAL REFUSAL: both arms throw the same thing and neither writes", { skip: SKIP }, () => {
  const a = attempt(oracle);
  const b = attempt(loc_315b);
  assert.notEqual(a.message, null, "the frozen original must refuse to enter the data table");
  assert.equal(b.message, a.message, "the rewrite must refuse in exactly the same way");
  const d = firstStateDiff(a.dump, b.dump, (off) => a.machine.stateOffsetToAddr(off));
  assert.equal(d, null, `state diverged before the refusal — ${hex4(d?.addr ?? 0)}`);
  console.log(`  REFUSAL: both arms threw the same message; state identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: swallows the transfer, so nothing refuses. */
function brokenNoOp() {}

/** BUG: transfers into real code instead of the data table. */
function brokenElsewhere(m) {
  return m.call(SOMEWHERE_ELSE);
}

/** BUG: refuses, but for a reason of its own rather than by arriving where it should. */
function brokenOwnError() {
  throw new Error("a refusal this routine did not earn");
}

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["transfers-elsewhere", brokenElsewhere],
  ["invents-its-own-refusal", brokenOwnError],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip: SKIP }, () => {
    const a = attempt(oracle);
    const b = attempt(twin);
    const sameMessage = a.message === b.message;
    const d = firstStateDiff(a.dump, b.dump, (off) => a.machine.stateOffsetToAddr(off));
    assert.ok(!sameMessage || d !== null, `the gate PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught — message ${sameMessage ? "matched" : "differed"}, ` +
      `state ${d ? "differed at " + hex4(d.addr ?? 0) : "identical"}`);
  });
}
