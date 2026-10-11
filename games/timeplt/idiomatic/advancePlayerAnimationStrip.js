// SPDX-License-Identifier: GPL-3.0-only
/** advancePlayerAnimationStrip — advance a multi-pass tile animation driven by a phase byte in the record. On the
 * opening frame (phase at or past the cap) the phase is clamped, the paired entry is flagged, and
 * sound cues are requested — one burst always, one extra from ERA_INDEX 2 up — and then two
 * tamper-witness cells may divert the frame into the tamper trap instead. Otherwise the phase is stepped
 * down and, when it lands on one of seven keyframe values, a shape strip is blitted tile-by-tile
 * into video and colour memory a row at a time; a phase between keyframes draws nothing.
 * LIVE-OUT: memory. The routine is a pure painter — its sole caller (dispatchPlayerFrameByState)
 * tail-returns and reads no register it leaves, so every register it touches is dead-after-return
 * scratch and lives here as a JS local. The two diverts land on the tamper trap, which reads
 * nothing: a good image never takes them, so nothing is handed to it. */
//
// ROM 0x2010-0x20AE (lift: translated/loc_2010.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This is the player ship's EXPLOSION (mechanisms.md, "The explosion"). A kill
// stores 0xF0 into PLAYER_STATE, the player record's head byte; from the next pass on,
// dispatchPlayerFrameByState (0x1EDF) sends any player state other than 0 or 0xFF here, with IX on
// the player record (0xA800) and IY on its sprite entry (0xAA10). The routine uses that state byte
// itself as its countdown:
//   * opening frame (0xB4 or more): clamp to 0xB4, hide the ship's sprite, request the opening-frame
//     sound cues (which sounds they are is unidentified, mechanisms.md), and check two anti-tamper
//     witnesses;
//   * every pass of the player's handler: count down by one, and on seven keyframe values paint a 6-row by 5-cell block of
//     character tiles over the ship's pinned screen position -- a fireball drawn in the background
//     plane, growing and then shrinking;
//   * between keyframes nothing is drawn; the count runs on silently until the round engine sees it
//     reach zero and takes a life (that is not done here).
//
// PARAMETERS. `record` is the player record, `entry` the player's sprite entry; both are seated by the caller.
//
// LIVE-OUT: memory only -- PLAYER_STATE, the sprite-code byte, the sound requests, and the painted
// character and colour cells.

import { u8, u16 } from "../../../core/int.js";
import { loc_1f2e } from "./loc_1f2e.js";
import { requestSoundSixStopWhilePlaying } from "./requestSoundSixStopWhilePlaying.js";
import { requestDestructionSoundBurst } from "./requestDestructionSoundBurst.js";
import { offsetAddress } from "./offsetAddress.js";
import {
  TAMPER_COLOUR_STRIP,
  TAMPER_GLYPH_STRIP,
  ERA_INDEX,
  PLAYER_ANIM_ROW_COUNT,
  PLAYER_ANIM_COL_COUNT,
  PLAYER_ANIM_VRAM_BASE,
  PLAYER_ANIM_STRIP_0,
  PLAYER_ANIM_STRIP_1,
  PLAYER_ANIM_STRIP_2,
  PLAYER_ANIM_STRIP_3,
  PLAYER_ANIM_STRIP_4,
} from "./names.js";

// Record and sprite-entry offsets. PHASE is the record's head byte -- for the player, PLAYER_STATE.
const PHASE = 0x00; // record byte holding the animation phase
const SPRITE_CODE = 0x01; // paired-entry byte flagged on the opening frame
const FIRST_FRAME = 0xb4; // phases at or above this are the opening frame; clamp to it
// 0xFF written to the sprite entry's +1 byte (PLAYER_SPRITE_CODE for the player). Per mechanisms.md,
// sprite 255 in the sprite ROM is empty, so writing it makes the ship's own sprite disappear -- the
// tile fireball replaces it.
const EMPTY_SPRITE_CODE = 0xff;
// The late-era sound is asked for only from ERA_INDEX 2 up (`cp 0x02` / `call nc,0x5679`).

const EXTRA_CUE_LEVEL = 0x02;
// The anti-tamper witnesses' genuine values: the sampled caption glyph must be 0xA5 (`cp 0xa5` at
// 0x202D) and its colour 0x05 or 0x10 (`cp 0x05` / `cp 0x10` at 0x2036-0x203B).
const GENUINE_GLYPH = 0xa5;
const GENUINE_COLOUR_A = 0x05;
const GENUINE_COLOUR_B = 0x10;
const COLOUR_BIAS = 0xc1; // added to the level to pick the strip's colour attribute
// The character plane is 32 cells to a row; after a row of five tiles, adding 0x1B (27) more lands
// on the first cell of the row below (`ld a,0x1b` / `rst 0x18`).
const ROW_ADVANCE = 0x1b; // step from the last tile of a row to the first of the next
const COLOUR_RAM_BIT = 2; // clearing this bit of the high address byte maps video into colour memory
const VRAM_TO_COLOUR = 1 << (8 + COLOUR_RAM_BIT); // clear from a video address to reach colour RAM
// (The ROM does this with `res 2,h` / `set 2,h`: each tile's colour cell sits 0x400 below its glyph
// cell, so clearing bit 10 of the address reaches it.)

