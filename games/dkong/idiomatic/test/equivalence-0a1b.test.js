// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0a1b (ROM 0x0A1B) — the two-player board-setup step:
 * clear the palette bank, post two task-ring messages ([0x03,0x03] then [0x02,0x01]),
 * stamp player 2's "2UP" video marker, and advance GAME_SUBSTATE (0x600A) 4 -> 5.
 *
 * loc_0a1b WRITES memory (palette latches, task ring + tail, three video cells,
 * GAME_SUBSTATE) and calls two subroutines — not a pure leaf — so it is gated by
 * capture / clone / replay (docs/decompiler-pipeline), NOT the exhaustive-leaf pattern. A FRESH clone
 * is used per side because the routine mutates state.
 *
 * REACHABILITY. 1-player attract NEVER dispatches 0x0A1B: it is the TWO-PLAYER
 * alternation board-setup step (loc_0986 → sub_09fe → THIS → loc_0a37), and attract
 * is one-player, so loc_0986 takes its non-2P arm and the cascade never runs. Even a
 * driven 2-player *start* goes loc_0986 → sub_09d6 → loc_0a37 and skips this step —
 * 0x0A1B is the player-2-turn setup, which needs full alternation gameplay to reach
 * naturally. So every entry here is CRAFTED (docs/decompiler-pipeline "a real state with a surgical
 * nudge"): a REAL in-game 2-player machine (driven by a coin+START2 input tape) is
 * captured, and the task-ring state / palette bank / GAME_SUBSTATE / target video
 * cells are poked IDENTICALLY on both sides to exercise each arm.
 *
 *   1. EQUAL (crafted ring arms) — clean-write / occupied-slot DROP / wrap / second-
 *      slot-occupied, poked identically on both clones. For each, run the ORACLE on
 *      one clone and loc_0a1b on another and confirm they leave IDENTICAL RAM
 *      everywhere game-visible (diff confined to dead STACK_SCRATCH — the oracle
 *      models `call…/ret`, loc_0a1b uses the JS stack) AND the same palette bank.
 *
 *   2. EQUAL (non-vacuous) — pre-dirty the palette bank, GAME_SUBSTATE and the three
 *      P2 cells to garbage identically, then confirm loc_0a1b actively clears the
 *      palette to bank 0, sets GAME_SUBSTATE = 5, posts [0x03,0x03,0x02,0x01] into
 *      the ring, and stamps 0x02/0x25/0x20 — matching the oracle throughout — and
 *      leaves SP/pc unchanged (no stack modelling).
 *
 *   3. TEETH — two deliberately-broken twins MUST be caught: (a) one that drops the
 *      second task post (game-visible task-ring/tail diff), (b) one that leaves the
 *      high palette latch set (IO-state diff). A gate a real corruption slips through
 *      is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0a1b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a1b as oracle } from "../../translated/loc_0a1b.js";
import { loc_0a1b } from "../loc_0a1b.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, GAME_SUBSTATE, GAME_STATE, TWO_PLAYER_GAME, TASK_TAIL } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const PAGE = 0x6000; // task ring / tail live in page 0x60
const PALETTE_LO = 0x7d86, PALETTE_HI = 0x7d87;
// The three P2 "2UP" marker cells draw2UpLabel stamps, with their expected values.
const CELL_2 = 0x74e0, CELL_U = 0x74c0, CELL_P = 0x74a0;
const EXPECT_CELLS = [[CELL_2, 0x02], [CELL_U, 0x25], [CELL_P, 0x20]];

const IN2 = 0x7d00;
const COIN1 = 1 << 7, START2 = 1 << 3;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM (work + sprite + video, per dumpState). Returns the first
 * difference OUTSIDE the stack scratch below the entry SP (game-visible — a real failure) or null, plus the
 * count of bytes that differed inside the dead stack scratch (the oracle's push
 * residue; loc_0a1b models no stack, so a diff there is expected and tolerated).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Capture a REAL in-game two-player machine: drive a coin + START2 input tape from
 * boot and clone the host once a 2-player game is live (GAME_STATE == 3). This is
 * the in-distribution base every crafted entry is nudged from — real RAM, real task
 * ring, real video RAM — not a fabricated state. Built with NO overrides so the
 * clone carries none.
 */
