// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { GAME_MODE, MODE_DISPATCH_SEL, FRAME_COUNTER, loc_3d, INPUT_EDGE_FLAGS, SLOT_METRIC, ACTIVE_SLOT, REARM_COUNTER, PASS_COUNTER, SLOT_VALUE } from "./names.js";
import { foldStepIntoFraction } from "./foldStepIntoFraction.js";
import { requestWriteLowRegions } from "./requestWriteLowRegions.js";
import { armRequestedSoundSlot } from "./armRequestedSoundSlot.js";

/**
 * tickActiveSoundSlot -- per-frame service of the active sound slot. ROM 0xad6e.
 *
 * Role in the machine: Tempest's sound engine keeps a small set of "slots", each a voice/effect whose
 * amplitude value ramps over time. This is the per-frame updater for the currently active slot. It also
 * runs a coarse pass counter that, when it finally expires, kicks the game out of this mode. Each frame
 * it selects the mode-dispatch code, optionally decrements the slow pass counter, clamps the active
 * slot's value onto its legal rails, and -- only when an input-edge gate is set -- advances the slot
 * cursor and its re-arm counter, either re-arming a fresh slot or silencing the one just retired.
 *
 * Behavior: write MODE_DISPATCH_SEL (0x1) = 0x06. Once every 32 frames (low 5 bits of FRAME_COUNTER
 * (0x3) clear) decrement PASS_COUNTER (0x605); when it hits 0, set GAME_MODE (0x0) = 0x14 and return.
 * Take the active slot index ACTIVE_SLOT (0x602), fold the current step of SLOT_VALUE (0x606),slot via
 * foldStepIntoFraction, then clamp: a negative result rails to 0x1a, a nonnegative result >= 0x1b rails
 * to 0x00, otherwise it passes through; store back to SLOT_VALUE,slot. Read the edge gate = bits 3-4 of
 * INPUT_EDGE_FLAGS (0x4e), then clear bits 3,4 and 7 of that cell (mask 0x67). If the gate is clear,
 * return. Otherwise step the cursor ACTIVE_SLOT down by 1 and the re-arm counter REARM_COUNTER (0x604)
 * down by 1: if that underflows (bit 7 sets), when SLOT_METRIC (0x600),loc_3d < 4 call
 * requestWriteLowRegions, then armRequestedSoundSlot and return; if it did not underflow, silence the
 * retired slot by writing SLOT_VALUE,(slot-1) = 0x00.
 *
 * Live-out: MODE_DISPATCH_SEL, PASS_COUNTER, possibly GAME_MODE, the clamped SLOT_VALUE,slot, the
 * masked INPUT_EDGE_FLAGS, ACTIVE_SLOT, REARM_COUNTER, and either the re-armed slot state or the zeroed
 * retired slot.
 *
 * x is the X the ROM enters with (the second argument follows the frame dispatcher's handler convention,
 * (m, y, x); this routine loads Y before reading it). Returns the exit [X, Y] the ROM leaves. On the expiry exit, X = x and Y =
 * 0x14 (the mode is stored through Y). Past it the ROM loads X with the active slot and Y with the edge gate,
 * so with no edge it leaves [slot, 0] and on the retire exit [slot - 1, gate]; the re-arm exit returns
 * armRequestedSoundSlot's, which it enters with X = loc_3d (the metric-gated write loads no X).
 * Grounding: [seen].
 */
export function tickActiveSoundSlot(m, _y, x = m.regs.x) {
  const { mem8 } = m;
  mem8[MODE_DISPATCH_SEL] = 0x06; // select this mode's dispatch code
  // Slow pass counter: only every 32nd frame. Expiry bumps the game into mode 0x14.
  if ((mem8[FRAME_COUNTER] & 0x1f) === 0) {
    const count = u8(mem8[PASS_COUNTER] - 1);
    mem8[PASS_COUNTER] = count;
    if (count === 0) {
      mem8[GAME_MODE] = 0x14;
      return [x, 0x14];
    }
  }

  // Clamp the active slot's ramp value onto its rails: negative -> 0x1a, >= 0x1b -> 0x00, else pass.
  const slot = mem8[ACTIVE_SLOT];
  const clamped = foldStepIntoFraction(m, mem8[u16(SLOT_VALUE + slot)]);
  let value;
  if ((clamped & 0x80) === 0) value = clamped >= 0x1b ? 0x00 : clamped;
  else value = 0x1a;
  mem8[u16(SLOT_VALUE + slot)] = value;

  // Edge gate on bits 3-4 of INPUT_EDGE_FLAGS; consume bits 3,4,7 (keep mask 0x67). No edge -> done.
  const gate = mem8[INPUT_EDGE_FLAGS] & 0x18;
  mem8[INPUT_EDGE_FLAGS] = mem8[INPUT_EDGE_FLAGS] & 0x67;
  if (gate === 0) return [slot, gate];

  // Gated: advance the slot cursor and the re-arm counter.
  mem8[ACTIVE_SLOT] = u8(mem8[ACTIVE_SLOT] - 1);
  const step = u8(mem8[REARM_COUNTER] - 1);
  mem8[REARM_COUNTER] = step;
  if ((step & 0x80) !== 0) {
    // Re-arm counter underflowed: request a fresh slot (metric-gated write, then arm).
    const idx = mem8[loc_3d];
    if (mem8[u16(SLOT_METRIC + idx)] < 0x04) requestWriteLowRegions(m);
    return armRequestedSoundSlot(m, idx);
  }
  // Otherwise silence the slot just retired.
  mem8[u16(SLOT_VALUE + u8(slot - 1))] = 0x00;
  return [u8(slot - 1), gate];
}