// phase after the decrement -> base of the strip's shape data, in keyframe order
// The seven keyframes are eight counts apart (0xB3 down to 0x83), matched one `cp`/`jr z` at a time
// at 0x2046-0x2062. The strip order 0, 1, 2, 3, 3, 2, 4 grows the fireball and shrinks it again; per
// mechanisms.md the last strip is filled entirely with glyph 0xF1, the glyph that surrounds the
// drawing in the other strips, so it paints the explosion out. The five 30-byte strips are ROM data at
// 0x1F76-0x200B (bases 0x1F76, 0x1F94, 0x1FB2, 0x1FD0, 0x1FEE).
const FRAME_ARMS = [
  [0xb3, PLAYER_ANIM_STRIP_0],
  [0xab, PLAYER_ANIM_STRIP_1],
  [0xa3, PLAYER_ANIM_STRIP_2],
  [0x9b, PLAYER_ANIM_STRIP_3],
  [0x93, PLAYER_ANIM_STRIP_3],
  [0x8b, PLAYER_ANIM_STRIP_2],
  [0x83, PLAYER_ANIM_STRIP_4],
];

export function advancePlayerAnimationStrip(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;
  const X = (d) => u16(record + d);
  const Y = (d) => u16(entry + d);

  // STEP 1 -- OPENING FRAME (0x2010-0x203F). A fresh kill leaves the state at 0xF0, above the cap, so
  // this runs exactly once per explosion: the clamp to 0xB4 makes every later pass skip it.
  if (mem8[X(PHASE)] >= FIRST_FRAME) {
    // opening frame: clamp the phase, flag the paired entry, request the opening-frame sound cues
    mem8[X(PHASE)] = FIRST_FRAME;
    mem8[Y(SPRITE_CODE)] = EMPTY_SPRITE_CODE;
    if (mem8[ERA_INDEX] >= EXTRA_CUE_LEVEL) requestSoundSixStopWhilePlaying(m);
    requestDestructionSoundBurst(m);

    // two tamper-witness cells divert the frame into the tamper trap when either departs from its genuine value
    // TAMPER_GLYPH_STRIP (0xABFE) holds a glyph sampled from the copyright caption and
    // TAMPER_COLOUR_STRIP (0xABFF) its colour, both [seen]. On a genuine image they always pass; a
    // patched caption sends the frame into loc_1f2e ([code]), a table whose bytes then run as code.
    const glyph = mem8[TAMPER_GLYPH_STRIP];
    if (glyph !== GENUINE_GLYPH) return loc_1f2e(m);
    const drawState = mem8[TAMPER_COLOUR_STRIP];
    if (drawState !== GENUINE_COLOUR_A && drawState !== GENUINE_COLOUR_B) return loc_1f2e(m);
  }

  // STEP 2 -- COUNT DOWN (`dec (ix+0x00)` at 0x2040). Every pass, the opening one included.
  // step the phase down; a strip draws only when it lands on one of seven keyframes
  const phaseAddr = X(PHASE);
  mem8[phaseAddr] = u8(mem8[phaseAddr] - 1);
  const phase = mem8[phaseAddr];
  let base = null;
  for (const [frame, table] of FRAME_ARMS) {
    if (phase === frame) { base = table; break; }
  }
  if (base === null) return; // phase between keyframes draws nothing

  // STEP 3 -- PAINT THE KEYFRAME (0x2089-0x20AE).
  // blit the shape strip tile-by-tile into video memory, mirroring each tile's colour attribute
  // into the colour plane VRAM_TO_COLOUR below; ROW_COUNT rows of COL_COUNT tiles, ROW_ADVANCE
  // between rows. The colour byte is the same for every tile: the level biased by COLOUR_BIAS.
  // ("Level" here is ERA_INDEX, 0xAD04 [seen].) The destination is PLAYER_ANIM_VRAM_BASE (0xA5AF), the
  // block over the ship's pinned screen position. The row and column counts are not immediates: the
  // ROM reads them as bytes of its own image at 0x337A (rows, outer loop) and 0x4902 (tiles per row,
  // inner loop), which mechanisms.md gives as 6 rows by 5 cells.
  let src = base;
  let dst = PLAYER_ANIM_VRAM_BASE;
  const colour = u8(mem8[ERA_INDEX] + COLOUR_BIAS);
  let rows = mem8[PLAYER_ANIM_ROW_COUNT];
  do {
    let cols = mem8[PLAYER_ANIM_COL_COUNT];
    do {
      mem8[dst] = mem8[src];
      mem8[dst & ~VRAM_TO_COLOUR] = colour;
      dst = u16(dst + 1);
      src = u16(src + 1);
      cols = u8(cols - 1);
    } while (cols !== 0);
    // End of a row: step the video cursor down to the start of the next row (the source strip is
    // packed, so it simply runs on).
    dst = offsetAddress(m, dst, ROW_ADVANCE);
    rows = u8(rows - 1);
  } while (rows !== 0);
}
