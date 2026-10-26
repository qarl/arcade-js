// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for awardSaucerScore -- on the mystery ship's destruction. Raise the score-add flag, scan the
// 4-entry type table for the ship's value key, copy the parallel sprite-id entry into the sprite record,
// store key*16 as the score value, fold that record into a screen address (DISSOLVED into
// resolveSpriteScreenAddr) and draw its three-part sprite (DISSOLVED into drawThreeSprites, tail-jump).
// Every path ends in the same two dissolved calls, so both live-out MEMORY (the flag, the record, the score
// word, the blitted cells) AND the registers resolveSpriteScreenAddr/drawThreeSprites leave: HL (the screen
// walk), DE (the id-list walk) and C (drained to 0). B (= key) and A are dead. The oracle push/pops the
// inner call return + the sprite routines' saves below the entry SP; the RAM diff excludes that window.
// Run: node --test games/invaders/idiomatic/test/equivalence-070c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_070c as oracleBody } from "../../translated/loc_070c.js";
import { awardSaucerScore } from "../awardSaucerScore.js";
import { resolveSpriteScreenAddr } from "../resolveSpriteScreenAddr.js";
import { drawThreeSprites } from "../drawThreeSprites.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x070c;
const CALLER_RET = 0xabcd;
const SCORE_FLAG = 0x20f1, SCORE_VALUE = 0x20f2, KEY_PTR = 0x208d, RECORD = 0x2087;

// Live-out data registers (B = key and A are dead).
const OUT = ["hl", "de", "c"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x070c dispatches -- awardSaucerScore == oracle in RAM (-stack) and HL/DE/C", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); awardSaucerScore(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(regOutDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return, a key pointer -> a RAM byte holding the value key, and the sprite
// record's tail bytes (byte 0 is filled in by the routine). The real ROM type table 0x1d4c = [05,10,15,30]
// with parallel 0x1d50 = [94,97,9a,9d] is read as-is (ROM is not writable here). The record's C:A coord
// (0x2800) folds to screen 0x2500 so the 3-sprite blit lands in the framebuffer.
function seat(m, key) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.mem.write16(KEY_PTR, 0x2090);      // key pointer -> 0x2090 (work RAM)
  m.mem.write8(0x2090, key);           // the value key B searches for
  m.mem.write8(RECORD + 1, 0x21);      // d -> DE high (id-list at 0x21xx)
  m.mem.write8(RECORD + 2, 0x00);      // a -> coord low
  m.mem.write8(RECORD + 3, 0x28);      // c -> coord high (0x2800 -> screen 0x2500)
  m.mem.write8(RECORD + 4, 0x06);      // b (unused by drawThreeSprites)
}

test("CRAFTED: matched key re-seeds record + score and delegates; unmatched key runs the same tail", () => {
  // (a) key 0x10 matches table[1] -> parallel entry 0x97, score 0x10*16 = 0x100
  {
    const o = new Machine(ROM); seat(o, 0x10);
    const c = new Machine(ROM); seat(c, 0x10);
    oracle(o); awardSaucerScore(c);
    assert.equal(ramDiff(o, c), null, "matched RAM");
    assert.equal(regOutDiff(o, c), null, "matched HL/DE/C");
    assert.equal(c.mem.read8(SCORE_FLAG), 0x01, "score-add flag raised");
    assert.equal(c.mem.read8(RECORD), 0x97, "matched parallel entry copied into the record");
    assert.equal(c.mem.read16(SCORE_VALUE), 0x10 << 4, "score value = key*16");
  }
  // (b) key 0xff matches nothing -> table walk falls off the end, same tail runs
  {
    const o = new Machine(ROM); seat(o, 0xff);
    const c = new Machine(ROM); seat(c, 0xff);
    oracle(o); awardSaucerScore(c);
    assert.equal(ramDiff(o, c), null, "unmatched RAM");
    assert.equal(regOutDiff(o, c), null, "unmatched HL/DE/C");
    assert.equal(c.mem.read8(SCORE_FLAG), 0x01, "score-add flag raised");
    assert.equal(c.mem.read16(SCORE_VALUE), 0xff << 4, "score value = key*16");
    assert.equal(c.mem.read8(RECORD), o.mem.read8(RECORD), "record byte matches oracle");
  }
});

test("TEETH: a twin that scales the score by 8 instead of 16 diverges in the score word", () => {
  // Mutate awardSaucerScore's own logic: store key*8 (<<3) rather than key*16 (<<4).
  function loc_070c_broken(m) {
    m.mem8[SCORE_FLAG] = 1;
    const key = m.mem8[m.mem16[KEY_PTR]];
    let entry = 0x1d50, probe = 0x1d4c, count = 0x04;
    while (m.mem8[probe] !== key) { entry += 1; probe += 1; count -= 1; if (count === 0) break; }
    m.mem8[RECORD] = m.mem8[entry];
    m.mem16[SCORE_VALUE] = key << 3; // BUG: key*8, not key*16
    resolveSpriteScreenAddr(m);
    return drawThreeSprites(m);
  }
  const o = new Machine(ROM); seat(o, 0x10);
  const c = new Machine(ROM); seat(c, 0x10);
  oracle(o); loc_070c_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a mis-scaled score value");
});
