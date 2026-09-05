// SPDX-License-Identifier: GPL-3.0-only

/**
 * Galaxian idiomatic-layer registry + the work-RAM/hardware names its decompiled routines read.
 *
 * resolveAllIdiomatic() reads ROUTINES: each 0xADDR maps to ./idiomatic/<name>.js exporting <name>,
 * wired OVER the translated oracle; a routine with no entry falls back to its frozen oracle.
 * This is §4 decompile batch 1 (leaves): routines keep loc_<addr> names — the understand pass renames.
 * Tag: [code] understood from the routines that touch the cell; grounding ([seen]) is a later pass.
 * Cells whose role two derivers read differently stay loc_<addr> placeholders (names-debt.txt).
 */

// Return-stack scratch window (measured §3; excluded from grounding write-attribution).
export const STACK_SCRATCH = { lo: 0x43e0, hi: 0x4400 };

// Hardware ports / discrete-sound latches (board-mapped).
export const IN0 = 0x6000; // [code] IN0 input port (read)
export const COIN_LOCKOUT = 0x6002; // [code] coin-lockout latch (D0 = coin_lock output)
export const COIN_COUNTER_0_LATCH = 0x6003; // [code] coin-counter 0 hardware output
export const SOUND_LFO_FREQ = 0x6004; // [code] discrete-sound LFO frequency latch base
export const SOUND_W_REG4 = 0x6804; // [code] discrete-sound write register 4
export const SOUND_W_REG5 = 0x6805; // [code] discrete-sound write register 5

// Tilemap VRAM.
export const VRAM_BASE = 0x5000; // [code] tilemap VRAM base
export const PLAYER2_STATUS_VRAM = 0x50e0; // [code] player-2 status tilemap cell
export const PLAYER1_STATUS_VRAM = 0x5340; // [code] player-1 status tilemap cell

// Work RAM.
export const RNG_SEED = 0x401e; // [code] 8-bit LCG PRNG seed
export const GAME_STATE = 0x4005; // [code] game state index (cleared by the fill re-seed)
export const SEQUENCE_STATE = 0x400a; // [code] top-level sequence state-machine step index
export const VRAM_WRITE_PTR = 0x400b; // [code] 16-bit VRAM fill write cursor
export const CURRENT_PLAYER = 0x400d; // [code] active player index (0/1)
export const PLAYER1_SCORE_BCD = 0x40a2; // [code] player-1 packed-BCD score (3 bytes)
export const PLAYER2_SCORE_BCD = 0x40a5; // [code] player-2 packed-BCD score (3 bytes)
export const MESSAGE_SCROLL_ENABLE = 0x40b0; // [code] message-scroller enable/countdown flag
export const SOUND_SEQ_ACTIVE = 0x41cd; // [code] sound-sequence active flag
export const SOUND_TONE_DURATION = 0x41ce; // [code] sound tone duration
export const SOUND_PITCH = 0x41c1; // [code] staged sound pitch value (fed to 0x7800)
export const SOUND_SEQ_PTR = 0x41d3; // [code] sound-sequence 16-bit pointer
export const OBJ_SWEEP_DIRECTION = 0x420d; // [code] object sweep direction flag (0=ascending, 1=descending)
export const SOUND_LFO_LEVEL = 0x421f; // [code] sound LFO level shadow

// loc_<addr> placeholders — role not yet consensus-confident; allowlisted in names-debt.txt, named at grounding.
export const loc_1e68 = 0x1e68;
export const loc_1edf = 0x1edf;
export const loc_4001 = 0x4001;
export const loc_4002 = 0x4002;
export const loc_4007 = 0x4007;
export const loc_4008 = 0x4008;
export const loc_4009 = 0x4009;
export const loc_401a = 0x401a;
export const loc_4021 = 0x4021;
export const loc_4028 = 0x4028;
export const loc_4195 = 0x4195;
export const loc_41b5 = 0x41b5;
export const loc_41c0 = 0x41c0;
export const loc_41cf = 0x41cf;
export const loc_41d1 = 0x41d1;
export const loc_41d2 = 0x41d2;
export const loc_41d6 = 0x41d6;
export const loc_41df = 0x41df;
export const loc_4208 = 0x4208;
export const loc_420b = 0x420b;

