// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for retreatTileAnimScript (ROM 0x23ec) — "odd-frame gate + tile-animation
 * cursor retreat". Bumps the parity gate 0x8f37 and returns on odd frames (bit0 set). On an even frame
 * it walks the cursor byte at (0x88be): a 0x34 marker reloads to 0x10 and steps the pointer back one
 * (past the high byte), any other value is decremented in place; the pointer is stored back to 0x88be.
 * Memory-only (plain-ret): no register or flag survives, so the whole contract is:
 *
 *     RAM (dumpState minus stack scratch below the entry SP).
 *
 * retreatTileAnimScript WRITES RAM, so each case uses a FRESH clone per side. Compared on un-booted
 * Machines (LS259 NMI latch clear at power-on -> the oracle's few T-states fire no NMI).
 *
 * Jobs:
 *   1. ODD FRAME       — gate bumped, cursor untouched, RAM identical (early return path).
 *   2. EVEN / == 0x34  — byte reloaded to 0x10, pointer backed up one, stored to 0x88be; RAM identical.
 *   3. EVEN / != 0x34  — byte decremented in place (incl. 0x00 -> 0xff wrap), pointer unchanged.
 *   4. TEETH           — a twin writing a WRONG cursor byte MUST be caught at the cursor address.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-23ec.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23ec as oracle } from "../../translated/loc_23ec.js";
import { retreatTileAnimScript } from "../retreatTileAnimScript.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TILE_ANIM_PARITY, TILE_ANIM_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const PTR = 0x8500; // a video-RAM cursor target (the live cursor rides the 0x84xx tilemap)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seed the parity gate, the cursor word (-> PTR), and the byte the cursor points at. */
function craft(gate, byteAtPtr) {
  const m = new Machine(ROM);
  m.mem.write8(TILE_ANIM_PARITY, gate & 0xff);
  m.mem.write16(TILE_ANIM_CURSOR, PTR);
  m.mem.write8(PTR, byteAtPtr & 0xff);
  return m;
}

// gate: 0x00 -> inc 0x01 (odd, early return); 0x01 -> inc 0x02 (even, run).
const CASES = [
  { name: "odd frame (early return)", gate: 0x00, byte: 0x34 },
  { name: "even, byte == 0x34 (reload + back up)", gate: 0x01, byte: 0x34 },
  { name: "even, byte != 0x34 (dec in place)", gate: 0x01, byte: 0x20 },
  { name: "even, byte == 0x00 (dec wraps to 0xff)", gate: 0x01, byte: 0x00 },
];

test("CRAFTED: every path — RAM identical (gate, cursor byte, cursor word)", () => {
  for (const { name, gate, byte } of CASES) {
    const o = craft(gate, byte);
    const c = craft(gate, byte);
    oracle(o);
    retreatTileAnimScript(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${CASES.length} paths matched (odd gate, 0x34 reload, dec, dec-wrap)`);
});

test("EFFECTS: the module lands the expected bytes on each even path (positive control)", () => {
  // Odd frame: only the gate advances.
  let m = craft(0x00, 0x34); retreatTileAnimScript(m);
  assert.equal(m.mem.read8(TILE_ANIM_PARITY), 0x01, "odd: gate bumped");
  assert.equal(m.mem.read8(PTR), 0x34, "odd: cursor byte untouched");
  assert.equal(m.mem.read16(TILE_ANIM_CURSOR), PTR, "odd: cursor word untouched");

  // Even, 0x34: reload + back up.
  m = craft(0x01, 0x34); retreatTileAnimScript(m);
  assert.equal(m.mem.read8(PTR), 0x10, "even/0x34: byte reloaded to 0x10");
  assert.equal(m.mem.read16(TILE_ANIM_CURSOR), (PTR - 1) & 0xffff, "even/0x34: pointer backed up one");

  // Even, non-0x34: dec in place, pointer unchanged.
  m = craft(0x01, 0x20); retreatTileAnimScript(m);
  assert.equal(m.mem.read8(PTR), 0x1f, "even/dec: byte decremented");
  assert.equal(m.mem.read16(TILE_ANIM_CURSOR), PTR, "even/dec: pointer unchanged");

  // Even, 0x00: byte wraps to 0xff (store-truncation path).
  m = craft(0x01, 0x00); retreatTileAnimScript(m);
  assert.equal(m.mem.read8(PTR), 0xff, "even/dec: 0x00 wraps to 0xff");
});

test("TEETH: a wrong cursor byte is CAUGHT at the cursor address", () => {
  const broken = (m) => {
    retreatTileAnimScript(m);
    m.mem.write8(PTR, (m.mem.read8(PTR) ^ 0x01) & 0xff); // BUG: corrupt the walked byte
  };
  const o = craft(0x01, 0x20);
  const c = craft(0x01, 0x20);
  oracle(o);
  broken(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cursor byte — it is worthless");
  assert.equal(d.addr, PTR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong cursor byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
