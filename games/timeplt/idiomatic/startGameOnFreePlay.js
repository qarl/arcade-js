// SPDX-License-Identifier: GPL-3.0-only
/** startGameOnFreePlay — start a game when the panel mirror shows either start button held, and
 * do nothing at all when it shows neither, and spend no credit anywhere in the process. The
 * two-player button wins outright: it is tested first and its arm never looks at the one-player
 * bit. Both arms raise the play flag and stock the first player from
 * the cell that holds a game's allowance; the two-player arm also raises the two-player flag and
 * stocks the second player, where the one-player arm clears both of those. Either arm then hands
 * over to the phase entry that starts the round engine. LIVE-OUT: memory. */

import { IN0_MIRROR, PLAY_ACTIVE, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES } from "./names.js";
import { loc_172a } from "./loc_172a.js";

const TWO_PLAYER_GAME = 0xad31;
const LIVES_PER_GAME = 0xa9c1;

const START_TWO_PLAYER = 0x10;
const START_ONE_PLAYER = 0x08;
const SET = 0xff;

export function startGameOnFreePlay(m) {
  const { mem8 } = m;
  const panel = mem8[IN0_MIRROR];
  if ((panel & (START_TWO_PLAYER | START_ONE_PLAYER)) === 0) return;

  const twoPlayer = (panel & START_TWO_PLAYER) !== 0;
  const allowance = mem8[LIVES_PER_GAME];
  mem8[PLAY_ACTIVE] = SET;
  mem8[TWO_PLAYER_GAME] = twoPlayer ? SET : 0;
  mem8[PLAYER_ONE_LIVES] = allowance;
  mem8[PLAYER_TWO_LIVES] = twoPlayer ? allowance : 0;
  loc_172a(m);
}
