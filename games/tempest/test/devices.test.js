// SPDX-License-Identifier: GPL-3.0-only
// Board-device tests for Tempest: ER2055 EAROM (high-score NVRAM) + POKEY (pot-ADC input, RANDOM RNG,
// SKCTL gate). These are the isolated teeth for the novel devices; the whole-machine boot-gap crawl
// (work+vector RAM byte-identical to MAME through the device-reading boot init) is the integration check.
// Run: node --test games/tempest/test/devices.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { Er2055, Io } from "../../../boards/tempest/io.js";
import { Pokey } from "../../../boards/tempest/pokey.js";
import { Mathbox } from "../../../boards/tempest/mathbox.js";
import { Machine } from "../machine.js";

test("ER2055: erase-before-write then read round-trips a byte", () => {
  const e = new Er2055();
  // write 0x5a to cell 7: address, data, then control for WRITE (c1=0,c2=0) with both chip-selects high.
  e.setAddress(7);
  e.setData(0x00); // erase first: c2=1,c1=0 sets cell to 0xff
  e.setControl(1, 1, 0, 1); // cs1,cs2,c1=0,c2=1 -> erase on update
  assert.equal(e.cells[7], 0xff, "erase sets the cell to 0xff");
  e.setData(0x5a);
  e.setControl(1, 1, 0, 0); // c1=0,c2=0 -> write (cell &= data)
  assert.equal(e.cells[7], 0x5a, "0xff & 0x5a = 0x5a written");
  // read: c1=1 on a CLK falling edge latches the cell into the data output.
  e.setControl(1, 1, 1, 0);
  e.setClk(1);
  e.setClk(0); // falling edge, selected, c1=1 -> latch = cell
  assert.equal(e.read(), 0x5a, "read returns the stored cell");
});

test("ER2055 via Io.earom* uses the Tempest control wiring", () => {
  const io = new Io();
  io.earomWrite(0x12, 0x00); // address 0x12, data 0x00
  io.earomControl(0x08 | 0x04); // bit3 cs1=1, bit2 set -> c1=!bit2=0, bit1=0 -> c2=... erase path check
  // (round-trip through the wiring is exercised whole-machine; here just assert no throw + address latched)
  assert.equal(io.earom.addr, 0x12, "earomWrite latched the address");
});

test("POKEY RANDOM: 0xFF right after reset, then varies over the period; deterministic; SKCTL-gated", () => {
  const p = new Pokey(() => 0, null);
  p.write(0x0f, 0x03, 0); // SKCTL: SK_RESET set (bit0/1) -> polys run
  // The all-ones poly17 seed shifts out for the first several cycles, so RANDOM reads 0xFF right after an
  // SKCTL reset -- exactly the property Tempest's protection check expects (spec §5.3).
  assert.equal(p.read(0x0a, 1), 0xff, "RANDOM = 0xFF immediately after SKCTL reset");
  const cycles = [1, 16, 256, 8192, 60000, 100000];
  const seq = cycles.map((c) => p.read(0x0a, c));
  const q = new Pokey(() => 0, null);
  q.write(0x0f, 0x03, 0);
  const seq2 = cycles.map((c) => q.read(0x0a, c));
  assert.deepEqual(seq, seq2, "RANDOM is a deterministic function of elapsed cycles");
  assert.ok(new Set(seq).size > 1, "RANDOM varies over the poly period (not a stuck value)");
  // SKCTL master reset (low 2 bits 0) freezes + zeroes the poly index.
  const r = new Pokey(() => 0, null);
  r.write(0x0f, 0x03, 0);
  r.read(0x0a, 100);
  r.write(0x0f, 0x00, 100); // enter reset -> p17=0
  assert.equal(r.p17, 0, "SKCTL reset zeroes the poly index");
});

