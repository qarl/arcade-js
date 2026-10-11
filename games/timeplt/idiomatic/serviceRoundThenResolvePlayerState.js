// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceRoundThenResolvePlayerState — the round engine: run every subsystem of a round in one fixed
 * order, then read the player's state and resolve the round — advance it, take a life, or carry on.
 *
 * ROM 0x1199-0x11EC (falls through into 0x11ED). Grounding: [seen] (names.js ROUTINES 0x1199).
 *
 * ROLE IN THE MACHINE. Almost all of Time Pilot runs inside the vertical-blank interrupt, which
 * each time runs one arm of a two-level sequence machine. This is arm 7 of phase 3 (the round
 * engine, entry 7 of the sub-step table at 0x0F29), and it is the game itself: both a real game and
 * the attract demo (the same engine, flown by an autopilot) spend their play time here. It runs once
 * per dispatch of that sub-step.
 *
 * WHY THE ORDER MATTERS. The player's frame runs second — only the enemy re-aim runs before it — so
 * the world scroll the ship sets this pass is what every later mover reads. Every mover (shots,
 * enemy wave, parachutist, Mother-Ship, craft, scenery, object banks) runs before the collision pass,
 * so every contact is judged on positions already moved this pass. Bookkeeping (bonus life, hit
 * chain, difficulty, kill meter) comes last.
 *
 * WHY THE SPRITE PASSES REPEAT. multiplexSpriteSlotsSkipping [seen] is a scanline-gated fixup over
 * eight sprite slots: a flagged slot whose position the raster has already passed gets its
 * coordinates adjusted then and there. Because it depends on where the beam is, it is called between
 * groups of services, repeatedly, while the work runs; multiplexSpriteSlots [seen] closes the list,
 * waiting on the raster to move each requested scenery slot half a screen so one sprite shows twice
 * in a frame.
 *
 * LIVE-OUT: everything the subsystem services write, plus whichever resolution arm runs.
 */

import { reaimAndAnimateEnemyCraftOnPhaseTick } from "./reaimAndAnimateEnemyCraftOnPhaseTick.js";
import { dispatchPlayerFrameByState } from "./dispatchPlayerFrameByState.js";
import { fireAndSweepPlayerShots } from "./fireAndSweepPlayerShots.js";
import { driveEnemyWaveForLifePhase } from "./driveEnemyWaveForLifePhase.js";
import { multiplexSpriteSlotsSkipping } from "./multiplexSpriteSlotsSkipping.js";
import { runParachutistSlot } from "./runParachutistSlot.js";
import { stepSevenCraftSlots } from "./stepSevenCraftSlots.js";
import { runSceneryForEra } from "./runSceneryForEra.js";
import { sweepEra2PlusObjectBank } from "./sweepEra2PlusObjectBank.js";
import { serviceEra1BomberObject } from "./serviceEra1BomberObject.js";
import { serviceFixedSlotInEra1 } from "./serviceFixedSlotInEra1.js";
import { stepFourActorSlots } from "./stepFourActorSlots.js";
import { serviceEra0BallisticObjectBank } from "./serviceEra0BallisticObjectBank.js";
import { dispatchCollisionPassByEra } from "./dispatchCollisionPassByEra.js";
import { askForSoundWhileTheGroupIsClear } from "./askForSoundWhileTheGroupIsClear.js";
import { awardBonusLifeAtScoreMark } from "./awardBonusLifeAtScoreMark.js";
import { expireHitChain } from "./expireHitChain.js";
import { escalateDifficultyRungOnCounterWrap } from "./escalateDifficultyRungOnCounterWrap.js";
import { drawKillMeter } from "./drawKillMeter.js";
import { multiplexSpriteSlots } from "./multiplexSpriteSlots.js";
import { advanceRoundWhenFieldCleared } from "./advanceRoundWhenFieldCleared.js";
import { loseLifeAndHandOver } from "./loseLifeAndHandOver.js";
import { armMotherShipOrStep } from "./armMotherShipOrStep.js";
import { PLAYER_STATE } from "./names.js";

// PLAYER_STATE reads 0xFF while the ship is alive and flying.
const ALIVE = 0xff;

export function serviceRoundThenResolvePlayerState(m) {
  // The service list (ROM 0x1199-0x11E4): twenty-five calls, in exactly the ROM's order.
  //
  // The ship and its opponents: re-aim/animate at most one enemy craft on its tick; the player's
  // frame (fly, turn toward the stick, or run the dying animation) and the world scroll it sets; the
  // player's shots; the enemy-wave driver, which spawns craft by era and phase.
  reaimAndAnimateEnemyCraftOnPhaseTick(m);
  dispatchPlayerFrameByState(m);
  fireAndSweepPlayerShots(m);
  driveEnemyWaveForLifePhase(m);
  multiplexSpriteSlotsSkipping(m);
  // The parachutist; the Mother-Ship (armed once the kill quota is spent, else stepped if live); the
  // seven fixed craft slots.
  runParachutistSlot(m);
  armMotherShipOrStep(m);
  stepSevenCraftSlots(m);
  multiplexSpriteSlotsSkipping(m);
  // The era's scenery (one of three fixed lists of parallax movers, by era), then the object bank
  // swept from era 2 on.
  runSceneryForEra(m);
  sweepEra2PlusObjectBank(m);
  multiplexSpriteSlotsSkipping(m);
  // Era 1's bomber and its companion fixed slot (both guarded on the era index), then the four
  // actor slots, stepped as a fixed group.
  serviceEra1BomberObject(m);
  serviceFixedSlotInEra1(m);
  stepFourActorSlots(m);
  multiplexSpriteSlotsSkipping(m);
  // Era 0's three-slot ballistic-object bank; then, with everything moved, the collision pass (chosen
  // by era); then a sound request made on every thirty-second frame from the third era on, only
  // while three fixed object records are all empty.
  serviceEra0BallisticObjectBank(m);
  dispatchCollisionPassByEra(m);
  askForSoundWhileTheGroupIsClear(m);
  multiplexSpriteSlotsSkipping(m);
  // Bookkeeping: an extra life at a bonus score mark; run the chained-hit window down; step the
  // difficulty escalation counter; repaint the kill meter (kills still owed). Close with the full
  // sprite pass.
  awardBonusLifeAtScoreMark(m);
  expireHitChain(m);
  escalateDifficultyRungOnCounterWrap(m);
  drawKillMeter(m);
  multiplexSpriteSlots(m);

  // Resolve the round (0x11E4-0x11EC) on PLAYER_STATE (0xA800) [seen], the player record's head byte:
  //   0xFF (alive)  -> advanceRoundWhenFieldCleared [seen] (ROM `inc a / jp z,0x1271`), which ends
  //                    the round only once the quota is spent and the field is empty;
  //   any other non-zero value (the ship is still dying) -> return and let the pass end (`ret nz`);
  //   0 (dead)      -> loseLifeAndHandOver [seen], which the ROM reaches by falling through into
  //                    0x11ED.
  const state = m.mem8[PLAYER_STATE];
  if (state === ALIVE) return advanceRoundWhenFieldCleared(m);
  if (state !== 0) return;
  return loseLifeAndHandOver(m);
}
