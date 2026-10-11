// SPDX-License-Identifier: GPL-3.0-only
/** runCommandRingDrainLoop — the foreground loop: take commands off the 64-cell ring, one at a time, for ever.
 *  A read cursor names a cell; high bit set means empty, so the loop looks again — it has no exit
 *  of its own. An occupied cell gives up a command and an argument byte, BOTH freed before the
 *  command runs so it may reuse the pair. The low nibble picks one of sixteen handlers out of a
 *  table fixed in the program image; each case below is the handler its slot names, handed the
 *  argument byte, and when it finishes the loop looks again. A GENERATOR, yielding where the ring
 *  is empty — the only vblank wait among the foreground loops a coin-and-play tape reaches. A
 *  handler that restarts the machine hands back the new foreground, and the loop gives way to it
 *  for good. LIVE-OUT: memory, and whatever the command left behind.
 *
 *  ROM 0x0B93-0x0BBB; handler table at 0x0BBC (COMMAND_HANDLER_TABLE). [seen]
 *
 *  Role in the machine: Time Pilot splits its work between two contexts. The frame interrupt decides
 *  what happens (the sequence machine, the round engine) but does not draw text itself: it posts a
 *  two-byte request -- command and argument -- into COMMAND_RING at 0xAC00 through postCommand
 *  (RST 0x38), which advances COMMAND_WRITE_CURSOR. This loop is the consumer: in the time left over
 *  between frame interrupts it takes the requests in order and runs the drawing / scoring handler
 *  each names (mechanisms.md, "The command ring"). The machine stays in this loop from the moment
 *  enableInterruptAndEnterForegroundLoop enters it.
 */

import { u16, u8 } from "../../../core/int.js";
import { replayCloudBands } from "./replayCloudBands.js";
import { drawCaptionGlyphsKeepingColour } from "./drawCaptionGlyphsKeepingColour.js";
import { drawTextRunByIndex } from "./drawTextRunByIndex.js";
import { drawCaptionInPenColour } from "./drawCaptionInPenColour.js";
import { eraseTextRunByIndex } from "./eraseTextRunByIndex.js";
import { awardScoreToPlayer } from "./awardScoreToPlayer.js";
import { drawEmblemStripThenGuardImage } from "./drawEmblemStripThenGuardImage.js";
import { drawCountAsPictogramStrip } from "./drawCountAsPictogramStrip.js";
import { drawRoundNumberCaption } from "./drawRoundNumberCaption.js";
import { drawCaptionFivePastSharedColour } from "./drawCaptionFivePastSharedColour.js";
import { drawCaptionTenPastSharedColour } from "./drawCaptionTenPastSharedColour.js";
import { loc_0bdc } from "./loc_0bdc.js";
import { COMMAND_READ_CURSOR, COMMAND_RING } from "./names.js";

// The ring is 0x40 cells at 0xAC00 (the ROM wraps the cursor with `and 0x3f`).
const RING_CELLS = 64;
// The marker a consumed cell is restored to (`ld (hl),0xff`); its high bit set means "empty".
const FREE = 255;
// The bit the ROM tests with `rlca` (bit 7 into carry) to tell empty from occupied.
const EMPTY_BIT = 0x80;
// Only the command byte's low nibble picks the handler (`and 0x0f`).
const HANDLER_BITS = 0x0f;

/** Run the handler the command's low nibble selects, handing it the argument byte. */
function runCommand(m, slot, argument) {
  // Each case is the target the corresponding word of the table at 0x0BBC holds; the ROM loads the
  // argument into A (`ld a,b`) before jumping there, which is the `argument` passed here.
  switch (slot) {
    case 0: return drawCaptionGlyphsKeepingColour(m, argument); // a caption's glyphs, colour left standing
    case 1: return drawTextRunByIndex(m, argument); // a caption in its own colour
    case 2: return drawCaptionInPenColour(m, argument); // a caption in the shared pen colour
    case 3: return eraseTextRunByIndex(m, argument); // erase a caption
    case 4: return awardScoreToPlayer(m, argument); // add a score award to the current player
    case 5: return drawEmblemStripThenGuardImage(m, argument); // reserve-ship emblems
    case 6: return drawCountAsPictogramStrip(m, argument); // stage pictograms
    case 7: return drawRoundNumberCaption(m); // "STAGE nn"
    case 10: return drawCaptionFivePastSharedColour(m, argument); // caption, pen colour + 5
    case 11: return drawCaptionTenPastSharedColour(m, argument); // caption, pen colour + 10
    // Slots 8, 9 and 12-15 all name the lone RET at 0x0BDC: the pair is consumed and nothing happens.
    // No poster puts these commands (or command 0) on the ring; the cases are the table, not traffic.
    case 8: case 9: case 12: case 13: case 14: case 15: return loc_0bdc();
  }
}

// A handler that restarts the machine returns a new foreground loop (a generator) instead of undefined.
const isCoroutine = (r) => r !== null && typeof r === "object" && typeof r.next === "function";

export function* runCommandRingDrainLoop(m) {
  const { mem8 } = m;
  for (;;) {
    // Look at the cell the read cursor names: the ROM builds HL = 0xAC00 + cursor (`ld h,0xac` /
    // `ld l,a`), so the cursor is a plain byte offset into the ring.
    const commandCell = u16(COMMAND_RING + mem8[COMMAND_READ_CURSOR]);
    if (mem8[commandCell] & EMPTY_BIT) { // high bit SET means EMPTY
      // Nothing to do. The ROM jumps back through 0x0B90 and looks again; here the loop hands the
      // rest of the frame back to the machine (yield) and looks again next time round.
      replayCloudBands(m); // beam-sync render: repaint the frame's multiplexed clouds in bands
      yield;
      continue;
    }

    // Take the pair and free BOTH cells before the handler runs, so a handler that posts a new
    // command can land it in the very slot it arrived in.
    const command = mem8[commandCell];
    mem8[commandCell] = FREE;
    const argumentCell = u16(commandCell + 1);
    const argument = mem8[argumentCell];
    mem8[argumentCell] = FREE;
    // Step the cursor past the pair, wrapped inside the 64-cell ring.
    mem8[COMMAND_READ_CURSOR] = u8(argumentCell + 1) & (RING_CELLS - 1);

    // Run the handler. In the ROM it is handed 0x0B90 as its return address, so a normal finish
    // comes straight back to the top of this loop.
    const after = runCommand(m, command & HANDLER_BITS, argument);
    // A handler that instead hands back a new foreground has left this loop's world: give way to
    // it for good.
    if (isCoroutine(after)) return yield* after;
  }
}
