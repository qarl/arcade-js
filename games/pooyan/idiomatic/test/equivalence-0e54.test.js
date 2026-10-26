// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueCreditDisplayCommands (ROM 0x0e54) — "queue a fixed display command, plus a
 * free-play extra": always enqueue command 0x0701 into the page-0x88 display-command ring; then,
 * only when the coinage config (0x882c) holds the free-play sentinel 0x0f, enqueue a second
 * command 0x0606.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES
 * the display-command ring, so each case uses a FRESH clone per side: the oracle runs on one clone,
 * queueCreditDisplayCommands on the other, compared on RAM (dumpState) minus stack scratch below the entry SP. pc/SP/cycles are NOT
 * compared. There is NO consumed register live-out: this is a display-ring dispatch handler; the
 * oracle leaves A holding a ring-pointer leftover and DE holding the last command word, neither of
 * which a caller reads, so neither is part of the contract (and the idiomatic form reproduces
 * neither register). The oracle's `push16 + call 0x0038` return addresses land in STACK_SCRATCH,
 * excluded by contract.
 *
 * The ring is seeded free (each slot's bit 7 set, write pointer at the 0xc0 ring start) so the
 * enqueues actually land and the write footprint is observable; a case with an occupied slot
 * confirms both sides drop the command identically.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over {free-play, non-free-play} x {ring free, ring occupied}
 *      queueCreditDisplayCommands == oracle in RAM (-stack).
 *   2. WRITE-SET — in free play with a free ring the oracle writes exactly five cells: the two
 *      command words (four bytes) and the advanced ring write pointer.
 *   3. TEETH — a twin that writes a wrong command byte is CAUGHT by the RAM diff; a twin that skips
 *      the free-play second enqueue is CAUGHT (the ring pointer + second slot differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0e54.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e54 as oracle } from "../../translated/loc_0e54.js";
import { queueCreditDisplayCommands } from "../queueCreditDisplayCommands.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, COINAGE_CONFIG, DISPLAY_CMD_RING_WRITE_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = 0x8800; // display-command ring page (matches DISPLAY_CMD_RING_WRITE_PTR's page)
const RING_START = 0xc0; // ring write pointer's low byte at the start slot
const FREE_PLAY = 0x0f;
const SLOT_FREE = 0x80; // bit 7 set => slot free to write

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the coinage set and the display ring seeded free or occupied. */
function craft(coinage, ringFree) {
  const m = BASE.clone();
  m.mem.write8(COINAGE_CONFIG, coinage & 0xff);
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_START);
  for (let s = RING_START; s <= 0xff; s++) m.mem.write8(RING_PAGE | s, ringFree ? SLOT_FREE : 0x00);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's push/ret ride the dead stack
  return m;
}

const CASES = [
  { coinage: FREE_PLAY, ringFree: true }, // two enqueues
  { coinage: 0x01, ringFree: true }, //      one enqueue (not free play)
  { coinage: FREE_PLAY, ringFree: false }, // both dropped (slot occupied)
  { coinage: 0x00, ringFree: false }, //     dropped (slot occupied)
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted coinage x ring state — queueCreditDisplayCommands == oracle in RAM (-stack)", () => {
  for (const { coinage, ringFree } of CASES) {
    const o = craft(coinage, ringFree);
    const c = craft(coinage, ringFree);
    oracle(o);
    queueCreditDisplayCommands(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (coinage=${hx(coinage)} ringFree=${ringFree})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM -stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: free play + free ring writes the two command words and the ring pointer", () => {
  const mm = craft(FREE_PLAY, true);
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    changed.push({ addr, to: a1[off] });
  }
  const EXPECTED = new Map([
    [(RING_PAGE | 0xc0) & 0xffff, 0x07], // command 0x0701 high
    [(RING_PAGE | 0xc1) & 0xffff, 0x01], // command 0x0701 low
    [(RING_PAGE | 0xc2) & 0xffff, 0x06], // command 0x0606 high
    [(RING_PAGE | 0xc3) & 0xffff, 0x06], // command 0x0606 low
    [DISPLAY_CMD_RING_WRITE_PTR, 0xc4], //  advanced write pointer
  ]);
  assert.equal(changed.length, EXPECTED.size, `expected ${EXPECTED.size} written cells, got ${changed.length}`);
  for (const { addr, to } of changed) {
    assert.ok(EXPECTED.has(addr), `oracle wrote an unexpected cell at ${hx(addr)}`);
    assert.equal(to, EXPECTED.get(addr), `cell ${hx(addr)} must be ${hx(EXPECTED.get(addr))}, got ${hx(to)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} cells (two command words + ring pointer)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong command byte is CAUGHT by the RAM diff", () => {
  const o = craft(FREE_PLAY, true);
  const c = craft(FREE_PLAY, true);
  oracle(o);
  queueCreditDisplayCommands(c);
  c.mem.write8(RING_PAGE | 0xc2, 0x00); // BUG: second command high byte must be 0x06
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong command byte");
  assert.equal(d.addr, (RING_PAGE | 0xc2) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/byte: wrong command byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: enqueues only the primary command, never the free-play extra. */
function brokenSkipsFreePlay(m) {
  const { mem8 } = m;
  const low = mem8[DISPLAY_CMD_RING_WRITE_PTR];
  const slot = 0x8800 + low;
  if ((mem8[slot] & 0x80) === 0) return;
  mem8[slot] = 0x07;
  mem8[0x8800 + ((low + 1) & 0xff)] = 0x01;
  mem8[DISPLAY_CMD_RING_WRITE_PTR] = (low + 2) & 0xff; // BUG: stops after the first command
}

test("TEETH: skipping the free-play second enqueue is CAUGHT", () => {
  const o = craft(FREE_PLAY, true);
  const c = craft(FREE_PLAY, true);
  oracle(o);
  brokenSkipsFreePlay(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing free-play enqueue");
  console.log(`  TEETH/skip: missing free-play enqueue caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
