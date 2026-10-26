// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawPendingAlien -- redraw the pending sprite object. Three arms: (a) a prize already
// despawning bails to the despawn tick (DISSOLVED into tickAlienExplosionDespawn); (b) the active-slot path builds
// the sprite pointer -- sprite id -> rotate-left-3 -> 0x1c00 table offset, +0x30 for the alternate frame
// (DISSOLVED into selectAlternateSpriteFrame) -- and shift-blits it (DISSOLVED into blitShiftedSprite),
// clearing the draw-pending flag; (c) an inactive slot only clears the flag. Live-out is MEMORY only: the
// caller (serviceVblankObjects) reloads every register before reading it, so A/HL/DE left by the routine are dead. The
// module clears the draw-pending flag just before the blit (disjoint work-RAM vs video-RAM), a safe reorder
// since a real draw address always folds into the framebuffer (>= 0x2400). The oracle push/pops around the
// object read and the two inner calls; the RAM diff excludes the dead stack below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-0100.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0100 as oracleBody } from "../../translated/loc_0100.js";
import { drawPendingAlien } from "../drawPendingAlien.js";
import { blitShiftedSprite } from "../blitShiftedSprite.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { u8 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0100;
const CALLER_RET = 0xabcd;
const PLAYER_SHOT_HIT = 0x2002, DESPAWN_TIMER = 0x2003, SPRITE_ID = 0x2004, FRAME_FLAG = 0x2005;
const OBJ_LOW = 0x2006, OBJ_PAGE = 0x2067, DRAW_ADDR = 0x200b, DRAW_PENDING = 0x2000;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0100 dispatches -- drawPendingAlien == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's object-read push/pop and its two inner call returns sit just below the ENTRY SP; the
    // module keeps the stack untouched. Exclude relative to that SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawPendingAlien(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine so the object gate reads (page:low) -> 0x2050 and the blit folds 0x200b into the
// framebuffer. A is seeded nonzero on both to prove the routine's dead-A divergence never reaches RAM.
function seat(m, { prize, active, spriteId, frame, drawAddr }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false); m.regs.a = 0xa5;
  m.mem.write8(PLAYER_SHOT_HIT, prize);
  m.mem.write8(DESPAWN_TIMER, 0x05);     // > 1: the bail path just decrements, no expiry side effects
  m.mem.write8(OBJ_LOW, 0x50);
  m.mem.write8(OBJ_PAGE, 0x20);          // objAddr = 0x2050
  m.mem.write8(0x2050, active);
  m.mem.write8(SPRITE_ID, spriteId);
  m.mem.write8(FRAME_FLAG, frame);
  m.mem.write16(DRAW_ADDR, drawAddr);
}

test("CRAFTED: active(alt frame), active(base frame), inactive slot, and prize-despawn bail", () => {
  const cases = [
    { name: "active+alt",  prize: 0x00, active: 0x01, spriteId: 0xab, frame: 0x02, drawAddr: 0x5678 },
    { name: "active+base", prize: 0x00, active: 0x01, spriteId: 0x40, frame: 0x00, drawAddr: 0x3456 },
    { name: "inactive",    prize: 0x00, active: 0x00, spriteId: 0xab, frame: 0x02, drawAddr: 0x5678 },
    { name: "bail",        prize: 0x01, active: 0x01, spriteId: 0xab, frame: 0x02, drawAddr: 0x5678 },
  ];
  for (const cs of cases) {
    const o = new Machine(ROM); seat(o, cs);
    const c = new Machine(ROM); seat(c, cs);
    oracle(o); drawPendingAlien(c);
    assert.equal(ramDiff(o, c), null, cs.name);
    assert.equal(c.mem.read8(DRAW_PENDING), o.mem.read8(DRAW_PENDING), `draw-pending ${cs.name}`);
    if (cs.prize === 0) assert.equal(c.mem.read8(DRAW_PENDING), 0x00, `draw-pending cleared ${cs.name}`);
    if (cs.prize) assert.equal(c.mem.read8(DESPAWN_TIMER), 0x04, `bail ticked the despawn timer ${cs.name}`);
  }
});

test("TEETH: a twin that never applies the alternate-frame bump diverges in the blitted RAM", () => {
  // Mutate drawPendingAlien's own logic: drop the +0x30 alternate-frame step, so a frame-set object blits the base
  // bank (0x1c55) where the oracle blits the alternate bank (0x1c85) -- different sprite bytes.
  function loc_0100_broken(m) {
    const even = m.mem8[SPRITE_ID] & 0xfe;
    const sprite = 0x1c00 + u8((even << 3) | (even >>> 5)); // BUG: no alternate-frame +0x30
    m.mem8[DRAW_PENDING] = 0;
    return ((m.regs.hl = m.mem16[DRAW_ADDR]), blitShiftedSprite(m, sprite, 0x10));
  }
  const cs = { prize: 0x00, active: 0x01, spriteId: 0xab, frame: 0x02, drawAddr: 0x5678 };
  const o = new Machine(ROM); seat(o, cs);
  const c = new Machine(ROM); seat(c, cs);
  oracle(o); loc_0100_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a dropped alternate-frame bump");
});
