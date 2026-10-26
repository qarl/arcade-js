// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for flagTamperOnRound5ChecksumMiss (ROM 0x5b06) — an anti-tamper guard
 * armed only at round 5: sum six ROM bytes (byte-carry counted separately), and if
 * (lowSum + carryCount + 0x7f) does NOT wrap to 0 the ROM was altered, so bump TAMPER_FREEZE_FLAG.
 * At any other round it touches nothing.
 *
 * CYCLE-FREE / memory-equivalence gate. The only observable effect is the possible increment of
 * TAMPER_FREEZE_FLAG, so the go-forward contract is RAM only (dumpState minus stack scratch below the entry SP); the
 * caller (runActorUpdatePipeline) ignores A and the flags.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x5b06 in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Both the guarded round (checksum runs over the real ROM) and
 *      other rounds (early return) must leave RAM identical to the oracle, for varied flag seeds.
 *   3. TEETH — a twin that writes a WRONG TAMPER_FREEZE_FLAG MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5b06.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5b06 as oracle } from "../../translated/loc_5b06.js";
import { flagTamperOnRound5ChecksumMiss } from "../flagTamperOnRound5ChecksumMiss.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_COUNTER, TAMPER_FREEZE_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x5b06;
const GUARDED_ROUND = 0x05;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A fresh machine with ROUND_COUNTER and TAMPER_FREEZE_FLAG seeded; SP parked in dead-stack. */
function craft(round, flag) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(TAMPER_FREEZE_FLAG, flag & 0xff);
  return m;
}

// (round, flag) pairs: the guarded round (checksum path) and other rounds (early return), each with
// a couple of flag seeds so a spurious/absent write shows up as a RAM diff.
const CASES = [
  [GUARDED_ROUND, 0x00],
  [GUARDED_ROUND, 0x07],
  [0x00, 0x00],
  [0x03, 0x05],
  [0x04, 0x00], // round 4 -- one below the guard, must still early-return
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x5b06 dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    flagTamperOnRound5ChecksumMiss(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: guarded round runs the checksum, other rounds early-return — RAM identical", () => {
  for (const [round, flag] of CASES) {
    const o = craft(round, flag);
    const c = craft(round, flag);
    oracle(o);
    flagTamperOnRound5ChecksumMiss(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `round ${hx(round)} flag ${hx(flag)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    // A non-guarded round must leave the flag exactly as seeded (pure early return).
    if (round !== GUARDED_ROUND) {
      assert.equal(c.mem.read8(TAMPER_FREEZE_FLAG), flag & 0xff, `round ${hx(round)}: flag must be untouched`);
    }
  }
  console.log(`  CRAFTED: ${CASES.length} (round,flag) cases agree`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: always perturbs TAMPER_FREEZE_FLAG (+2) regardless of the checksum — must be caught. */
function brokenGuard(m) {
  flagTamperOnRound5ChecksumMiss(m);
  m.mem.write8(TAMPER_FREEZE_FLAG, (m.mem.read8(TAMPER_FREEZE_FLAG) + 2) & 0xff); // BUG
}

test("TEETH: a wrong TAMPER_FREEZE_FLAG is CAUGHT", () => {
  let caught = null;
  for (const [round, flag] of CASES) {
    const o = craft(round, flag);
    const c = craft(round, flag);
    oracle(o);
    brokenGuard(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong flag — it is worthless");
  assert.equal(caught.addr, TAMPER_FREEZE_FLAG, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong flag caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