test("Mathbox: load/read round-trip + octagonal distance approx (max + 3/8*min)", () => {
  // Additionally validated BYTE-EXACT vs MAME by replaying the attract mathbox op stream (38k writes / 19k
  // result reads, 0 mismatches) -- see scratchpad/tempest/dump_mathbox.lua; the whole-machine crawl re-checks
  // it via the tube geometry in vector RAM.
  const m = new Mathbox();
  m.goW(0x00, 0x34); m.goW(0x01, 0x12); // R0 lo/hi -> R0=0x1234, result=R0
  assert.equal(m.loR(), 0x34);
  assert.equal(m.hiR(), 0x12);
  m.goW(0x0c, 0x05); // R6 = 5 (whole reg), result=5
  assert.equal(m.loR(), 0x05);
  // distance: R0=R1=0, R2=200, R3=0 -> 0x1d makes |dx|=200,|dy|=0 -> 0x1e result = max(200,0)+3/8*0 = 200.
  const d = new Mathbox();
  d.goW(0x00, 0); d.goW(0x01, 0); // R0=0
  d.goW(0x02, 0); d.goW(0x03, 0); // R1=0
  d.goW(0x04, 200); d.goW(0x05, 0); // R2=200
  d.goW(0x06, 0); d.goW(0x07, 0); // R3=0
  d.goW(0x1d, 0); // load R3-hi=0, |dx|/|dy|, fall into 0x1e
  assert.equal((d.hiR() << 8) | d.loR(), 200, "octagonal distance = max(200,0)+3/8*0 = 200");
});

test("POKEY pot ADC: active line reads 0 instantly, inactive ramps to 228; ALLPOT inverted-done", () => {
  let bits = 0x01; // pot line 0 active (input bit set), others inactive
  const p = new Pokey(() => bits, null);
  p.write(0x0f, 0x04 | 0x03, 0); // SKCTL: SK_PADDLE (fast ramp) + SK_RESET
  p.write(0x0b, 0, 0); // POTGO
  assert.equal(p.read(0x00, 0), 0, "active pot 0 reads 0 immediately after POTGO");
  // ALLPOT (Tempest path) = internal-done ^ 0xff: pot0 done -> its bit reads 0, inactive pots read 1.
  assert.equal(p.read(0x08, 0) & 0x01, 0, "ALLPOT bit0 = 0 (pot0 conversion done)");
  assert.equal(p.read(0x08, 0) & 0x02, 0x02, "ALLPOT bit1 = 1 (pot1 still converting)");
  // advance 228 fast-paddle clocks -> inactive pot 1 completes and reads 228.
  assert.equal(p.read(0x01, 300), 228, "inactive pot 1 reads 228 after the ramp");
  assert.equal(p.read(0x08, 300) & 0x02, 0, "ALLPOT bit1 = 0 after pot1 conversion done");
});

test("Machine.clone: each POKEY reads the clone's own inputs and writes to the clone's own sound seam", () => {
  const src = new Machine(new Uint8Array(0x5000), {});
  src.io.knob = 3;
  src.io.inputAssert = { 2: 0x10 };
  src.io.avg.doneFlag = true;
  const c = src.clone();
  assert.equal(c.io.avg.doneFlag, true, "the AVG done flag (IN0 bit6) carried over");
  assert.deepEqual(c.io.pokeys.map((p) => p.potBits()), src.io.pokeys.map((p) => p.potBits()), "inputs carried over");
  const before = c.io.pokeys.map((p) => p.potBits());
  src.io.knob = 9;
  src.io.inputAssert = { 2: 0x04 };
  assert.deepEqual(c.io.pokeys.map((p) => p.potBits()), before, "a later source input change must not reach the clone");
  assert.notDeepEqual(src.io.pokeys.map((p) => p.potBits()), before, "control: the source did change");
  const heard = { src: 0, clone: 0 };
  src.io.onPokeyWrite = () => heard.src++;
  c.io.onPokeyWrite = () => heard.clone++;
  c.io.pokeyWrite(0, 0x0, 0x55, 0);
  assert.deepEqual(heard, { src: 0, clone: 1 }, "the clone's sound write reaches only its own seam");
});
