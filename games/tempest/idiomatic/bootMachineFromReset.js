// SPDX-License-Identifier: GPL-3.0-only
import {
  GAME_MODE, MODE_DISPATCH_SEL, VG_SCALE, IN0_PORT, VEC_LIST_HEADER_LO,
  POKEY1_AUDF1, POKEY1_SKCTL, POKEY2_AUDF1, POKEY2_SKCTL, LED_FLIP_LATCH, AVG_RESET_STROBE,
} from "./names.js";
import { armEaromReadback } from "./armEaromReadback.js";
import { rebuildControlBlocksFromTemplate } from "./rebuildControlBlocksFromTemplate.js";
import { buildLevelLayout } from "./buildLevelLayout.js";
import { runMainFrameLoop } from "./runMainFrameLoop.js";

// IN0_PORT bit 4 is the operator self-test switch: idle HIGH boots the game, clear runs diagnostics. [code]
const SELF_TEST = 0x10;

// bootMachineFromReset — the power-on reset entry, a generator. ROM 0xd93f.
//
// Role in the machine: this is where the CPU lands on power-on/RESET. It brings the whole board up from
// cold — clears RAM so nothing reads stale bytes, seeds the handful of control cells the wipe cannot cover,
// then forks on the operator self-test switch: idle (the normal case) boots the game and becomes the main
// loop; held diverts to the technician diagnostic. Validated by the bounded equivalence-d93f gate and the whole-machine boot.
//
// The reset's stack seat, interrupt-disable, decimal-clear and watchdog strobe have no engine effect (the
// engine retires the stack pointer and gates interrupts itself) and are dropped. The AVG reset strobe is
// kept: it sets the AVG done flag (IN0 bit 6) that the self-test path reads. Grounding: [seen].
export function* bootMachineFromReset(m) {
  const { mem8 } = m;

  // Reset the vector generator (ROM 0xd943 sta $5800), so its done flag reads as idle from the start.
  mem8[AVG_RESET_STROBE] = 0;

  // Wipe the two mapped RAM windows before anything reads them: the low work/stack/video pages and the
  // vector/display pages; the unmapped gap between them is left untouched.
  for (let a = 0; a < 2048; a++) mem8[GAME_MODE + a] = 0;
  for (let a = 0; a < 4096; a++) mem8[VEC_LIST_HEADER_LO + a] = 0;

  // Seed the small control block the wipe does not cover: a pair of cells to their power-on 7, two more
  // to 0, and two short runs zeroed. Initialised only here, on reset.
  mem8[MODE_DISPATCH_SEL] = 0;
  mem8[LED_FLIP_LATCH] = 0;
  mem8[POKEY1_SKCTL] = 7;
  mem8[POKEY2_SKCTL] = 7;
  for (let i = 8; i >= 0; i--) {
    mem8[POKEY1_AUDF1 + i] = 0;
    mem8[POKEY2_AUDF1 + i] = 0;
  }

  // Fork on the self-test switch. Bit 4 of IN0 idles high, so a set bit is an ordinary power-on.
  if ((mem8[IN0_PORT] & SELF_TEST) !== 0) {
    // Normal boot: seed the mode flag, run the device-init chain, then become the main loop (the original's
    // power-on settle delay is net-zero on RAM and dropped). yield* never returns.
    mem8[VG_SCALE] = 0x10;
    armEaromReadback(m);
    rebuildControlBlocksFromTemplate(m);
    buildLevelLayout(m);
    yield* runMainFrameLoop(m);
    return;
  }

  // Self-test switch held: divert into the operator diagnostic (reached only when a technician holds the
  // switch, never in normal play; [code], represented as a faithful non-terminating spin).
  yield* spinSelfTest(m);
}

// Operator self-test spin: yields forever (the original's diagnostic runs until power-cycled), reproducing
// no diagnostic RAM effects since that path is [code] / rarely-entered.
function* spinSelfTest(m) {
  for (;;) yield;
}
