// SPDX-License-Identifier: GPL-3.0-only
/** stepHighScoreInitialsEntry — one frame of high-score initials entry. On even frames the facing panel's four
 * controls are rolled into their press histories; a fresh commit locks the shown letter into the
 * next slot (and, on the last slot, finishes the entry), a fresh forward/back press steps the
 * shown letter round its 27-value ring, and a forward or back history that has saturated is emptied so a held
 * control repeats. On odd frames the cursor cell's colour flashes. Every eighth frame the entry
 * clock ticks, and running out finishes the entry too. Finishing re-arms the clock, queues the
 * transition sounds and steps the sequence on. After the scan, once neither player has lives
 * left, a held start button with a credit (or on free play) starts the next game.
 * LIVE-OUT: memory only; the accumulator and flags left behind are dead at the one caller. */
//
// ROM 0x18C3-0x19D9; lift: translated/loc_18c3.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. After a game over the phase-3 sub-step table runs a short run of arms: arm 8
// (fileScoreAfterGameOverHoldElsePassTurn) files the score into the high-score table, arm 9
// (erasePenRouteThenOpenInitialsEntry) lays out the entry screen and seeds the press histories,
// letter index and slot count this routine steps -- three slots left, letter 0, empty press
// histories. Arm 8's filing has already parked two cursors: SCRATCH_PTR_A (0xA991) [seen] at the
// filed record's initials bytes in the high-score table, SCRATCH_PTR_B (0xA993) [seen] at the
// on-screen cell where the next initial is drawn. This is arm 10, run every frame
// until the entry finishes, when it steps the sequence sub-step on.
//
// HOW A CONTROL IS READ. Each control is debounced by a PRESS HISTORY: a byte its bit is rolled into
// on every other frame, newest sample in bit 0. The owner acts only when the low three bits read 001
// -- "not pressed, not pressed, pressed" -- i.e. once, on the leading edge of a press. A held control
// fills the byte with ones and 001 cannot recur; so once the forward or back byte saturates it is emptied (the two commit histories never are)
// (rearmHeldControlRepeat, 0x1980 [seen]), the next sample then reads as a fresh press, and a held
// control auto-repeats.
//
// THE SCREEN. Video RAM has two planes 0x400 apart: a cell's glyph at the tile-plane address and its
// colour at the same address with bit 10 (0x400) clear, which is how every colour write below is
// addressed (`cursor & ~COLOUR_PLANE_BIT`).
//
// LIVE-OUT: memory only -- the initials glyphs in the table record and on screen, their colours, the
// entry cells (histories, letter index, slots left, flash timer), SEQUENCE_DELAY, the two scratch
// pointers, and on a finish or a new-game start whatever those routines set up.

import { u8 } from "../../../core/int.js";
import { readPlayerControls } from "./readPlayerControls.js";
import { rearmHeldControlRepeat } from "./rearmHeldControlRepeat.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { advanceCharCursor } from "./advanceCharCursor.js";
import { enqueueTransitionSoundBurst } from "./enqueueTransitionSoundBurst.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { hideAllSprites } from "./hideAllSprites.js";
import { startOnePlayerGame } from "./startOnePlayerGame.js";
import { startTwoPlayerGame } from "./startTwoPlayerGame.js";
import { startGameOnFreePlay } from "./startGameOnFreePlay.js";
import {
  CREDIT_COUNT, FRAME_TICK, FREE_PLAY, IN0_MIRROR, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES,
  SCRATCH_PTR_A, SCRATCH_PTR_B, SEQUENCE_DELAY, INITIALS_LOCKED_LETTER_COLOUR, INITIALS_BACK_PRESS_HISTORY,
  INITIALS_FORWARD_PRESS_HISTORY, INITIALS_COMMIT_PRESS_HISTORY, INITIALS_ALT_COMMIT_PRESS_HISTORY,
  INITIALS_LETTER_INDEX, INITIALS_SLOTS_LEFT, INITIALS_CURSOR_FLASH_TIMER, INITIALS_LETTER_GLYPH_TABLE,
} from "./names.js";

