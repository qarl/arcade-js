// SPDX-License-Identifier: GPL-3.0-only
/**
 * The optional sound-write tap (boards/dkong/io.js, `io.onSoundWrite`).
 *
 * This is the one wire from the emulation down to the audio layer, and the
 * whole design rests on it being INERT when nobody has asked for it. So the
 * tests here are as much about what does NOT happen as what does:
 *
 *   - default is null, and the write path behaves identically with it unset
 *   - it fires for 0x7C00 and 0x7D00-0x7D07 and for NOTHING else, in particular
 *     not for the control latch at 0x7D80-0x7D87 that shares the write map with
 *     flipscreen / NMI mask / DMA DRQ
 *   - the value it reports is the value the device stored, and it is reported
 *     AFTER the store, so a listener can never see a half-applied write
 *   - the latch state a listener would reconstruct matches the device's own
 *
 * The behavioural half of the proof is not here: it is the pixel gates
 * (games/dkong/tools/{move,prize}_suite.py), which run the real ROM and would
 * fail on any rendering change at all.
 *
 * Run: node --test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AddressSpace } from "../memory.js";
import { IO, Inputs } from "../io.js";

const ROM = new Uint8Array(0x4000);
const mk = () => {
  const io = new IO({ inputs: new Inputs() });
  return { io, mem: new AddressSpace(ROM, io) };
};

test("onSoundWrite defaults to null and the write path works untouched", () => {
  const { io, mem } = mk();
  assert.equal(io.onSoundWrite, null);
  mem.write8(0x7c00, 0x0b);
  mem.write8(0x7d02, 0x01);
  assert.equal(io.soundLatch3d, 0x0b);
  assert.equal(io.latch6h[2], 1);
  assert.equal(io.soundWrites, 2);
});

test("it fires for the two sound surfaces, with the stored value", () => {
  const { io, mem } = mk();
  const seen = [];
  io.onSoundWrite = (addr, value) => seen.push([addr, value]);

  mem.write8(0x7c00, 0x08); // ls175.3d tune latch: full byte as written
  for (let n = 0; n < 8; n++) mem.write8(0x7d00 + n, 0x01);
  mem.write8(0x7d00, 0x00); // trigger release

  assert.deepEqual(seen, [
    [0x7c00, 0x08],
    [0x7d00, 1], [0x7d01, 1], [0x7d02, 1], [0x7d03, 1],
    [0x7d04, 1], [0x7d05, 1], [0x7d06, 1], [0x7d07, 1],
    [0x7d00, 0],
  ]);
});

test("the ls259 value is the masked bit, not the raw byte", () => {
  // memory.js hands writeSoundLatch6h `value & 1`; the tap must report what the
  // latch actually holds, because a player gates on the LEVEL of that bit.
  const { io, mem } = mk();
  const seen = [];
  io.onSoundWrite = (addr, value) => seen.push([addr, value]);
  mem.write8(0x7d03, 0xff);
  mem.write8(0x7d03, 0xfe);
  assert.deepEqual(seen, [[0x7d03, 1], [0x7d03, 0]]);
  assert.equal(io.latch6h[3], 0);
});

test("nothing else on the write map reaches it", () => {
  const { io, mem } = mk();
  let calls = 0;
  io.onSoundWrite = () => { calls += 1; };

  mem.write8(0x7d80, 1);      // audio IRQ -- shares its range with the control latch
  mem.write8(0x7d82, 1);      // flipscreen
  mem.write8(0x7d83, 1);      // sprite bank
  mem.write8(0x7d84, 1);      // NMI mask
  mem.write8(0x7d86, 1);      // palette bank
  mem.write8(0x7808, 0x00);   // i8257 mode register
  mem.write8(0x6000, 0x5a);   // work RAM
  mem.write8(0x7400, 0x5a);   // video RAM
  mem.write8(0x7000, 0x5a);   // sprite RAM
  mem.write8(0x6c00, 0x5a);   // the discarded 0x6C00-0x6FFF window

  assert.equal(calls, 0);
});

test("the tap runs AFTER the store, so a listener sees committed state", () => {
  const { io, mem } = mk();
  let latchAtCall = null, bitAtCall = null;
  io.onSoundWrite = (addr) => {
    if (addr === 0x7c00) latchAtCall = io.soundLatch3d;
    else bitAtCall = io.latch6h[addr - 0x7d00];
  };
  mem.write8(0x7c00, 0x04);
  mem.write8(0x7d05, 0x01);
  assert.equal(latchAtCall, 0x04);
  assert.equal(bitAtCall, 1);
});

test("setting it back to null silences it again", () => {
  const { io, mem } = mk();
  let calls = 0;
  io.onSoundWrite = () => { calls += 1; };
  mem.write8(0x7c00, 0x01);
  io.onSoundWrite = null;
  mem.write8(0x7c00, 0x02);
  mem.write8(0x7d00, 1);
  assert.equal(calls, 1);
  assert.equal(io.soundLatch3d, 0x02); // and the device kept working
});

test("a fresh IO does not share tap state with another", () => {
  const a = mk(), b = mk();
  a.io.onSoundWrite = () => {};
  assert.equal(b.io.onSoundWrite, null);
});
