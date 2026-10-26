// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seatBlitPosition (ROM 0x1474) -- OUT port 2 := (L & 7) (the MB14241 shift offset),
// then tail-jump into coordToScreenAddr (0x1a47). The 0x1a47 m.call is DISSOLVED into a direct
// coordToScreenAddr. Input register HL; live-out is HL (the folded screen address) plus the shift-offset
// port side effect. The routine writes NO game RAM, so the RAM diff is a guard and the real contracts
// are the HL live-out and io.shiftAmount. Interrupts disabled per clone so the oracle's per-instruction
// tick cannot fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-1474.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1474 as oracleBody } from "../../translated/loc_1474.js";
import { seatBlitPosition } from "../seatBlitPosition.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1474;
const CALLER_RET = 0xabcd;

// The HL the routine leaves: HL >> 3, high byte masked to 5 bits and OR'd into 0x20-0x3f.
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

test("CAPTURE: real 0x1474 dispatches -- seatBlitPosition == oracle in HL, shift port (and RAM -stack)", () => {
  for (const cap of CAPS) {
    // The callee's `push b` residue sits just below the ENTRY SP; exclude relative to that SP. The
    // module drops the save/restore.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    const hl = cap.regs.hl;
    oracle(o); seatBlitPosition(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out (entry HL=0x${hl.toString(16)})`);
    assert.equal(c.regs.hl, expectHl(hl));
    assert.equal(c.io.shiftAmount, (hl & 0x07), "shift offset latched from L&7");
    assert.equal(c.io.shiftAmount, o.io.shiftAmount, "shift offset matches oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: shift offset := L&7 and HL folded into video RAM, for several HL", () => {
  for (const hl of [0x0038, 0x0000, 0xffff, 0xabcd, 0x2087, 0x1235, 0x8006]) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    o.regs.hl = hl; c.regs.hl = hl;
    o.regs.bc = 0x1234; c.regs.bc = 0x1234; // saved/restored by the callee -- must survive on both
    oracle(o); seatBlitPosition(c);
    const tag = `HL=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL match, ${tag}`);
    assert.equal(c.regs.hl, expectHl(hl), `HL value, ${tag}`);
    assert.ok(c.regs.hl >= 0x2000 && c.regs.hl <= 0x3fff, `HL lands in video RAM, ${tag}`);
    assert.equal(c.io.shiftAmount, hl & 0x07, `shift offset, ${tag}`);
    assert.equal(c.io.shiftAmount, o.io.shiftAmount, `shift offset match, ${tag}`);
  }
});

test("TEETH: a module-mutating twin (wrong folded HL) is caught by the live-out check", () => {
  // Broken twin of seatBlitPosition: latches the shift offset correctly but mis-folds HL (flips bit 0).
  const loc_1474_broken = (m, l = m.regs.l) => {
    m.io.portOut(0x02, l & 0x07);
    const shifted = m.regs.hl >> 3;
    const high = ((shifted >> 8) & 0x3f) | 0x20;
    return (m.regs.hl = (((high << 8) | (shifted & 0xff)) ^ 0x01) & 0xffff); // BUG: flips bit 0
  };
  const hl = 0x2087;
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  o.regs.hl = hl; c.regs.hl = hl;
  oracle(o); loc_1474_broken(c);
  assert.notEqual(c.regs.hl, o.regs.hl, "the live-out check FAILED to catch a wrong folded HL");
});
