// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorAnimationFrame (Pooyan ROM 0x22e6) — the per-actor animation-script stepper,
 * IX being the actor record. (IX+0x0e) is a frame countdown: while non-zero it just ticks down and
 * returns. At zero it pulls the next entry from the shared script cursor (ANIM_SCRIPT_CURSOR): a
 * normal {tile, colour, delay} triple is copied into (IX+0x10/0x0f/0x0e) and the cursor advances past
 * it; a 0xff control marker replaces the cursor with the two bytes following it (a script jump) and
 * re-reads there.
 *
 * Cycle-free / memory-equivalence gate. Compared on RAM (dumpState) MINUS stack scratch below the entry SP. pc/SP/cycles
 * and the register file are NOT compared — this is a memory-only routine (its IX input is poked
 * identically on both sides; the caller reads nothing back). The script data lives in ROM in play, so
 * every case CRAFTS the cursor to point at a RAM buffer whose bytes are seated on both sides.
 *
 * The marker's rival full-reset arm (cursor := the base script) fires only when the target-presence
 * fold reaches 3; that fold seeds 0 and is only rotated, so it is always 0 and the arm is unreachable —
 * both the oracle and the module always resolve a marker as the inline jump, so it is not exercised.
 *
 * Jobs:
 *   1. EQUAL — countdown-live, a normal entry, and a marker jump: identical RAM.
 *   2. WRITE-SET — a normal entry writes exactly the three record fields and the cursor.
 *   3. CRAFTED — the marker jump installs the following cursor then reads the entry it points to.
 *   4. TEETH — a wrong record field and a wrong advanced cursor are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-22e6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_22e6 as oracle } from "../../translated/loc_22e6.js";
import { advanceActorAnimationFrame } from "../advanceActorAnimationFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ANIM_SCRIPT_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; // an actor record base in the arena
const OFF_DELAY = 0x0e;
const OFF_COLOUR = 0x0f;
const OFF_TILE = 0x10;
const CURSOR = ANIM_SCRIPT_CURSOR; // 0x8f00
const BUF_A = 0x8e80; // crafted script buffer (RAM, stands in for the ROM script)
const BUF_B = 0x8e90; // second buffer a marker jumps to
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const setCursor = (m, addr) => {
  m.mem.write8(CURSOR, addr & 0xff);
  m.mem.write8(CURSOR + 1, (addr >> 8) & 0xff);
};
const readCursor = (m) => m.mem.read8(CURSOR) | (m.mem.read8(CURSOR + 1) << 8);

/** Fresh clone: IX = REC, the two written fields pre-dirtied, then `seat` seeds the scenario. */
function craft(seat) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(REC + OFF_COLOUR, 0xaa);
  m.mem.write8(REC + OFF_TILE, 0xaa);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the ret only POPs (reads)
  seat(m);
  return m;
}

const SEAT_COUNTDOWN = (m) => m.mem.write8(REC + OFF_DELAY, 0x05); // countdown live -> just tick down
const SEAT_ENTRY = (m) => {
  m.mem.write8(REC + OFF_DELAY, 0x00);
  setCursor(m, BUF_A);
  m.mem.write8(BUF_A, 0x12); // tile (not 0xff)
  m.mem.write8(BUF_A + 1, 0x34); // colour
  m.mem.write8(BUF_A + 2, 0x05); // delay
};
const SEAT_MARKER = (m) => {
  m.mem.write8(REC + OFF_DELAY, 0x00);
  setCursor(m, BUF_A);
  m.mem.write8(BUF_A, 0xff); // control marker
  m.mem.write8(BUF_A + 1, BUF_B & 0xff); // jump low
  m.mem.write8(BUF_A + 2, (BUF_B >> 8) & 0xff); // jump high
  m.mem.write8(BUF_B, 0x22); // entry at the jump target
  m.mem.write8(BUF_B + 1, 0x44);
  m.mem.write8(BUF_B + 2, 0x06);
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: countdown / normal entry / marker jump — advanceActorAnimationFrame == oracle in RAM (−stack)", () => {
  for (const [label, seat] of [["countdown", SEAT_COUNTDOWN], ["entry", SEAT_ENTRY], ["marker", SEAT_MARKER]]) {
    const o = craft(seat);
    const c = craft(seat);
    oracle(o);
    advanceActorAnimationFrame(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: countdown + entry + marker identical (RAM −stack)");
});

test("EQUAL(fields): countdown ticks (IX+0x0e) down by one", () => {
  const o = craft(SEAT_COUNTDOWN);
  const c = craft(SEAT_COUNTDOWN);
  oracle(o);
  advanceActorAnimationFrame(c);
  assert.equal(c.mem.read8(REC + OFF_DELAY), 0x04, "module decrements the countdown");
  assert.equal(o.mem.read8(REC + OFF_DELAY), 0x04, "oracle decrements the countdown");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a normal entry writes the 3 record fields + the cursor", () => {
  const fields = [REC + OFF_DELAY, REC + OFF_COLOUR, REC + OFF_TILE];
  const footprint = new Set([...fields, CURSOR, CURSOR + 1]);

  const before = craft(SEAT_ENTRY);
  const after = craft(SEAT_ENTRY);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) assert.ok(footprint.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  for (const addr of [...fields, CURSOR]) assert.ok(changed.has(addr), `expected a change at ${hx(addr)}`);
  assert.equal(after.mem.read8(REC + OFF_TILE), 0x12, "tile field");
  assert.equal(after.mem.read8(REC + OFF_COLOUR), 0x34, "colour field");
  assert.equal(after.mem.read8(REC + OFF_DELAY), 0x05, "delay field");
  assert.equal(readCursor(after), (BUF_A + 3) & 0xffff, "cursor advanced past the entry");
  console.log("  WRITE-SET: 3 fields + cursor");
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: a marker installs the following cursor then reads the target entry", () => {
  const o = craft(SEAT_MARKER);
  const c = craft(SEAT_MARKER);
  oracle(o);
  advanceActorAnimationFrame(c);
  assert.equal(ramDiffMinusStack(o, c), null, "marker jump must match");
  assert.equal(c.mem.read8(REC + OFF_TILE), 0x22, "tile from the jump target");
  assert.equal(c.mem.read8(REC + OFF_COLOUR), 0x44, "colour from the jump target");
  assert.equal(c.mem.read8(REC + OFF_DELAY), 0x06, "delay from the jump target");
  assert.equal(readCursor(c), (BUF_B + 3) & 0xffff, "cursor advanced past the target entry");
  console.log("  CRAFTED: marker -> jump to 0x8e90 -> reads its entry");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record field is CAUGHT by the RAM diff", () => {
  const o = craft(SEAT_ENTRY);
  const c = craft(SEAT_ENTRY);
  oracle(o);
  advanceActorAnimationFrame(c);
  c.mem.write8(REC + OFF_TILE, 0x12 ^ 0x01); // BUG: wrong tile field
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record field — it is worthless");
  assert.equal(d.addr, REC + OFF_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/field: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced cursor is CAUGHT by the RAM diff", () => {
  const o = craft(SEAT_ENTRY);
  const c = craft(SEAT_ENTRY);
  oracle(o);
  advanceActorAnimationFrame(c);
  c.mem.write8(CURSOR, ((BUF_A + 3) ^ 0x01) & 0xff); // BUG: cursor off by one
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong advanced cursor — it is worthless");
  assert.equal(d.addr, CURSOR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/cursor: wrong cursor caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
