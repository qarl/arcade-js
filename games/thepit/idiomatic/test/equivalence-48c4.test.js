// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for cyclePanelColumnColour (ROM 0x48c4, The Pit) — the nine-cell
 * colour-RAM column recolour that cycles its colour one step per call.
 *
 * The routine seats the fill length / colour / target cell, then drives three cell
 * helpers — rowColToTileOffset (0x3dae), deriveTileWriteCursors (0x3dc9) and the
 * column fill fillColourColumn (0x3e01) — all already decompiled in idiomatic/. The
 * idiomatic rewrite calls them DIRECTLY (a plain JS call), where the oracle reached
 * them through the real Z80 stack: it pushed a literal return address before each of
 * the first two helper calls and tail-jumped into the fill, whose own `ret` unwound
 * to cyclePanelColumnColour's caller.
 *
 * Because the direct calls have no Z80 stack frame, the idiomatic routine no longer
 * pushes those return addresses, no longer advances SP, and no longer rets — so pc,
 * SP, the value registers, and the dead return-address scratch just below the entry
 * stack pointer all legitimately differ from the oracle. The routine's DECLARED
 * live-out is memory-only (the recoloured colour-RAM column), so this gate compares
 * OBSERVABLE equivalence: the work / colour RAM the routine actually affects, plus pc
 * and SP, EXCLUDING the dead stack-scratch window [SP-2, SP) and the value registers.
 * To line pc + SP up with the oracle (which rets internally via the tail fill), the
 * candidate is followed by one m.ret() modelling that same tail return.
 *
 * The oracle's only stack traffic is one 2-byte return-address slot at [SP-2, SP),
 * reused by both helper pushes (the three callees push nothing and end in `ret`), so
 * the excluded window is exactly two bytes.
 *
 * The routine is dispatched from the dig / wall-collision core (loc_03e8) during the
 * ordinary boot/attract run, so entries are CAPTURED from that run, never constructed.
 *
 *   0. HARNESS  — capture a real dispatch and confirm the oracle run is deterministic
 *                 (oracle vs oracle -> identical whole state + pc). Proves the plumbing.
 *   1. EQUAL    — idiomatic vs oracle over the observable contract (RAM outside the
 *                 stack scratch + pc + SP), from the first real captured dispatch, and
 *                 the seated inputs + painted column hold the expected values.
 *   2. NON-VACUOUS — the oracle really does the work (fill length 9, target column 6 /
 *                 row 10, colour advanced with bit 3 held clear, the colour painted down
 *                 the column) AND the excluded window genuinely holds the oracle's dead
 *                 return-address scratch that the idiomatic routine does not reproduce —
 *                 so the exclusion is load-bearing, not vacuous.
 *   3. TEETH    — a twin that drops the colour advance MUST be caught, naming BOARD_MODE.
 *   4. REALISM  — replay every real dispatch over a longer run; observable-equal to the
 *                 oracle on each.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-48c4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_48c4 as oracle } from "../../translated/loc_48c4.js";
import { cyclePanelColumnColour as idiomatic } from "../cyclePanelColumnColour.js";
import { rowColToTileOffset } from "../rowColToTileOffset.js";
import { deriveTileWriteCursors } from "../deriveTileWriteCursors.js";
import { fillColourColumn } from "../fillColourColumn.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { BOARD_MODE, TILE_COL, TILE_ROW } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x48c4;
// cyclePanelColumnColour is dispatched from the dig core only once the attract DEMO is playing —
// first entry lands near frame 695 (well past the title), so every capture/gate run
// needs a budget that reaches the demo.
const REACH_FRAMES = 820;
const FILL_LENGTH = 0x8055; // nine-cell count the column fill reads (unnamed in names.js)
const COLOR_RAM_BASE = 0x8800; // colour-RAM base the address-derive helper adds
const CELL_OFFSET = 32 * 10 + 6; // row 10, column 6 -> tilemap offset (32-wide stride)
const COLOR_CELL = COLOR_RAM_BASE + CELL_OFFSET; // top of the painted column, in colour RAM
const COLUMN_STRIDE = 32; // one row down the colour-RAM column
// The oracle reuses one 2-byte return-address slot at [SP-2, SP) for both helper
// pushes; the direct-call idiomatic routine leaves it untouched, so it is excluded.
const STACK_SCRATCH = 2;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Hook 0x48c4 over a boot/attract run and clone the machine at up to K real dispatches. */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(maxFrames);
  assert.equal(host.stoppedBy, null, "attract capture run must reach the vblank spin cleanly");
  return caps;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * window [entrySP-STACK_SCRATCH, entrySP) the oracle's helper pushes park just below
 * the entry stack pointer (which the direct-call idiomatic routine does not reproduce).
 * Null when otherwise identical.
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
 * Compare a candidate against the oracle over the observable contract for one entry:
 * RAM (outside the stack scratch) + pc + SP. Value registers are the declared-dead
 * live-out and excluded. The oracle rets internally through the tail fill; the
 * candidate — which makes plain JS calls and never rets — models that tail return with
 * one m.ret() so pc + SP line up. Returns { diffs, ram } (diffs empty == EQUAL).
 */
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

test("HARNESS: a real 0x48c4 dispatch is captured and the oracle run is deterministic", () => {
  const [entry] = captureEntries(1, REACH_FRAMES);
  assert.ok(entry, "attract must dispatch 0x48c4 at least once");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(`  HARNESS: captured a real 0x48c4 entry (SP=${hx(entry.regs.sp)}); oracle run deterministic`);
});

