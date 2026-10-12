// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroyPlayerAndBomberOnContact — ROM 0x507E [seen]
 *
 * WHAT IT IS. The collision test between the player's own ship and the flying bomber held in
 * era-object slot 0 (record ERA_OBJECT_RECORD_SLOT0 0xA8C0, sprite entry ERA_OBJECT_ENTRY_SLOT0
 * 0xAA28): flying into it destroys both. Its only caller, splitCollisionWorkByFrameParity, runs in era 1 alone.
 *
 * ROLE. Both must still be live, and both coordinates must fall inside a wrapped window around the
 * meeting point, the window along one axis being wider than the other. When all four tests pass,
 * both are marked destroyed, the target's BOMBER_HITS_TO_ABSORB is zeroed so the contact kills it outright
 * rather than costing it a hit, and the score is posted. Any test failing leaves everything
 * untouched, so this is a whole-or-nothing check. Undriven play never meets the four tests; under
 * MAME a poked run that brings the ship onto that target does, and all three stores fire.
 *
 * LIVE-OUT: memory only.
 */

import { postChainedHitScore } from "./postChainedHitScore.js";
import { u8 } from "../../../core/int.js";
import { ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_SPRITE_Y_SLOT0, BOMBER_HITS_TO_ABSORB, PLAYER_ENTRY, PLAYER_SPRITE_Y, PLAYER_STATE } from "./names.js";

// The contact box, as a wrapped window: (target - player + SLACK) mod 256 < WINDOW accepts a
// difference from -SLACK up to WINDOW - SLACK - 1. First axis: -6..+6; second: -0x18..+8.
const FIRST_AXIS_SLACK = 6;
const FIRST_AXIS_WINDOW = 0x0d;
const SECOND_AXIS_SLACK = 0x18;
const SECOND_AXIS_WINDOW = 0x21;

// State bytes: 0xFF live; 0xF0 destroyed (for the player, 0xF0 starts the death).
const LIVE = 0xff;
const DESTROYED = 0xf0;

export function destroyPlayerAndBomberOnContact(m) {
  const { mem8 } = m;
  // Tests 1 and 2: the player (PLAYER_STATE 0xA800) and the target (0xA8C0) must both be live
  // (ROM 0x5082-0x508B: inc a / ret nz on each).
  if (mem8[PLAYER_STATE] !== LIVE) return;
  if (mem8[ERA_OBJECT_RECORD_SLOT0] !== LIVE) return;

  // Test 3: target entry +0 (0xAA28) against the player's entry +0 (PLAYER_ENTRY 0xAA10).
  const xDelta = u8(mem8[ERA_OBJECT_ENTRY_SLOT0] - mem8[PLAYER_ENTRY] + FIRST_AXIS_SLACK);
  if (xDelta >= FIRST_AXIS_WINDOW) return;
  // Test 4: target sprite Y (ERA_OBJECT_SPRITE_Y_SLOT0 0xAA59) against the player's (PLAYER_SPRITE_Y 0xAA41).
  const yDelta = u8(mem8[ERA_OBJECT_SPRITE_Y_SLOT0] - mem8[PLAYER_SPRITE_Y] + SECOND_AXIS_SLACK);
  if (yDelta >= SECOND_AXIS_WINDOW) return;

  // Contact: both start to die, the hits the target could still absorb are cleared (BOMBER_HITS_TO_ABSORB 0xA8DC)
  // so nothing survives the contact, and the ROM tail-jumps to postChainedHitScore (0x51DE).
  mem8[PLAYER_STATE] = DESTROYED;
  mem8[ERA_OBJECT_RECORD_SLOT0] = DESTROYED;
  mem8[BOMBER_HITS_TO_ABSORB] = 0;
  postChainedHitScore(m);
}
