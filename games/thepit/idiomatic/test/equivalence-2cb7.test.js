// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for captureTargetOnOverlap (ROM 0x2cb7) — the per-frame
 * handler for the timed dig target the tracked object is closing on. It clears the
 * shared overlap gate (MOVE_BLOCK_FLAG), advances the target's countdown (DIG_OBJ_TIMER),
 * and on expiry — if the target is not already captured — tests whether the tracked
 * object (PLAYER_Y/PLAYER_X) sits in a small capture box near the target (HAZARD_X/HAZARD_Y).
 * Inside the box it snaps PLAYER_Y onto the target's near edge, raises the captured flag
 * (DIG_COLLISION_STATE), plays the capture sound (requestSound20), and hands off to the
 * record builder (stageDigObjectSpriteRecord, 0x2bd3). Otherwise it delegates to one of
 * the reload / overlap-record / advance tails (stampGlyphColumn 0x2d6b, flagObjectTargetOverlap 0x2c91,
 * advanceDigTarget 0x2d06).
 *
 * CONTRACT. The routine has NO register live-ins — every input is read from RAM — and
 * every hand-off is delegated to an idiomatic callee that is memory-equivalent to its
 * oracle but returns via plain JS instead of the Z80 stack dance. So the gate is a
 * RAM-only diff via dumpState: pc/SP and value-registers are the dead Z80 trace and are
 * NOT compared (the idiomatic tails deliberately do not reproduce them), and the
 * stack scratch below the entry SP is excluded for the same reason (nothing
 * this routine touches lives there — its writes are all at 0x8068/0x8080/0x80b1/0x80c1
 * and the delegated record/video writes, far below the stack).
 *
 * REACHABILITY. 0x2cb7 IS dispatched during attract (~119 dispatches / 3000 frames, entry
 * SP≈0x83fd), so the entry is captured live via the dispatch/​m.call override hook. The
 * natural dispatch never aligns for a capture, so the capture arm — and the exact path
 * each branch takes — is driven by poking the countdown / captured / window bytes
 * identically on both sides (the crafted-entry method).
 *
 * Checks:
 *   0. HARNESS — capture a real 0x2cb7 entry; the oracle run is deterministic (oracle vs
 *      oracle over the whole state is identical). Proves the capture/clone plumbing
 *      reaches a real state and the delegated tails are stable.
 *   1. EQUAL (real entry) — captureTargetOnOverlap == oracle over RAM (minus dead stack
 *      scratch) on the natural captured inputs.
 *   2. EQUAL (every path) — crafted inputs that take each branch (reload, still-running,
 *      already-captured, the four window misses, and a real capture), each identical to
 *      the oracle, plus positive checks that a capture snapped PLAYER_Y, raised the flag,
 *      and queued the capture sound.
 *   3. EQUAL (window sweep) — on the expiry+not-captured path, exhaustive over the row
 *      axis (incl. the +10/+13 wrap) and over the column axis at boundary target columns
 *      (incl. the ±4 wrap); PLAYER_Y / DIG_COLLISION_STATE cross-checked against a
 *      from-first-principles predictor each time.
 *   4. TEETH — a genuine logic twin (column box one pixel too wide → spurious capture) is
 *      CAUGHT at PLAYER_Y; and post-hoc corruptions of the captured flag and the overlap gate
 *      are each CAUGHT at their address (the gate sees every live-out of this routine).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2cb7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cb7 as oracle } from "../../translated/loc_2cb7.js";
import { captureTargetOnOverlap as idiomatic } from "../captureTargetOnOverlap.js";
import { makeMachineFactory } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import { requestSound20 } from "../requestSound20.js";
import { advanceDigTarget } from "../advanceDigTarget.js";
import { stageDigObjectSpriteRecord } from "../stageDigObjectSpriteRecord.js";
import {
  MOVE_BLOCK_FLAG,
  DIG_OBJ_TIMER,
  DIG_COLLISION_STATE,
  PLAYER_Y,
  PLAYER_X,
  HAZARD_X,
  HAZARD_Y,
  SOUND_HEAD,
  SOUND_RING,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x2cb7;
const RELOAD_SENTINEL = 64; // countdown value that hands off to the stamp/reset path
const SOUND_CAPTURE = 20; // command requestSound20 queues on a capture
// Stack window at the top of The Pit's work RAM; only the part below the entry SP is dead scratch.
// The delegated tails use it identically on both arms; nothing 0x2cb7 writes lives here.
const STACK_LO = 0x8380;
const STACK_HI = 0x8400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/**
 * Hook 0x2cb7 in a real attract run and clone the machine at its first entry — a genuine
 * dig-target state (valid stack with a return address, live object/target/pointer bytes).
 * The wrapper snapshots then runs the oracle so attract proceeds.
 */
function captureRealEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return entry;
}

