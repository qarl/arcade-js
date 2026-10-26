// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for playSaucerHitSoundAndDrawSprite -- OR a sound-select bit into the port-5 shadow and latch it
// (DISSOLVED into latchSoundPort5), reset the sprite record's gfx pointer to its ROM table (shld ->
// mem16 store), then blit the sprite column (DISSOLVED into drawSaucerSprite, the tail delegate). Live-out is
// RAM (the shadow byte, the reset record word, and the blitted screen column) PLUS the advanced HL that
// drawSaucerSprite leaves. The oracle's `call 0x1770` / `call 0x0742` return pushes and the leaf's `push b`
// residue sit in dead stack scratch below the entry SP, which the diff excludes; the module keeps its
// walk in locals. Interrupts are disabled per clone so a handler cannot write RAM only on one side.
// Run: node --test games/invaders/idiomatic/test/equivalence-074b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_074b as oracleBody } from "../../translated/loc_074b.js";
import { playSaucerHitSoundAndDrawSprite } from "../playSaucerHitSoundAndDrawSprite.js";
import { latchSoundPort5 } from "../latchSoundPort5.js";
import { drawSaucerSprite } from "../drawSaucerSprite.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SOUND_PORT5_SHADOW, loc_2087, SAUCER_HIT_SPRITE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x074b;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x074b dispatches -- playSaucerHitSoundAndDrawSprite == oracle in RAM (-stack) and HL live-out", () => {
  for (const cap of CAPS) {
    // The oracle's call return pushes + the blit leaf's `push b` residue sit just below the ENTRY SP;
    // exclude relative to that SP. The module drops the pushes.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); playSaucerHitSoundAndDrawSprite(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a shadow byte to OR, and the tail of the sprite
// record at loc_2087 -- a=[loc_2087+2], c=[loc_2087+3], b=[loc_2087+4]. playSaucerHitSoundAndDrawSprite overwrites the record's
// first word (e,d) with SAUCER_HIT_SPRITE (the ROM gfx table), so DE := SAUCER_HIT_SPRITE and drawSpriteColumn reads its B
// source bytes from ROM (identical on both sides). a=0x00,c=0x20 -> HL0=0x2000 -> screen addr 0x2400.
const SHADOW0 = 0x03;
function seat(m) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.mem.write8(SOUND_PORT5_SHADOW, SHADOW0);
  m.mem.write8(loc_2087 + 2, 0x00); // a
  m.mem.write8(loc_2087 + 3, 0x20); // c  -> HL0 = 0x2000 -> coordToScreenAddr -> 0x2400
  m.mem.write8(loc_2087 + 4, 0x04); // b  -> 4 rows
}

test("CRAFTED: shadow bit raised, record repointed to the table, sprite column blitted; HL := 0x2480", () => {
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); playSaucerHitSoundAndDrawSprite(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches the oracle");
  assert.equal(c.mem.read8(SOUND_PORT5_SHADOW), (SHADOW0 | 0x10) & 0xff, "sound-select bit ORed into the shadow");
  assert.equal(c.mem.read16(loc_2087), SAUCER_HIT_SPRITE, "record gfx pointer reset to the ROM table");
  assert.equal(c.regs.hl, (0x2400 + 0x20 * 4) & 0xffff, "HL := screen addr + 0x20*B");
});

test("TEETH: a twin that ORs the wrong sound bit diverges at the shadow cell", () => {
  // Mutate playSaucerHitSoundAndDrawSprite's OWN logic: OR bit 5 instead of bit 4 into the shadow -- a real-logic change.
  function loc_074b_broken(m) {
    const a = (m.mem8[SOUND_PORT5_SHADOW] |= 0x20); // BUG: wrong sound-select bit (0x20 not 0x10)
    latchSoundPort5(m, a);
    m.mem16[loc_2087] = SAUCER_HIT_SPRITE;
    return drawSaucerSprite(m);
  }
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); loc_074b_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong sound bit");
  assert.equal(d.addr, SOUND_PORT5_SHADOW, "first divergence is the shadow cell");
});
