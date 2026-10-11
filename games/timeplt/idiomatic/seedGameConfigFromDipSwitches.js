// SPDX-License-Identifier: GPL-3.0-only
/**
 * seedGameConfigFromDipSwitches — seed the settings block at power-on: two defaults from the program
 * image, then the two DIP-switch banks, handed on to the routines that unpack them.
 *
 * ROM 0x52AA-0x52D1 (ends `jp 0x2E19`). Grounding: [seen] (names.js ROUTINES 0x52AA).
 *
 * ROLE IN THE MACHINE. One link of the power-on chain (each routine jumps into the next; none
 * returns). Work RAM has just been cleared, so every setting is still zero; this is where the
 * operator's switch choices and two fixed defaults first reach RAM. It runs once per boot, so the
 * coin ratios, free-play flag and switch settings its chain derives are fixed until the next power-on.
 * Not every cell it fills is: the frame service rewrites COINAGE_SETTINGS from the same port every frame,
 * HIGH_SCORE_HI is promoted during play, and the frame service also mirrors the gameplay bank every frame
 * into DIP1_MIRROR [seen], a different cell.
 *
 * THE SWITCHES. Both banks read active-low (a switch that is ON reads 0), so every read is
 * complemented before use. DSW0_PORT (0xC360) is the coinage bank; DSW1_PORT (0xC200, the read side
 * of the watchdog address) is the gameplay bank.
 *
 * LIVE-OUT: HIGH_SCORE_HI, KILL_QUOTA, COINAGE_SETTINGS, whatever unpackCoinage leaves, and the whole
 * of the chain that follows — control never comes back.
 */

import { u8 } from "../../../core/int.js";
import { unpackCoinage } from "./unpackCoinage.js";
import { unpackTheFirstThreeSwitchSettings } from "./unpackTheFirstThreeSwitchSettings.js";
import { COINAGE_SETTINGS, HIGH_SCORE_HI, KILL_QUOTA, DEFAULT_HIGH_SCORE_HI, DEFAULT_KILL_QUOTA, DSW0_PORT, DSW1_PORT } from "./names.js";

// The two lives bits give 0..3; adding 3 makes 3, 4, 5 or 6. A sum of 6 (both switches set) is not
// stored as 6 but replaced by the all-ones byte 0xFF (ROM `cp 0x06 / jr nz / ld a,0xff`).
const LIVES_BASE = 3;
const FOLDS_TO = 0x06;
const ALL_ONES = 0xff;

export function seedGameConfigFromDipSwitches(m) {
  const { mem8 } = m;
  // Two defaults copied from fixed program bytes (0x52AA-0x52B6):
  //   HIGH_SCORE_HI (0xA98D) [seen] <- ROM 0x08C9 (1): the top byte of the displayed high score, so
  //     the readout starts at 10,000;
  //   KILL_QUOTA (0xA9CD) [seen] <- ROM 0x0874 (0x38 = 56): the quota a round starts from
  //     (copied into KILLS_REMAINING when a round starts).
  mem8[HIGH_SCORE_HI] = mem8[DEFAULT_HIGH_SCORE_HI];
  mem8[KILL_QUOTA] = mem8[DEFAULT_KILL_QUOTA];
  // Coinage bank (0x52B6-0x52BD): read DSW0, complement, store as COINAGE_SETTINGS (0xA9B1) [seen]
  // (low nibble Coin A, high nibble Coin B), then unpackCoinage [seen] turns the two nibbles into the
  // per-slot coin ratios and the free-play flag.
  mem8[COINAGE_SETTINGS] = u8(~mem8[DSW0_PORT]);
  unpackCoinage(m);

  // Gameplay bank (0x52C0-0x52CD): read DSW1 and complement it; its low two bits become the lives
  // count. The fourth setting, which would compute 6, becomes 0xFF — in play that is 255 lives, since
  // each lost life takes one off and the game ends at zero.
  const bank1 = u8(~mem8[DSW1_PORT]);
  const lives = (bank1 & 0x03) + LIVES_BASE;
  const whole = lives === FOLDS_TO ? ALL_ONES : lives;
  // Jump (0x52CF `jp 0x2E19`) into unpackTheFirstThreeSwitchSettings [seen] with the lives count and
  // the whole complemented bank; it and its continuation store the remaining bits.
  return unpackTheFirstThreeSwitchSettings(m, whole, bank1);
}