/**
 * First differing RAM byte between two machines, EXCLUDING stack scratch below the entry SP.
 * Null when otherwise identical.
 */
function ramDiffExStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Clone `entry` and write whichever decision bytes the spec supplies (others left as captured). */
function seed(entry, s = {}) {
  const e = entry.clone();
  const w = (addr, v) => { if (v !== undefined) e.mem.write8(addr, v); };
  w(MOVE_BLOCK_FLAG, s.gate);
  w(DIG_OBJ_TIMER, s.timer);
  w(DIG_COLLISION_STATE, s.arm);
  w(PLAYER_X, s.objRow);
  w(HAZARD_Y, s.targetRow);
  w(PLAYER_Y, s.objCol);
  w(HAZARD_X, s.targetCol);
  return e;
}

/** Run oracle vs `fn` on identical clones of a seeded state; return the RAM diff + both machines. */
function compare(entry, s, fn) {
  const base = seed(entry, s);
  const o = base.clone();
  oracle(o);
  const c = base.clone();
  fn(c);
  return { ram: ramDiffExStack(o, c, base.regs.sp), o, c };
}

/**
 * The routine's outcome, re-derived from first principles (independent of the routine):
 * which tail it takes, and — for a capture — the value PLAYER_Y is snapped to. The capture
 * box is 11..13 rows below the target and up to 4 columns right of it.
 */
function expectedOutcome({ timer, arm, objRow, targetRow, objCol, targetCol }) {
  if (timer === RELOAD_SENTINEL) return { path: "reload" };
  if (u8(timer - 1) !== 0) return { path: "running" };
  if (arm !== 0) return { path: "advance" }; // already captured
  if (u8(targetRow + 10) >= objRow) return { path: "advance" };
  if (u8(targetRow + 13) < objRow) return { path: "advance" };
  if (u8(targetCol - 4) >= objCol) return { path: "advance" };
  const snap = u8(targetCol + 4);
  if (snap < objCol) return { path: "advance" };
  return { path: "capture", snap };
}

// -- 0. HARNESS ---------------------------------------------------------------

test("HARNESS: a real 0x2cb7 entry is captured and the oracle run is deterministic", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "expected 0x2cb7 to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  assert.equal(ramDiffExStack(a, b, entry.regs.sp), null, "oracle run of 0x2cb7 is not deterministic");
  console.log(
    `  HARNESS: captured a real 0x2cb7 entry (SP=${hx(entry.regs.sp)}); ` +
      `DIG_OBJ_TIMER=${entry.mem.read8(DIG_OBJ_TIMER)} DIG_COLLISION_STATE=${entry.mem.read8(DIG_COLLISION_STATE)}; ` +
      "oracle deterministic",
  );
});

// -- 1. EQUAL on the real captured entry --------------------------------------

test("EQUAL (real entry): captureTargetOnOverlap == oracle over RAM (minus stack scratch below the entry SP)", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2cb7 entry");

  const { ram } = compare(entry, {}, idiomatic);
  assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  console.log("  EQUAL/real: identical over RAM on the natural captured inputs");
});

// -- 2. EQUAL over every branch, with positive checks -------------------------

