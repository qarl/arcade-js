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
export const OBJ_SWEEP_DIRECTION = 0x420d; // [code] object sweep direction flag (0=near, 1=far)
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
  0x003c: { name: "loc_003c", role: "[code] one step of the 8-bit LCG PRNG: reads RNG_SEED, advances it, stores it back", cert: "code" },
  0x0322: { name: "loc_0322", role: "[code] sequence state handler: SEQUENCE_STATE <- 1 and arm the step-1 dwell timer (0x4008/0x4009)", cert: "code" },
  0x0331: { name: "loc_0331", role: "[code] shared tick of a two-tier cascade countdown (pointer names the countdown byte)", cert: "code" },
  0x050f: { name: "loc_050f", role: "[code] arm-field tail: force the byte at loc_41b5 to 3", cert: "code" },
  0x0515: { name: "loc_0515", role: "[code] sibling of loc_050f: force the byte at loc_4195 to 3", cert: "code" },
  0x0598: { name: "loc_0598", role: "[code] seed a strided work-RAM field", cert: "code" },
  0x070e: { name: "loc_070e", role: "[code] arm-the-mode-timer tail of the mode-0x10 handler: write loc_4009 <- 0x50", cert: "code" },
  0x08e5: { name: "loc_08e5", role: "[code] conditional consume-request-and-clear-target tail (tests bit 0 of a request flag)", cert: "code" },
  0x090b: { name: "loc_090b", role: "[code] stack-plumbing epilogue: pop hl; ret (restores HL from the stack)", cert: "code" },
  0x0972: { name: "loc_0972", role: "[code] strided block writer: stamp A into nine work-RAM cells at stride 2 from loc_4028", cert: "code" },
  0x097d: { name: "loc_097d", role: "[code] reverse-sweep tail: OBJ_SWEEP_DIRECTION <- 1", cert: "code" },
  0x0983: { name: "loc_0983", role: "[code] clear-sweep leaf: OBJ_SWEEP_DIRECTION <- 0", cert: "code" },
  0x0df6: { name: "loc_0df6", role: "[code] nudge one object-record field toward a target X value", cert: "code" },
  0x10d8: { name: "loc_10d8", role: "[code] per-frame handler nudging one object-record field toward a fixed rest value", cert: "code" },
  0x10f0: { name: "loc_10f0", role: "[code] sub-state-0 entry of a multi-phase object animation: seed phase 0 and arm a sound countdown (loc_41df)", cert: "code" },
  0x113d: { name: "loc_113d", role: "[code] per-frame expiry tick for one actor record (base pointer in IX)", cert: "code" },
  0x1146: { name: "loc_1146", role: "[code] null dispatch handler: a lone ret (target of a null jump-table slot)", cert: "code" },
  0x1292: { name: "loc_1292", role: "[code] conditional +1 gated on two look-ahead object slots being free", cert: "code" },
  0x15df: { name: "loc_15df", role: "[code] refill-one-expired-cell-and-tally body of the countdown-refresh loop", cert: "code" },
  0x16a6: { name: "loc_16a6", role: "[code] once-every-other-frame sound sweep gated by the countdown at loc_41df", cert: "code" },
  0x1733: { name: "loc_1733", role: "[code] drive one gated square-tone tick (SOUND_W_REG5 / SOUND_TONE_DURATION)", cert: "code" },
  0x1747: { name: "loc_1747", role: "[code] arm the gated sound sequence (SOUND_SEQ_PTR + companion cells)", cert: "code" },
  0x1815: { name: "loc_1815", role: "[code] stage the sound pitch value: SOUND_PITCH <- A", cert: "code" },
  0x183a: { name: "loc_183a", role: "[code] arm the alternate sound sequence (SOUND_SEQ_ACTIVE / SOUND_SEQ_PTR)", cert: "code" },
  0x186c: { name: "loc_186c", role: "[code] writer for the output-shadow pair loc_41c0 / loc_41c1", cert: "code" },
  0x1886: { name: "loc_1886", role: "[code] per-tick sound-pitch ramp over a {countdown, pitch} pair (SOUND_PITCH)", cert: "code" },
  0x18b2: { name: "loc_18b2", role: "[code] broadcast a sound level across the LFO-frequency latches (SOUND_LFO_LEVEL / SOUND_LFO_FREQ)", cert: "code" },
  0x18e8: { name: "loc_18e8", role: "[code] countdown-and-finish tail of the message scroller (MESSAGE_SCROLL_ENABLE)", cert: "code" },
  0x1917: { name: "loc_1917", role: "[code] state-3 branch of sequencer loc_18ef: seed loc_4001/loc_4002", cert: "code" },
  0x1961: { name: "loc_1961", role: "[code] overshoot arm of a compare-and-clamp: write the ceiling 99 into the counter at HL", cert: "code" },
  0x1971: { name: "loc_1971", role: "[code] set-to-one arm of a two-state flag toggle: write 1 into the flag at HL", cert: "code" },
  0x1974: { name: "loc_1974", role: "[code] pulse the coin-counter output and tick a counter (COIN_COUNTER_0_LATCH)", cert: "code" },
  0x1989: { name: "loc_1989", role: "[code] clear the coin-lockout latch: COIN_LOCKOUT <- 0", cert: "code" },
  0x1ceb: { name: "loc_1ceb", role: "[code] draw a run of tiles up a VRAM column", cert: "code" },
  0x1d58: { name: "loc_1d58", role: "[code] input-gated re-seed of the screen-fill state (VRAM_WRITE_PTR/loc_4008/loc_401a/GAME_STATE)", cert: "code" },
  0x210a: { name: "loc_210a", role: "[code] out-of-range branch of a value clamp: B <- 0x80 saturation", cert: "code" },
  0x214e: { name: "loc_214e", role: "[code] select a player's status-VRAM base (PLAYER1_STATUS_VRAM / PLAYER2_STATUS_VRAM)", cert: "code" },
  0x2279: { name: "loc_2279", role: "[code] single-digit painter of the BCD number printer", cert: "code" },
  0x2290: { name: "loc_2290", role: "[code] active-player score-field selector (PLAYER1_SCORE_BCD / PLAYER2_SCORE_BCD by CURRENT_PLAYER)", cert: "code" },
  0x25a0: { name: "loc_25a0", role: "[code] tile-pair stamp-and-step primitive", cert: "code" },
  0x25a9: { name: "loc_25a9", role: "[code] vertical tile-pair stamp", cert: "code" },
};
