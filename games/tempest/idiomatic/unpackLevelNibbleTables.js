// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { LEVEL_GEOM_LO, LEVEL_GEOM_HI, loc_9f, COLOR_RAM, COLOR_RAM_8, LEVEL_LAYOUT_PACKED } from "./names.js";

/**
 * unpackLevelNibbleTables — expand the packed ROM level-geometry table into the working nibble tables.
 * ROM 0xc196.
 *
 * Role in the machine: each Tempest tube shape (the level's per-segment geometry) is stored packed in ROM
 * at loc_c1fd, two 4-bit fields per byte. Before a wave can render, the game must explode those bytes into
 * two eight-entry working tables of raw nibbles the geometry/render code reads directly, and mirror them
 * into color RAM so the display list picks them up. This is the unpack that wave setup (selectWaveStartSlot,
 * resetVectorTailCursor) runs on level (re)start.
 *
 * Behavior: read the level selector loc_9f, mask it to bits 6..4 (0x70) and clamp it to 0x5f so an
 * out-of-range level saturates to the last valid shape. Form the packed-table read index as (sel>>1)|0x07,
 * then walk y = 7..0, consuming one packed byte per step (x decremented alongside y). Each byte's low nibble
 * is written into geometry-low loc_19+y and its display mirror COLOR_RAM loc_800+y; its high nibble into
 * geometry-high loc_21+y and mirror loc_808+y.
 *
 * Live-out: the eight-entry low table loc_19..loc_20, the eight-entry high table loc_21..loc_28, and their
 * color-RAM mirrors at loc_800.. / loc_808.. — the working tube geometry consumed by the renderer.
 *
 * Returns the exit [X, Y] the ROM leaves: the read index after the eight-step walk, and Y = 0xff (the walk
 * runs Y past 0). Grounding: [seen].
 */
export function unpackLevelNibbleTables(m) {
  const { mem8 } = m;
  // Level selector loc_9f, restricted to bits 6..4 and saturated at 0x5f (last valid shape).
  let sel = mem8[loc_9f] & 0x70;
  if (sel >= 0x5f) sel = 0x5f;
  // Packed-table read index for loc_c1fd; walks downward with y via x--.
  let x = (sel >> 1) | 0x07;
  for (let y = 7; y >= 0; y--) {
    const b = mem8[u16(LEVEL_LAYOUT_PACKED + x)];
    // Low nibble -> geometry-low table and its color-RAM mirror.
    const lo = b & 0x0f;
    mem8[u16(LEVEL_GEOM_LO + y)] = lo;
    mem8[u16(COLOR_RAM + y)] = lo;
    // High nibble -> geometry-high table and its color-RAM mirror.
    const hi = b >> 4;
    mem8[u16(LEVEL_GEOM_HI + y)] = hi;
    mem8[u16(COLOR_RAM_8 + y)] = hi;
    x--;
  }
  return [u8(x), 0xff];
}
