// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for coordToScreenAddr (ROM 0x1a47) -- "shift HL right by 3, force H into the 0x20-0x3f
// video-RAM page". Input register HL; live-out is HL (every consumer overwrites A before reading it,
// and BC is saved/restored), so the routine writes NO game RAM: the RAM diff is a guard and the real
// contract is the HL live-out. Interrupts are disabled on each clone so the oracle's per-instruction
// tick cannot fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-1a47.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a47 as oracleBody } from "../../translated/loc_1a47.js";
import { coordToScreenAddr } from "../coordToScreenAddr.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a47;
const CALLER_RET = 0xabcd;

// The surviving output: HL >> 3, then the high byte masked to 5 bits and OR'd into 0x20-0x3f. (The
// carry-fed and top bits the rotate produces are exactly the ones ani 0x3f / ori 0x20 overwrite.)
const expectHl = (hl) => {
  const shifted = hl >> 3;
  const high = ((shifted >> 8) & 0x3f) | 0x20;
  return ((high << 8) | (shifted & 0xff)) & 0xffff;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a47 dispatches -- coordToScreenAddr == oracle in HL (and RAM -stack)", () => {
  for (const cap of CAPS) {
    // The oracle's `push b` residue sits just below the ENTRY SP, which SI's attract loop walks widely
    // (even above 0x2400); exclude relative to that SP, not a fixed window. The module drops the push.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); coordToScreenAddr(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out (entry HL=0x${cap.regs.hl.toString(16)})`);
    assert.equal(c.regs.hl, expectHl(cap.regs.hl));
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL := (HL >> 3) with H forced into 0x20-0x3f, for several HL", () => {
  for (const hl of [0x0038, 0x0000, 0xffff, 0xabcd, 0x2087, 0x1234, 0x8001]) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    o.regs.hl = hl; c.regs.hl = hl;
    o.regs.bc = 0x1234; c.regs.bc = 0x1234; // saved/restored by the oracle -- must survive on both
    oracle(o); coordToScreenAddr(c);
    assert.equal(ramDiff(o, c), null, `HL=0x${hl.toString(16)}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL match, HL=0x${hl.toString(16)}`);
    assert.equal(c.regs.hl, expectHl(hl), `HL value, HL=0x${hl.toString(16)}`);
    assert.ok(c.regs.hl >= 0x2000 && c.regs.hl <= 0x3fff, `HL lands in video RAM, HL=0x${hl.toString(16)}`);
  }
});

test("TEETH: a wrong returned HL is caught by the live-out comparison", () => {
  const brokenTwin = (m, hl = m.regs.hl) => {
    const shifted = hl >> 3;
    const high = ((shifted >> 8) & 0x3f) | 0x20;
    return (m.regs.hl = (((high << 8) | (shifted & 0xff)) ^ 0x01)); // BUG: flips bit 0 of the result
  };
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  o.regs.hl = 0xabcd; c.regs.hl = 0xabcd;
  oracle(o); brokenTwin(c);
  assert.notEqual(c.regs.hl, o.regs.hl, "the live-out check FAILED to catch a wrong returned HL");
});
