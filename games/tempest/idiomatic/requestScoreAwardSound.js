// SPDX-License-Identifier: GPL-3.0-only
import { requestSoundIfEnabled } from "./requestSoundIfEnabled.js";

/**
 * requestScoreAwardSound — cue the score/bonus award sound. ROM 0xccb9.
 *
 * Role in the machine: a one-line named cue that fires Tempest's score-award voice.
 * Sound id 0x4f is the award chime; the bonus/level-advance handler chain (loc_c98c)
 * fires it as the player clears a wave, and the BCD score-add path (loc_ca6c) fires the
 * same id when a threshold award lands — so this is the "you scored / bonus" sound.
 *
 * Behavior: hand the fixed sound id 0x4f, with the caller's X and Y, to the shared enable gate
 * requestSoundIfEnabled, which only actually voices it when the global sound-enable flag is set
 * (loc_5 bit 7); the loader stashes X/Y in loc_31/loc_32.
 * No cells of its own; all state lives downstream in the loader.
 *
 * Live-out: none directly — the effect is a queued sound-voice slot inside the gate/loader.
 * Grounding: [seen].
 */
export function requestScoreAwardSound(m, x = m.regs.x, y = m.regs.y) {
  // Fixed id 0x4f = the award chime; the gate decides whether it is actually heard.
  requestSoundIfEnabled(m, 0x4f, x, y);
}
