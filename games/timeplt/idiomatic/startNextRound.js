// SPDX-License-Identifier: GPL-3.0-only
/** startNextRound — step the round counter, roll the era forward (wrapping after the fifth), and reload
 * the starting rung from one of three cells bracketed by how far into the run the round counter has got.
 * The kill quota is refilled from a non-era-keyed cell, so it is the same every round. Two flags are
 * cleared and a third set to all-ones, which marks the new round's intro as pending.
 *
 * ROM 0x2DB8-0x2DF3 (frozen lift translated/loc_2db8.js). Grounding: [seen].
 *
 * Role in the machine: Time Pilot's five eras (the manual's rounds) are played in a loop. When a
 * round is over — its callers both gate on that — this moves the active player's context block
 * (0xAD00 on) on to the next one. Two counters are kept because they mean different things:
 * ROUND_NUMBER counts on without wrapping, which is what lets the game get harder on the second
 * lap, while ERA_INDEX wraps to pick which of the five eras is drawn. The escalation comes from
 * START_RUNG, which the playfield reset later copies into ERA_RUNG.
 *
 * Not reached by the MAME sweeps (none completed a round); every write seen to these cells in
 * those runs came from the per-player context copy instead. The claims below are code-level, read
 * from the routine and the cells' own entries in names.js.
 *
 * LIVE-OUT: memory only. */

import { ERA_INDEX, KILLS_REMAINING, KILL_QUOTA, MOTHER_SHIP_ARMED, ROUND_INTRO_PENDING, ROUND_NUMBER, ROUND_TRANSITION_HOLD, START_RUNG, START_RUNG_ROUNDS_11_UP, START_RUNG_ROUNDS_1_5, START_RUNG_ROUNDS_6_10 } from "./names.js";
import { u8 } from "../../../core/int.js";

// Eras run 0-4; the ROM compares the stepped value against 5 (`cp 0x05`) and wraps to 0.
const ERAS = 5;

// The round brackets for the starting rung (`cp 0x06`, `cp 0x0b`): rounds 1-5, 6-10, and 11 on.
const SECOND_BRACKET_FROM = 6;
const THIRD_BRACKET_FROM = 11;

// The round-intro-pending flag is raised to all-ones (the ROM's `xor a; dec a` gives 0xFF).
const INTRO_PENDING_SET = 0xff;

export function startNextRound(m) {
  const { mem8 } = m;

  // Count the round (`inc (hl)` at 0x2DBB). The ordinal keeps going past five.
  mem8[ROUND_NUMBER] = mem8[ROUND_NUMBER] + 1;

  // Roll the era on, wrapping from the fifth back to the first, so the second loop replays the
  // same five eras.
  const nextEra = u8(mem8[ERA_INDEX] + 1);
  mem8[ERA_INDEX] = nextEra < ERAS ? nextEra : 0;

  // Choose the rung the round opens on. All three bracket cells come from the same DIP-selected
  // difficulty record; which one applies depends only on how many rounds have been reached —
  // below 6, 6 to 10, or 11 and up — so later rounds start higher on the escalation ladder.
  const round = mem8[ROUND_NUMBER];
  let bracket = START_RUNG_ROUNDS_11_UP;
  if (round < SECOND_BRACKET_FROM) bracket = START_RUNG_ROUNDS_1_5;
  else if (round < THIRD_BRACKET_FROM) bracket = START_RUNG_ROUNDS_6_10;
  mem8[START_RUNG] = mem8[bracket];

  // Refill the kill quota: KILL_QUOTA holds 56, loaded once at boot, and is not era-keyed, so every
  // round asks for the same number of kills before the Mother-Ship appears.
  mem8[KILLS_REMAINING] = mem8[KILL_QUOTA];
  // Clear the last round's Mother-Ship flag (it stays up after the ship dies until this or the
  // playfield reset clears it) and the round-transition hold that the Mother-Ship's destruction
  // raised, so the new round's waves can run.
  mem8[MOTHER_SHIP_ARMED] = 0;
  mem8[ROUND_TRANSITION_HOLD] = 0;
  // Mark the round's intro pending: the flag stays up until the round's first life-start hold expires.
  mem8[ROUND_INTRO_PENDING] = INTRO_PENDING_SET;
}
