// SPDX-License-Identifier: GPL-3.0-only
/** dispatchPlayerFrameByState — seat the player record and its paired sprite entry, then route the frame on the
 * player-state byte: leave at once while it is clear, drive the multi-pass explosion animation while it is
 * mid-count, and once it reads 0xFF (the ship alive) either fly the demo pilot (no live play), turn the ship
 * toward the read stick, or just scroll the world when the stick is centred. LIVE-OUT: memory.
 *
 * ROM 0x1EDF-0x1F00 (frozen lift translated/loc_1edf.js). Grounding: [seen] in names.js.
 *
 * Role in the machine: the player's per-pass handler. The player owns record 0xA800 (PLAYER_STATE
 * is its head byte) and sprite entry 0xAA10 (PLAYER_ENTRY); the ROM seats them in IX/IY at 0x1EDF.
 * PLAYER_STATE reads 0xFF while the ship is alive, 0xF0 when a death starts (then counts down), and
 * 0x00 once torn down. Because the ship stays at the screen's centre, "flying" it means turning it
 * and scrolling the world past it. */

import { advancePlayerAnimationStrip } from "./advancePlayerAnimationStrip.js";
import { flyDemoShipByScript } from "./flyDemoShipByScript.js";
import { readPlayerControls } from "./readPlayerControls.js";
import { turnShipTowardTargetHeading } from "./turnShipTowardTargetHeading.js";
import { scrollWorldAtTheEraPace } from "./scrollWorldAtTheEraPace.js";
import { PLAYER_ENTRY, PLAYER_HEADING, PLAYER_STATE, PLAY_ACTIVE } from "./names.js";

// The alive value of PLAYER_STATE; the ROM tests for it with `inc a` (zero only for 0xFF).
const ALIVE = 0xff;

export function dispatchPlayerFrameByState(m) {
  const { mem8 } = m;

  /* Route on PLAYER_STATE (0x1EE7-0x1EEF): torn down (0) -> nothing this frame; any value other than
   * 0xFF -> the phase-byte-driven tile animation (0x2010) on the player's record and entry, which is
   * how the death sequence plays out; 0xFF (alive) -> go on to steer. */
  const state = mem8[PLAYER_STATE];
  if (state === 0) return;
  if (state !== ALIVE) return advancePlayerAnimationStrip(m, PLAYER_STATE, PLAYER_ENTRY);

  /* No live game (PLAY_ACTIVE 0xAD30 zero, 0x1EF0-0x1EF6): the attract demo's autopilot flies the
   * ship from its script (0x214B). */
  if (mem8[PLAY_ACTIVE] === 0) return flyDemoShipByScript(m);

  /* Live play (0x1EF7-0x1F00): read the control word of the panel facing the screen (0x1ED1) and
   * keep its low nibble, the stick directions. Off centre -> turn toward it (0x1F01, which then
   * scrolls); centred -> only scroll the world along the current heading (0x1F42). */
  const stick = readPlayerControls(m) & 0x0f;
  if (stick !== 0) return turnShipTowardTargetHeading(m, stick);
  return scrollWorldAtTheEraPace(m, mem8[PLAYER_HEADING]);
}
