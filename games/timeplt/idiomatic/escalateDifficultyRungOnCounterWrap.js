// SPDX-License-Identifier: GPL-3.0-only
/** escalateDifficultyRungOnCounterWrap — advance a three-place base-sixty tick counter; each time the lowest place rolls
 * over, count down a reload timer, and each time that timer fires rearm it, climb the escalation rung one step toward
 * its ceiling, and apply the row that rung selects.
 *
 * ROM 0x4D3A-0x4D66 (lift: translated/loc_4d3a.js). Grounding: [seen] (names.js ROUTINES 0x4D3A).
 *
 * ROLE IN THE MACHINE. This is how the game gets harder DURING a life. Its one caller is the round
 * engine's per-dispatch service (serviceRoundThenResolvePlayerState), so it runs once per round-engine
 * pass, not once per frame. The difficulty within an era is one of sixteen rows of a tuning table,
 * chosen by the era (high nibble) and ERA_RUNG 0xACC0 [seen] (low nibble); applyEraRungSettings
 * scatters the chosen row over the spawner caps, aim windows, cooldowns and thresholds. The rung
 * climbs once every ERA_RUNG_PERIOD x 60 passes (mechanisms.md, the escalation rung).
 *
 * The counter is LIFE_TICKS_LOW 0xAD05 [seen] and the two places above it (LIFE_TICKS_MID 0xAD06,
 * LIFE_TICKS_HIGH 0xAD07), each a packed-decimal byte that rolls over at 60. It is NOT a clock
 * (names.js LIFE_TICKS_LOW): it counts passes of this service, and other subsystems read its low
 * place as a phase.
 * LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";
import { advanceSexagesimalDigit } from "./advanceSexagesimalDigit.js";
import { applyEraRungSettings } from "./applyEraRungSettings.js";
import { ERA_RUNG, ERA_RUNG_PERIOD, ERA_RUNG_TIMER, LIFE_TICKS_LOW, LIFE_TICKS_MID, LIFE_TICKS_HIGH } from "./names.js";

// The highest rung: `cp 0x10` / `ld a,0x0f` at 0x4D5B-0x4D5F clamp the climb here.
const TOP_RUNG = 0x0f;

export function escalateDifficultyRungOnCounterWrap(m) {
  const { mem8 } = m;

  /* Step 1 -- tick the base-sixty counter (0x4D3A-0x4D4A). advanceSexagesimalDigit steps one
   * place and reports whether it rolled over from 59 to 0 (the ROM answers in an inverted carry;
   * here it is a plain truthy "wrapped"). The low place steps every pass; the middle place only
   * when the low one wrapped; the top place only when the middle one did. When the low place
   * did NOT wrap the whole routine is over (`ret c` at 0x4D40) -- the rung timer below is only
   * ever touched once every sixty passes. */
  // carry into the next place only while a place rolls over; a low place that holds ends the whole call
  if (!advanceSexagesimalDigit(m, LIFE_TICKS_LOW)) return;
  if (advanceSexagesimalDigit(m, LIFE_TICKS_MID)) advanceSexagesimalDigit(m, LIFE_TICKS_HIGH);

  /* Step 2 -- count one wrap off the rung timer (0x4D4B-0x4D52). ERA_RUNG_TIMER 0xA9D7 [seen]
   * holds how many more wraps before the rung climbs. A timer already at zero is idle and stays
   * so (`ret z`); a timer that is still nonzero after its step is waiting (`ret nz`). Only the
   * wrap that takes it from one to zero falls through. */
  if (mem8[ERA_RUNG_TIMER] === 0) return;
  mem8[ERA_RUNG_TIMER] = u8(mem8[ERA_RUNG_TIMER] - 1);
  if (mem8[ERA_RUNG_TIMER] !== 0) return;

  /* Step 3 -- the timer fired: rearm it from ERA_RUNG_PERIOD 0xA9D6 [seen] (copied from a program byte
   * by the difficulty-record copy at each game and demo start), climb ERA_RUNG by one but never past 15, and hand on to
   * applyEraRungSettings (the ROM tail-jumps to 0x1A9A) so the new row takes effect at once. The
   * rung is held at 15 rather than wrapped, so a long life stays on the hardest row of its era. */
  mem8[ERA_RUNG_TIMER] = mem8[ERA_RUNG_PERIOD];
  const rung = u8(mem8[ERA_RUNG] + 1);
  mem8[ERA_RUNG] = rung > TOP_RUNG ? TOP_RUNG : rung;

  return applyEraRungSettings(m);
}
