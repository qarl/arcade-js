// SPDX-License-Identifier: GPL-3.0-only
/** readPlayerControls — hand back the control word of the cabinet panel that faces the picture.
 * Both panels are mirrored into work RAM every frame and a flag cell selects between them.
 * LIVE-OUT: that word, returned and left in the register file; nothing is written here.
 *
 * ROM: 0x1ED1. Tag [seen] (names.js). Role in the machine: a cocktail cabinet has two control panels
 * facing each other, and the picture is turned round for the second player. The vertical-blank service
 * copies both panels into work RAM every frame, complemented so a set bit means "asserted" (the ports
 * are active-low): IN1_MIRROR 0xA9AF [seen] for the main panel, IN2_MIRROR 0xA9B0 [seen] for the
 * cocktail panel. Callers then split the word themselves — the stick nibble, the fire bit, and the
 * individual bits initials entry rolls into its press histories.
 */

import { IN1_MIRROR, IN2_MIRROR, SCREEN_UNFLIPPED } from "./names.js";


export function readPlayerControls(m) {
  const { mem8 } = m;
  // SCREEN_UNFLIPPED 0xA987 [seen] reads zero only on a cocktail cabinet with the second player up
  // (and on a cold machine before the first vertical blank); then the cocktail panel faces the
  // picture. Otherwise the main panel does (ROM: ld a,(0xa987) / and a / ld hl,0xa9af, with
  // 0xA9B0 substituted on zero).
  const flipped = mem8[SCREEN_UNFLIPPED] === 0;
  const panel = flipped ? IN2_MIRROR : IN1_MIRROR;
  // The whole mirrored byte, returned and left in the accumulator as the ROM leaves it.
  return (m.regs.a = mem8[panel]);
}
