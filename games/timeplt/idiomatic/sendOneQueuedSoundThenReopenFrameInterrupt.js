// SPDX-License-Identifier: GPL-3.0-only
/** sendOneQueuedSoundThenReopenFrameInterrupt — close the vertical-blank service. One waiting sound
 * byte goes out, so a byte queued anywhere in the service leaves on the same frame; then the interrupt
 * gate is reopened for the next frame. The gate is reopened from a byte of the program image (it reads
 * 0x01) rather than a literal, and it is reopened here, at the very end, so a second vertical blank can
 * never land while this frame's work is half done. In the original this is also where both register banks
 * come back off the stack and control returns to the interrupted code; those registers carry no game
 * state across the interrupt, so the unwind is not represented. LIVE-OUT: the sound queue and what the
 * send leaves latched, and the interrupt gate.
 *
 * ROM 0x0174-0x018B, reached as the resume address the frame service pushes at 0x0155 (`ld hl,0x0174 /
 * push hl`). Grounding: [seen] (names.js ROUTINES 0x0174). */

import { sendOldestQueuedSoundCommand } from "./sendOldestQueuedSoundCommand.js";
import { NMI_ENABLE_LATCH, NMI_REENABLE_BYTE } from "./names.js";

export function sendOneQueuedSoundThenReopenFrameInterrupt(m) {
  sendOldestQueuedSoundCommand(m);
  m.mem8[NMI_ENABLE_LATCH] = m.mem8[NMI_REENABLE_BYTE]; // reopen the gate: LS259 bit 0 <- the image's 0x01
}
