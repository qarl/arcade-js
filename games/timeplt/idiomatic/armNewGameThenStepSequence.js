// SPDX-License-Identifier: GPL-3.0-only
/**
 * armNewGameThenStepSequence — the sequence arm that sets up a game before its first round: seat both
 * players' saved context blocks to their starting values, then prepare either a credited game or an
 * attract-demo round, and step the sequence on.
 *
 * ROM 0x27B1-0x28A0. Grounding: [seen] (names.js ROUTINES 0x27B1).
 *
 * ROLE IN THE MACHINE. An arm of the round-engine phase's sub-step table, dispatched by
 * dispatchSequenceSubStepArm; it runs once and tail-steps SEQUENCE_SUBSTEP [seen]. Each player's state
 * lives in a sixteen-byte saved context block — player one at 0xAD10, player two at 0xAD20 — which is
 * copied into the live block at 0xAD00 when that player's turn starts. This arm writes the PLAYER_ONE_*
 * / PLAYER_TWO_* copies, so every value lands for both players at once.
 *
 * THE SPLIT on PLAY_ACTIVE (0xAD30) [seen], set for the whole of a credited game and clear otherwise:
 *   - SET — a real game: clear both scores, post ring command 4, load the difficulty record the
 *     cabinet's Difficulty DIP selects (names.js DIFFICULTY_SETTING [seen]: read "at exactly one place:
 *     the credited-game init", which is this arm), and arm SEQUENCE_DELAY with 0x96.
 *   - CLEAR — an attract-demo round: pick the demo's era from the cycling ATTRACT_STAGE_COUNTER, zero
 *     two frame counters and the demo-script round-robin index, reseed the random register, wipe the
 *     player-shot and object-state RAM,
 *     load difficulty record 2, and arm SEQUENCE_DELAY with 0x5A.
 * Each arm also runs one anti-tamper fold over 256 program bytes (see the steps below).
 *
 * LIVE-OUT: memory (registers and the dead stack scratch aside).
 */

import { requestRoundStartSound } from "./requestRoundStartSound.js";
import { postCommand } from "./postCommand.js";
import { loadDifficultyRecord } from "./loadDifficultyRecord.js";
import { seedRandomRegister } from "./seedRandomRegister.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { u8 } from "../../../core/int.js";
import { ACTIVE_PLAYER, ATTRACT_STAGE_COUNTER, BCD_FRAME_COUNTER, DIFFICULTY_SETTING, ENEMY_AIM_ANCHOR_Y, ENEMY_AIM_POINT_TABLE, ENEMY_STANDOFF_AIM_BLOCK_END, ENEMY_STANDOFF_AIM_SET_Y, FRAME_TICK, KILL_QUOTA, PEN_COLOUR, PLAYER1_SCORE_LO, PLAYER1_SCORE_MID, PLAYER2_SCORE_LO, PLAYER2_SCORE_MID, PLAYER_ONE_BONUS_LIFE_LATCH, PLAYER_ONE_ERA_INDEX, PLAYER_ONE_KILLS_REMAINING, PLAYER_ONE_LIFE_TICKS_MID, PLAYER_ONE_MOTHER_SHIP_ARMED, PLAYER_ONE_ROUND_INTRO_PENDING, PLAYER_ONE_ROUND_NUMBER, PLAYER_ONE_START_RUNG, PLAYER_SHOT_ARRAY, PLAYER_STATE, PLAYER_TWO_BONUS_LIFE_LATCH, PLAYER_TWO_ERA_INDEX, PLAYER_TWO_KILLS_REMAINING, PLAYER_TWO_LIFE_TICKS_MID, PLAYER_TWO_MOTHER_SHIP_ARMED, PLAYER_TWO_ROUND_INTRO_PENDING, PLAYER_TWO_ROUND_NUMBER, PLAYER_TWO_START_RUNG, PLAY_ACTIVE, SCRIPT_CYCLE_COUNTER, SEQUENCE_DELAY, SEQUENCE_PHASE, START_RUNG_ROUNDS_1_5, DISPLAY_LATCH_CHECKSUM_BASE, SEQUENCE_PHASE_CHECKSUM_BASE, PLAYER_STATE_BLOCK_END, PLAYER_SHOT_ARRAY_END, VIDEO_ENABLE_LATCH } from "./names.js";

