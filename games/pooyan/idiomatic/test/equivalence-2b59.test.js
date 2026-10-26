// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for checksumIntegrityStripAndDispatchSpawn (ROM 0x2b59, Pooyan) — the integrity-strip reset scan. It
 * always blanks an eight-tall attribute column to the base attribute value, then checksums a
 * ten-byte integrity strip (same upward stride). Unless the strip sums to the magic total it
 * returns with nothing else changed; on the magic sum it clears the reset latch and hands off by
 * the two-player and active-player flags — to the ready-sprite painter, the formation-spawn scan,
 * or the shared spawn epilogue.
 *
 * SEATING: BALANCED / TAIL-CALL. The checksum-mismatch path is a plain ret; the three magic-sum
 * paths tail-delegate. The delegatees (0x2bd2, 0x2bb3, 0x2b8d) are already decompiled and imported;
 * the oracle drives their frozen twins, so each side walks equivalent downstream code. The epilogue
 * case seats the lead-actor state below quorum so the epilogue is a shallow return.
 *
 * LIVE-OUT: none — memory only; equivalence is RAM (dumpState) minus stack scratch below SP0 (below the oracle's exit SP on the painter arm, which consumes and rewrites its SP0 byte).
 *
 * Cases are CRAFTED: a plain boot does not seat the strip checksum or the hand-off flags.
 *
 * Jobs:
 *   1. EQUAL — mismatch (blank + return), and the three magic-sum hand-offs (single-player,
 *      player-2 idle, and the below-quorum epilogue): oracle == module in RAM (−stack).
 *   2. WRITE-SET — mismatch blanks the column but leaves the latch armed; a magic sum blanks the
 *      column AND clears the latch.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a no-blank twin (skips the column
 *      reset) diverges; a checksum-blind twin (clears the latch on a mismatch) diverges at the latch.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2b59.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b59 as oracle } from "../../translated/loc_2b59.js";
import { checksumIntegrityStripAndDispatchSpawn } from "../checksumIntegrityStripAndDispatchSpawn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ATTR_TOP = 0x855f; // attribute column blanked (stride -0x20)
const STRIP = 0x82bc; // integrity strip summed (stride -0x20)
const LATCH = 0x8e2a; // RESET_SCAN_LATCH
const TWO_PLAYER = 0x880e;
const ACTIVE_PLAYER = 0x880d;
const LEAD_STATE = 0x8a82; // LEAD_ACTOR_STATE; below 3 the epilogue returns at once
const IX_BASE = 0x8c60; // formation record base; checksumIntegrityStripAndDispatchSpawn inherits IX (never sets it) into scanFormationSlotsAndLaunchFree
const ROW = 0x20;
const MAGIC = 0xaa;
const SP0 = 0x8ff0;
const SEED = 0xee; // pre-dirty the column so the blank is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const colCells = () => Array.from({ length: 8 }, (_, k) => (ATTR_TOP - k * ROW) & 0xffff);
const stripCells = () => Array.from({ length: 10 }, (_, k) => (STRIP - k * ROW) & 0xffff);