test("EQUAL (every path): reload / running / already-captured / window-miss / capture all match", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2cb7 entry");

  // Aligned capture box: targetRow=100 -> rows 111..113 overlap; targetCol=100 -> columns
  // 97..104 overlap, snapping PLAYER_Y to 104.
  const cases = [
    { name: "reload sentinel", s: { timer: RELOAD_SENTINEL } },
    { name: "still running (timer decrements, nonzero)", s: { timer: 5 } },
    { name: "already captured", s: { timer: 1, arm: 1, objRow: 112, targetRow: 100, objCol: 100, targetCol: 100 } },
    { name: "miss: row short (at lower edge)", s: { timer: 1, arm: 0, objRow: 110, targetRow: 100, objCol: 100, targetCol: 100 } },
    { name: "miss: row past (one above)", s: { timer: 1, arm: 0, objRow: 114, targetRow: 100, objCol: 100, targetCol: 100 } },
    { name: "miss: column short (at left edge)", s: { timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol: 96, targetCol: 100 } },
    { name: "miss: column past (one past +4)", s: { timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol: 105, targetCol: 100 } },
    { name: "CAPTURE (inside the box)", s: { timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol: 101, targetCol: 100 } },
  ];

  for (const { name, s } of cases) {
    const { ram } = compare(entry, s, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  }

  // Positive checks on the capture arm: PLAYER_Y snapped to the near edge, flag raised,
  // capture sound queued into the ring, gate cleared.
  const capSpec = { gate: 0x77, timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol: 101, targetCol: 100 };
  const base = seed(entry, capSpec);
  const head = base.mem.read8(SOUND_HEAD);
  const c = base.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(PLAYER_Y), 104, "capture must snap PLAYER_Y to the target's near edge (targetCol+4)");
  assert.equal(c.mem.read8(DIG_COLLISION_STATE), 1, "capture must raise the captured flag");
  assert.equal(c.mem.read8(MOVE_BLOCK_FLAG), 0, "the overlap gate must be cleared");
  assert.equal(c.mem.read8(SOUND_RING + head), SOUND_CAPTURE | 0x80, "capture sound must be queued (pending) in the ring");
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, "sound ring write pointer must advance");
  console.log(`  EQUAL/paths: all ${cases.length} branches identical; capture snapped PLAYER_Y->104, flag=1, sound queued`);
});

// -- 3. EQUAL over the window sweep (expiry + not-captured) --------------------

