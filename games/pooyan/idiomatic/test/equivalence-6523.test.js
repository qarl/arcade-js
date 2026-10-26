// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seatActorRecordAndQueueSpawnDisplay (ROM 0x6523, Pooyan) — "seat a fresh object record (IX) and
 * enqueue its display command". Bails when (IX+0 | IX+1) is odd or the signature-mismatch flag
 * (0x8ef0) is held; otherwise stamps the opening state, snapshots the frame-delay counter (0x8929)
 * into IX+6 and steps it down by two, then enqueues the object-spawn display command via the page-0x88
 * ring (rst 0x38 / enqueueDisplayCommand) — a second variant when the round counter (0x8907) is zero.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine writes work RAM, so
 * every case uses a FRESH clone per side, compared on RAM (dumpState, minus stack scratch below the entry SP).
 *
 * LIVE-OUT: none — memory-only. The sole caller (spawnActorGroupRecords) wraps the call in exx, preserving its own
 * registers, and reads no result register; so no register is part of the contract.
 *
 * Jobs:
 *   1. EQUAL (crafted) — proceed (round 0 -> two enqueues; round nonzero -> one), gate-1 bail
 *      (odd id), gate-2 bail (signature flag held): oracle == module in RAM (−stack).
 *   2. WRITE-SET — on the proceed/round-0 path oracle and module change the identical cell set;
 *      the two bail paths change nothing.
 *   3. TEETH — a twin that stamps a wrong record field is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6523.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6523 as oracle } from "../../translated/loc_6523.js";
import { seatActorRecordAndQueueSpawnDisplay } from "../seatActorRecordAndQueueSpawnDisplay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c48; // a work-RAM object-record base, disjoint from the globals/ring/stack below
const SIG_FLAG = 0x8ef0; // SIGNATURE_MISMATCH_FLAG
const DELAY = 0x8929; // FRAME_DELAY_COUNTER
const ROUND = 0x8907; // ROUND_COUNTER
const RING_PTR = 0x88a0; // DISPLAY_CMD_RING_WRITE_PTR
const RING_PAGE = 0x8800;
const RING_START = 0xc0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Sorted list of changed RAM addresses (whole dump minus stack scratch below the entry SP), for the WRITE-SET footprint.
 *  The dead stack is excluded because the oracle's rst/ret framing pushes return addresses there
 *  while the cycle-free module never touches the stack. */
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

/**
 * A fresh clone: record pre-dirtied, gates/counters seated, and the page-0x88 display ring set free
 * (slots 0xc0.. = 0xff) with its write pointer at the ring start so enqueues are deterministic.
 */
function craft({ id0 = 0xaa, id1 = 0xaa, sig = 0x00, delay = 0x1c, round = 0x00 } = {}) {
  const m = BASE.clone();
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8(REC + 0, id0);
  m.mem.write8(REC + 1, id1);
  m.mem.write8(SIG_FLAG, sig);
  m.mem.write8(DELAY, delay);
  m.mem.write8(ROUND, round);
  m.mem.write8(RING_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0xff); // all slots free
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead stack: the oracle's rst/ret framing touches excluded RAM only
  return m;
}

const CASES = [
  { name: "proceed, round 0 (two enqueues)", opts: { round: 0x00 } },
  { name: "proceed, round nonzero (one enqueue)", opts: { round: 0x05 } },
  { name: "bail: odd id word", opts: { id0: 0x01 } },
  { name: "bail: signature flag held", opts: { sig: 0x01 } },
  { name: "proceed, delay low (wraps on -2)", opts: { delay: 0x01, round: 0x00 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted proceed/bail cases — seatActorRecordAndQueueSpawnDisplay == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = craft(opts);
    const c = craft(opts);
    oracle(o);
    seatActorRecordAndQueueSpawnDisplay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: proceed/round-0 changes the identical cell set; both bails change nothing", () => {
  const oracleSet = changedAddrs(craft({ round: 0x00 }), oracle);
  const moduleSet = changedAddrs(craft({ round: 0x00 }), seatActorRecordAndQueueSpawnDisplay);
  assert.deepEqual(moduleSet, oracleSet, "module and oracle must change the identical cell set");
  // The footprint must include the seated record fields, the delay counter, and the ring pointer.
  for (const cell of [REC + 0, REC + 4, REC + 6, DELAY, RING_PTR]) {
    assert.ok(oracleSet.includes(cell), `footprint missing ${hx(cell)}`);
  }
  assert.deepEqual(changedAddrs(craft({ id0: 0x01 }), oracle), [], "odd-id bail must change nothing");
  assert.deepEqual(changedAddrs(craft({ sig: 0x01 }), oracle), [], "signature-held bail must change nothing");
  console.log(`  WRITE-SET: proceed/round-0 -> ${oracleSet.length} cells; both bails -> 0`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stamped record field is CAUGHT by the RAM diff", () => {
  const o = craft({ round: 0x00 });
  const c = craft({ round: 0x00 });
  oracle(o);
  seatActorRecordAndQueueSpawnDisplay(c);
  c.mem.write8(REC + 4, 0x14); // BUG: IX+4 must be stamped 0x15
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record field — it is worthless");
  assert.equal(d.addr, REC + 4, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong IX+4 field caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
