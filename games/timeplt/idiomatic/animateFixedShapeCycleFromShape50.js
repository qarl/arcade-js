// SPDX-License-Identifier: GPL-3.0-only
/**
 * animateFixedShapeCycleFromShape50 — give one sprite entry the current frame of the eight-frame
 * shape cycle that starts at shape code 0x50, and the fixed attribute 0x0A beside it.
 *
 * ROM 0x41F1-0x4200 (loc_41f1). Grounding: [seen] (names.js ROUTINES 0x41F1).
 *
 * What it is: like its sibling animateFixedShapeCycle, it dresses one entry of the sprite SHADOW
 * (0xAA10-0xAA6F; shape code at +1, attribute byte — colour and flip — at +0x30) that
 * publishSpriteShadow copies into the hardware sprite banks once a frame. The frame is picked from
 * bits one to three of FRAME_TICK (0xA980) [seen], the once-per-frame counter, so the cycle turns
 * over once every sixteen counts. Nothing about the object is read, so every entry driven through
 * here in the same tick gets the same shape.
 *
 * Why "FromShape50": the two ROM bodies are the same instruction sequence — both select the frame
 * with `ld a,(0xa980) / rrca / and 0x07`, so the two cycles run at the same rate and in step —
 * and only their constants differ: this one starts the cycle at shape 0x50 and pins the
 * attribute to 0x0A, the sibling starts at 0x40 and pins 0x44. The shape base is what the name
 * carries.
 *
 * Role in the machine: its two callers are the era-4 era-object-bank handler
 * stepSlotApproachThenBreakawayRetire (0x4194, on the breakaway arm) and the approach frame it
 * runs, flyTowardShipStandoffThenEndApproach (0x41B8). Under MAME, read taps counted zero
 * dispatches on runs that stayed in eras 0-3 and a steady stream on a run holding ERA_INDEX at 4;
 * on that run it wrote the full eight-frame shape cycle and the fixed byte beside it.
 *
 * Parameter: `sprite` — the address of the sprite-shadow entry to dress (IY in the ROM).
 *
 * LIVE-OUT: memory only — the shape byte and the byte at +0x30.
 */

import { FRAME_TICK } from "./names.js";

// Offsets within the sprite-shadow entry: the shape code, and the attribute byte 0x30 beyond.
const SHAPE = 1;
const ATTRIBUTE = 0x30;
// The eight shapes of the cycle are codes 0x50..0x57 (`add a,0x50`).
const FIRST_SHAPE = 80;
const SHAPES = 8;
// Each shape is held for two counts of FRAME_TICK (the ROM's `rrca` discards bit 0).
const COUNTS_PER_SHAPE = 2;
// The constant stored at +0x30 (`ld (iy+0x30),0x0a`).
const ATTRIBUTE_VALUE = 10;

export function animateFixedShapeCycleFromShape50(m, sprite = m.regs.iy) {
  const { mem8 } = m;
  // Pick the frame: `ld a,(0xa980) / rrca / and 0x07` — the rotated-out bit 0 is masked away, so
  // this is the counter halved, modulo eight.
  const step = Math.floor(mem8[FRAME_TICK] / COUNTS_PER_SHAPE) % SHAPES;
  // Store the shape: base plus frame (`add a,0x50 / ld (iy+0x01),a`).
  mem8[sprite + SHAPE] = FIRST_SHAPE + step;
  // Pin the byte beside it to its one constant.
  mem8[sprite + ATTRIBUTE] = ATTRIBUTE_VALUE;
}
