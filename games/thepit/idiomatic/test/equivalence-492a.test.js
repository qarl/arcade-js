// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawCopyrightLine (ROM 0x492a) — the screen-column painter.
 *
 * drawCopyrightLine lays a fixed 32-tile column into video RAM from a ROM strip, then hands to
 * the pure-leaf fillColourColumnAt to colour that column. It WRITES memory (the column
 * + the colour column), and that memory is its only live-out. The idiomatic routine was
 * dissolved — it calls the leaf directly instead of the oracle's tail hand-off through
 * loc_3e1d — so it drops the fill's net return and ends one word above the oracle's SP,
 * with pc at its entry. Those are dead ABI, not live-out, so it is gated by MEMORY-
 * equivalence against the frozen oracle: the painted RAM byte-identical, EXCLUDING the
 * dead [SP-8, SP) stack-scratch window, and NEVER pc, SP, or the register file (the
 * oracle's leftover ROM-strip pointer is dead too — both successors, drawBestScoresTodayLabel and
 * drawRightEdgeColumn, reload it before reading). The whole-machine/pixel gate backstops it.
 *
 *   1. EQUAL (real dispatch) — boot the machine, hook 0x492a, and clone the machine
 *      at its single real dispatch (it fires once while the screen is drawn). Run the
 *      ORACLE on one clone and the idiomatic drawCopyrightLine on another, and prove the painted
 *      RAM is byte-identical outside the stack scratch. The routine is straight-line
 *      (one fixed-length loop, no branches), so that one entry covers the whole path.
 *
 *   2. NON-VACUOUS — the same run proves EQUAL is not passing on a no-op: the oracle
 *      actually changes the 32 painted column cells versus the captured entry state.
 *
 *   3. TEETH — a twin that reimplements the loop but corrupts every stored tile by one
 *      bit MUST be caught, in the painted column, by the RAM diff. A gate a real store
 *      bug slips through is worthless.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-492a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_492a as oracle } from "../../translated/loc_492a.js";
import { drawCopyrightLine as idiomatic } from "../drawCopyrightLine.js";
import { makeMachineFactory } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x492a;

// The 32 painted column cells: bottom at 0x93f9, one full text row (32 cells) up
// per tile, to the top cell 0x9019.
const COLUMN_BOTTOM = 0x93f9;
const COLUMN_TOP = 0x9019;
const ROW = 32;
const paintedCells = Array.from({ length: 32 }, (_, i) => COLUMN_BOTTOM - i * ROW);
const isPaintedCell = (a) => a >= COLUMN_TOP && a <= COLUMN_BOTTOM && (COLUMN_BOTTOM - a) % ROW === 0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

const STACK_SCRATCH = 8; // dead return-address / helper-scratch window just below the entry SP

/** First game-visible RAM difference, EXCLUDING the dead [entrySP-8, entrySP) stack-scratch window (the
 *  dropped tail return-address ghost lives there and legitimately differs). Null when otherwise identical. */
function ramDiff(a, b, entrySP) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Boot the machine, hook 0x492a, and clone it at its first real dispatch; the wrapper then runs the
 *  oracle so the host boot proceeds undisturbed to a clean stop. */
function captureEntry(maxFrames) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  makeMachine(snap).runFrames(maxFrames);
  return entry;
}

/** Replay one entry state through the oracle and a candidate on independent fresh
 *  clones (the routine writes RAM), returning the diff + both post-run machines. */
function replay(entry, candidate) {
  const entrySP = entry.regs.sp;
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, bad: ramDiff(a, b, entrySP) };
}

test("EQUAL: idiomatic drawCopyrightLine == oracle on the real dispatch (painted RAM)", () => {
  const entry = captureEntry(120);
  assert.ok(entry, "expected a real 0x492a dispatch during boot");

  const { a, bad } = replay(entry, idiomatic);
  assert.equal(
    bad,
    null,
    bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
  );
  // pc, SP, and the register file are the dissolved routine's dead ABI (the leaf fill
  // performs no net return), so they are not compared — only the painted RAM is.

  // NON-VACUOUS: the oracle actually painted the column — at least one cell changed
  // from the captured entry state, so EQUAL is not passing on a no-op.
  const changed = paintedCells.some((addr) => a.mem.read8(addr) !== entry.mem.read8(addr));
  assert.ok(changed, "expected the painted column to differ from the entry state (non-vacuous)");

  console.log(
    `  EQUAL: 1 real dispatch — painted RAM byte-identical outside the stack scratch; ` +
      `${paintedCells.filter((addr) => a.mem.read8(addr) !== entry.mem.read8(addr)).length}/32 cells painted`,
  );
});

/** Broken twin: reimplements drawCopyrightLine faithfully but corrupts every stored tile by
 *  one bit — a plausible store-path bug the RAM diff MUST catch in the column. */
function brokenLoc492a(m) {
  const { mem, regs } = m;
  for (let i = 0; i < 32; i++) {
    mem.write8(COLUMN_BOTTOM - i * ROW, mem.read8(0x49c7 + i) ^ 1); // BUG: corrupts the tile code
  }
  regs.c = 2;
  regs.a = 25;
  return m.call(0x3e1d);
}

test("TEETH: a corrupted column store is CAUGHT in the painted column", () => {
  const entry = captureEntry(120);
  assert.ok(entry, "need a real dispatch to test the teeth against");

  const { bad } = replay(entry, brokenLoc492a);
  assert.notEqual(bad, null, "the gate FAILED to catch a corrupted column store — it is worthless");
  assert.ok(
    isPaintedCell(bad.addr),
    `expected the caught diff in the painted column, got ${hx(bad.addr)}`,
  );
  console.log(`  TEETH: corrupted store caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
