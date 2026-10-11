// SPDX-License-Identifier: GPL-3.0-only
/**
 * finishBootSelfTestAndColdStart — the tail of the power-on switch decode and self-test: store the
 * last two gameplay settings, set the screen-flip line, paint the power-on lattice, check a block of
 * the program image, and go on to the startup delay.
 *
 * ROM 0x49A8-0x49D5 (ends `jp 0x32EB`). Grounding: [seen] (names.js ROUTINES 0x49A8).
 *
 * ROLE IN THE MACHINE. One link of the power-on chain (each routine jumps into the next; none
 * returns). unpackTheFirstThreeSwitchSettings [seen] jumps here with the complemented gameplay
 * switch byte (DSW1) rotated so that its original bit 3 sits lowest; this routine takes the remaining
 * bits:
 *   bits 4-6 -> DIFFICULTY_SETTING (0xA9C4) [seen]   0..7, 0 the easiest
 *   bit 7    -> DEMO_SOUNDS_ENABLE (0xA9C6) [seen]   whether the attract mode may queue sounds
 * It then hands on to petWatchdogThroughStartupDelayThenStartMachine [seen], which holds the lattice
 * on screen for the startup delay and starts the machine.
 *
 * THE SELF-TEST. Time Pilot scatters program-image checks through the whole game. This one sums
 * the 256 bytes at BOOT_SELFTEST_CHECKSUM_BASE (ROM 0x27DE); a genuine image totals 0xC5. It does not
 * refuse to boot: a mismatch runs one frame service out of band and then the machine cold-starts
 * anyway. On a genuine image that arm is never taken.
 *
 * LIVE-OUT: the two settings cells, the watchdog write, FLIPSCREEN_LATCH, the painted character
 * plane, and everything the chain after it does — control never comes back.
 */

import { u16 } from "../../../core/int.js";
import { tileCharPlaneWithBoxLattice } from "./tileCharPlaneWithBoxLattice.js";
import { enterVerticalBlankService } from "./enterVerticalBlankService.js";
import { petWatchdogThroughStartupDelayThenStartMachine } from "./petWatchdogThroughStartupDelayThenStartMachine.js";
import { DEMO_SOUNDS_ENABLE, DIFFICULTY_SETTING, WATCHDOG_RESET, FLIPSCREEN_LATCH, FLIPSCREEN_INIT_BYTE, BOOT_SELFTEST_CHECKSUM_BASE } from "./names.js";

// The self-test block is 256 bytes (`ld b,0x00` — djnz counts 256) and must sum to 0xC5 (`sub 0xc5`).
const CHECKSUM_SPAN = 0x100;
const CHECKSUM_TOTAL = 0xc5;

export function finishBootSelfTestAndColdStart(m, switches = m.regs.a) {
  const { mem8 } = m;

  // Difficulty (0x49A8-0x49AF): one more rotate right brings original bit 4 lowest; the low three
  // bits are the switch bank's bits 4-6.
  const rolled = ((switches >> 1) | (switches << 7)) & 0xff; // RRCA
  mem8[DIFFICULTY_SETTING] = rolled & 0x07;

  // Demo sounds (0x49B0-0x49B8): three more rotates bring original bit 7 lowest. The same byte is
  // then written to the watchdog (0x49B8) — a kick to keep the board from resetting during boot; the
  // watchdog ignores the value.
  const demoSounds = ((rolled >> 3) | (rolled << 5)) & 0x01; // RRCA x3, low bit
  mem8[DEMO_SOUNDS_ENABLE] = demoSounds;
  mem8[WATCHDOG_RESET] = demoSounds;

  // Screen flip (0x49BB-0x49C1): drive FLIPSCREEN_LATCH (0xC302, an LS259 output line; data bit 0 is
  // the level) from the fixed program byte FLIPSCREEN_INIT_BYTE (ROM 0x0C3E, holds 1).
  mem8[FLIPSCREEN_LATCH] = mem8[FLIPSCREEN_INIT_BYTE];

  // The power-on picture (`call 0x00B1`): tileCharPlaneWithBoxLattice [seen] fills the character
  // plane with a lattice of boxes, which stays up through the startup delay that follows.
  tileCharPlaneWithBoxLattice(m);

  // Self-test sum (0x49C4-0x49CE): an 8-bit running total (carries discarded) of the 256 program
  // bytes from ROM 0x27DE.
  let total = 0;
  for (let i = 0; i < CHECKSUM_SPAN; i++) {
    total = (total + mem8[u16(BOOT_SELFTEST_CHECKSUM_BASE + i)]) & 0xff;
  }
  // Zero on a genuine image (0x49CE `sub 0xc5`).
  const status = (total - CHECKSUM_TOTAL) & 0xff;
  // A tampered image runs the frame handler out of band first and then cold-starts anyway; either
  // way the status goes on as the startup delay's watchdog value.
  // (ROM 0x49D0 `call nz,0x00D8` into enterVerticalBlankService [seen], then 0x49D3
  // `jp 0x32EB` — a jump, so nothing returns here.)
  if (status !== 0) enterVerticalBlankService(m);
  return petWatchdogThroughStartupDelayThenStartMachine(m, status);
}
