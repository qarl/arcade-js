// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for accrueScoreAndUpdateHighScore (ROM 0x0496, Pooyan) — "accrue the active player's score and
 * keep the high score in step". Gated on GAME_ACTIVE_FLAG (0x8806) bit 0. The award index (A) picks a
 * 3-byte BCD increment: index 0 -> the per-frame increment (0x88ab); any other index -> the award
 * table (0x0501, stride 3). The increment is BCD-added into the active player's counter (P1 0x88a2 /
 * P2 0x88a5, selected by ACTIVE_PLAYER 0x880d), the counter's column is repainted (drawBcdCounterColumn), then the
 * counter is compared MSB-first with the high score (0x88a8) and, if strictly greater, copied over it
 * and repainted with the high-score selector.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine writes work RAM and
 * video RAM (via the repaint), so every case uses a FRESH clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). The module and oracle repaint through the two forms of drawBcdCounterColumn (idiomatic vs
 * translated), which agree by drawBcdCounterColumn's own gate — so the compared RAM includes the painted columns.
 *
 * LIVE-OUT: none — memory-only. Reached only by table dispatch; no caller reads a result register.
 *
 * The award-table (index != 0) increment lives in ROM, unknown to this test — but the oracle and module
 * read the identical ROM byte, so that arm still compares equal. The high-score-update arms are driven
 * through the index-0 path, whose increment cell (0x88ab) is work RAM the test controls.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate closed; index-0 accrue below / above / exactly equal to the high score;
 *      the P2 bank; and an index != 0 award-table read: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a high-score-update case: oracle and module change the identical cell set, which
 *      includes the counter bytes and the high-score bytes.
 *   3. TEETH — a twin that corrupts a counter byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0496.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0496 as oracle } from "../../translated/loc_0496.js";
import { accrueScoreAndUpdateHighScore } from "../accrueScoreAndUpdateHighScore.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GATE = 0x8806; // GAME_ACTIVE_FLAG (bit 0 gates)
const ACTIVE_PLAYER = 0x880d;
const P1_COUNTER = 0x88a2; // P1_SCORE_BCD
const P2_COUNTER = 0x88a5; // P2_SCORE_BCD
const HIGH = 0x88a8; // HIGH_SCORE_BCD (LSB..MSB = 0x88a8..0x88aa)
const PER_FRAME = 0x88ab; // PER_FRAME_SCORE_INCREMENT

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// The dead stack is excluded: the oracle's push/pop/ret framing writes return addresses there while
// the cycle-free module never touches the stack.
function changedAddrs(m, run) {
  const before = m.dumpState();
  run(m);
  const after = m.dumpState();
  const out = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    out.push(addr);
  }
  return out.sort((a, b) => a - b);
}

const put3 = (m, addr, [b0, b1, b2]) => {
  m.mem.write8(addr, b0); // LSB
  m.mem.write8(addr + 1, b1);
  m.mem.write8(addr + 2, b2); // MSB
};

/** A fresh clone: gate, active player, counter, per-frame increment, and high score seated. */
function craft({ index = 0, gate = 1, player = 0, counter = [0, 0, 0], inc = [0, 0, 0], high = [0, 0, 0] }) {
  const m = BASE.clone();
  m.regs.a = index & 0xff; // the award index (register-default bridge input)
  m.mem.write8(GATE, gate);
  m.mem.write8(ACTIVE_PLAYER, player);
  put3(m, player & 0x01 ? P2_COUNTER : P1_COUNTER, counter);
  put3(m, PER_FRAME, inc);
  put3(m, HIGH, high);
  m.regs.sp = 0x8ffe; // dead stack: the oracle's push/pop/ret framing touches excluded RAM only
  return m;
}

const CASES = [
  { name: "gate closed", opts: { gate: 0, index: 0, inc: [0x50, 0, 0] } },
  { name: "index 0, P1, below high score", opts: { player: 0, counter: [0, 0, 0], inc: [0x50, 0, 0], high: [0, 0, 0x99] } },
  { name: "index 0, P1, new high score", opts: { player: 0, counter: [0, 0, 0], inc: [0x50, 0, 0], high: [0, 0, 0] } },
  { name: "index 0, P1, exactly equal (no update)", opts: { player: 0, counter: [0x50, 0, 0], inc: [0, 0, 0], high: [0x50, 0, 0] } },
  { name: "index 0, P2 bank, new high score", opts: { player: 1, counter: [0, 0, 0], inc: [0x25, 0, 0], high: [0, 0, 0] } },
  { name: "index 0, P1, BCD carry ripple", opts: { player: 0, counter: [0x99, 0x99, 0x00], inc: [0x01, 0, 0], high: [0, 0, 0] } },
  { name: "index 2, P1, award-table read (ROM)", opts: { index: 2, player: 0, counter: [0, 0, 0], high: [0x99, 0x99, 0x99] } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted accrue cases — accrueScoreAndUpdateHighScore == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = craft(opts);
    const c = craft(opts);
    oracle(o);
    accrueScoreAndUpdateHighScore(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a new-high-score case changes the identical set (counter + high-score bytes)", () => {
  // A multi-byte increment so the new counter beats the (zero) high score in EVERY BCD byte; a
  // single-byte increment would copy the high-score mid/MSB as 0->0, which a value-diff footprint
  // never lists, hiding those cells from the footprint check below.
  const opts = { player: 0, counter: [0, 0, 0], inc: [0x50, 0x34, 0x12], high: [0, 0, 0] };
  const oSet = changedAddrs(craft(opts), oracle);
  const cSet = changedAddrs(craft(opts), accrueScoreAndUpdateHighScore);
  assert.deepEqual(cSet, oSet, "module and oracle must change the identical cell set");
  // The counter's LSB and every high-score byte must be in the footprint.
  for (const cell of [P1_COUNTER, HIGH, HIGH + 1, HIGH + 2]) {
    assert.ok(oSet.includes(cell), `footprint missing ${hx(cell)}`);
  }
  // Gate-closed changes nothing.
  assert.deepEqual(changedAddrs(craft({ gate: 0, inc: [0x50, 0, 0] }), oracle), [], "gate-closed must change nothing");
  console.log(`  WRITE-SET: new-high-score -> ${oSet.length} cells (counter + high score + repaint); gate-closed -> 0`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong counter byte is CAUGHT by the RAM diff", () => {
  const opts = { player: 0, counter: [0, 0, 0], inc: [0x50, 0, 0], high: [0, 0, 0x99] };
  const o = craft(opts);
  const c = craft(opts);
  oracle(o);
  accrueScoreAndUpdateHighScore(c);
  c.mem.write8(P1_COUNTER, (c.mem.read8(P1_COUNTER) ^ 0x01) & 0xff); // BUG: wrong accrued LSB
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong counter byte — it is worthless");
  assert.equal(d.addr, P1_COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong counter byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