test("EQUAL: idiomatic cyclePanelColumnColour == oracle over RAM (outside stack scratch) + pc + SP", () => {
  const [entry] = captureEntries(1, REACH_FRAMES);
  assert.ok(entry, "attract must dispatch 0x48c4 at least once");
  const colorBefore = entry.mem.read8(BOARD_MODE);

  const { diffs } = contractDiffs(entry, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive checks: the idiomatic routine really seats the inputs and paints the column.
  const c = entry.clone();
  idiomatic(c);
  const colorAfter = (colorBefore + 1) & 0xf7;
  assert.equal(c.mem.read8(FILL_LENGTH), 9, "idiomatic must seat the nine-cell fill length");
  assert.equal(c.mem.read8(TILE_COL), 6, "idiomatic must aim at column 6");
  assert.equal(c.mem.read8(TILE_ROW), 10, "idiomatic must aim at row 10");
  assert.equal(c.mem.read8(BOARD_MODE), colorAfter, "idiomatic must advance the colour with bit 3 held clear");
  assert.equal(c.mem.read8(COLOR_CELL), colorAfter, "idiomatic must paint the colour at the top of the column");
  assert.equal(c.mem.read8(COLOR_CELL + 8 * COLUMN_STRIDE), colorAfter, "idiomatic must paint all nine cells");
  console.log(`  EQUAL: identical over RAM+pc+SP; colour ${colorBefore} -> ${colorAfter}, nine cells painted`);
});

test("NON-VACUOUS: the oracle really recolours the column, and the excluded window is its dead scratch", () => {
  const [entry] = captureEntries(1, REACH_FRAMES);
  assert.ok(entry, "attract must dispatch 0x48c4 at least once");

  const sp = entry.regs.sp;
  assert.ok(sp >= 0x8000 && sp < 0x8800, `entry SP must sit in diffed work RAM (SP=${hx(sp)})`);
  const colorBefore = entry.mem.read8(BOARD_MODE);

  const a = entry.clone();
  oracle(a);

  // The seated inputs and the advanced colour.
  assert.equal(a.mem.read8(FILL_LENGTH), 9, "oracle must seat the nine-cell fill length");
  assert.equal(a.mem.read8(TILE_COL), 6, "oracle must aim at column 6");
  assert.equal(a.mem.read8(TILE_ROW), 10, "oracle must aim at row 10");
  const colorAfter = (colorBefore + 1) & 0xf7;
  assert.equal(a.mem.read8(BOARD_MODE), colorAfter, "oracle must advance the colour with bit 3 held clear");
  assert.equal((a.mem.read8(BOARD_MODE) & 0x08), 0, "the advanced colour never sets bit 3");

  // The column was actually painted: the top cell and the ninth cell both hold the colour.
  assert.equal(a.mem.read8(COLOR_CELL), colorAfter, "oracle must paint the colour at the top of the column");
  assert.equal(a.mem.read8(COLOR_CELL + 8 * COLUMN_STRIDE), colorAfter, "oracle must paint all nine cells down the column");

  // The excluded window genuinely holds the oracle's dead helper-return scratch (the
  // last of the two reused pushes, 0x48e2), which the direct-call idiomatic routine does
  // NOT reproduce — so excluding [SP-2, SP) is load-bearing, not vacuous.
  assert.equal(a.mem.read16(sp - STACK_SCRATCH), 0x48e2, "the excluded window must hold the oracle's dead return-address scratch");
  const b = entry.clone();
  idiomatic(b);
  b.ret();
  assert.notEqual(
    a.mem.read16(sp - STACK_SCRATCH),
    b.mem.read16(sp - STACK_SCRATCH),
    "the idiomatic routine must NOT reproduce that dead scratch — else the exclusion proves nothing",
  );
  console.log(`  NON-VACUOUS: colour ${colorBefore} -> ${colorAfter}, nine cells painted; [SP-2,SP) is dead oracle scratch (0x48e2)`);
});

/** Broken twin: everything faithful EXCEPT it never advances the colour, so it paints
 *  (and stores back) the un-bumped colour. The only observable divergence is the colour
 *  byte and the cells it paints — the gate must catch it, first at BOARD_MODE. */
function brokenNoAdvance(m) {
  const { mem } = m;
  mem.write8(FILL_LENGTH, 9);
  const color = mem.read8(BOARD_MODE);
  mem.write8(BOARD_MODE, color); // BUG: colour not advanced
  mem.write8(TILE_COL, 6);
  mem.write8(TILE_ROW, 10);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  return fillColourColumn(m);
}

test("TEETH: a twin that drops the colour advance is CAUGHT, naming BOARD_MODE", () => {
  const [entry] = captureEntries(1, REACH_FRAMES);
  assert.ok(entry, "attract must dispatch 0x48c4 at least once");

  const { diffs, ram } = contractDiffs(entry, brokenNoAdvance);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a dropped colour advance — it is worthless");
  assert.equal(
    ram && ram.addr,
    BOARD_MODE,
    `expected the caught diff at BOARD_MODE (0x8057), got ${ram ? hx(ram.addr) : "(none)"}`,
  );
  console.log(`  TEETH: dropped colour advance caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("REALISM: replay every real 0x48c4 dispatch — observable-equal to the oracle", () => {
  const caps = captureEntries(16, 1300);
  assert.ok(caps.length >= 1, "expected at least one real 0x48c4 dispatch in the run");
  for (const entry of caps) {
    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  REALISM: ${caps.length} real 0x48c4 dispatch(es) — observable-equal to the oracle`);
});
