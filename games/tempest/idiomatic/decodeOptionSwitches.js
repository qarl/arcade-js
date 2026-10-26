// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { assemblePotStatusByte } from "./assemblePotStatusByte.js";
import {
  DSW2_SNAPSHOT, DSW1_SNAPSHOT, loc_ac, loc_ad, BONUS_LIFE_INTERVAL, DSW_BONUS_CONFIG, DSW_DIFFICULTY,
  DSW1_COINAGE, DSW2_OPTIONS, DIP_CONFIG_A, DIP_CONFIG_B, DIP_BONUS_INTERVAL, DIP_PARAM_158,
} from "./names.js";

/**
 * decodeOptionSwitches — read the operator DIP switches into live game config. ROM 0xd6bb.
 *
 * Role in the machine: the cabinet's option (DIP) switch banks encode how the operator set up the
 * machine — bonus-life interval, coinage, difficulty and related knobs. This routine samples the two
 * switch ports and expands their packed bit-fields into the cooked config cells the rest of the game
 * reads, so those settings never have to be re-decoded at each use site. It is refreshed by
 * requestRebuildIfSwitchesChanged (ROM 0xac20), which then notices when the decoded values move.
 *
 * Behavior: read the options port DSW2_OPTIONS (loc_e00) into a0 and stash a raw snapshot in
 * DSW2_SNAPSHOT. Bits 5-3 of a0 index the bonus-interval table DIP_BONUS_INTERVAL (loc_d6f7) into the
 * live BONUS_LIFE_INTERVAL (loc_156). Copy the coinage port DSW1_COINAGE (loc_d00) into DSW1_SNAPSHOT
 * (loc_9) with bit 1 toggled (^0x02). Bits 7-6 of a0 index DIP_PARAM_158 (loc_d6ff) into
 * DSW_BONUS_CONFIG (loc_158). The a0 & 0x06 field then selects a paired entry from DIP_CONFIG_A
 * (loc_d6b3) and DIP_CONFIG_B (loc_d6b4) into loc_ac and loc_ad; loc_ad is finally folded through
 * assemblePotStatusByte and the merged result recorded in DSW_DIFFICULTY (loc_16a).
 *
 * Live-out: DSW2_SNAPSHOT, DSW1_SNAPSHOT, BONUS_LIFE_INTERVAL, DSW_BONUS_CONFIG, loc_ac, loc_ad, and
 * DSW_DIFFICULTY — the cooked option-config cells consumed across the game. Returns the exit [X, Y] the ROM
 * leaves: the bits 7-6 table index and the two-bit config field, the last values it indexes through X and Y
 * (the pot/status merge loads neither). Grounding: seen.
 */
export function decodeOptionSwitches(m) {
  const { mem8 } = m;
  const a0 = mem8[DSW2_OPTIONS];      // sample the packed options port loc_e00
  mem8[DSW2_SNAPSHOT] = a0;           // keep a raw snapshot for change-detection
  mem8[BONUS_LIFE_INTERVAL] = mem8[u16(DIP_BONUS_INTERVAL + ((a0 >> 3) & 0x07))]; // bits 5-3 -> bonus interval
  mem8[DSW1_SNAPSHOT] = mem8[DSW1_COINAGE] ^ 0x02; // coinage port loc_d00, bit 1 toggled
  const x = (a0 >> 6) & 0x03;
  mem8[DSW_BONUS_CONFIG] = mem8[u16(DIP_PARAM_158 + x)]; // bits 7-6 -> bonus config
  const y = a0 & 0x06;               // the two-bit difficulty/config field
  mem8[loc_ac] = mem8[u16(DIP_CONFIG_A + y)]; // paired config entry A
  const ad = mem8[u16(DIP_CONFIG_B + y)];     // paired config entry B
  mem8[loc_ad] = ad;
  mem8[DSW_DIFFICULTY] = assemblePotStatusByte(m, ad); // fold B through the pot/status merge
  return [x, y];
}
