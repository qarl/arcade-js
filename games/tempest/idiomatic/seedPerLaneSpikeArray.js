// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { LANE_FILL_INIT, INITIAL_ACTIVE_COUNT, FIRE_GATE, LANE_LIMIT } from "./names.js";

/**
 * seedPerLaneSpikeArray — init-time seeder for the per-lane spike/limit block. ROM 0x9234.
 *
 * Role in the machine: when a wave is armed the spawner needs a fresh per-lane control
 * block — one header cell that counts how many entries are live plus a parallel run of
 * sixteen per-lane cells (one for each tube lane) that gate how far up a lane an enemy may
 * climb. This routine lays that block down from the level's initialization constants so the
 * wave starts from a known state. It is one link in the wave spawn chain driven off the
 * spawn cadence (unpackLevelNibbleTables → reseedStateTables → seedPerLaneSpikeArray → …).
 *
 * Behavior: copy the header source byte $15b into the header cell $3ab (the live/active
 * count the rest of the spawn path reads), then read the fill constant from $15a once and
 * write it into all sixteen body cells $3ac..$3ac+0x0f, counting X down from 0x0f to 0.
 *
 * Live-out: $3ab (header / active count) and the sixteen per-lane cells $3ac..$3bb, all
 * seeded for the wave the spawner is about to build.
 *
 * Returns the exit X the ROM leaves, 0xff (the fill runs X past 0); Y is not touched. Grounding: [seen].
 */
export function seedPerLaneSpikeArray(m) {
  const { mem8 } = m;
  mem8[FIRE_GATE] = mem8[INITIAL_ACTIVE_COUNT]; // header: $3ab <- init active count $15b
  const fill = mem8[LANE_FILL_INIT];            // per-lane fill constant read from $15a once
  // Fill the sixteen per-lane body cells $3ac..$3bb with the constant (X: 0x0f down to 0).
  for (let x = 0x0f; x >= 0; x--) mem8[u16(LANE_LIMIT + x)] = fill;
  return 0xff;
}
