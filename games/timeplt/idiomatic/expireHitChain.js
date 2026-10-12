// SPDX-License-Identifier: GPL-3.0-only
/** expireHitChain — count the chained-hit window down by one per call and, once it has already run
 * out, hold the chain step next to it at zero. The two are not done together: while the window
 * still has anything in it the step is left alone, and once the window reads zero it stops being
 * counted and the step is cleared instead — on every call, not once. LIVE-OUT: memory.
 *
 * ROM 0x5205-0x5210 (lift: translated/loc_5205.js). Grounding: [seen].
 *
 * Role in the machine: shooting enemies in quick succession pays out on an award ladder. The scoring
 * post reloads CHAIN_WINDOW (0xA99D) to 30 on every hit; a hit while the window is still open climbs
 * CHAIN_STEP (0xA99E) and is paid by it, and a hit on a closed window pays entry 1 and leaves the step
 * alone (`jr z,0x51fa` at 0x51E3). This routine, an entry of the round engine's service block (called
 * from serviceRoundThenResolvePlayerState), is the only thing that ends a chain: the poster has no path
 * that resets the step itself. It runs once per dispatch of that service block — NOT once a frame — so
 * the window is 30 of those ticks, not half a second.
 */

import { CHAIN_WINDOW, CHAIN_STEP } from "./names.js";

export function expireHitChain(m) {
  const { mem8 } = m;
  // ROM: `ld hl,0xa99d / ld a,(hl) / and a` — test the window for zero.
  const remaining = mem8[CHAIN_WINDOW];
  // Already expired: clear the step so the next hit starts the ladder from the bottom again. The
  // ROM does it with `inc l / ld (hl),a` (A is 0 here) on the cell one address on. The clear is
  // not edge-triggered — it repeats on every idle call, which is why the name says "expire"
  // rather than "tick".
  if (remaining === 0) {
    mem8[CHAIN_STEP] = 0;
    return;
  }
  // Still alive: one tick off the window (`dec (hl)`). The step is left untouched, so a hit that
  // lands before the window empties still climbs the ladder.
  mem8[CHAIN_WINDOW] = remaining - 1;
}