function captureBase() {
  const host = new Machine(ROM);
  host.inputTape = [
    { port: IN2, bits: COIN1, frame: 60, dur: 6 },
    { port: IN2, bits: COIN1, frame: 90, dur: 6 },
    { port: IN2, bits: COIN1, frame: 120, dur: 6 },
    { port: IN2, bits: COIN1, frame: 150, dur: 6 },
    { port: IN2, bits: START2, frame: 200, dur: 8 },
  ];
  host.runFrames(480);
  assert.equal(host.mem.read8(GAME_STATE), 3, "drive should reach in-game (GAME_STATE == 3)");
  assert.equal(host.mem.read8(TWO_PLAYER_GAME), 1, "drive should be a two-player game (0x600F == 1)");
  const base = host.clone();
  base.regs.sp = 0x6bfe; // stack top, so the oracle's push residue lands in STACK_SCRATCH
  return base;
}

/** Clone the base, apply `craft` (poking one arm's ring state), return the entry. */
function craftEntry(base, craft) {
  const e = base.clone();
  e.regs.sp = 0x6bfe;
  if (craft) craft(e);
  return e;
}

/** Replay one entry through the oracle and a candidate on fresh clones each. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

// -- 1. EQUAL (crafted ring arms) ---------------------------------------------

test("EQUAL (crafted): loc_0a1b == oracle over clean / DROP / wrap / 2nd-occupied ring arms", () => {
  const base = captureBase();

  // Each arm pokes the task ring identically on both sides (docs/decompiler-pipeline crafted entry).
  const arms = [
    // Both slots at the tail free -> both messages written, tail advances by 4.
    ["clean", (m) => {
      m.mem.write8(TASK_TAIL, 0xc0);
      m.mem.write8(0x60c0, 0xff); m.mem.write8(0x60c2, 0xff);
    }],
    // Slot at the tail occupied (bit 7 clear) -> ring full there -> BOTH posts drop
    // (the second post re-reads the same unadvanced tail), tail untouched.
    ["DROP", (m) => {
      m.mem.write8(TASK_TAIL, 0xc4);
      m.mem.write8(0x60c4, 0x00); // occupied
    }],
    // Tail at the last slot pair -> first post advances past 0xFF and wraps to 0xC0,
    // second post writes at the base.
    ["wrap", (m) => {
      m.mem.write8(TASK_TAIL, 0xfe);
      m.mem.write8(0x60fe, 0xff); m.mem.write8(0x60c0, 0xff);
    }],
    // First slot free, next slot occupied -> first post written, second dropped.
    ["2nd-occupied", (m) => {
      m.mem.write8(TASK_TAIL, 0xd0);
      m.mem.write8(0x60d0, 0xff); m.mem.write8(0x60d2, 0x00);
    }],
  ];

  for (const [label, craft] of arms) {
    const entry = craftEntry(base, craft);
    // Pre-dirty the palette bank so "clears to 0" is provable, identically both sides.
    entry.io.paletteBank = 3;

    const { a, b, bad } = replay(entry, loc_0a1b);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // Palette bank is IO (not in dumpState), so compare it explicitly: both engines
    // must select bank 0.
    assert.equal(b.io.paletteBank, a.io.paletteBank, `${label}: palette bank must match the oracle`);
    assert.equal(b.io.paletteBank, 0, `${label}: loc_0a1b must clear the palette bank to 0`);
    // Both must have advanced the substate identically.
    assert.equal(b.mem.read8(GAME_SUBSTATE), 5, `${label}: GAME_SUBSTATE must be advanced to 5`);
    console.log(`  EQUAL/crafted ${label}: tail 0x60b0 -> ${hx(a.mem.read8(TASK_TAIL))}, game-visible RAM + palette identical`);
  }
});

// -- 2. EQUAL (non-vacuous: every write is actively performed) ----------------

test("EQUAL (non-vacuous): loc_0a1b actively clears palette, posts [3,3,2,1], stamps P2, sets substate 5", () => {
  const base = captureBase();
  const entry = craftEntry(base, (m) => {
    m.mem.write8(TASK_TAIL, 0xc0);
    m.mem.write8(0x60c0, 0xff); m.mem.write8(0x60c2, 0xff);
    // Garbage that the routine must overwrite.
    m.mem.write8(GAME_SUBSTATE, 0xaa);
    for (const [addr] of EXPECT_CELLS) m.mem.write8(addr, 0x5a);
  });
  entry.io.paletteBank = 3;

  const { a, b, bad } = replay(entry, loc_0a1b);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Palette cleared.
  assert.equal(b.io.paletteBank, 0, "palette bank must be cleared to 0");
  assert.equal(a.io.paletteBank, 0, "oracle must also clear the palette bank to 0");
  // Two messages posted at 0xC0..0xC3 = [opcode 3, arg 3, opcode 2, arg 1]; tail -> 0xC4.
  assert.deepEqual(
    [b.mem.read8(0x60c0), b.mem.read8(0x60c1), b.mem.read8(0x60c2), b.mem.read8(0x60c3)],
    [0x03, 0x03, 0x02, 0x01],
    "loc_0a1b must post [0x03,0x03] then [0x02,0x01]",
  );
  assert.equal(b.mem.read8(TASK_TAIL), 0xc4, "tail must advance by 4 (two posts)");
  // P2 marker stamped.
  for (const [addr, val] of EXPECT_CELLS) {
    assert.equal(b.mem.read8(addr), val, `cell ${hx(addr)} must be stamped to ${hx(val)}`);
  }
  // Substate advanced.
  assert.equal(b.mem.read8(GAME_SUBSTATE), 5, "GAME_SUBSTATE must be 5");

  // loc_0a1b must not model the stack: SP and pc unchanged from entry.
  const c = entry.clone();
  const sp0 = c.regs.sp, pc0 = c.pc;
  loc_0a1b(c);
  assert.equal(c.regs.sp, sp0, "loc_0a1b must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "loc_0a1b must leave pc unchanged (no ret modelling)");
  console.log("  EQUAL/non-vacuous: palette cleared, [3,3,2,1] posted, P2 stamped, substate 5, SP/pc untouched");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): forgets the SECOND task post -> ring/tail diverge. */
