// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0478 (ROM 0x0478) — the even-board arm of the per-frame colour
 * cascade: shift the sprite-object block's X column by a board-specific delta (50m takes it
 * from RAM 0x63b7, the other even board uses the fixed +0x44), then run the colour-cycle
 * repaint (dispatchColorCyclePaint, 0x0486).
 *
 * loc_0478 is COLD in a 25m attract: its dispatcher (loc_0450) only routes here when the
 * board's low bit is clear (the even boards 50m/100m), and attract plays 25m (BOARD == 1).
 * So there are no natural captures — it is validated entirely by CRAFTED entries reposed on
 * a real attract base (realistic work RAM), poking BOARD and the shift-delta source, plus the
 * incoming board-rotated register byte the dispatcher hands it (the oracle reads that
 * register; the reachability probe below confirms zero natural dispatches).
 *
 * The oracle's net stack effect down every path is exactly ONE return: it push16s the
 * rst-0x38 link and the shared add-loop's `ret` pops it back (net zero), then the colour
 * tail chain rets the caller's address (one net pop). Its pushed link bytes land in
 * STACK_SCRATCH, excluded by the memory-equivalence contract. The idiomatic routine models
 * the Z80 stack as the JS call stack (direct calls, no push16/ret of its own), so the harness
 * performs ONE m.ret() on the candidate to line pc + SP up with the oracle. Every case runs
 * on a FRESH clone (the arms write memory).
 *
 *   1. REACHABILITY — hook 0x0478 in a real attract run and confirm it is not dispatched
 *      (documents why the gate is crafted-only). Any real dispatch would also be validated.
 *
 *   2. EQUAL (crafted) — BOARD == 2 (bit-1-set arm: delta read from 0x63b7) and BOARD == 4
 *      (bit-1-clear arm: default +0x44), each with regs.a = the board rotated right one bit
 *      (what loc_0450 hands it) so the oracle branches on the same board; plus a second
 *      BOARD == 2 entry with a different 0x63b7 to prove the RAM delta is really read. Each
 *      compared over the whole contract (RAM − the stack scratch below the entry SP + pc + SP) and checked
 *      non-vacuous (the sprite-object X column really moved).
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) always-default-delta: ignores the board bit and always shifts by +0x44 — caught
 *          on the BOARD == 2 entry (where 0x63b7 != 0x44), the X column diverges.
 *      (b) wrong-column: aims the shift at the Y field (+3) instead of the X field — caught
 *          on the sprite-object X bytes the oracle shifts and this twin leaves alone.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0478.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0478 as oracle } from "../../translated/loc_0478.js";
import { shiftEvenBoardSpriteColumn as loc_0478 } from "../shiftEvenBoardSpriteColumn.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { dispatchColorCyclePaint } from "../dispatchColorCyclePaint.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0478;
const RET_ADDR = 0x0450;            // a plausible caller-return for the one net pop (any value works)
const SHIFT_DELTA_SOURCE = 0x63b7;  // 50m's staged X-shift delta (unnamed in names.js)
const DEFAULT_SHIFT = 0x44;         // the fixed X-shift on the other even board

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// The dispatcher hands loc_0478 the board rotated right one bit; the oracle reads that
// register and rotates again to test the board's bit 1. Reproduce the caller's rotate.
const ror8 = (v) => (((v & 0xff) >> 1) | ((v & 1) << 7)) & 0xff;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/** Run the ORACLE on a fresh clone. Its colour tail chain performs the net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hb(ram.a)} cand=${hb(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. loc_0478's body is never reached here (25m); it is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x0478 entry onto a clone of the base: a clean stack with a plausible
 * caller return (so the net `ret` has a sane target), the board being tested, the register
 * the dispatcher would have handed it (board rotated right one bit), and — when given — the
 * shift-delta source byte.
 */
function craft(base, { board, delta }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(BOARD, board & 0xff);
  m.regs.a = ror8(board);
  if (delta !== undefined) m.mem.write8(SHIFT_DELTA_SOURCE, delta & 0xff);
  return m;
}

