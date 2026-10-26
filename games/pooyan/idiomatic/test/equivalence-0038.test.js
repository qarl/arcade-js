// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for enqueueDisplayCommand (Pooyan ROM 0x0038) — the display-command ring enqueue.
 * Reads the low-byte write pointer; if the pointed slot is free (bit 7 set) it stores the command's
 * high byte there and its low byte in the next slot, advances the pointer by two and wraps it back to
 * the ring start (0xc0) once it drops below; an occupied slot (bit 7 clear) drops the command.
 *
 * This is the cycle-free / memory-equivalence gate. The routine WRITES work RAM, so every case uses a
 * FRESH clone per side, compared on the go-forward contract: RAM (dumpState) MINUS stack scratch below the entry SP. pc,
 * SP and cycles are NOT compared. There is no register live-out: HL is push/pop-preserved and A (left
 * holding the pointer/slot byte) is discarded by every rst-0x38 call site, so the contract is RAM only.
 *
 * The routine's inputs are DE (the command) plus RAM: the pointer cell and the target slot's bit 7.
 * Every case is CRAFTED — a plain boot dispatches the enqueue during live rendering, not attract.
 *
 * Jobs:
 *   1. EQUAL — free slots (down the ring, at the 8-bit wrap edge) and an occupied slot: identical RAM.
 *   2. WRITE-SET — a free enqueue changes exactly the two slot bytes and the pointer cell.
 *   3. CRAFTED — the occupied slot is a pure no-op; the low-wrap clamps the pointer back to 0xc0.
 *   4. TEETH — a wrong slot byte and a wrong advanced pointer are both caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0038.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0038 as oracle } from "../../translated/loc_0038.js";
import { enqueueDisplayCommand } from "../enqueueDisplayCommand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DISPLAY_CMD_RING_WRITE_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PTR = DISPLAY_CMD_RING_WRITE_PTR; // 0x88a0
const PAGE = (PTR >> 8) << 8; //          0x8800 — the ring shares the pointer cell's page
const RING_START = 0xc0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const slotAddr = (low) => PAGE + (low & 0xff);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: DE = command, pointer = low, target slot's bit 7 set when `free`, both slots dirtied. */
function craft(cmd, low, free) {
  const m = BASE.clone();
  m.regs.de = cmd & 0xffff;
  m.mem.write8(PTR, low & 0xff);
  m.mem.write8(slotAddr(low), free ? 0xaa : 0x7f); // 0xaa: bit7 set (free); 0x7f: bit7 clear (occupied)
  m.mem.write8(slotAddr(low + 1), 0xaa); //           second slot dirtied so the E write is visible
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; push/pop/ret touch dead RAM only
  return m;
}

/** The advanced-and-clamped pointer the oracle stores after a free enqueue. */
function nextPtr(low) {
  let p = (low + 2) & 0xff;
  if (p < RING_START) p = RING_START;
  return p;
}

const FREE_CASES = [
  { cmd: 0x1234, low: 0xc0 },
  { cmd: 0xabcd, low: 0xc2 },
  { cmd: 0x5678, low: 0xfe }, // +2 wraps low to 0x00 -> clamp up to 0xc0
  { cmd: 0x9012, low: 0xff }, // 8-bit L wrap: second slot lands on the page base 0x8800
  { cmd: 0x00ff, low: 0xd0 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: free enqueues + an occupied slot — enqueueDisplayCommand == oracle in RAM (−stack)", () => {
  for (const { cmd, low } of FREE_CASES) {
    const o = craft(cmd, low, true);
    const c = craft(cmd, low, true);
    oracle(o);
    enqueueDisplayCommand(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `free cmd=${hx(cmd)} low=${hx(low)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  // occupied slot -> both drop the command, no RAM change
  const o = craft(0x1111, 0xc4, false);
  const c = craft(0x1111, 0xc4, false);
  oracle(o);
  enqueueDisplayCommand(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `occupied: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log(`  EQUAL: ${FREE_CASES.length} free + 1 occupied case identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a free enqueue changes exactly the two slot bytes and the pointer cell", () => {
  const cmd = 0x1234;
  const low = 0xc0;
  const s0 = slotAddr(low);
  const s1 = slotAddr(low + 1);

  const before = craft(cmd, low, true);
  const after = craft(cmd, low, true);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  assert.equal(changed.length, 3, `expected exactly 3 changed cells, got ${changed.length}`);
  assert.ok(addrs.has(s0) && addrs.has(s1) && addrs.has(PTR), "changed set must be {slot0, slot1, pointer}");
  assert.equal(after.mem.read8(s0), (cmd >> 8) & 0xff, "slot0 must hold the command high byte");
  assert.equal(after.mem.read8(s1), cmd & 0xff, "slot1 must hold the command low byte");
  assert.equal(after.mem.read8(PTR), nextPtr(low), "pointer must advance by two");
  console.log(`  WRITE-SET: ${hx(s0)}/${hx(s1)}/${hx(PTR)} changed (3 cells)`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: an occupied slot writes nothing; a low-wrap clamps the pointer to 0xc0", () => {
  // occupied: RAM identical before and after the oracle (pure no-op)
  const occ = craft(0x2222, 0xd2, false);
  const b0 = occ.dumpState();
  oracle(occ);
  const a1 = occ.dumpState();
  assert.equal(firstStateDiff(b0, a1, (off) => occ.stateOffsetToAddr(off), inDeadStack), null, "occupied slot must not write");

  // low-wrap: pointer 0xfe -> +2 = 0x00 (<0xc0) -> clamp to 0xc0, identical on both sides
  const o = craft(0x3344, 0xfe, true);
  const c = craft(0x3344, 0xfe, true);
  oracle(o);
  enqueueDisplayCommand(c);
  assert.equal(ramDiffMinusStack(o, c), null, "low-wrap case must match");
  assert.equal(c.mem.read8(PTR), RING_START, "module must clamp the wrapped pointer to 0xc0");
  assert.equal(o.mem.read8(PTR), RING_START, "oracle clamps the wrapped pointer to 0xc0");
  console.log("  CRAFTED: occupied no-op + 0xfe wrap clamps to 0xc0");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong slot byte is CAUGHT by the RAM diff", () => {
  const cmd = 0x1234;
  const low = 0xc0;
  const s1 = slotAddr(low + 1);
  const o = craft(cmd, low, true);
  const c = craft(cmd, low, true);
  oracle(o);
  enqueueDisplayCommand(c);
  c.mem.write8(s1, (cmd & 0xff) ^ 0x01); // BUG: corrupt the enqueued low byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong slot byte — it is worthless");
  assert.equal(d.addr, s1, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/slot: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced pointer is CAUGHT by the RAM diff", () => {
  const cmd = 0x1234;
  const low = 0xc0;
  const o = craft(cmd, low, true);
  const c = craft(cmd, low, true);
  oracle(o);
  enqueueDisplayCommand(c);
  c.mem.write8(PTR, (low + 1) & 0xff); // BUG: advance by one instead of two
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an under-advanced pointer — it is worthless");
  assert.equal(d.addr, PTR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/ptr: under-advanced pointer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
