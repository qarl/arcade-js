// SPDX-License-Identifier: GPL-3.0-only
/** replayCloudBands — repaint the frame's multiplexed clouds in bands from m.beamPlan. Final RAM keeps
 * only each slot's far-half appearance; reconstruct the near half, paint the rows above its flip line
 * (113 - final Y, since a mid-frame write shows below the beam) in beam order, restore the far half.
 *
 * ROM: none — this is not a transcribed ROM routine and has no names.js entry or grounding tag. It is
 * the game's beam-sync render step (docs/beam-sync.md). Role in the machine: Time Pilot shows each of
 * the eight scenery (cloud) sprites twice in one frame. The multiplexing passes (multiplexSpriteSlots,
 * multiplexSpriteSlotsSkipping, spinRemainingSpriteMultiplexSlots) wait on the raster and, once the beam
 * has passed a sprite's first appearance, move that hardware sprite half the coordinate range away
 * (mechanisms.md). The real board draws the first appearance before the move and the second after it;
 * a single end-of-frame snapshot would see only the second. Each move is recorded in m.beamPlan as the
 * pair of cells it changed — `y`, the bank-1 Y byte that lost 128, and `x`, the bank-0 X byte that
 * gained 128 — and this routine uses them to paint the frame in bands, each from the RAM the beam saw.
 *
 * It is state-neutral: every cell it changes is put back, so the game's RAM ends as it found it.
 * It runs from runCommandRingDrainLoop while the command ring is empty, before that loop yields.
 * LIVE-OUT: the painted bands (through m.paintBeamBand) and an emptied m.beamPlan; memory unchanged.
 */

import { u8 } from "../../../core/int.js";

// Half the byte range: the size of the move each multiplexing pass made.
const HALF = 128;

export function replayCloudBands(m) {
  // Nothing moved this frame (or the beam-sync render is not active): the ordinary snapshot is exact.
  const plan = m.beamPlan;
  if (!plan || plan.length === 0) return;
  const { mem8 } = m;
  // For each recorded move, the output row where the picture switches from the first appearance to
  // the second, computed from the sprite's final Y byte.
  const slots = plan.map(({ y, x }) => ({ y, x, row: 113 - mem8[y] }));

  // Undo every move, so RAM once more holds each sprite's first (near-half) appearance.
  for (const s of slots) {
    mem8[s.y] = u8(mem8[s.y] + HALF);
    mem8[s.x] = u8(mem8[s.x] - HALF);
  }
  // Walk the switch rows top to bottom, as the beam would. At each, paint every row above it from
  // the RAM as it stands, then redo that one sprite's move so rows below see its second appearance.
  slots.sort((p, q) => p.row - q.row);
  for (const s of slots) {
    m.paintBeamBand(s.row);
    mem8[s.y] = u8(mem8[s.y] - HALF);
    mem8[s.x] = u8(mem8[s.x] + HALF);
  }
  // The plan is consumed; the machine paints the remaining rows when it finishes the frame.
  m.beamPlan = [];
}
