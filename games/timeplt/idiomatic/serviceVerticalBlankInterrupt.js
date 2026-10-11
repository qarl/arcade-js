// SPDX-License-Identifier: GPL-3.0-only
/** serviceVerticalBlankInterrupt — the vertical-blank service, the game's per-frame heartbeat. Refresh
 * the sprite banks and the deferred-cell lists, disarm the interrupt line and kick the watchdog, settle
 * the flip-screen line, latch the five inverted input/dip ports, step the frame and packed-decimal
 * counters, wind three timers down toward zero, service the coin inputs, then run one arm of the
 * sequence machine — the one the low two bits of the sequence phase select — and close the frame.
 * In the original the service stacks both register banks on entry and unstacks them on exit so the
 * interrupted code resumes undisturbed; that bracket holds no game state, so it is not represented.
 * LIVE-OUT: memory, the control latches, and what the sound send leaves latched.
 *
 * ROM 0x00D9-0x015E (serviceVerticalBlankInterrupt_ADDR), entered from the interrupt vector 0x0066
 * via the one-byte `push af` at 0x00D8; the arm table follows at 0x015F and the epilogue at 0x0174.
 * Grounding: [seen] (names.js ROUTINES 0x00D9), as are the routines around it (enterVblankInterrupt,
 * enterVerticalBlankService, and each callee here).
 *
 * Role in the machine: everything the game does happens once per frame, from here. The board raises
 * its non-maskable interrupt at vertical blank, between one picture and the next, and this
 * service does the frame's work in a fixed order
 * (mechanisms.md, "The vertical-blank service"). The foreground loop (runCommandRingDrainLoop) only
 * carries out the drawing and scoring requests this frame work posts.
 */

import { u8 } from "../../../core/int.js";
import { publishSpriteShadow } from "./publishSpriteShadow.js";
import { drainBothDeferredCellLists } from "./drainBothDeferredCellLists.js";
import { serviceCoinInputs } from "./serviceCoinInputs.js";
import { dispatchSequencePhase0SubStepArm } from "./dispatchSequencePhase0SubStepArm.js";
import { dispatchSequencePhase1SubStepArm } from "./dispatchSequencePhase1SubStepArm.js";
import { dispatchSequencePhase2SubStepArm } from "./dispatchSequencePhase2SubStepArm.js";
import { dispatchSequenceSubStepArm } from "./dispatchSequenceSubStepArm.js";
import { sendOneQueuedSoundThenReopenFrameInterrupt } from "./sendOneQueuedSoundThenReopenFrameInterrupt.js";
import { ACTIVE_PLAYER, ATTACKER_SPAWN_COOLDOWN, BANK_LAUNCH_COOLDOWN, BCD_FRAME_COUNTER, UPRIGHT_CABINET, COINAGE_SETTINGS, DIP1_MIRROR, FRAME_TICK, IN0_MIRROR, IN1_MIRROR, IN2_MIRROR, SCREEN_UNFLIPPED, SEQUENCE_PHASE, WAVE_CLAIM_TIMER, WATCHDOG_RESET, DSW1_PORT, NMI_ENABLE_LATCH, IN0_PORT, FLIPSCREEN_LATCH, IN1_PORT, IN2_PORT, DSW0_PORT } from "./names.js";

// The three countdowns, in the ROM's order (0xA817, 0xA812, 0xA8F4): each is taken one step toward
// zero per frame and stops there.
const TIMERS = [BANK_LAUNCH_COOLDOWN, WAVE_CLAIM_TIMER, ATTACKER_SPAWN_COOLDOWN];
// The outer phase has four values, so two bits index the four-word arm table (`and 0x03`).
const PHASE_MASK = 0x03;

/** One step of a two-digit packed-decimal counter: 09 -> 10, 99 -> 00. The original does `inc a` then `daa`
 *  with the carry flag clear (the `and a` a few instructions earlier clears it and nothing between
 *  sets it), so a digit that reaches ten carries into the next and the pair wraps at one hundred. The
 *  arithmetic is the CPU's exactly, including for a byte that is not valid decimal, where the
 *  correction follows the same rule the adjust instruction applies. */