// Bits of the control word readPlayerControls (0x1ED1) [seen] returns for the panel facing the
// picture: bit 0 back (LEFT, per INITIALS_BACK_PRESS_HISTORY), bit 1 forward, and two commit
// controls on bits 4 and 5, either of which locks a letter.
const BACK_BIT = 0x01;
const FORWARD_BIT = 0x02;
const COMMIT_BIT = 0x10;
const OTHER_COMMIT_BIT = 0x20;
// Saturation values the ROM tests for the auto-repeat (`cp 0xff` at 0x18F1 on the forward history,
// `cp 0x7f` at 0x18FD on the back history): the back control is emptied one sample sooner.
const FORWARD_SATURATED = 0xff;
const BACK_SATURATED = 0x7f;
const LAST_THREE_SAMPLES = 0x07;
const FRESH_PRESS = 0x01;

// The letter ring: INITIALS_LETTER_GLYPH_TABLE (0x12C7) [seen] holds A..Z and then one final mark,
// 27 entries. Stepping back from 0 wraps the index to 0xFF, caught by `cp 0x80` (0x190E) and
// replaced with the last entry (`ld (hl),0x1a`).
const LETTER_COUNT = 27;
const LAST_LETTER = LETTER_COUNT - 1;
const WRAPPED_BELOW = 0x80;

// Screen constants: the plane bit, the cursor's two flash colours (bit 4 of the flash timer picks
// 0x14 over 0x10, per INITIALS_CURSOR_FLASH_TIMER), and 0xF1, the blanking glyph.
const COLOUR_PLANE_BIT = 0x400;
const CURSOR_COLOUR = 0x10;
const CURSOR_FLASH_COLOUR = 0x14;
const FLASH_BIT = 0x10;
const BLANK = 0xf1;

// Frame gates on FRAME_TICK (0xA980) [seen], and the delay SEQUENCE_DELAY (0xA9EB) [seen] is reloaded
// with when the entry finishes (`ld (0xa9eb),a` at 0x1977), for the arm that follows.
const EVERY_OTHER_FRAME = 0x01;
const EVERY_EIGHTH_FRAME = 0x07;
const ENTRY_CLOCK_RELOAD = 60;

// IN0_MIRROR (0xA9AE) [seen] start buttons: bit 3 one-player, bit 4 two-player (`and 0x18 / cp 0x08`).
const START_BUTTONS = 0x18;
const ONE_PLAYER_START = 0x08;

const isFreshPress = (history) => (history & LAST_THREE_SAMPLES) === FRESH_PRESS;

// Shift one sample into a press history (the ROM's `rrca ... rl (hl)` per control, 0x18D1-0x18E1);
// the byte keeps only its low eight samples.
function rollHistory(mem8, cell, pressed) {
  mem8[cell] = (mem8[cell] << 1) | (pressed ? 1 : 0);
}

/** Look the shown letter's glyph up; the lookup leaves its entry pointer behind. */
// (INITIALS_LETTER_GLYPH_TABLE indexed by INITIALS_LETTER_INDEX, 0xA999 [seen].)
const letterGlyph = (m) => fetchTableByte(m, INITIALS_LETTER_GLYPH_TABLE, m.mem8[INITIALS_LETTER_INDEX]);

/** Stamp the shown letter at the cursor, colour its cell as the cursor, and stop the flash. */
// Zeroing INITIALS_CURSOR_FLASH_TIMER (0xA99C, `ld (0xa99c),a` at 0x1960) restarts the blink from its
// steady phase, so a freshly changed letter is shown in the plain cursor colour first.
function redrawCursorLetter(m) {
  const { mem8, mem16 } = m;
  const cursor = mem16[SCRATCH_PTR_B];
  mem8[cursor] = letterGlyph(m);
  mem8[cursor & ~COLOUR_PLANE_BIT] = CURSOR_COLOUR;
  mem8[INITIALS_CURSOR_FLASH_TIMER] = 0;
}

