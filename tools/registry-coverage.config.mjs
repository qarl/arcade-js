// SPDX-License-Identifier: GPL-3.0-only

export const UNWIRED = {
  frogger: {
    // DISSOLVED caller-skips, NOT oracle-served. A caller-skip pops the caller's return (net SP +4), which is
    // outside the withOmittedRet seam's 0/+2 window, so it cannot be a ROUTINES override. Per the runbook it is
    // dissolved into a boolean skip-signal the caller early-returns on, called DIRECTLY by a sibling (runs as JS,
    // never the frozen oracle). Recorded so the coverage gate knows they are intentionally not ROUTINES-dispatched.
    "awardBonusPoints.js":
      "DISSOLVED caller-skip -> boolean: returns true (cursor set) to make the goal-award caller skip its " +
      "remainder, else adds the score and returns false. Direct-called by awardHomeBayGoal (runs as JS, not " +
      "oracle-served). Not a ROUTINES override: the +4 SP move is outside the seam's 0/+2 window.",
    "tickAttractCellFrameClock.js":
      "DISSOLVED double caller-skip -> boolean: false = tick not elapsed (caller skips its remainder), true = " +
      "elapsed (frame tile in A). Direct-called by driveAttractDemoSequencer (runs as JS, not oracle-served). " +
      "Not a ROUTINES override: the double-skip's +4 SP move is outside the seam's 0/+2 window.",
  },
  timeplt: {
    // DISSOLVED, NOT oracle-served. Each module below runs as JS in the live game by a DIRECT call from
    // another idiomatic module, never as a ROUTINES override, and the translated routine at its address
    // never runs. Measured on the shipped engine (runIdiomaticGame, resolveAllIdiomatic) over the
    // coin/start/play tape, attract and every tapes/*.poke.json state: machine.call is never entered after
    // boot in any session, and tools/translated_live_probe.mjs --game timeplt reads no translated routine
    // executed.
    // The address-bearing entries are also recorded `dead` in tools/idiomatic-boundaries.txt.
    "replayCloudBands.js":
      "NOT a ROM routine, so nothing to dissolve and nothing oracle-served: it has no ROM address and no " +
      "ROUTINES entry can name it. runCommandRingDrainLoop calls it directly before its vblank yield to " +
      "repaint the frame's beam-multiplexed scenery in scanline bands (docs/beam-sync.md); it reads " +
      "m.beamPlan and drives the machine's band accumulator, state-neutrally. Entered once per frame " +
      "on every measured session.",
    "placeTileAtTableSuppliedOffset.js":
      "DISSOLVED into a direct call, not oracle-served: loc_307f calls it directly on the scenery seed's " +
      "tamper divert (seedSceneryEntriesThenRunScenery -> trampolineToLoc_307f -> loc_307f), which no " +
      "measured session takes, and the translated loc_3074 never runs. Not a ROUTINES override: 0x3074 " +
      "is not a dispatch entry (the one decoded transfer to it, a djnz at 0x3081, is a caption record " +
      "read as code; the genuine way in is a fall-through from 0x306A, which has no transcribed routine).",
    "objectGeometry.js":
      "NOT a ROM routine, so nothing to dissolve and nothing oracle-served: it has no ROM address and no " +
      "ROUTINES entry can name it. It holds the 8.8 coordinate glue/split, the wrapped collision window " +
      "and the in-page record step that the movers and collision tests import directly.",
    "appendSoundCommandToQueue.js":
      "DISSOLVED into a direct call, not oracle-served: enqueueSoundIfGameInProgress, " +
      "enqueueSoundIfGameOrDemoSoundsOn and enqueueSoundUnconditional call it directly with the sound code " +
      "as an argument -- entered on every measured session -- and the translated loc_562a never runs. " +
      "Not a ROUTINES override: its address's word occurs nowhere in the image, so no table names it; " +
      "every way in is a branch or fall-through interior to another routine.",
  },
  pooyan: {
    "mainLoopStep.js": "the main-loop state-driver body (loc_020f), direct-called by the mainLoop generator so it can yield at the vblank; the generator imports it rather than dispatching through ROUTINES. Memory-equivalent to the frozen loop body (equivalence-020f); not a dispatch entry.",
    "dispatchOneHunterRecordState.js": "DISSOLVED boolean caller-skip dispatcher; direct-called by idiomatic loc_2c2c; switches ((ix+2)&0x1f)-0x11 to climbHunterToLaunchRowThenPromoteGroup/2cb3/2d24/2d4a; not oracle-served",
    "climbHunterStepAndRetireAtTop.js": "DISSOLVED hunter state-2 caller-skip -> boolean; direct-called by idiomatic dispatchOneHunterRecordState; not oracle-served",
    "clearWaveHoldTimerToArmNextWave.js": "DISSOLVED hunter state-3 caller-skip -> boolean; direct-called by idiomatic dispatchOneHunterRecordState; not oracle-served",
    "loc_0728.js": "DISSOLVED into loc_0714 (SCC fold); idiomatic-unreachable; not oracle-served",
    "initSpawnedActorRecordAndDeriveSpeed.js": "DISSOLVED unconditional caller-skip -> false (always skips); direct-called by loc_54f9/loc_5544/loc_5594 (wired overrides); not oracle-served",
    "spawnEnemyIntoFreeActorSlot.js": "DISSOLVED caller-skip -> boolean (spawn path); direct-called by loc_56e8/loc_588e (wired overrides); not oracle-served",
    "loc_5733.js": "DISSOLVED caller-skip -> boolean; direct-called by loc_53a0 (a wired ROUTINES override); not oracle-served",
    "testEnemyRecordHitAndRegister.js": "DISSOLVED caller-skip -> boolean; direct-called by loc_5b86 (a wired ROUTINES override); not oracle-served",
    "latchObjectTypeAndScanEnemyRecords.js": "DISSOLVED caller-skip -> boolean; direct-called by loc_5f6a (a wired ROUTINES override); not oracle-served",
    "scanObjectBankForActorCollision.js": "DISSOLVED caller-skip -> boolean (true=keep scanning, false=abort); direct-called by loc_6404 (a wired ROUTINES override); not oracle-served",
    "verifyTerminatorTableOrCountTamper.js": "DISSOLVED caller-skip -> boolean (true=keep scanning, false=abort); direct-called by scanObjectBankForActorCollision (a wired ROUTINES override); not oracle-served",
    "spawnPairedEnemyRecordAndAnnounceWave.js": "DISSOLVED caller-skip -> boolean (true=already active/keep sweeping, false=spawned/abort); direct-called by loc_6905 (a wired ROUTINES override); not oracle-served",
    "spawnEnemyIntoFreeSlotCyclingAnim.js": "DISSOLVED caller-skip -> boolean (true=already active/keep sweeping, false=spawned/abort); direct-called by loc_6a0f (a wired ROUTINES override); not oracle-served",
    "dispatchEnemyActorAnimTickState.js": "DISSOLVED dispatch propagator -> boolean; direct-called by loc_7627 (a wired ROUTINES override); switches (ix+2)&3 to tickEnemyAnimAndReseedPoolAtCycleEnd/7675/76a6; not oracle-served",
    "tickEnemyAnimAndReseedPoolAtCycleEnd.js": "DISSOLVED caller-skip -> boolean (true=keep walking, false=abort); direct-called by the idiomatic dispatcher dispatchEnemyActorAnimTickState; not oracle-served",
    "drainPhaseCountdownAndReseedWave.js": "DISSOLVED caller-skip -> boolean (true=keep walking, false=abort); direct-called by the idiomatic dispatcher dispatchEnemyActorAnimTickState; not oracle-served",
    "holdEnemyAnimGatedByDrawnFlag.js": "DISSOLVED plain-ret handler (returns keep-walking); direct-called by the idiomatic dispatcher dispatchEnemyActorAnimTickState; not oracle-served",
    "classifyAndRouteObjectRecordByRound.js": "DISSOLVED tail-call -> boolean (object-proximity SCC entry); direct-called by idiomatic latchObjectTypeAndEnterProximityScan via the wired loc_602f; not oracle-served",
    "latchObjectTypeAndEnterProximityScan.js": "DISSOLVED fall-through -> boolean (true=normal/inert, false=hit skip); direct-called by loc_602f (a wired ROUTINES override); not oracle-served",
    "gateEvenRoundOverlapAndRouteHit.js": "DISSOLVED tail-call -> boolean (miss->60f2, hit->60bc); direct-called within the idiomatic SCC; not oracle-served",
    "loc_60f2.js": "DISSOLVED scan loop -> boolean; direct-called within the idiomatic SCC (recurses to classifyAndRouteObjectRecordByRound); not oracle-served",
    "resolveOddRoundCollisionAndAward.js": "DISSOLVED award caller-skip -> boolean; direct-called within the idiomatic SCC; not oracle-served",
    "resolveKind50AndD0CollisionAward.js": "DISSOLVED tail-call -> boolean; direct-called by idiomatic resolveOddRoundCollisionAndAward; not oracle-served",
    "testKindF0TightOverlap.js": "DISSOLVED tail-call -> boolean; direct-called by idiomatic resolveOddRoundCollisionAndAward; not oracle-served",
    "resolveShotHitEngageOrSeedRecord.js": "DISSOLVED hit-handler caller-skip -> boolean; direct-called by idiomatic gateEvenRoundOverlapAndRouteHit; not oracle-served",
    // DISSOLVED caller-skips (pop-af; ret -> boolean). A caller-skip pops its own return (a net SP move
    // outside the withOmittedRet seam's 0/+2 window), so it cannot be a ROUTINES override. Per the runbook
    // each is dissolved into a boolean its caller early-returns on and is called DIRECTLY by that (wired)
    // caller -- it runs as JS, never the frozen oracle. Also recorded `dead` in tools/idiomatic-boundaries.txt.
    // The five jump-table dispatchers (0x6da6/0x7442/0x15a1/0x72cf/0x0fd5) are deferred to their own unit.
    "stageFormationReadyMarkersOrSkipTick.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_2b9a " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "launchFormationObjectIntoFreeSlot.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_2bb3 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "climbHunterToLaunchRowThenPromoteGroup.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_2a01 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "testHangingRopeGrabConnect.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by advanceHangingRopeObjectWithGrabCheck " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "seedFormationChildIntoFreeSlotAndLaunchParent.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_3c92 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "testTargetPairOverlapAndClaimRecord.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_5d4d " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "testTargetSlotGrabAndCatchObject.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_5e11 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "clearActiveObjectTypeAndAbortHandler.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_613d " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "retireParityTargetSlotAndQueueSound.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_62e6 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "scanTargetSlotsAndSpawnOnProximityHit.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_6381 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "testTargetProximityAndSetAimDirection.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_6c18 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "seedFreeEnemyRecordFromRoundTables.js":
      "DISSOLVED caller-skip -> boolean (true=normal, false=skip); direct-called by loc_1171 " +
      "(a wired ROUTINES override), so it runs as JS and is never oracle-served. Not a ROUTINES " +
      "override: the pop-af skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "initDescendingObjectSlot.js":
      "DISSOLVED caller-skip -> boolean (true=slot busy/keep sweeping, false=slot initialized/abort); " +
      "direct-called by moveFormationAndSpawnObject (a wired ROUTINES override), so it runs as JS and is never oracle-served. " +
      "Not a ROUTINES override: the pop-af/ret skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "activateLaneActorSlot.js":
      "DISSOLVED caller-skip -> boolean (true=already active/keep sweeping, false=activated/abort); " +
      "direct-called by spawnNextScriptedEnemy (a wired ROUTINES override), so it runs as JS and is never oracle-served. " +
      "Not a ROUTINES override: the pop-af/ret skip moves SP outside the withOmittedRet seam's 0/+2 window.",
    "launchWolfIntoSlot.js":
      "DISSOLVED caller-skip -> boolean (true=slot occupied/keep sweeping, false=launched/abort); " +
      "direct-called by spawnNextEnemyOnDelay (a wired ROUTINES override), so it runs as JS and is never oracle-served. " +
      "Not a ROUTINES override: the caller-skip's net SP move is outside the withOmittedRet seam's 0/+2 window.",
  },
  invaders: {
    // Engine-seam interrupt bodies: the board fireNmi calls these directly each clock-free frame (assigned
    // to machine.idiomaticVblankNmi / machine.idiomaticMidNmi under opts.overrides), NOT the ROUTINES map --
    // registry-coverage only recognizes ROUTINES dispatch, so they are exempted here with the reason.
    "idiomaticVblankNmi.js":
      "engine-seam vblank interrupt body; the board fireNmi calls it each clock-free frame (assigned to " +
      "machine.idiomaticVblankNmi under opts.overrides). Not a ROUTINES override -- dispatched via the " +
      "machine interrupt seam, not the object registry.",
    "idiomaticMidNmi.js":
      "engine-seam mid-screen interrupt body; the board fireNmi calls it before the vblank body each " +
      "clock-free frame (assigned to machine.idiomaticMidNmi under opts.overrides). Not a ROUTINES override.",
    "pickNextMarchingAlien.js":
      "mid-screen draw scan (next-alien picker): direct-called by the idiomatic mid interrupt body after " +
      "the object walk; scans the alien-status field, resolves the found cell's screen coordinate, and " +
      "either latches the pending-draw span or, when an alien has crossed the low row threshold, arms the " +
      "round-ending warm restart (invasionReset) as m.nextMain. Not a ROUTINES override -- reached only from the " +
      "interrupt seam. The invasion bail is not exercised by the in-game tape (faithfulness-only); the " +
      "scan/latch path runs every in-game frame and is covered by the in-game convergence.",
    // OBJECT-TABLE walker + its five handlers. The walker walkObjectTable (seated by walkVblankObjectTable for the vblank base)
    // is now idiomatic: the interrupt bodies direct-call it, and it selects each record's handler from a
    // static 5-way map and calls it as a plain JS function -- no pchl, no m.call, no ROUTINES dispatch. So
    // the walker, the base-seat, and the five handlers all run as JS (dissolved); none is a ROUTINES
    // override. The record pointer live-in is threaded as `= m.regs.de` where a handler uses it. Their
    // equivalence-<addr> gates are correct and stay; behavioral validation is the in-game convergence run.
    "walkVblankObjectTable.js":
      "seats the vblank object-table base then direct-calls the walker walkObjectTable; direct-called by the " +
      "idiomatic vblank interrupt body (runs as JS, dissolved). Not a ROUTINES override.",
    "walkObjectTable.js":
      "the object-table walker: direct-called by the interrupt bodies (vblank via walkVblankObjectTable, mid directly), " +
      "it walks the 16-byte records and direct-calls each record's idiomatic handler from a static 5-way map " +
      "(runs as JS, dissolved). Not a ROUTINES override -- reached only from the interrupt seam.",
    "playerShipHandler.js":
      "record-0 timer/animation handler, direct-called by the idiomatic walkObjectTable walker (runs as JS, " +
      "dissolved); on the active player's death it arms the next main-loop flow as a warm restart " +
      "(m.nextMain). Not a ROUTINES override.",
    "alienShotSlot2Handler.js":
      "object-table handler: mirrors a control byte, gates on a 16-bit countdown, primes the record strip, " +
      "steps the alien shot (stepAlienShot), then restores the strip mid-blowup or blits the template band. " +
      "Direct-called by the idiomatic walkObjectTable walker (runs as JS, dissolved). Not a ROUTINES override.",
    "alienShotSlot3Handler.js":
      "object-table handler: runs while a gate cell is clear and a mode cell is one, primes the record strip, " +
      "steps the alien shot, clamps the column, restores the strip or blits the template band, latches a gate " +
      "on the last alien, and publishes the column word. Direct-called by the idiomatic walkObjectTable walker " +
      "(runs as JS, dissolved). Not a ROUTINES override.",
    "saucerHandler.js":
      "the mystery-ship object handler: saucer-mode gated, delegates to alienShotSlot4Handler otherwise; launches, walks, " +
      "and explodes the saucer (hit sound / score award / tone silence) then reloads the record template. " +
      "Direct-called by the idiomatic walkObjectTable walker (runs as JS, dissolved). Not a ROUTINES override.",
    "attractAnimHandler.js":
      "the attract-demo object handler (ROM 0x050e) for the ISR-handshaked reveal animation: runHandshakedAttractAnim " +
      "block-copies its descriptor (ROM 0x1bc0, target 0x050e) into the attract object table at 0x2050, and the " +
      "walker dispatches it every reveal cycle. 0x050e is the loc_050f body entered one byte early through a `pop h` " +
      "that only rebalances the walker's pushed record pointer (no RAM/IO effect, dead HL), so it runs the shared body " +
      "alienShotSlot4Handler. Direct-called by the idiomatic walkObjectTable walker (runs as JS, dissolved). Not a " +
      "ROUTINES override -- reached only via the object-table dispatch, never m.call.",
    "playerShotHandler.js":
      "object-table type-dispatch handler, the player-shot record: launch, step in flight (erase / advance " +
      "Y / collision redraw), retire animation, and the shared reseed + saucer-key tally. Direct-called by " +
      "the idiomatic walkObjectTable walker (runs as JS, dissolved). Not a ROUTINES override.",
    // VBLANK RECORD TAIL + ATTRACT TASK-DISPATCH seam. The idiomatic vblank interrupt body direct-calls
    // serviceVblankObjects (its in-game record tail) and, on the attract demo sub-arm, dispatchAttractTask (the ISR task dispatch);
    // dispatchAttractTask direct-calls the attract task-bit arms walkAttractObjectTable / runAttractObjectTail. All four run as plain JS reached
    // only through the interrupt seam -- no ROUTINES dispatch. Behavioral validation is the frame-stepped +
    // attract-state convergence (attract) and the in-game convergence (in-game tail).
    "serviceVblankObjects.js":
      "the vblank in-game record tail: latch, redraw the pending alien, walk the vblank object table " +
      "(idiomatic walkVblankObjectTable -> walkObjectTable), then step the saucer timer, returning early on a warm restart. " +
      "Direct-called by the idiomatic vblank interrupt body (in-game) and by the idiomatic runAttractObjectTail (attract " +
      "task bit0). Not a ROUTINES override -- reached only from the interrupt seam.",
    "dispatchAttractTask.js":
      "attract-mode ISR task dispatch: selects at most one queued task from the low TASK_FLAGS bits " +
      "(bit0 -> runAttractObjectTail, bit1 -> stepAnimationFrame, bit2 -> walkAttractObjectTable). Direct-called by the idiomatic " +
      "vblank interrupt body's attract sub-arm (runs as JS, dissolved). Not a ROUTINES override.",
    "walkAttractObjectTable.js":
      "attract task bit2 arm: walks the attract-demo object table via the idiomatic walkObjectTable with its base " +
      "(0x2050). Direct-called by the idiomatic dispatchAttractTask (runs as JS, dissolved). Not a ROUTINES override.",
    "runAttractObjectTail.js":
      "attract task bit0 arm: re-enters the idiomatic vblank record tail serviceVblankObjects (without the fleet-march " +
      "beat the in-game entry runs first). Direct-called by the idiomatic dispatchAttractTask (runs as JS, dissolved). " +
      "Not a ROUTINES override.",
    // TILT/PANIC seam. The idiomatic vblank interrupt body direct-calls the per-frame tilt check checkTiltInput;
    // on a tilt press it arms the tiltReset generator (screen wipe -> banner -> hold -> attract teardown) as
    // m.nextMain, so the multi-frame reset paces clock-free without blocking the interrupt body. Reached only
    // through the interrupt seam + the nextMain swap, not a ROUTINES dispatch. The tilt path is not exercised
    // by the attract/in-game tapes (faithfulness-only); the no-tilt path is covered by both convergence runs.
    "checkTiltInput.js":
      "per-frame tilt/panic check and its warm-restart reset flow (tiltReset): the idiomatic vblank interrupt " +
      "body direct-calls the check each frame; on a tilt press it arms tiltReset as m.nextMain to wipe the " +
      "field, type the banner, hold, and join the attract teardown. Reached via the interrupt seam and the " +
      "nextMain swap, not a ROUTINES address dispatch.",
    // IN-GAME MAIN-LOOP + RESTART CLUSTER (B step 4), authored ahead and UNWIRED. These are the in-game
    // foreground spine: they are entered only when a game starts, via the nextMain factory swap playerShipHandler
    // performs at step 6 (m.nextMain = factory; the coroutine engine builds the fresh main generator),
    // and via yield* from one another -- NOT the ROUTINES address dispatch registry-coverage recognizes.
    // Behavioral validation is deferred to step 7 in-game convergence; the two independently drivable
    // busy-wait generators carry their own drafter tests. They become named as the wiring lands at step 6.
    "mainLoop.js":
      "in-game frame loop generator: one frame of round work per pass, forever. Entered by yield* from the " +
      "field-arm setup tail; hands off to the player-switch restart when the alien count reaches zero. Not " +
      "a ROUTINES override -- the spine enters it via yield*, not an address dispatch.",
    "startRoundFlow.js":
      "round-start entry generator (splash delay -> field preamble). Reached by yield* from the new-round " +
      "factory; not an address dispatch target while the producer playerShipHandler is still translated.",
    "restoreShieldsAndEnterRound.js":
      "shield/field preamble generator, select-bit branched. Reached by yield* from the round-start entry " +
      "and the player-switch restart; not a ROUTINES override (spine yield* entry, not address dispatch).",
    "enterRoundWithFieldReload.js":
      "field-arm tail generator (load saved field, mark active, cue sound, fall into the frame loop). " +
      "Reached by yield* from the preamble; not a ROUTINES override.",
    "enterRoundWithoutFieldReload.js":
      "field-arm tail generator without the field reload. Reached by yield* from the extra-life " +
      "continuation and the preamble; not a ROUTINES override.",
    "restorePlayer1ShieldsAndEnterRound.js":
      "player-1 shield-restore arm of the preamble (generator). Reached by yield* from the preamble; not " +
      "a ROUTINES override.",
    "showRoundStartSplash.js":
      "round-start splash busy-wait generator: paint the opening row, then hold a 0xb0-frame counter spin, " +
      "flashing the score each frame. Reached by yield* from the round-start entry; not a ROUTINES override. " +
      "Independently driven by its drafter test (busywait-088d).",
    "waitNextRoundArm.js":
      "player-switch handoff wait generator: hold a 0x30-frame counter spin while the arm trigger holds, " +
      "then wait for it to re-arm. Reached by yield* from the player-switch restart; not a ROUTINES " +
      "override. Independently driven by its drafter test (busywait-0a3c).",
    "advanceToNextRound.js":
      "player-switch restart generator: wait, advance the player index and rebuild its field/shields, then " +
      "re-enter the preamble. Reached by yield* from the frame loop's alien-count-zero exit; not a ROUTINES " +
      "override.",
    "newRoundFlow.js":
      "new-round nextMain factory generator: save shields, stage the field record, reseed for the incoming " +
      "player, then enter the round-start entry. Swapped in as m.nextMain by playerShipHandler at step 6; not a " +
      "ROUTINES address dispatch.",
    "gameOverFlow.js":
      "game-over nextMain factory generator: promote the high score, then join the attract teardown (one " +
      "player, or both out) or hand off to the new round for the survivor. Swapped in as m.nextMain by " +
      "playerShipHandler at step 6; not a ROUTINES address dispatch.",
    "returnToAttractFlow.js":
      "game-over-to-attract join generator: type the closing message, silence, then delegate into the " +
      "attract teardown. Reached by yield* from the game-over factory; not a ROUTINES override.",
    "doJFlow.js":
      "extra-life continuation nextMain factory generator: take a reserve ship, then re-enter the field-arm " +
      "tail. Swapped in as m.nextMain by playerShipHandler at step 6; not a ROUTINES address dispatch.",
    "invasionReset.js":
      "round-ending warm-restart flow generator: mark the reset in progress, hold the interrupt-driven death " +
      "wait, then teardown and join the game-over flow. Swapped in as m.nextMain by the idiomatic pickNextMarchingAlien " +
      "when an alien reaches the base; not a ROUTINES address dispatch. Not exercised by the in-game tape " +
      "(faithfulness-only), reached only through the nextMain swap.",
    // CREDIT-SCREEN -> GAME-START chain (attract -> in-game transition). The idiomatic vblank interrupt
    // body arms creditScreen as m.nextMain when a coin has banked a credit during the attract demo; on a
    // start press it yield*-delegates through the start-init generators into the already-authored round-start
    // entry (startRoundFlow) and the in-game frame loop. Entered by nextMain swap / yield*, NOT the ROUTINES
    // address dispatch registry-coverage recognizes. Behavioral validation is the in-game convergence run.
    "creditScreen.js":
      "credit-inserted screen generator: draw the credit/start prompts and poll the start buttons, then " +
      "hand off to the matching game-start init. Swapped in as m.nextMain by the idiomatic vblank interrupt " +
      "body when a credit is banked during the attract demo; not a ROUTINES address dispatch.",
    "startOnePlayerGame.js":
      "one-player game-start generator: deduct one credit and run the shared start init. Reached by yield* " +
      "from creditScreen; not a ROUTINES override.",
    "startTwoPlayerGame.js":
      "two-player game-start generator: set the two-player flag, deduct two credits, and run the shared " +
      "start init. Reached by yield* from creditScreen; not a ROUTINES override.",
    "startGameFlow.js":
      "shared game-start init generator: seed the score/shield/alien/reserve state for a new game, then fall " +
      "into the round-start entry. Reached by yield* from the one/two-player start generators; not a " +
      "ROUTINES override.",
  },
  galaxian: {
    // The born-live spine (§4 clock-free block): the vblank NMI is the sole heartbeat and the main loop
    // free-runs as a generator. These modules run as JS but are reached directly (fireNmi / the generator /
    // sibling imports), never through the registry seam, so they carry no ROUTINES entry; not oracle-served.
    "enterVblankService.js":
      "the vblank NMI service, fired directly by machine.fireNmi's idiomaticNmi branch (not through the " +
      "registry seam): it acks the interrupt, DMAs the OBJRAM shadow, latches inputs, ticks the frame " +
      "counter, runs the per-frame service routines, dispatches on game state, and re-arms the irq. The " +
      "born-live engine calls it directly, so no ROUTINES entry can seat it; not oracle-served.",
    "mainLoop.js":
      "the free-running main loop, run as the generator by runIdiomaticGame (returned by enterMainLoop): it drains " +
      "the display list and yields once per frame at the vblank. Not a ROM-address routine and not a dispatch " +
      "target; not oracle-served.",
    "dispatchSelfTestMode.js":
      "power-on self-test mode dispatch, direct-called by enterVblankService while the self-test mode is " +
      "nonzero; routes to the already-idiomatic mode handlers or the ramp fill/scan. Not oracle-served.",
    "fillObjRamTestRamp.js":
      "self-test OBJRAM ramp fill, direct-called by dispatchSelfTestMode (falls into the scan). Not oracle-served.",
    "scanObjRamTestRampAndFinishSelfTest.js":
      "self-test ramp scan + final-pass boot seeding, direct-called by fillObjRamTestRamp. Not oracle-served.",
  },
  dkong: {
    // Reconciled from DEBT once the legacy-retrofit campaign dissolved dkong's dispatch seams into direct JS
    // calls. Each module below has an idiomatic twin reached by a ROUTINES-wired sibling's direct `import` +
    // JS call (or is unreached); its ROM address is never a live dispatch target, so the frozen oracle is
    // never served for it. Each was independently grounded with a positive control (addr absent from ROUTINES
    // and from loc_00ca's DISPATCH_TARGETS/every jump table; reached only by direct JS import).
    "loc_00ca.js":
      "the far-end computed-dispatch primitive: runs a resolved rst-0x28 jump-table target's installed " +
      "idiomatic override (m.overrides.get(target)(m)) and refuses an out-of-whitelist selector by name. " +
      "Direct-called as JS by four ROUTINES-wired dispatcher siblings -- dispatchInlineJumpTable (0x0028), " +
      "dispatchInGameSubstate (0x06fe), dispatchBoardClearedInterlude (0x1615), dispatchRivetBoardInterludeStep " +
      "(0x1644). Its own addr 0x00ca is never dispatched: absent from ROUTINES and every jump/rst table (0x00ca " +
      "appears only as a table-base data pointer and a return-address push in the frozen translated loc_00b5 " +
      "that the wired perFrame supersedes); no m.call(0x00ca) exists. Not oracle-served.",
    "loc_02e3.js":
      "the task-ring consumer: releases the slot, advances TASK_HEAD, switches the doubled opcode to a task " +
      "handler. In ROM reached only by mainLoop's internal jr, never a call. Direct-called as JS by sibling " +
      "mainLoop.js (the JS override for 0x02bd, which boot delegates to). addr 0x02e3 never dispatched -- absent " +
      "from ROUTINES and loc_00ca DISPATCH_TARGETS; the task ring carries opcodes, not this ROM address. Not oracle-served.",
    "loc_0400.js":
      "a colour-cycle driver with an idiomatic twin that is NEVER invoked in the live game: 0 idiomatic sibling " +
      "imports, and 0x0400 is never a dispatch target (absent from DISPATCH_TARGETS, ROUTINES, every task-ring/rst " +
      "table; CREDIT_DISPLAY_TASK=0x0400 is a packed task-word opcode, not a ROM jump). In-game the ROM at 0x0400 " +
      "runs only as the straight-line tail of loc_03fb. Positive control: equivalence-0400.test.js hooks a Machine " +
      "override at 0x0400 over a 1300-frame coin+start run and asserts count==0 (fails if ever dispatched). Unreached; not oracle-served.",
    "loc_202f.js":
      "low-X arm of the rolling-barrel fall setup: stamps the leftward per-frame 16-bit step into the motion record " +
      "and tail-calls loc_2038. Direct-called as JS by sibling advanceRollingBarrel.js. addr 0x202f never dispatched " +
      "-- absent from DISPATCH_TARGETS (a dispatch there would throw NotImplemented) and ROUTINES; reached only by direct JS import. Not oracle-served.",
    "loc_2038.js":
      "the barrel fall-arm record writer: stamps initial velocity/counters/ARM_SELECT into one OBJ record and " +
      "tail-calls publishBarrelSprite. Direct-called as JS by siblings advanceRollingBarrel.js (0x1ff6, wired) and " +
      "loc_202f.js; live reach all JS: advanceBarrelMotion(0x1f93,wired) -> stepBarrelLeft/Right(wired) -> " +
      "advanceRollingBarrel(wired) -> loc_2038. addr 0x2038 absent from all dispatch tables and ROUTINES. Not " +
      "oracle-served (the equivalence-2038 'attract dispatches' are oracle-corpus captures, not live).",
    "loc_2079.js":
      "the retire-record arm of the 25m barrel sweep: zeroes OBJ_ACTIVE/OBJ_X and tail-continues into " +
      "publishBarrelSprite. Direct-called as JS by sibling loc_2053.js, reached by direct JS import through " +
      "serviceBarrelSlotIfLive(0x1f83) -> advanceBarrelMotion(0x1f93) -> loc_2053(0x2053). addr 0x2079 never " +
      "dispatched -- absent from ROUTINES and DISPATCH_TARGETS; no 0x2079 literal in the non-test idiomatic layer. " +
      "The dispatch seam was dissolved to a direct call (equivalence-2079 skipped, recorded). Not oracle-served.",
    "loc_2083.js":
      "the girder-contact sub-state machine of the barrel sweep: advances the step counter, runs steps 1/2 " +
      "(loc_20a2/loc_20c3), then publishes the walk-select and hands to publishBarrelSprite. Direct-called as JS by " +
      "sibling loc_2053.js (the wired arc-travel override reached from advanceBarrelMotion). addr 0x2083 never " +
      "dispatched-to-oracle: not in ROUTINES/the override map, not in DISPATCH_TARGETS; the only m.call(0x2083) is " +
      "in the frozen translated loc_2053 (unused live); a 2000-frame probe recorded routines.get(0x2083)=0 while " +
      "logging 10201 dispatches elsewhere. Not oracle-served.",
    "loc_20a2.js":
      "the barrel arm that, when an airborne object's fall is arrested, decides whether it turns and hands the " +
      "record to loc_20b5 or loc_20c3. Direct-called as JS by sibling loc_2083.js (step==1); chain all direct JS: " +
      "advanceBarrelMotion(0x1f93,wired) -> loc_2053(0x2053,wired) -> loc_2083 -> loc_20a2. addr 0x20a2 never " +
      "dispatched -- absent from DISPATCH_TARGETS and ROUTINES; no live m.call(0x20a2). The equivalence-20a2 " +
      "standalone-dispatch arm was retired (takes the cursor from its caller). Not oracle-served.",
    "loc_20b5.js":
      "a barrel motion arm: forwards to loc_20e1 if the whole-pixel step byte is nonzero, else writes a 1px/frame " +
      "leftward step and falls into loc_20c3. Direct-called as JS by sibling loc_20a2.js; live reach " +
      "advanceBarrelMotion -> loc_2053(wired) -> loc_2083 -> loc_20a2 -> loc_20b5, all direct JS. addr 0x20b5 never " +
      "dispatched -- absent from DISPATCH_TARGETS and ROUTINES, so m.overrides.get(0x20b5) is undefined; invoked only " +
      "as the JS call loc_20b5(m,cur). Not oracle-served.",
    "loc_20c3.js":
      "reflects an object's vertical arc at a quarter speed, restarts from a whole-pixel position, tails into " +
      "publishBarrelSprite. Direct-imported + JS-called by 4 siblings in the OBJ_ARRAY_67 sweep: loc_2083, loc_20a2, " +
      "loc_20b5, loc_20e1 (chain rooted at the wired loc_2053). addr 0x20c3 never dispatched -- absent from all " +
      "dispatch tables and ROUTINES; the only m.call(0x20c3) sites are frozen translated siblings unused live. Not oracle-served.",
    "loc_20e1.js":
      "the rightward arm of the barrel launch: writes +1.0px/frame horizontal velocity and tail-calls loc_20c3. " +
      "Direct-called as JS by sibling loc_20b5.js; subtree all direct JS off wired roots serviceBarrelSlotIfLive" +
      "(0x1f83) -> advanceBarrelMotion(0x1f93) -> loc_2053(0x2053) -> loc_2083 -> loc_20a2 -> loc_20b5 -> loc_20e1. " +
      "addr 0x20e1 absent from names.js entirely (so not in ROUTINES or DISPATCH_TARGETS); a dispatch there would " +
      "throw, yet the game runs. Not oracle-served.",
    "loc_29af.js":
      "resolves an airborne Mario overlapping a moving object in board 3's array: runs the loc_2a22 overlap search " +
      "and judges land/die/side-on. Direct-called as JS by sibling loc_2b1c.js (a ROUTINES-wired dispatch target " +
      "0x2b1c reached via loc_1c05). addr 0x29af never dispatched -- absent from DISPATCH_TARGETS, from every _ADDR " +
      "constant in names.js, and from the loc_02e3 task table; grep finds 0x29af only in loc_2b1c's direct import/call. Not oracle-served.",
  },
};

/**
 * DEBT: modules ALREADY unwired the first time this guard ran for a game. Recorded, not blessed --
 * a temporary allowlist that a game must empty (each entry wired into ROUTINES or reconciled into
 * UNWIRED with a not-oracle-served reason) before it can be DONE.
 *
 * dkong's block (12 modules) was CLEARED 2026-09-24: the legacy-retrofit campaign dissolved its
 * dispatch seams into direct JS calls, and each module was independently grounded (positive control:
 * its ROM address is never a live dispatch target) and moved into UNWIRED.dkong above. No game
 * currently carries wiring debt.
 *
 * Checked as a SUBSET: a new one fails, removing an old one does not. Re-derive, never hand-edit.
 */
export const DEBT = {};
