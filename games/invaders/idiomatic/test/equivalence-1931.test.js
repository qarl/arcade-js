// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawScoreRecord -- unpack a four-byte score record at HL (a BCD value word, low then
// high, followed by its two-byte screen address) and draw the value as four BCD glyphs (DISSOLVED into
// drawBcdWord, high byte then low). Live-out is RAM only: the direct callers either tail-delegate (their
// own callers reseat HL) or reload A right after, so no register is compared; the rendered glyphs prove
// both the value word and the screen address landed. The oracle's draw chain push/pops its return-address
// residue below the entry SP, so that band is excluded from the RAM diff. Each side runs on a fresh clone.
// Run: node --test games/invaders/idiomatic/test/equivalence-1931.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1931 as oracleBody } from "../../translated/loc_1931.js";
import { drawScoreRecord } from "../drawScoreRecord.js";
import { drawBcdWord } from "../drawBcdWord.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1931;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1931 dispatches -- drawScoreRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's draw-chain call/ret residue sits just below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawScoreRecord(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed a record at REC and point it at a VRAM screen address; e/d are the value word (low/high).
const REC = 0x2100;
function seedRecord(m, e, d, ptr) {
  m.regs.sp = 0x2400;
  m.regs.hl = REC;
  m.mem.write8(REC, e);
  m.mem.write8(REC + 1, d);
  m.mem.write8(REC + 2, ptr & 0xff);
  m.mem.write8(REC + 3, (ptr >> 8) & 0xff);
}

test("CRAFTED: unpacks each record and draws its value at the record's screen address", () => {
  // distinct-digit value, a zero score, and a max BCD value -- at three different VRAM addresses.
  for (const [e, d, ptr] of [[0x34, 0x12, 0x3800], [0x00, 0x00, 0x3a00], [0x99, 0x99, 0x3c00]]) {
    const o = new Machine(ROM); seedRecord(o, e, d, ptr); o.io.setInte(false);
    const c = new Machine(ROM); seedRecord(c, e, d, ptr); c.io.setInte(false);
    oracle(o); drawScoreRecord(c);
    const tag = `value=0x${d.toString(16)}${e.toString(16)} ptr=0x${ptr.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
  }
  // Positive control that the draw path actually ran: 0x1234 at 0x3800 paints glyph bytes.
  const c = new Machine(ROM); seedRecord(c, 0x34, 0x12, 0x3800); c.io.setInte(false);
  drawScoreRecord(c);
  let drew = 0;
  for (let i = 0; i < 8; i++) drew |= c.mem.read8(0x3800 + i * 0x20);
  assert.notEqual(drew, 0, "the high digit glyph was plotted at the screen address");
});

test("TEETH: a module-mutating twin (draws the value bytes swapped) diverges in RAM", () => {
  // Broken twin: passes the value bytes to drawBcdWord in the wrong order (low then high) -- with a
  // distinct-digit value this paints different glyphs, so the screen RAM diverges.
  function loc_1931_broken(m, hl = m.regs.hl) {
    const e = m.mem8[hl];
    const d = m.mem8[hl + 1];
    const a = m.mem8[hl + 2];
    const h = m.mem8[hl + 3];
    return (m.regs.hl = (h << 8) | a, drawBcdWord(m, e, d)); // BUG: e,d swapped
  }
  const o = new Machine(ROM); seedRecord(o, 0x34, 0x12, 0x3800); o.io.setInte(false);
  const c = new Machine(ROM); seedRecord(c, 0x34, 0x12, 0x3800); c.io.setInte(false);
  oracle(o); loc_1931_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the swapped value bytes");
});
