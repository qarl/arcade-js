// SPDX-License-Identifier: GPL-3.0-only
/** dressSpriteForHeadingOrRetireAtEdge — dress one object's sprite entry so it shows the way it is heading, unless the object
 * has just reached the field edge, in which case it is retired instead.
 *
 * ROM 0x4447-0x44C8 (lift: translated/loc_4447.js). Grounding: [seen] (names.js ROUTINES 0x4447).
 *
 * ROLE IN THE MACHINE. This is the dressing step for a TWO-SPRITE object (mechanisms.md, sprite
 * dressing): it fills the pair of shape bytes at entry +1 / +3 and the pair of colour/flip bytes at
 * entry +0x30 / +0x32 -- the second sprite bank sits 0x30 above the first, which is why the
 * attribute bytes are 0x30 along (see PLAYER_SPRITE_ATTRIBUTE in names.js: "Slot 0's +0x30
 * descriptor byte"). Its caller is the Mother-Ship's step (loc_43f0), which moves the pair
 * by its own velocity plus the world scroll and then calls this to dress it (mechanisms.md: "0xFF
 * (live) moves the pair ... and dresses it").
 *
 * When the era cell holds one fixed value (ERA_INDEX 4, the last era) the object is given a plain two-pose
 * flutter, and once it has taken a hit a damage-flash counter switches its colour code in a repeating
 * cycle; on any other era the record's +4 byte (folded to one of four steps; for its one caller, the
 * Mother-Ship's remaining-hit count) with the era and a frame-tick bit picks a shape pair, and the era
 * picks a colour, and one half of the compass swaps the pair into the two entry slots in its own colour
 * while the other half biases that colour by half a page -- adding 0x80 flips bit 7, one of the two
 * mirroring bits of the attribute byte, which is how the pair is drawn mirrored (mechanisms.md).
 *
 * PARAMETERS: record = the object's record (the ROM's IX); entry = its sprite entry (IY). Both
 * arrive from the caller as it left them.
 * LIVE-OUT: the object's sprite entry and damage-flash counter cell, plus whatever the retire or
 * alternate-colour tail leaves in memory. */

import { u8, u16 } from "../../../core/int.js";
import { hasReachedBoundaryBandSelectedByHeading } from "./hasReachedBoundaryBandSelectedByHeading.js";
import { retireEntryPairIntoCooldown } from "./retireEntryPairIntoCooldown.js";
import { offsetAddress } from "./offsetAddress.js";
import { restartAnimationCounterThenDressFlutterSprite } from "./restartAnimationCounterThenDressFlutterSprite.js";
import { dressSpriteFlutterShapesByFrameTickBit } from "./dressSpriteFlutterShapesByFrameTickBit.js";
import { ERA_INDEX, FRAME_TICK, MOTHER_SHIP_SHAPE_PAIR_TABLE, ERA_SPRITE_COLOUR_TABLE } from "./names.js";

// The era value on which the object flutters instead of facing its heading (`cp 0x04` at 0x4451).
const FLUTTER_ERA = 0x04;
// A hits-to-absorb count of 7 (the armed value, no hit taken yet) skips the damage-flash counter
// entirely (`cp 0x07` at 0x44A6).
const HITS_WHEN_ARMED = 0x07;

// Record offsets (mechanisms.md, object record layout): +2 the current heading, +4 the hits
// still to absorb, +6 this routine's damage-flash counter.
const HEADING = 2;
const HITS_TO_ABSORB = 4;
const DAMAGE_FLASH_COUNTER = 6;

// Sprite-entry offsets: +1 / +3 the two shape bytes (bank 0), +0x30 / +0x32 their colour/flip
// bytes (bank 1).
const SHAPE_LO = 1;
const SHAPE_HI = 3;
const COLOUR_LO = 0x30;
const COLOUR_HI = 0x32;

// The one attribute code both flutter sprites wear (`ld (iy+0x30),0x70` at 0x44BF).
const FLUTTER_CODE = 0x70;
// Bit 7 of the counter marks the alternate-colour phase (`bit 7,c` at 0x44B1; `ld (ix+0x06),0x80`).
const ALTERNATE_COLOUR_PHASE = 0x80;
// Heading + 0x40 below 0x80 selects the half of the compass centred on heading 0 (0x447F-0x4483).
const HEADING_BIAS = 0x40;
const HALF = 0x80;

