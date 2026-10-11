// SPDX-License-Identifier: GPL-3.0-only
/** seedDemoAutopilotScript — seed the attract-demo autopilot: pick a heading-command script by the demo selector,
 * seat its dwell counter and little-endian pointer, then gate on the tamper readback. LIVE-OUT: memory-only.
 *
 * ROM 0x210E-0x2149 (frozen lift translated/loc_210e.js). Grounding: [seen] (names.js ROUTINES
 * 0x210e). Role in the machine: called by verifyImageSignatureThenStartAttractDemoOrDerail when
 * the attract demo starts. The attract demo is the real round engine with PLAY_ACTIVE clear, and
 * the ship is flown by flyDemoShipByScript stepping one of three byte-coded scripts in ROM; this
 * routine chooses the script and points the autopilot at its start (mechanisms.md, "The demo
 * autopilot").
 *
 * The selector is PLAYER_ONE_ERA_INDEX [seen], which the attract arm overloads for this purpose.
 * The demo's own era is written into that cell only AFTER this runs, so the script is chosen from
 * the value left behind by the previous demo (mechanisms.md).
 */

import { u8 } from "../../../core/int.js";
import { loc_2251 } from "./loc_2251.js";
import { DEMO_AUTOPILOT_SCRIPT_FIRST, DEMO_AUTOPILOT_SCRIPT_SECOND, DEMO_AUTOPILOT_SCRIPT_THIRD, DEMO_SCRIPT_DWELL, DEMO_SCRIPT_POINTER_HI, DEMO_SCRIPT_POINTER_LO, PLAYER_ONE_ERA_INDEX, TAMPER_COLOUR_READBACK, TAMPER_GLYPH_READBACK } from "./names.js";

export function seedDemoAutopilotScript(m) {
  const { mem8 } = m;

  /* Choose the script. The ROM's compare ladder on (0xAD14): 0 or 3 -> 0x218C, 1 -> 0x2251,
   * anything else (2 or 4 in practice) -> 0x22FA. */
  const selector = mem8[PLAYER_ONE_ERA_INDEX];
  const script =
    selector === 0 || selector === 3 ? DEMO_AUTOPILOT_SCRIPT_FIRST
    : selector === 1 ? DEMO_AUTOPILOT_SCRIPT_SECOND
    : DEMO_AUTOPILOT_SCRIPT_THIRD;

  /* Seat the autopilot. DEMO_SCRIPT_DWELL [seen] (0xADF2) is the packed dwell/steer byte: low six
   * bits a pass count, top two bits the turn command; it is loaded with the script's first byte
   * plus one (`ld a,(hl) / inc a`). The cursor 0xADF3/0xADF4 [seen] is written low byte first
   * (`ld (hl),e / inc l / ld (hl),d`), pointing at that same first byte. */
  mem8[DEMO_SCRIPT_DWELL] = u8(mem8[script] + 1); // dwell counter, one past the script's leading byte
  mem8[DEMO_SCRIPT_POINTER_LO] = script;
  mem8[DEMO_SCRIPT_POINTER_HI] = script >> 8;

  /* Tamper gate. TAMPER_GLYPH_READBACK [seen] holds the glyph read back from video cell 0xA5DC
   * and must be 0xFD; TAMPER_COLOUR_READBACK [seen] holds the colour read back from 0xA1DC and
   * must be 0x10 or 0x05. On any other value the ROM does `jp 0x2251` — into the second script's
   * DATA, executed as code — loc_2251 [code], which stores A through whatever address BC holds and runs down to a halt, so an
   * altered tile image never gets a working demo. */
  // a genuine tile image returns; a failed readback drops into the trap, which faults
  if (mem8[TAMPER_GLYPH_READBACK] !== 0xfd) return loc_2251();
  if (mem8[TAMPER_COLOUR_READBACK] === 0x10 || mem8[TAMPER_COLOUR_READBACK] === 0x05) return;
  return loc_2251();
}
