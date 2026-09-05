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

// batch 2 -- descriptive cells ([code], grounding pending)
export const SOUND_TONE_TABLE = 0x17a9; // [code] batch 2
export const SOUND_DURATION_TABLE = 0x17c8; // [code] batch 2
export const OBJ_STEP_TABLE = 0x1a45; // [code] batch 2
export const STRIDED_TABLE_SRC = 0x1d71; // [code] batch 2
export const PATH_STEP_TABLE = 0x1e00; // [code] batch 2
export const MESSAGE_PTR_TABLE = 0x235c; // [code] batch 2
export const IN0_SHADOW = 0x4010; // [code] batch 2
export const IN1_SHADOW = 0x4011; // [code] batch 2
export const OBJ_STAGE_BLOCK = 0x4054; // [code] batch 2
export const MESSAGE_CURSOR_PTR = 0x40b1; // [code] batch 2
export const MESSAGE_TEXT_PTR = 0x40b3; // [code] batch 2
export const MESSAGE_DEST_PTR = 0x40b5; // [code] batch 2
export const FLAG_BITS_BASE = 0x4100; // [code] batch 2
export const OCCUPANCY_GRID = 0x4123; // [code] batch 2
export const ROW_OCCUPANCY = 0x41e8; // [code] batch 2
export const COLUMN_OCCUPANCY = 0x41f0; // [code] batch 2
export const OBJ_ACTIVE_FLAG = 0x4200; // [code] batch 2
export const HIT_EVENT_FLAG = 0x4204; // [code] batch 2
export const FORMATION_X_BOUNDS = 0x4210; // [code] batch 2
export const DELAYED_EVENT_REQUEST = 0x4229; // [code] batch 2
export const DELAYED_EVENT_ARMED = 0x422e; // [code] batch 2
export const DELAYED_EVENT_TIMER = 0x422f; // [code] batch 2
export const OBJ_MOVE_CMD = 0x423f; // [code] batch 2
export const OBJ_TABLE = 0x42d0; // [code] batch 2
export const DESCRIPTOR_SLOT_TABLE = 0x4330; // [code] batch 2
export const START_LAMP_0 = 0x6000; // [code] batch 2
export const START_LAMP_1 = 0x6001; // [code] batch 2
export const SOUND_W_REG0 = 0x6800; // [code] batch 2
export const SOUND_W_REG1 = 0x6801; // [code] batch 2
export const SOUND_W_REG2 = 0x6802; // [code] batch 2
export const IRQ_ENABLE = 0x7001; // [code] batch 2
export const STARS_ENABLE = 0x7004; // [code] batch 2
export const SOUND_PITCH_W = 0x7800; // [code] batch 2
// batch 2 -- loc_ placeholders (role not yet consensus-confident)
export const loc_4006 = 0x4006;
export const loc_4013 = 0x4013;
export const loc_4014 = 0x4014;
export const loc_4018 = 0x4018;
export const loc_4020 = 0x4020;
export const loc_4081 = 0x4081;
export const loc_40a0 = 0x40a0;
export const loc_40ab = 0x40ab;
export const loc_4177 = 0x4177;
export const loc_41c2 = 0x41c2;
export const loc_41cc = 0x41cc;
export const loc_41d5 = 0x41d5;
export const loc_41ef = 0x41ef;
export const loc_4201 = 0x4201;
export const loc_4202 = 0x4202;
export const loc_4209 = 0x4209;
export const loc_420a = 0x420a;
export const loc_420e = 0x420e;
export const loc_4213 = 0x4213;
export const loc_4218 = 0x4218;
export const loc_4219 = 0x4219;
export const loc_421a = 0x421a;
export const loc_421b = 0x421b;
export const loc_4220 = 0x4220;
export const loc_4221 = 0x4221;
export const loc_4222 = 0x4222;
export const loc_4224 = 0x4224;
export const loc_4225 = 0x4225;
export const loc_4226 = 0x4226;
export const loc_422b = 0x422b;
export const loc_422c = 0x422c;
export const loc_422d = 0x422d;
export const loc_4245 = 0x4245;
export const loc_4246 = 0x4246;
export const loc_424a = 0x424a;
export const loc_425f = 0x425f;
export const loc_4260 = 0x4260;
export const loc_42b1 = 0x42b1;
export const loc_5193 = 0x5193;
export const loc_51da = 0x51da;

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
  0x01c6: { name: "loc_01c6", role: "[code] Sub-state setup: clears a 128-byte work-RAM block and two status bytes, points the VRAM write cursor two", cert: "code" },
  0x032e: { name: "loc_032e", role: "[code] State handler: point at the step-1 dwell timer and tick the shared two-tier cascade countdown.", cert: "code" },
  0x0336: { name: "loc_0336", role: "[code] Tick the sub-timer; while it is still counting, done. On wrap, reload it and cascade", cert: "code" },
  0x0341: { name: "loc_0341", role: "[code] Initialise one descriptor slot from the number held at (HL): index = number-1 selects the 32-byte slot,", cert: "code" },
  0x0363: { name: "loc_0363", role: "[code] Zero the strided work-RAM block: broadcast 0 across it via the shared block writer.", cert: "code" },
  0x03af: { name: "loc_03af", role: "[code] Copy three source bytes up a video-RAM column: each byte lands at the destination, whose low", cert: "code" },
  0x03c0: { name: "loc_03c0", role: "[code] Blank a run of VRAM columns: for each of `columns` columns, stamp the blank tile into three cells", cert: "code" },
  0x03d7: { name: "loc_03d7", role: "[code] When the gate byte is nonzero: advance the game-state counter, then clear a cluster of state/flag cells", cert: "code" },
  0x0473: { name: "loc_0473", role: "[code] Drive the two start-button lamps from the credit count, gated by bit 5 of the mode flag: gate clear ->", cert: "code" },
  0x0550: { name: "loc_0550", role: "[code] Init a play field: turn both start lamps off, clear four work-RAM spans, set two flag bytes, advance the", cert: "code" },
  0x0595: { name: "loc_0595", role: "[code] Seed the strided work-RAM table from its fixed source data: point the strided copier at the source", cert: "code" },
  0x0646: { name: "loc_0646", role: "[code] Unpack a 16-byte packed bitmask at `src` into 128 one-byte-per-bit flags (LSB first), writing 1 for a", cert: "code" },
  0x070d: { name: "loc_070d", role: "[code] Advance the sub-state counter, then re-arm the mode dwell timer.", cert: "code" },
  0x0764: { name: "loc_0764", role: "[code] Bit-packer: reads bit 0 of 128 flag bytes and packs them LSB-first into a 16-byte bitmap at", cert: "code" },
  0x0837: { name: "loc_0837", role: "[code] Object move dispatch: when active, nudges the object's position by the selected movement bits", cert: "code" },
  0x08bc: { name: "loc_08bc", role: "[code] Service the timing block. GATE bit0 set: drain COUNTER by four and, while it lands in the borrow", cert: "code" },
  0x0908: { name: "loc_0908", role: "[code] Commit the queue write-head, then restore the caller's saved HL through the stack epilogue.", cert: "code" },
  0x096f: { name: "loc_096f", role: "[code] Broadcast the two's-complement of L across the strided work-RAM table via the shared block writer.", cert: "code" },
  0x098e: { name: "loc_098e", role: "[code] Reduce the occupancy grid into summary cells: per-row and per-column ORs (each behind", cert: "code" },
  0x0a32: { name: "loc_0a32", role: "[code] Arm the trigger flags when a masked input line reads active. Skips when the enable gate bit is", cert: "code" },
  0x0a74: { name: "loc_0a74", role: "[code] Integrates and renders 7 moving-object records into the sprite shadow. Each 10-byte record holds two", cert: "code" },
  0x0b8d: { name: "loc_0b8d", role: "[code] Per-entry collision test: if the entry is active and its box overlaps the player,", cert: "code" },
  0x0c20: { name: "loc_0c20", role: "[code] Builds one hardware sprite record (Y, attr, sprite#, X) at IY from the object struct at IX.", cert: "code" },
  0x0d71: { name: "loc_0d71", role: "[code] Path-move step for one object: walks a per-object cursor through the step table, adding the next", cert: "code" },
  0x0f3c: { name: "loc_0f3c", role: "[code] Homing AI step: steers the object's 16-bit X position:subpixel toward the shared target by roughly", cert: "code" },
  0x1060: { name: "loc_1060", role: "[code] Ascending path-walk step for one object record. Adds the step-table byte at HL to the Y field and", cert: "code" },
  0x109b: { name: "loc_109b", role: "[code] Per-object phase entry: derives a step count n = (~seed)&3 from the record, records n+1 and a", cert: "code" },
  0x1112: { name: "loc_1112", role: "[code] Sub-state-1 tick for one object record: counts a fast field down (reloading it and stepping a companion", cert: "code" },
  0x1147: { name: "loc_1147", role: "[code] Derive an object's on-screen sprite position from the packed grid-cell field of its record. The row bits", cert: "code" },
  0x116b: { name: "loc_116b", role: "[code] Cross-coupled fixed-point rotation: runs ((seed&3)+1) integration steps over two 16-bit", cert: "code" },
  0x14f3: { name: "loc_14f3", role: "[code] Gated prescaler cascade: when the enable gate is set and the inhibit flag clear, tick the", cert: "code" },
  0x1555: { name: "loc_1555", role: "[code] Guarded two-tier timer/state updater. Bails unless three enable bits agree; then, keyed off a mode bit,", cert: "code" },
  0x15c3: { name: "loc_15c3", role: "[code] Delayed one-shot: while armed, counts the delay down and does nothing until it hits zero. On the", cert: "code" },
  0x15f4: { name: "loc_15f4", role: "[code] Scan up to four two-byte slots for the first byte with bit 0 set, and store the resulting", cert: "code" },
  0x1621: { name: "loc_1621", role: "[code] Gated one-shot arm: only when both status gates have bit 0 set and the pending word is not", cert: "code" },
  0x1688: { name: "loc_1688", role: "[code] Gated countdown: only while the arm flag's bit 0 is set AND at least one activity", cert: "code" },
  0x16b8: { name: "loc_16b8", role: "[code] Even-frame hum driver: tally a 6x10 flag grid (seeded at 1), then light that many of the", cert: "code" },
  0x176c: { name: "loc_176c", role: "[code] One step of a sound-sequence channel selected by descPtr. An inactive descriptor (byte 0) does nothing.", cert: "code" },
  0x18e7: { name: "loc_18e7", role: "[code] Terminator tail of the message scroller: the countdown pointer arrives in DE, so tick that counter", cert: "code" },
  0x1a12: { name: "loc_1a12", role: "[code] Per-object contribution to a running accumulator. Skips (leaves the total untouched) unless the object", cert: "code" },
  0x1cb5: { name: "loc_1cb5", role: "[code] Silence the sound hardware and halt the video interrupt and starfield: set the four LFO-frequency", cert: "code" },
  0x20cd: { name: "loc_20cd", role: "[code] Paints a 3-cell tilemap column from HL stepping by DE: top cell = code+1, then two fixed tiles.", cert: "code" },
  0x20e1: { name: "loc_20e1", role: "[code] Map a packed coordinate byte to its tilemap-VRAM cell address by shuffling its nibble fields.", cert: "code" },
  0x2187: { name: "loc_2187", role: "[code] Blank a 4x4 tile block in video RAM: write the blank-tile code to four rows of four cells,", cert: "code" },
  0x22f1: { name: "loc_22f1", role: "[code] Message painter. The index picks a record (dest word + text) from the pointer table; its top two", cert: "code" },
  0x2569: { name: "loc_2569", role: "[code] Convert a binary byte to packed BCD: the value modulo 100 as two decimal digits, tens in the", cert: "code" },
  0x2585: { name: "loc_2585", role: "[code] Draws a 2x2 tile block at HL from the seed tile in A: a top pair (tile, tile+1) then a bottom pair", cert: "code" },
  0x258c: { name: "loc_258c", role: "[code] Two-cell-writer tail: stamp the second tile pair through the shared stamp primitive, then restore", cert: "code" },
  0x259e: { name: "loc_259e", role: "[code] Stamps a horizontal tile pair from the fixed seed code: hands the seed to the tile-pair stamp-and-step", cert: "code" },
  0x25a7: { name: "loc_25a7", role: "[code] Stamps a vertical tile pair from the fixed seed code: the double-height glyph writer paints the seed at", cert: "code" },
};
