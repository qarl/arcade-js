// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLevelIntroFromPhase3 (ROM 0x6f5e, Pooyan) — level-intro phase-3 timing gate: while
 * the delay 0x8f48 reads exactly 0x20 tick the sub-count 0x8f52 (queue a sound each step, hold while
 * board-clear 0x89e5 is set); once the delay counts to zero reload it to 0x60 and, only on world 3,
 * run the 0x79-byte anti-tamper compare (0x0b32 vs its 0x7071 clone) before advancing the phase to
 * 0x8f51 = 6.
 *
 * The module calls the idiomatic enqueueDisplayCommand directly and keeps the tamper tail m.call(0x6df9) (an
 * unlifted anti-tamper clone, not in this batch); the oracle drives the same through the frozen
 * registry. advanceLevelIntroFromPhase3 is memory-only on every reachable exit (an intro-phase handler), so the register
 * file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * SP-TOOTH (R36): the tamper arm is a `return m.call(0x6df9)` tail. It is UNREACHABLE in a crafted
 * test — ROM is write-protected (a write throws), so a compare mismatch cannot be forced, and the
 * clone matches on the intact ROM — so the tooth asserts placeability on the reachable plain-return
 * paths (moved 0, the seam supplies the ret): a stray push in the rewrite would move SP and throw.
 * The seam mechanism is null-mutant-proven once per game in sp-seam-tooth.test.js.
 *
 * Jobs:
 *   1. EQUAL — delay-running / sub-count / board-hold / delay-expire / world-3 compare: oracle == mine.
 *   2. WRITE-SET — the sub-count ticks under the 0x20 delay; the phase advances to 6 at expiry.
 *   3. TEETH — a wrong phase byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the reachable plain-return paths are seam-placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6f5e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6f5e as oracle } from "../../translated/loc_6f5e.js";
import { advanceLevelIntroFromPhase3 } from "../advanceLevelIntroFromPhase3.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8f48; //      phase-3 delay / checksum word
const TALLY = 0x8f52; //      sub-count ticked under the 0x20 delay
const BOARDCLEAR = 0x89e5; // board-clear flag (holds the sub-count)
const ROUND = 0x8907; //      round counter (== 3 -> world-3 compare)
const PHASE = 0x8f51; //      intro-phase index (advanced to 6)
const RING_PTR = 0x88a0; //   display-command ring write pointer
const RING_SLOT = 0x88c0; //  first ring slot (free = 0xff)
const SP0 = 0x8fe0; //        inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // a caller-return word for the seam

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the delay / sub-count / board-clear / round seated and the display ring armed. */
function craft(delay, tally, boardClear, round) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[DELAY] = delay & 0xff;
  m.mem8[TALLY] = tally & 0xff;
  m.mem8[BOARDCLEAR] = boardClear & 0xff;
  m.mem8[ROUND] = round & 0xff;
  m.mem8[RING_PTR] = 0xc0; // ring write pointer at the ring start
  m.mem8[RING_SLOT] = 0xff; // slot free so enqueueDisplayCommand actually enqueues
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: delay / sub-count / board-hold / expire / world-3 — advanceLevelIntroFromPhase3 == oracle in RAM (−stack)", () => {
  const cases = [
    { delay: 0x05, tally: 0x00, bc: 0x00, round: 0x00, label: "delay running -> return" },
    { delay: 0x20, tally: 0x05, bc: 0x00, round: 0x00, label: "sub-count ticks (queue sound)" },
    { delay: 0x20, tally: 0x05, bc: 0x01, round: 0x00, label: "board-clear holds the sub-count" },
    { delay: 0x20, tally: 0x00, bc: 0x00, round: 0x00, label: "sub-count zero -> fall to delay tick" },
    { delay: 0x01, tally: 0x00, bc: 0x00, round: 0x00, label: "delay expire, not world 3 -> phase 6" },
    { delay: 0x01, tally: 0x00, bc: 0x00, round: 0x03, label: "delay expire, world 3 -> compare + phase 6" },
  ];
  for (const { delay, tally, bc, round, label } of cases) {
    const o = craft(delay, tally, bc, round);
    oracle(o);
    const c = craft(delay, tally, bc, round);
    advanceLevelIntroFromPhase3(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} delay/sub-count/world-3 paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the sub-count ticks under the 0x20 delay; the phase advances at expiry", () => {
  const sub = craft(0x20, 0x05, 0x00, 0x00);
  oracle(sub);
  assert.equal(sub.mem8[TALLY], 0x04, "0x20 delay -> sub-count decremented");

  const expire = craft(0x01, 0x00, 0x00, 0x00);
  oracle(expire);
  assert.equal(expire.mem8[PHASE], 0x06, "delay expiry -> intro phase advanced to 6");
  assert.equal(expire.mem8[DELAY], 0x60, "delay expiry -> delay reloaded to 0x60");
  console.log("  WRITE-SET: sub-count ticks under 0x20; phase -> 6 and delay -> 0x60 at expiry");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01, 0x00, 0x00, 0x00);
  const c = craft(0x01, 0x00, 0x00, 0x00);
  oracle(o);
  advanceLevelIntroFromPhase3(c);
  c.mem8[PHASE] = 0x00; // BUG: expiry must have written phase 6
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase byte — it is worthless");
  assert.equal(d.addr, PHASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the reachable plain-return paths are seam-placeable (no stray push)", () => {
  for (const [label, delay, round] of [["delay running", 0x05, 0x00], ["expire, not world 3", 0x01, 0x00]]) {
    const r = seamPlaceable(withOmittedRet, advanceLevelIntroFromPhase3, 0x6f5e, craft(delay, 0x00, 0x00, round));
    assert.equal(r.placeable, true, `[${label}] plain-return arm must be seam-placeable; got: ${r.error}`);
  }
  console.log("  SP-TOOTH: plain-return paths seam-placeable (moved 0, seam supplies the ret)");
});
