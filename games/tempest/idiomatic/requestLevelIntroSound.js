// SPDX-License-Identifier: GPL-3.0-only
import { requestSoundIfEnabled } from "./requestSoundIfEnabled.js";

/**
 * requestLevelIntroSound — voice the level-intro / skill-step start. ROM 0xccfe.
 *
 * Role in the machine: a one-line cue that requests fixed sound id 0xbf through the enable
 * gate requestSoundIfEnabled (loc_ccc3). Its sole caller (loc_90c4) fires it at phase 3 of
 * the start-slot pick / wave working-set reseed, so this is the sound heard as a new level's
 * intro / the skill-rate start step begins.
 *
 * Behavior: request the constant id 0xbf through the gate, carrying the caller's X and Y to the
 * loader's loc_31/loc_32 stash. Live-out:
 * a queued sound request when the loc_5 enable flag permits it (dropped otherwise).
 * Grounding: [seen].
 */
export function requestLevelIntroSound(m, x = m.regs.x, y = m.regs.y) {
  // id 0xbf, gated by loc_5; fired at start-slot-pick phase 3.
  requestSoundIfEnabled(m, 0xbf, x, y);
}