// Only the painter arm hands to 0x2bd2 (inc sp, call 0x3325, misaligned ret): it rewrites the SP0 byte it consumed and
// pops past it, so there the live frame starts at the oracle's exit SP. Every other arm compares from SP0.
function ramDiffMinusStack(ma, mb, floor = SP0) {
  const dead = deadStackBelow(STACK_SCRATCH, floor);
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** Seat SP, the latch, the column, and a strip that sums to `checksum`. */
function seat(m, { checksum, twoPlayer = 0, activePlayer = 0, leadState = 0 }) {
  m.regs.sp = SP0;
  m.regs.ix = IX_BASE; // inherited base for the formation-spawn scan (checksumIntegrityStripAndDispatchSpawn -> scanFormationSlotsAndLaunchFree)
  m.mem.write8(LATCH, 0x01); // armed; a magic sum clears it
  m.mem.write8(TWO_PLAYER, twoPlayer);
  m.mem.write8(ACTIVE_PLAYER, activePlayer);
  m.mem.write8(LEAD_STATE, leadState);
  for (const c of colCells()) m.mem.write8(c, SEED);
  const strip = stripCells();
  for (const c of strip) m.mem.write8(c, 0x00);
  m.mem.write8(strip[0], checksum & 0xff); // single nonzero byte -> sum == checksum
  return m;
}

const craftMismatch = () => seat(BASE.clone(), { checksum: 0x00 }); // sum 0 != magic -> return
const craftSingle = () => seat(BASE.clone(), { checksum: MAGIC, twoPlayer: 0 }); // -> ready-sprite painter
const craftPlayer2 = () => seat(BASE.clone(), { checksum: MAGIC, twoPlayer: 1, activePlayer: 0 }); // -> formation scan
const craftEpilogue = () => seat(BASE.clone(), { checksum: MAGIC, twoPlayer: 1, activePlayer: 1, leadState: 0 });

const CASES = [
  { name: "checksum mismatch -> blank + return", craft: craftMismatch },
  { name: "magic sum, single player -> painter", craft: craftSingle, consumesEntryByte: true },
  { name: "magic sum, player-2 idle -> formation scan", craft: craftPlayer2 },
  { name: "magic sum, below quorum -> epilogue return", craft: craftEpilogue },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: checksumIntegrityStripAndDispatchSpawn == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    checksumIntegrityStripAndDispatchSpawn(c);
    const d = ramDiffMinusStack(o, c, cfg.consumesEntryByte ? Math.max(SP0, o.regs.sp) : SP0);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: mismatch blanks but keeps the latch; a magic sum blanks AND clears the latch", () => {
  const miss = craftMismatch();
  checksumIntegrityStripAndDispatchSpawn(miss);
  for (const c of colCells()) assert.equal(miss.mem.read8(c), 0x10, `column cell ${hx(c)} blanked`);
  assert.equal(miss.mem.read8(LATCH), 0x01, "a mismatch leaves the reset latch armed");

  const hit = craftEpilogue();
  checksumIntegrityStripAndDispatchSpawn(hit);
  for (const c of colCells()) assert.equal(hit.mem.read8(c), 0x10, `column cell ${hx(c)} blanked`);
  assert.equal(hit.mem.read8(LATCH), 0x00, "a magic sum clears the reset latch");
  console.log("  WRITE-SET: mismatch keeps latch; magic sum clears it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftMismatch();
  const c = craftMismatch();
  oracle(o);
  checksumIntegrityStripAndDispatchSpawn(c);
  c.mem.write8(ATTR_TOP, (o.mem.read8(ATTR_TOP) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted column byte");
  assert.equal(d.addr, ATTR_TOP, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a no-blank twin and a checksum-blind twin are CAUGHT", () => {
  // no-blank: skips the column reset the routine always performs
  const o1 = craftMismatch();
  const twin1 = craftMismatch();
  oracle(o1);
  const d1 = ramDiffMinusStack(o1, twin1); // twin1 does nothing
  assert.notEqual(d1, null, "the gate FAILED to catch a skipped column blank");
  assert.ok(colCells().includes(d1.addr), `no-blank teeth caught wrong address ${hx(d1.addr ?? 0)}`);

  // checksum-blind: clears the latch even on a mismatch
  const o2 = craftMismatch();
  const twin2 = craftMismatch();
  oracle(o2);
  checksumIntegrityStripAndDispatchSpawn(twin2);
  twin2.mem.write8(LATCH, 0x00); // the defect a checksum-blind clear would leave
  const d2 = ramDiffMinusStack(o2, twin2);
  assert.notEqual(d2, null, "the gate FAILED to catch a latch cleared on a mismatch");
  assert.equal(d2.addr, LATCH, `checksum-blind teeth caught wrong address ${hx(d2.addr ?? 0)}`);
  console.log(`  TEETH: no-blank at ${hx(d1.addr)}, checksum-blind at ${hx(d2.addr)}`);
});
