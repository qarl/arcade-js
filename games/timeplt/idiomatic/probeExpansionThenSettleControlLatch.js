// SPDX-License-Identifier: GPL-3.0-only
/** probeExpansionThenSettleControlLatch — power-on, the first code that decides anything. It probes the
 * expansion socket: an empty socket floats the bus high, never a fitted board's answer, so the question
 * always returns "no" and the rest runs; a "yes" would hand control to the expansion. Then it quiets the
 * watchdog, drives the control lines low, and enables the picture. The original also seats the stack just
 * under sprite memory here; this layer lays no return words (every routine is a direct call and the frame
 * interrupt fires as one), so nothing reads the stack pointer and the seat is not carried. The latch takes data from the low bit and its line from the address,
 * TWO ADDRESSES TO A LINE, so the eight-address walk settles FOUR lines (each written twice) and the ninth
 * address is a fifth line, not a ninth; that last setting is read from the program image, not a literal, so
 * patching it can leave the machine dark. No work memory is touched. LIVE-OUT: latched lines.
 *
 * ROM 0x07B1-0x07D1, reached from the reset jump at 0x0000. [seen]
 *
 * Role in the machine: the first stage of the cold start. It leaves the board in a known state -- the
 * frame interrupt shut (latch line 0 low), the picture on -- before 0x0069 clears memory. Latch lines
 * 5, 6 and 7 are never written here (names.js), so "settle the latch" means five of its eight lines.
 */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { clearWorkRamAndSpriteBanksThenColdInit } from "./clearWorkRamAndSpriteBanksThenColdInit.js";
import { EXPANSION_SOCKET_PROBE, WATCHDOG_RESET, NMI_ENABLE_LATCH, VIDEO_ENABLE_LATCH, DISPLAY_ON_VALUE } from "./names.js";

// The byte a fitted expansion board would present at 0x6000 (the ROM's `cp 0x55`).
const EXPANSION_FITTED = 0x55;

// The walk over 0xC300-0xC307 (the ROM's `ld b,0x08`); two addresses per latch line, so four lines.
const CONTROL_LINE_ADDRESSES = 8;

export function probeExpansionThenSettleControlLatch(m) {
  const { mem8 } = m;

  // Probe the expansion socket. 0x6000 is one past the end of the program ROM (0x0000-0x5FFF); on a
  // board with nothing fitted there the read floats to 0xFF. The ROM's `jp z,0x6000` would hand the
  // whole machine to an expansion that answered 0x55. Nothing models that, so it raises instead.
  const socketAnswer = mem8[EXPANSION_SOCKET_PROBE];
  if (socketAnswer === EXPANSION_FITTED) {
    throw new NotImplemented(
      "probeExpansionThenSettleControlLatch: the expansion socket answered, so control belongs in an " +
        "expansion nothing models; a board with the socket empty never answers",
    );
  }

  // (Here the ROM runs `ld sp,0xb000`; see the header for why it is not carried.)
  // Kick the watchdog: any write to 0xC200 resets it, whatever the value.
  mem8[WATCHDOG_RESET] = socketAnswer;
  // Drive latch lines 0-3 low by writing 0 to 0xC300-0xC307. Line 0 is the frame-interrupt enable
  // (so no frame interrupt can arrive during the cold start) and line 1 is the flip-screen line.
  for (let i = 0; i < CONTROL_LINE_ADDRESSES; i++) mem8[NMI_ENABLE_LATCH + i] = 0;
  // Latch line 4 (0xC308) is the picture enable. The value comes from the program byte at 0x2D4B
  // (0x01), not an immediate, so a patched image can leave the screen dark.
  mem8[VIDEO_ENABLE_LATCH] = mem8[DISPLAY_ON_VALUE];

  // Next stage (`jp 0x0069`): clear the sprite banks and work RAM.
  return clearWorkRamAndSpriteBanksThenColdInit(m);
}