// The ten X-field bytes of the sprite-object block (stride 4), read from a machine.
const xColumn = (m) => Array.from({ length: 10 }, (_, k) => m.mem.read8(SPRITE_OBJ_BLOCK + 4 * k));

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x0478 is cold in a 25m attract (crafted-only gate); any real dispatch also matches", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 32) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_0478);
    assert.equal(diffs.length, 0, `real dispatch: ${diffs.join("; ")}`);
  }
  console.log(`  REACHABILITY: ${caps.length} natural 0x0478 dispatches in 1500 attract frames (crafted-only gate)`);
});

// -- 2. EQUAL (crafted, both arms) --------------------------------------------

test("EQUAL (crafted): the bit-1-set (50m) and bit-1-clear (100m) arms match the oracle", () => {
  const base = attractBase();

  const cases = [
    // 50m: bit 1 set -> the shift is read from 0x63b7 (a distinctive value != 0x44).
    { name: "BOARD==2 (50m), delta from 0x63b7=0x50", board: 2, delta: 0x50, expect: 0x50 },
    // 50m again with a different (signed) delta -> proves the RAM byte is really read.
    { name: "BOARD==2 (50m), delta from 0x63b7=0xfc (−4)", board: 2, delta: 0xfc, expect: 0xfc },
    // 100m: bit 1 clear -> the fixed default +0x44 (0x63b7 left irrelevant).
    { name: "BOARD==4 (100m), default +0x44", board: 4, delta: 0x11, expect: DEFAULT_SHIFT },
  ];

  for (const { name, board, delta, expect } of cases) {
    const entry = craft(base, { board, delta });

    const diffs = contractDiffs(entry, loc_0478);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const before = xColumn(entry);
    const after = xColumn(runOracle(entry));
    for (let k = 0; k < 10; k++) {
      assert.equal(after[k], (before[k] + expect) & 0xff, `${name}: X record ${k} not shifted by ${hb(expect)}`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (50m RAM-delta ×2, 100m default) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

// Both twins reuse the real idiomatic arms, so the ONLY divergence is the injected bug.

/** BUG (a): ignores the board bit and always shifts by the default +0x44 (never reads 0x63b7). */
function teethAlwaysDefault(m) {
  const { regs } = m;
  regs.hl = SPRITE_OBJ_BLOCK;
  regs.c = DEFAULT_SHIFT; // BUG: should read 0x63b7 when board bit 1 is set
  addToSpriteObjectColumn(m);
  dispatchColorCyclePaint(m);
}

/** BUG (b): aims the shift at the Y field (+3) instead of the X field (+0). */
function teethWrongColumn(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  const shiftX = (board & 0x02) !== 0 ? mem.read8(SHIFT_DELTA_SOURCE) : DEFAULT_SHIFT;
  regs.hl = SPRITE_OBJ_BLOCK + 3; // BUG: the Y column (0x690b), not the X column (0x6908)
  regs.c = shiftX;
  addToSpriteObjectColumn(m);
  dispatchColorCyclePaint(m);
}

test("TEETH: the always-default-delta twin and the wrong-column twin are CAUGHT", () => {
  const base = attractBase();

  // (a) always-default: BOARD==2 with 0x63b7 = 0x50 (!= 0x44), so the correct X shift is
  //     +0x50 while the twin shifts +0x44 — the sprite-object X column diverges.
  const ad = craft(base, { board: 2, delta: 0x50 });
  const adDiffs = contractDiffs(ad, teethAlwaysDefault);
  assert.notEqual(adDiffs.length, 0, "the always-default-delta twin escaped — the gate is worthless");
  assert.ok(adDiffs[0].startsWith("RAM@"), `expected a RAM divergence, got ${adDiffs[0]}`);

  // (b) wrong-column: BOARD==2 with a nonzero shift, so the X field the oracle moves stays
  //     put under the twin (which moves the Y field instead) — memory diverges.
  const wc = craft(base, { board: 2, delta: 0x50 });
  const wcDiffs = contractDiffs(wc, teethWrongColumn);
  assert.notEqual(wcDiffs.length, 0, "the wrong-column twin escaped — the gate is worthless");

  console.log(`  TEETH: always-default caught (${adDiffs[0]}); wrong-column caught (${wcDiffs[0]})`);
});
