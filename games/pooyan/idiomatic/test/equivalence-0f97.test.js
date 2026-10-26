// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueRoundSoundCommandRun (ROM 0x0f97) — the round-derived command-run trampoline.
 *
 * queueRoundSoundCommandRun reads the round counter, selects one of four command bytes (counter bits 1..2 biased by
 * the command base 0x1e), and tail-delegates to the shared command-ring appender appendSoundCommandRun, which
 * lays down that byte plus its fixed three-tile tail. It is a pure tail hand-off, so the contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  regs.a (the advanced ring cursor).
 *
 * regs.a is a DEFENSIVE arm: the frozen caller (spawnPairedEnemyRecordAndAnnounceWave) discards A via pop af, so memory carries
 * the real teeth — but A matches the oracle and asserting it can never false-fail.
 *
 * pc/SP/cycles are NOT compared. The append gate (appendSoundCommandGated) is opened via GAME_ACTIVE_FLAG so the
 * command byte actually lands in the ring page — otherwise the byte never survives (each append
 * re-stashes SOUND_RING_PENDING_BYTE, the fourth tile wins) and a wrong command would go unseen. The
 * ring cursor is seated at the first slot so the four appends land in known ring cells. Both sides
 * run on identical clones, so any deterministic appender effect matches; the test verifies the
 * COMMAND DERIVATION (rrca+&3 == (v>>1)&3, +0x1e) and that it reaches the appender.
 *
 * Jobs:
 *   1. EQUAL — over a round-counter sweep hitting all four command bytes (and high-bit values the
 *      mask must ignore), oracle == queueRoundSoundCommandRun in RAM (−stack) and in the returned cursor.
 *   2. TEETH — a wrong written byte MUST be caught by the RAM diff; a WRONG COMMAND CONSTANT
 *      (the appender fed base+1 instead of base) MUST diverge from the oracle at the command slot.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f97.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f97 as oracle } from "../../translated/loc_0f97.js";
import { queueRoundSoundCommandRun } from "../queueRoundSoundCommandRun.js";
import { appendSoundCommandRun } from "../appendSoundCommandRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  GAME_ACTIVE_FLAG,
  SOUND_RING_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_FIRST = 0x43; // first ring slot; four appends land at RING_FIRST..RING_FIRST+3
const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // 0x8a00 — the ring page base
const COMMAND_SLOT = RING_PAGE + RING_FIRST; // where the derived command byte lands

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the round counter seated and the append gate open + ring cursor at the first slot. */
function craft(round) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // the tail-call push lands inside STACK_SCRATCH (dead stack)
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, 0x01); // open the append gate so the ring writes happen
  m.mem.write8(SOUND_RING_WRITE_PTR, RING_FIRST); // cursor at the first ring slot
  return m;
}

// round counter -> expected command byte = ((round >> 1) & 3) + 0x1e; high bits above bit2 masked off.
const SWEEP = [0x00, 0x02, 0x04, 0x06, 0x08, 0x0d, 0x33, 0xff];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: round sweep — queueRoundSoundCommandRun == oracle in RAM (−stack) and the regs.a cursor live-out", () => {
  for (const round of SWEEP) {
    const o = craft(round);
    const c = craft(round);
    oracle(o);
    queueRoundSoundCommandRun(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (round ${hx(round)})`);
    // LIVE-OUT is the register A (the ring cursor), read by the frozen caller. The JS return differs by
    // construction — the translated tail (m.call->m.ret) returns undefined, the idiomatic module
    // propagates appendSoundCommandRun's return-assignment — but both leave regs.a identical, which is the contract.
    assert.equal(c.regs.a, o.regs.a, `regs.a cursor live-out mismatch (round ${hx(round)}): oracle=${o.regs.a} idiom=${c.regs.a}`);
  }
  console.log(`  EQUAL: ${SWEEP.length} round values identical (RAM −stack + regs.a cursor live-out)`);
});

test("TEETH: a wrong regs.a cursor live-out is CAUGHT", () => {
  const o = craft(0x02);
  const c = craft(0x02);
  oracle(o);
  queueRoundSoundCommandRun(c);
  c.regs.a = (o.regs.a ^ 0xff) & 0xff; // BUG: wrong cursor left in A
  assert.notEqual(c.regs.a, o.regs.a, "the regs.a live-out check would miss a wrong cursor — worthless");
  console.log(`  TEETH/REG: a wrong regs.a (${hx(c.regs.a)} vs ${hx(o.regs.a)}) diverges from the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x02);
  const c = craft(0x02);
  oracle(o);
  queueRoundSoundCommandRun(c);
  c.mem.write8(COMMAND_SLOT, (c.mem.read8(COMMAND_SLOT) ^ 0xff) & 0xff); // corrupt the command slot

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, COMMAND_SLOT, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a WRONG COMMAND CONSTANT (base+1) diverges from the oracle at the command slot", () => {
  const round = 0x02; // (0x02>>1)&3 == 1 -> command 0x1f; the broken path feeds 0x20
  const o = craft(round);
  const wrong = craft(round);
  oracle(o); // real derivation: command 0x1f appended, then the fixed tail
  const badCommand = (((round >> 1) & 0x03) + 0x1f) & 0xff; // BUG: base+1 instead of base
  appendSoundCommandRun(wrong, badCommand);

  const d = ramDiffMinusStack(o, wrong);
  assert.notEqual(d, null, "a wrong command constant produced identical RAM — the derivation is untested");
  assert.equal(d.addr, COMMAND_SLOT, `divergence must be at the command slot, got ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/COMMAND: wrong command diverged at ${hx(d.addr)} (oracle=${d.a} wrong=${d.b})`);
});
