// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  PROJ_Y_REF, REDRAW_COUNTER, LEVEL_LAYOUT_TRIGGER, AVG_RESET_STROBE, VEC_LIST_HEADER_LO, VEC_LIST_HEADER_HI, VECHEAD0_LEVEL, VECHEAD1_LEVEL,
  loc_9f, LEVEL_LAYOUT_PACKED, LEVEL_GEOM_LO, LEVEL_GEOM_HI, COLOR_RAM, COLOR_RAM_8,
} from "./names.js";
import { stageTextLineWithCount } from "./stageTextLineWithCount.js";
import { buildTubeLaneCoords } from "./buildTubeLaneCoords.js";

/**
 * buildLevelLayout — build the current level's full tube layout. ROM 0xc16e.
 *
 * Role in the machine: called when a new level's playfield is set up. It primes the frame flags, generates
 * the tube's lane coordinates, republishes the level-mode display header, and unpacks the level's geometry
 * table entry into the per-column geometry and colour arrays that describe the shape and hue of the tube.
 *
 * Behavior: stage the level's text line (stageTextLineWithCount); seed PROJ_Y_REF (0x5e) = 0x80 and force
 * REDRAW_COUNTER (0x114) = 0xff so the next frame fully rebuilds; compute the lane coordinates with
 * buildTubeLaneCoords. Then clear the mode trigger LEVEL_LAYOUT_TRIGGER (0x133) — strobing AVG_RESET_STROBE
 * (0x5800) to 0 only when the trigger was already clear — and latch the level-header bytes VECHEAD0_LEVEL /
 * VECHEAD1_LEVEL (0xcec6/0xcec7) into display words VEC_LIST_HEADER_LO/HI (0x2000/0x2001). Finally take the
 * level selector loc_9f, mask it to 0x70 and clamp to 0x5f, halve it and force the low three bits (idx =
 * (idx>>1)|0x07) to land on a table row, and walk eight entries downward: each packed byte splits into a
 * low nibble (written to LEVEL_GEOM_LO and COLOR_RAM) and a high nibble (written to LEVEL_GEOM_HI and
 * COLOR_RAM_8), filling the eight-column geometry/colour arrays.
 *
 * Live-out: PROJ_Y_REF, REDRAW_COUNTER, the cleared LEVEL_LAYOUT_TRIGGER, the display header words, and the
 * eight-entry LEVEL_GEOM_LO/HI and COLOR_RAM/COLOR_RAM_8 arrays.
 *
 * Returns the exit [X, Y] the ROM leaves: the table index after the eight-step walk, and Y = 0xff (the walk
 * runs Y past 0). Grounding: [seen].
 */
export function buildLevelLayout(m) {
  const { mem8 } = m;
  stageTextLineWithCount(m);
  mem8[PROJ_Y_REF] = 0x80;         // seed the projection Y reference
  mem8[REDRAW_COUNTER] = 0xff;     // force a full rebuild next frame
  buildTubeLaneCoords(m);
  // Reset the mode flag, kicking the trigger byte only when it was already clear.
  if (mem8[LEVEL_LAYOUT_TRIGGER] === 0) mem8[AVG_RESET_STROBE] = 0x00;
  mem8[LEVEL_LAYOUT_TRIGGER] = 0x00;
  mem8[VEC_LIST_HEADER_LO] = mem8[VECHEAD0_LEVEL];   // publish the level-mode display header
  mem8[VEC_LIST_HEADER_HI] = mem8[VECHEAD1_LEVEL];

  // Clamp the selector, halve it, force the low bits, then walk eight entries down.
  let idx = mem8[loc_9f] & 0x70;
  if (idx >= 0x5f) idx = 0x5f;
  idx = (idx >> 1) | 0x07;
  for (let y = 7; y >= 0; y--) {
    const packed = mem8[u16(LEVEL_LAYOUT_PACKED + idx)];
    const lo = packed & 0x0f;                 // low nibble -> geometry + colour column
    mem8[u16(LEVEL_GEOM_LO + y)] = lo;
    mem8[u16(COLOR_RAM + y)] = lo;
    const hi = packed >> 4;                   // high nibble -> second geometry + colour column
    mem8[u16(LEVEL_GEOM_HI + y)] = hi;
    mem8[u16(COLOR_RAM_8 + y)] = hi;
    idx = u8(idx - 1);
  }
  return [idx, 0xff];
}
