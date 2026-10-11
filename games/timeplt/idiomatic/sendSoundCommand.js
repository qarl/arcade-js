// SPDX-License-Identifier: GPL-3.0-only
/**
 * sendSoundCommand — hand one byte to the audio processor and knock on its door.
 *
 * WHAT IT IS: ROM routine 0x55F8 [seen]. Time Pilot has a second Z80 that runs the sound. The main CPU
 * talks to it through a one-byte latch (SOUND_COMMAND_LATCH) that the audio processor reads, and an
 * attention line (AUDIO_IRQ_LATCH, bit 2 of the board's LS259 output latch) that interrupts it. This
 * routine writes the byte into the latch, then drives the line high and back low: that edge is what
 * makes the audio processor look. It does not decide what any particular byte MEANS.
 *
 * ROLE IN THE MACHINE: it is the one sender. Every write to the sound latch, across boot, attract, the
 * demo and driven play, comes from this routine's store. Game code does not call it directly: requests
 * go into a queue, and at the end of every vertical-blank service,
 * sendOldestQueuedSoundCommand takes the oldest byte off the queue and sends it through here -- so a
 * burst of N requests is heard over N services. Power-on is the one sender that goes around the queue: it
 * sends 0 directly.
 *
 * ★ The latch address is split BY DIRECTION: written, it is the sound latch; read, it is the scanline
 * counter. Sites elsewhere that load from it are not reading what this routine wrote.
 *
 * PARAMETERS: `command` is the byte to send (the ROM passes it in A).
 * LIVE-OUT: both latches, plus the zero left in the accumulator.
 */

import { SOUND_COMMAND_LATCH, AUDIO_IRQ_LATCH } from "./names.js";

export function sendSoundCommand(m, command = m.regs.a) {
  const { mem8 } = m;
  // Step 1: put the command byte in the latch, where it waits for the audio processor to read it.
  mem8[SOUND_COMMAND_LATCH] = command;
  // Step 2: pulse the attention line high then low. The ROM holds it high across six `nop`s between
  // the two stores; nothing else happens in that stretch, so it contributes pulse WIDTH alone and the
  // two stores here are back to back.
  mem8[AUDIO_IRQ_LATCH] = 1;
  mem8[AUDIO_IRQ_LATCH] = 0;
  // The ROM's last store is made from A = 0, which is left behind for the caller.
  return (m.regs.a = 0);
}
