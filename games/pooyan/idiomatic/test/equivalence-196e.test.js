// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armSirenAndTickWaveEventCountdown (ROM 0x196e, Pooyan) — the gated periodic siren/event driver.
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and armSirenAndTickWaveEventCountdown on the other, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * pc/SP/cycles are NOT compared, and there is no register live-out: the caller (runActiveGameplayFrame) runs this
 * as one of fourteen sequential sub-handlers and reads no register back, so the contract is memory.
 *
 * INPUTS: the mode latch 0x8d55, SPAWN_PHASE_COUNTER 0x8902, GRAB_ACTIVE_FLAG 0x8d32, the siren gate
 * 0x8d68, WAVE_EVENT_LATCH 0x8d21, WAVE_TEARDOWN_STATE 0x8f24, the event timer 0x8d22, and HL — HL is
 * consumed only on the mode-5 + grab-active sub-path (it names the pair to arm), so it is seated too.
 * The boundary sound/command runs land on the page-0x8a rings, the callees' own domain.
 *
 * Jobs:
 *   1. EQUAL — over busy / mode>5 / mode==5 (siren-free & grab-active & occupied) / mode<5 /
 *      tail-bail cases spanning both the timer-expiry (draw) and tick-down tails, oracle == armSirenAndTickWaveEventCountdown
 *      in RAM (−stack).
 *   2. WRITE-SET — the mode==5 expiry case arms the siren pair + reloads the timer + sets the latch;
 *      the mode>5 case latches the mode + ticks the timer.
 *   3. TEETH — a wrong armed cell is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-196e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_196e as oracle } from "../../translated/loc_196e.js";
import { armSirenAndTickWaveEventCountdown } from "../armSirenAndTickWaveEventCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const MODE_LATCH = 0x8d55;
const SPAWN_PHASE = 0x8902;
const GRAB = 0x8d32;
const SIREN_GATE = 0x8d68;
const SIREN_CD = 0x8d6a; //  siren gate low byte + 2
const WAVE_LATCH = 0x8d21;
const TEARDOWN = 0x8f24;
const EVENT_TIMER = 0x8d22;
const SCRATCH_PAIR = 0x8d90; // isolated work-RAM cell used as the grab-active HL pair

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the driver's gate cells + HL seated (defaults: all gates clear, timer 0x05). */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; boundary calls only touch it there
  m.regs.hl = (spec.hl ?? SCRATCH_PAIR) & 0xffff;
  m.mem8[MODE_LATCH] = (spec.modeLatch ?? 0x00) & 0xff;
  m.mem8[SPAWN_PHASE] = (spec.mode ?? 0x00) & 0xff;
  m.mem8[GRAB] = (spec.grab ?? 0x00) & 0xff;
  m.mem8[SIREN_GATE] = (spec.sirenGate ?? 0x00) & 0xff;
  m.mem8[WAVE_LATCH] = (spec.waveLatch ?? 0x00) & 0xff;
  m.mem8[TEARDOWN] = (spec.teardown ?? 0x00) & 0xff;
  m.mem8[EVENT_TIMER] = (spec.timer ?? 0x05) & 0xff;
  return m;
}

const CASES = [
  { name: "busy: mode latch nonzero -> immediate return", modeLatch: 0x07 },
  { name: "mode>5: latch the mode, fire the higher-mode run, tail tick-down", mode: 0x06, timer: 0x03 },
  { name: "mode==5 free siren + timer expiry: arm the pair, fire the run, reload+latch",
    mode: 0x05, sirenGate: 0x00, timer: 0x00 },
  { name: "mode==5 + grab active: arm the caller HL pair, tail tick-down",
    mode: 0x05, grab: 0x01, hl: SCRATCH_PAIR, timer: 0x03 },
  { name: "mode==5 siren occupied: no arm, tail tick-down", mode: 0x05, sirenGate: 0x09, timer: 0x03 },
  { name: "mode<5 + timer expiry: no arm, tail draws the siren run (gate clear)",
    mode: 0x03, sirenGate: 0x00, timer: 0x00 },
  { name: "tail bail: wave event latch set -> return after mode", mode: 0x03, waveLatch: 0x01, timer: 0x04 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted driver cases — armSirenAndTickWaveEventCountdown == oracle in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    armSirenAndTickWaveEventCountdown(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted driver cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: mode==5 + expiry arms the siren pair, reloads the timer, sets the latch", () => {
  const m = craft({ mode: 0x05, sirenGate: 0x00, timer: 0x00 });
  oracle(m);
  assert.equal(m.mem8[SIREN_GATE], 0x01, "siren gate armed");
  assert.equal(m.mem8[SIREN_CD], 0x01, "siren countdown armed (low byte + 2)");
  assert.equal(m.mem8[EVENT_TIMER], 0x20, "event timer reloaded to 0x20");
  assert.equal(m.mem8[WAVE_LATCH], 0x01, "wave event latch set");
  console.log(`  WRITE-SET: siren pair + timer 0x20 + latch (sound rings = callee domain)`);
});

test("WRITE-SET: mode>5 latches the mode and ticks the event timer down", () => {
  const m = craft({ mode: 0x06, timer: 0x03 });
  oracle(m);
  assert.equal(m.mem8[MODE_LATCH], 0x06, "mode latched into 0x8d55");
  assert.equal(m.mem8[EVENT_TIMER], 0x02, "event timer 0x03 -> 0x02");
  console.log(`  WRITE-SET: mode latch = 0x06, timer 0x03 -> 0x02`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong armed siren cell is CAUGHT by the RAM diff", () => {
  const spec = { mode: 0x05, sirenGate: 0x00, timer: 0x00 };
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  armSirenAndTickWaveEventCountdown(c);
  c.mem8[SIREN_CD] = 0x00; // BUG: the second armed cell must be 0x01

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong armed cell — it is worthless");
  assert.equal(d.addr, SIREN_CD, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong armed cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
