// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawOrSaveShields (ROM 0x021e-0x0247) -- the shared draw body. Stores the mode flag at
// SHIELD_SAVE_RESTORE_MODE, then runs four passes of a 22x2 block: capture the screen region (flag set) or OR the source
// bitmap in (flag clear), advancing HL by DRAW_BLOCK_STRIDE between blocks. Live-out is MEMORY; the
// callee's HL/DE thread through the loop but no caller reads them back. The oracle push/pops around its
// two m.call's, so the diff excludes the dead stack scratch. Interrupts are disabled on each clone so
// the oracle's per-instruction tick cannot fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-021e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_021e as oracleBody } from "../../translated/loc_021e.js";
import { drawOrSaveShields } from "../drawOrSaveShields.js";
import { captureScreenRect } from "../captureScreenRect.js";
import { orBlitBitmap } from "../orBlitBitmap.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_SAVE_RESTORE_MODE, SHIELD_VRAM_BASE, DRAW_BLOCK_STRIDE } from "../names.js";
import { u16 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x021e;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x021e dispatches -- drawOrSaveShields == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawOrSaveShields(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a distinct pattern across work + video RAM, a real caller return on the stack,
// the mode flag in A and the source/dest base in DE (as saveOrRestorePlayer1Shields/saveOrRestorePlayer2Shields seed it).
function seat(m, { a, de }) {
  for (let addr = 0x2000; addr < 0x4000; addr++) m.mem.write8(addr, addr & 0xff);
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.a = a; m.regs.de = de;
}

test("CRAFTED: blit path (flag=0) -- module leaves the same RAM as the oracle", () => {
  const CASE = { a: 0x00, de: 0x2242 };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); drawOrSaveShields(c);
  assert.equal(ramDiff(o, c), null, "blit path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x00, "mode flag stored");
});

test("CRAFTED: capture path (flag!=0) -- module leaves the same RAM as the oracle", () => {
  const CASE = { a: 0x01, de: 0x2242 };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); drawOrSaveShields(c);
  assert.equal(ramDiff(o, c), null, "capture path RAM matches");
  assert.equal(c.mem.read8(SHIELD_SAVE_RESTORE_MODE), 0x01, "mode flag stored");
});

test("TEETH: a broken twin with the flag test inverted is caught by the RAM diff", () => {
  // Mutate drawOrSaveShields's OWN branch: it now captures where it should blit (and vice-versa).
  function loc_021e_broken(m, a = m.regs.a, de = m.regs.de) {
    m.mem8[SHIELD_SAVE_RESTORE_MODE] = a;
    const rows = 0x16, cols = 0x02;
    let hl = SHIELD_VRAM_BASE;
    for (let pass = 0; ; pass++) {
      if (m.mem8[SHIELD_SAVE_RESTORE_MODE] === 0) { // BUG: inverted test
        [de, hl] = captureScreenRect(m, hl, de, rows, cols);
      } else {
        [hl, de] = orBlitBitmap(m, hl, de, rows, cols);
      }
      if (pass === 3) break;
      hl = u16(hl + DRAW_BLOCK_STRIDE);
    }
  }
  const CASE = { a: 0x00, de: 0x2242 };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); loc_021e_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch an inverted flag test -- it is worthless");
});