/** Saved-context cells both players start at 0: era, bonus-life latch, Mother-Ship armed, plus the
 * active-player index and the live pen colour (ROM 0x27D0-0x27E6, one `xor a` stored to each). */
const ZERO_CELLS = [PLAYER_ONE_ERA_INDEX, PLAYER_TWO_ERA_INDEX, ACTIVE_PLAYER, PLAYER_ONE_BONUS_LIFE_LATCH, PLAYER_TWO_BONUS_LIFE_LATCH, PLAYER_ONE_MOTHER_SHIP_ARMED, PLAYER_TWO_MOTHER_SHIP_ARMED, PEN_COLOUR];
/** Saved-context cells both players start at 1: round number and the round-intro-pending flag (ROM 0x27E9-0x27F3). */
const ONE_CELLS = [PLAYER_ONE_ROUND_NUMBER, PLAYER_TWO_ROUND_NUMBER, PLAYER_ONE_ROUND_INTRO_PENDING, PLAYER_TWO_ROUND_INTRO_PENDING];

export function armNewGameThenStepSequence(m) {
  const { mem8, mem16 } = m;

  // Ask for the round-start sound (ROM call 0x5834: the code byte at 0x1767, admitted only while a game
  // is being played).
  requestRoundStartSound(m);

  // Seat the enemy aim anchor point (ENEMY_AIM_ANCHOR_Y 0xAC64 = 0x78, its X at 0xAC65 = 0x84, both
  // [seen]) and clear both players' saved life-tick counters (mid/high places, one 16-bit store each).

  mem8[ENEMY_AIM_ANCHOR_Y] = 0x78;
  mem8[ENEMY_AIM_POINT_TABLE] = 0x84;
  mem16[PLAYER_ONE_LIFE_TICKS_MID] = 0;
  mem16[PLAYER_TWO_LIFE_TICKS_MID] = 0;

  // Both players start with the round's kill quota (KILL_QUOTA 0xA9CD [seen], loaded once at boot from
  // ROM: the manual's 56) as their kills-remaining count.
  const shared = mem8[KILL_QUOTA];
  mem8[PLAYER_ONE_KILLS_REMAINING] = shared;
  mem8[PLAYER_TWO_KILLS_REMAINING] = shared;

  for (const cell of ZERO_CELLS) mem8[cell] = 0x00;
  for (const cell of ONE_CELLS) mem8[cell] = 0x01;

  // ── CREDITED GAME (PLAY_ACTIVE set; ROM 0x27FC-0x2832) ──
  if (mem8[PLAY_ACTIVE] !== 0) {
    // Zero both players' three-byte scores (0xAD33-0xAD35 and 0xAD36-0xAD38).
    mem8[PLAYER1_SCORE_LO] = 0x00;
    mem16[PLAYER1_SCORE_MID] = 0;
    mem8[PLAYER2_SCORE_LO] = 0x00;
    mem16[PLAYER2_SCORE_MID] = 0;

    // Post command 4 (argument 0) to the command ring (ROM `ld de,0x0400; rst 0x38`).
    postCommand(m, 0x04, 0x00);

    // Copy the four-byte difficulty record for the cabinet's Difficulty DIP (0-7) into force (ROM 0x0F7B).

    loadDifficultyRecord(m, mem8[DIFFICULTY_SETTING]);

    // Anti-tamper: XOR-fold the 256 program bytes at 0x1550, add 1 and write the result to the video
    // enable latch at 0xC308 (the board's LS259 picture-enable latch). On the genuine image the fold is
    // 0x4C, so 0x4D goes to the latch (checked against the ROM image); names.js VIDEO_ENABLE_LATCH notes
    // that these folds exist to blank a patched image.
    let fold = 0;
    for (let i = 0; i < 256; i++) fold ^= mem8[DISPLAY_LATCH_CHECKSUM_BASE + i];
    mem8[VIDEO_ENABLE_LATCH] = u8(fold + 1);

    // Both players open on the difficulty record's rounds-1-5 start rung (START_RUNG_ROUNDS_1_5 0xA9D3
    // [seen], just loaded), then arm the sequence's shared delay for 0x96 frames before its next step.
    const rung = mem8[START_RUNG_ROUNDS_1_5];
    mem8[PLAYER_ONE_START_RUNG] = rung;
    mem8[PLAYER_TWO_START_RUNG] = rung;
    mem8[SEQUENCE_DELAY] = 0x96;
    return advanceSequenceSubStep(m);
  }

  // ── ATTRACT-DEMO ROUND (PLAY_ACTIVE clear; ROM 0x2835-0x289E) ──
  // Cycle ATTRACT_STAGE_COUNTER (0xA9D0) through 1, 2, 3, 1, ... (ROM `cp 0x04` / `ld a,0x01`) and start the
  // demo in that era (player one's era copy) and round (era + 1), so successive demos show different eras.
  let stage = u8(mem8[ATTRACT_STAGE_COUNTER] + 1);
  if (stage >= 0x04) stage = 0x01;
  mem8[ATTRACT_STAGE_COUNTER] = stage;
  mem8[PLAYER_ONE_ERA_INDEX] = stage;
  mem8[PLAYER_ONE_ROUND_NUMBER] = u8(stage + 1);

  // Zero the frame counter FRAME_TICK [seen], the packed-decimal frame counter and the demo-script
  // round-robin index, then reseed the random register (ROM 0x4B67: a fixed seventeen-byte run copied from
  // program space, itself image-checked).
  mem8[FRAME_TICK] = 0x00;
  mem8[BCD_FRAME_COUNTER] = 0x00;
  mem8[SCRIPT_CYCLE_COUNTER] = 0x00;
  seedRandomRegister(m);

  // Wipe the player-shot records (0xAA80-0xAADF) and the player/object-state block (0xA800-0xA97F);
  // the ROM does each with an `ldir` that smears a single zero along the run.
  for (let cell = PLAYER_SHOT_ARRAY; cell <= PLAYER_SHOT_ARRAY_END; cell++) mem8[cell] = 0x00;
  for (let cell = PLAYER_STATE; cell <= PLAYER_STATE_BLOCK_END; cell++) mem8[cell] = 0x00;

  // The demo always plays difficulty record 2, whatever the DIP says.
  loadDifficultyRecord(m, 0x02);

  const r = mem8[START_RUNG_ROUNDS_1_5];
  mem8[PLAYER_ONE_START_RUNG] = r;
  mem8[PLAYER_TWO_START_RUNG] = r;

  // Anti-tamper: subtract each of the 256 program bytes at 0x3310 from SEQUENCE_PHASE [seen] and XOR the
  // result with 0x90. The bytes sum to 0x70 on the genuine image (their negation is 0x90, checked against the
  // ROM image), so for any phase 0-3 the result is the phase unchanged; an altered block would store a
  // different phase.
  let sum = mem8[SEQUENCE_PHASE];
  for (let i = 0; i < 256; i++) sum = u8(sum - mem8[SEQUENCE_PHASE_CHECKSUM_BASE + i]);
  mem8[SEQUENCE_PHASE] = sum ^ 0x90;

  // Set the sixteen-byte enemy aim-coordinate block 0xAC74-0xAC83 [seen] to 0x80, arm the sequence delay
  // for 0x5A frames, and step the sequence on.
  for (let cell = ENEMY_STANDOFF_AIM_SET_Y; cell <= ENEMY_STANDOFF_AIM_BLOCK_END; cell++) mem8[cell] = 0x80;
  mem8[SEQUENCE_DELAY] = 0x5a;
  return advanceSequenceSubStep(m);
}
