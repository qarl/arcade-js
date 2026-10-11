// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceRoundWhenFieldCleared — end the round once the field is empty: when the kill quota is spent,
 * a round transition is being held, and every object slot is free, queue the transition sounds and
 * either (attract demo) restart the attract sequence, or (a real game) start the next round and save
 * the player's context.
 *
 * ROM 0x1271-0x12C6 plus 0x12FB-0x1318 (the demo arm jumps over a table and code at 0x12C7-0x12FA).
 * Grounding: [seen] (names.js ROUTINES 0x1271; only the 0xAD10 copy destination was watched under
 * MAME, the 0xAD20 copy is code-level).
 *
 * ROLE IN THE MACHINE. Called once per pass of the round engine's service list,
 * serviceRoundThenResolvePlayerState. Most passes it returns at the first gate. The three gates are:
 *   - KILLS_REMAINING (0xAD02) [seen] is zero: the round's quota of enemy craft has been destroyed;
 *   - ROUND_TRANSITION_HOLD (0xACC6) [seen] is non-zero: the Mother-Ship's destruction has raised the
 *     transition hold (names.js: "The round advances only when this is set, the kill quota ...");
 *   - all fifteen object records from ACTOR_RECORD_SLOT0 (0xA810) [seen], stride 0x10, read zero —
 *     every object has left the field, so nothing is still dying or flying off.
 *
 * The two arms are chosen by PLAY_ACTIVE (0xAD30) [seen], which is clear during the attract demo and set
 * for the whole of a credited game.
 *
 * LIVE-OUT: memory only.
 */

import { enqueueTransitionSoundBurst } from "./enqueueTransitionSoundBurst.js";
import { hideAllSprites } from "./hideAllSprites.js";
import { startNextRound } from "./startNextRound.js";
import { ACTOR_RECORD_SLOT0, ACTOR_SPRITE_Y_SLOT0, ROUND_TRANSITION_HOLD } from "./names.js";
import { KILLS_REMAINING, PLAY_ACTIVE, ACTIVE_PLAYER, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, LIVES_REMAINING, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES } from "./names.js";
import { ROUND_TRANSITION_HOLD_SEED, ATTRACT_SEQUENCE_START_PHASE, NEXT_ROUND_START_SUBSTEP } from "./names.js";

export function advanceRoundWhenFieldCleared(m) {
  const { mem8 } = m;

  // Gate 1-3 (ROM 0x1271-0x1289): quota spent, transition held, and the 15-slot scan (`ld b,0x0f`,
  // stride `ld de,0x0010`) finds every record's first byte — its occupancy/state byte — at zero.
  // Any failure returns at once with nothing written.
  if (mem8[KILLS_REMAINING] !== 0) return;
  if (mem8[ROUND_TRANSITION_HOLD] === 0) return;
  for (let i = 0; i < 15; i++) {
    if (mem8[ACTOR_RECORD_SLOT0 + i * 0x10] !== 0) return;
  }

  // The field is clear: queue the round-transition sound burst (ROM call 0x5634 — seven sound codes,
  // six fetched from program-image cells and one keyed by the era index).
  enqueueTransitionSoundBurst(m);

  // ARM A — attract demo (PLAY_ACTIVE clear, ROM 0x12BB onward). Reload the transition hold from the
  // ROM byte at 0x07D1 (0x00, so this disarms gate 2), hide every sprite (ROM 0x15B6), then restart the
  // attract sequence: PLAY_ACTIVE and ACTIVE_PLAYER zeroed, SEQUENCE_PHASE from the ROM byte at 0x16D3
  // (0x01, the attract phase per SEQUENCE_PHASE's names.js entry), SEQUENCE_SUBSTEP to 0.
  // The ROM computes that last 0 as a fold of fixed program bytes (0x130B-0x1315, "the whole block
  // folds to zero") — an anti-tamper guard: on a changed image a non-zero sub-step would be stored.
  // The port writes the genuine result directly.
  if (mem8[PLAY_ACTIVE] === 0) {
    mem8[ROUND_TRANSITION_HOLD] = mem8[ROUND_TRANSITION_HOLD_SEED];
    hideAllSprites(m);
    mem8[PLAY_ACTIVE] = 0;
    mem8[ACTIVE_PLAYER] = 0;
    mem8[SEQUENCE_PHASE] = mem8[ATTRACT_SEQUENCE_START_PHASE];
    mem8[SEQUENCE_SUBSTEP] = 0;
    return;
  }

  // ARM B — a credited game (ROM 0x1292-0x12BA).
  // Park every non-player sprite: zero 23 sprite-Y entries from ACTOR_SPRITE_Y_SLOT0 (0xAA43) [seen] at
  // stride 2 (`ld b,0x17`, two `inc l`) — names.js calls this the "park all non-player sprites" clear.
  for (let i = 0; i < 23; i++) mem8[ACTOR_SPRITE_Y_SLOT0 + i * 2] = 0;
  // Start the next round (ROM 0x2DB8): step the round number, roll the era, refill the kill quota.
  startNextRound(m);
  // Save the live sixteen-byte player context (0xAD00, whose first byte is LIVES_REMAINING [seen]) into
  // the active player's saved block — 0xAD10 for player one, 0xAD20 for player two (PLAYER_ONE_LIVES /
  // PLAYER_TWO_LIVES [seen] are those blocks' first bytes). The ROM does this with one `ldir`.
  const dest = mem8[ACTIVE_PLAYER] === 0 ? PLAYER_ONE_LIVES : PLAYER_TWO_LIVES;
  for (let i = 0; i < 16; i++) mem8[dest + i] = mem8[LIVES_REMAINING + i];
  // Point the sequence at the next-round arm: SEQUENCE_SUBSTEP from the ROM byte at 0x4A35 (0x0D).
  mem8[SEQUENCE_SUBSTEP] = mem8[NEXT_ROUND_START_SUBSTEP];
}
