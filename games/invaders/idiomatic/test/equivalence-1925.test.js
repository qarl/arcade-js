// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawPlayer1Score -- seat HL at the fixed player-1 score record (0x20f8) and delegate to the
// shared unpack+draw (drawScoreRecord: a four-byte record -- a BCD value word low then high, then its two-byte
// screen address -- drawn as four BCD glyphs). Live-out is RAM only: the direct callers (redrawScorePanel, startGameFlow)
// immediately call the next seater, which reseats HL, so no register is compared; the rendered glyphs prove the
// value word and screen address landed. The oracle's draw chain leaves call/ret residue just below the entry
// SP, so that band is excluded from the RAM diff. Each side runs on a fresh clone.
// Run: node --test games/invaders/idiomatic/test/equivalence-1925.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1925 as oracleBody } from "../../translated/loc_1925.js";
import { drawPlayer1Score as module } from "../drawPlayer1Score.js";
import { drawBcdWord } from "../drawBcdWord.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1925;
const BASE = 0x20f8; // the player-1 score record this routine seats

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1925 dispatches -- module == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's draw-chain call/ret residue sits just below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); module(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed the four-byte record AT the fixed base (this routine ignores incoming HL and seats BASE itself),
// pointing it at a VRAM screen address; e/d are the value word (low/high).
function seedRecord(m, e, d, ptr) {
  m.regs.sp = 0x2400;
  m.mem.write8(BASE, e);
  m.mem.write8(BASE + 1, d);
  m.mem.write8(BASE + 2, ptr & 0xff);
  m.mem.write8(BASE + 3, (ptr >> 8) & 0xff);
}

test("CRAFTED: seats the fixed record base and draws its value at the record's screen address", () => {
  // distinct-digit value, a zero score, and a max BCD value -- at three different VRAM addresses.
  for (const [e, d, ptr] of [[0x34, 0x12, 0x3800], [0x00, 0x00, 0x3a00], [0x99, 0x99, 0x3c00]]) {
    const o = new Machine(ROM); seedRecord(o, e, d, ptr); o.io.setInte(false);
    const c = new Machine(ROM); seedRecord(c, e, d, ptr); c.io.setInte(false);
    oracle(o); module(c);
    const tag = `value=0x${d.toString(16)}${e.toString(16)} ptr=0x${ptr.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
  }
  // Positive control that the draw path actually ran: 0x1234 at 0x3800 paints glyph bytes.
  const c = new Machine(ROM); seedRecord(c, 0x34, 0x12, 0x3800); c.io.setInte(false);
  module(c);
  let drew = 0;
  for (let i = 0; i < 8; i++) drew |= c.mem.read8(0x3800 + i * 0x20);
  assert.notEqual(drew, 0, "the high digit glyph was plotted at the screen address");
});

test("TEETH: a module-mutating twin (draws the value bytes swapped) diverges in RAM", () => {
  // Broken twin: seats the correct base but passes the value bytes to drawBcdWord in the wrong order
  // (low then high) -- with a distinct-digit value this paints different glyphs, so screen RAM diverges.
  function module_broken(m) {
    const hl = BASE;
    const e = m.mem8[hl];
    const d = m.mem8[hl + 1];
    const a = m.mem8[hl + 2];
    const h = m.mem8[hl + 3];
    return (m.regs.hl = (h << 8) | a, drawBcdWord(m, e, d)); // BUG: e,d swapped
  }
  const o = new Machine(ROM); seedRecord(o, 0x34, 0x12, 0x3800); o.io.setInte(false);
  const c = new Machine(ROM); seedRecord(c, 0x34, 0x12, 0x3800); c.io.setInte(false);
  oracle(o); module_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the swapped value bytes");
});

test("TEETH: a twin seating the WRONG record base diverges in RAM", () => {
  // This routine's whole job is the SEAT -- so a twin that seats a different record base (0x20fc, the P2
  // slot) reads the wrong value and screen address and draws elsewhere; the RAM diff must catch it.
  function module_wrongBase(m) {
    const hl = 0x20fc;
    const e = m.mem8[hl], d = m.mem8[hl + 1], a = m.mem8[hl + 2], h = m.mem8[hl + 3];
    return (m.regs.hl = (h << 8) | a, drawBcdWord(m, d, e)); // BUG: seats the P2 record, not P1
  }
  const o = new Machine(ROM);
  o.regs.sp = 0x2400;
  // Seed the P1 record (what the real routine draws) and a DIFFERENT P2 record (what the twin draws).
  o.mem.write8(BASE, 0x34); o.mem.write8(BASE + 1, 0x12);
  o.mem.write8(BASE + 2, 0x00); o.mem.write8(BASE + 3, 0x38);
  o.mem.write8(0x20fc, 0x88); o.mem.write8(0x20fd, 0x77);
  o.mem.write8(0x20fe, 0x00); o.mem.write8(0x20ff, 0x3a);
  o.io.setInte(false);
  const c = o.clone();
  oracle(o); module_wrongBase(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong record base");
});
