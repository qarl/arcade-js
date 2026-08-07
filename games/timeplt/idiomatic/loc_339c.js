// SPDX-License-Identifier: GPL-3.0-only
/** loc_339c — copy the two-byte field that a player's round index selects out of an inline table
 * into that player's own record. Which player is read from and written to is the same choice, made
 * once from the player-up flag, so the two never cross. The index is doubled as a byte before it
 * reaches the table, so an index past the half-way mark folds back to the head of it.
 * LIVE-OUT: the two bytes written. */

import { u8, u16 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";
import { ACTIVE_PLAYER } from "./names.js";

const PLAYER_ONE_ROUND = 0xad14;
const PLAYER_TWO_ROUND = 0xad24;
const PLAYER_ONE_FIELD = 0xad1b;
const PLAYER_TWO_FIELD = 0xad2b;

const FIELD_TABLE = 0x0f8d;
const FIELD_WIDTH = 2;

export function loc_339c(m) {
  const { regs, mem8 } = m;
  const secondPlayer = mem8[ACTIVE_PLAYER] !== 0;
  const field = secondPlayer ? PLAYER_TWO_FIELD : PLAYER_ONE_FIELD;
  const round = mem8[secondPlayer ? PLAYER_TWO_ROUND : PLAYER_ONE_ROUND];

  regs.hl = FIELD_TABLE;
  regs.a = u8(round * FIELD_WIDTH);
  const entry = offsetAddress(m);

  mem8[field] = mem8[entry];
  mem8[u16(field + 1)] = mem8[u16(entry + 1)];
}
