// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for initShieldBuffers (ROM 0x01f8) -- replicate the 0x2c-byte ROM source block into four
// consecutive destination slots from HL up (the oracle loops the block-copy 0x1a32, advancing HL 0x2c
// per pass and restoring DE each pass). Live-in HL; live-out: the four filled slots (RAM) AND HL, which
// lands 4*0x2c past the start. DE is left at the source but no caller reads it, so it is not compared.
// Each side runs on a fresh clone; the contract is RAM (dumpState, minus the oracle's per-pass push
// residue below the entry SP) plus HL. Run: node --test games/invaders/idiomatic/test/equivalence-01f8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01f8 as oracleBody } from "../../translated/loc_01f8.js";
import { initShieldBuffers } from "../initShieldBuffers.js";
import { blockCopy } from "../blockCopy.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_TEMPLATE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01f8;
const BLOCK = 0x2c;

// End pointer the loop leaves in HL: start + 4 passes * 0x2c, wrapped to 16 bits.
const endHl = (hl) => (hl + 4 * BLOCK) & 0xffff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01f8 dispatches -- initShieldBuffers == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    // The oracle pushes DE + a return slot each pass, just below the ENTRY SP; exclude relative to it.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); initShieldBuffers(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: four consecutive copies of the source block, HL past the fourth", () => {
  for (const hl of [0x2142, 0x2242, 0x2100]) {
    const o = new Machine(ROM); o.regs.hl = hl; o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.regs.hl = hl; c.regs.sp = 0x2400;
    oracle(o); initShieldBuffers(c);
    const tag = `HL=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, endHl(hl), `HL advanced 4*0x2c: ${tag}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    for (let k = 0; k < 4; k++) {
      for (const j of [0, BLOCK - 1]) {
        assert.equal(c.mem.read8(hl + k * BLOCK + j), c.mem.read8(SHIELD_TEMPLATE + j),
          `slot ${k} byte ${j}: ${tag}`);
      }
    }
  }
});

test("TEETH: a broken twin that never advances the destination is caught", () => {
  // mutate the load-bearing dst advance away: all four passes overwrite the first slot, leaving slots
  // 2-4 unwritten (the real logic advances dst by 0x2c per pass).
  function loc_01f8_broken(m, hl = m.regs.hl) {
    for (let pass = 0; pass < 4; pass++) {
      blockCopy(m, SHIELD_TEMPLATE, hl, BLOCK); // BUG: destination never advances
    }
    return (m.regs.hl = hl);
  }
  const hl = 0x2242;
  const o = new Machine(ROM); o.regs.hl = hl; o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.hl = hl; c.regs.sp = 0x2400;
  oracle(o); loc_01f8_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an un-advanced destination");
  // the first slot is written identically both ways, so the divergence lands in slots 2-4 (hl+0x2c..)
  assert.ok(d.addr >= (hl + BLOCK) && d.addr < (hl + 4 * BLOCK),
    `divergence at 0x${d.addr.toString(16)} not in the un-copied slots`);
});
