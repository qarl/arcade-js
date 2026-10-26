// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickActorAnimHold (ROM 0x5d1e) — advance one actor's animation-hold
 * countdown at IX. Gated off unless (rec+0x0b bit0) is set OR ROUND_COUNTER bit0 is clear; then
 * requires the record active (rec+0x00 bit0) and armed (rec+0x16 bit1). Decrements the hold timer
 * (rec+0x12); on underflow it steps the 2-bit phase (rec+0x13), re-arming (rec+0x16)=1 while phase
 * remains, or 0 at phase end.
 *
 * CYCLE-FREE / memory-equivalence gate: the routine WRITES RAM, so every case uses a FRESH clone
 * per side. The go-forward contract is RAM only (dumpState minus stack scratch below the entry SP): the caller
 * (tickEnemyActorAnimHolds) banks its loop state via exx and reads no register back, so there is no register
 * live-out.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x5d1e in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Records crafted to exercise every branch (both gate paths,
 *      inactive/unarmed early returns, timer-still-running, timer-wrap, phase-step, phase-end).
 *   3. TEETH — a twin that writes a WRONG record byte MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5d1e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5d1e as oracle } from "../../translated/loc_5d1e.js";
import { tickActorAnimHold } from "../tickActorAnimHold.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x5d1e;
const REC = 0x8ae0; // a stride-0x18 object record in work RAM (the real base tickEnemyActorAnimHolds walks)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A fresh machine: ROUND_COUNTER seeded, plus the five record cells the routine reads/writes. */
function craft({ round, animBit, active, armed, timer, phase }) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(REC + 0x0b, animBit & 0xff);
  m.mem.write8(REC + 0x00, active & 0xff);
  m.mem.write8(REC + 0x16, armed & 0xff);
  m.mem.write8(REC + 0x12, timer & 0xff);
  m.mem.write8(REC + 0x13, phase & 0xff);
  m.regs.ix = REC;
  return m;
}

// Branch coverage. round bit0=0 opens the global gate; animBit bit0 opens the per-record gate.
// active bit0 / armed bit1 must both hold to reach the timer. timer wraps 0->0xff.
const CASES = [
  // gate via even round; timer underflows; phase steps down (armed <- 1)
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x01, phase: 0x02 },
  // phase-step with HIGH bits set: guards the &0x03 mask on the step store (masked 0x02-1, not 0xfe-1)
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x01, phase: 0xfe },
  // gate via even round; timer underflows; phase already 0 -> disarm (armed <- 0)
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x01, phase: 0x00 },
  // phase high bits set but low 2 bits zero -> still phase-end path
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x01, phase: 0xfc },
  // timer still running (dec to nonzero) -> early return
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x05, phase: 0x03 },
  // timer wraps 0 -> 0xff (nonzero) -> early return; proves the u8 wrap
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x00, phase: 0x03 },
  // not armed (bit1 clear) -> early return
  { round: 0x00, animBit: 0x00, active: 0x01, armed: 0x00, timer: 0x04, phase: 0x02 },
  // record inactive (bit0 clear) -> early return
  { round: 0x00, animBit: 0x00, active: 0x00, armed: 0x02, timer: 0x04, phase: 0x02 },
  // gate fully closed: no per-record bit AND odd round -> pure early return (nothing touched)
  { round: 0x01, animBit: 0x00, active: 0x01, armed: 0x02, timer: 0x01, phase: 0x02 },
  // per-record animate bit overrides an odd round -> proceeds; phase steps down
  { round: 0x01, animBit: 0x01, active: 0x01, armed: 0x02, timer: 0x01, phase: 0x03 },
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

test("CAPTURE: real 0x5d1e dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    tickActorAnimHold(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: every branch — record mutations identical to the oracle", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    const c = craft(spec);
    oracle(o);
    tickActorAnimHold(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${JSON.stringify(spec)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    // The module must match the oracle byte-for-byte on the two cells it may rewrite.
    assert.equal(c.mem.read8(REC + 0x12), o.mem.read8(REC + 0x12), `${JSON.stringify(spec)}: timer cell`);
    assert.equal(c.mem.read8(REC + 0x13), o.mem.read8(REC + 0x13), `${JSON.stringify(spec)}: phase cell`);
    assert.equal(c.mem.read8(REC + 0x16), o.mem.read8(REC + 0x16), `${JSON.stringify(spec)}: armed cell`);
  }
  console.log(`  CRAFTED: ${CASES.length} branch cases agree`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: perturbs the armed byte (rec+0x16) regardless of branch — must be caught. */
function brokenTick(m) {
  tickActorAnimHold(m);
  const bad = (REC + 0x16) & 0xffff;
  m.mem.write8(bad, (m.mem.read8(bad) ^ 0x02) & 0xff); // BUG: wrong armed state
}

test("TEETH: a wrong record byte is CAUGHT", () => {
  let caught = null;
  for (const spec of CASES) {
    const o = craft(spec);
    const c = craft(spec);
    oracle(o);
    brokenTick(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(caught.addr, (REC + 0x16) & 0xffff, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
