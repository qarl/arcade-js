// SPDX-License-Identifier: GPL-3.0-only
/** runSceneryForEra — run one pass of the scenery. The first slot is handed to the opening step as its
 * seed; from there each step advances both cursors and the next step inherits them, so nothing outside
 * chooses where the run starts. The era index then picks one of three fixed running orders: one for the
 * first era, one for the fifth, and one shared by everything between — including an index past the
 * fifth, which falls to that middle order rather than being refused. LIVE-OUT: memory, plus the two cursors.
 *
 * ROM 0x2CBC-0x2CDA plus 0x2CF5-0x2D14. Grounding: [seen] (names.js ROUTINES 0x2cbc).
 *
 * ROLE IN THE MACHINE. The scenery (the clouds and other parallax objects) lives in eight sprite
 * slots, array slots 16-23, whose records start at SCENERY_RECORD_SLOT0 0xA900 [seen] and whose
 * sprite entries start at SCENERY_ENTRY_SLOT0 0xAA30 [seen]. This is their driver, separate from the
 * object handlers: the round engine calls it once per pass, and the pre-round lead-in arms and the life-start reset call it too. Every step
 * in a running order drifts one object by a fraction of the frame's world scroll -- half, three
 * quarters or five quarters -- so nearer objects move faster than farther ones, and lays any extra
 * tiles the object is made of. Each order fills exactly eight slots (mechanisms.md).
 *
 * The era split here is {0}, {1,2,3}, {4}: different from the pace split and the turn split that
 * other routines apply to the same ERA_INDEX 0xAD04 [seen].
 */

import { ERA_INDEX, SCENERY_ENTRY_SLOT0, SCENERY_RECORD_SLOT0 } from "./names.js";
import { driftThreeTileSceneryAtFiveQuarters } from "./driftThreeTileSceneryAtFiveQuarters.js";
import { stepTwoTileSceneryAtFiveQuarters } from "./stepTwoTileSceneryAtFiveQuarters.js";
import { driftTwoTileSceneryAtThreeQuarters } from "./driftTwoTileSceneryAtThreeQuarters.js";
import { driftOneTileSceneryAtThreeQuarters } from "./driftOneTileSceneryAtThreeQuarters.js";
import { driftOneTileSceneryAtHalf } from "./driftOneTileSceneryAtHalf.js";
import { driftNearestSceneryTriTile } from "./driftNearestSceneryTriTile.js";

// The ROM tests ERA_INDEX with `and a` (era 0) and then `cp 0x04` (era 4); anything else is middle.
const FIRST_ERA = 0;
const LAST_ERA = 4;

// Era 0 (1910), ROM 0x2CF5: one three-tile object at 5/4 pace, two two-tile objects at 3/4, one tile at 1/2.
const OPENING_ORDER = [driftThreeTileSceneryAtFiveQuarters, driftTwoTileSceneryAtThreeQuarters, driftTwoTileSceneryAtThreeQuarters, driftOneTileSceneryAtHalf];
// Eras 1-3, ROM 0x2CCE: the same list, but the near object is a cornered three-tile shape.
const MIDDLE_ORDER = [driftNearestSceneryTriTile, driftTwoTileSceneryAtThreeQuarters, driftTwoTileSceneryAtThreeQuarters, driftOneTileSceneryAtHalf];
// Era 4 (2001), ROM 0x2D02: two two-tile objects at 5/4, two single tiles at 3/4, two at 1/2.
const CLOSING_ORDER = [stepTwoTileSceneryAtFiveQuarters, stepTwoTileSceneryAtFiveQuarters, driftOneTileSceneryAtThreeQuarters, driftOneTileSceneryAtThreeQuarters, driftOneTileSceneryAtHalf, driftOneTileSceneryAtHalf];

export function runSceneryForEra(m) {
  const { mem8 } = m;
  // Choose the running order from the era alone; no other state is consulted.
  const era = mem8[ERA_INDEX];
  const order = era === FIRST_ERA ? OPENING_ORDER : era === LAST_ERA ? CLOSING_ORDER : MIDDLE_ORDER;

  // Seed the opening step with the first slot; each step hands back both cursors advanced past the
  // slots it used, and the next step starts from them. (The ROM seats IX = 0xA900 and IY = 0xAA30
  // once, then calls each step in turn, the cursors riding in IX and IY between calls.)
  let cursors = [SCENERY_RECORD_SLOT0, SCENERY_ENTRY_SLOT0];
  for (const step of order) cursors = step(m, ...cursors);
  return cursors;
}
