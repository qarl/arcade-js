// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for sendSoundCommand (ROM 0x0e8f) — send the sound command in A to the audio
 * CPU: latch it at the sound port, then strobe the audio-IRQ LS259 bit (1) high and low.
 *
 * The effects land in board I/O, NOT in the dumped RAM (the sound latch and the LS259 are Io state,
 * not work/video/sprite RAM), so the load-bearing contract here is the Io state: io.soundData and
 * io.latch. The RAM diff is kept as a (trivially-null) regression check. Oracle runs on one clone,
 * the module on another, from the same crafted A.
 *
 * NOTE: this file imports SOUND_COMMAND_LATCH / AUDIO_IRQ_LATCH from names.js — the lead has not yet
 * named those two audio-latch cells (flagged in the batch return, unnamed_addrs). Until they land in
 * names.js the module writes through `undefined` and this test fails by design; it goes green on the
 * name merge with no other change. (Logic verified meanwhile via scratchpad, see the batch notes.)
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x0e8f in a real run; any dispatch must agree in Io state.
 *   2. CRAFTED — the load-bearing arm. Varied command bytes; both sides latch the same soundData and
 *      leave the same LS259 (bit 1 pulsed back to 0).
 *   3. TEETH — a twin that latches a WRONG command byte MUST be caught in io.soundData; a twin that
 *      leaves the audio-IRQ bit high MUST be caught in io.latch.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0e8f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e8f as oracle } from "../../translated/loc_0e8f.js";
import { sendSoundCommand } from "../sendSoundCommand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x0e8f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Compare the two Io surfaces this routine can touch: the sound latch and the LS259. */
function ioDiff(ma, mb) {
  if (ma.io.soundData !== mb.io.soundData) {
    return `soundData: ${hx(ma.io.soundData)} vs ${hx(mb.io.soundData)}`;
  }
  for (let i = 0; i < ma.io.latch.length; i++) {
    if (ma.io.latch[i] !== mb.io.latch[i]) return `latch[${i}]: ${ma.io.latch[i]} vs ${mb.io.latch[i]}`;
  }
  return null;
}

function craft(command) {
  const m = new Machine(ROM);
  m.regs.a = command & 0xff;
  return m;
}

const COMMANDS = [0x00, 0x01, 0x42, 0x80, 0xff];

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

const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0e8f dispatches — module == oracle in Io state", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    sendSoundCommand(c);
    assert.equal(ioDiff(o, c), null, `Io diff: ${ioDiff(o, c)}`);
    assert.equal(ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp)), null, "RAM should be identical (audio writes are Io, not RAM)");
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: varied command bytes — same soundData latched, LS259 identical, RAM untouched", () => {
  for (const command of COMMANDS) {
    const o = craft(command);
    const c = craft(command);
    oracle(o);
    sendSoundCommand(c);

    assert.equal(ioDiff(o, c), null, `command ${hx(command)}: ${ioDiff(o, c)}`);
    assert.equal(c.io.soundData, command, `command ${hx(command)}: soundData latched`);
    assert.equal(c.io.latch[1], 0, `command ${hx(command)}: audio-IRQ bit pulsed back to 0`);
    assert.equal(ramDiffMinusStack(o, c), null, `command ${hx(command)}: RAM identical`);
  }
  console.log(`  CRAFTED: ${COMMANDS.length} command bytes latched identically`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: latches the WRONG command byte. */
function brokenCommand(m, command = m.regs.a) {
  sendSoundCommand(m, (command ^ 0x01) & 0xff); // BUG: corrupt bit 0 of the command
}

/** Broken twin: leaves the audio-IRQ latch bit high. */
function brokenStrobe(m, command = m.regs.a) {
  const { mem8 } = m;
  sendSoundCommand(m, command);
  mem8[0xa181] = 1; // BUG: never lower the audio-IRQ bit
}

test("TEETH: a wrong command byte is CAUGHT in io.soundData", () => {
  let caught = false;
  for (const command of COMMANDS) {
    const o = craft(command);
    const c = craft(command);
    oracle(o);
    brokenCommand(c);
    if (ioDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(caught, "the gate FAILED to catch a wrong command byte — it is worthless");
  console.log("  TEETH: a wrong command byte differs in io.soundData");
});

test("TEETH: a stuck-high audio-IRQ bit is CAUGHT in io.latch", () => {
  let caught = false;
  for (const command of COMMANDS) {
    const o = craft(command);
    const c = craft(command);
    oracle(o);
    brokenStrobe(c);
    if (ioDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(caught, "the gate FAILED to catch a stuck audio-IRQ bit — it is worthless");
  console.log("  TEETH: a stuck-high audio-IRQ bit differs in io.latch");
});