export function dressSpriteForHeadingOrRetireAtEdge(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;

  /* Step 1 -- the edge test (call 0x3CC4, jp c,0x46DB). hasReachedBoundaryBandSelectedByHeading
   * answers whether the object has reached a boundary band chosen by its heading; if so the object
   * is not dressed at all but retired: retireEntryPairIntoCooldown clears both sprite entries' coordinates and
   * arms the record's delay, so the object leaves the field and waits before it can come back. */
  if (hasReachedBoundaryBandSelectedByHeading(m, record, entry)) return retireEntryPairIntoCooldown(m, record, entry);

  const era = mem8[ERA_INDEX];

  /* Step 2 -- the last era (ERA_INDEX == 4) flutters instead of facing a heading (0x44A2-0x44C7).
   * The record's +4 hits-to-absorb count decides whether the damage-flash counter at +6 runs: a
   * count of 7 leaves it alone. Otherwise the counter is stepped by one; once bit 7 is set the
   * alternate-colour phase is on and restartAnimationCounterThenDressFlutterSprite takes over the
   * whole dressing (code 0x51 for three calls, then the counter restarts from zero). Below that, a
   * counter that has overrun the hits-to-absorb count + 2 is forced to 0x80, so the NEXT call takes
   * the alternate-colour path. The cycle repeats, and it shortens as the hits left fall.
   * Either way both colour bytes take the fixed flutter code and dressSpriteFlutterShapesByFrameTickBit
   * picks the two shapes from a frame-tick bit (mechanisms.md: FRAME_TICK bit 2), so the object
   * holds each flutter pose for four frames (bit 2 flips every fourth tick) no matter which way it
   * is heading. */
  if (era === FLUTTER_ERA) {
    const hitsToAbsorb = mem8[record + HITS_TO_ABSORB];
    if (hitsToAbsorb !== HITS_WHEN_ARMED) {
      const counter = u8(mem8[record + DAMAGE_FLASH_COUNTER] + 1);
      mem8[record + DAMAGE_FLASH_COUNTER] = counter;
      if (counter & ALTERNATE_COLOUR_PHASE) return restartAnimationCounterThenDressFlutterSprite(m, counter, record, entry);
      if (u8(hitsToAbsorb + 2) < counter) mem8[record + DAMAGE_FLASH_COUNTER] = ALTERNATE_COLOUR_PHASE;
      mem8[entry + COLOUR_LO] = FLUTTER_CODE;
      mem8[entry + COLOUR_HI] = FLUTTER_CODE;
      return dressSpriteFlutterShapesByFrameTickBit(m, entry);
    }
    mem8[entry + COLOUR_LO] = FLUTTER_CODE;
    mem8[entry + COLOUR_HI] = FLUTTER_CODE;
    return dressSpriteFlutterShapesByFrameTickBit(m, entry);
  }

  /* Step 3 -- pick the shape pair and the colour (0x4456-0x447C). The index into
   * MOTHER_SHIP_SHAPE_PAIR_TABLE (0x44F1) is built as era * 16 (four `add a,a`), plus FRAME_TICK bit 1
   * -- a two-frame pose, each pose two bytes -- plus 4 bytes per damage stage, where the stage is the
   * record's +4 hits-to-absorb count folded as ((7 - hits) >> 1) & 3. The two bytes there are the two tiles'
   * shapes. The colour is one byte per era from ERA_SPRITE_COLOUR_TABLE (0x4531). offsetAddress is
   * the ROM's `rst 0x18` (HL += A). */
  const index = u8(u8(era * 16) + (mem8[FRAME_TICK] & 0x02));
  const damageStage = (u8(HITS_WHEN_ARMED - mem8[record + HITS_TO_ABSORB]) >> 1) & 0x03;
  const shapePtr = offsetAddress(m, MOTHER_SHIP_SHAPE_PAIR_TABLE, u8(damageStage * 4 + index));
  const shapeLo = mem8[shapePtr];
  const shapeHi = mem8[u16(shapePtr + 1)];
  const colourPtr = offsetAddress(m, ERA_SPRITE_COLOUR_TABLE, era);
  const colour = mem8[colourPtr];

  /* Step 4 -- mirror by compass half (0x447F-0x44A1). The heading at +2 only decides which half
   * of the compass the object faces. With (heading + 0x40) below 0x80 -- headings 0xC0-0xFF and
   * 0x00-0x3F -- the two shapes are laid into the entry in swapped order and both tiles take the
   * table colour as it is. The other half keeps the table order and adds 0x80 to the colour byte,
   * flipping its top bit (a mirroring bit), so the same pair of shapes reads as facing the other
   * way. Both colour bytes always match: the two tiles are one object. */
  if (u8(mem8[record + HEADING] + HEADING_BIAS) < HALF) {
    mem8[entry + SHAPE_LO] = shapeHi;
    mem8[entry + SHAPE_HI] = shapeLo;
    mem8[entry + COLOUR_LO] = colour;
    mem8[entry + COLOUR_HI] = colour;
  } else {
    mem8[entry + SHAPE_LO] = shapeLo;
    mem8[entry + SHAPE_HI] = shapeHi;
    mem8[entry + COLOUR_LO] = u8(colour + HALF);
    mem8[entry + COLOUR_HI] = u8(colour + HALF);
  }
}
