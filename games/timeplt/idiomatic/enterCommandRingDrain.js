// SPDX-License-Identifier: GPL-3.0-only
/** enterCommandRingDrain — tail transfer into the foreground command-ring loop; hands control to the ring drain and never comes back. LIVE-OUT: whatever the drain leaves.
 *
 * ROM 0x0B90-0x0B92: a single `jp 0x0b93`. [seen]
 *
 * Role in the machine: these three bytes sit immediately before the loop and are the loop's own
 * back-edge. In the original the drain loop jumps here when the ring is empty, and every command
 * handler it runs is handed 0x0B90 as its return address -- so "go round again" always passes
 * through this jump. It reads and writes nothing itself.
 * Kept as the ROUTINES override of 0x0B90: no idiomatic module calls
 * it, because runCommandRingDrainLoop carries the back-edge as its own loop.
 */

import { runCommandRingDrainLoop } from "./runCommandRingDrainLoop.js";

export function* enterCommandRingDrain(m) {
  // Hand straight on to the drain loop at 0x0B93; nothing comes back.
  return yield* runCommandRingDrainLoop(m);
}