test("EQUAL (window sweep): row axis + boundary column axis, incl. wraps, all match", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2cb7 entry");

  let checked = 0;

  // Row sweep: aligned columns (objCol=101, targetCol=100 -> in the ±4 band); for two
  // target rows (one normal, one whose +10/+13 window wraps) sweep the object row 0..255.
  for (const targetRow of [100, 248]) {
    for (let objRow = 0; objRow < 256; objRow++) {
      const s = { timer: 1, arm: 0, objRow, targetRow, objCol: 101, targetCol: 100 };
      const { ram, c } = compare(entry, s, idiomatic);
      assert.equal(ram, null, ram && `row-sweep targetRow=${targetRow} objRow=${objRow}: RAM diff at ${hx(ram.addr)}`);
      const exp = expectedOutcome(s);
      assert.equal(c.mem.read8(PLAYER_Y), exp.path === "capture" ? exp.snap : 101, `row-sweep objRow=${objRow}: PLAYER_Y`);
      assert.equal(c.mem.read8(DIG_COLLISION_STATE), exp.path === "capture" ? 1 : 0, `row-sweep objRow=${objRow}: flag`);
      checked++;
    }
  }

  // Column sweep: aligned rows (objRow=112, targetRow=100); at boundary/wrap target
  // columns sweep the object column 0..255 through the whole ±4 decision incl. the wrap.
  const targetCols = [0, 1, 2, 3, 4, 100, 128, 200, 251, 252, 253, 254, 255];
  for (const targetCol of targetCols) {
    for (let objCol = 0; objCol < 256; objCol++) {
      const s = { timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol, targetCol };
      const { ram, c } = compare(entry, s, idiomatic);
      assert.equal(ram, null, ram && `col-sweep targetCol=${targetCol} objCol=${objCol}: RAM diff at ${hx(ram.addr)}`);
      const exp = expectedOutcome(s);
      assert.equal(c.mem.read8(PLAYER_Y), exp.path === "capture" ? exp.snap : objCol, `col-sweep objCol=${objCol} targetCol=${targetCol}: PLAYER_Y`);
      assert.equal(c.mem.read8(DIG_COLLISION_STATE), exp.path === "capture" ? 1 : 0, `col-sweep objCol=${objCol} targetCol=${targetCol}: flag`);
      checked++;
    }
  }
  console.log(`  EQUAL/sweep: ${checked} crafted states identical to the oracle (row axis + boundary column axis, incl. wraps)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: the real routine, but the column box is one pixel too wide (+5), so it
 *  captures one column past where the oracle stops. Re-implemented faithfully apart from
 *  that single edge so the diff is the bug, not an unrelated deviation. */
function twinWideColumnBox(m) {
  const { mem8 } = m;
  mem8[MOVE_BLOCK_FLAG] = 0;
  const timer = mem8[DIG_OBJ_TIMER];
  if (timer === RELOAD_SENTINEL) return stampGlyphColumnUnused(m); // unreachable in the teeth inputs
  const ticked = timer - 1;
  mem8[DIG_OBJ_TIMER] = ticked;
  if (ticked !== 0) return advanceDigTarget(m); // unreachable in the teeth inputs
  mem8[DIG_OBJ_TIMER] = 1;
  if (mem8[DIG_COLLISION_STATE] !== 0) return advanceDigTarget(m);
  const objectRow = mem8[PLAYER_X];
  const targetRow = mem8[HAZARD_Y];
  if (u8(targetRow + 10) >= objectRow) return advanceDigTarget(m);
  if (u8(targetRow + 13) < objectRow) return advanceDigTarget(m);
  const objectCol = mem8[PLAYER_Y];
  const targetCol = mem8[HAZARD_X];
  if (u8(targetCol - 4) >= objectCol) return advanceDigTarget(m);
  const snapCol = u8(targetCol + 4);
  if (u8(targetCol + 5) < objectCol) return advanceDigTarget(m); // BUG: box one column too wide
  mem8[PLAYER_Y] = snapCol;
  mem8[DIG_COLLISION_STATE] = 1;
  requestSound20(m);
  return stageDigObjectSpriteRecord(m);
}
// Placeholder never reached by the teeth inputs (they all take the expiry path); kept so
// the twin is a total function.
function stampGlyphColumnUnused(m) { return advanceDigTarget(m); }

test("TEETH (too-wide column box): a spurious capture one column past the box is CAUGHT at PLAYER_Y", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2cb7 entry for the teeth check");

  // objCol = targetCol + 5: the oracle stops (miss, leaves PLAYER_Y = 105); the too-wide twin
  // captures and snaps PLAYER_Y to 104.
  const s = { timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol: 105, targetCol: 100 };
  assert.equal(expectedOutcome(s).path, "advance", "boundary sanity: oracle should not capture at +5");

  const { ram, o, c } = compare(entry, s, twinWideColumnBox);
  assert.ok(ram, "gate FAILED to catch the too-wide-box twin — it proves nothing");
  // The bug is a spurious capture: the oracle leaves the object where it was (no capture),
  // the twin snaps it onto the target and raises the flag. (The first byte the gate reports
  // is the phantom capture sound at the sound ring, a lower address than PLAYER_Y.)
  assert.equal(o.mem.read8(PLAYER_Y), 105, "oracle must NOT capture at +5 (object unmoved)");
  assert.equal(o.mem.read8(DIG_COLLISION_STATE), 0, "oracle must NOT raise the captured flag at +5");
  assert.equal(c.mem.read8(PLAYER_Y), 104, "twin spuriously snapped PLAYER_Y onto the target");
  assert.equal(c.mem.read8(DIG_COLLISION_STATE), 1, "twin spuriously raised the captured flag");
  console.log(`  TEETH/box: spurious capture caught (first at ${hx(ram.addr)}); oracle PLAYER_Y=105/flag=0 vs twin PLAYER_Y=104/flag=1`);

  // And the real routine must PASS the very input the twin fails.
  assert.equal(compare(entry, s, idiomatic).ram, null, "idiomatic must pass the input the twin fails");
});

test("TEETH (captured flag + overlap gate): dropping either write is CAUGHT at its address", () => {
  const entry = captureRealEntry(3000);
  assert.ok(entry, "need a captured 0x2cb7 entry for the teeth check");

  const capSpec = { gate: 0x77, timer: 1, arm: 0, objRow: 112, targetRow: 100, objCol: 101, targetCol: 100 };

  // Twin drops the captured-flag write.
  const { ram: armRam } = compare(entry, capSpec, (m) => { idiomatic(m); m.mem.write8(DIG_COLLISION_STATE, 0); });
  assert.ok(armRam, "gate FAILED to catch a dropped captured flag");
  assert.equal(armRam.addr, DIG_COLLISION_STATE, `teeth caught ${hx(armRam.addr)} (expected ${hx(DIG_COLLISION_STATE)})`);

  // Twin drops the overlap-gate clear (leaves it at the seeded sentinel 0x77).
  const { ram: gateRam } = compare(entry, capSpec, (m) => { idiomatic(m); m.mem.write8(MOVE_BLOCK_FLAG, 0x77); });
  assert.ok(gateRam, "gate FAILED to catch a dropped overlap-gate clear");
  assert.equal(gateRam.addr, MOVE_BLOCK_FLAG, `teeth caught ${hx(gateRam.addr)} (expected ${hx(MOVE_BLOCK_FLAG)})`);

  console.log(`  TEETH/live-outs: captured flag caught at ${hx(DIG_COLLISION_STATE)}, overlap gate at ${hx(MOVE_BLOCK_FLAG)}`);
});
