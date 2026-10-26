// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for silenceFleetMarchNote (ROM 0x176d) -- "OUT 5 := mem[0x2098] & 0x30" (sound-off helper). No
// input register (the source byte lives in RAM); no memory is written, so the contract is the port-5
// write (captured by wrapping io.portOut) plus a RAM sanity diff, minus stack scratch below the entry SP. A/flags are dead
// (every caller path overwrites A before reading it), so only the port write is asserted.
// Run: node --test games/invaders/idiomatic/test/equivalence-176d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_176d as oracleBody } from "../../translated/loc_176d.js";
import { silenceFleetMarchNote } from "../silenceFleetMarchNote.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SOUND_PORT5_SHADOW } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x176d;

// Capture the port writes a routine performs against a machine (the routine's real live-out).
function portWritesOf(mm, fn) {
  const writes = [];
  const io = mm.io;
  const orig = io.portOut.bind(io);
  io.portOut = (port, val) => { writes.push([port & 0x07, val & 0xff]); return orig(port, val); };
  try { fn(mm); } finally { io.portOut = orig; }
  return writes;
}

// A broken twin of silenceFleetMarchNote: drops the 0x30 mask, so the emitted sound byte is wrong.
function silenceFleetMarchNote_broken(m) {
  m.io.portOut(0x05, m.mem.read8(0x2098)); // BUG: forgot the & 0x30 mask
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x176d dispatches -- silenceFleetMarchNote == oracle in port writes and RAM", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    const wo = portWritesOf(o, oracle);
    const wc = portWritesOf(c, silenceFleetMarchNote);
    assert.deepEqual(wc, wo); // the port-5 sound write is the live-out
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: OUT 5 := source & 0x30 for several source bytes", () => {
  for (const v of [0x00, 0x0f, 0x10, 0x20, 0x30, 0x3f, 0xa5, 0xff]) {
    const o = new Machine(ROM); o.mem8[SOUND_PORT5_SHADOW] = v;
    const c = new Machine(ROM); c.mem8[SOUND_PORT5_SHADOW] = v;
    const wo = portWritesOf(o, oracle);
    const wc = portWritesOf(c, silenceFleetMarchNote);
    assert.deepEqual(wc, wo, `source=0x${v.toString(16)}`);
    assert.deepEqual(wc, [[0x05, v & 0x30]], `port write source=0x${v.toString(16)}`);
    assert.equal(ramDiff(o, c), null, `source=0x${v.toString(16)}`);
  }
});

test("TEETH: a wrong emitted sound byte is caught", () => {
  const o = new Machine(ROM); o.mem8[SOUND_PORT5_SHADOW] = 0xff;
  const c = new Machine(ROM); c.mem8[SOUND_PORT5_SHADOW] = 0xff;
  const wo = portWritesOf(o, oracle); // [[5, 0x30]]
  const wc = portWritesOf(c, silenceFleetMarchNote_broken); // [[5, 0xff]]  BUG: unmasked
  assert.notDeepEqual(wc, wo, "the check FAILED to catch a wrong sound byte");
});
