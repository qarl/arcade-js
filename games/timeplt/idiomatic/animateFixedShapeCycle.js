// SPDX-License-Identifier: GPL-3.0-only
/**
 * animateFixedShapeCycle — give a sprite entry the current frame of an eight-frame shape cycle
 * from a fixed shape base, and one fixed attribute byte beside it.
 *
 * ROM 0x3E7E-0x3E8D (loc_3e7e). Grounding: [seen] (names.js ROUTINES 0x3E7E).
 *
 * What it is: the game never draws into the sprite hardware directly; handlers write a sprite
 * SHADOW (0xAA10-0xAA6F) that publishSpriteShadow copies to the two hardware sprite banks once a
 * frame. Each shadow entry keeps a coordinate at +0 and the sprite code (shape) at +1, and a second
 * table 0x30 bytes further on holds the attribute byte (colour and flip) at +0x30 and the other
 * coordinate at +0x31. This routine fills in the shape and the +0x30 byte of one entry.
 *
 * Why the shape is "fixed": the frame number comes only from FRAME_TICK (0xA980) [seen], the frame
 * counter the vertical-blank service advances once per frame. It is halved and taken modulo eight,
 * so the shape changes on every other frame and repeats forever through eight consecutive codes
 * from one base. Nothing about the object itself is read, so two entries written in the same tick
 * get the same shape.
 *
 * Role in the machine: its one caller reaches it as `call z` after comparing ERA_INDEX with 4, so
 * it only runs in the last era; under MAME read taps saw no dispatch in runs that stayed in eras
 * 0-3 and a steady stream in one holding era 4.
 *
 * Parameter: `entry` — the address of the sprite-shadow entry to dress (IY in the ROM).
 *
 * LIVE-OUT: the two bytes written; nothing is returned.
 */

import { FRAME_TICK } from "./names.js";

// Offsets within the sprite-shadow entry: the shape code, and the attribute byte 0x30 beyond.
const SHAPE_SLOT = 1;
const ATTRIBUTE = 48;
// The eight shapes of the cycle are codes 0x40..0x47 (`add a,0x40`).
const FIRST_SHAPE = 64;
const SHAPES = 8;
// The constant stored at +0x30 (`ld (iy+0x30),0x44`).
const ATTRIBUTE_VALUE = 68;

export function animateFixedShapeCycle(m, entry = m.regs.iy) {
  const { mem8 } = m;
  // Pick the frame: `ld a,(0xa980) / rrca / and 0x07`. The rotate moves bit 0 out to bit 7, where
  // the mask drops it, so the frame is FRAME_TICK's bits one to three — i.e. (tick >> 1) mod 8.
  const frame = (mem8[FRAME_TICK] >> 1) & (SHAPES - 1);
  // Store the shape: base plus frame (`add a,0x40 / ld (iy+0x01),a`).
  mem8[entry + SHAPE_SLOT] = FIRST_SHAPE + frame;
  // Pin the byte beside it to its one constant, whatever it held before.
  mem8[entry + ATTRIBUTE] = ATTRIBUTE_VALUE;
}
