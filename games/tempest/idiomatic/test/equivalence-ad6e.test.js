// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickActiveSoundSlot (ROM 0xad6e-0xadcd) -- a CALLER that dissolves three m.calls into direct
// idiomatic calls: foldStepIntoFraction (fold/clamp the active slot value, consuming its returned A), requestWriteLowRegions (arm the
// merge with mask 3), and armRequestedSoundSlot (walk the request word). Live-out is RAM plus the exit [X, Y] it
// returns, so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP), with the CAPTURE
// arm also comparing the returned pair.
// Run: node --test games/tempest/idiomatic/test/equivalence-ad6e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ad6e } from "../../translated/loc_ad6e.js";
import { tickActiveSoundSlot } from "../tickActiveSoundSlot.js";
import { foldStepIntoFraction } from "../foldStepIntoFraction.js";
import { requestWriteLowRegions } from "../requestWriteLowRegions.js";
import { armRequestedSoundSlot } from "../armRequestedSoundSlot.js";
import { Machine } from "../../machine.js";
import { u8, u16 } from "../../../../core/int.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  GAME_MODE, MODE_DISPATCH_SEL, FRAME_COUNTER, loc_3d, INPUT_EDGE_FLAGS, SPINNER_ACCUM, RIM_ROT_OFFSET,
  SLOT_METRIC, ACTIVE_SLOT, REQUEST_BITS, REARM_COUNTER, PASS_COUNTER, SLOT_VALUE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xad6e;
const oracle = atEntry(loc_ad6e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xad6e dispatches -- tickActiveSoundSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(tickActiveSoundSlot(c, ey, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Main path: countdown byte non-idle, slot clamps low, gate open, step goes negative -> ddf7 + ad22.
function seedMain(m) {
  m.mem.write8(FRAME_COUNTER, 0x01);   // $03 bits0-4 nonzero -> skip the countdown expiry
  m.mem.write8(ACTIVE_SLOT, 0x02); // active slot index
  m.mem.write8((SLOT_VALUE + 0x02) & 0xffff, 0x10); // slot value: positive, < 0x1b -> kept
  m.mem.write8(SPINNER_ACCUM, 0x00);  // adce step = 0 (no fold change)
  m.mem.write8(RIM_ROT_OFFSET, 0x00);
  m.mem.write8(INPUT_EDGE_FLAGS, 0x18);  // gate bits set (& 0x67 -> 0)
  m.mem.write8(REARM_COUNTER, 0x00); // step-- -> 0xff (negative) -> re-arm branch
  m.mem.write8(loc_3d, 0x00);
  m.mem.write8((SLOT_METRIC + 0x00) & 0xffff, 0x02); // < 0x04 -> ddf7 fires
  m.mem.write8(REQUEST_BITS, 0x00); // ad22 exits idle immediately
}

test("CRAFTED (main path): gate open + negative step re-arms via ddf7/ad22", () => {
  const o = new Machine(ROM, OPTS); seedMain(o);
  const c = new Machine(ROM, OPTS); seedMain(c);
  oracle(o); tickActiveSoundSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after ad6e main path");
  assert.equal(c.mem.read8(INPUT_EDGE_FLAGS), 0x18 & 0x67, "$4e masked to 0x67");
  assert.equal(c.mem.read8((SLOT_VALUE + 0x02) & 0xffff), 0x10, "slot value kept");
});

// Reset path: countdown idle and $0605 decrements to zero -> $0000 = 0x14 and early return.
function seedReset(m) {
  m.mem.write8(FRAME_COUNTER, 0x00);   // $03 bits0-4 clear
  m.mem.write8(PASS_COUNTER, 0x01); // dec -> 0 -> expire
}

test("CRAFTED (reset path): idle countdown expires to the 0x14 reset", () => {
  const o = new Machine(ROM, OPTS); seedReset(o);
  const c = new Machine(ROM, OPTS); seedReset(c);
  oracle(o); tickActiveSoundSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after ad6e reset path");
  assert.equal(c.mem.read8(GAME_MODE), 0x14, "$0000 armed to 0x14");
  assert.equal(c.mem.read8(PASS_COUNTER), 0x00, "$0605 expired to 0");
});

test("TEETH: a twin that skips the $4e mask (& 0x67) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedMain(o);
  const c = new Machine(ROM, OPTS); seedMain(c);
  oracle(o);
  // Faithful copy of tickActiveSoundSlot with exactly one omission: it never masks $4e with 0x67.
  const broken = (m) => {
    const { mem8 } = m;
    mem8[MODE_DISPATCH_SEL] = 0x06;
    if ((mem8[FRAME_COUNTER] & 0x1f) === 0) {
      const count = u8(mem8[PASS_COUNTER] - 1);
      mem8[PASS_COUNTER] = count;
      if (count === 0) { mem8[GAME_MODE] = 0x14; return; }
    }
    const slot = mem8[ACTIVE_SLOT];
    const clamped = foldStepIntoFraction(m, mem8[u16(SLOT_VALUE + slot)]);
    let value;
    if ((clamped & 0x80) === 0) value = clamped >= 0x1b ? 0x00 : clamped;
    else value = 0x1a;
    mem8[u16(SLOT_VALUE + slot)] = value;
    const gate = mem8[INPUT_EDGE_FLAGS] & 0x18;
    // BUG: the mask write mem8[INPUT_EDGE_FLAGS] = mem8[INPUT_EDGE_FLAGS] & 0x67 is omitted here.
    if (gate === 0) return;
    mem8[ACTIVE_SLOT] = u8(mem8[ACTIVE_SLOT] - 1);
    const step = u8(mem8[REARM_COUNTER] - 1);
    mem8[REARM_COUNTER] = step;
    if ((step & 0x80) !== 0) {
      const idx = mem8[loc_3d];
      if (mem8[u16(SLOT_METRIC + idx)] < 0x04) requestWriteLowRegions(m);
      armRequestedSoundSlot(m);
      return;
    }
    mem8[u16(SLOT_VALUE + u8(slot - 1))] = 0x00;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $4e mask");
});
