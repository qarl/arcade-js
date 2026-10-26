// SPDX-License-Identifier: GPL-3.0-only

/**
 * spinToSelfHalt -- a self-jump halt trap: it hangs the processor forever, writing nothing.
 *
 * ROLE: the target of the 6502 NMI vector (0x3ffa holds 0x3ff6). In the ROM it is a one-instruction
 * "JMP to itself" — the program counter lands on the jump and re-executes it endlessly, so the CPU makes
 * no further progress. No instruction in the program jumps here, and the board wires only the IRQ line
 * (MAME's centiped.cpp drives input line 0 alone), so it never runs; it would park the CPU if an NMI ever
 * arrived. The boot's own beep-and-halt reporter ends the same way (see coldBootReset's
 * selfTestBeepAndHalt).
 *
 * ROM/HARDWARE: it touches no memory and no I/O, and it does NOT kick the watchdog (0x2000), so on the
 * board a CPU parked here would be reset by the watchdog.
 *
 * GROUNDING: [code] (behaviour-derived; it produces no observable state change to confirm against MAME).
 * LIVE-OUT: none — control never leaves this routine.
 */
export function spinToSelfHalt(m) {
  // The endless loop is the halt itself: the guest's self-jump becomes a JS infinite for(;;). Nothing in
  // the body ever changes, so the only way out is a reset from outside (on the board, the watchdog).
  for (;;) { /* halt: the machine hangs here until it is reset */ }
}
