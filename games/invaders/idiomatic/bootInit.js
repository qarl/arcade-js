// SPDX-License-Identifier: GPL-3.0-only
import { initWorkRam } from "./initWorkRam.js";
import { redrawScorePanel } from "./redrawScorePanel.js";
import { enterAttractCycle } from "./enterAttractCycle.js";

/**
 * bootInit — the cold-start entry that brings the machine up into its attract loop.
 *
 * WHAT IT IS
 *   The first game code that runs after the reset vector (resetEntry / ROM 0x0000 jumps here). It paints
 *   the game's own work RAM into existence from a baked ROM image, draws the initial score panel, and
 *   then returns the attract-cycle generator the clock-free engine will drive frame by frame. The two
 *   setup steps run synchronously; the third hands back a generator (bootInit itself is NOT a generator).
 *
 * ROLE IN THE MACHINE
 *   initWorkRam (ROM 0x01e6) blockCopies bytes from the ROM template WORKRAM_INIT_IMAGE (0x1b00) into the
 *   base of work RAM, stamping the object/sprite work area into place (see mechanisms.md, "Frame tasks,
 *   timers, boot, and scoring"). redrawScorePanel (0x1956) then clears the screen and lays down the fixed
 *   heads-up furniture (score header, both player scores, high score, CREDIT label, credit tally).
 *   enterAttractCycle (0x18df) is the join of the attract loop; the generator it returns is what the
 *   engine steps to run the demo. On the real 8080 this routine also seats the stack pointer at the top
 *   of work RAM; the idiomatic layer dispatches with ordinary JS calls, so the emulated SP is left
 *   unseated here and the harness seats it for the interrupt push.
 *
 * ROM 0x18d4-0x18de.  Grounding: [seen] (names.js cert).
 *
 * LIVE-OUT: the attract-cycle generator, for the engine to drive.
 */
export function bootInit(m) {
  // Seed work RAM from the baked ROM image so every object/sprite/timer cell has its cold-start value. The ROM
  // seats B=0 first (mvi b,0), and a count of 0 is a full 256-byte pass, so the boot never depends on entry B.
  initWorkRam(m, 0);

  // Paint the static score panel once, so the attract screen has its heads-up furniture from frame one.
  redrawScorePanel(m);

  // Hand the engine the attract-loop generator; from here the machine runs the demo until a coin starts play.
  return enterAttractCycle(m);
}
