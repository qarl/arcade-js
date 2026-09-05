// SPDX-License-Identifier: GPL-3.0-only
// Builds one hardware sprite record (Y, attr, sprite#, X) at IY from the object struct at IX.
// Active object: copy position and fold the signed angle into a display attr. Secondary-active: a
// fixed sprite# and attr. Both flags clear: park the sprite off-screen.

// Object-struct fields read (base IX).
const OBJ_ACTIVE = 0x00;      // bit 0: primary active flag
const OBJ_ACTIVE2 = 0x01;     // bit 0: secondary active flag
const OBJ_X = 0x03;
const OBJ_Y = 0x04;
const OBJ_ANGLE = 0x05;       // signed heading, folded to a display attr
const OBJ_ATTR_BASE = 0x0f;   // added into the folded attr
const OBJ_ALT_ATTR = 0x12;    // fixed attr for the secondary-active case
const OBJ_SPRITE_NO = 0x16;

// Hardware sprite record written (base IY).
const SPR_Y = 0x00;
const SPR_ATTR = 0x01;
const SPR_NO = 0x02;
const SPR_X = 0x03;

const OFF_SCREEN = 248;
const FULL_TURN = 24;         // one heading sector; folding rotates by whole sectors

export function loc_0c20(m, obj = m.regs.ix, sprite = m.regs.iy, yOffset = m.regs.c) {
  const { mem8 } = m;

  if (mem8[obj + OBJ_ACTIVE] & 0x01) {
    // Active: sprite# from the record, position copied, angle folded into the attr.
    mem8[sprite + SPR_NO] = mem8[obj + OBJ_SPRITE_NO];
    copyPosition(mem8, obj, sprite, yOffset);
    foldAngle(mem8, obj, sprite);
    return;
  }

  if (mem8[obj + OBJ_ACTIVE2] & 0x01) {
    // Secondary-active: fixed sprite# 7 and the record's fixed attr.
    mem8[sprite + SPR_NO] = 7;
    copyPosition(mem8, obj, sprite, yOffset);
    mem8[sprite + SPR_ATTR] = mem8[obj + OBJ_ALT_ATTR];
    return;
  }

  // Both flags clear: park the sprite off-screen.
  mem8[sprite + SPR_X] = OFF_SCREEN;
  mem8[sprite + SPR_Y] = OFF_SCREEN;
}

// X = objX - 8; Y = complement(objY) - yOffset. Byte stores wrap.
function copyPosition(mem8, obj, sprite, yOffset) {
  mem8[sprite + SPR_X] = mem8[obj + OBJ_X] - 8;
  mem8[sprite + SPR_Y] = 255 - mem8[obj + OBJ_Y] - yOffset;
}

// Fold the signed angle into [-12, +11] by whole sectors, then map the settled value to a display
// attr (facing flag in the high bits) plus a one-pixel nudge on the diagonal cases.
function foldAngle(mem8, obj, sprite) {
  const attrBase = mem8[obj + OBJ_ATTR_BASE];
  let a = mem8[obj + OBJ_ANGLE];

  for (;;) {
    if (a < 128) {
      if (a < 6) {                              // +0..+5
        a = ((a + 17) & 0xff) | 0xc0;
        mem8[sprite + SPR_ATTR] = a + attrBase;
        mem8[sprite + SPR_X] = mem8[sprite + SPR_X] + 1;
        mem8[sprite + SPR_Y] = mem8[sprite + SPR_Y] + 1;
        return;
      }
      if (a < 12) {                             // +6..+11
        a = ((255 - a + 30) & 0xff) | 0x80;
        mem8[sprite + SPR_ATTR] = a + attrBase;
        mem8[sprite + SPR_Y] = mem8[sprite + SPR_Y] + 1;
        return;
      }
      a = (a - FULL_TURN) & 0xff;               // still too far forward
      continue;
    }
    if (a >= 250) {                             // -6..-1
      a = ((255 - a + 18) & 0xff) | 0x40;
      mem8[sprite + SPR_ATTR] = a + attrBase;
      mem8[sprite + SPR_X] = mem8[sprite + SPR_X] + 1;
      return;
    }
    if (a >= 244) {                             // -12..-7
      a = (a + 29) & 0xff;
      mem8[sprite + SPR_ATTR] = a + attrBase;
      return;
    }
    a = (a + FULL_TURN) & 0xff;                 // still too far back
  }
}
