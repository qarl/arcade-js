// SPDX-License-Identifier: GPL-3.0-only
/** initColdStartRamThenSeedConfig — cold-boot init: paint a 64-byte work-RAM block all-ones, then seed the random
 * register, load the default high scores and empty the deferred lists, kicking the watchdog after
 * each, and hand off to the settings/cold-start chain. Control never comes back.
 * LIVE-OUT: the painted block plus whatever the four callees leave; the chain's coroutine handoff.
 *
 * ROM 0x2511-0x252F. [seen]
 *
 * Role in the machine: the fourth stage of the cold start. Power-on (0x07B1) settled the control
 * latch, 0x0069 zeroed work RAM and the sprite run at 0xB410, 0x5866 filled the screen and verified the
 * image, and it tail-jumps here. This stage puts the few structures that must NOT start at zero into
 * their empty/default state, then hands on to seedGameConfigFromDipSwitches (0x52AA), which reads the
 * DIP switches and carries the rest of the cold start.
 */

import { seedRandomRegister } from "./seedRandomRegister.js";
import { loadDefaultHighScores } from "./loadDefaultHighScores.js";
import { emptyBothDeferredCellLists } from "./emptyBothDeferredCellLists.js";
import { seedGameConfigFromDipSwitches } from "./seedGameConfigFromDipSwitches.js";
import { COMMAND_RING, WATCHDOG_RESET } from "./names.js";

// The command ring's length: 0x40 cells at 0xAC00 (the ROM's `ld b,0x40`).
const FILL_BYTES = 64;

export function initColdStartRamThenSeedConfig(m) {
  const { mem8 } = m;
  // Mark every cell of the command ring free. The ring's convention is "high bit set = empty", so a
  // zeroed ring (as 0x0069 left it) would read as 32 pending command 0s; filling it with 0xFF is
  // what makes the foreground loop see an empty ring. (ROM: `ld hl,0xac00 / ld b,0x40 / ld (hl),0xff`.)
  for (let i = 0; i < FILL_BYTES; i++) mem8[COMMAND_RING + i] = 0xff;

  // Three initialisers, each followed by a watchdog kick (`ld (0xc200),a`) so the long boot does not
  // let the watchdog time out and reset the board. The kick's value is ignored by the hardware.
  //   seedRandomRegister   (0x4B67) -- copy a fixed run of program space into the random register
  //   loadDefaultHighScores (0x4BA5) -- copy forty program bytes into the five-entry high-score table
  //   emptyBothDeferredCellLists (0x526A) -- park both deferred character-cell list cursors on empty
  const seed = seedRandomRegister(m);
  mem8[WATCHDOG_RESET] = seed;
  loadDefaultHighScores(m);
  mem8[WATCHDOG_RESET] = seed;
  emptyBothDeferredCellLists(m);
  mem8[WATCHDOG_RESET] = seed;

  // Tail jump (`jp 0x52aa`, nothing pushed) into the DIP-switch seed and the rest of the cold start;
  // control never returns here, so its result is this routine's result.
  return seedGameConfigFromDipSwitches(m);
}