function brokenDropSecondPost(m) {
  const { regs, mem } = m;
  mem.write8(PALETTE_LO, 0);
  mem.write8(PALETTE_HI, 0);
  regs.d = 0x03; regs.e = 0x03;
  enqueueTaskLocal(m);
  // BUG: the [0x02,0x01] post is missing.
  draw2UpLabelLocal(m);
  mem.write8(GAME_SUBSTATE, 0x05);
}

/** Broken twin (b): leaves the HIGH palette latch set -> IO palette-bank diff. */
function brokenPaletteLatch(m) {
  const { regs, mem } = m;
  mem.write8(PALETTE_LO, 0);
  // BUG: 0x7D87 is never cleared, so bit 1 of the palette bank stays set.
  regs.d = 0x03; regs.e = 0x03; enqueueTaskLocal(m);
  regs.d = 0x02; regs.e = 0x01; enqueueTaskLocal(m);
  draw2UpLabelLocal(m);
  mem.write8(GAME_SUBSTATE, 0x05);
}

// Minimal local copies of the callees' effects so the twins are self-contained and
// differ from loc_0a1b ONLY in the injected bug (not in a callee).
function enqueueTaskLocal(m) {
  const { regs, mem } = m;
  const tail = mem.read8(TASK_TAIL);
  const slot = PAGE | tail;
  if ((mem.read8(slot) & 0x80) === 0) return;
  mem.write8(slot, regs.d);
  mem.write8(PAGE | ((tail + 1) & 0xff), regs.e);
  let next = (tail + 2) & 0xff;
  if (next < 0xc0) next = 0xc0;
  mem.write8(TASK_TAIL, next);
}
function draw2UpLabelLocal(m) {
  m.mem.write8(CELL_2, 0x02);
  m.mem.write8(CELL_U, 0x25);
  m.mem.write8(CELL_P, 0x20);
}

test("TEETH: a dropped task post is CAUGHT in the task ring", () => {
  const base = captureBase();
  const entry = craftEntry(base, (m) => {
    m.mem.write8(TASK_TAIL, 0xc0);
    m.mem.write8(0x60c0, 0xff); m.mem.write8(0x60c2, 0xff);
  });
  entry.io.paletteBank = 3;
  const { bad } = replay(entry, brokenDropSecondPost);
  assert.notEqual(bad, null, "the crafted sweep FAILED to catch a dropped task post — it is worthless");
  console.log(`  TEETH/drop-post: caught game-visible diff at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH: an uncleared palette latch is CAUGHT in the IO palette bank", () => {
  const base = captureBase();
  const entry = craftEntry(base, (m) => {
    m.mem.write8(TASK_TAIL, 0xc0);
    m.mem.write8(0x60c0, 0xff); m.mem.write8(0x60c2, 0xff);
  });
  entry.io.paletteBank = 3; // both bits set going in

  const a = entry.clone(); const b = entry.clone();
  oracle(a);
  brokenPaletteLatch(b);
  // Game-visible RAM is identical (the bug is IO-only), so the RAM diff alone would
  // MISS it — the palette-bank comparison is what catches it.
  assert.notEqual(
    b.io.paletteBank, a.io.paletteBank,
    "the palette-bank comparison FAILED to catch an uncleared latch — it is worthless",
  );
  assert.equal(a.io.paletteBank, 0, "oracle clears both palette bits");
  assert.equal(b.io.paletteBank, 2, "broken twin leaves bit 1 set");
  console.log(`  TEETH/palette: caught — oracle bank=${a.io.paletteBank}, broken bank=${b.io.paletteBank}`);
});