/** Lock the shown letter into both copies and step both on; true once no slot is left. */
// The glyph goes both into the filed record (SCRATCH_PTR_A) and onto the screen (SCRATCH_PTR_B); the
// screen cell takes INITIALS_LOCKED_LETTER_COLOUR (0xA990) [seen], the colour captured when the entry
// opened, in place of the cursor's flash. The record pointer steps one byte, the screen pointer one
// character cell (advanceCharCursor, 0x0020 [seen]); both are written back (`ld (0xa991),hl` 0x193D,
// `ld (0xa993),de` 0x1940). INITIALS_SLOTS_LEFT (0xA99A) [seen] counts the three initials down; while
// any remain the next slot starts again from letter 0.
function commitLetter(m) {
  const { mem8, mem16 } = m;
  const glyph = letterGlyph(m);
  const copy = mem16[SCRATCH_PTR_A];
  const cursor = mem16[SCRATCH_PTR_B];
  mem8[cursor] = glyph;
  mem8[copy] = glyph;
  mem8[cursor & ~COLOUR_PLANE_BIT] = mem8[INITIALS_LOCKED_LETTER_COLOUR];
  mem16[SCRATCH_PTR_A] = copy + 1;
  mem16[SCRATCH_PTR_B] = advanceCharCursor(m, cursor | COLOUR_PLANE_BIT);
  mem8[INITIALS_SLOTS_LEFT] = u8(mem8[INITIALS_SLOTS_LEFT] - 1);
  if (mem8[INITIALS_SLOTS_LEFT] === 0) return true;
  mem8[INITIALS_LETTER_INDEX] = 0;
  return false;
}

/** The even-frame scan; true when it finished the entry. */
function scanControls(m) {
  const { mem8 } = m;
  // Sample this frame's controls into all four histories.
  const controls = readPlayerControls(m);
  rollHistory(mem8, INITIALS_BACK_PRESS_HISTORY, controls & BACK_BIT);
  rollHistory(mem8, INITIALS_FORWARD_PRESS_HISTORY, controls & FORWARD_BIT);
  rollHistory(mem8, INITIALS_COMMIT_PRESS_HISTORY, controls & COMMIT_BIT);
  rollHistory(mem8, INITIALS_ALT_COMMIT_PRESS_HISTORY, controls & OTHER_COMMIT_BIT);

  // A commit takes priority over everything (the ROM tests 0xA998 then 0xA997 first, jumping to 0x1923):
  // lock the letter; the last slot finishes the entry, otherwise draw letter 0 in the next cell.
  if (isFreshPress(mem8[INITIALS_ALT_COMMIT_PRESS_HISTORY]) || isFreshPress(mem8[INITIALS_COMMIT_PRESS_HISTORY])) {
    if (commitLetter(m)) return true;
    redrawCursorLetter(m);
    return false;
  }

  // Forward (0xA996): a saturated history is emptied, which also means it cannot read as a fresh press
  // this frame, and the back control is looked at next. A fresh press steps the letter on, 26 wrapping
  // to 0 (`cp 0x1b`), redraws the cursor, and ends the scan.
  if (mem8[INITIALS_FORWARD_PRESS_HISTORY] === FORWARD_SATURATED) {
    rearmHeldControlRepeat(m, INITIALS_FORWARD_PRESS_HISTORY);
  } else if (isFreshPress(mem8[INITIALS_FORWARD_PRESS_HISTORY])) {
    const next = u8(mem8[INITIALS_LETTER_INDEX] + 1);
    mem8[INITIALS_LETTER_INDEX] = next > LAST_LETTER ? 0 : next;
    redrawCursorLetter(m);
    return false;
  }

  // Back (0xA995): the same shape, stepping the letter the other way, 0 wrapping to 26.
  if (mem8[INITIALS_BACK_PRESS_HISTORY] === BACK_SATURATED) {
    rearmHeldControlRepeat(m, INITIALS_BACK_PRESS_HISTORY);
  } else if (isFreshPress(mem8[INITIALS_BACK_PRESS_HISTORY])) {
    const next = u8(mem8[INITIALS_LETTER_INDEX] - 1);
    mem8[INITIALS_LETTER_INDEX] = next < WRAPPED_BELOW ? next : LAST_LETTER;
    redrawCursorLetter(m);
  }
  return false;
}