// Idiomatic overrides wired OVER the translated oracle (batch 1, leaves-first). Names stay loc_<addr>
// this pass; role is a [code] reading; cert lifts to "seen" at grounding.
export const ROUTINES = {
  0x003c: { name: "advanceRandomSeed", role: "[seen] advance the 8-bit LCG PRNG seed (RNG_SEED, 0x401e) one step (seed*5+1) and return the new byte as this frame's random draw", cert: "seen" },
  0x0322: { name: "enterSequenceStep1", role: "[code] RST-28 sequence-state handler: set SEQUENCE_STATE (0x400a) to 1 and arm the step-1 dwell cascade (0x4008/0x4009 = 3,3)", cert: "code" },
  0x0331: { name: "tickCascadeCountdown", role: "[seen] shared dec-and-carry timer tick: decrement the byte at HL; on expiry step to the next in-page byte and increment it. Both current callers pass HL=0x4009, carrying into SEQUENCE_STATE (0x400a)", cert: "seen" },
  0x050f: { name: "armStateAdvanceGate", role: "[code] store the armed marker (3) into gate byte 0x41b5, which the state handler loc_06d8 tests as nonzero to take its advance/proceed path", cert: "code" },
  0x0515: { name: "armSubstateAdvanceGate", role: "[seen] store the armed marker (3) into gate byte 0x4195, tested by the sub-state handler loc_07e8 to take its advance-and-show path", cert: "seen" },
  0x0598: { name: "seedObjectRamShadowField", role: "[seen] copy 32 bytes from a ROM template into one interleaved (stride-2) field of the OBJRAM shadow (0x4021,0x4023,...,0x405f) at screen/formation init", cert: "seen" },
  0x070e: { name: "reloadSequenceDwellTimer", role: "[code] re-arm the mid-tier sequence dwell timer (0x4009) to 0x50 (80 ticks) after the handler sets the next state", cert: "code" },
  0x08e5: { name: "clearGateOnPendingRequest", role: "[code] When request flag 0x420b bit0 is pending, acknowledge it (clear 0x420b) and clear the behavior gate 0x4208 that loc_0661/loc_090d test.", cert: "code" },
  0x090b: { name: "loc_090b", role: "[code] Shared stack epilogue of the loc_08f2 enqueue path: pop the caller's saved HL and return; no work-RAM effect.", cert: "code" },
  0x0972: { name: "broadcastToStridedTable", role: "[seen] Broadcast the byte in A across the 9-cell stride-2 work-RAM table at 0x4028 (0x4028,0x402a,...,0x4038).", cert: "seen" },
  0x097d: { name: "setSweepDescending", role: "[seen] Set object sweep-direction flag 0x420d (OBJ_SWEEP_DIRECTION) to 1, switching the oscillator to its decreasing/descending phase; called by loc_090d when the swept 0x420e word reaches the upper bound.", cert: "seen" },
  0x0983: { name: "setSweepAscending", role: "[seen] Clear object sweep-direction flag 0x420d (OBJ_SWEEP_DIRECTION) to 0, switching the oscillator to its increasing/ascending phase; called by loc_090d when the swept 0x420e word reaches the lower bound.", cert: "seen" },
  0x0df6: { name: "commitMoveToTargetX", role: "[seen] Commit an object (IX record) to a horizontal move toward a chosen target X: store target X (ix+0x19), the signed per-frame step delta current-minus-target (ix+0x09), zero the move accumulator (ix+0x1a..0x1c), and advance the planner sub-state (ix+0x02).", cert: "seen" },
  0x10d8: { name: "settleObjectXAtRest", role: "[seen] Per-frame settle handler: step the object coordinate ix+0x04 up one count per frame until it lands within 5 of the rest value 0xc8 (200), then hold.", cert: "seen" },
  0x10f0: { name: "armObjectAnimAndRequestSound", role: "[code] Sub-state-0 entry of a deactivated object's animation: seed the animation timers, advance its sub-state, and post a position-keyed sound request", cert: "code" },
  0x113d: { name: "endObjectAnimOnTimerExpiry", role: "[code] Sub-state-2 tick of the deactivated-object animation: count the dwell timer down and clear the object's state flag when it expires", cert: "code" },
  0x1146: { name: "noopAnimDispatchSlot", role: "[code] No-op terminal slot (sub-state 3) of the object-animation dispatch table", cert: "code" },
  0x1292: { name: "bumpCountIfNeighborsInactive", role: "[code] Return the count incremented by one only when both look-ahead object slots are inactive, else unchanged", cert: "code" },
  0x15df: { name: "reloadExpiredCounterAndTally", role: "[seen] Reload one expired counter cell from its ROM table and return the refill tally incremented", cert: "seen" },
  0x16a6: { name: "driveDecayingSoundSweep", role: "[code] On alternate frames, emit the sweep countdown (rotated right two) to the discrete-sound register and tick it down, fading to silence", cert: "code" },
  0x1733: { name: "driveGatedSquareTone", role: "[code] Per-frame tick of a gated square-wave tone: run the duration counter down driving the toggled bit to the sound register, silence when spent", cert: "code" },
  0x1747: { name: "armSoundSequenceOnRequest", role: "[seen] Arm the gated sound sequence on an outstanding request: clear the request gate, raise the active flags, and publish the sequence-data pointer (SOUND_SEQ_PTR).", cert: "seen" },
  0x1815: { name: "stageSoundPitch", role: "[seen] Stage a pitch byte into SOUND_PITCH, the shadow the per-frame sound driver latches to the pitch port.", cert: "seen" },
  0x183a: { name: "armSoundSequenceForSelector16", role: "[code] Dispatch arm for sound-request selector 0x16: clear its sub-flag, raise SOUND_SEQ_ACTIVE and companion, and publish sequence pointer 0x1edf.", cert: "code" },
  0x186c: { name: "stagePitchAndRaiseSoundFlag", role: "[code] Stage pitch (A-1) into SOUND_PITCH and raise the 0x41c0 composite sound flag the driver latches to the sound registers.", cert: "code" },
  0x1886: { name: "advanceSoundPitchRamp", role: "[seen] Advance a rising sound-pitch ramp one step over a {countdown,pitch} pair: tick the countdown, add a fixed step to the pitch, publish it to SOUND_PITCH, and clear the 0x41c0 composite flag; idle when the countdown is drained.", cert: "seen" },
  0x18b2: { name: "broadcastSoundLfoLevel", role: "[seen] Save a sound LFO level to SOUND_LFO_LEVEL, then fan it (rotated right one bit per write) across the four SOUND_LFO_FREQ hardware latches.", cert: "seen" },
  0x18e8: { name: "endMessageScrollOnExpiry", role: "[seen] Tick a countdown at (HL) and, on the zero-crossing, clear MESSAGE_SCROLL_ENABLE (0x40b0) to stop the scroller.", cert: "seen" },
  0x1917: { name: "presetCreditCount", role: "[code] mode-3 branch of coin service loc_18ef: preset the credit count to 9 and clear the coin-phase flag", cert: "code" },
  0x1961: { name: "clampCreditsToMax", role: "[code] overshoot arm of the credit clamp: pin the credit counter back to its 99 ceiling", cert: "code" },
  0x1971: { name: "setCoinPhaseFlag", role: "[code] set arm of the coin-phase toggle: raise the coins-per-credit flag when the first coin of a pair is received", cert: "code" },
  0x1974: { name: "pulseCoinCounter", role: "[seen] drive the coin-counter output pulse and tick down its pulse-width timer", cert: "seen" },
  0x1989: { name: "clearCoinLockout", role: "[code] release the coin mechanism by clearing the coin-lockout latch", cert: "code" },
  0x1ceb: { name: "drawTextColumn", role: "[code] draw a run of characters down a VRAM column, mapping each source byte to a font tile (byte - 0x30)", cert: "code" },
  0x1d58: { name: "resetScreenFillState", role: "[seen] input-gated reset of the screen-fill state: rewind the VRAM write cursor to base, re-arm the full-page fill length, and clear the dispatch flag and game state", cert: "seen" },
  0x210a: { name: "markValueOutOfRange", role: "[code] Clamp's out-of-range arm: forces the fold index B to the fixed 0x80 sentinel when the input is beyond range.", cert: "code" },
  0x214e: { name: "selectPlayerStatusVram", role: "[code] Selects a player's status-column VRAM base (player 1 -> 0x5340, else player 2 -> 0x50e0), returned in HL.", cert: "code" },
  0x2279: { name: "drawBcdDigit", role: "[code] Paints one BCD digit as a font tile (digit+0x90) with leading-zero blanking, then advances the cursor.", cert: "code" },
  0x2290: { name: "selectCurrentPlayerScore", role: "[code] Selects the current player's 3-byte packed-BCD score field (player 1 -> 0x40a2, else player 2 -> 0x40a5), returned in DE.", cert: "code" },
  0x25a0: { name: "stampTilePair", role: "[code] Stamps a pair of consecutive tile codes into two adjacent cells ((HL)=A, (HL+1)=A+1), then steps HL by the stride and the tile code by two.", cert: "code" },
  0x25a9: { name: "drawDoubleHeightTile", role: "[code] Stamps the two halves of a double-height glyph: tile A at (HL) and tile+2 at (HL+0x20), one tilemap row apart; preserves DE.", cert: "code" },
};
