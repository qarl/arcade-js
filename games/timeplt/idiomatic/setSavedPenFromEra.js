// SPDX-License-Identifier: GPL-3.0-only
/** setSavedPenFromEra — seed the pen (glyph and colour) that the active player's SAVED context block
 * will hand back, from the two-byte record the era in that same block selects out of a ROM table.
 *
 * ROLE. Each player has a sixteen-byte saved context block (player one at 0xAD10, player two at
 * 0xAD20) that mirrors the live block at 0xAD00; when a player comes up, the context load (the
 * sixteen-byte copy at 0x4C8A) copies that block into the live one. This routine writes only the
 * pen pair of the saved block (+0x0B glyph, +0x0C colour), so the pen takes effect the next time
 * that player's context is loaded -- the live pen is left alone. That is what separates it from
 * seatCaptionPenFromEraFoldingTamperIntoPhase (0x335E), which also sets the live pen.
 *
 * Which player is read from and written to is the same choice, made once from ACTIVE_PLAYER
 * (0 = player one, 1 = player two), so the era read and the pen written can never cross blocks.
 * The era index is doubled as a byte before it reaches the table (the Z80 `add a,a`), so an index
 * past the half-way mark would fold back to the head of the table.
 *
 * ROM 0x339C-0x33B7 (frozen lift translated/loc_339c.js). Grounding: [seen] (names.js ROUTINES
 * 0x339c). LIVE-OUT: the two bytes written into the active player's saved pen pair.
 */

import { u8, u16 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";
import { ACTIVE_PLAYER, PLAYER_ONE_ERA_INDEX, PLAYER_ONE_PEN_GLYPH, PLAYER_TWO_ERA_INDEX, PLAYER_TWO_PEN_GLYPH, ERA_PEN_TABLE } from "./names.js";


// Each table record is two bytes: glyph then colour.
const FIELD_WIDTH = 2;

export function setSavedPenFromEra(m) {
  const { mem8 } = m;

  // Pick the player once. ACTIVE_PLAYER is zero for player one; the ROM loads DE with 0xAD1B and A
  // with 0xAD14, and only on a non-zero player swaps both to player two's pair (0xAD2B / 0xAD24).
  const secondPlayer = mem8[ACTIVE_PLAYER] !== 0;
  const field = secondPlayer ? PLAYER_TWO_PEN_GLYPH : PLAYER_ONE_PEN_GLYPH;
  const eraIndex = mem8[secondPlayer ? PLAYER_TWO_ERA_INDEX : PLAYER_ONE_ERA_INDEX];

  // Locate the era's record. The table sits at 0x0F8D -- bytes of the program image that are also
  // routine 0x0F8D's own code, read here as data. The index is doubled in eight bits, then the
  // restart at 0x0018 (offsetAddress) adds it to the table base.
  const entry = offsetAddress(m, ERA_PEN_TABLE, u8(eraIndex * FIELD_WIDTH));

  // Copy the record's two bytes into the saved pen pair, glyph first -- the ROM's two `ldi`s.
  mem8[field] = mem8[entry];
  mem8[u16(field + 1)] = mem8[u16(entry + 1)];
}
