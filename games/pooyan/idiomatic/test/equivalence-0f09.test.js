// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for emitPresetSound (ROM 0x0f09) — emit the preset sound command 0x0b: load A
 * with 0x0b and tail into the sound sender (loc_0e8f / sendSoundCommand), which latches the
 * command byte and strobes the audio-IRQ LS259 bit high then low.
 *
 * The effects land in board I/O, NOT in dumped RAM (the sound latch and the LS259 are Io
 * state), so the load-bearing contract is the Io surface: io.soundData and io.latch. The RAM
 * diff is kept as a (trivially-null) regression check. The oracle runs on one fresh Machine,
 * the module on another, from the same power-on state. emitPresetSound supplies its own command, so
 * nothing is seated.
 *
 * pc/SP/cycles are NOT compared. No register survives for a caller (the sender leaves A=0,
 * unread), so there is no register live-out — the contract is purely Io + (null) RAM.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x0f09 in a real run; any dispatch must agree in Io state.
 *   2. CRAFTED — the load-bearing arm: both sides latch soundData=0x0b and leave the audio-IRQ
 *      bit pulsed back to 0, RAM untouched.
 *   3. TEETH — a twin that latches a WRONG command byte MUST be caught in io.soundData; a twin
 *      that leaves the audio-IRQ bit high MUST be caught in io.latch.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f09.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f09 as oracle } from "../../translated/loc_0f09.js";
import { emitPresetSound } from "../emitPresetSound.js";
import { sendSoundCommand } from "../sendSoundCommand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x0f09;
const SOUND_CMD = 0x0b; // the fixed command emitPresetSound emits
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Compare the two Io surfaces this routine can touch: the sound latch and the LS259. */
function ioDiff(ma, mb) {
  if (ma.io.soundData !== mb.io.soundData) return `soundData: ${hx(ma.io.soundData)} vs ${hx(mb.io.soundData)}`;
  for (let i = 0; i < ma.io.latch.length; i++) {
    if (ma.io.latch[i] !== mb.io.latch[i]) return `latch[${i}]: ${ma.io.latch[i]} vs ${mb.io.latch[i]}`;
  }
  return null;
}

function craft() {
  return new Machine(ROM);
}

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

test("CAPTURE: real 0x0f09 dispatches — module == oracle in Io state", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    emitPresetSound(c);
    assert.equal(ioDiff(o, c), null, `Io diff: ${ioDiff(o, c)}`);
    assert.equal(ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp)), null, "RAM should be identical (audio writes are Io, not RAM)");
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: emitPresetSound latches soundData=0x0b, LS259 identical, RAM untouched", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  emitPresetSound(c);

  assert.equal(ioDiff(o, c), null, `Io diff: ${ioDiff(o, c)}`);
  assert.equal(c.io.soundData, SOUND_CMD, "soundData latched to the preset command");
  assert.equal(c.io.latch[1], 0, "audio-IRQ bit pulsed back to 0");
  assert.equal(ramDiffMinusStack(o, c), null, "RAM identical");
  console.log(`  CRAFTED: soundData=${hx(c.io.soundData)} latch[1]=${c.io.latch[1]}`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: emits the WRONG command byte. */
function brokenCommand(m) {
  sendSoundCommand(m, (SOUND_CMD ^ 0x01) & 0xff); // BUG: corrupt bit 0 of the command
}

/** Broken twin: leaves the audio-IRQ latch bit high. */
function brokenStrobe(m) {
  const { mem8 } = m;
  emitPresetSound(m);
  mem8[0xa181] = 1; // BUG: never lower the audio-IRQ bit
}

test("TEETH: a wrong command byte is CAUGHT in io.soundData", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  brokenCommand(c);
  assert.notEqual(ioDiff(o, c), null, "the gate FAILED to catch a wrong command byte — it is worthless");
  console.log("  TEETH: a wrong command byte differs in io.soundData");
});

test("TEETH: a stuck-high audio-IRQ bit is CAUGHT in io.latch", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  brokenStrobe(c);
  assert.notEqual(ioDiff(o, c), null, "the gate FAILED to catch a stuck audio-IRQ bit — it is worthless");
  console.log("  TEETH: a stuck-high audio-IRQ bit differs in io.latch");
});