export function nextPackedDecimalCount(count) {
  const bumped = u8(count + 1);
  const low = bumped & 0x0f;
  const lowCarried = low === 0; // the increment carried out of the low digit
  // Low-digit correction: add 6 when the low digit overflowed past 9 (or carried out entirely).
  const lowFix = lowCarried || low > 9 ? 0x06 : 0;
  // High-digit correction: add 0x60 when the byte as a whole passed 99, wrapping the pair to 00.
  const highFix = bumped > 0x99 ? 0x60 : 0;
  return u8(bumped + lowFix + highFix);
}

export function serviceVerticalBlankInterrupt(m) {
  const { mem8 } = m;

  // 1. Publish the display, first thing in the frame: copy the sprite shadow
  //    in work RAM into the two hardware sprite banks (0x0365), then blank the character cells
  //    painted last pass and paint the ones now pending (0x5286).
  publishSpriteShadow(m);
  drainBothDeferredCellLists(m);

  // 2. Close the interrupt gate (latch line 0 at 0xC300 -> 0) so a second vertical blank cannot
  //    land in the middle of this frame's work, and kick the watchdog (any write to 0xC200).
  //    The epilogue reopens the gate.
  mem8[NMI_ENABLE_LATCH] = 0;
  mem8[WATCHDOG_RESET] = 0;
  // 3. Settle the picture's orientation. The only case that turns the picture round is player
  //    two's turn (ACTIVE_PLAYER nonzero) on a cocktail table (UPRIGHT_CABINET zero -- the cell holds
  //    the complemented switch, so zero means cocktail; see mechanisms.md). The cell then drives
  //    latch line 1, the flip-screen line (0xC302).
  // Cleared only when the primary gate is armed while the secondary one reads clear.
  mem8[SCREEN_UNFLIPPED] = mem8[ACTIVE_PLAYER] !== 0 && mem8[UPRIGHT_CABINET] === 0 ? 0 : 1;
  mem8[FLIPSCREEN_LATCH] = mem8[SCREEN_UNFLIPPED];

  // 4. Latch the five input/DIP ports into work-RAM mirrors, complemented (`cpl`): the switches and
  //    buttons are active-low, so after the flip a set bit means "pressed" / "switch on". The write
  //    is unconditional, so each mirror shows what the panel asserts on this frame and nothing more.
  mem8[DIP1_MIRROR] = mem8[DSW1_PORT] ^ 0xff;
  mem8[IN0_MIRROR] = mem8[IN0_PORT] ^ 0xff;
  mem8[IN1_MIRROR] = mem8[IN1_PORT] ^ 0xff;
  mem8[IN2_MIRROR] = mem8[IN2_PORT] ^ 0xff;
  mem8[COINAGE_SETTINGS] = mem8[DSW0_PORT] ^ 0xff;

  // 5. Step the clocks: the free-running frame counter (wraps at a byte) and the two-digit
  //    packed-decimal counter (`inc a` / `daa`, 00..99 and round again).
  mem8[FRAME_TICK] = mem8[FRAME_TICK] + 1;
  mem8[BCD_FRAME_COUNTER] = nextPackedDecimalCount(mem8[BCD_FRAME_COUNTER]);

  // Wind each countdown one step toward zero; a timer already at zero is left alone.
  for (const timer of TIMERS) if (mem8[timer] !== 0) mem8[timer] = mem8[timer] - 1;

  // 6. Coins (0x48BE): debounce the coin and service inputs, bank credits, and pulse the
  //    mechanical coin counters.
  serviceCoinInputs(m);

  // 7. Run the sequence machine. SEQUENCE_PHASE is the machine's mode -- 0 boot wipe, 1 attract,
  //    2 credit / push start, 3 the round engine -- and each mode has its own inner dispatcher
  //    (table at 0x015F: 0x15C2, 0x1651, 0x17FE, 0x0F1F).
  // The sequence machine's outer level: the low two bits of the phase pick one of four arms, each the
  // literal target its slot of the inline four-word table holds.
  switch (mem8[SEQUENCE_PHASE] & PHASE_MASK) {
    case 0: dispatchSequencePhase0SubStepArm(m); break;
    case 1: dispatchSequencePhase1SubStepArm(m); break;
    case 2: dispatchSequencePhase2SubStepArm(m); break;
    case 3: dispatchSequenceSubStepArm(m); break;
  }

  // 8. Close the frame (0x0174): send the oldest queued sound byte, reopen the interrupt gate, and
  //    return to whatever the interrupt broke into (normally the foreground loop).
  sendOneQueuedSoundThenReopenFrameInterrupt(m);
}
