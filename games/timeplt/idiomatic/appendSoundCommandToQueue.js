// SPDX-License-Identifier: GPL-3.0-only
/**
 * appendSoundCommandToQueue — append one sound code to the tail of the pending-sound queue.
 *
 * ROM 0x562A-0x5633 (loc_562a), the enqueue body. Grounding: this body has no ROUTINES entry
 * of its own in names.js; its behaviour is the one grounded [seen] through enqueueSoundUnconditional
 * (0x5628), whose MAME taps saw every fetch there followed by exactly one count bump (pc 0x562D)
 * and exactly one store (pc 0x5631) of the code held at entry.
 *
 * What it is: the main processor never waits on the audio processor. A sound request is
 * appended to a queue in work RAM, and at the very end of every vertical-blank
 * service, sendOldestQueuedSoundCommand sends ONE byte from the head of it to the audio
 * processor. So a burst of N requests is heard over N services.
 *
 * Queue layout: SOUND_QUEUE_COUNT (0xAC43) [seen] holds how many codes are waiting, and the codes
 * follow it from 0xAC44 (SOUND_QUEUE_HEAD). The count therefore doubles as the offset of the last
 * code from the count cell: step it on, and the cell it now names is the new tail, so codes line
 * up in arrival order and the drain takes the oldest from the head.
 *
 * Role in the machine: producers reach it through one of three gates — enqueueSoundUnconditional,
 * enqueueSoundIfGameInProgress and enqueueSoundIfGameOrDemoSoundsOn. Nothing here tests for room, and
 * the count wraps at a byte.
 *
 * Parameter: `command` — the sound code to queue (A in the ROM, pushed by the gate's prologue).
 *
 * LIVE-OUT: memory — the count cell and the new tail cell.
 */

import { u8, u16 } from "../../../core/int.js";
import { SOUND_QUEUE_COUNT } from "./names.js";


export function appendSoundCommandToQueue(m, command) {
  const { mem8 } = m;
  // Step the count on: `ld hl,0xac43 / inc (hl)`, a byte-wide increment that wraps 255 to 0.
  const length = u8(mem8[SOUND_QUEUE_COUNT] + 1);
  mem8[SOUND_QUEUE_COUNT] = length;
  // Store the code at count-cell + new count: `ld a,(hl) / rst 0x08` forms that address, and
  // `pop af / ld (hl),a` writes the code the gate saved there.
  mem8[u16(SOUND_QUEUE_COUNT + length)] = command;
}
