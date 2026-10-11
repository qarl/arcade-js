// SPDX-License-Identifier: GPL-3.0-only
/** loc_15b5 — an arm that does nothing whatever: it reads no cell, writes no cell and leaves every register as it found it, so reaching it costs the turn and changes nothing. LIVE-OUT: nothing.
 *
 * ROM 0x15B5 (frozen lift translated/loc_15b5.js): a lone `ret`. Grounding: [code] (names.js ROUTINES 0x15b5).
 *
 * Role in the machine: the sequence machine's phase 3 (the round engine and its lead-ins) picks one
 * arm per pass of the frame service from a sixteen-word table at 0x0F29, indexed by the low nibble of SEQUENCE_SUBSTEP;
 * dispatchSequenceSubStepArm is that dispatch. This address fills slot 15 of the table. Every arm of
 * that table returns into advanceAttractTowardGameStart (0x0F54), the continuation run after every arm,
 * and this one does so at once.
 *
 * Why it is kept hex and why nothing is here: nibble 15 exists only transiently -- arm 14 steps the
 * sub-step to 15 and overwrites it with 3 in the same interrupt, with interrupts disabled -- so no
 * dispatch ever reads it and the slot is unreachable filler. The address occurs once in the image as a
 * little-endian word: that table slot (names.js role).
 */

export function loc_15b5() {
  // The ROM's `ret`: return to the dispatcher, which then runs the shared continuation.
  return;
}
