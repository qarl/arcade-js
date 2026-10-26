// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSaucerSprite -- resolve the sprite's screen address + gfx pointer from its record
// (DISSOLVED into resolveSpriteScreenAddr), then blit its column (DISSOLVED into drawSpriteColumn). The
// oracle's `call 0x0742` return-address push and drawSpriteColumn's per-row `push b` residue sit in dead
// stack scratch, which the diff excludes. Live-out is the drawn column (RAM) PLUS the advanced HL; DE is
// NOT compared -- the oracle advances it per byte while the module keeps it in a local (drawSpriteColumn's
// own contract) and no caller reads it back. Interrupts are disabled per clone so a handler cannot write
// RAM only on one side.
// Run: node --test games/invaders/idiomatic/test/equivalence-073c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_073c as oracleBody } from "../../translated/loc_073c.js";
import { drawSaucerSprite } from "../drawSaucerSprite.js";
import { resolveSpriteScreenAddr } from "../resolveSpriteScreenAddr.js";
import { drawSpriteColumn } from "../drawSpriteColumn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x073c;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x073c dispatches -- drawSaucerSprite == oracle in RAM (-stack) and HL live-out", () => {
  for (const cap of CAPS) {
    // The oracle's `call 0x0742` return push and drawSpriteColumn's `push b` residue sit just below the
    // ENTRY SP, which at a real dispatch is not the STACK_SCRATCH window -- exclude relative to that SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawSaucerSprite(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a 5-byte sprite descriptor at the record cell
// 0x2087 ([e,d,a,c,b]) and a source stream at the gfx pointer DE the descriptor names. The descriptor
// picks HL0=0x1000 -> screen addr 0x2200, DE=0x2000, and a 4-row count.
const DESC = 0x2087, GFX = 0x2000, SCREEN = 0x2200, ROWS = 4;
const SRC = [0xa1, 0xb2, 0xc3, 0xd4];
function seat(m) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.mem.write8(DESC + 0, GFX & 0xff);        // e
  m.mem.write8(DESC + 1, (GFX >> 8) & 0xff); // d  -> DE = GFX
  m.mem.write8(DESC + 2, 0x00);              // a
  m.mem.write8(DESC + 3, 0x10);              // c  -> HL0 = 0x1000 -> coordToScreenAddr -> 0x2200
  m.mem.write8(DESC + 4, ROWS);              // b
  SRC.forEach((v, i) => m.mem.write8((GFX + i) & 0xffff, v));
}

test("CRAFTED: the sprite column is blitted at the resolved screen address; HL advances by 0x20*B", () => {
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); drawSaucerSprite(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  for (let i = 0; i < ROWS; i++) {
    assert.equal(c.mem.read8((SCREEN + 0x20 * i) & 0xffff), SRC[i], `row ${i} blitted from the gfx stream`);
  }
  assert.equal(c.regs.hl, (SCREEN + 0x20 * ROWS) & 0xffff, "HL := screen addr + 0x20*B");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches the oracle");
});

test("TEETH: a twin that blits one row short is caught by the RAM diff", () => {
  // Mutate drawSaucerSprite's OWN body: resolve then blit, but one row short of the descriptor's count.
  function drawSaucerSprite_broken(m) {
    resolveSpriteScreenAddr(m);
    return drawSpriteColumn(m, m.regs.hl, m.regs.de, (m.regs.b - 1) & 0xff); // BUG: drops the last row
  }
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); drawSaucerSprite_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a one-row-short blit");
  assert.equal(d.addr, (SCREEN + 0x20 * (ROWS - 1)) & 0xffff, "first divergence is the un-blitted last row");
});