/** Tick the entry clock on every eighth frame; true when it ran out, blanking the cursor cell. */
// SEQUENCE_DELAY is the sequence machine's shared one-shot delay, used here as the entry's time limit
// (`and 0x07` at 0x1966). When it runs out the cell still waiting for an initial is blanked with 0xF1,
// so a timed-out entry shows no half-chosen letter.
function entryClockRanOut(m) {
  const { mem8, mem16 } = m;
  if ((mem8[FRAME_TICK] & EVERY_EIGHTH_FRAME) !== 0) return false;
  mem8[SEQUENCE_DELAY] = u8(mem8[SEQUENCE_DELAY] - 1);
  if (mem8[SEQUENCE_DELAY] !== 0) return false;
  mem8[mem16[SCRATCH_PTR_B]] = BLANK;
  return true;
}

// Finish: reload SEQUENCE_DELAY for the next arm, queue the seven transition sound codes
// (enqueueTransitionSoundBurst, 0x5634 [seen]), and step the sequence sub-step (`jp 0x0f1a`).
function finishEntry(m) {
  m.mem8[SEQUENCE_DELAY] = ENTRY_CLOCK_RELOAD;
  enqueueTransitionSoundBurst(m);
  advanceSequenceSubStep(m);
}

// Odd frames: advance the blink counter and colour the cursor cell by its bit 4 (`bit 4,a` at 0x1990),
// so the cursor alternates between the two colours every sixteen counts.
function flashCursor(m) {
  const { mem8, mem16 } = m;
  const phase = u8(mem8[INITIALS_CURSOR_FLASH_TIMER] + 1);
  mem8[INITIALS_CURSOR_FLASH_TIMER] = phase;
  mem8[mem16[SCRATCH_PTR_B] & ~COLOUR_PLANE_BIT] = phase & FLASH_BIT ? CURSOR_FLASH_COLOUR : CURSOR_COLOUR;
}

/** With both players out of lives, a held start button begins the next game when it may. */
// This is the tail every frame of the entry falls into unless that frame finished it (0x199A on): once no player has a life left, a
// new game can be started without waiting for the entry to end. Both lives cells (PLAYER_ONE_LIVES 0xAD10, PLAYER_TWO_LIVES 0xAD20)
// [seen] must be zero. Every start first hides all sprites (hideAllSprites, 0x15B6 [seen]).
//   - free play (FREE_PLAY, 0xA9C0 [seen]): either start button begins a game charging no credit
//     (startGameOnFreePlay, 0x1690, which itself picks one or two players from the buttons);
//   - no credit: nothing;
//   - one credit (CREDIT_COUNT, 0xA986): only the 1-player start alone is accepted;
//   - two or more: the 1-player start alone starts one player (0x3215), any other held start two
//     players (startTwoPlayerGame, 0x189E), each taking its credits off the count.
function startNextGameIfAsked(m) {
  const { mem8 } = m;
  if ((mem8[PLAYER_ONE_LIVES] | mem8[PLAYER_TWO_LIVES]) !== 0) return;
  const start = mem8[IN0_MIRROR] & START_BUTTONS;

  if (mem8[FREE_PLAY] !== 0) {
    if (start === 0) return;
    hideAllSprites(m);
    startGameOnFreePlay(m);
    return;
  }

  const credits = mem8[CREDIT_COUNT];
  if (credits === 0) return;
  if (credits === 1 ? start !== ONE_PLAYER_START : start === 0) return;
  hideAllSprites(m);
  if (start === ONE_PLAYER_START) startOnePlayerGame(m);
  else startTwoPlayerGame(m);
}

export function stepHighScoreInitialsEntry(m) {
  const { mem8 } = m;
  // Frame parity (`ld a,(0xa980) / and 0x01` at 0x18C3): odd frames only flash the cursor; even frames
  // scan the controls and, unless that finished the entry, tick the entry clock. A finish ends the
  // frame there; otherwise every frame goes on to the start-next-game poll.
  if ((mem8[FRAME_TICK] & EVERY_OTHER_FRAME) !== 0) {
    flashCursor(m);
  } else if (scanControls(m) || entryClockRanOut(m)) {
    finishEntry(m);
    return;
  }
  startNextGameIfAsked(m);
}
