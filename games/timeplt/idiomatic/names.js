// SPDX-License-Identifier: GPL-3.0-only

/**
 * Time Pilot names: the single source for every named address -- work RAM, video and sprite RAM,
 * I/O ports and ROM tables -- plus the ROUTINES table of named entry points. Code imports these
 * rather than using raw hex.
 *
 * ★ PROVENANCE / CONFIDENCE. A wrong name is worse than a neutral hex address, so every name
 * carries an evidence tag saying HOW its role is known:
 *   [seen]  — observed under MAME: this address was watched and its role confirmed.
 *   [code]  — the evidence tag for a role understood from the routines that touch it, consistently
 *             across them; not observed.
 *   [guess] — the evidence tag for one plausible reading, not confirmed; treat as a hint and verify.
 *   keep-hex — no confident name: no const, or a loc_<addr> placeholder.
 * The pixel gate, not the name, remains the correctness authority.
 */

/**
 * INNER index of the two-level sequence machine. [seen]
 *
 * One reader masks this to its low nibble and dispatches through a word table on the result, so
 * it is an index rather than a count. One routine's only job is to increment it; another clears
 * it to restart the sequence. Under MAME every phase's dispatcher reads it as its sub-step index,
 * attract and play alike.
 */
export const SEQUENCE_SUBSTEP = 0xa9ac;

/**
 * OUTER phase of the same two-level machine: the machine's top-level MODE. [seen]
 *
 * The vblank service masks this to its low two bits and dispatches a jump table on the result;
 * inside those arms the inner index is consumed with several different masks,
 * which is what a per-phase table size looks like. Every phase-entry site writes the pair in one
 * idiom -- set this to a small constant, zero the inner one -- and the routine that steps this is
 * that same idiom with an increment in place of the store.
 *
 * Four values occur and no more. Watched under two independent MAME captures: 0 is the boot wipe,
 * 1 the attract sequence, 2 the credit / push-start state, and 3 the round engine.
 *
 * ★ Phase 3 is NECESSARY for play and NOT SUFFICIENT: the attract demo runs the same round engine
 * with the play flag clear, so the demo executes real game logic rather than replaying a recording.
 * Anything treating this cell alone as a play detector counts the demo as a game -- and the demo
 * is where most attract-mode dispatches come from, so that error silently corrupts any dispatch
 * attribution keyed on it.
 *
 * It is also routed through several ROM checksums whose trailing constants net to zero on a
 * genuine image, so a patched ROM corrupts the phase instead of failing cleanly. Same cell, same
 * meaning, booby-trapped.
 */
export const SEQUENCE_PHASE = 0xa9ab;

/**
 * Mirror of the IN0 input port, rewritten every frame from the port itself. [seen]
 *
 * The vblank service reads the port, complements it (the hardware is active-low) and stores the
 * result here, unconditionally — so this cell reflects what the panel is asserting, not what the
 * machine decided to do about it. Bit 0 is coin 1, bit 3 is 1-player start; watched under a
 * capture, it carries exactly the bits a driven tape held, for exactly the frames it held them.
 * Because the write is unconditional, a non-zero value proves a button was down and nothing more.
 */
export const IN0_MIRROR = 0xa9ae;

/**
 * Coin-counter pulses the machine still OWES the mechanical counter. [seen]
 *
 * Reads zero for the whole of an undriven run, and goes non-zero on the frame a driven coin is
 * taken, holding for a short spell before clearing. Unlike the port mirror this is downstream of
 * the machine's own decision: a debounce has to see idle-then-pressed before this is bumped.
 *
 * It is a COUNT, not a boolean — two coins in quick succession take it to two — and the pulse
 * driver decrements it as each solenoid pulse finishes.
 *
 * ★ What it does NOT mean: that a credit was banked. Credits live in a different, BCD cell and
 * are reached only after the coinage arithmetic, so on any setting that charges more than one coin
 * per credit these two diverge.
 */
export const COIN_ACCEPTED = 0xa981;

/**
 * The two coinage DIP settings, as the machine sees them: the complement of the DSW0 port. [seen]
 *
 * The boot path reads the port, complements it (the switches are active-low) and stores the result
 * here, then unpacks it. The low nibble is the setting MAME's own port definition for this driver
 * labels Coin A and the high nibble the one it labels Coin B, and forcing the port to a value under
 * MAME moves this cell to that value's complement.
 */
export const COINAGE_SETTINGS = 0xa9b1;

// ── Coin/credit pipeline. Two symmetric slots: each debounces its IN0 coin line through a shift
// register, accumulates +0x10 per coin until it crosses that slot's BCD coinage RATIO, then folds
// credits into the shared packed-BCD CREDIT_COUNT; a per-slot ACCEPTED count drives the mechanical
// coin counter (an LS259 line) through a pulse-width TIMER. IN0 bit 2 (service) awards one credit.
export const COIN_ACCEPTED_SLOT_2 = 0xa982; // slot-2 twin of COIN_ACCEPTED (0xa981) [seen]
export const SERVICE_CREDIT_DEBOUNCE = 0xa983; // IN0 bit-2 (MAME 'Service 1') debounce; a clean edge awards one credit [seen]
export const COIN_PULSE_TIMER_SLOT_2 = 0xa985; // slot-2 twin of COIN_PULSE_TIMER (0xa984) [seen]
export const CREDIT_COUNT = 0xa986; // packed-BCD on-screen credit total (saturates at 0x99) [seen]
export const COIN_SLOT_1_DEBOUNCE = 0xa9c7; // slot-1 coin-line debounce shift register [seen]
export const COIN_SLOT_1_ACCUMULATOR = 0xa9c8; // slot-1 coins-inserted accumulator (+0x10/coin vs COIN_SLOT_1_RATIO 0xa9c9) [seen]
export const COIN_SLOT_2_DEBOUNCE = 0xa9ca; // slot-2 coin-line debounce shift register [seen]
export const COIN_SLOT_2_ACCUMULATOR = 0xa9cb; // slot-2 accumulator (+0x10/coin vs COIN_SLOT_2_RATIO 0xa9cc) [seen]

// ── DSW1 gameplay config, unpacked bit-by-bit at boot (the coinage half is COINAGE_SETTINGS above).
export const STARTING_LIVES = 0xa9c1; // lives per game (3/4/5/0xff), loaded into PLAYER_ONE/TWO_LIVES at start [seen]
export const UPRIGHT_CABINET = 0xa9c2; // cabinet type from DSW1 'Cabinet' (bit 2), seeded at 0x2E22: 1 = upright (MAME default), 0 = cocktail; the frame service turns the screen round for player two only when it reads 0 [seen]
export const BONUS_LIFE_SETTING = 0xa9c3; // selects the bonus-life mark list + the attract bonus captions [seen]
export const DEMO_SOUNDS_ENABLE = 0xa9c6; // attract-sound gate: a queued request is dropped unless set or a game is active [seen]

// ── Per-frame inverted port mirrors, latched each vblank alongside IN0_MIRROR/COINAGE_SETTINGS. [seen]
export const DIP1_MIRROR = 0xa9ad; // inverted mirror of DSW 0xC200 (the gameplay dip bank) [seen]
export const IN1_MIRROR = 0xa9af; // inverted mirror of IN1 0xC320 (main / player-1 controls) [seen]
export const IN2_MIRROR = 0xa9b0; // inverted mirror of IN2 0xC340 (cocktail / player-2 controls) [seen]

// ── Cursors and counters that sit in this address range but belong to other subsystems.
// (The general scratch-pointer pair 0xA991/0xA993 is SCRATCH_PTR_A / SCRATCH_PTR_B, further down.)
export const COMMAND_WRITE_CURSOR = 0xa9b2; // write index into the 64-cell COMMAND_RING, stepped two cells per posted pair (reader: COMMAND_READ_CURSOR) [seen]
export const BCD_FRAME_COUNTER = 0xa9ce; // free-running packed-decimal frame counter (inc+daa each vblank) [seen]
export const SCRIPT_CYCLE_COUNTER = 0xa9cf; // 0..4 round-robin index for in-turn demo-script selection [seen]
export const ATTRACT_STAGE_COUNTER = 0xa9d0; // attract-demo counter cycling 1->2->3->1; each demo starts in that era (PLAYER_ONE_ERA_INDEX) and round (+1) [seen]

/**
 * Set while the cabinet is on free play, so a coin never has to buy a credit. [seen]
 *
 * Raised to all-ones by the coinage unpack when EITHER coin setting reads free play; that unpack
 * is its only writer and every other site reads it -- the sharpest being the tail of the coin-accept
 * path, which skips the whole credit arithmetic while this is non-zero.
 * Watched under MAME across eight forced DSW0 values it read
 * all-ones for exactly the three where a nibble was set to free play and zero for the other five.
 */
export const FREE_PLAY = 0xa9c0;

/**
 * What coin slot 1 charges: coins-required-minus-one in the high nibble, credits in the low. [seen]
 *
 * Written once at boot from the low nibble of COINAGE_SETTINGS through a sixteen-entry table, and
 * read by the accept arm that debounces the coin-1 bit of IN0_MIRROR: that arm steps an accumulator
 * by 0x10 per coin and returns until it reaches this byte's high nibble, then adds this byte's low
 * nibble to the BCD credit count. So the two nibbles are coins and credits, not one packed number.
 *
 * Forced under MAME, it carried exactly the pair MAME's own label gives the setting -- one coin for
 * one credit as 0x01, two coins for one as 0x11, two for three as 0x13, three for two as 0x22, four
 * for three as 0x33 -- and it followed its own nibble while the other nibble moved independently.
 */
export const COIN_SLOT_1_RATIO = 0xa9c9;

/**
 * The same for coin slot 2, from the OTHER nibble. [seen]
 *
 * Same encoding, same table, same grounding run; the arm that reads it is the one debouncing the
 * coin-2 bit, and it keeps its own accumulator. The two slots are independent: a run with one
 * nibble at free play and the other at one-coin-one-credit moved only its own destination.
 */
export const COIN_SLOT_2_RATIO = 0xa9cc;

/**
 * Flag set while play is active. [seen]
 *
 * A true boolean rather than a value: the start routines store all-ones into it (`ld a,0xff`, or
 * `dec a` from zero); restartAttractSequence and the attract-demo start
 * (verifyImageSignatureThenStartAttractDemoOrDerail) clear it with `xor a`; readers branch on
 * zero / non-zero.
 * Watched under captures it reads zero for the whole of two undriven runs totalling
 * over five thousand frames, goes all-ones on the frame a driven start press lands, and holds
 * for every remaining frame.
 *
 * SCOPE, since the obvious readings differ: it spans a whole CREDIT, not a life and not a round.
 * Watched through a driven game to game over, it stayed set across every life lost and cleared
 * only at teardown.
 *
 * ★ It is also the ONLY thing separating real play from the attract DEMO, because the demo runs
 * the same round engine with this flag clear. Anything that infers "a game is being played" from
 * the sequence phase alone counts the demo as a game.
 */
export const PLAY_ACTIVE = 0xad30;

/**
 * Pulses coin slot 1's mechanical counter still owes, counted down one frame at a time. [seen]
 *
 * Loaded to 48 when a pulse begins, and the counter line is driven high in the same breath; the
 * line is released at the half-way count of 24; at zero the routine takes one off COIN_ACCEPTED and
 * the next owed pulse starts on the following frame. So this cell is the pulse's phase, and its
 * period is what fixes the solenoid's on-time.
 *
 * Watched under MAME with a write tap over a driven game, the only two program counters that wrote
 * it were the pulse driver's own load and its own decrement -- 240 decrements over five coins,
 * which is 48 apiece. Undriven, it took no write at all.
 *
 * Slot 2 keeps its own cell one address on, driven by a byte-identical twin routine.
 */
export const COIN_PULSE_TIMER = 0xa984;

/**
 * How much longer a hit still counts as part of the current chain. [seen]
 *
 * Reloaded to 30 by every scoring post and counted down once per dispatch of the round engine's
 * service block -- which is NOT once a frame, so the window is 30 of those ticks and not half a
 * second. While it is non-zero the next hit climbs the award ladder; once it empties the ladder is
 * reset through CHAIN_STEP.
 *
 * Watched under MAME the cell took writes from three program counters, all inside the poster and
 * the routine that expires the chain. Its observed values run 0x00 to 0x1E and no higher.
 */
export const CHAIN_WINDOW = 0xa99d;

/**
 * Which rung of the chained-hit award ladder the next hit will be paid at. [seen]
 *
 * Stepped by the poster while CHAIN_WINDOW is alive and used, masked to three bits and incremented,
 * as the argument of the scoring command -- so the ladder wraps rather than caps. Cleared by the
 * routine that expires the chain, on every frame after the window has emptied rather than on the
 * frame it empties.
 *
 * Two writers, both watched under MAME. Its observed values reached 0x0C, past the eight rungs,
 * which is consistent with the mask rather than with a bounded count.
 */
export const CHAIN_STEP = 0xa99e;

/**
 * The escalation rung inside the current era: the low nibble of the (era << 4) + rung index. [seen]
 *
 * ERA_INDEX supplies the high nibble; this is the low one, selecting one of sixteen rows per era in
 * the settings table applyEraRungSettings scatters. It is seeded per life
 * from a per-player cell, bumped each time the rung timer expires, and clamped at fifteen -- so it
 * climbs while a life lasts and then stops.
 *
 * Watched under MAME it took writes from two program counters, the seed and the bump. It climbed
 * 0 to 5 over an attract run without ever reaching the clamp,
 * and each bump was followed by the routine that applies the row, whose twelve destinations then
 * took a monotone ladder of values -- which is what makes this a difficulty rung rather than a
 * cosmetic index.
 */
export const ERA_RUNG = 0xacc0;

/**
 * Per-round enemy-craft quota: how many craft a round should field. [seen]
 *
 * Written by the era/rung settings scatter from row byte 4 (resetPlayfieldAndArmNewRound and
 * applyEraRungSettings), and read as the spawn loop bound wherever craft are launched --
 * driveEnemyWaveForLifePhase, spawnEnemyWaveIntoFreeSlots, gateTheFreeSlotSearchAndPickItsRun,
 * spawnEnemyCraftWhenBandUnderTwo. A spawner takes its count from here until the kill quota is spent
 * (in the era-four spawner, until the Mother-Ship is armed), then falls back to a fixed five.
 */
export const ROUND_CRAFT_COUNT = 0xacc1;

/**
 * Descriptor-table selector for the current inline wave: (2 * era) + a random parity bit. [seen]
 *
 * driveEnemyWaveForLifePhase computes it as 2*ERA_INDEX + one drawn bit, then multiplies by sixteen to
 * stride into the wave descriptor table at 0x397b (two-byte entries, one consumed per filled slot), so it
 * picks one of two shape/formation rows per era. Routine-local scratch that happens to live in RAM.
 */
export const WAVE_DESCRIPTOR_INDEX = 0xacc3;

/**
 * Per-round threshold that decides how each spawning craft's movement script is chosen. [seen]
 *
 * Written by the era/rung config scatter from record byte 5, and read only by pickScriptAtRandomOrInTurn:
 * a random draw at or above this value yields a random script from a small band, a draw below it yields the
 * next entry of a round-robin cycle. A higher threshold biases toward the ordered cycle.
 */
export const SCRIPT_PICK_THRESHOLD = 0xacc4;

/**
 * Nonzero while a round / Mother-Ship transition is underway. [seen]
 *
 * Cleared when a round arms (resetPlayfieldAndArmNewRound, startNextRound) and when the field clears
 * in the demo (advanceRoundWhenFieldCleared reloads it from ROM byte 0x07D1, which is 0x00). Raised
 * by the Mother-Ship's destruction countdown: 0xFE at the formation rebuild one step in, 0xFF at the warp/flash finish
 * (both in loc_43f0). While it is set, driveEnemyWaveForLifePhase returns at once,
 * fireAndSweepPlayerShots only sweeps (no new shots), armMotherShipOrStep stands down on 0xFF but not
 * 0xFE, and a lost life goes straight to the next round (loseLifeAndHandOver). The round advances only
 * when this is set, the kill quota is spent and the object band is empty.
 */
export const ROUND_TRANSITION_HOLD = 0xacc6;

/**
 * How many more qualifying kills until the current wave's shared claim fires. [seen]
 *
 * The inline wave builder tallies filled slots into this cell, then -- unless five or more slots filled, in
 * which case the tally itself stands -- overwrites it with ROUND_CRAFT_COUNT; from then on
 * countTheKillAndGrantTheSharedToken decrements it once per kill whose object cleared the claim guards, and the
 * kill that brings it to zero writes the winning slot ordinal into CLAIM_TOKEN. So the stored value is a
 * per-wave kill countdown, not a frame timer -- its builder-side fill tally and its claim-side countdown are
 * the same physical cell, filled while spawning then counted down.
 */
export const WAVE_KILL_COUNTDOWN = 0xa811;

/**
 * Frame-countdown window during which a spawned wave's shared claim is armed. [seen]
 *
 * Preloaded to 0xE4 whenever a wave spawns (both the inline builder and the era-four/boss spawner), and wound
 * down one per vblank alongside the other frame timers. Its numeric value is never compared against a
 * threshold -- the only reader beyond the tick treats nonzero as "wave live, claim armed" -- so the 0xE4 seed
 * is a time budget: roughly how long after a wave spawns the last-of-wave kill can still be claimed.
 */
export const WAVE_CLAIM_TIMER = 0xa812;

/**
 * The shared "last of the wave" token, holding one claimant at a time. [seen]
 *
 * The kill that empties WAVE_KILL_COUNTDOWN writes its own slot ordinal here with the top bit set; driveObjectAppearanceByPhaseBand
 * keeps alive whichever object's record number matches the low seven bits -- a "named request" -- holding a
 * fixed shape and tint, and on its first phase posts a command and clears this cell, so the token is consumed
 * exactly once. Its writer-side (holder) and reader-side (request) views are the same cell.
 */
export const CLAIM_TOKEN = 0xa821;

/*
 * Write-only, no reader, so no role is earned (both named further down):
 *   0xACC2  WAVE_SPAWN_BUSY_FLAG -- 0xFF across the inline wave-build loop, 0 after (driveEnemyWaveForLifePhase).
 *   0xACC5  SPAWN_CLEARED_SPARE_BYTE -- written 0 when a free slot is stocked (spawnEnemyIntoFreeSlotElseStepSearch).
 */

/**
 * How many wraps of the base-sixty counter one rung of ERA_RUNG lasts. [seen]
 *
 * Written once, from a program byte, and read only to reload ERA_RUNG_TIMER. Watched under MAME it
 * took a single write in a whole run.
 */
export const ERA_RUNG_PERIOD = 0xa9d6;

/**
 * Wraps of the base-sixty counter still to go before ERA_RUNG climbs again. [seen]
 *
 * Seeded from ERA_RUNG_PERIOD at life start and again on every expiry, and stepped down once per
 * wrap of LIFE_TICKS_LOW rather than once per frame. Watched under MAME its step count matched that
 * cell's wrap count and the rung bumps came at the expected spacing.
 */
export const ERA_RUNG_TIMER = 0xa9d7;

/**
 * Low place of a three-place base-sixty counter, stepped once per dispatch of the round engine's
 * per-frame service block. [seen]
 *
 * ★ IT IS NOT A CLOCK, and reading it as one is the trap this comment exists to stop. The service
 * block runs only in the round phase and not on every frame of it, so sixty steps of this cell took
 * 84, 95, 120 and 140 frames on four different tapes -- a factor of 1.7. It measures work done by
 * the round engine, not time.
 *
 * Zeroed by the routine that starts a life. Its packed-decimal shape is observed: under a MAME write
 * tap it took values 00-09, 10-19, 20-29, 30-39, 40-49, 50-59 and the pre-wrap 60, and no other.
 * A reader elsewhere splits it into its two digits and uses the low one as a round-robin slot index,
 * so the digits are load-bearing and not merely display.
 */
export const LIFE_TICKS_LOW = 0xad05;

/**
 * Middle place of that counter, stepped once per wrap of LIFE_TICKS_LOW. [seen]
 *
 * The carry is one-to-one: watched under MAME, this cell's step count equalled the low place's wrap
 * count exactly, in every run. Zeroed together with the high place, as a word, by the life-start
 * routine.
 */
export const LIFE_TICKS_MID = 0xad06;

/**
 * High place of that counter, stepped once per wrap of LIFE_TICKS_MID. [seen]
 *
 * The chain's third place. It is reached only through a pointer walk, so the address appears in no
 * instruction operand anywhere in the image. Natural tapes never carried the middle place past
 * 0x55, but with LIFE_TICKS_MID seated at 0x59 in a poked capture, advanceSexagesimalDigit wrapped
 * the middle place 0x60->0x00 and stepped this cell 0x00->0x01 under MAME.
 */
export const LIFE_TICKS_HIGH = 0xad07;

/**
 * How many rescue awards this life has already been paid, which is the rung the next one takes. [seen]
 *
 * Read before it is stepped, so the first award of a life is paid at the bottom rung. The first four
 * rungs each select their own value; every rung after them takes the same top value.
 *
 * Watched under MAME with a write tap it took the values 1, 2 and 3 from the award poster's step and
 * was reset by the life-start routine -- five times on one tape and ten on another -- which is what
 * fixes the scope as a life rather than a round or a credit.
 *
 * ★ There is a THIRD writer and it is easy to miss: a bulk clear over the block this address sits
 * in appeared in the same write tap. A claim that the poster and the life-start reset are its only
 * writers is false.
 */
export const PARACHUTIST_RUNG = 0xa8f7;

/**
 * A copy of one character cell's glyph, taken so the anti-tamper machinery can check later that the
 * display still says what it should. [seen]
 *
 * Written at three sites, all with the glyph code 0x7C: two copy it out of the character cell
 * TAMPER_GLYPH_SOURCE_CELL 0xA67C (the copyright hold and the three-cell tile-map copy), and the
 * attract screen's patch list seeds it directly. Guards then compare the live cell against this
 * copy, or this copy against that glyph as a literal, and divert into data when they disagree. Two
 * guard sites were watched reading it under MAME; that the code holds three is a code-level count.
 * It is the same shape as TAMPER_WITNESS on a different pair of cells.
 *
 * The cell it is copied FROM is in the character plane rather than work RAM. The caption painters
 * rewrite that cell with other glyphs during a run, but at every guard read captured under MAME it
 * held 0x7C, matching this copy, and no guard's failing arm ran.
 */
export const TAMPER_GLYPH_COPY = 0xab43;

/**
 * Whether the picture is the right way up for whoever is playing: 1 upright, 0 turned round. [seen]
 *
 * The vblank service rewrites it every frame -- 1 unconditionally, then 0 only when the active-player
 * cell is non-zero (player two's turn) AND the cabinet cell UPRIGHT_CABINET reads zero (cocktail) --
 * and hands it straight to the LS259 bit the board reports as flip-screen. Every reader reads it as
 * orientation: the sprite publish chooses between its upright and turned-round transform sets, the
 * control reader chooses which cabinet panel to hand back, and floodColourPlaneWithSavedPlayerColour
 * chooses which corner to flood from.
 *
 * Watched under MAME it takes exactly two values and no others across 29400 frames. With the Cabinet
 * dip at its default it held 1 on every frame after the first interrupt and the clearing store never
 * ran at all; with the dip at cocktail and a second player started it took 0 for 3007 frames, and the
 * sprite publish's turned-round arm went from 1 dispatch to 3008 in step.
 *
 * Three writers, and the third matters: boot clears the whole of work RAM, so the cell reads 0 --
 * "turned round" -- until the service's first store. That is why the turned-round publish arm runs
 * exactly once on a cold machine. The clear agrees with the name rather than excepting it.
 */
export const SCREEN_UNFLIPPED = 0xa987;

/**
 * Which era (the manual's ROUND) is being played, 0-4. [seen]
 *
 * The most widely read cell in the game.
 *
 * ★ It is NOT one switch. Subsystems read it against their own thresholds and therefore step at
 * different rounds: the routine that arms the player's speed splits it {0}, {1,2}, {3,4}, while the
 * scenery dispatcher splits it {0}, {1,2,3}, {4}. Anything treating "the era" as one bundle of
 * settings will predict changes that do not happen.
 *
 * Watched under MAME it advances during the attract DEMO as well as in play, which is one reason
 * the demo cannot be told from a game by watching game state alone.
 *
 * It wraps to 0 when the game loops back to the first era, so the second loop's first era runs at
 * the first loop's speed; the escalation the manual describes for later rounds lives elsewhere.
 *
 * One reader shifts this cell up by four bits and masks the low nibble away. That is not a hint of
 * hidden state -- it is building a composite index, era in the high nibble and a per-era rung in
 * the low, into a table of five eras by sixteen rungs.
 */
export const ERA_INDEX = 0xad04;

/**
 * Enemies still to destroy before the Mother-Ship appears -- the manual's 56. [seen]
 *
 * Counts DOWN. Loaded from a cell that is itself loaded once at boot from a single ROM byte whose
 * value is 56, and it is not era-keyed, loop-keyed or difficulty-keyed: the quota is the same in
 * every round of every loop on every setting. The escalation the manual describes for later rounds
 * is a different cell entirely.
 *
 * Only the ordinary enemy-craft slots decrement it -- not projectiles, not the middle-size bomber,
 * not the Mother-Ship, not the pickup -- so shooting a bullet scores without advancing the round.
 *
 * The bar along the bottom of the screen is a direct rendering of this cell, which is why nothing
 * in this game times the player: the one public source calling it a "time bar" was watching the
 * kill meter fill.
 */
export const KILLS_REMAINING = 0xad02;

/**
 * Per-frame world scroll, the component that lands in a sprite entry's NATIVE-Y byte. [seen]
 *
 * 8.8 fixed point, and it is the camera rather than any object's: one routine writes the pair once
 * a frame as the negation of the player's own velocity, and another zeroes both at life start.
 * Every site that reads this one pairs it with the same coordinate — whole part at the sprite
 * entry's `+0x31`, fraction at the object record's `+3` — and never with the other. Its magnitude
 * is era-keyed, taken from one of several ROM velocity tables, so there is no fixed scroll speed.
 *
 * ★ X AND Y HERE ARE THE NATIVE RASTER AXES, NOT THE PLAYER'S — and for this board those are not
 * the same axes. The name says which sprite-record FIELD the value lands in, which is what makes
 * it checkable on the spot beside `sprite + 49`; it makes no claim about the glass. The board is
 * ROT90 (clockwise), so native Y is the display's HORIZONTAL axis, mirrored:
 * `display_x = 239 - native_y`. A positive value here therefore slides the whole world LEFT on the
 * glass. Read as "horizontal" this name gives the right direction under the wrong axis; read as
 * screen-vertical it is simply wrong.
 *
 * Grounded under MAME by forcing this cell alone while the other stayed zero: every scenery
 * object's native Y moved at its own parallax fraction and its native X moved by exactly zero,
 * and the displayed picture shifted horizontally with no vertical component.
 *
 * ★ Prose written in DISPLAY axes calls this the horizontal — or "X" — scroll. Such a reading is
 * CROSSED against this name rather than disagreeing with it.
 */
export const WORLD_SCROLL_Y = 0xa808;

/**
 * Per-frame world scroll, the component that lands in a sprite entry's NATIVE-X byte. [seen]
 *
 * The other half of the same vector, on the same terms as WORLD_SCROLL_Y: written and zeroed by
 * the same two routines in the same breath, read by a set of sites disjoint from that cell's, and
 * always paired with the coordinate whose whole part is the sprite entry's `+0x00` byte and whose
 * fraction is the object record's `+5`.
 *
 * ★ Under the board's ROT90 native X is the display's VERTICAL axis (`display_y = native_x`), so a
 * positive value here slides the world DOWN the glass. Same grounding run, same result with the
 * axes exchanged: forcing this cell alone moved every scenery object's native X and left its
 * native Y at exactly zero, and the displayed picture shifted vertically with no horizontal
 * component.
 *
 * The structure ends here: the two words occupy 0xA808-0xA80B. The bytes flanking them —
 * 0xA803-0xA807 below, up to the live player-record fields, and 0xA80C-0xA80F above, before a
 * different structure begins — are touched by nothing but the two bulk RAM clears, in every run we
 * have watched. That is "dead in everything observed", not "provably never used".
 */
export const WORLD_SCROLL_X = 0xa80a;

/**
 * State byte of the player's own record, which begins at this address. [seen]
 *
 * 0xFF is alive; 0xF0 starts the death; 0x00 is torn down.
 *
 * Watched under MAME with a write tap that recorded the program counter of every write across a
 * driven game: the writers are the life-start routine (0xFF, twelve times), the pair that reloads
 * and counts down a death timer, three collision sweeps that store 0xF0, and one teardown storing
 * zero. Every 0xF0 was followed within a frame by the countdown reload and, at its end, by a fresh
 * 0xFF from the life-start routine — nine complete death-to-respawn cycles.
 *
 * ★ It is NOT a shot. Watched against the fire button over twelve thousand frames the cell is
 * alive on much the same share of frames whether the button is down or up, and the sprite entry
 * its record drives stays pinned at one screen position while the world scrolls past.
 *
 * ★ 0xA800 is also the base of work RAM, and several fixtures use the bare address for that —
 * a record base, a scratch cell, the start of a clear loop. Those are the address, not this cell.
 */
export const PLAYER_STATE = 0xa800;

/**
 * Frame counter, advanced once per vblank service. [seen]
 *
 * Readers take its low bits as a frame phase: to split work across alternate frames, to pace an
 * animation, or to stir the random draw. The attract-demo arm of armRoundStartThenStepSequence
 * zeroes it.
 *
 * Watched under MAME across two thousand consecutive frames after boot it advanced by exactly one
 * on every frame. During boot, before the service is running, it stands still, so it is not elapsed
 * time from power-on.
 */
export const FRAME_TICK = 0xa980;

/**
 * Lines of the character plane still to blank in the wipe now running. [seen]
 *
 * Counted down one per call by the routine that blanks a single line, which leaves the zero test
 * in the flags; the callers return early while it is non-zero, so the wipe is spread over frames
 * rather than run to completion in one. Written with the run length by the routine that starts a
 * wipe, alongside the cursor below.
 */
export const BLANK_LINES_LEFT = 0xa988;

/**
 * Where the next line of that wipe starts — a 16-bit cell address in the character plane. [seen]
 *
 * Advanced by ONE per line, not by a line's worth of cells: the routine walks a line by stepping
 * 32 cells at a time and the next line is the neighbouring cell of the first.
 */
export const BLANK_LINE_CURSOR = 0xa989;

/**
 * The command ring's CONSUMER cursor: which cell the foreground loop reads next. [seen]
 *
 * A byte offset into COMMAND_RING, stepped two on per command taken and wrapped to the ring's
 * length. Its producer twin is COMMAND_WRITE_CURSOR (0xA9B2), stepped by postCommand.
 */
export const COMMAND_READ_CURSOR = 0xa9b3;

/**
 * The 64-cell command ring: command byte and argument byte in adjacent cells. [seen]
 *
 * A cell whose high bit is set holds no command. One routine fills the whole ring with 0xFF at
 * init, the queueing routine writes a pair only into a free cell, and the foreground loop restores
 * 0xFF to both cells of a pair as it takes it.
 */
export const COMMAND_RING = 0xac00;

/**
 * A two-cell anti-tamper witness, glyph then colour, that one part of the machine seeds and another
 * verifies. [seen]
 *
 * The attract screen's patch list (armAttractScreenShowingHighScore) seeds it with glyph 0x68, and the cell after it with colour 0x05.
 * seedSceneryEntriesThenRunScenery reads it back and goes on only when it holds 0x68 and the next cell holds
 * 0x10 or 0x05; anything else jumps into data. Under MAME it is seeded and checked in every capture
 * and the check always takes the match path.
 *
 * The code holds a second writer: the failing arm of the routine that folds a block of the program
 * image would overwrite the pair with a character cell copied out of the display
 * (TAMPER_WITNESS_SAMPLE_CELL, glyph then colour). That fold comes to exactly the compared value on
 * a genuine image, and the arm never ran in any capture.
 */
export const TAMPER_WITNESS = 0xad39;

/**
 * Write pointer of the deferred character-write list, which runs from 0xAE04. [seen]
 *
 * The routine that queues a tile block appends four bytes per cell here — address low, address
 * high, glyph, attribute — stepping the pointer WITHIN its own page, so a full list wraps onto its
 * own head. The routine that drains the list reads this to learn how many entries are waiting, and
 * treats a pointer still at 0xAE04 as empty.
 */
export const DEFERRED_WRITE_CURSOR = 0xae00;

/**
 * Base of the seventeen-byte shift register the pseudo-random generator advances. [seen]
 *
 * Every draw moves the block one place along and fills the vacated head with the exclusive-or of
 * two taps, so this cell is both the newest byte and the whole register's handle. It is seeded from
 * seventeen bytes of the program image -- on a cold machine and again at each attract demo start,
 * the same seventeen bytes every time -- and nothing else writes it.
 *
 * Watched under MAME across a run covering boot, attract, the demo and a driven game, the head took
 * writes from exactly two program counters: the generator's own feedback store, and the seeder's
 * block copy. The values it took spread across the byte range with no value dominating.
 *
 * ★ Anything that pins this game's entropy pins THIS register.
 */
export const RANDOM_REGISTER = 0xab30;

/**
 * The kill quota a round is armed with: how many enemies the next round will ask for. [seen]
 *
 * Loaded once at boot from a single ROM byte and read only by the routine that starts a round,
 * which copies it into KILLS_REMAINING. It is not era-keyed, loop-keyed or difficulty-keyed, so the
 * quota is the same in every round of every loop on every setting.
 *
 * Watched under MAME for a run covering boot, attract, the demo and a driven game it took exactly
 * one write -- at boot, value 0x38, which is 56.
 */
export const KILL_QUOTA = 0xa9cd;

/**
 * How many more hits the big two-slot object can absorb before it dies. [seen]
 *
 * Counts DOWN, and the routine that receives a hit is what fixes the role: if this cell is non-zero
 * it decrements it, puts the object's state back to alive, requests a sound and returns the object
 * to its live handler -- the hit is ABSORBED. Only when the cell is already zero does that routine
 * fall through to the explosion and the retire. So an object armed with 3 takes four hits, which is
 * the count the manual gives for the second era's bomber.
 *
 * ★ It is also what the object LOOKS like. The second era's dresser reads it as `3 - cell` to pick
 * one of four shape blocks, so the sprite shows its damage; and the ram path zeroes it, which is
 * why ramming kills outright instead of costing one hit.
 *
 * Watched under MAME it was armed to 3 by one routine and walked down 2, 1, 0 by the absorb path.
 * That capture reached only the first two eras, so the values seen are 0-3; whether a later object
 * arms it higher is not established. Besides the game's own stores, power-on clears the whole of
 * work RAM (0xA800-0xAFFF, the `ldir` at 0x0091), and the attract setup clears two narrower blocks
 * again behind a test of the play flag, skipped exactly when a credited game begins.
 */
export const HITS_REMAINING = 0xa8dc;

/**
 * Which round is being played, counting on without wrapping. [seen]
 *
 * ★ NOT the same thing as ERA_INDEX, and the difference is the whole reason this cell exists. The
 * era is this count wrapped to five; this one keeps going, which is what lets the game get harder
 * on the second lap through the same five eras. Stepped once per completed round by the routine
 * that starts one, and read three ways that only make sense of an unwrapped ordinal: bracketed
 * against 6 and 11 to pick the round's difficulty byte, compared against 100, and passed as the
 * argument of a ring command whose handler decomposes a value into counts of thirty, ten, five and
 * one.
 *
 * It is per player. Watched under MAME it is written by the sixteen-byte context copy that swaps a
 * player's block into 0xAD00, which seeded it to 2 for the attract demo and 1 for a real game, and
 * stepped by startNextRound's own increment at 0x2DBB -- naturally in deep play, and in poked
 * round-clear captures that carried it past five.
 */
export const ROUND_NUMBER = 0xad01;

/**
 * Address -> routine module. A routine absent from this table is never dispatched.
 *
 * `name` IS the filename (`./<name>.js`), one-to-one. `entry` overrides the export name only
 * where a routine is deliberately a pure function of its inputs rather than a `fn(m)`.
 * `cert` uses the same evidence vocabulary as the cell names above.
 */
/**
 * Two routines retire an object -- retireSlot and retireSlotAndSubPixel -- and a third site inlines
 * the same stores. No file calls more than one, so they are per-family helpers rather than versions
 * of one. The difference is that retireSlotAndSubPixel also clears the sub-pixel remainders. Whether
 * that is observable depends on the spawn path: some reinitialise those cells immediately after
 * marking a slot live, others have not been shown to.
 *
 * OPEN: whether the two families were meant to differ here, or whether this is two habits. Code
 * cannot settle it.
 */
/**
 * Which of the two players is up: 0 for player one, 1 for player two. [seen]
 *
 * A one-bit index and the whole of the two-player machinery. Everything that is per player is
 * reached through it: the sixteen-byte context block copied in and out at 0xAD00, the score triple
 * (0xAD33 or 0xAD36), the score drawer, and the caption the game announces a turn with.
 *
 * Three writers, and the ROM and the machine agree on which three. A decode from every byte offset
 * of the whole image finds exactly three instructions that store here; a MAME write tap with
 * program-counter attribution, over 600 s of two-player play, recorded eleven writes from exactly
 * those three -- handPlayOverToOtherPlayer's flip, the game-over teardown that clears it alongside
 * the play flag, and the new-game init that clears it alongside both save blocks. It never held a
 * value other than 0 or 1. (Boot's clear of all work RAM is a fourth writer no tap can see; it
 * writes zero, which is consistent.)
 *
 * ★ Its POLARITY is grounded, not assumed. A one-player start arms PLAYER_ONE_LIVES and leaves
 * PLAYER_TWO_LIVES at zero, and this cell stays 0 for the whole game; the save and the restore both
 * map 0 to the first block; and the caption posted on 0 spells the digit one where the caption
 * posted on 1 spells two.
 */
export const ACTIVE_PLAYER = 0xad32;

// ── Scoring. Each player's score is three packed-BCD bytes, low byte first. Awards add at the LO end;
// the display and the high-score compare read from the HI end (the most significant byte).
export const PLAYER1_SCORE_LO = 0xad33; // player 1 score, low packed-BCD byte (tens/units; stays 00, every award is a multiple of 100); awards add here first [seen]
export const PLAYER1_SCORE_MID = 0xad34; // player 1 score, middle packed-BCD byte (thousands/hundreds) [seen]
export const PLAYER1_SCORE_HI = 0xad35; // player 1 score, high packed-BCD byte (hundred-thousands/ten-thousands); the display, bonus-life and high-score compares start here [seen]
export const PLAYER2_SCORE_LO = 0xad36; // player 2 score, low packed-BCD byte (tens/units; stays 00, every award is a multiple of 100); awards add here first [seen]
export const PLAYER2_SCORE_MID = 0xad37; // player 2 score, middle packed-BCD byte (thousands/hundreds) [seen]
export const PLAYER2_SCORE_HI = 0xad38; // player 2 score, high packed-BCD byte (hundred-thousands/ten-thousands); the display, bonus-life and high-score compares start here [seen]

// ── High score. HIGH_SCORE_HI is the MSB of the single displayed high score (0xA98B/8C/8D), seeded at
// boot and promoted when a game beats it. The high-score TABLE is five records of eight bytes at
// 0xAB08..0xAB2F: per record +0 rank, +1..+3 score lo/mid/hi, +4..+6 initials, +7 a 0xF1 pad. A new
// score inserts top-first and the records below it slide down (lddr) from SLIDE_SRC toward TABLE_END.
export const HIGH_SCORE_HI = 0xa98d; // MSB of the single displayed high score (0xA98B/8C/8D): seeded 01 from ROM 0x08C9 at boot (pc 0x52AD), promoted by the lddr at 0x0CD5 when a score beats it [seen]
export const HIGH_SCORE_TABLE_BASE = 0xab08; // base of the five 8-byte high-score records (+0 rank, +1..+3 score lo/mid/hi, +4..+6 initials, +7 0xF1 pad) [seen]
export const HIGH_SCORE_REC0_SCORE_HI = 0xab0b; // record 0 score high byte (rank +0, score lo/mid/hi +1..+3): the insertion compare's starting point [seen]
export const HIGH_SCORE_REC1_BASE = 0xab10; // record 1 base (rank byte) [seen]
export const HIGH_SCORE_REC2_BASE = 0xab18; // record 2 base (rank byte) [seen]
export const HIGH_SCORE_REC3_BASE = 0xab20; // record 3 base (rank byte) [seen]
export const HIGH_SCORE_SLIDE_SRC = 0xab27; // top source byte (record 3's +7 pad byte) of the lddr that slides the records below an inserted score down one record [seen]
export const HIGH_SCORE_REC4_BASE = 0xab28; // record 4 base (rank byte) [seen]
// The 5 high-score readout CURSORS (VRAM tile-plane write positions), one per record, paired with the
// HIGH_SCORE_REC*_BASE sources by paintFiveLabelledNumericReadouts.
export const HIGH_SCORE_REC0_CURSOR = 0xa711; // high-score record-0 readout start cell (VRAM tile-plane write position) paired with HIGH_SCORE_REC0_BASE by paintFiveLabelledNumericReadouts [seen]
export const HIGH_SCORE_REC1_CURSOR = 0xa713; // high-score record-1 readout start cell (VRAM tile-plane write position) paired with HIGH_SCORE_REC1_BASE by paintFiveLabelledNumericReadouts [seen]
export const HIGH_SCORE_REC2_CURSOR = 0xa715; // high-score record-2 readout start cell (VRAM tile-plane write position) paired with HIGH_SCORE_REC2_BASE by paintFiveLabelledNumericReadouts [seen]
export const HIGH_SCORE_REC3_CURSOR = 0xa717; // high-score record-3 readout start cell (VRAM tile-plane write position) paired with HIGH_SCORE_REC3_BASE by paintFiveLabelledNumericReadouts [seen]
export const HIGH_SCORE_REC4_CURSOR = 0xa719; // high-score record-4 readout start cell (VRAM tile-plane write position) paired with HIGH_SCORE_REC4_BASE by paintFiveLabelledNumericReadouts [seen]
export const HIGH_SCORE_TABLE_END = 0xab2f; // inclusive top of the high-score table (record 4's +7 0xF1 pad byte, after its three initials); the slide lddr's destination start [seen]

/**
 * Lives the ACTIVE player has left, in the live context block. [seen]
 *
 * Counts DOWN, and reaching zero is what ends that player's turn rather than the game: the routine
 * that decrements it branches away to the teardown path only when the decrement made it zero.
 *
 * Watched under MAME with a program-counter write tap through a 600 s two-player game it took 22
 * writes from exactly three instructions, and the three between them ARE the life cycle: the
 * decrement taken on a death, the sixteen-byte context copy that swaps a player in, and an
 * increment inside the routine that awards an extra life at a score mark. Nothing else wrote it.
 * (Boot's clear of all work RAM is the fourth writer, and no tap can see it.)
 *
 * ★ What the player SEES is this value minus one -- the reserve display is posted as a ring command
 * whose argument is read here and decremented first, both where the count changes and where a
 * context is swapped in. A reader who matches the cell against the ships on the glass will be off
 * by the one in the air.
 */
export const LIVES_REMAINING = 0xad00;

/**
 * Player one's lives, in their saved sixteen-byte context block at 0xAD10. [seen]
 *
 * The block is a mirror of the live one at 0xAD00, and this is its first byte. It is written by the
 * save copy taken when a life is lost, by whichever start path armed the game, and by nothing else
 * in a watched run; it is read directly by the routine that refuses to start a new game while
 * either player still has lives, and by the hand-over test that asks whether the other player has
 * any left.
 *
 * Grounded by the pair of runs that differ only in which start button is pressed: a ONE-player
 * start put the starting count here and zero in PLAYER_TWO_LIVES, a two-player start put the count
 * in both. That, with ACTIVE_PLAYER's polarity, is what makes this one PLAYER ONE's and not merely
 * the first of two.
 */
export const PLAYER_ONE_LIVES = 0xad10;

/**
 * Player two's lives, in their saved context block at 0xAD20 -- the same byte, the other block. [seen]
 *
 * Same writers, same readers, same grounding run. It is ZERO for the whole of a one-player game,
 * which is exactly what makes a hand-over impossible there: the branch into
 * handPlayOverToOtherPlayer is taken only when the block the index does NOT select still has a
 * non-zero first byte.
 */
export const PLAYER_TWO_LIVES = 0xad20;

/* ── The rest of the two per-player saved contexts (0xAD10-1F player one, 0xAD20-2F player two) ──
 * Each is a sixteen-byte mirror of the live context at 0xAD00. loadActivePlayerContextAndPostRoundHud
 * copies the ACTIVE_PLAYER-selected block into 0xAD00 byte for byte (CONTEXT_BYTES = 16) and
 * loseLifeAndHandOver copies it back, so every cell below is its active sibling at the same low nibble.
 * armRoundStartThenStepSequence seeds both blocks at a round arm. The meanings come from the active
 * siblings, and the saved copies were watched under MAME too -- written by the context copies at a
 * round clear and a life loss, read back by the context load. Each cell's own grounding is on its
 * entry below. */

/** Player one's copy of ROUND_NUMBER (0xAD01), the unwrapped round ordinal. Seeded 1 at a fresh round
 * arm; the attract arm overloads it to attract-stage + 1. [seen] */
export const PLAYER_ONE_ROUND_NUMBER = 0xad11;

/** Player one's copy of KILLS_REMAINING (0xAD02): craft still to destroy this round, seeded from
 * KILL_QUOTA (0xA9CD). [seen] */
export const PLAYER_ONE_KILLS_REMAINING = 0xad12;

/** Player one's copy of the bonus-life award one-shot latch (active 0xAD03, bit 0, set by
 * awardBonusLifeAtScoreMark once the score mark is passed). Cleared at a round arm. [seen] */
export const PLAYER_ONE_BONUS_LIFE_LATCH = 0xad13;

/** Player one's copy of ERA_INDEX (0xAD04): which era/round is in force -- the key setSavedPenFromEra and
 * seatCaptionPen use for the caption pen. The attract arm overloads it as the demo-script selector. [seen] */
export const PLAYER_ONE_ERA_INDEX = 0xad14;

/** Player one's copy of LIFE_TICKS_MID (0xAD06). The round arm clears this and PLAYER_ONE_LIFE_TICKS_HIGH
 * (0xAD17) together with one 16-bit store, as the mid/high of the play-time counter. [seen] */
export const PLAYER_ONE_LIFE_TICKS_MID = 0xad16;

/** Player one's copy of the round start rung (active 0xAD0A) -- the difficulty rung the round opens on,
 * later copied into ERA_RUNG. Seeded from START_RUNG_ROUNDS_1_5 (0xA9D3). [seen] */
export const PLAYER_ONE_START_RUNG = 0xad1a;

/** Player one's copy of MOTHER_SHIP_ARMED (0xAD0D). Cleared at a round arm. [seen] */
export const PLAYER_ONE_MOTHER_SHIP_ARMED = 0xad1d;

/** Player one's copy of the round-armed gate (active 0xAD0E, which startNextRound sets to 0xFF and the
 * ROM tests as a boolean `and a; ret z`). Seeded 1 (nonzero = armed) at a round arm. [seen] */
export const PLAYER_ONE_ROUND_ARMED = 0xad1e;

/** Player two's copy of ROUND_NUMBER -- the same field as PLAYER_ONE_ROUND_NUMBER, the other block. [seen] */
export const PLAYER_TWO_ROUND_NUMBER = 0xad21;

/** Player two's copy of KILLS_REMAINING; the twin of PLAYER_ONE_KILLS_REMAINING, seeded from KILL_QUOTA. [seen] */
export const PLAYER_TWO_KILLS_REMAINING = 0xad22;

/** Player two's copy of the bonus-life award latch; the twin of PLAYER_ONE_BONUS_LIFE_LATCH. [seen] */
export const PLAYER_TWO_BONUS_LIFE_LATCH = 0xad23;

/** Player two's copy of ERA_INDEX; the twin of PLAYER_ONE_ERA_INDEX (the caption-pen era key). [seen] */
export const PLAYER_TWO_ERA_INDEX = 0xad24;

/** Player two's copy of LIFE_TICKS_MID; the twin of PLAYER_ONE_LIFE_TICKS_MID (the round arm's 16-bit store
 * clears the mid/high pair 0xAD26/0xAD27). [seen] */
export const PLAYER_TWO_LIFE_TICKS_MID = 0xad26;

/** Player two's copy of the round start rung; the twin of PLAYER_ONE_START_RUNG. [seen] */
export const PLAYER_TWO_START_RUNG = 0xad2a;

/** Player two's copy of MOTHER_SHIP_ARMED; the twin of PLAYER_ONE_MOTHER_SHIP_ARMED. [seen] */
export const PLAYER_TWO_MOTHER_SHIP_ARMED = 0xad2d;

/** Player two's copy of the round-armed gate; the twin of PLAYER_ONE_ROUND_ARMED. [seen] */
export const PLAYER_TWO_ROUND_ARMED = 0xad2e;

/** The live caption/pen colour attribute (active context +0x0C; the saved per-player copies are at
 * 0xAD1C/0xAD2C). The pen plotter stamps it into the colour plane and the caption drawers read it (some
 * offset by +5/+10 and masked to the low nibble) as the colour to draw in. [seen] */
export const PEN_COLOUR = 0xad0c;

/** The active caption/pen glyph (active context +0x0B, companion of PEN_COLOUR at +0x0C). plotPenCell stamps
 * it into the character plane while PEN_COLOUR goes to the colour plane; the erase paths set it to the blank
 * glyph 0xF1. Its saved per-player copies are PLAYER_ONE_PEN_GLYPH / PLAYER_TWO_PEN_GLYPH. [seen] */
export const PEN_GLYPH = 0xad0b;

/** Player one's saved copy of PEN_GLYPH (saved context +0x0B). setSavedPenFromEra fills it from the
 * era-indexed glyph/colour record; the context load copies it back into PEN_GLYPH. [seen] */
export const PLAYER_ONE_PEN_GLYPH = 0xad1b;

/** Player two's saved copy of PEN_GLYPH (saved context +0x0B); the twin of PLAYER_ONE_PEN_GLYPH. The
 * two-player branch of the caption-pen seat writes the era record's glyph here (0xF1 on every era of a
 * genuine image); the context-load ldir at 0x4C8A copies it into PEN_GLYPH when player two comes up, and
 * the save ldir at 0x1211 copies PEN_GLYPH back when player two's turn ends. Under MAME a marker 0x5A
 * seated here before player two's context load showed in PEN_GLYPH for all of player two's turn and was
 * written back here at the hand-over, while PLAYER_ONE_PEN_GLYPH kept 0xF1. [seen] */
export const PLAYER_TWO_PEN_GLYPH = 0xad2b;

/** Player one's saved copy of PEN_COLOUR (saved context +0x0C); the source floodColourPlaneWithSavedPlayerColour
 * reads when ACTIVE_PLAYER selects player one. [seen] */
export const PLAYER_ONE_PEN_COLOUR = 0xad1c;

/** Player two's saved copy of PEN_COLOUR; the twin of PLAYER_ONE_PEN_COLOUR. [seen] */
export const PLAYER_TWO_PEN_COLOUR = 0xad2c;

/**
 * The sequence machine's shared one-shot delay: frames still to wait before its next step. [seen]
 *
 * One cell, not one per step. Writers either ARM it with a span or COUNT THAT SPAN DOWN by one. Most
 * countdowns sit at the head of a step and return while the cell is still running, so the step's
 * body runs only on the frame it reaches zero, and most arm sites hand on to the routine that
 * advances the inner sequence index.
 *
 * ★ The startup delay loop at 0x32EB does both: it arms the cell and then counts it down inside its
 * own body, with a bare `dec (hl)` whose HL was loaded before a nested inner loop, so an
 * address-keyed scan of the image finds only its arm. A MAME write tap caught a writer at every site
 * predicted from the image except one no tape reached, plus this countdown. No run can rule out a
 * further writer in a state none of them drove.
 *
 * Under MAME every site that reads or writes it is a phase-3 sequence arm or that delay loop, and
 * the only reads are the countdown sites themselves.
 */
export const SEQUENCE_DELAY = 0xa9eb;

/* ── The tracing pen's fixed route and the between-eras band animation (0xA9E2-0xA9F7) ──
 * The pen draws captions by walking an L-shaped route as an 8.8 fixed-point interpolator: drawInterpolatedPenRun
 * steps a position toward each leg's target and plotPenCell stamps the whole cell. */

/** Leg index into the pen's fixed L-shaped route table; incremented each run to select the next leg. [seen] */
export const PEN_ROUTE_LEG = 0xa9e2;

/** The pen's row position as 8.8 fixed point (a 16-bit word at 0xA9E3; its whole-cell high byte is PEN_ROW_CELL
 * at 0xA9E4). Interpolated toward the leg's row target by adding PEN_ROW_STEP each cell. [seen] */
export const PEN_ROW_POS = 0xa9e3;

/** The pen's whole-cell row -- the high byte of PEN_ROW_POS -- which plotPenCell masks to five bits and
 * multiplies by the 32-cell row stride to address the plane; that x32 stride is what makes it the ROW, not the
 * column. [seen] */
export const PEN_ROW_CELL = 0xa9e4;

/** The pen's column position as 8.8 fixed point (a 16-bit word at 0xA9E5; whole-cell high byte PEN_COLUMN_CELL at
 * 0xA9E6). Interpolated toward the leg's column target by adding PEN_COLUMN_STEP each cell. [seen] */
export const PEN_COLUMN_POS = 0xa9e5;

/** The pen's whole-cell column -- the high byte of PEN_COLUMN_POS -- added within the row by plotPenCell. [seen] */
export const PEN_COLUMN_CELL = 0xa9e6;

/** Signed 8.8 per-step row increment ((target - PEN_ROW_POS)/16, sign kept), added to PEN_ROW_POS each step. [seen] */
export const PEN_ROW_STEP = 0xa9e7;

/** Signed 8.8 per-step column increment, added to PEN_COLUMN_POS each step. [seen] */
export const PEN_COLUMN_STEP = 0xa9e9;

/** Step selector (0..5) of the between-eras band animation that plays after a round is won and before the next
 * round: stepRoundStartIntroAnimation dispatches on it, and each sub-animation writes the step it hands off to
 * (flash->1, band-to-2->2, colour-cycle->3, band-to-4->4, flood->5). It heads the control block 0xA9F0-0xA9F8,
 * which armRoundWonBandAnimationThenStepSequence stocks (all but 0xA9F5) when a round is won, seeding this byte
 * to 0. [seen] */
export const INTRO_ANIMATION_STEP = 0xa9f0;

/** Frame tick of the player-ship white flash (intro step 0/1): bit 0 alternates the sprite colour; at tick 8 it
 * advances INTRO_ANIMATION_STEP and requests the spawn-flash sound. Wraps at eight bits. [seen] */
export const PLAYER_FLASH_TICK = 0xa9f1;

/** Per-pass countdown for advanceScriptedCharPlaneBandTo2 (bit 0 selects a blank vs draw pass), decremented each
 * pass and zeroed at the script's end, which sets INTRO_ANIMATION_STEP to 2. [seen] */
export const BAND_TO2_PASS_COUNTDOWN = 0xa9f2;

/** Countdown driving a sprite's colour field during the colour-cycle step: seeded 4 and stepped down once per call,
 * so bit 2 is set only on the first call (colour 0x37) and clear for the rest (0x3F); when it reads zero the step
 * sets INTRO_ANIMATION_STEP to 3, and the counter then wraps below zero. [seen] */
export const SPRITE_COLOUR_CYCLE_COUNTDOWN = 0xa9f3;

/** Per-pass countdown for advanceScriptedCharPlaneBandTo4 (bit 0 selects blank vs draw), zeroed at the script's
 * end, which sets INTRO_ANIMATION_STEP to 4. [seen] */
export const BAND_TO4_PASS_COUNTDOWN = 0xa9f4;

/** Countdown stepped down once as floodColourPlaneWithSavedPlayerColour finishes painting the colour plane
 * (intro step 4); nothing but that stepper reads it. [seen] */
export const COLOUR_FLOOD_COUNTDOWN = 0xa9f6;

/** 16-bit cursor walking the char-plane band script (a byte per plane cell); shared by the band-to-2 / band-to-4
 * drawers and stepThirteenScriptedGlyphCells, left where it ended. [seen] */
export const BAND_SCRIPT_CURSOR = 0xa9f7;

/**
 * Which of the eight Difficulty DIP positions the cabinet is set to, 0-7. [seen]
 *
 * Three bits, unpacked at boot out of the DSW1 port by the same shift chain that fills the cabinet
 * and demo-sound cells, and read at exactly one place: the credited-game init, which hands it to
 * loadDifficultyRecord as the index into an eight-record table.
 *
 * Grounded under MAME by setting the DIP to each of its eight positions and reading THIS cell back:
 * it took 0 through 7 in the order of MAME's labels 1 (Easiest) through 8 (Difficult), and the four
 * record cells below followed it row for row.
 *
 * ★ Zero is EASIEST. The cell counts up as the cabinet gets harder, which is MAME's label minus one.
 */
export const DIFFICULTY_SETTING = 0xa9c4;

/**
 * The escalation rung a round STARTS on, for rounds one to five. [seen]
 *
 * First byte of the four-byte record loadDifficultyRecord copies out of the difficulty table. A game
 * start copies it into both players' saved start rungs; after that startNextRound picks one of the
 * three bracket cells by the round number -- this one below 6, the next at 6 to 10, the last at 11
 * and up -- and stores it in START_RUNG, which the playfield reset copies into ERA_RUNG.
 *
 * Watched under MAME at all eight DIP positions it took 0, 0, 0, 2, 4, 7, 11, 15 as the setting
 * hardened, and at every position ERA_RUNG held that same value once play began. So the hardest
 * cabinet starts a round at the rung the easiest one has to climb to.
 *
 * ★ It is NOT a difficulty tier. All three bracket cells come from the SAME record and therefore
 * from the same DIP position; what separates them is the round number, not how hard the cabinet is.
 */
export const START_RUNG_ROUNDS_1_5 = 0xa9d3;

/**
 * The same, for rounds six to ten. [seen]
 *
 * Second byte of the same record; startNextRound reads it when the round number is at least 6 and
 * below 11 and stores it in START_RUNG. Under MAME a round clear from 7 to 8 read it here (0x06),
 * while clears into rounds 2, 13 and 34 took the other two brackets. Across the eight DIP positions
 * it holds 2, 3, 4, 6, 8, 10, 13, 15 -- at or above the first bracket's value at every position.
 */
export const START_RUNG_ROUNDS_6_10 = 0xa9d4;

/**
 * The same, for round eleven and up. [seen]
 *
 * Third byte of the same record; startNextRound reads it when the round number is 11 or more and
 * stores it in START_RUNG, which the playfield reset copies into ERA_RUNG. Under MAME, round clears
 * into rounds 13 and 34 read it here. Its values across the DIP positions are 6, 7, 8, 10, 12, 13,
 * 14, 15 -- at or above the second bracket's at every position, so the three form a ladder in rounds
 * as well as in the DIP.
 */
export const START_RUNG_ROUNDS_11_UP = 0xa9d5;

/**
 * The heading the player's ship is flying, a full byte = 256 steps of the circle. [seen]
 *
 * Offset +0x02 of the player's record (head PLAYER_STATE): the "current heading" field every actor
 * family shares. The playfield reset seats it at 0x80; the control reader's steering turns it toward
 * a target; the camera builder negates the velocity it looks up from it; and
 * dressPlayerSpriteForHeading turns it into the shape the ship is drawn with.
 *
 * Grounded by sampling it once a frame through a credited game under MAME against the sprite entry
 * it drives: while the ship was alive, the entry's shape and attribute equalled the two ROM tables'
 * entries for this cell's sector on every sample, and the entry's coordinates stayed pinned at
 * 0x84 / 0x78.
 */
export const PLAYER_HEADING = 0xa802;

/**
 * State byte of the Mother-Ship's record, which begins at this address and runs two slots. [seen]
 *
 * Same alphabet as every other slot -- 0x00 free, 0xFF live, 0xF0 just hit, a countdown below that.
 * What is different is that ONE object occupies this record and the one a stride on: the arming path
 * refuses unless both occupancy bytes are clear and the kill quota has reached zero, the retire
 * helper it hands off to clears both neighbouring sprite entries, and the two ordinary per-slot
 * handlers for these two records return early while MOTHER_SHIP_ARMED is up.
 *
 * Watched under MAME across a run with the kill quota forced empty: armed and torn down four times,
 * taking 0x00, 0xFF and a dying countdown, with the arming writing seven into +4
 * (MOTHER_SHIP_HITS_TO_ABSORB) every time.
 *
 * ★ What is MEASURED is a two-slot object armed exactly when the kill quota empties, with a counter
 * armed to seven, whose player-contact test widens on one axis in the first and last eras. The noun
 * rests on the quota being 56 and the counter 7, the two numbers the manual gives for the
 * Mother-Ship.
 */
export const MOTHER_SHIP_STATE = 0xa8a0;

/**
 * Raised while this round's Mother-Ship has been armed. [seen]
 *
 * All-ones or zero. One writer raises it -- the arming path, as it seeds MOTHER_SHIP_HITS_TO_ABSORB
 * with seven -- and only startNextRound and the playfield reset (run at every life start) clear it,
 * so it stays UP after the object is destroyed, until the round or life turns over. A reader who
 * takes it for "is on screen right now" will be wrong for the rest of the round.
 *
 * Its readers treat it as "the two slots at MOTHER_SHIP_STATE are taken": the shot sweep swaps a
 * seven-craft run for a five-craft one and adds the Mother-Ship, a spawn walk shortens its own run
 * to five, the two per-slot handlers for those two records return early, and the parachutist spawn
 * refuses outright.
 *
 * Grounded by two MAME runs differing only in whether the kill quota is forced to zero: in the
 * control it never left zero and the sweep arm that reads it never ran; in the forced run it rose
 * four times and every dispatch of that arm saw it set.
 */
export const MOTHER_SHIP_ARMED = 0xad0d;

/**
 * Write pointer of the SECOND deferred cell list, the one holding what to blank. [seen]
 *
 * The twin of DEFERRED_WRITE_CURSOR, four bytes ahead of its own entries at 0xAE84 and stepped
 * within its own page in the same way. Nothing appends to this list entry by entry: once a pass, the
 * routine that drains both copies the paint list onto it wholesale and stores this cursor as the
 * paint cursor's low byte plus 0x80. That top bit is why its reader masks the byte before scaling it
 * to a count, and it is the only difference between the two drains' arithmetic.
 *
 * Grounded by a character-plane write tap under MAME attributed by program counter: on every pass
 * the cells blanked from this list were exactly the cells painted from the other one on the pass
 * before, in both directions.
 */
export const DEFERRED_BLANK_CURSOR = 0xae80;

/*
 * Enemy-craft slots: the 7-slot actor sub-band. Records at 0xA850 (stride 0x10) paired to sprite entries
 * at 0xAA1A (stride 0x02), lockstep 8:1 (entry = 0xAA10 + (record-0xA800)/8). Slots 0-6; slot 5 is the
 * Mother-Ship (MOTHER_SHIP_STATE 0xA8A0 / entry 0xAA24). Each cell below is the BASE of a whole record or
 * entry, not a scalar: record +0x00 = state head (0x00 free / 0xFF live / 0xFE held / dying-count), entry
 * +0x00 = X, +0x01 = tile, +0x30 = attribute, +0x31 = Y. See mechanisms.md §4.
 */

/**
 * Slot 0's record, and the iteration base of the whole 7-slot craft band. [seen]
 *
 * Every whole-band walker starts here and strides +0x10 -- the wave builder, the reaim/animate pass,
 * the wave spawner, the kill sweep, the animation-stop -- and the slot-0 per-slot handler also seats it.
 */
export const CRAFT_RECORD_SLOT0 = 0xa850;

/** Slot 1's record head; its per-slot handler seats it and dispatches by era. [seen] */
export const CRAFT_RECORD_SLOT1 = 0xa860;

/** Slot 2's record head. [seen] */
export const CRAFT_RECORD_SLOT2 = 0xa870;

/** Slot 3's record head. [seen] */
export const CRAFT_RECORD_SLOT3 = 0xa880;

/**
 * Slot 4's record head, and the seat of the "cleared" free-slot spawn search. [seen]
 *
 * When the kill quota is spent the search runs a fixed five slots starting here (spilling past the band's
 * end through the Mother-Ship slot into the era-special bank).
 */
export const CRAFT_RECORD_SLOT4 = 0xa890;

/**
 * Slot 6's record head (the last ordinary craft slot), with two extra duties. [seen]
 *
 * It seats the "owed" free-slot spawn search (run length = ROUND_CRAFT_COUNT), and it is the Mother-Ship's
 * SECOND record when the boss is armed -- so slot 6's per-slot handler stands down while MOTHER_SHIP_ARMED
 * is set. (Slot 5, between slot 4 and this, is MOTHER_SHIP_STATE.)
 */
export const CRAFT_RECORD_SLOT6 = 0xa8b0;

/**
 * Slot 0's sprite entry, and the iteration base of the whole entry band; paired with CRAFT_RECORD_SLOT0
 * in every whole-band walk (entry stride +0x02). [seen]
 */
export const CRAFT_ENTRY_SLOT0 = 0xaa1a;

/** Slot 1's sprite entry (paired with CRAFT_RECORD_SLOT1). [seen] */
export const CRAFT_ENTRY_SLOT1 = 0xaa1c;

/** Slot 2's sprite entry. [seen] */
export const CRAFT_ENTRY_SLOT2 = 0xaa1e;

/** Slot 3's sprite entry. [seen] */
export const CRAFT_ENTRY_SLOT3 = 0xaa20;

/** Slot 4's sprite entry, and the "cleared" spawn-search entry-cursor seat (parallel to CRAFT_RECORD_SLOT4). [seen] */
export const CRAFT_ENTRY_SLOT4 = 0xaa22;

/**
 * Slot 6's sprite entry: the "owed" spawn-search entry-cursor seat, and the Mother-Ship's second sprite
 * entry when armed (parallel to CRAFT_RECORD_SLOT6). [seen]
 */
export const CRAFT_ENTRY_SLOT6 = 0xaa26;

/*
 * The object array's OTHER banks (same 24-slot array as the craft band above; record = 0xA800 + 0x10*i,
 * sprite entry = 0xAA10 + 0x02*i): the four actor/target slots (array 1-4), the three era-object-bank slots
 * (array 12-14), the lone parachutist slot (array 15), plus the player (slot 0) and Mother-Ship (slot 10)
 * sprite entries. SLOTn is band-local (0-based within each KIND), matching CRAFT_*_SLOTn above.
 * See mechanisms.md §4.
 */

/**
 * Actor slot 0's record head -- first of the four actor/target object slots (array slots 1-4). [seen]
 *
 * stepFourActorSlots steps the four slots from here (stride +0x10); the same address is the base of the
 * player-contact sweep, the era-4 shot sweep, the bank-launch search and the 15-slot "field cleared" scan.
 * Interior fields: WAVE_KILL_COUNTDOWN 0xa811, WAVE_CLAIM_TIMER 0xa812. Under MAME the head byte is read by
 * the slot dispatcher (0x3E63), the bank-launch search (0x3EF2), the player-contact sweep (0x518A), the
 * shot sweep (0x5217) and the field-cleared scan (0x1283), set to 0xFF by the launch claim (0x3F8B) and
 * zeroed by retireSlot (0x40AB).
 */
export const ACTOR_RECORD_SLOT0 = 0xa810;

/** Actor slot 1's record head. [seen] */
export const ACTOR_RECORD_SLOT1 = 0xa820;

/** Actor slot 2's record head; also the free-slot-search band base. [seen] */
export const ACTOR_RECORD_SLOT2 = 0xa830;

/** Actor slot 3's record head; also doubles as the aimed-spawn era "bank A" record seat. [seen] */
export const ACTOR_RECORD_SLOT3 = 0xa840;

/**
 * Era-object bank slot 0's record head -- base of the three-slot per-era special-object bank (array 12-14). [seen]
 *
 * The era services (serviceEra0BallisticObjectBank / serviceEra1BomberObject / sweepEra2PlusObjectBank) start
 * here; askForSoundWhileTheGroupIsClear tests the three heads together as one group. The bank's spawn config
 * lives in its own interior (ATTACKER_SPAWN_SLOT_COUNT 0xa8c6 = +6). Under MAME the head is read by all three
 * era services (0x3B6C, 0x3FF9, 0x40EA) and the group-clear test (0x40C4), set live by the era commission
 * (0x4303 and siblings) and zeroed by retireSlot (0x40AB).
 */
export const ERA_OBJECT_RECORD_SLOT0 = 0xa8c0;

/** Era-object bank slot 1's record head (second of the grouped three). [seen] */
export const ERA_OBJECT_RECORD_SLOT1 = 0xa8d0;

/** Era-object bank slot 2's record head; also doubles as the aimed-spawn era "bank B" record seat. [seen] */
export const ERA_OBJECT_RECORD_SLOT2 = 0xa8e0;

/** The parachutist's record head (array slot 15); its +7 is PARACHUTIST_RUNG 0xa8f7. [seen] */
export const PARACHUTIST_RECORD = 0xa8f0;

/**
 * The player's sprite entry (array slot 0's X-seat), and the iteration base of the whole entry band. [seen]
 *
 * dispatchPlayerFrameByState pairs it with PLAYER_STATE 0xa800; it is also the base of publishSpriteShadow's
 * 32-byte bank-0 run.
 */
export const PLAYER_ENTRY = 0xaa10;

/** Actor slot 0's sprite entry (paired with ACTOR_RECORD_SLOT0). [seen] */
export const ACTOR_ENTRY_SLOT0 = 0xaa12;

/** Actor slot 1's sprite entry. [seen] */
export const ACTOR_ENTRY_SLOT1 = 0xaa14;

/** Actor slot 2's sprite entry; free-slot-search entry seat. [seen] */
export const ACTOR_ENTRY_SLOT2 = 0xaa16;

/** Actor slot 3's sprite entry; also the aimed-spawn "bank A" entry seat. [seen] */
export const ACTOR_ENTRY_SLOT3 = 0xaa18;

/** The Mother-Ship's sprite entry (array slot 10), paired with MOTHER_SHIP_STATE 0xa8a0. [seen] */
export const MOTHER_SHIP_ENTRY = 0xaa24;

/** Era-object bank slot 0's sprite entry (paired with ERA_OBJECT_RECORD_SLOT0). [seen] */
export const ERA_OBJECT_ENTRY_SLOT0 = 0xaa28;

/** Era-object bank slot 1's sprite entry. [seen] */
export const ERA_OBJECT_ENTRY_SLOT1 = 0xaa2a;

/** Era-object bank slot 2's sprite entry; also the aimed-spawn "bank B" entry seat. [seen] */
export const ERA_OBJECT_ENTRY_SLOT2 = 0xaa2c;

/** The parachutist's sprite entry (array slot 15), paired with PARACHUTIST_RECORD. [seen] */
export const PARACHUTIST_ENTRY = 0xaa2e;

/**
 * The player's sprite attribute byte (colour + flip bits), and the base of the second bank's 32-byte
 * colour/flip run publishSpriteShadow copies to hardware. [seen]
 *
 * Slot 0's +0x30 descriptor byte.
 */
export const PLAYER_SPRITE_ATTRIBUTE = 0xaa40;

/**
 * The player's sprite Y (vertical) byte, and the base of the Y band hideAllSprites / hideCaptionSprites zero
 * to park every sprite off-screen. [seen]
 *
 * Slot 0's +0x31 descriptor byte; distinct from the world-scroll WORLD_SCROLL_Y 0xa808.
 */
export const PLAYER_SPRITE_Y = 0xaa41;

/*
 * The scenery/parallax band (array slots 16-23, driven by runSceneryForEra -- a SEPARATE driver from the
 * active-object handlers, same array structure), plus record interior fields and Y-band cells of the active
 * slots. Scenery SLOTn is band-local (0-based within the scenery band): SLOT0 = array slot 16, SLOT3 = array
 * slot 19 (the two publishSpriteShadow run heads). See mechanisms.md §4.
 */

/** Scenery record base, scenery slot 0 (array slot 16); the record cursor runSceneryForEra starts from (paired with SCENERY_ENTRY_SLOT0). [seen] */
export const SCENERY_RECORD_SLOT0 = 0xa900;

/** Scenery sprite-entry X seat, scenery slot 0 (array slot 16); base of publishSpriteShadow's 6-byte bank-0 head run (slots 16-18). [seen] */
export const SCENERY_ENTRY_SLOT0 = 0xaa30;

/** Scenery sprite code/shape byte, scenery slot 0 (= SCENERY_ENTRY_SLOT0 +1); base of the era-keyed 8-slot code fill (stride 2). [seen] */
export const SCENERY_SPRITE_CODE_SLOT0 = 0xaa31;

/** Scenery sprite-entry X seat, scenery slot 3 (array slot 19); base of publishSpriteShadow's 10-byte bank-0 tail run (slots 19-23). [seen] */
export const SCENERY_ENTRY_SLOT3 = 0xaa36;

/** Scenery attribute (colour+flip) band base, scenery slot 0 (= SCENERY_ENTRY_SLOT0 +0x30); base of publishSpriteShadow's 6-byte bank-1 head run. [seen] */
export const SCENERY_SPRITE_ATTRIBUTE_SLOT0 = 0xaa60;

/** Scenery attribute band, scenery slot 3 (array slot 19); base of publishSpriteShadow's 10-byte bank-1 tail run. [seen] */
export const SCENERY_SPRITE_ATTRIBUTE_SLOT3 = 0xaa66;

/**
 * Mother-Ship record +4: the hits it can still absorb. The arming path seeds it with seven. When a hit leaves
 * the record's state byte neither idle nor live, loc_43f0, if this is non-zero, decrements it and puts
 * the ship back to live (the hit is absorbed); once it is zero the hit proceeds into the destruction
 * countdown, which rebuilds the formation one step in (ROUND_TRANSITION_HOLD = 0xFE) and at zero idles the ship
 * with ROUND_TRANSITION_HOLD = 0xFF. The player-contact kill
 * zeroes it, so contact destroys outright; a relaunch from idle raises it to at least 5. Same absorb
 * mechanism as HITS_REMAINING 0xa8dc. [seen] -- under MAME the arm (0x43E1) writes 7, the absorb decrement
 * (0x4547) walks it 6..0, the relaunch (0x469B) writes 5 and the contact kill (0x511B) writes 0.
 */
export const MOTHER_SHIP_HITS_TO_ABSORB = 0xa8a4;

/**
 * The Mother-Ship's homing-launch aim-side toggle: incremented each launch, bit 0 picks the +0x18 / -0x18 side of
 * the aim. Physically CRAFT_RECORD_SLOT6 +4 -- the Mother-Ship's second-record scratch, touched only by its own step. [seen]
 */
export const MOTHER_SHIP_AIM_SIDE_TOGGLE = 0xa8b4;

/**
 * The attacker (era-bank) aimed-spawn aim-side toggle: incremented each spawn, bit 0 picks a +0x18 or -0x18 offset
 * off the aim heading. ERA_OBJECT_RECORD_SLOT1 +4. (ATTACKER_SPAWN_WINDOW_HALF 0xa8d6, this record's +6, gates
 * whether the spawn happens; it is not the offset.) [seen]
 */
export const ATTACKER_SPAWN_AIM_SIDE_TOGGLE = 0xa8d4;

/** The player's sprite code/shape byte = PLAYER_ENTRY +1; dressPlayerSpriteForHeading writes it from a heading-indexed table. [seen] */
export const PLAYER_SPRITE_CODE = 0xaa11;

/**
 * Actor slot 0's sprite Y (array slot 1; = ACTOR_ENTRY_SLOT0 +0x31, one step of the PLAYER_SPRITE_Y band). [seen]
 *
 * The base of the "park all non-player sprites" Y-clear in advanceRoundWhenFieldCleared (23 entries, stride 2).
 */
export const ACTOR_SPRITE_Y_SLOT0 = 0xaa43;

/** The Mother-Ship's sprite Y (array slot 10; = MOTHER_SHIP_ENTRY +0x31); read as a scalar in the contact/collision windows. [seen] */
export const MOTHER_SHIP_SPRITE_Y = 0xaa55;

/** Era-object bank slot 0's sprite Y (array slot 12; = ERA_OBJECT_ENTRY_SLOT0 +0x31); read as a scalar in fixed-target collision. [seen] */
export const ERA_OBJECT_SPRITE_Y_SLOT0 = 0xaa59;

/*
 * Game-flow state: the active game-context fields, the two-player flag, the attract-demo autopilot's script
 * state and its tile-image tamper tripwire, and the two deferred-paint list heads.
 */

/** Active context +3: the once-per-mark bonus-life award latch (bit 0); mirrors the saved PLAYER_ONE/TWO_BONUS_LIFE_LATCH. [seen] */
export const BONUS_LIFE_LATCH = 0xad03;

/** Active context +0xA: the difficulty rung the round opens on (copied into ERA_RUNG 0xacc0 at reset); mirrors PLAYER_ONE/TWO_START_RUNG. [seen] */
export const START_RUNG = 0xad0a;

/** Active context +0xE: the round-armed gate -- set when a round starts (0xFF from startNextRound; the game's first round loads the saved copy's 1), cleared when the round-intro fly-in timer expires; mirrors PLAYER_ONE/TWO_ROUND_ARMED. [seen] */
export const ROUND_ARMED = 0xad0e;

/**
 * Two-player-game flag: 0xFF for a two-player game, 0x00 for one player / attract. Written alongside PLAY_ACTIVE by every
 * start path; awardScoreToPlayer reads it to draw the 2-UP readout. A boolean -- distinct from ACTIVE_PLAYER 0xad32, the
 * current player index. [seen]
 */
export const TWO_PLAYER_GAME = 0xad31;

/**
 * Attract-demo autopilot: the packed dwell/steer byte -- low 6 bits are the frame countdown, top 2 bits the steering
 * command; reloaded from the next script byte when the dwell expires. [seen]
 */
export const DEMO_SCRIPT_DWELL = 0xadf2;

/** Attract-demo autopilot: low byte of the little-endian cursor into the ROM heading-command script. [seen] */
export const DEMO_SCRIPT_POINTER_LO = 0xadf3;

/** Attract-demo autopilot: high byte of the DEMO_SCRIPT_POINTER_LO cursor. [seen] */
export const DEMO_SCRIPT_POINTER_HI = 0xadf4;

/**
 * Tile-image tamper tripwire: the glyph read back from video cell 0xA5DC; the demo start derails into a data-run trap
 * unless it reads 0xFD. Sibling of TAMPER_GLYPH_COPY 0xab43 / TAMPER_WITNESS 0xad39. [seen]
 */
export const TAMPER_GLYPH_READBACK = 0xadfb;

/** Tile-image tamper tripwire: the colour read back from cell 0xA1DC; the demo proceeds only if it is 0x10 or 0x05. [seen] */
export const TAMPER_COLOUR_READBACK = 0xadfc;

/** Tile-image tamper witness source: the glyph copied to TAMPER_GLYPH_READBACK (0xadfb) and later read back to gate the demo. [seen] */
export const TAMPER_SAMPLE_GLYPH_CELL = 0xa5dc;

/** Colour twin of 0xa5dc, copied to TAMPER_COLOUR_READBACK (0xadfc); also the 8th guarded copyright colour cell. [seen] */
export const TAMPER_SAMPLE_COLOUR_CELL = 0xa1dc;

/**
 * Head of the deferred-PAINT list -- 4-byte records {addr lo, addr hi, tile, colour} that DEFERRED_WRITE_CURSOR 0xae00
 * fills and paintDeferredCells drains into both planes; a cursor still == this head means the list is empty. [seen]
 */
export const DEFERRED_WRITE_LIST = 0xae04;

/**
 * Head of the deferred-BLANK list (same 4-byte record layout). drainBothDeferredCellLists fills it each pass by
 * copying last pass's paint list (0xae00..) into 0xae80.. and writing the count (+0x80) into DEFERRED_BLANK_CURSOR
 * 0xae80; blankCellsPaintedLastPass drains it, stamping the blank glyph 0x20 into the character plane only. [seen]
 */
export const DEFERRED_BLANK_LIST = 0xae84;

/*
 * Tail cells: the ROM-image fold signature, two anti-tamper caption glyph/colour witnesses, the KONAMI
 * copyright witness, and the low-level sound-command FIFO.
 */

/**
 * The folded byte-signature of a program-image block (the self-check's checksum); written by the image-fold step and
 * read once at ROM 0x2730 as cp 0x76, which jumps to 0x2530 (off the genuine path) on mismatch -- an anti-tamper
 * cell. [seen] (The same RAM byte is reused as a scenery sprite byte in-round.)
 */
export const TAMPER_IMAGE_SIGNATURE = 0xaa6f;

/**
 * Anti-tamper caption witness -- the glyph sampled from copyright-caption cell 0xA61C each await-start frame; the
 * animation strip checks it (cp 0xa5) on its opening frame and diverts to the trap at 0x1f2e on mismatch. Sibling of
 * TAMPER_GLYPH_COPY. [seen]
 */
export const TAMPER_GLYPH_STRIP = 0xabfe;

/** The colour byte of the TAMPER_GLYPH_STRIP sample (the sampled cell's colour); checked cp 0x05 / cp 0x10. [seen] */
export const TAMPER_COLOUR_STRIP = 0xabff;

/** Count of queued sound-code bytes in the low-level sound FIFO; the enqueuer increments it, the drain decrements it (0 = empty). [seen] */
export const SOUND_QUEUE_COUNT = 0xac43;

/** Head (oldest byte) and base of the sound-code FIFO body; the drain sends it, then slides the remaining bytes down. Distinct from the high-level command ring. [seen] */
export const SOUND_QUEUE_HEAD = 0xac44;

/**
 * Anti-tamper caption witness -- the glyph sampled from the "(c) KONAMI 1982" caption cell 0xA63C ('N'); checked by the
 * scenery/era arm as cp 0x3b, derailing into the trap at 0x315b on mismatch. Its colour companion is 0xacc8. [seen]
 */
export const TAMPER_GLYPH_KONAMI = 0xacc7;

/*
 * A general reusable pair of 16-bit little-endian scratch pointers (0xA991-A992 / 0xA993-A994), used as working cursors
 * across spawn / collision / high-score routines. The record/entry roles SWAP by caller family (spawn: A=record,
 * B=entry; collision: A=entry, B=record; high-score: slot / glyph-row), so only the positional distinction is stable --
 * hence subsystem-neutral names.
 */

/** General 16-bit scratch pointer (first of the pair, 0xA991-A992); dereferenced as a live working cursor, role varies by caller. [seen] */
export const SCRATCH_PTR_A = 0xa991;

/** General 16-bit scratch pointer (second of the pair, 0xA993-A994); sometimes used alone (e.g. as a video-write destination). [seen] */
export const SCRATCH_PTR_B = 0xa993;

/*
 * Player shots: a SEPARATE six-slot record array at 0xAA80 (0xAA80-0xAADF, stride 0x10) with NO sprite entries --
 * the object-array 8:1 mapping does not apply. Slot +0 head/occupancy, +3/+5 16-bit position (whole coordinate in
 * the high bytes +4/+6), +10/+12 the per-frame step. See §4/§5.
 */

/**
 * Base of the player's six-slot shot record array. [seen]
 *
 * A POINTER BASE, not a scalar: the shot engine seeds and sweeps six 16-byte records here, and the target sweeps
 * read this run to test each shot against what it might hit. Shots have no sprite entries and carry their own whole
 * coordinates (+4/+6), which the sweeps read directly.
 */
export const PLAYER_SHOT_ARRAY = 0xaa80;

/**
 * Countdown of shots still owed from the current fire press. [seen]
 *
 * A fire-button rising edge loads three; each shot seeded decrements it; during credited play no shot is seeded
 * while it is zero -- so a press fires at most a three-shot burst. (The attract demo ignores this gate.)
 */
export const SHOT_BURST_PENDING = 0xaa81;

/**
 * Inter-shot fire-rate cooldown: frames left before the next player shot may seed. [seen]
 *
 * Reloaded to six the moment a shot fires and wound down once per sweep; while nonzero no new shot seeds, so shots
 * leave no faster than one every six frames. (Distinct from the enemy spawn cooldowns.)
 */
export const SHOT_SPAWN_COOLDOWN = 0xaa82;

/**
 * Fire-button edge-detect shift register. [seen]
 *
 * Each frame the fire bit (bit 4 of the read control panel) is shifted into bit 0; the low two bits hold
 * {previous, current}, and the value 0b01 -- released-then-pressed -- is the rising edge that arms a burst. It is
 * not a sequence phase.
 */
export const FIRE_BUTTON_EDGE_SHIFT = 0xa98e;

/*
 * Enemy aim points: a block at 0xAC64-0xAC7F the object driver rewrites every phase-tick -- entry 0 (0xAC64=Y 0x78,
 * 0xAC65=X 0x84) is the ship anchor, and six standoff points stand off the ship on its heading. The block's values
 * and movement are [seen] (mechanisms.md §5, write-tap). The enemy steerers READ them to aim [seen]: in the MAME
 * read-tap the only role reads of the block are headingToward's point loads (PC 0x33BD reads the X byte, 0x33BF the
 * Y byte) of the anchor 0xAC65/0xAC64 and the standoff pairs 0xAC74-0xAC7F; 0xAC66-0xAC73 are read only by the boot
 * RAM clear.
 */

/**
 * Base of the enemy aim-point table, and byte-wise entry 0's X = the ship anchor point (0xAC64 = Y). [seen]
 *
 * The reaim pass indexes this base by twice a craft's state byte to pick which aim point that craft steers toward;
 * state 0x11 uses the anchor here (aim at the ship's pinned point) then latches to a hold. A pointer base doubling
 * as the anchor scalar. Block values [seen] (§5); the aim-reader role is [seen]: in the MAME read-tap headingToward
 * reads 0xAC65 (PC 0x33BD, always 0x84) and 0xAC64 (PC 0x33BF, always 0x78), and the standoff pairs 0xAC74-0xAC7F,
 * whose X bytes sit at base + 2*state for states 0x08-0x0D. The reaim pass is the only code that loads this base into HL
 * ahead of headingToward (ROM 0x31F6, 0x3201).
 * It reads craft states up to 0x11 (PC 0x31EB), and its state-0x11 branch writes the 0x10 hold latch (PC 0x320C).
 */
export const ENEMY_AIM_POINT_TABLE = 0xac65;

/**
 * X byte of one of the two selectable ship-standoff aim points (pair 0xAC74 = Y). [seen]
 *
 * The approach steerer aims a craft here when that craft's record selector bit (ix+0x0f bit 0) is SET; the point
 * stands off the ship (it is not the ship's own point) and is rewritten with the block each phase-tick.
 */
export const ENEMY_STANDOFF_AIM_SET = 0xac75;

/** X byte of the sibling standoff aim point (pair 0xAC78 = Y), chosen when that selector bit is CLEAR. [seen] */
export const ENEMY_STANDOFF_AIM_CLEAR = 0xac79;

/**
 * X byte of the most-referenced ship-standoff aim point (pair 0xAC7E = Y). [seen]
 *
 * The chase steerer, the era spawners and the Mother-Ship stepper all read this point as the heading target for a
 * new or homing enemy. It stands off the ship (not the ship's own point, which is the anchor at 0xAC65), so a name
 * implying it IS the player's position, or that it LEADS the target, would over-claim.
 */
export const ENEMY_STANDOFF_AIM_MAIN = 0xac7f;

/** Y byte of the enemy aim ANCHOR point, whose X is ENEMY_AIM_POINT_TABLE (0xAC65). armRoundStartThenStepSequence
 * seats it to 0x78, and layOutEnemyAimPointsFromScrollAngle uses 0xAC64 as the base it writes the six standoff pairs
 * from. Axis (Y) per the mechanisms.md §5 [seen] block map; the cell identity is [seen]. */
export const ENEMY_AIM_ANCHOR_Y = 0xac64;

/** Y byte of the SET standoff aim point (its X is ENEMY_STANDOFF_AIM_SET, 0xAC75). Also the base of the sixteen-byte
 * aim-coordinate block armRoundStartThenStepSequence clears to 0x80 at each round arm. [seen] (axis per mechanisms.md §5 [seen]) */
export const ENEMY_STANDOFF_AIM_SET_Y = 0xac74;

/** Last byte (base + 0x0F) of that sixteen-byte aim-coordinate block: the inclusive end of
 * armRoundStartThenStepSequence's 0x80 clear loop. [seen] */
export const ENEMY_STANDOFF_AIM_BLOCK_END = 0xac83;

/*
 * Era-rung spawn difficulty config: applyEraRungSettings scatters a ten-byte (era<<4 | rung) row into twelve cells
 * (these ten plus ROUND_CRAFT_COUNT and SCRIPT_PICK_THRESHOLD). Two parallel spawn-config families, same shape --
 * a live per-vblank cooldown + its reload period + proximity/aim window half-widths + a bank slot count. Family
 * BANK_LAUNCH is read by the launchBankEnemyWhenAimedNearPlayer bank-launch arm and the Mother-Ship stepper; family ATTACKER_SPAWN by the
 * per-era attacker/craft-bank spawners. §3 watched the row's values climb a difficulty ladder [seen]; each cell's
 * own role is tagged on its const below. Row byte order: 0->a844, 1->a837, 2->a827, 3->a817+a814, 6->a8c6, 7->a8d6, 8->a8e6, 9->a8f4+a8f6.
 */

/**
 * Live per-vblank cooldown for the bank-launch arm (launchBankEnemyWhenAimedNearPlayer) and the Mother-Ship's homing spawn. [seen]
 *
 * Nonzero blocks the arm; wound down once per frame (it is one of the three vblank timers) and re-armed from its
 * reload period BANK_LAUNCH_COOLDOWN_PERIOD after each launch. NOTE this cell is MULTIPLEXED: in boot/attract the
 * tamper self-check writes an image checksum here and the credit line reads it as a verdict -- a separate life,
 * unrelated to difficulty. The name is the in-game spawn-cooldown role only.
 */
export const BANK_LAUNCH_COOLDOWN = 0xa817;

/** Reload period (interval constant) that re-arms BANK_LAUNCH_COOLDOWN after a launch; never decremented. [seen] */
export const BANK_LAUNCH_COOLDOWN_PERIOD = 0xa814;

/**
 * Near-band proximity half-width gating a bank launch, the same value on both axes. [seen]
 *
 * Doubled into a full window round the player's fixed screen position (0x84, 0x78). launchBankEnemyWhenAimedNearPlayer
 * tests it on both axes and REFUSES the launch when the craft is inside the window on both; the Mother-Ship's fire
 * test uses it the same way, firing only from outside the window on either axis. So a bigger window blocks launches
 * from farther out.
 */
export const BANK_LAUNCH_NEAR_HALF_WIDTH = 0xa827;

/** Half-width of the heading window for a bank launch: launchBankEnemyWhenAimedNearPlayer fires only when the craft's heading lies within this of PLAYER_HEADING. Not a coordinate half-width. [seen] */
export const BANK_LAUNCH_HEADING_HALF_WIDTH = 0xa837;

/** Count of records the bank-launch arm scans for a free slot (loop bound; zero disables the arm). [seen] */
export const BANK_LAUNCH_SLOT_COUNT = 0xa844;

/**
 * Per-era count of enemy slots the attacker / craft-bank spawner fields -- §3's "spawner cap 0, 1, 2". [seen]
 *
 * A hard gate (zero disables the arm) and the sweep loop bound, read by spawnAimedEnemyIntoEraBankWhenInWindow, launchAttackerIntoFreeSlot and the
 * era-bank sweep. Distinct from ROUND_CRAFT_COUNT (the wave quota): this is the era bank's size.
 */
export const ATTACKER_SPAWN_SLOT_COUNT = 0xa8c6;

/** Half-width of the proximity window deciding WHETHER the era attacker bank spawns (doubled into a window). [seen] */
export const ATTACKER_SPAWN_WINDOW_HALF = 0xa8d6;

/**
 * Half-width of the final launch-facing window for the attacker spawn. [seen]
 *
 * Outside the window the launch is abandoned; inside, the object's other coordinate picks its facing side. NOTE a
 * dual use: in era four the same value also seeds a spawned record's countdown byte (record +0x04). The window is the dominant role.
 */
export const ATTACKER_SPAWN_AIM_WINDOW_HALF = 0xa8e6;

/**
 * Live shared per-vblank cooldown for the era attacker-bank spawn arms. [seen]
 *
 * Nonzero blocks a spawn; wound down each frame (a vblank timer) and re-armed from ATTACKER_SPAWN_COOLDOWN_PERIOD
 * after each spawn. launchAttackerIntoFreeSlot also decrements it inline.
 */
export const ATTACKER_SPAWN_COOLDOWN = 0xa8f4;

/**
 * Reload period (interval constant) for ATTACKER_SPAWN_COOLDOWN; never decremented. [seen]
 *
 * Read to re-arm the live timer, and also stocked into a retired slot's record byte 14 so a recycled slot re-enters
 * carrying the same interval.
 */
export const ATTACKER_SPAWN_COOLDOWN_PERIOD = 0xa8f6;

/**
 * Data cells: 0x0d27/0x0b31/0x15c6/0x07d1/0x16d3/0x4a35 are ROM-image data, 0xa501 is screen RAM.
 */
export const ROUND_TRANSITION_HOLD_SEED = 0x07d1; // ROM constant reloaded into ROUND_TRANSITION_HOLD when the field clears in attract; a code byte (high operand byte of jp 0x0069 at 0x07CF) reused as data [seen]
export const SOLO_SCORE_LABEL_INDEX = 0x0b31; // caption index of the sole-player score label (the 2P path uses literals 0x06/0x07); a code byte (ld b,0x04 at 0x0B31) reused as data [seen]
/**
 * 3-byte packed-BCD score increments, indexed by award id (awardScoreToPlayer; id 0 exits at 0x0c9c
 * before the table is touched) [seen] (MAME read-tap: after ld hl,0x0d27 at 0x0c9f, the BCD adds at
 * pc 0x0cb2/0x0cb8/0x0cbe read entries 1-8 and 10-15, 0x0d2a-0x0d56; the daa store at 0x0cba steps
 * the score byte 0xad34)
 */
export const SCORE_AWARD_TABLE = 0x0d27;
export const ABSENT_SCORE_LABEL_INDEX = 0x15c6; // caption index of the absent 2nd-player label, erased in a one-player game [seen]
export const ATTRACT_SEQUENCE_START_PHASE = 0x16d3; // ROM constant seeding SEQUENCE_PHASE when the attract sequence (re)starts [seen]
export const NEXT_ROUND_START_SUBSTEP = 0x4a35; // ROM constant seeding SEQUENCE_SUBSTEP for the next round after startNextRound [seen]
/**
 * VRAM base cell of the player-two on-screen score digits. Under MAME (two-player tape) the six-
 * digit P2 score is painted from here in -0x20 steps to 0xa461, and a one-player game blanks the
 * same six cells [seen]
 */
export const PLAYER2_SCORE_READOUT_BASE = 0xa501;

// Sound-request codes: program-image bytes each read as a sound-command code.
export const PARACHUTIST_AWARD_SOUND = 0x079b; // ROM cell holding the sound code enqueued on a parachutist award (requestParachutistAwardSound) [seen]
export const ENEMY_LAUNCH_SOUND = 0x07a2; // sound-command code enqueued by requestEnemyLaunchSound [seen]
export const TWO_SOUND_REQUEST_FIRST_CODE = 0x07a6; // 1st of the two sound codes requestTwoSounds enqueues; its sites are mixed combat impacts (hit/kill/retire), so it is named generically, not 'death' [seen]
export const PLAYER_SPAWN_FLASH_SOUND = 0x07a9; // sound-command code enqueued by requestPlayerSpawnFlashSound [seen]
export const ATTACKER_SPAWN_SOUND_MID_ERA_1 = 0x07d8; // 1st code of the mid-era (1-3) attacker-spawn sound; requestTwoSoundsWhilePlaying reads it then tails into the late-era code [seen]
export const LATE_ERA_PROGRESS_SOUND = 0x07fe; // sound-command code enqueued by requestLateEraProgressSound [seen]
export const ROUND_INTRO_SOUND_2 = 0x0855; // 2nd of three round-intro sound codes (requestRoundIntroSoundBurst) [seen]
/**
 * 1st of three round-intro sound codes (requestRoundIntroSoundBurst) [seen] (MAME read-tap: pc
 * 0x56d2 ld a,(0x0c5b) reads 0x15, passed to enqueueSoundIfGameInProgress; byte doubles as the high
 * byte of CAPTION_RECORD_TABLE entry 5)
 */
export const ROUND_INTRO_SOUND_1 = 0x0c5b;
export const ROUND_INTRO_SOUND_3 = 0x1675; // 3rd of three round-intro sound codes (requestRoundIntroSoundBurst) [seen]
export const ATTACKER_SPAWN_SOUND_ERA0 = 0x16de; // sound-command code, requestAttackerSpawnSoundEra0 (era-0 branch) [seen]
export const ROUND_START_SOUND = 0x1767; // sound-command code enqueued by requestRoundStartSound [seen]
export const HIGH_SCORE_FILED_SOUND_CODE = 0x18fa; // program-image byte read as a sound code by requestHighScoreFiledSound (`ld a,(0x18fa)` at 0x583A), enqueued only while a game is in progress [seen]
export const ENEMY_WAVE_SOUND = 0x273a; // sound-command code enqueued by requestEnemyWaveSound [seen]
export const ATTACKER_SPAWN_SOUND_LATE_ERA = 0x276b; // sound-command code read by requestAttackerSpawnSoundLateEra; requestTwoSoundsWhilePlaying (mid-era path) falls through into the same read, so the byte is not late-era-only [seen]
export const INTER_ROUND_SOUND_1 = 0x27cb; // 1st of the inter-round sound pair (requestInterRoundSoundPair) [seen]
export const BONUS_LIFE_SOUND = 0x2d4e; // sound-command code enqueued by requestBonusLifeSound [seen]
export const OBJECT_STATE_3B_SOUND = 0x2d87; // sound requested when a one-shot/countdown object is stamped to state 0x3b (animate-out onset); named by the state, not 'death', since callers include non-combat objects [seen]
export const PLAYER_SHOT_SOUND = 0x3270; // sound-command code enqueued by requestPlayerShotSound [seen]
export const COIN_SOUND = 0x322e; // sound-command code enqueued unconditionally by requestCoinSound [seen]
export const INTER_ROUND_SOUND_2 = 0x33a0; // 2nd of the inter-round sound pair (requestInterRoundSoundPair) [seen]
export const MOTHER_SHIP_WARP_SOUND = 0x49ee; // sound-command code enqueued by requestMotherShipWarpSound [seen]
export const ENEMY_LAUNCH_SOUND_LATE_ERA = 0x4c9f; // late-era enemy-launch sound code (requestEnemyLaunchSoundLateEra) [seen]
export const TWO_SOUND_REQUEST_SECOND_CODE = 0x4cda; // 2nd of the two sound codes requestTwoSounds enqueues [seen]

// Mixed data cells: ROM-image cells (below 0xA800) read as data; the rest are work/screen RAM cells,
// script-column starts and shape-strip bases.
export const BLANK_LINES_COUNT = 0x0ccd; // ROM byte copied into BLANK_LINES_LEFT — number of lines the wipe runs (armLineWipeFromFifthLine) [seen] (MAME: pc 0x01bb ld a,(0x0ccd) reads 0x1b, pc 0x01be writes 0x1b to 0xa988)
export const HIGH_SCORE_PATCH_TABLE = 0x163f; // six 3-byte {dest-lo,dest-hi,value} patch records for the attract high-score screen (armAttractScreenShowingHighScore) [seen]
export const SEQUENCE_PHASE_ON_CREDIT = 0x1736; // ROM byte SEQUENCE_PHASE jumps to when CREDIT_COUNT != 0 (advanceAttractTowardGameStart) [seen]
export const holdCopyrightThenEraseTheCoinInvitation_ADDR = 0x1748; // routine 0x1748's own code, read as data by advancePenRunAnimationStep's anti-tamper checksum (34 bytes; drawRoundNumberCaption's guard also folds its first 16) [seen]
/**
 * routine 0x00d8's own code, the base of the 256-byte span clearWorkRamAndSpriteBanksThenColdInit
 * sums as an anti-tamper check (only a mismatch calls saveAccumulatorForFrameInterrupt) [seen]
 */
export const saveAccumulatorForFrameInterrupt_ADDR = 0x00d8;
/**
 * routine 0x17b9's own code, walked in lockstep as foldBlockIntoTotal's discarded passenger pointer
 * (seated by foldImageBlockIntoSignatureThenAdvanceSequence); its bytes do not enter the tamper
 * total [seen]
 */
export const guardBlockOrBlankDisplay_ADDR = 0x17b9;
export const ERA_PEN_TABLE = 0x0f8d; // ROM table of two-byte (glyph, colour) pen records indexed 2*era, read by seatCaptionPenFromEraFoldingTamperIntoPhase and setSavedPenFromEra; the bytes are also routine 0x0f8d's own code [seen]
/**
 * routine 0x46ce's own code: pushed (`ld hl,0x46ce / push hl` at 0x46BA) as the return point of
 * setMotherShipVelocityFromHeading's era arms, and the first byte past that routine's five-word era
 * arm table (0x46C4-0x46CD), which ends where it begins -- an era index past the five arms would
 * read these bytes as words [seen]
 */
export const fileTwoPairsIntoObjectRecordHighByteFirst_ADDR = 0x46ce;
export const PLAYER_ANIM_STRIP_0 = 0x1f76; // player-animation keyframe tile shape-strip base (advancePlayerAnimationStrip FRAME_ARMS) [seen]
export const PLAYER_ANIM_STRIP_1 = 0x1f94; // player-animation keyframe shape-strip base [seen]
export const PLAYER_ANIM_STRIP_2 = 0x1fb2; // player-animation keyframe shape-strip base (reused on the ping-pong) [seen]
export const PLAYER_ANIM_STRIP_3 = 0x1fd0; // player-animation keyframe shape-strip base (reused) [seen]
export const PLAYER_ANIM_STRIP_4 = 0x1fee; // player-animation final keyframe shape-strip base [seen]
export const PLAYER_ANIM_ROW_COUNT = 0x337a; // outer djnz count of the strip blit = tile rows (advancePlayerAnimationStrip) [seen]
export const HEADING_SHAPE_TABLE = 0x3c84; // 2-byte (+0x31,+0x00) screen-edge coordinate pairs indexed by heading, not sprite shapes (the name is historical); shared by armBomberSlotWhenTimerFires + loc_43f0 [seen]
/**
 * inner djnz count = tiles per row (advancePlayerAnimationStrip; also read as a word by
 * restartAttractSequence's image-tamper fold, and as the colour byte of caption record 31 at 0x4900
 * by drawTextRunByIndex) [seen]
 */
export const PLAYER_ANIM_COL_COUNT = 0x4902;
export const BLANK_LINE_START_CELL = 0xa404; // VRAM cell the line-wipe starts at, stored into BLANK_LINE_CURSOR (armLineWipeFromFifthLine). Under MAME each arm adds one 0xF1 wipe to 0xa404..0xa41e and none to 0xa403 [seen]
/**
 * top cell of the scripted working character-plane column, walked by +0x20
 * (gatherCharColumnIntoBackingRun/restoreColumnFromSavedRun). Under MAME the restore walk writes it
 * first of 28 cells, ending at 0xa7b1 [seen]
 */
export const CHAR_PLANE_COLUMN_BASE = 0xa451;
/**
 * char-plane blit destination (row13,col15) for the animated player figure
 * (advancePlayerAnimationStrip). Under MAME each keyframe blit writes here first, then the 5x6
 * block, colour 0xc1+era [seen]
 */
export const PLAYER_ANIM_VRAM_BASE = 0xa5af;
/**
 * bottom cell (row14,col0x11) of the working column's upper 13-run; fillCellRun/stepThirteen walk
 * up to CHAR_PLANE_COLUMN_BASE. Under MAME fillCellRun blanks from here up 13 cells to 0xa451
 * [seen]
 */
export const CHAR_PLANE_UPPER_RUN_BOTTOM = 0xa5d1;
export const CHAR_PLANE_STUB_UPPER_RIGHT = 0xa5f0; // warp-band flare corner at native row 15, col 0x10, one video-RAM column beside the working column 0x11; also written by unrelated painters. On glass (ROT90) it is the tile above the band's horizontal streak, right of the jet's centre column: under MAME, blanking only this cell during the round-won band changes only the tile at x112-119,y128-135 of the rotated 224x256 frame. The band paints it with the same glyph as its three mirror corners (colour twin 0xa1f0 = 0x20 + pen) [seen]
export const CHAR_PLANE_COLUMN_MID_TOP = 0xa5f1; // column-center cell (row15,col0x11), index 13 of the 28-cell gather/restore walk. Under MAME it is the 14th cell the restore walk writes, stepped 0x01..0x0d by the band script [seen]
export const CHAR_PLANE_STUB_LOWER_RIGHT = 0xa5f2; // warp-band flare corner at native row 15, col 0x12. On glass it is the tile below the streak, right of centre: under MAME, blanking only this cell during the round-won band changes only the tile at x112-119,y144-151. The vertical mirror of CHAR_PLANE_STUB_UPPER_RIGHT (colour twin 0xa1f2 = 0x60 + pen) [seen]
export const CHAR_PLANE_STUB_UPPER_LEFT = 0xa610; // warp-band flare corner at native row 16, col 0x10. On glass it is the tile above the streak, left of centre: under MAME, blanking only this cell during the round-won band changes only the tile at x104-111,y128-135. The horizontal mirror of CHAR_PLANE_STUB_UPPER_RIGHT (colour twin 0xa210 = 0xa0 + pen) [seen]
/**
 * column-center cell (row16,col0x11), index 14 of the 28-cell walk; stepped together with the mid-
 * top under one band-script bit (the second in advanceScriptedCharPlaneBandTo2, the first in
 * advanceScriptedCharPlaneBandTo4). Under MAME the restore walk writes it 15th and the band steps
 * it with 0xa5f1 [seen]
 */
export const CHAR_PLANE_COLUMN_MID_BOTTOM = 0xa611;
export const CHAR_PLANE_STUB_LOWER_LEFT = 0xa612; // warp-band flare corner at native row 16, col 0x12. On glass it is the tile below the streak, left of centre: under MAME, blanking only this cell during the round-won band changes only the tile at x104-111,y144-151. Mirrored both ways from CHAR_PLANE_STUB_UPPER_RIGHT (colour twin 0xa212 = 0xe0 + pen) [seen]
export const CHAR_PLANE_LOWER_RUN_TOP = 0xa631; // top cell (row17,col0x11) of the working column's lower 13-run; stepThirteen walks down to the run bottom [seen]
export const HIGH_SCORE_MARKER_CELL_UPPER = 0xa6e1; // marker glyph 0x13 cell (col1,row23) written when arming the high-score attract screen [seen]
export const HIGH_SCORE_MARKER_CELL_LOWER = 0xa701; // marker glyph 0x13 cell (col1,row24), one row below the upper marker [seen]
export const CHAR_PLANE_LOWER_RUN_BOTTOM = 0xa7b1; // bottom cell (row29,col0x11) of the lower run and of the 28-cell column; fillCellRun starts here [seen]

// ROM-image cells (below 0xA800) read as data (checksum blocks, coordinate/route tables), hardware latches,
// and work/screen RAM cells.
export const VIDEO_ENABLE_LATCH = 0xc308; // hardware LS259 picture-enable latch (board LATCH_VIDEO_ENABLE); write-only on/off; anti-tamper checksums fold into it to blank a patched image [seen]
export const DISPLAY_LATCH_CHECKSUM_BASE = 0x1550; // base of a 256-byte ROM anti-tamper block XOR-folded into VIDEO_ENABLE_LATCH on the mid-game round arm [seen]
export const SEQUENCE_PHASE_CHECKSUM_BASE = 0x3310; // base of a 256-byte ROM anti-tamper block subtract-folded into SEQUENCE_PHASE on the fresh-round arm [seen]
export const PLAYER_SHOT_ARRAY_END = 0xaadf; // inclusive top of the player-shot RAM block cleared from PLAYER_SHOT_ARRAY on a fresh round [seen]
export const PLAYER_STATE_BLOCK_END = 0xa97f; // inclusive top of the player/actor-state RAM block cleared from PLAYER_STATE on a fresh round [seen]
export const PEN_ROUTE_START_ROW = 0x0d45; // ROM word (8.8) copied into PEN_ROW_POS to reset the pen to its route's first-point row [seen] (MAME: pc 0x01e5 ld hl,(0x0d45) reads 0x00/0x10, pc 0x01e8 stores it to 0xa9e3); the same bytes are SCORE_AWARD_TABLE entry 10 (0x0d27 + 3*10), read by the BCD add at pc 0x0cb2
export const PEN_ROUTE_START_COLUMN = 0x280c; // ROM word (8.8) copied into PEN_COLUMN_POS to reset the pen to its route's first-point column [seen]
export const PEN_ROUTE_CHECKSUM_BASE = 0x0e33; // base of a 256-byte ROM anti-tamper block summed vs 0xfd in armThePenRoute; mismatch cold-starts [seen]
export const IMAGE_GUARD_BLOCK_4980_BASE = 0x4980; // base of a 1024-byte ROM span XOR-folded (==0x43) as an anti-tamper check by blankOneLineThenGuardBlockOrDerailSequence; mid-code data span, not a routine entry [seen]
export const SPRITE_BANK1_SLOT0_Y = 0xb411; // sprite bank-1 (0xb400 spriteram2) slot-0 Y byte (bit7=multiplex arm); = SPRITE_BANK1_BASE+1 [seen]
export const SPRITE_BANK1_BASE = 0xb410; // base of hardware sprite-attribute bank 1 (0xb400 spriteram2); 48 bytes gathered by publishSpriteShadow, cleared at cold init [seen]
/**
 * first VRAM cell of the count/denomination strip [0xa463, EMBLEM_STRIP_FLOOR)
 * (drawCountAsPictogramStrip). Under MAME every strip paint writes its first slot here, then steps
 * +0x20 slot by slot; no strip write lands at 0xa443 [seen]
 */
export const COUNT_PICTOGRAM_STRIP_START = 0xa463;
export const IMAGE_CHECKSUM_WORD_009D = 0x009d; // low-ROM word (code bytes read as data) folded into drawCountAsPictogramStrip's 3-word integrity sum (vs 0x69) [seen]
export const IMAGE_CHECKSUM_WORD_00A0 = 0x00a0; // 2nd word of that 3-word image integrity sum [seen]
export const IMAGE_CHECKSUM_WORD_00A3 = 0x00a3; // 3rd word of that 3-word image integrity sum [seen]
export const EMBLEM_STRIP_FLOOR = 0xa623; // VRAM boundary dividing count strip [a463,a623) from emblem strip [a623,a783]; inclusive floor (drawEmblemStrip) / exclusive top (drawCountAsPictogramStrip) [seen]
export const EMBLEM_STRIP_TOP = 0xa783; // inclusive top VRAM cell of the emblem strip [EMBLEM_STRIP_FLOOR, 0xa783]; drawEmblemStripThenGuardImage cursor start [seen]
export const IMAGE_GUARD_BLOCK_0711_BASE = 0x0711; // base of a 256-byte ROM span XOR-folded (+25==0) as an anti-tamper check by drawEmblemStripThenGuardImage; mid-code data span [seen]
export const PEN_ROW_TARGET = 0x32f5; // ROM word: interpolation target row fed to stepToward against PEN_ROW_POS (drawInterpolatedPenRun) [seen]
export const PEN_COLUMN_TARGET = 0x0b45; // ROM word: interpolation target column vs PEN_COLUMN_POS (drawInterpolatedPenRun); code bytes (0x0B43 jp operand + 0x0B46 opcode) reused as data [seen]
export const PEN_RUN_END_CELL = 0x14b2; // ROM word: terminating VRAM cell address the pen run plots until (drawInterpolatedPenRun) [seen] (MAME read-tap: pc 0x024b ld de,(0x14b2) reads 0x11/0xa6 = 0xa611, then sbc hl,de loop test)
export const PEN_ROUTE_TABLE = 0x0290; // word table of pen route-leg start points (lo=row cell, hi=column cell), seated into the pen cursor by drawInterpolatedPenRun as each leg begins [seen]

// Anti-tamper data: routines' own code bytes read as data by checksums, plus ROM-image and work-RAM data cells.
export const trampolineToSeatTheStackAndSettleTheControlLatch_ADDR = 0x0000; // routine 0x0000's own code, read as data by clearScreenRamAndVerifyImageThenColdInit's anti-tamper checksum [seen]
export const fetchTableByte_ADDR = 0x0008; // routine 0x0008's own code, read as data by guardBlockOrDerailSequence's anti-tamper checksum [seen]
export const stampCopyrightStrip_ADDR = 0x0b06; // routine 0x0b06's own code, read as data by guardBlockOrBlankDisplay's anti-tamper checksum [seen]
export const advancePenRunAnimationStep_ADDR = 0x1734; // routine 0x1734's own code, read as data by blankCaptionThenAdvancePenRunStep's anti-tamper checksum [seen]
export const loadDefaultHighScores_ADDR = 0x4ba5; // routine 0x4ba5's own code, read as data by armWholePlaneWipeThenDerailOnATamperedImage's anti-tamper checksum [seen]
export const COLOUR_RAM_BASE_WORD = 0x2581; // ROM operand word = 0xa000, base for the colour-RAM fill in clearScreenRamAndVerifyImageThenColdInit [seen]
export const VIDEO_RAM_BASE_WORD = 0x4a37; // ROM operand word = 0xa400, base for the video-RAM fill (== CHAR_PLANE_BASE) [seen]
export const COPYRIGHT_STRIP_CHECK_SEED = 0x4a40; // ROM seed byte guardBlockOrBlankDisplay adds 51 stampCopyrightStrip bytes onto (checksum ==239) [seen]
export const DISPLAY_OFF_VALUE = 0x4c89; // ROM byte (0x00) guardBlockOrBlankDisplay writes to VIDEO_ENABLE_LATCH to blank the picture on a failed tamper check [code]; genuine-ROM un-groundable, see grounding-debt.txt
export const TAMPER_WITNESS_SAMPLE_CELL = 0xa65c; // char-plane VRAM cell (glyph + colour counterpart 0xa25c) copied into TAMPER_WITNESS on a failed check [code] (read only on the failed-fold arm; grounding-debt.txt)
export const IMAGE_GUARD_BLOCK_0BDD_BASE = 0x0bdd; // base of a 256-byte ROM span XOR-folded (==0x1c) as an anti-tamper check by blankCaptionThenAdvancePenRunStep; mid-code data span [seen]
/**
 * first cell (0xa400) of the character/video RAM plane: cold-start fill and whole-plane wipe start,
 * round-won band backing row, saved-column backing run. Under MAME the cold-start fill (pc 0x5880)
 * and the whole-plane wipe (pc 0x01ca) both start here, and gatherCharColumnIntoBackingRun writes /
 * restoreColumnFromSavedRun reads the backing run from here [seen]
 */
export const CHAR_PLANE_BASE = 0xa400;

// ROM-image tables and cells (below 0xA800) read as data -- velocity/bias/descriptor/shape tables, checksum and
// copy sources -- and work/screen RAM cells.
export const PLAYER_SHOT_SLOT_STRIDE = 0x0861; // ROM byte (16) = stride between the 6 player-shot slots (freeAllShotSlots); pairs with PLAYER_SHOT_ARRAY [seen]
/**
 * ROM word (16) = stride to the next slot in the 6-slot shot bank (fireAndSweepPlayerShots); word
 * form of PLAYER_SHOT_SLOT_STRIDE [seen] (MAME read-tap: pc 0x2426 ld de,(0x0d46) reads 0x10/0x00
 * before add ix,de)
 */
export const PLAYER_SHOT_SLOT_STRIDE_WORD = 0x0d46;
export const PLAYER_SHOT_SPAWN_POSITION_TABLE = 0x2771; // 32-entry ROM word table by heading ((heading+4)>>3 & 0x1f): the low/high bytes seed the whole parts of a new shot's two coordinates (its muzzle position); the velocity comes from the world scroll (fireAndSweepPlayerShots) [seen]
export const TAMPER_SIGNATURE_SEED_BYTE = 0x27c0; // ROM seed byte for the image-signature fold (foldImageBlockIntoSignatureThenAdvanceSequence -> TAMPER_IMAGE_SIGNATURE) [seen]
export const WAVE_HEADING_BIAS_TABLE = 0x38d9; // 16-entry ROM byte table indexed (PLAYER_HEADING+8)>>4: a per-heading offset, in pairs, added to each descriptor byte to pick a spawn position from WAVE_EDGE_POSITION_TABLE, so where on the edge a wave appears shifts with the player's heading (driveEnemyWaveForLifePhase) [seen]
export const WAVE_EDGE_POSITION_TABLE = 0x38e9; // ROM table of two-byte spawn positions that trace the screen edge, not shapes: byte 0 goes to the sprite entry's +0x31 coordinate and byte 1 to its +0x00, indexed 2*(descriptor byte + WAVE_HEADING_BIAS_TABLE offset) (driveEnemyWaveForLifePhase) [seen]
export const WAVE_DESCRIPTOR_TABLE = 0x397b; // ROM table of 16-byte wave descriptor rows (16*WAVE_DESCRIPTOR_INDEX), 2 bytes/slot (driveEnemyWaveForLifePhase) [seen]
export const HANDOVER_SUBSTEP_SEED = 0x4b52; // ROM byte reseating SEQUENCE_SUBSTEP on a player hand-over (handPlayOverToOtherPlayer/loseLifeAndHandOver) [seen]
export const DEFAULT_HIGH_SCORE_TABLE = 0x4bb1; // ROM source block (40 bytes) of default high scores copied to HIGH_SCORE_TABLE_BASE (loadDefaultHighScores); also a tamper-path derail target, not a routine entry [seen]
export const TAMPER_CHECKSUM_SPAN_BASE = 0x5b50; // base of a 256-byte checksum-over-code span XOR-folded -> VIDEO_ENABLE_LATCH (loadActivePlayerContextAndPostRoundHud tamper guard); not a routine entry [seen]
export const SHOT_SLOT_FILL_BYTE = 0x5c01; // ROM byte (0) zero-filling each shot slot's bytes 0/4 + high half of the stride word (freeAllShotSlots) [seen]
export const COPYRIGHT_SAMPLE_COLOUR_CELL = 0xa23c; // colour-plane cell sampled into TAMPER_GLYPH_KONAMI+1 (holdCopyrightThenEraseTheCoinInvitation); pairs with the glyph cell at +0x400 [seen]
export const COPYRIGHT_SAMPLE_GLYPH_CELL = 0xa63c; // video/glyph-plane cell sampled into TAMPER_GLYPH_KONAMI (holdCopyrightThenEraseTheCoinInvitation) [seen]
export const TAMPER_FOLD_FLAG = 0xaa3f; // work-RAM flag set 0xff before the image-signature fold, no routine reads it back by address [seen] (foldImageBlockIntoSignatureThenAdvanceSequence)
export const WAVE_SPAWN_BUSY_FLAG = 0xacc2; // work-RAM busy flag =0xff around the inline wave-build loop, =0 after; no routine reads it back by address, so it locks nothing [seen] (driveEnemyWaveForLifePhase)

// Dispatch tables and caption colour cells.
/**
 * inline 5-entry word jump table (entries for eras 0-4, indexed ERA_INDEX&7; the bytes from 0x291E
 * on are foldBlockIntoTotal's code) selecting a seated-slot handler by era
 * (dispatchSeatedSlotByEraIndex, mem16[here+2*(ERA_INDEX&7)]) [seen]
 */
export const ERA_SLOT_DISPATCH_TABLE = 0x2914;
export const PHASE0_SUBSTEP_DISPATCH_TABLE = 0x15c8; // inline 8-entry word jump table of phase-0 sub-step arms (dispatchSequencePhase0SubStepArm); only slots 0 and 6 name code, the rest are caption bytes [seen]
/**
 * inline 16-entry word jump table of the phase-3 (round-engine) sub-step arms, keyed on
 * SEQUENCE_SUBSTEP&0x0f (dispatchSequenceSubStepArm) [seen] (MAME: rst 0x30 at 0x0f28 pushes
 * 0x0f29, fetchTableWord pc 0x0012/0x0014 reads entry words 0x0f29-0x0f46)
 */
export const PHASE3_SUBSTEP_DISPATCH_TABLE = 0x0f29;
export const CAPTION_BAND_COLOUR_CELL0 = 0xa210; // 1st of three colour-RAM cells the caption colour band sets: 0xa0+base here, 0x20+base one row back (paintCaptionColourBandAndStepSequence) [seen]
export const CAPTION_BAND_COLOUR_CELL1 = 0xa211; // 2nd caption colour-band cell: 0xa0+base here, 0x20+base one row back [seen]
export const CAPTION_BAND_COLOUR_CELL2 = 0xa212; // 3rd caption colour-band cell: 0xe0+base here, 0x60+base one row back (paintCaptionColourBandAndStepSequence) [seen]
/**
 * colour-plane counterpart (res 2,h fold) of CHAR_PLANE_LOWER_RUN_BOTTOM (0xa7b1); fillCellRun base
 * for the caption's lower colour run. Under MAME (poke-rcnat) fillCellRun writes 0xa0+PEN_COLOUR
 * here first, then 12 more cells up by 0x20 to 0xa231 [seen]
 */
export const CAPTION_COLOUR_LOWER_RUN_BOTTOM = 0xa3b1;
export const CAPTION_COLOUR_UPPER_RUN_BOTTOM = 0xa1d1; // colour-plane counterpart of CHAR_PLANE_UPPER_RUN_BOTTOM (0xa5d1); fillCellRun base for the caption's upper colour run [seen]
export const INTRO_ANIMATION_STEP_SEED = 0x3213; // program-image code byte (0x00, the immediate operand of ld (ix+9),0 at 0x3210) read as a value to seed INTRO_ANIMATION_STEP to 0 when a won round's band animation is set up (armRoundWonBandAnimationThenStepSequence) [seen]
/**
 * 11-entry ROM table: a digit (0-9) to its glyph, plus entry 10 = the blanking glyph 0xF1 that
 * paintSuppressedDigit substitutes for a suppressed zero; paint(Un)SuppressedDigit fetchTableByte
 * [seen] (MAME: after ld hl,0x0dcc at 0x0d93/0x0dbf, fetchTableByte pc 0x000d reads all of
 * 0x0dcc-0x0dd6 and the digit stores at 0x0d98/0x0dc4 write exactly those table bytes, 0xf1
 * included)
 */
export const DIGIT_GLYPH_TABLE = 0x0dcc;
export const LEADING_ZERO_BLANK_GLYPH_INDEX = 0x3246; // ROM byte: glyph-table index used for a suppressed leading zero (paintSuppressedDigit) [seen]
export const SPRITE_BANK0_BASE = 0xb010; // base of hardware sprite-attribute bank 0 (0xb000 spriteram); sibling of SPRITE_BANK1_BASE (publishSpriteShadow) [seen]
export const SPRITE_RAISE_STEP_FLOOR = 0x0832; // ROM byte: lower bound of the sub-step window in which publishSpriteShadow raises 8 sprites' top bit [seen]
export const PLAYER_RECORD_SPARE_BYTE = 0xa801; // work-RAM byte after PLAYER_STATE (0xA800): zeroed at every life start by resetPlayfieldAndArmNewRound (`ld (0xa801),a` at 0x1A1F) and by the block wipes, and read by no code -- the only reads of it are the wipes' own LDIR source fetches [seen]
export const ERA_RUNG_SETTINGS_POINTER_TABLE = 0x1b04; // ROM table indexed (era<<4)+rung via fetchTableWord -> pointer to a ~10-byte settings row scattered into spawn/launch cells (applyEraRungSettings) [seen]
export const ATTRACT_RESTART_FOLD_BYTE = 0x4901; // ROM byte folded with PLAYER_ANIM_COL_COUNT to recompute SEQUENCE_SUBSTEP (nets to 0 on a genuine image) -- anti-tamper (restartAttractSequence) [seen]
export const CAPTION_PEN_CHECKSUM_BASE = 0x178c; // base of the 30-byte program-image block summed into SEQUENCE_PHASE as an anti-tamper fold (seatCaptionPenFromEraFoldingTamperIntoPhase); nets out on a genuine image; the bytes are also the code of holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail (0x178C) [seen]
export const runParachutistSlot_ADDR = 0x47b3; // routine 0x47b3's own first opcode (0x3A) read as data -- a caption-cell pointer seed by holdCopyright's anti-tamper glyph check [seen]
export const COPYRIGHT_CAPTION_RECORD = 0x086b; // the 16-byte copyright caption record (header 0x086b-0x086d, glyphs 0x086e-0x087a) that drawTextRunByIndex paints; its bytes double as the RNG seed guard words and the default kill quota, and the whole record is summed as a tamper tripwire (seatEraSceneryRowThenClearAndRunScenery, showCreditLine) [seen]
export const ERA_SCENERY_ROW_TABLE = 0x3176; // ROM table of 8-byte per-era scenery rows, row = base + 8*era (seatEraSceneryRowThenClearAndRunScenery); also the landing of loc_315b's jp, which runs into data [seen]

// ROM-image cells and dispatch/data-table bases (below 0xA800) read as data; I/O-port hardware registers
// (0xC000/0xC3xx); and work/screen/sprite RAM cells.
export const DEFAULT_HIGH_SCORE_HI = 0x08c9; // ROM boot-default byte copied into HIGH_SCORE_HI (seedGameConfigFromDipSwitches); a code operand byte (ld de,0x0113 at 0x08C7) reused as data [seen]
export const DEFAULT_KILL_QUOTA = 0x0874; // ROM boot-default byte copied into KILL_QUOTA (seedGameConfigFromDipSwitches) [seen]
export const RANDOM_REGISTER_SEED_SOURCE = 0x4b84; // base of the fixed 17-byte ROM seed run copied into RANDOM_REGISTER (seedRandomRegister) [seen]
export const RANDOM_SEED_GUARD_WORD0 = 0x086d; // ROM word (1st of two) summed into seedRandomRegister's image-tamper guard total (must net to 0) [seen]
export const RANDOM_SEED_GUARD_WORD1 = 0x0870; // ROM word (2nd) of the same seed image-tamper guard total; loaded whole, only its low byte (0x7C at 0x0870) enters the sum [seen]
export const SEQUENCE_PHASE_ARM_TABLE = 0x015f; // 4-word ROM table of per-phase arm-handler code addresses, indexed by SEQUENCE_PHASE&3; the vblank service runs the selected arm each frame (serviceVerticalBlankInterrupt) [seen]
export const ENEMY_SPAWN_DIRECTION_INDEX_TABLE = 0x39fb; // ROM byte table: spawn direction (PLAYER_HEADING/4 plus random jitter, 0-63) -> record number, times four into ENEMY_SPAWN_RECORD_TABLE (spawnEnemyIntoFreeSlotElseStepSearch) [seen]
export const ENEMY_SPAWN_RECORD_TABLE = 0x3a3b; // ROM stride-4 enemy spawn records: bytes 0 and 1 are a starting position, stored into the sprite entry's +0x31 and +0x00 coordinates; byte 2 is a starting heading, read only by spawnEnemyWaveIntoFreeSlots; byte 3 is read by neither reader. Picked through ENEMY_SPAWN_DIRECTION_INDEX_TABLE (spawnEnemyIntoFreeSlotElseStepSearch) or as a random multiple of four (spawnEnemyWaveIntoFreeSlots) [seen]
export const SPRITE_SHAPE_BY_SECTOR_TABLE = 0x2a77; // 16-entry ROM table: sprite shape code by heading sector (+8 on alternate frames) (spriteForHeading) [seen]
export const SPRITE_MIRROR_BY_SECTOR_TABLE = 0x2a87; // 16-entry ROM table parallel to the shape table: sprite mirror/flip attribute by heading sector (spriteForHeading) [seen]
export const WIPE_SUBSTEP_SEED = 0x1749; // ROM byte (=0x06, a code operand reused as data) seeding SEQUENCE_SUBSTEP for the whole-plane wipe (startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase) [seen]
export const SEQUENCE_PHASE_TAMPER_SPAN_BASE = 0x5648; // base of a 256-byte ROM block sub-folded into SEQUENCE_PHASE then XOR 0x4e -- anti-tamper (corrupts the phase on a modified image) [seen]
export const MOTHER_SHIP_WARP_SHAPE_TABLE = 0x461b; // 8-entry ROM shape table for the mother-ship warp/flash animation (loc_43f0/stepMotherShipWarpFlashFrame) [seen]
/**
 * ROM rst 0x30 word table of per-era velocity arms for the Mother-Ship's aimed shot (0x598E for
 * eras 0-1, 0x5994 for eras 2-4), whose returned velocity words 0x4795 files into the shot record
 * (loc_43f0) [seen]
 */
export const MOTHER_SHIP_STAGE_ARM_TABLE = 0x478b;
export const INTRO_SUBSTEP_RELOAD = 0x2750; // ROM byte (=3) reloading SEQUENCE_SUBSTEP after the between-eras band animation (stepRoundStartIntroAnimation) [seen]
export const SEQUENCE_CHECKSUM_SPAN_BASE = 0x0bcc; // base of the 256-byte ROM block summed vs EXPECTED_CHECKSUM_TOTAL -> derail on mismatch (stepSequenceUnderChecksum) [seen]
export const EXPECTED_CHECKSUM_TOTAL = 0x1a50; // anti-tamper reference total; stepSequenceUnderChecksum derails if the 256-byte sum from SEQUENCE_CHECKSUM_SPAN_BASE mismatches [seen]
export const NMI_ENABLE_LATCH = 0xc300; // W side of dual-mapped 0xc300: LS259 control-latch bit 0 (NMI enable), and the latch-bank base the boot clear-walk steps through; READ side = IN0_PORT [seen]
export const IN0_PORT = 0xc300; // R side of dual-mapped 0xc300: system input port (coin 1/2, service, 1P/2P start), complemented on read into IN0_MIRROR (serviceVerticalBlankInterrupt); WRITE side = NMI_ENABLE_LATCH [seen]
export const FLIPSCREEN_LATCH = 0xc302; // hardware LS259 bit 1 = flipscreen (board LATCH_FLIPSCREEN, inverted); write-only [seen]
export const IN1_PORT = 0xc320; // hardware read: input port 1 (player-1 stick+fire); serviceVerticalBlankInterrupt mirrors it inverted to IN1_MIRROR [seen]
export const IN2_PORT = 0xc340; // hardware read: input port 2 (cocktail player-2 stick); mirrored to IN2_MIRROR [seen]
export const DSW0_PORT = 0xc360; // hardware read: dip-switch bank 0 (coinage); complemented into COINAGE_SETTINGS (seedGameConfigFromDipSwitches) [seen]
export const DSW1_PORT = 0xc200; // R side of dual-mapped 0xc200: dip-switch bank 1, complemented on read (seedGameConfigFromDipSwitches; serviceVerticalBlankInterrupt -> DIP1_MIRROR); WRITE side = WATCHDOG_RESET [seen]
export const WATCHDOG_RESET = 0xc200; // W side of dual-mapped 0xc200: writing kicks (resets) the watchdog, value ignored; READ side = DSW1_PORT [seen]
export const SCANLINE_COUNTER = 0xc000; // R side of dual-mapped 0xc000: raster/scanline counter, read for the sprite-multiplex carry (multiplexSpriteSlotsSkipping, spinRemainingSpriteMultiplexSlots); WRITE side = SOUND_COMMAND_LATCH [seen]
export const SOUND_COMMAND_LATCH = 0xc000; // W side of dual-mapped 0xc000: sound-command byte handed to the audio Z80 (sendSoundCommand); READ side = SCANLINE_COUNTER [seen]
export const TAMPER_GLYPH_SOURCE_CELL = 0xa67c; // char-plane glyph cell copied to TAMPER_GLYPH_COPY (0xab43) and later compared against it -- anti-tamper witness (expected glyph 0x7c) [seen]
export const SPAWN_CLEARED_SPARE_BYTE = 0xacc5; // work-RAM byte zeroed when an enemy is spawned into a free slot (spawnEnemyIntoFreeSlotElseStepSearch, `ld (0xacc5),a` at 0x3816) and by the boot wipe, and read by no code [seen]
export const COPYRIGHT_GLYPH_SAMPLE_CELL = 0xa61c; // copyright-caption glyph cell sampled (glyph+colour) into TAMPER_GLYPH_STRIP each await-start frame (stepCopyrightScreenAwaitingStart) [seen]
export const SPRITE_BANK1_SLOT19_Y = 0xb437; // sprite-attribute bank 1 (spriteram2) slot 19 Y byte (bit7=multiplex request; traded once the raster counter reaches 256 minus this byte) [seen]
export const SPRITE_BANK0_SLOT19_X = 0xb036; // sprite-attribute bank 0 (spriteram) slot 19 X byte; multiplex pair with SPRITE_BANK1_SLOT19_Y [seen]
export const SPRITE_BANK1_SLOT20_Y = 0xb439; // sprite bank 1 slot 20 Y byte [seen]
export const SPRITE_BANK0_SLOT20_X = 0xb038; // sprite bank 0 slot 20 X byte; pair with SPRITE_BANK1_SLOT20_Y [seen]
export const SPRITE_BANK1_SLOT21_Y = 0xb43b; // sprite bank 1 slot 21 Y byte [seen]
export const SPRITE_BANK0_SLOT21_X = 0xb03a; // sprite bank 0 slot 21 X byte; pair with SPRITE_BANK1_SLOT21_Y [seen]
export const SPRITE_BANK1_SLOT22_Y = 0xb43d; // sprite bank 1 slot 22 Y byte [seen]
export const SPRITE_BANK0_SLOT22_X = 0xb03c; // sprite bank 0 slot 22 X byte; pair with SPRITE_BANK1_SLOT22_Y [seen]
export const SPRITE_BANK1_SLOT23_Y = 0xb43f; // sprite bank 1 slot 23 Y byte (last slot) [seen]
export const SPRITE_BANK0_SLOT23_X = 0xb03e; // sprite bank 0 slot 23 X byte (last slot); pair with SPRITE_BANK1_SLOT23_Y [seen]

// ROM data-table bases read through the table helpers (fetchTableByte/fetchTableWord/fetchWideTableWord/
// offsetAddress) or walked directly -- data, not code.
/**
 * word table of pointers to caption records {start-cell word, colour, glyph run}, indexed by
 * caption id through fetchWideTableWord; shared by 5 caption routines [seen] (MAME read-tap:
 * fetchWideTableWord pc 0x0195/0x0197 reads entries 0x0c50-0x0c8f after the callers' ld hl,0x0c50
 * at 0x0bf2/0x0c0f/0x0c23/0x0c39/0x3421 execute)
 */
export const CAPTION_RECORD_TABLE = 0x0c50;
export const KILL_METER_GLYPH_ROW_TABLE = 0x087c; // ROM table indexed 10*ERA_INDEX → 10-byte per-era rows (2 bar glyphs + 8 end glyphs) for the kills-remaining meter (drawKillMeter) [seen]
export const KILL_METER_BAR_START_CELL = 0xa79f; // fixed VRAM start cell of the kill-meter bar; cells written stepping -0x20 (drawKillMeter) [seen]
export const PHASE1_SUBSTEP_DISPATCH_TABLE = 0x1659; // inline word jump table of phase-1 sub-step arms keyed on SEQUENCE_SUBSTEP (dispatchSequencePhase1SubStepArm) [seen]
export const PHASE2_SUBSTEP_DISPATCH_TABLE = 0x1806; // inline word jump table of phase-2 sub-step arms keyed on SEQUENCE_SUBSTEP (dispatchSequencePhase2SubStepArm) [seen]
export const PLAYER_HEADING_SHAPE_TABLE = 0x20ce; // ROM table indexed by player heading rounded to 32 sectors → PLAYER_SPRITE_CODE, +32 = parallel attribute table (dressPlayerSpriteForHeading) [seen]
export const FINE_HEADING_SHAPE_TABLE = 0x2abc; // ROM 2-byte (shape,attr) table over 32 heading sectors; shape flutters +8 on alternate frames (dressSpriteForFineHeading) [seen]
export const COARSE_HEADING_SHAPE_TABLE = 0x2b18; // ROM shape table indexed by heading rounded to 16 sectors (top nibble); +16 = parallel attr table (dressSpriteForCoarseHeading) [seen]
export const OBJECT_PHASE_SHAPE_TABLE = 0x2c94; // 16-entry ROM shape table indexed by phase step (phase-10)/2 for the mid-band object animation (driveObjectAppearanceByPhaseBand) [seen]
export const ERA4_SCENERY_SEED_TABLE = 0x315e; // ROM 8x2-byte packed table seeding SCENERY_ENTRY_SLOT0 (byte0→+0x31, byte1→+0) on the era>=4 path; inline data after loc_315b's jp, NOT a call target (clearSceneryEntriesThenRunEraScenery) [seen]
export const DEATH_ANIMATION_SHAPE_TABLE = 0x3c09; // ROM shape table indexed ((level-0x40)>>3)-1, reseated every 8 steps as a dying object counts down (advanceHitSoakingObjectThenAnimateDeath) [seen]
export const HEADING_SECTOR_SHAPE_TABLE = 0x3fca; // 16-entry ROM shape table indexed by heading sector; +16 = parallel attribute table (dressSpriteShapeAndAttributeForHeadingSector) [seen]
/**
 * ROM table of 2-byte shape pairs for the Mother-Ship's two sprites, indexed ERA_INDEX*16 + damage
 * stage*4 + (FRAME_TICK & 2), the damage stage being ((7 - MOTHER_SHIP_HITS_TO_ABSORB) >> 1) & 3,
 * eras 0-3 (dressSpriteForHeadingOrRetireAtEdge) [seen]
 */
export const HEADING_SHAPE_PAIR_TABLE = 0x44f1;
export const ERA_SPRITE_COLOUR_TABLE = 0x4531; // ROM per-era sprite colour byte table (dressSpriteForHeadingOrRetireAtEdge) [seen]
export const COPYRIGHT_LINE_FIRST_COLOUR_CELL = 0xa2bc; // first colour-RAM cell of the copyright caption line; 13-cell walk (stride -0x20) each must be 0x10/0x05 else derail (checkTheCopyrightLineColoursOrDerail) [seen]

// More ROM data-table bases, directly walked cells and hardware-port lines -- data, not code.
export const ATTRACT_CHECKSUM_BLOCK_BASE = 0x4aa0; // base of a 256-byte ROM anti-tamper block summed vs 0xb8 -> derail (erasePenRouteThenAdvanceStep, attract phase-1 arm) [seen]
export const HIGH_SCORE_INITIALS_CELL_BASE = 0xa531; // glyph-plane base of per-rank high-score initials cells (stride 2*rank), saved to SCRATCH_PTR_B (fileScoreIntoHighScoreTable) [seen]
export const FLIPSCREEN_INIT_BYTE = 0x0c3e; // fixed ROM byte written to FLIPSCREEN_LATCH at cold start (finishBootSelfTestAndColdStart); a code operand byte (call 0x018c at 0x0C3C) reused as data [seen]
export const BOOT_SELFTEST_CHECKSUM_BASE = 0x27de; // base of the boot self-test 256-byte ROM anti-tamper block summed vs 0xc5 -> derail (finishBootSelfTestAndColdStart) [seen]
export const DIAGONAL_HEADING_TABLE = 0x341d; // 4-entry ROM table of the diagonal headings for equal-leg targets (headingToward) [seen]
export const OCTANT_BASE_HEADING_TABLE = 0x3415; // 8-entry ROM table of octant base headings (multiples of 32; bit5 = count-backwards) (headingToward) [seen]
export const SPRITE_BANK1_SLOT1_Y = 0xb413; // sprite bank 1 slot 1 Y byte (0xb411+2) [seen]
export const SPRITE_BANK0_SLOT1_X = 0xb012; // sprite bank 0 slot 1 X byte (0xb010+2); multiplex pair with SPRITE_BANK1_SLOT1_Y [seen]
export const SPRITE_BANK1_SLOT2_Y = 0xb415; // sprite bank 1 slot 2 Y byte [seen]
export const SPRITE_BANK0_SLOT2_X = 0xb014; // sprite bank 0 slot 2 X byte; multiplex pair with SPRITE_BANK1_SLOT2_Y [seen]
export const CREDIT_COUNT_READOUT_CELL = 0xa47f; // char-plane first (tens) digit cell of the two-digit credit-count panel (paintCreditCountPanel). Under MAME it holds '0' (0x13) while the ones digit at 0xa45f tracks credits 0..2 [seen]
/**
 * second ROM digit-glyph table (digit low-nibble -> glyph), used by paintDigitDroppingLeadingZero;
 * a distinct copy from DIGIT_GLYPH_TABLE (0x0dcc) [seen] (MAME: after ld hl,0x0f06 at 0x0ef2,
 * fetchTableByte pc 0x000d reads 0x0f07-0x0f0e and the store at 0x0ef7 writes exactly those bytes;
 * entries 0 and 9 were not observed -- entry 0 is fetched only for a zero once the leading-zero
 * budget in B is spent)
 */
export const DIGIT_GLYPH_TABLE_2 = 0x0f06;
export const HIGH_SCORE_READOUT_BASE = 0xa641; // char-plane leftmost digit cell of the six-digit high-score readout (paintHighScoreReadout) [seen]
export const READOUT_PICTOGRAM_TABLE = 0x4cb4; // ROM table of stride-3 pictogram records keyed by source lead byte (paintLabelledNumericReadoutColumn) [seen]
export const PLAYER1_SCORE_READOUT_BASE = 0xa781; // char-plane leftmost digit cell of the player-1 six-digit score readout (paintPlayerOneScoreReadout); parallels PLAYER2_SCORE_READOUT_BASE [seen]
export const NMI_ENABLE_BYTE = 0x4c87; // fixed ROM byte (=0x01) read at startup and written to the NMI-enable latch 0xC300 to arm interrupts (petWatchdogThroughStartupDelayThenStartMachine) [seen]
/**
 * 4-entry ROM table of score-award indices (0x0A/0x0C/0x0D/0x0E = 1,000/2,000/3,000/4,000) that
 * postNextParachutistBonus posts as command 4 for the first four parachutist rungs; later rungs
 * post index 0x0F (5,000) [seen]
 */
export const PARACHUTIST_BONUS_ARG_TABLE = 0x484f;
export const COIN_COUNTER_0_LATCH = 0xc30a; // hardware LS259 bit 5 = slot-1 mechanical coin counter (board LATCH_COIN_COUNTER_0); write-only pulse (pulseSlot1CoinCounter) [seen]
export const COIN_COUNTER_1_LATCH = 0xc30c; // hardware LS259 bit 6 = slot-2 coin counter (LATCH_COIN_COUNTER_1); write-only pulse (pulseSlot2CoinCounter) [seen]
export const COMMAND_HANDLER_TABLE = 0x0bbc; // 16-entry ROM word table of ring-command handler code addresses, indexed by command&0x0f; the drain loop runs the selected handler with the argument byte (runCommandRingDrainLoop) [seen]

// ROM data-table bases, directly walked cells, I/O-port registers (0xC000/0xC2xx/0xC3xx), the boot stack seat and
// the expansion-probe / picture-enable image bytes -- data, not code -- plus two routines' own code read as data.
/**
 * routine 0x335e's own code read as data: selectFoldBlock hands out 0x335e with count 30 and
 * foldBlockIntoTotal sums those 30 bytes into the anti-tamper total later checked vs 0x76 [seen]
 */
export const seatCaptionPenFromEraFoldingTamperIntoPhase_ADDR = 0x335e;
export const STICK_HEADING_TABLE = 0x1f2e; // ROM byte table turning the stick's direction bits into the heading the ship turns toward (turnShipTowardTargetHeading, `ld hl,0x1f2e / rst 0x08` at 0x1F01); the bytes are also routine 0x1f2e's own code [seen]
export const ONE_SHOT_OBJECT_SHAPE_TABLE = 0x4094; // ROM sprite-shape byte table keyed on the slot's countdown (runOneShotAnimatedObjectSlot) [seen]
export const PARACHUTIST_FLIGHT_SHAPE_TABLE = 0x47ea; // 8-entry ROM in-flight parachutist sprite-shape table keyed on FRAME_TICK (runParachutistSlot) [seen]
export const COUNTDOWN_SLOT_SHAPE_TABLE = 0x3ec3; // 8-shape ROM animation table (each held 4 counts) for the countdown/drift object slot (runSlotCountdownDriftAndAnimateElseRetire) [seen]
export const EXPANSION_SOCKET_PROBE = 0x6000; // power-on probe of the expansion-ROM socket at the 0x6000 ROM-region boundary (read cp 0x55; empty socket floats high) (seatTheStackAndSettleTheControlLatch) [seen]
export const SPRITE_RAM_BASE = 0xb000; // base of sprite RAM (0xb000); the ROM seats the stack pointer here at boot and the stack grows down below it (outermost push lands at 0xafff/0xaffe); 0xb000-0xb00f are never accessed [seen]
export const DISPLAY_ON_VALUE = 0x2d4b; // ROM byte (=0x01) written to VIDEO_ENABLE_LATCH at boot to turn the picture on; parallels DISPLAY_OFF_VALUE (seatTheStackAndSettleTheControlLatch) [seen]
/**
 * 4-entry packed ROM (native-Y, native-X) starting-position table seating the four scenery object
 * pairs: Y to +0x31 (and +0x10 to the next slot's), X to +0x00 of both
 * (seedSceneryEntriesThenRunScenery) [seen]
 */
export const SCENERY_SEED_TABLE = 0x316e;
export const NMI_REENABLE_BYTE = 0x1600; // ROM byte (=0x01) written to the NMI-enable latch 0xc300 to reopen the interrupt gate in the vblank epilogue (sendOneQueuedSoundThenUnwindTheFrameInterrupt); distinct from NMI_ENABLE_BYTE 0x4c87 [seen]
export const AUDIO_IRQ_LATCH = 0xc304; // hardware LS259 bit 2 = audio IRQ (board LATCH_AUDIO_IRQ); write-only 1/0 pulse waking the audio Z80 after the 0xc000 sound-latch write (sendSoundCommand) [seen]
export const PARACHUTIST_AWARD_SHAPE_TABLE = 0x482d; // 4-entry ROM sprite-shape table for the parachutist award pose (showParachutistAward) [seen]
export const EDGE_SPAWN_COORD_TABLE = 0x488d; // 16x2-byte ROM table of edge spawn positions by heading sector: byte 0 -> sprite entry +0x31 (Y), byte 1 -> +0x00 (X) (spawnAtEdgeAhead) [seen]
export const WAVE_RUN_SELECTOR_TABLE = 0x38d2; // ROM table mapping a craft's wave ordinal to its shape-run selector (slot+0x0a) (spawnEnemyWaveIntoFreeSlots) [seen]
export const TURN_RATE_BY_ERA_TABLE = 0x2c1d; // 5-entry per-era ROM turn-rate (heading step size) table (steerTowardAimHeading) [seen]
export const SHAPE_RUN_POINTER_TABLE = 0x3438; // ROM word-pointer table; each entry points to a shape-byte run the record animates through, keyed by RUN_SELECTOR (stepShapeAnimation) [seen]
export const COINAGE_VALUE_TABLE = 0x4b95; // 16-entry ROM table turning a DIP coinage nibble into a coin-per-credit value (unpackCoinage) [seen]

// Code addresses used as values: routine entries (<name>_ADDR).
export const blankNextLine_ADDR = 0x01c2; // entry address of routine 0x01c2 [seen]
export const advanceAttractTowardGameStart_ADDR = 0x0f54; // entry address of routine 0x0f54 [seen] (MAME: dispatchSequenceSubStepArm pushes it as the arm's return slot, pc 0x0f22 writes 0x54/0x0f to the stack; pc 0x0f54 executes)
export const advanceSequenceElseStartFreePlayGame_ADDR = 0x167b; // entry address of routine 0x167b [seen]
export const commissionStagedAttackerByEra_ADDR = 0x42b7; // entry address of routine 0x42b7 [seen]
export const parkTheImageTotalForTheTamperVerdict_ADDR = 0x07ad; // entry address of routine 0x07ad [seen]
export const serviceVerticalBlankInterrupt_ADDR = 0x00d9; // entry of the vblank service (0x00d9), which the push af at 0x00d8 falls into [seen]
export const sendOneQueuedSoundThenUnwindTheFrameInterrupt_ADDR = 0x0174; // entry of the frame-service epilogue (0x0174), used as a return address [seen]
export const serviceSlotByMarkerThenCloseSweepTurn_ADDR = 0x40ea; // routine 0x40ea as a code target -- the object-bank sweep body (sweepEra2PlusObjectBank) [seen]
export const SECOND_FASTEST_VELOCITY_TABLE = 0x2e3e; // ROM table of 256 16-bit velocity words, peak 306, second rung from the top of the velocity ladder: the era-1/2 pace (scrollWorldAtTheEraPace), also read by flyAtSecondFastestSpeed/loc_5965/setMotherShipVelocityFromHeading; the same address is the tamper-trap jump target in showCreditLine [seen]
export const SLOWEST_VELOCITY_TABLE = 0x59d7; // ROM table of 256 16-bit velocity words, peak 206, the bottom rung of the velocity ladder, read by chaseOneAimPointAndRetireAtTheLine, flyAtSlowestSpeed, setMotherShipVelocityFromHeading and loc_58aa/loc_5942/loc_598e/loc_59c5; the same address is the derail target of the whole-ROM checksum in clearScreenRamAndVerifyImageThenColdInit [seen]

// ROM data-table and cell bases shared by the velocity, bonus, sprite-frame, checksum, tile, demo-script, sound and
// self-test modules; roles read from the modules' use and the ROM disassembly (contrib Code.md).
export const OPENING_ERA_VELOCITY_TABLE = 0x5e00; // ROM velocity table for the opening era (scrollWorldAtTheEraPace's era-0 pace, loc_594e); also read by loc_59d1/loc_58b6/loc_5854 [seen]
export const VELOCITY_TABLE_5C00 = 0x5c00; // ROM velocity table, era not determined (peak 231, second rung from the bottom of the velocity ladder); read by loc_59cb/loc_5994 [seen]
export const VELOCITY_TABLE_08FA = 0x08fa; // ROM velocity table for the pace of era 3 and up (scrollWorldAtTheEraPace), also read by flyAtFastestSpeed; the same address doubles as the anti-tamper checksum-failure landing (routine loc_08fa) [seen]
export const BONUS_LIFE_MARK_TABLE_BIT0_CLEAR = 0x4e1b; // ROM score-mark list used when BONUS_LIFE_SETTING bit0 is clear (awardBonusLifeAtScoreMark) [seen]
export const BONUS_LIFE_MARK_TABLE_BIT0_SET = 0x4e30; // ROM score-mark list used when BONUS_LIFE_SETTING bit0 is set (awardBonusLifeAtScoreMark) [seen]
export const NEAR_ERA_SPRITE_FRAME_TABLE = 0x416e; // ROM sprite-frame table for the near eras, ERA_INDEX < 4 (stepDriftingCountdownObjectByEraFrames) [seen]
export const FAR_ERA_SPRITE_FRAME_TABLE = 0x4183; // ROM sprite-frame table for the far eras, ERA_INDEX >= 4 (stepDriftingCountdownObjectByEraFrames) [seen]
export const COPYRIGHT_IMAGE_CHECKSUM_BASE = 0x176a; // base of the 24-byte program block XOR-folded as the copyright-screen anti-tamper check (buildCopyrightScreenThenVerifyImage) [seen]
/**
 * char-plane cell whose glyph+colour is sampled before the line wipe
 * (parkSpritesAndArmLineWipeThenAdvanceSequence). Under MAME its glyph and colour twin 0xa1fc are
 * copied to 0xacbe/0xacbf just before the wipe is armed [seen]
 */
export const LINE_WIPE_SAMPLED_CELL = 0xa5fc;
/**
 * 2-byte work-RAM record the sampled cell's glyph+colour is copied into
 * (parkSpritesAndArmLineWipeThenAdvanceSequence); also written by the attract high-score patch list
 * and copyThreeTilemapCellsFromBothPlanes; no role read by any routine [seen]
 */
export const LINE_WIPE_SAMPLE_RECORD = 0xacbe;
export const PRESHIFTED_TILE_RECORD_TABLE = 0x53d4; // base of the 64 pre-shifted tile-block records, 4 glyph/attr pairs each (queueTileStampForObject) [seen]
export const COLOUR_PLANE_BASE = 0xa000; // base (0xA000) of the colour-RAM plane the deferred-write cell address is built from; the drain sets bit 10 to reach the video plane at 0xA4xx (queueTileStampForObject) [seen]
export const DEMO_AUTOPILOT_SCRIPT_FIRST = 0x218c; // ROM heading-command script, first of three (seedDemoAutopilotScript) [seen]
export const DEMO_AUTOPILOT_SCRIPT_SECOND = 0x2251; // ROM heading-command script, second of three (seedDemoAutopilotScript); the same address doubles as the readback-fail trap (routine loc_2251) [seen]
export const DEMO_AUTOPILOT_SCRIPT_THIRD = 0x22fa; // ROM heading-command script, third of three (seedDemoAutopilotScript) [seen]
export const TRANSITION_SOUND_CODE_CELL_167C = 0x167c; // program-image byte read as a sound code (enqueueTransitionSoundBurst) [seen]
/**
 * program-image byte read as a sound code (enqueueTransitionSoundBurst) [seen] (MAME read-tap: pc
 * 0x5640 ld a,(0x1484) reads 0x9d, passed to enqueueSoundUnconditional; sound-queue store 0x5631
 * writes 0x9d)
 */
export const TRANSITION_SOUND_CODE_CELL_1484 = 0x1484;
export const TRANSITION_SOUND_CODE_CELL_33B4 = 0x33b4; // program-image byte read as a sound code (enqueueTransitionSoundBurst) [seen]
export const BAND_SCRIPT_START = 0x56f1; // ROM start of the band animation's script, stored into BAND_SCRIPT_CURSOR when a won round's band animation is set up (armRoundWonBandAnimationThenStepSequence) [seen]
export const DIFFICULTY_RECORD_TABLE = 0x186a; // base of the fixed 4-byte-record difficulty table copied into the in-force settings cells (loadDifficultyRecord) [seen]
export const COLOUR_FLOOD_FIRST_CELL = 0xa044; // first (top-left inset) cell of the colour-plane flood rectangle (floodColourPlaneWithSavedPlayerColour) [seen]

// High-score initials entry and its sequence arms (erasePenRouteThenOpenInitialsEntry, stepHighScoreInitialsEntry
// and the phase-3 sub-step arms 4-9).
export const INITIALS_LOCKED_LETTER_COLOUR = 0xa990; // colour a committed initial is painted in: the first entry cell's colour-plane byte, captured when the entry opens and written onto each letter's colour cell as it locks, replacing the cursor's flash colour [seen]
export const INITIALS_BACK_PRESS_HISTORY = 0xa995; // press history of the facing panel's LEFT control, shifted in every even frame of initials entry: a fresh press steps the letter back round its 27-letter ring, at 0x7F (held) it is emptied through rearmHeldControlRepeat so a held LEFT auto-repeats; zeroed when the entry opens [seen]
export const INITIALS_FORWARD_PRESS_HISTORY = 0xa996; // press history of the facing panel's RIGHT control during initials entry: a fresh press steps the letter forward (26 wraps to 0), at 0xFF it is emptied through rearmHeldControlRepeat so a held RIGHT auto-repeats; zeroed when the entry opens [seen]
export const INITIALS_COMMIT_PRESS_HISTORY = 0xa997; // press history of the facing panel's FIRE button during initials entry: a fresh press locks the shown letter into the next slot; never re-armed, so a held FIRE commits once; zeroed when the entry opens [seen]
export const INITIALS_ALT_COMMIT_PRESS_HISTORY = 0xa998; // press history of the panel's bit-0x20 control (not bound in this cabinet's input map) during initials entry: a fresh press locks the letter exactly like FIRE and is tested first; zeroed when the entry opens [seen]
export const INITIALS_LETTER_INDEX = 0xa999; // index (0..26) of the letter shown at the initials cursor, selecting its glyph from INITIALS_LETTER_GLYPH_TABLE: zeroed when the entry opens, stepped by forward/back, reset to 0 after each committed letter [seen]
export const INITIALS_SLOTS_LEFT = 0xa99a; // count of initials still to enter: set to 3 when the entry opens, decremented on each committed letter; reaching 0 finishes the entry [seen]
export const INITIALS_CURSOR_FLASH_TIMER = 0xa99c; // initials cursor blink counter: incremented every odd frame of the entry, bit 4 picks the cursor cell's colour (0x14 over 0x10); zeroed whenever the cursor letter is redrawn [seen]
export const INITIALS_LETTER_GLYPH_TABLE = 0x12c7; // 27-entry ROM table mapping INITIALS_LETTER_INDEX to the glyph drawn at the entry cursor and locked into the saved initials: A..Z in order, then one final non-letter mark (glyph 0x1a, whose tile is a small dot); MAME read indices 0, 1 and 26, and the A..Z order rests on matching the tile bitmaps against the caption font [seen]
export const ROUND_START_CHECKSUM_BASE = 0x4c99; // base of a 256-byte ROM anti-tamper block XOR-folded by the round-start sequence arm (sub-step 4); any fold but 0x6b advances the outer sequence phase [seen]
export const INITIALS_ENTRY_CHECKSUM_BASE = 0x4880; // base of a 256-byte ROM anti-tamper block XOR-folded by the initials-entry setup arm (sub-step 9); any fold but 0x30 derails into the frame service [seen]
export const HIGH_SCORE_FILED_CHECKSUM_BASE = 0x01f1; // base of a 256-byte ROM anti-tamper block summed to 8 bits by the game-over hold arm on the path where the score was filed; any total but 0x19 advances the outer sequence phase [seen]
export const SKIP_INITIALS_SUBSTEP_SEED = 0x0843; // ROM code byte (0x0b, operand of the call at 0x0841) read as a value: seeds SEQUENCE_SUBSTEP when the finished score beats no high-score record, so the sequence bypasses the initials setup (sub-step 9) and entry (sub-step 10) [seen]
export const ROUND_INTRO_CHECKSUM_BASE = 0x4d9f; // base of a 256-byte ROM anti-tamper block subtract-folded into SEQUENCE_PHASE then XORed with 0xa2 by the round-intro arm (phase-3 sub-step 5, flyRoundIntroFlashingEraYearThenEraseIntroCaptions); nets out on a genuine image [seen]
export const LEAD_IN_CHECKSUM_BASE = 0x0831; // base of the first 256-byte ROM anti-tamper block the lead-in arm (phase-3 sub-step 6, flyEnemyFreeLeadInThenStepSequence) subtract-folds into SEQUENCE_PHASE (closed by XOR 0xc2) every frame; nets out on a genuine image; the block is live code (it starts inside drawKillMeter) read here as data [seen]
export const LEAD_IN_EXPIRY_CHECKSUM_BASE = 0x12a7; // base of the second 256-byte ROM anti-tamper block the lead-in arm subtract-folds into SEQUENCE_PHASE (closed by XOR 0x59) on the frame SEQUENCE_DELAY expires; nets out on a genuine image [seen]

export const ROUTINES = {
  0x0774: {
    name: "postRoundStartCaptionsAndResetPlayfield",
    role: "round-start arm of the phase-3 sub-step table (entry 4 of 0x0F29): post the round-start captions to the command ring, repaint the kill meter (drawKillMeter), reset the playfield for the new round (resetPlayfieldAndArmNewRound), then step the sequence sub-index (advanceSequenceSubStep). With PLAY_ACTIVE clear it posts caption 2 (' READY ') only. With PLAY_ACTIVE set it posts caption 9 or 10 ('PLAYER 1' or 'PLAYER 2', chosen by ACTIVE_PLAYER). That is followed by command 7 (drawRoundNumberCaption) when ROUND_ARMED is set, or by ' READY ' again when it is clear. Before this, an XOR fold of the 256 program bytes at 0x4C99 must come to 0x6B, or the arm advances the sequence phase. This anti-tamper guard does nothing on a genuine image.",
    cert: "seen",
    why: "the name claims the arm posts the round-start captions and then resets the playfield, and the ROM could have refuted either half: command table 0x0BBC slot 2 is drawCaptionInPenColour and slot 7 drawRoundNumberCaption, and caption records 2/9/10 in the 0x0C50 table decode consistently to READY / PLAYER 1 / PLAYER 2 (the shared R/E/A/Y letters, and R/E/D against the CREDIT record 8), while the call that follows is resetPlayfieldAndArmNewRound; the anti-tamper fold and the sub-step tail are shared by every arm and left out. Under MAME the branch selection on PLAY_ACTIVE, ACTIVE_PLAYER and ROUND_ARMED and the callees are observed; the on-screen glyph text of the captions remains a code-level reading",
  },
  0x08b4: {
    name: "erasePenRouteThenOpenInitialsEntry",
    role: "phase-3 sub-step arm 9 (dispatch table 0x0f29), between the score-filing hold (arm 8, which sets the pen to the blanking glyph 0xF1 and re-arms the pen route) and the per-frame initials entry stepHighScoreInitialsEntry (arm 10). Each frame it runs one leg of the pen route through drawInterpolatedPenRun, so the route is erased, and returns until the route reseats to a zero row. It then XOR-folds the 256 program bytes at 0x4880 and derails on anything but 0x30 (anti-tamper; this never fires on a genuine image). It lays out the initials-entry screen: posts caption commands (1,0x13/0x00/0x14/0x15/0x0c) and paints the five labelled readouts. It seats the entry state stepHighScoreInitialsEntry consumes: the control press histories 0xA995-0xA998 are cleared, the letter index 0xA999 is set to 0 and the slots-left count 0xA99A to 3 (three initials). It stamps letter 0's glyph (ROM 0x12c7) at the new record's initials cell held in SCRATCH_PTR_B, saves that cell's colour-plane byte to 0xA990 (the colour committed letters are painted in), and steps the sequence sub-step.",
    cert: "seen",
    why: "the pen-run gate could have been a DRAW rather than an ERASE, and the preceding arm settles it: fileScoreAfterGameOverHoldElsePassTurn (arm 8) sets PEN_GLYPH=0xF1 (the blanking glyph) and PEN_COLOUR=0 right before re-arming the pen route and nothing between the two arms changes PEN_GLYPH, the same pattern as the sibling erasePenRouteThenAdvanceStep; 'OpenInitialsEntry' is refutable by the next arm, and stepHighScoreInitialsEntry (arm 10) consumes every cell this seeds -- the four press histories, INITIALS_LETTER_INDEX, INITIALS_SLOTS_LEFT=3 and INITIALS_LOCKED_LETTER_COLOUR. Under MAME this arm writes those cells and stepHighScoreInitialsEntry then reads them; what the erased route covers on screen is not MAME-checked",
  },
  0x16af: {
    name: "flyRoundIntroFlashingEraYearThenEraseIntroCaptions",
    role: "round-intro hold, entry 5 of the phase-3 sub-step table at 0x0F29 (between the round-start arm 0x0774 and the enemy-free lead-in 0x5694): each frame it subtract-folds the 256-byte image block at 0x4D9F into SEQUENCE_PHASE and xors 0xA2 (nets out on a genuine image), then flies the ship over the era scenery with no enemy or collision service (dispatchPlayerFrameByState and runSceneryForEra between two sprite-fixup passes, closed by multiplexSpriteSlots). While ROUND_ARMED is set, FRAME_TICK low nibble 0/5/10 repaints the era's year caption (A.D. 1910/1940/1970/1982/2001, index 0x1A+ERA_INDEX) through the +0/+5/+10 shared-colour painters, so it flashes. SEQUENCE_DELAY counts down on odd frames; on expiry it erases the PLAYER-n line (caption 9), STAGE (0x0E) and the year line (0x1A), clears ROUND_ARMED, re-arms SEQUENCE_DELAY to 0x2A and advances the sequence sub-step",
    cert: "seen",
    why: "'EraYear' could have been refuted by the caption data: the records at 0x1A-0x1E of the 0x0C50 caption table share a prefix and differ only in a four-glyph digit run, and the digit glyphs 0x96='1' and 0x9b='2' are fixed independently by captions 9 and 10 (PLAYER 1 / PLAYER 2), so the flashed caption indexed by 0x1A+ERA_INDEX is the era's year; 'EraseIntroCaptions' is the expiry path's command 3 on captions 9, 0x0E and 0x1A; the flight runs only the player-side services, no enemy or collision service. Under MAME the flight calls and the expiry path's caption commands are observed",
  },
  0x18c3: {
    name: "stepHighScoreInitialsEntry",
    role: "one frame of the high-score initials-entry screen (arm 10 of the phase-3 sub-step table): on even FRAME_TICK frames roll the facing panel's back/forward/two commit controls into their press histories (INITIALS_BACK/FORWARD/COMMIT/ALT_COMMIT_PRESS_HISTORY); a fresh commit locks the shown letter's glyph (INITIALS_LETTER_GLYPH_TABLE indexed by INITIALS_LETTER_INDEX) into the filed record's initials cell (SCRATCH_PTR_A) and the on-screen cursor cell (SCRATCH_PTR_B), colours it from INITIALS_LOCKED_LETTER_COLOUR, steps both on and counts down INITIALS_SLOTS_LEFT (seeded to 3), finishing on the last slot; a fresh forward/back steps the letter index round 0..26 and redraws the cursor; a saturated history is emptied through rearmHeldControlRepeat so a held control repeats; on odd frames flash the cursor colour (INITIALS_CURSOR_FLASH_TIMER bit 4); every eighth frame tick SEQUENCE_DELAY, and when it runs out blank the cursor cell (0xF1) and finish. Finishing re-arms SEQUENCE_DELAY=60, queues the transition sounds and steps the sequence sub-step. Otherwise, with both players out of lives, a held start button with credit (or free play) hides all sprites and starts the next game",
    cert: "seen",
    why: "the dominant live-outs are glyph writes through SCRATCH_PTR_A/B, which fileScoreIntoHighScoreTable parks at the filed record's initials cells and the initials-glyph VRAM row, and every cell it steps is seeded by erasePenRouteThenOpenInitialsEntry (arm 9) -- three slots, zeroed press histories, letter 0; the entry ends by stepping the sub-step after the third commit or on timeout. 'step' matches the sibling sequence arms (stepCopyrightScreenAwaitingStart); the start-next-game poll at the tail is a secondary shared poll and stays out of the name",
  },
  0x294c: {
    name: "serviceEra1EnemyCraftSlot",
    role: "era-1 per-slot enemy-craft update, index 1 of the era table at 0x2914 (ERA_INDEX&7 == 1). It branches on the slot's status byte at (ix+0): 0 (empty) returns; 0xFE (held) releases the held object; any other value except 0xFF steps the dying state; 0xFF (active) steers toward the aim heading and flies one step at the 0x5E00 velocity-table pace. If the craft has reached the retire line it retires the slot; otherwise it makes one gated enemy-launch attempt and redraws the sprite from its heading in the second era's shape bank and tint",
    cert: "seen",
    why: "'Era1' is refutable by the dispatch and was not refuted: this is index 1 of the era table at 0x2914, it has the same 0/0xFE/other/0xFF status ladder as the named siblings serviceEra0/2/3/4EnemyCraftSlot, its flight step uses the 0x5E00 velocity table where era 0 calls 0x5840, and its final callee refreshSecondEraSpriteFromHeading is dispatched only at era 1 under MAME (that callee's own why)",
  },
  0x330b: {
    name: "fileScoreAfterGameOverHoldElsePassTurn",
    role: "phase-3 sub-step 8 arm (entry 8 of the 0x0F29 table): count SEQUENCE_DELAY down and return while it is nonzero, so the GAME OVER banner stays up for the hold postGameOverBanner armed; on expiry file the score (fileScoreIntoHighScoreTable). A score that beats no record posts command 3 (eraseTextRunByIndex) for captions 9 (PLAYER) and 11 (GAME OVER), reseats SEQUENCE_SUBSTEP to 0x0B (program byte at 0x0843) and tails into passTurnToOtherPlayerIfLivesElseStepSequence. A filed score requests a sound (requestHighScoreFiledSound), sets PEN_COLOUR=0 / PEN_GLYPH=0xF1 (blanking) and re-arms the pen route so it erases, checks that the 256 program bytes at 0x01F1 sum to 0x19 (advanceSequencePhase otherwise), then steps to sub-step 9, the start of initials entry",
    cert: "seen",
    why: "'GameOverHold' is refutable by the arm that arms the delay: serviceRoundThenResolvePlayerState leads to postGameOverBanner (0x1253), which posts the GAME OVER captions, sets SEQUENCE_DELAY to 0xB4 and steps sub-step 7 to 8, so this countdown is that banner's hold; 'fileScore' is fileScoreIntoHighScoreTable on expiry; 'ElsePassTurn' is the carry-set path, which erases captions 9 and 11 (PLAYER, GAME OVER), seeds SEQUENCE_SUBSTEP past the initials arms from ROM 0x0843 (=0x0B) and tails into passTurnToOtherPlayerIfLivesElseStepSequence. Only the entry path from 0x1253 was checked",
  },
  0x40ea: {
    name: "serviceSlotByMarkerThenCloseSweepTurn",
    role: "the turn body of the object-bank sweep, entered by sweepEra2PlusObjectBank with the record cursor, the sprite-entry cursor and the turn count already set, and run again by closeOneTurnOfTheSlotSweep while turns remain. It branches on the slot's marker byte (ix+0). A free slot (0x00) goes straight to the turn-closer. Any marker other than 0xFF is the object's own countdown: the slot is stepped by stepDriftingCountdownObjectByEraFrames and the turn is then closed by closeOneTurnOfTheSlotSweep. A full marker (0xFF) goes to stepSlotApproachThenBreakawayRetire when ERA_INDEX is 4. Otherwise it goes to flyLiveSlotAndTickCountdown when the record's countdown at +0x0e is nonzero, or to one chaseOneAimPointAndRetireAtTheLine frame and then the turn-closer. Every arm ends by closing the turn, so one call services this slot and every slot after it in the bank",
    cert: "seen",
    why: "every arm ends by closing the turn: the free-slot arm jumps to 0x410b, the countdown arm goes through stepCountdownSlotThenCloseTurn which falls through into the closer, and the full-marker arms each end at closeOneTurnOfTheSlotSweep, which re-enters this body while turns remain -- so one call services this slot and every slot after it, which a per-slot 'handler' name would miss. The era-2 gate belongs to the entry (sweepEra2PlusObjectBank), not this body, whose only era test is ERA_INDEX==4, so the name carries no era",
  },
  0x4108: {
    name: "stepCountdownSlotThenCloseTurn",
    role: "service one counting slot of the per-slot object sweep (marker byte ix+0 neither free 0x00 nor full 0xFF, so the marker is the object's own countdown): run the object one frame via stepDriftingCountdownObjectByEraFrames (re-stamp and sound at the reset mark, drift with the world, count down, retire at zero, era-chosen animation frame inside the window), then close the turn -- advance the record cursor by 0x10 and the sprite cursor by 2, and run the next turn while the count remains",
    cert: "seen",
    why: "the body is exactly one stepDriftingCountdownObjectByEraFrames frame followed by the byte-for-byte fall-through into closeOneTurnOfTheSlotSweep (0x410b: stride, djnz back to 0x40ea), and its only entrant is serviceSlotByMarkerThenCloseSweepTurn's marker 1..0xFE arm (`inc a / jr nz,0x4108` after `and a / jp z,0x410b`) -- the marker being the object's own countdown. Whether the object is debris or an explosion is not settled by the code, so the name stays 'countdown slot'",
  },
  0x43b7: { name: "armMotherShipOrStep", role: "once-in-eight-frames gate for the Mother-Ship: while the wave-hold flag 0xacc6 is clear, defer to the deep-state stepper (loc_43f0) if it is already live (MOTHER_SHIP_ARMED 0xad0d != 0), else -- only when the kill quota (KILLS_REMAINING 0xad02) is spent and both records of its two-slot bank (0xa8a0/0xa8b0) read empty -- arm it (0xad0d=0xff), seed the lead record's seven-hit counter (ix+0x04=0x07), and retire the matching entry pair into cooldown to spawn it", cert: "seen" },
  0x1199: { name: "serviceRoundThenResolvePlayerState", role: "the round engine's service list (substep 7 of the phase-3 dispatch at 0x0f29; runs per dispatch, short of the frame count): run each subsystem service in fixed order, then read the player-state byte at 0xa800 and advance the round when it is 0xff (alive), hand a life over when it is 0 (dead), else return", cert: "seen" },
  0x31b4: { name: "reaimAndAnimateEnemyCraftOnPhaseTick", role: "on the 00s and 30s tenths of the packed-decimal life counter 0xad05, service enemy-craft slot (units digit, only slots 0-6 whose record head at 0xa850 reads 0xff): advance that record's shape animation, then unless the state byte at ix+8 is 0x10 re-aim its heading toward a point the state byte indexes out of the aim table at 0xac65 -- state 0x11 aims at the table base, stores heading+0x80 into ix+1 and resets the record to state 0x10, every other state stores the heading straight into ix+1; on every other tenth hand off to layOutEnemyAimPointsFromScrollAngle", cert: "seen" },
  0x36af: { name: "driveEnemyWaveForLifePhase", role: "enemy-wave substep: while the wave-hold cell 0xacc6 is clear, dispatch by era and life-phase -- era 4 to spawnEnemyWaveIntoFreeSlots, phase 7 to stopFiveSlotAnimations, phase below 7 to gateTheFreeSlotSearchAndPickItsRun, phase 8 to spawnEnemyCraftWhenBandUnderTwo; at phase 9+ with the low life-tick 0xad05 spent, spawn a fresh wave inline across the 0xa850/0xaa1a craft band from a heading-biased shape run, then request a sound once enough of the five slots filled", cert: "seen" },
  0x40d6: { name: "sweepEra2PlusObjectBank", role: "entry to the per-slot sweep over an object bank: return early below era 2 (ERA_INDEX 0xad04) or when the bank's slot count (0xa8c6) is zero, else seat the record cursor (0xa8c0), the sprite-entry cursor (0xaa28) and the turn count, and run the sweep body at 0x40ea", cert: "seen" },
  0x3b5f: { name: "serviceEra1BomberObject", role: "era-1 only: dispatch the single object at record 0xa8c0 by its head byte -- 0 arms its fire timer (armBomberSlotWhenTimerFires), 0xff runs the two-tile move (advanceTwoTileObjectThenTryAimedSpawn), any other value advances a hit-soaking object toward death (advanceHitSoakingObjectThenAnimateDeath); returns untouched outside era 1", cert: "seen" },
  0x3fea: { name: "serviceEra0BallisticObjectBank", role: "era-0-only entry to the three-slot ballistic-object bank, run from the round engine's service list (serviceRoundThenResolvePlayerState): returns at once unless ERA_INDEX 0xad04 is 0, else starts at the bank's first slot (record 0xa8c0, sprite entry 0xaa28, three slots) and routes the first slot by its marker byte -- step an empty slot via advanceSlotThenSweepObjectBankByHead, fly a ballistic (0xFF) slot then step it, else hand any other marker to sweepObjectSlotBankServicingFirstSlot", cert: "seen" },
  0x4e4f: { name: "dispatchCollisionPassByEra", role: "dispatch one round's per-frame collision pass by ERA_INDEX (0xad04): era 4 to dispatchEra4CollisionByFrameParity, era 1 to splitCollisionWorkByFrameParity, every other era split on FRAME_TICK's (0xa980) low bit to dispatchShotSweepByMotherShipArmed (odd) else runAllCollisionSweepsThisFrame (even); reached from the substep-7 dispatcher 0x1199", cert: "seen" },
  0x2927: { name: "serviceEra0EnemyCraftSlot", role: "era-0 per-object update dispatched by index 0 of the rst-0x30 era table at 0x2914: on the object status byte at (ix+0) it leaves an empty slot (0), releases a held object (0xFE), steps a dying one (any other value), or steers/flies/refreshes an active craft (0xFF) and lets it spawn, retiring it the frame it reaches the line", cert: "seen" },
  0x2984: { name: "serviceEra2EnemyCraftSlot", role: "era-2 per-slot object handler (index 2 of the 0x2914 rst-0x30 era table, ERA_INDEX 0xad04 low three bits == 2), dispatched on the slot's state byte (ix+0): 0x00 idle returns; 0xFF active steers toward its aim 3 frames in 4, flies at the slowest speed, retires the slot once it reaches a retire line, else dresses its sprite and runs two gated enemy-launch attempts; 0xFE releases the held object; any other value steps the dying-object state", cert: "seen" },
  0x29b0: { name: "serviceEra3EnemyCraftSlot", role: "era-3 per-object-slot step, dispatched on the slot's lifecycle byte at ix+0: idle does nothing; a live slot (0xff) is steered and flown a step, then either retired at the line or given a bank launch attempt, dressed, and given an attacker launch attempt; 0xfe releases a held slot; a lower value is a death-countdown step", cert: "seen" },
  0x29d5: { name: "serviceEra4EnemyCraftSlot", role: "era-4 (ERA_INDEX 0xad04=4) per-object slot service, index 4 of the 0x2914 rst-0x30 table: on the slot's lifecycle byte at (ix+0) it returns when free (0), releases when held (0xfe), steps the dying animation for any other value, and when live (0xff) steers the slot toward the ship then either retires it once it reaches a retire line or animates its shape, runs the gated launch attempt, and launches an attacker into a free slot", cert: "seen" },
  0x0069: { name: "clearWorkRamAndSpriteBanksThenColdInit", role: "cold-start clear reached once at boot via 0x07B1: kicks the watchdog four times, zeroes the 0xB410 sprite-bank run and the whole 2 KB work RAM, sums the fixed 256-byte program run at 0x00D8 and runs the frame service out of band on a non-genuine total, then hands off to the screen-RAM clear and image verify", cert: "seen" },
  0x210e: { name: "seedDemoAutopilotScript", role: "seeds the attract-demo autopilot: picks a heading-command script by the demo selector (0xad14), writes its dwell counter to 0xadf2 and little-endian pointer to 0xadf3/4, then on a failed tile-image tamper readback (0xadfb/0xadfc) tail-jumps into the trap", cert: "seen" },
  0x5694: {
    name: "flyEnemyFreeLeadInThenStepSequence",
    role: "phase-3 sub-step-6 arm (entry 6 of the table dispatchSequenceSubStepArm reads), the timed lead-in between the caption hold (sub-step 5) and the round engine (sub-step 7, serviceRoundThenResolvePlayerState). Each dispatch runs only the player-side services: sprite fixup, the player frame (dispatchPlayerFrameByState), sprite fixup again, the era scenery (runSceneryForEra), the player shots (fireAndSweepPlayerShots) and the sprite multiplex. No enemy-wave, object-slot, collision or round-resolution service runs, so the ship flies and fires over a field whose object slots were retired at the round arm. It then counts SEQUENCE_DELAY down once per dispatch, with no frame-parity gate, and returns while the delay is nonzero. On expiry it steps the sub-step into the round engine. Both ends subtract-fold a 256-byte program block into SEQUENCE_PHASE (0x0831 closed with xor 0xC2, then 0x12A7 closed with xor 0x59). This anti-tamper fold nets to zero on a genuine image.",
    cert: "seen",
    why: "'EnemyFree' is refutable by comparing service lists: the next arm, serviceRoundThenResolvePlayerState (sub-step 7), runs a strict superset of this arm's calls, adding the enemy-craft, wave, parachutist, era object-bank, collision, bonus-life and kill-meter services this arm leaves out, and resetPlayfieldAndArmNewRound (sub-step 4) retires every object slot before it. Under MAME the service list is observed -- the player-side calls only, no enemy, slot or collision call -- though the on-screen absence of enemies is not pixel-checked; the arm also runs in the attract demo",
  },
  0x5866: { name: "clearScreenRamAndVerifyImageThenColdInit", role: "cold-start clear then ROM tamper check: fill colour RAM 0xA000-0xA3FF with 0x10 and video RAM 0xA400-0xA7FF with 0xf1 (bases from ROM pointers at 0x2581/0x4A37), sum the whole program ROM 0x0000-0x5FFF and test the total against 0xAF, kicking the watchdog after the first fill and once per summed byte; a genuine image tail-calls cold-start init, a tampered one derails into data at 0x59D7", cert: "seen" },
  0x4bdc: { name: "paintFiveLabelledNumericReadouts", role: "paint five labelled numeric readouts up the tile plane: seat each of five source records (0xab08, stride 8), its tile-plane cursor cell (0xa711, stride 2) and its pen colour, then hand to the column painter paintLabelledNumericReadoutColumn; writes tile/colour cells 0xa0f1-0xa719", cert: "seen" },
  0x19f0: { name: "resetPlayfieldAndArmNewRound", role: "reset the whole playfield for a new round: clear scroll/control cells, seat the ship sprite + shot slots, retire every object slot (hold/shared-cooldown/cooldown/sub-pixel variants), clear four sprite entries, seat the era scenery band via seatEraSceneryRowThenClearAndRunScenery, then scatter one era-selected 10-byte record from the 0x1B04 word table into the cells that arm the round", cert: "seen" },
  0x3b94: { name: "advanceHitSoakingObjectThenAnimateDeath", role: "advance one hit-soaking object: while HITS_REMAINING (0xa8dc) is left, spend one, force the record head live (0xff) and re-request its sound pair before the ordinary two-tile move; once no hits remain, run the record head down (capped at 0x61) toward a retire-and-hold at 0, drift it with the world scroll, and at head 0x40 post a command / on 8-step boundaries above 0x40 reseat the sprite shape from the 0x3c09 table", cert: "seen" },
  0x3b77: { name: "advanceTwoTileObjectThenTryAimedSpawn", role: "advance a two-tile object one frame: fly it along its stored velocity, then seat its second tile directly under the first (same X, Y+0x10); if hasReachedBoundaryBandSelectedByHeading answers it has reached a boundary retire it, otherwise dress the pair by heading and run the aimed-spawn attempt", cert: "seen" },
  0x167b: { name: "advanceSequenceElseStartFreePlayGame", role: "a shared tail of the two-level sequence machine: when the packed-decimal credit count (0xA986) is nonzero, step the outer sequence phase and return; otherwise, only when the free-play flag (0xA9C0) is set and a start-button bit (0xA9AE & 0x18) is held, hide every sprite and start a game charging no credit", cert: "seen" },
  0x23e3: { name: "fireAndSweepPlayerShots", role: "fire and sweep the player's shots: on a fire-button rising edge arm and seed one shot into a free slot of the six-slot shot bank at 0xaa80 aimed along PLAYER_HEADING; then advance every live shot by the world scroll, queue its character-cell tiles, and cull any that leaves the field or holds a stale head", cert: "seen" },
  0x1edf: { name: "dispatchPlayerFrameByState", role: "seat the player record (ix=0xa800) and its paired sprite entry (iy=0xaa10), then branch on the player-state byte 0xa800: return while it is 0, run the tile-animation step (0x2010) while it is any other non-0xff value, and once it is 0xff either fly the attract demo pilot (0x214b when PLAY_ACTIVE 0xad30 is 0), turn the ship toward the read control stick (0x1f01 when the low control nibble is nonzero), or just scroll the world (0x1f42) when the stick is centred", cert: "seen" },
  0x48be: { name: "serviceCoinInputs", role: "one frame of coin-input service: run the two coin-slot debounce/accept handlers and the phase-gated credit drip in turn, then pulse each mechanical coin counter once per coin still owed; dead unless an input edge or a pending debt is present", cert: "seen" },
  0x4243: { name: "launchAttackerIntoFreeSlot", role: "on this object's turn of the eight-frame round, once the shared spawn cooldown (0xA8F4) has expired, walk the object-record bank for a free slot, stash its record/entry pointers at 0xA991/0xA993, and if the new object clears the two fixed lines hand the caller's facing (C=IX+0x02) to the era-0 aim launcher (0x429C) or the heading-follows launcher (0x42B7); otherwise tick the cooldown down or leave everything untouched", cert: "seen" },
  0x400b: { name: "advanceSlotThenSweepObjectBankByHead", role: "advance-step entry of the object-bank sweep: stride one slot forward (record +0x10, sprite entry +2) and return when the count runs out; step over an empty slot, fly a ballistic (0xFF) slot a frame and step over it, and hand the first slot bearing any other marker to the servicing sweep for the rest of the bank", cert: "seen" },
  0x30a5: { name: "seatEraSceneryRowThenClearAndRunScenery", role: "sum a fixed 16-byte run against a constant as a discarded tamper tripwire, copy eight bytes of the ERA_INDEX-keyed row from the 0x3176 table into the stride-two run at 0xAA31, then tail into the scenery clear+run carrying the era in C and the fill byte 0x28 at era four else 0xCC", cert: "seen" },
  0x48e7: { name: "awardOneCreditOnDebouncedInputEdge", role: "per-frame debounce of IN0 bit 2 (port mirror 0xA9AE): rotate that bit into the bottom of the rolling history at 0xA983 (rl (hl)), fire only on a clean leading edge — the low three history bits reading 001 (idle, idle, pressed) — else return; on the edge request a sound (0x57F1) and award exactly one credit outright (C=1 into awardCoinCreditThenPulseCoinCounter, which folds it into the BCD credit count at 0xA986 and pulses the coin counter), a flat-credit path distinct from the coinage-metered coin-1 handler at 0x4941", cert: "seen" },
  0x188a: { name: "stepTwoCreditCopyrightScreenAwaitingStart", role: "the two-credit copyright screen's await-start step: stamp the fixed copyright caption strip and flash its line, then dispatch on the two start-button bits of IN0_MIRROR (0xA9AE) -- bit 4 tail-calls the two-player start, bit 3 the one-player start (bit 4 wins when both are held), and with neither held it returns so the screen shows again", cert: "seen" },
  0x4c1f: { name: "paintLabelledNumericReadoutColumn", role: "paint a labelled numeric readout as one upward tile-plane column: a table-indexed three-tile pictogram (source lead byte x3 into 0x4cb4), a six-digit field, then a three-tile suffix, each cell paired into the colour plane with the caller's pen colour", cert: "seen" },
  0x4911: { name: "meterCoinageTowardCreditOnEdge", role: "phase-gated credit drip: rotate a selector bit (from 0xA9AE) into the phase cell 0xA9CA and act only when its low 3 bits read 1 -- request a sound, bump the counter at 0xA982, step the low byte at 0xA9CB up by 0x10; once the high byte at 0xA9CC still trails the raised low byte, pull the low byte back by (high&0xF0)+0x10 and tail into awardCoinCreditThenPulseCoinCounter with C = the high byte", cert: "seen" },
  0x379f: { name: "spawnEnemyCraftWhenBandUnderTwo", role: "gate a spawn tick on the packed-decimal phase byte the caller points at (return unless it is 0x00 or 0x30), count the busy heads across the seven-record enemy-craft band at 0xa850, and while fewer than two are busy run the free-slot search -- the cleared run via loc_3793 when the owed-kills cell 0xad02 is zero, else the owed run (b from the round's craft count 0xacc1, seated at 0xa8b0/0xaa26) via spawnEnemyIntoFreeSlotElseStepSearch; stages nothing when the gate is shut or two heads are busy", cert: "seen" },
  0x4f2a: { name: "dispatchEra4CollisionByFrameParity", role: "era-4 (ERA_INDEX 0xad04=4) per-frame collision dispatch split by frame parity (FRAME_TICK 0xa980), reached only as dispatchCollisionPassByEra's era-4 tail: even frames run the whole player-vs-object collision-and-destruction pass; odd frames stage one shot-vs-target sweep over the object-slot run at 0xa810/0xaa12 (six shots, box l=7/h=0x0f), restaging the shared body's two reload cursors 0xa991/0xa993 first -- while MOTHER_SHIP_ARMED (0xad0d) is set the run is nine long and a mother-ship mutual-kill pass (0x4fe0) follows, while clear the run is eleven long and none does", cert: "seen" },
  0x4447: { name: "dressSpriteForHeadingOrRetireAtEdge", role: "dress an object's sprite entry to face its heading (the era, a damage stage folded from the record's +4 byte and a two-frame pose pick a shape pair -- its only caller is loc_43f0, where +4 is the Mother-Ship's MOTHER_SHIP_HITS_TO_ABSORB; era picks a colour; one heading half swaps the pair and the other biases the colour by half a page), unless the object has reached the field edge, in which case retire the entry pair; on the flutter era instead give a two-frame flutter and step/cap/close-out the wind-down counter", cert: "seen" },
  0x4941: { name: "tallyCoinSlot1AndAwardCredit", role: "one frame of coin slot 1 accounting: clock the raw coin line into a debounce shift register and, on a clean rising edge, count the coin -- blip the coin sound, bump the tally, add a unit to the coins-inserted accumulator; once it passes the coinage threshold (coins-per-credit high nibble, credits awarded low) carry the overshoot forward and, unless the no-credit flag is set, add the low nibble to the packed-decimal credit count (saturated at 99) and repaint its panel; either overshoot path then pulses the mechanical coin counter", cert: "seen" },
  0x4a0f: { name: "armRoundWonBandAnimationThenStepSequence", role: "set up the band animation a won round plays between eras (sequence sub-step 13): stock the eight-byte control block at INTRO_ANIMATION_STEP 0xA9F0 (step 0 from ROM 0x3213, flash tick 0, both band pass countdowns 0xFF, colour-cycle countdown 4, colour-flood countdown 8, band-script cursor aimed at 0x56F1), seed the character plane's first row 0xA400 with the band's backing picture, colour the band's colour-plane rows and stub cells from PEN_COLOUR 0xAD0C plus fixed offsets, seed the active player's saved pen from its era, then tail-step the sequence sub-step", cert: "seen" },
  0x27b1: { name: "armRoundStartThenStepSequence", role: "round-start sequence arm: seat two player-object records (0xAD0C-0xAD2E) and position seeds (0xAC64=0x78,0xAC65=0x84), request a sound and load the difficulty record, then split on PLAY_ACTIVE(0xAD30) -- mid-game it queues command de=0x0400 and folds a +1 XOR checksum of 256 program bytes at 0x1550 into control latch 0xC308 (0xA9EB=0x96); on a fresh round it cycles the 1..3 stage counter at 0xA9D0, reseeds the random register, clears 0xAA80-0xAADF and 0xA800-0xA97F, SUB-checksums 256 bytes at 0x3310 into 0xA9AB (xor 0x90) and paints star field 0xAC74-0xAC83 with 0x80 (0xA9EB=0x5A); both arms tail-advance the sequence sub-step", cert: "seen" },
  0x4cc3: { name: "fileScoreIntoHighScoreTable", role: "file the active player's finished score into the five-record high-score board: walk the standing scores top-down comparing each (isScoreBelow) to find the first the new score is not below, slide the records beneath down one slot (lddr), write the new score with blank 0xf1 name-cell sentinels, look up its initial-glyph row pointer, and renumber the rank column 0..4; carry returns clear when filed, set when the score beat none", cert: "seen" },
  0x326c: { name: "layOutEnemyAimPointsFromScrollAngle", role: "when the mode byte in C selects sub-mode 7 (low nibble == 7), fill sprite object 0xac64's twelve coordinate fields (0x10-0x1b) with six XY pairs around centre (0x78 across, 0x84 down): the scroll angle +0x40 and the scroll angle itself, each drawn through the velocity table (via 0x59d1) at x8 and x16 radii, the +0x40 direction also mirrored to its negatives; other sub-modes return without writing", cert: "seen" },
  0x2251: { name: "loc_2251", role: "tamper-trap data table jumped into as code when the tile-ROM check fails; register churn then a store through BC that faults writing to ROM (else the hard-coded 0x228B store faults), else halt", cert: "code" },
  0x2010: { name: "advancePlayerAnimationStrip", role: "advance a phase-byte-driven tile animation: on the first frame (phase>=0xb4) clamp the phase, flag the paired entry, and cue sounds (56d2 always, 5679 past level 2) unless two game-state cells divert to loc_1f2e; else step the phase down and, on one of seven keyframe values, blit a 5x6 shape strip into video+colour RAM", cert: "seen" },
  0x3ed6: { name: "launchBankEnemyWhenAimedNearPlayer", role: "one gated attempt to launch an enemy into the object bank: past a phase-key match, an arm flag, a non-empty flight count, and a strided scan for a free record, three window tests must pass -- the craft must NOT sit within BANK_LAUNCH_NEAR_HALF_WIDTH of the player's fixed screen position (0x84, 0x78) on both axes, its heading must lie within BANK_LAUNCH_HEADING_HALF_WIDTH of PLAYER_HEADING, and the heading toward the aim point must lie within 16 of its own; only then does it request the launch sound, copy the entry's two coordinates into the found record's paired entry, look up a doubled velocity pair from the heading via one of two tables chosen by a select cell, stock the record with that velocity, stamp two entry constants, re-arm the flag from its source, and count the record head down one", cert: "seen" },
  0x42b7: { name: "commissionStagedAttackerByEra", role: "commission the object the free-slot finder staged, whose record/entry pointers wait at 0xA991/0xA993: copy the spawner's two coordinate pairs and the caller's facing (C) into the new slot, then fit it out one of four ways chosen by the era cell 0xAD04 -- era 0 an unaimed drift with a mirror flag (IY+0x01=0x4F) and slow-fall marker; eras 1-2 a heading toward the fixed point 0xAC7F skewed by a stored half-turn from (IX+0x0F); era 3 a doubled velocity vector for a heading offset +/-0x1A from the facing; era 4 a straight aim at 0xAC7F plus a seeded (IX+0x04); each way winds the new slot's active count (IX+0x00) down, re-arms the spawn cooldown (0xA8F4 from 0xA8F6), restores the spawner's own IX/IY, and hands off to one era-specific sound request", cert: "seen" },
  0x3d25: { name: "spawnAimedEnemyIntoEraBankWhenInWindow", role: "spawn one aimed enemy when the spawn slot is free, the cooldown at 0xa8f4 is clear, the era count at 0xa8c6 is live, and an object in the caller's two-slot bank sits inside a doubled window: seat the found slot's coords, the doubled velocity pair aimed toward the player at 0xac7f (aim side alternated each spawn via 0xa8d4), a script and a shape into the era's fixed record+sprite bank (0xa840/0xaa18 or 0xa8e0/0xaa2c), decrement the new record head, and reload the cooldown from 0xa8f6", cert: "seen" },
  0x459b: { name: "stepMotherShipWarpFlashFrame", role: "step one object's timed warp/flash sequence: drift it with the world, seed the sprite's heading and shape from angle/Y-gated tables, then count a state byte down — the 0xB4 frame flags the sprite, bumps the 0xA800 sentinel (which requests the warp sound at 0x580B when it wraps) and posts command 0x04/0x0D to the ring, above-trigger frames step an eight-shape ROM cycle, and a spent counter resets to idle then loops or returns on two program-image gates; reached through a misaligned prologue (two POP AF, DEC SP) whose stray carry can fold in a life-loss",
    cert: "code",
    why: "no MAME observation is this entry's own: 0x459B/0x459C were fetched in none of the five full-span captures (their only reads are the whole-image checksum's data reads at pc 0x588D). The earlier [seen] rested on shared bytes -- the misaligned decode from 0x459B rejoins the aligned stream at the `call 0x2b60` at 0x45B3, which loc_43f0's dying countdown runs. Its only code transfers are anti-tamper derails: `jp nz,0x459b` at 0x1772 (paintReadoutsThenSampleWitnessOrDerail, taken iff the glyph at 0xA67C != 0x7C) and `jp 0x459b` at 0x4660 (the retire arm, reached iff TAMPER_GLYPH_COPY 0xAB43 != 0x7C or 0xAB44 is neither 0x10 nor 0x05); the third occurrence of the word, at 0x0C72, is caption pointer-table data",
  },
  0x083e: {
    name: "buildCopyrightScreenThenVerifyImage",
    role: "title/attract copyright-screen layout arm (table-dispatched, no static call site): request the flashing copyright line, stamp the copyright caption strip, post caption commands (command 1, arguments 0,1,3..7,20,21) to the command ring, then XOR-fold the 24-byte program block at 0x176A and step the sequence sub-step when the fold matches 0xC9, else transfer to the checksum-failure landing",
    cert: "seen",
  },
  0x176a: {
    name: "paintReadoutsThenSampleWitnessOrDerail",
    role: "one arm of the copyright/attract sequence machine (table-dispatched tail, no static call site): check the copyright line's colours (deferring to the guard, which derails on its own if any cell is wrong), then unless caption cell TAMPER_GLYPH_SOURCE_CELL (0xa67c) still holds glyph 0x7c hand off to the mother-ship warp/flash handler (stepMotherShipWarpFlashFrame) through its misaligned anti-tamper entry -- the wrong-glyph derail; on a clean image queue one caption command (1, 0x13), repaint the five labelled numeric readouts, copy one cell's glyph and colour into the tamper readback pair (0xadfb/0xadfc), and step the sequence sub-step. Live-out memory only",
    cert: "seen",
  },
  0x178c: {
    name: "holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail",
    role: "phase-1 attract sub-step arm (computed dispatch off the phase-1 table, no static call site): each frame restamp the copyright strip and flash its line, then count one frame off SEQUENCE_DELAY and return while it still runs; on the frame it expires verify the copyright line's colours (guard derails on its own), build a caption-cell pointer from a program byte -- the parachutist routine's first opcode (0x47b3) read as data -- and check the glyph there is 0x3b, DERAILING into the anti-tamper trap loc_15ca (data run as code) on a mismatch, else seat one caption cell's glyph and colour into the tamper-witness pair (TAMPER_GLYPH_COPY 0xab43) and step the sequence sub-step. Live-out memory only",
    cert: "seen",
  },
  0x2730: {
    name: "verifyImageSignatureThenStartAttractDemoOrDerail",
    role: "phase-1 attract sub-step arm (computed dispatch off the phase-1 table at inner sub-step 12, no static call site): read the folded program-image signature banked at TAMPER_IMAGE_SIGNATURE and compare it against 0x76 -- on a tampered image derail into the power-on wipe trap loc_2530 (data run as code, unreachable on a genuine image), else start the attract-mode autopilot demo -- park the caption sprites, seed the demo autopilot heading script, clear TWO_PLAYER_GAME / PLAYER_TWO_LIVES / PLAY_ACTIVE / SEQUENCE_SUBSTEP, stock player one with one life, and wind the outer sequence on to its last phase (3). Live-out memory only",
    cert: "seen",
  },
  0x1323: {
    name: "stepRoundStartIntroAnimation",
    role: "sub-step 14 arm of the phase-3 table at 0x0F29, running the band animation armRoundWonBandAnimationThenStepSequence sets up: only on frames with FRAME_TICK bit 1 clear, branch on INTRO_ANIMATION_STEP (0xA9F0) -- step 0 flashes the player ship (flashPlayerWhiteEveryOtherFrame), step 1 flashes it and runs advanceScriptedCharPlaneBandTo2, step 2 cycles the ship's colour (cyclePlayerSpriteColourThenAdvanceStepAtZero) and runs advanceScriptedCharPlaneBandTo4, step 3 runs advanceScriptedCharPlaneBandTo4 alone, step 4 floods the colour plane (floodColourPlaneWithSavedPlayerColour); any later step sets SEQUENCE_DELAY to 90, hides every sprite, sets up the active player's turn (loadActivePlayerContextAndPostRoundHud) and reloads SEQUENCE_SUBSTEP from ROM byte 0x2750 (=3)",
    cert: "seen",
  },
  0x189e: {
    name: "startTwoPlayerGame",
    role: "start a two-player game: park the caption sprites, raise PLAY_ACTIVE and the flag beside it, load both players' lives from the starting-count settings cell, run the two-player-start arm, deduct two credits in packed BCD from 0xA986 and repaint the panel field, then send the sequence machine to its last phase",
    cert: "seen",
  },
  0x2511: {
    name: "initColdStartRamThenSeedConfig",
    role: "cold-boot init: paints a 64-byte work-RAM block all-ones, seeds RNG / loads default high scores / empties the deferred lists (watchdog-kicking after each), then tail-jumps into the settings + cold-start chain",
    cert: "seen",
  },
  0x30d1: {
    name: "clearSceneryEntriesThenRunEraScenery",
    role: "clear a stride-two run of eight object cells to the fill byte carried in A, then branch on the era in C: below four, seat and run the frame's scenery through the four-object seat path; at four and up, when two work-RAM guards read their expected values seat eight entries from a packed table before running the scenery, and on a wrong guard transfer into a data table and fault",
    cert: "seen",
  },
  0x335e: {
    name: "seatCaptionPenFromEraFoldingTamperIntoPhase",
    role: "sequence-machine arm: fold a fixed image run into the sequence-phase cell as a tamper tripwire (net-zero on a genuine image), then seat the caption pen (glyph 0xAD0B / colour 0xAD0C, and the active player's save block) from a two-byte glyph/colour record indexed by that player's era; steps the sub-step an extra time if the pen colour was unchanged, re-arms the pen route, then steps the sub-step again as a tail",
    cert: "seen",
  },
  0x37d6: {
    name: "spawnEnemyIntoFreeSlotElseStepSearch",
    role: "work one slot in a downward free-slot search: a busy slot passes the turn to the search tail, a free slot is claimed and stocked with a starting position (two coordinate bytes from the spawn-record table, picked by the player's heading plus random jitter), a facing opposite the player's heading, a script and fresh animation (at most one slot filled per turn); grounded in MAME: this fills the green enemy-craft band (0xA850) one slot at a time",
    cert: "seen",
  },
  0x386e: {
    name: "spawnEnemyWaveIntoFreeSlots",
    role: "spawn a wave across a fixed bank of object slots: fill each free slot from a randomly-drawn spawn record (a starting position into the sprite entry and a starting heading into the record), prime its step counter, step its animation once, mark it live; store a fixed status byte when the pass ends",
    cert: "seen",
  },
  0x3c25: {
    name: "armBomberSlotWhenTimerFires",
    role: "on even frames tick a slot's arming countdown at ix+0x0e; when it fires and MOTHER_SHIP_ARMED (0xad0d) is clear, arm the slot -- pick a shape record from PLAYER_HEADING (0xa802) via the table at 0x3c84, snap the heading to a facing bit, look up the velocity pair, write shape/facing/velocity into the record, set HITS_REMAINING (0xa8dc)=3, and mark the slot live (ix+0=0xff). Its sole caller serviceEra1BomberObject dispatches it only in era 1, so this is the 1940 bomber (absorbs three hits, dies on the fourth), not the Mother-Ship, whose hit counter is seeded with seven; under MAME it is the era-1 large multi-hit craft, and a negative control removes it",
    cert: "seen",
  },
  0x3ff9: {
    name: "sweepObjectSlotBankByHead",
    role: "sweep a fixed bank of object slots for a frame, servicing each by its head byte -- fly a ballistic slot (0xFF) a frame along its arc, run the shape-cycle countdown service on any other nonzero, skip an empty (0) -- striding one 0x10 record and two sprite-entry bytes per slot for the caller's count",
    cert: "seen",
  },
  0x4008: {
    name: "sweepObjectSlotBankServicingFirstSlot",
    role: "sweep the fixed three-slot object bank for one frame from the seated cursors (record cursor +0x10, sprite cursor +2 per slot, count bounding the pass): service the first slot's shape-cycle unconditionally, then route each following slot by its marker byte -- skip an empty (0x00) slot, fly a ballistic (0xFF) slot a step, and service any other marker's shape-cycle",
    cert: "seen",
  },
  0x413c: {
    name: "stepDriftingCountdownObjectByEraFrames",
    role: "advance one countdown-driven object per frame: re-stamp+sound at the reset cap, drift with world scroll, decrement, retire the slot at zero, else animate the sprite from an era-selected frame table above the window floor",
    cert: "seen",
  },
  0x4194: {
    name: "stepSlotApproachThenBreakawayRetire",
    role: "one slot's per-frame handler in an object sweep: while the record's approach countdown at +4 runs, decrement it and drive the object through its chased-object frame; the tick it hits zero, fly the object at double velocity, animate its shape cycle, and retire the slot only if it has reached a retire line, then step the sweep onto the next slot",
    cert: "seen",
  },
  0x47b3: {
    name: "runParachutistSlot",
    role: "per-frame manager of the single parachutist slot (record 0xa8f0, sprite 0xaa2e): idle in era 4, else branch on the slot's state byte — free spawns it at the edge ahead, in-flight (0xff) flies it and retires it once it reaches a retire line else steps its shape from the frame tick, 0x10 posts its bonus, >=0x3c shows its award, and any lower value drifts it with the world then counts down and retires it at zero; grounded in MAME as the parachutist rescue object (canopy + 1000 bonus), removed by a negative control",
    cert: "seen",
  },
  0x496e: {
    name: "awardCoinCreditThenPulseCoinCounter",
    role: "outside free play, fold C's low decimal digit into the packed-decimal credit count at 0xa986 (decimal add, clamp to 99) and repaint that field, then run the coin-counter pulse",
    cert: "seen",
  },
  0x4a42: {
    name: "paintCaptionColourBandAndStepSequence",
    role: "continue a caption's colour band just past the caller's cursor: lay the caller's lead byte over one cell, a 13-cell run of the caller's body byte and a 4-cell tail (0x0e), then fill two colour-RAM rows and six scattered colour cells from the base colour at 0xAD0C (each value base+offset), seed the saved pen from the era and step the sequence sub-step. On a genuine image this body runs only as the fall-through of armRoundWonBandAnimationThenStepSequence, which seats the lead byte, body byte and cursor; its own entry point is reached only by a tamper derail",
    cert: "seen",
  },
  0x4d72: {
    name: "drawEmblemStripThenGuardImage",
    role: "ring command 5's handler (word-table slot 5 at 0x0BBC; reached on coin-start, never in attract): while 0xAD30 is nonzero, stamp up to six 2x2 award emblems leftward from 0xA783 via stampTwoByTwoTileBlock, blank the rest of that row down to 0xA623 via paintGlyphOverBlankInColourThenStepCursor, then XOR-verify program bytes 0x0711-0x0810 -- memory only",
    cert: "seen",
  },
  0x4e63: {
    name: "runAllCollisionSweepsThisFrame",
    role: "run one round's collision-and-destruction pass: sweep the player's shots against targets, then the player against a run of objects, then -- picked by whether the mother-ship is armed -- either the player-vs-slots contact sweep plus the mother-ship mutual-kill box, or a wider player-vs-slots sweep; then a three-target attacker sweep and a final mark of objects touching the player. The object/slot cursor pair threads through DE/IY across the chain, each stage continuing where the last left off",
    cert: "seen",
  },
  0x4ebc: {
    name: "splitCollisionWorkByFrameParity",
    role: "split the per-frame collision work by frame parity: on odd frames run the shot-vs-target sweeps (dispatchShotSweepByMotherShipArmed); on even frames run the player-vs-object collision chain, adding the mother-ship mutual-kill check (ramTestPlayerVsMotherShip) only while the mother ship is armed",
    cert: "seen",
  },
  0x5303: {
    name: "advanceSequenceUnlessImageTampered",
    role: "run the image-checksum tamper test and relay by its verdict: present the carried checksum, step the attract sequence on the one genuine value, else spring the tamper trap",
    cert: "seen",
  },
  0x0167: {
    name: "loc_0167",
    role: "caption-record data run as code on the checksum-mismatch derail arm: bumps one work-RAM cell the accumulator points at, then falls into the frame-interrupt epilogue that unwinds the frame and resumes",
    cert: "code",
  },
  0x074b: {
    name: "erasePenRouteThenAdvanceStep",
    role: "attract-sequence arm (phase 1, sub-step 0, reached by rst-30 computed dispatch from dispatchSequencePhase1SubStepArm): fold the fixed 256-byte run at 0x4AA0 into an eight-bit total and derail into the checksum-failure landing 0x08FA on any total but 0xB8; otherwise set the pen colour 0xAD0C to 5 and the stamp glyph 0xAD0B to the blanking glyph 0xF1 (so the pen erases), re-arm the pen route via 0x01E1, then step the sequence sub-step 0x0F1A -- twice when the pen colour already held 5",
    cert: "seen",
  },
  0x0f8d: {
    name: "loc_0f8d",
    role: "image-checksum tamper trap: drops four return words to unwind the caller chain, then falls into the sprite position-fixup pass (rets on the fifth word)",
    cert: "code",
  },
  0x1734: {
    name: "advancePenRunAnimationStep",
    role: "one interpolated-run sequence step: call drawInterpolatedPenRun to draw/advance one pen run and ret nz unless it reseated to a zero row integer, then store the two's-complement checksum of the 34-byte code block at 0x1748 into 0xA817 (0x00 on a clean image) and tail-jump to 0x0F1A (advanceSequenceSubStep) to step the sequence sub-index",
    cert: "seen",
  },
  0x1f2e: {
    name: "loc_1f2e",
    role: "the direction table's bytes run as code, reached only through the copyright-glyph tamper divert in advancePlayerAnimationStrip (never on a genuine image): fold B into A, take two early returns on the result, else fall out of the table into the heading snap -- write PLAYER_HEADING and scroll the world",
    cert: "code",
  },
  0x29f7: {
    name: "steerEnemyTowardShip",
    role: "steer one live slot toward its aim heading then fly it a step; when the slot's probe cell (iy+0x31) lies within a fixed window of either reference point the turn runs with the shared turn-rate index forced to zero then reseated to four, else at the standing index, and the step alternates a double- and a single-velocity mover on bit 1 of the frame tick",
    cert: "seen",
  },
  0x2b93: {
    name: "stepDyingObjectState",
    role: "per-object state-machine step: dispatch on the object's state byte — 0xf0 re-arms it to 0x3b and begins its death, 0x3c begins the death then flies it on, above 0x3c flies it on, below 0x3c counts the byte down, retiring the slot at zero else moving the object for the frame",
    cert: "seen",
  },
  0x2d21: {
    name: "driftNearestSceneryTriTile",
    role: "drift one scenery object with the world scroll over-travelled by a quarter, then lay the tile abutting it and the one cornering it diagonally (three corners of a square) and step both cursors one slot past",
    cert: "seen",
  },
  0x307f: {
    name: "loc_307f",
    role: "tail of a per-slot sprite-entry fill: store a coordinate through the pointer and fold it into A, then hand each slot to the straight placer while the counter (B) holds; on the last slot index a word table by A, bump the byte past the entry, drop two stack bytes into AF, and finish through the diagonal placer",
    cert: "code",
  },
  0x3117: {
    name: "seedSceneryEntriesThenRunScenery",
    role: "when a sentinel pair reads 0x68 then 0x10-or-0x05, seat four objects from a packed table into the sprite cell and shadow of the first four entry-bank slots and hand on to the frame's scenery run; otherwise transfer to the caption path",
    cert: "seen",
  },
  0x406c: {
    name: "runOneShotAnimatedObjectSlot",
    role: "service one animated slot for a frame: rearm it (stamp the countdown to 59 and request the paired sound) when the countdown at (ix+0) is >=0x3c, count the countdown down, retire the sprite (zero iy+0 and iy+0x31) when it reaches zero, otherwise drift the object with the world scroll and, once the countdown is >=0x1c, drive the sprite shape (iy+1) from the 9-byte table at 0x4094 indexed by (countdown-0x1c)>>2 and set its attribute (iy+0x30) to 0x0e",
    cert: "seen",
  },
  0x418b: {
    name: "flyLiveSlotAndTickCountdown",
    role: "service one live slot of the per-slot object sweep: fly the slot's object a step along its stored velocity (retiring it once it crosses a retire line), tick down the slot's own countdown at record offset 0x0e, then close the turn of the sweep; reached only for a slot whose marker byte reads 0xFF with a nonzero countdown, outside the fourth era",
    cert: "seen",
  },
  0x41b8: {
    name: "flyTowardShipStandoffThenEndApproach",
    role: "run one chased object through a frame: every sixteenth frame re-aim it at one of two fixed points a record bit selects, cut its approach countdown to zero once both axis gaps to that point fall under sixteen, then turn, move and dress it every frame; the carry answers whether it reached a retire line",
    cert: "seen",
  },
  0x460e: {
    name: "setUpTwoPlayerStartObjectOnce",
    role: "two-player-start setup arm (called from 0x189E): when the video cell 0xA67C and work cell 0xAB43 disagree, decrement the counter at (IX+0), seat 0xFE/0xFD and 0x6C/0x6C into the object slot at (IY+1/+3/+0x30/+0x32), request sound 0x580B when 0xA800 is 0xFF, and queue ring command 0x04/0x0D; a no-op when the two cells agree",
    cert: "seen",
  },
  0x49a8: {
    name: "finishBootSelfTestAndColdStart",
    role: "tail of power-on config decode + self-test: slices two bits of the rolled config byte into work-RAM 0xa9c4/0xa9c6, kicks the watchdog, drives LS259 line 1 from ROM byte 0x0c3e, tiles the character plane, sums the 256-byte ROM block at 0x27de and derails a tampered image into the frame handler, else cold-starts",
    cert: "seen",
  },
  0x4c75: {
    name: "loadActivePlayerContextAndPostRoundHud",
    role: "sequence arm (computed-dispatch entry 3 of the table at 0x0F29): blank a fixed character-cell run, copy the active player's saved 16-byte context block into the live block at 0xAD00, step the sequence sub-index; when play is active it also posts the round number (cmd 6) and lives-less-one (cmd 5) to the command ring and folds a fixed program span (0x5B50, 256 bytes) into an XOR whose low bit less one drives the picture-enable latch 0xC308 -- a tamper guard",
    cert: "seen",
  },
  0x4d3a: {
    name: "escalateDifficultyRungOnCounterWrap",
    role: "step a three-place base-sixty tick counter at 0xAD05, carrying into the next place only while a place rolls over; each time the lowest place rolls over (every sixty passes) count down the reload timer at 0xA9D7, and each time it fires rearm it from 0xA9D6, climb the escalation rung at 0xACC0 one step (held at 15), and apply that rung's tuning row",
    cert: "seen",
  },
  0x50b1: {
    name: "ramTestPlayerVsMotherShip",
    role: "select the collision box for the mutual kill of the player and one fixed two-slot target by ERA_INDEX: eras 0 and 4 transfer to the wider first-axis check (destroyPlayerAndMotherShipOnContact), the rest run the same destruction inline with a narrower first-axis window; when both are live and their coordinates fall in the box, mark both destroyed, clear the cell beside them, and tail-post the chained hit score",
    cert: "seen",
  },
  0x52aa: {
    name: "seedGameConfigFromDipSwitches",
    role: "boot-time DIP seed: copy two ROM defaults into their cells (0x08c9->0xa98d, 0x0874->KILL_QUOTA), store DSW0 complemented as COINAGE_SETTINGS and unpack the coin ratios, then turn DSW1's low two bits into a lives count (3/4/5, or 0xff when they fold to none) and tail-jump with it plus the whole complemented bank into the switch-settings peeler; never returns",
    cert: "seen",
  },
  0x5bd7: {
    name: "blankCaptionThenAdvancePenRunStep",
    role: "inner sequence-dispatch arm (table 0x0f29 index 2): blank a fixed character run, advance the interpolated pen run, and bail unless it reseated to a zero row integer; on the full path fold two guarded code blocks (an anti-tamper XOR check that raises the sequence phase on mismatch, and a self-cancelling add-checksum over a work cell) then step the sequence sub-index",
    cert: "seen",
  },
  0x0008: {
    name: "fetchTableByte",
    role: "step a table pointer on by an index and return the byte it lands on, leaving the pointer at that entry",
    cert: "seen",
    why: 'most call sites consume the returned byte immediately (ld (iy+n),a, ld (de),a) while only a few read on through the surviving pointer, so the fetch is the product. Siblings 0x0010 and 0x018c already read as "fetch what an index selects", and this is the byte-table member of that family',
  },
  0x0018: {
    name: "offsetAddress",
    role: "move a 16-bit address forward by an unsigned byte offset, echoing the low half of the result back",
    cert: "seen",
    why: "loc_20af hands it a table base and an index and then does its OWN ld a,(hl), so the caller owns the fetch and this must stop at the arithmetic; fetchTableWord uses it as the first half of a word-table fetch",
  },
  0x0020: {
    name: "advanceCharCursor",
    role: "step the character-cell cursor on to the next cell of the line being drawn",
    cert: "seen",
    why: "paintTwoUnsuppressedDigitsFromByte draws a two-digit pair as high nibble, step, low nibble, so the step is reading order; MAME's ROT90 (clockwise) maps a decreasing native row to an increasing display column, and every base feeding these drawers lies inside video RAM",
  },
  0x0038: {
    name: "postCommand",
    role: "queue a command byte and its argument in the command ring, dropping the pair when the cursor's cell is still occupied",
    cert: "seen",
    why: 'initColdStartRamThenSeedConfig fills the ring with 0xFF at init and runCommandRingDrainLoop restores 0xFF on consumption, so "free = high bit set" is fixed by a writer and a reader outside this routine; runCommandRingDrainLoop then dispatches the low nibble through a sixteen-way table, which is what makes it a command rather than a sound byte',
  },
  0x0201: {
    name: "drawInterpolatedPenRun",
    role: "draw one interpolated run of pen-glyph cells from the current row/column toward a target pair (signed per-step increment (target-current)>>4), stamping each cell until the stamped video cell hits the run's end cell, then advance the run index, load the next run's endpoint from the word table at 0x0290, reseat the pen, and leave Z set when the new row integer is 0 (callers ret nz on it)",
    cert: "seen",
  },
  0x07e6: {
    name: "stepCopyrightScreenAwaitingStart",
    role: "copyright / insert-coin attract sequence arm (table-dispatched): re-stamp the copyright strip, re-request the flashing copyright line, sample one character cell (0xA61C) into a two-byte record (0xABFE), then read the IN0 mirror -- hand off to the one-player game start when 1-player start (bit 3) is held, return when the credit count at 0xA986 is one, otherwise queue ring command 1/argument 25 and step the sequence sub-step",
    cert: "seen",
  },
  0x08fa: {
    name: "loc_08fa",
    role: "checksum-failure landing whose bytes are really a read-as-data table; run as code it always faults — carry-clear stores into program space, carry-set spills 1-2 stack words and jumps to unmapped space",
    cert: "code",
  },
  0x0c90: {
    name: "awardScoreToPlayer",
    role: "score-award command (ring handler 4): add the argument-selected award to the current player's packed-decimal score, promote it into the high score when it now beats it, and repaint the affected scores; argument 0 repaints the score labels and blanks the absent second score",
    cert: "seen",
  },
  0x0b90: {
    name: "enterCommandRingDrain",
    role: "tail transfer into the foreground command-ring drain (runCommandRingDrainLoop): a single jp that never returns and writes nothing of its own",
    cert: "seen",
  },
  0x0066: {
    name: "enterVblankInterrupt",
    role: "the per-frame (vblank) interrupt vector: hardware dispatches it once per interrupt and it transfers straight to the frame-service handler at 0x00d8, writing nothing of its own",
    cert: "seen",
  },
  0x0d73: {
    name: "paintSixDigitFieldSuppressingLeadingZeros",
    role: "paint a six-digit field: two packed bytes through the suppressing painter, sharing one suppression flag this entry clears, then a third through the plain painter so the last two digits always show, walking the source pointer backwards as it goes",
    cert: "seen",
  },
  0x0d81: {
    name: "paintTwoUnsuppressedDigitsFromByte",
    role: "paint the two decimal digits packed into one byte, the high one first, stepping the cursor one cell on after each; the byte is read twice from the pointer the caller is walking, shifted down for the high digit and taken whole for the low, and the colour and cursor arrive as the caller left them",
    cert: "seen",
  },
  0x0d90: {
    name: "paintUnsuppressedDigit",
    role: "paint one decimal digit and the caller's colour into the cell a cursor names, taking the glyph from the table at 0x0DCC by the value's low four bits -- a zero always paints the digit `0`, where the suppressing twin paints the blank instead while no significant digit has been seen yet -- and leaving the cursor on the glyph side and the caller's run pointer where it was",
    cert: "seen",
    why: "the name's content is the contrast with paintSuppressedDigit at 0x0DAF, refutable per dispatch. A PC-gated read tap under MAME logged the value handed in and the glyph written on every entry to BOTH routines in one run: this one painted the digit `0` on every zero-valued dispatch and the blanking glyph on none, while the twin, same run and instrument, painted the blanking glyph on most of its zero-valued dispatches -- so the instrument could see the thing reported absent. MAME's screenshot agrees on the HI-SCORE field: it reads `10000`, and the tap attributes its leading blank and first three digits to the twin and only its two trailing zeros to this routine. Feeding it non-decimal values refutes `hex` as well: holding the displayed field at 0xAB, 0xCD and 0xEF drove it to the table's last entry and beyond, where it painted 0xF1 (the blanking glyph the table really holds) and then the first five bytes of the routine at 0x0DD7 -- never a glyph A-F",
  },
  0x0da0: {
    name: "paintTwoSuppressedDigitsFromByte",
    role: "paint the two decimal digits packed into one byte with a leading zero suppressed, the high one first, stepping the cursor one cell on after each; the caller's suppression flag arrives, carries across both digits and goes back out, so a longer run of digits suppresses as one field",
    cert: "seen",
  },
  0x0dd7: {
    name: "drawCountAsPictogramStrip",
    role: "draw a clamped 0..99 value as a right-to-left row of denomination tiles (thirties, tens, fives, ones) from display cell 0xa463, pad the rest of the row to 0xa623 with the blank glyph, then verify a fixed three-word checksum (0x009d/0x00a0/0x00a3) and hard-reset via 0x0000 on mismatch",
    cert: "seen",
  },
  0x0eac: {
    name: "drawRoundNumberCaption",
    role: "paint the round number as two decimal digits into a caption frame via the leading-zero-dropping digit painter (nothing once it reaches 100), then fold a fixed program block onto a seed and throw/halt-into-data if it does not sum to zero -- an anti-tamper guard",
    cert: "seen",
  },
  0x0f1a: {
    name: "advanceSequenceSubStep",
    role: "step the jump-table sequence index on by one; reached as a tail jump so the caller's own return carries it",
    cert: "seen",
    why: 'advanceSequencePhase increments the outer phase and zeroes this index in one breath, which is only coherent if this is the inner half of a two-level machine -- so a name saying merely "sequence step" would claim the half that gets discarded whenever the sequence really advances',
  },
  0x0f1f: {
    name: "dispatchSequenceSubStepArm",
    role: "the inner level of the two-level sequence machine for the round-engine phase (3): run the arm the low nibble of SEQUENCE_SUBSTEP selects from the sixteen-word table inline at 0x0F29, then the fixed continuation advanceAttractTowardGameStart",
    cert: "seen",
  },
  0x10fd: {
    name: "spinRemainingSpriteMultiplexSlots",
    role: "subroutine entry into the five-slot sprite split pass (slots 19-23), joined inside slot 19 with the caller's held byte and test: when the test is set and the held byte plus SCANLINE_COUNTER carries, trade slot 19 from the held byte; without the carry, rejoin the pass at slot 19 (0x10F8) and re-read all five slots from memory instead; after a trade or a clear test, trade slots 20-23 wherever their top bit is set",
    cert: "code",
    why: "nothing enters 0x10FD as a subroutine except through an anti-tamper derail, so the role rests on the code alone: entered here, the held byte and the flag stand in for sprite 19's load and test. The bytes are shared -- 0x10FD is also the `jr z` inside sprite 19's block of multiplexSpriteSlots, so every closing pass runs 0x10FD onward, and that observation grounds multiplexSpriteSlots, not this entry. The one CALL to it in the image (CALL NZ at 0x15D9) sits inside caption record 5 (0x0C50 record table entry 5 = 0x15D6: destination 0xA660, colour 0x14, glyphs `c4 fd 10 ed 77 68 d7 34`, terminator 0xB9). Those bytes run as code only when holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail finds the glyph at 0xA63C is not 0x3B and takes the `jp nz,0x15CA` at 0x17A6 into caption record 8, whose decode runs straight on into record 5. Accounted for in grounding-debt.txt as anti-tamper",
  },
  0x11ed: {
    name: "loseLifeAndHandOver",
    role: "process a player's death: hide the sprite band, apply a pending round-advance when its flag is set, and queue the frame's fixed sound requests; then decrement LIVES_REMAINING at the head of the live 16-byte context block and checkpoint that block into the active player's save slot — on lives reaching zero it tail-calls the game-over banner, otherwise, when the other player's saved block still shows lives, it flips the active-player index, arms a delay and re-steps the sequence for the next life",
    cert: "seen",
  },
  0x0f97: {
    name: "multiplexSpriteSlotsSkipping",
    role: "scanline-gated sprite position fixup over 8 slots: for each slot whose Y byte (sprite bank 1) has bit 7 set and whose Y + scanline counter carries, clears bit 7 of that Y byte and toggles bit 7 of the paired X byte (sprite bank 0)",
    cert: "seen",
  },
  0x0f54: {
    name: "advanceAttractTowardGameStart",
    role: "the fixed continuation dispatchSequenceSubStepArm runs after every arm: returns while PLAY_ACTIVE (0xAD30) is set; on a nonzero credit count (0xA986) it zeroes SEQUENCE_SUBSTEP (0xA9AC) and reloads SEQUENCE_PHASE (0xA9AB) from the ROM byte at 0x1736; otherwise, only when FREE_PLAY (0xA9C0) is set and a start bit (0xA9AE & 0x18) is held, it hides all sprites (hideAllSprites) and starts a game (startGameOnFreePlay) -- that free-play arm was not observed under MAME",
    cert: "seen",
  },
  0x1253: {
    name: "postGameOverBanner",
    role: "the last life is gone: queue the PLAYER-n caption and the GAME OVER caption, hold them for three seconds and step the sequence on; when no game is running it branches instead into the shared teardown restartAttractSequence, which hands the machine back to attract",
    cert: "seen",
    why: "watched under MAME on the real ROM both ways. In driven play every dispatch had LIVES_REMAINING zero and PLAY_ACTIVE set, and SEQUENCE_DELAY was written 0xB4 from this routine's own store once per dispatch, so the queueing side is the side the machine takes; its caller's other arm accounts for the rest of its entries. Forced once mid-game by an opcode substitution, it put 02 09 and 0A 0B into the command ring on the same frame and left `7d a5 38 34 f1 68 0e 34 d7` in the cells at 0xA672 -- GAME OVER glyph for glyph out of caption record 11 -- and changed the screen where a control suppressing the same host changed nothing. Command 2 is drawCaptionInPenColour and command 10 its sibling drawCaptionFivePastSharedColour, which takes its colour as PEN_COLOUR plus 5, so arguments 9/10 and 11 are caption indices, which the ROM's record table decodes as PLAYER 1 / PLAYER 2 and GAME OVER",
  },
  0x1271: {
    name: "advanceRoundWhenFieldCleared",
    role: "gated two-arm state transition: fires only when 0xad02=0, 0xacc6!=0 and all 15 slots at 0xa810 are empty, then queues the fixed sound set and runs one of two arms on 0xad30 — disarm+reset a cell cluster, or clear a strided run and copy a 16-byte record into 0xad10/0xad20 (only the 0xad10 destination was watched under MAME; the 0xad20 copy is code-level)",
    cert: "seen",
  },
  0x12e7: {
    name: "passTurnToOtherPlayerIfLivesElseStepSequence",
    role: "hand the turn over to the other player when that player's saved lives count is non-zero, and otherwise step the inner sequence index; both exits are tails, so this entry chooses between two continuations rather than returning to anything",
    cert: "seen",
  },
  0x12fb: {
    name: "restartAttractSequence",
    role: "put the machine back at the top of the attract sequence: clear the play flag, the active-player index and the inner sequence step, then set the outer phase from a byte of the program image, and write the inner step a SECOND time through a fold over three more image bytes -- on an unaltered image that fold comes to zero and agrees with the first write, on an altered one it does not and the sequence restarts at some other step",
    cert: "seen",
    why: "the name's claim is the DESTINATION, and the phase cell decides it: the byte copied from 0x16D3 reads 0x01, and SEQUENCE_PHASE 1 is the attract sequence. Under MAME on the real ROM, an entry tap plus a write tap gated to this routine's own pc caught it firing in a driven one-player game and in an undriven control, and every firing wrote the same five stores -- 0xAD30<-00, 0xA9AC<-00, 0xAD32<-00, 0xA9AB<-01, 0xA9AC<-00 -- with the outer phase reading 3 (the round engine) on entry. So it is the way out of the round engine, to phase 1; the second inner-step write was measured as 0x00 on the genuine image, so the fold closes. It is NOT the game-over routine: the control's firings, with no coin inserted, are the attract demo ending, and only the game-over firing had the play flag still set on entry (0xFF, then 0x00 after the store at 0x12FC). The word 0x12FB occurs in the image only as advanceRoundWhenFieldCleared's `jp` at 0x12C4, postGameOverBanner's `jp z` at 0x1257 (never taken under MAME) and entry 12 of the 0x0F29 sub-step table (word at 0x0F41); the game-over firing came through that table entry (SEQUENCE_SUBSTEP 0x0C on entry, against 0x07 for firings through 0x12C4). The folded bytes 0x4901-0x4903 are the middle of the copyright caption's record (its destination high byte, colour byte and first glyph), so tampering with the credit corrupts the attract restart rather than failing cleanly",
  },
  0x1367: {
    name: "flashPlayerWhiteEveryOtherFrame",
    role: "one frame of the flash that runs the player's ship white and back: the two flip bits of the player's sprite control byte are kept and the colour under them is driven from the low bit of the animation's own tick, alternating between the all-white palette entry and the colour the ship normally wears; the tick is stepped last and wraps at eight bits, and on the single tick where it reads the threshold the routine also hands the animation on to its next step and asks for one sound",
    cert: "seen",
    why: "the flash is the part that could have been wrong, and it was watched on the real machine. 0xAA40 is the player's sprite control byte -- publishSpriteShadow gathers bank 1 from 0xAA40 into hardware slot 6, whose bank-0 pair 0xAA10/0xAA11 is the player's entry, and dressPlayerSpriteForHeading writes 0xAA11 and 0xAA40 as a pair -- so the six bits under the mask are a colour, and the byte written is 62, whose four sprite pens are transparent and three whites. Nothing in the image calls this routine's dispatcher, so the state was built rather than driven to: with the heading dresser replaced by this routine at its own entry, MAME showed that sprite's pixels alternating white and blue on every frame, against a control with the dresser suppressed and this routine absent where they never moved; the control also lost the dresser's writes, so the substitution took. The threshold arm was measured too: each tick at the threshold wrote the next step from 0x1373, and sound code 0x19 reached the port only in the arm that runs this routine. The name says nothing about the OCCASION because driving a game to deaths leaves this whole machine untouched",
  },
  0x1393: {
    name: "cyclePlayerSpriteColourThenAdvanceStepAtZero",
    role: "one tick of a two-colour animation inside the sub-step-14 band animation (stepRoundStartIntroAnimation): step a count down by one and, from a single bit of that count, drive the colour field of the shadow byte that the sprite publisher copies into the player ship's sprite attribute, so a colour holds for four consecutive ticks; the top two bits of that byte, which carry the sprite's mirroring, are left alone. The tick that finds the count already at zero also moves the animation's step cell on to 3, and the count still steps on that tick, wrapping below zero. Its one call site is that animation's step 2, which then runs advanceScriptedCharPlaneBandTo4",
    cert: "seen",
  },
  0x13cc: {
    name: "floodColourPlaneWithSavedPlayerColour",
    role: "the step-4 arm of the sub-step-14 band animation (stepRoundStartIntroAnimation): flood a fixed block of the colour plane with one byte, and hand the animation the step whose arm winds it up. The byte comes from one of two parallel cells — the same offset in each of the two per-player save blocks — chosen by the active-player index, so it is a saved value rather than the live one. The block is twenty-eight rows of twenty-seven cells: every row the driver leaves visible, and all but five of the plane's thirty-two columns. When the picture is turned round the painting runs from the far corner backwards, which changes the ORDER the cells are touched in and not WHICH, so the two directions leave the plane identical. A separate count is stepped down by one on the way out",
    cert: "seen",
  },
  0x14c5: {
    name: "advanceScriptedCharPlaneBandTo4",
    role: "one frame of the second scripted character-plane band script in the sub-step-14 band animation (steps 2-3 of stepRoundStartIntroAnimation): bit 0 of its pass countdown alternates a blanking pass (fill two thirteen-cell columns and six lead cells with the blank tile 0xF1) with a drawing pass (restore the working column, step its shapes twice through the script, lower six lead cells by the low bit of two script bytes, gather the column back); a script byte with any bit above bit 0 instead clears the countdown, sets the animation step to 4, requests two sounds, steps the script cursor on and ends early; every other pass decrements the countdown",
    cert: "seen",
  },
  0x142a: {
    name: "advanceScriptedCharPlaneBandTo2",
    role: "advance one frame of a script-driven character-plane animation: bit 0 of a countdown cell alternates a blanking pass (fill two thirteen-cell columns and six lead cells with one tile code) with a drawing pass (restore the working column from its saved run, nudge four counters by the low bit of the next two script bytes, step the band up then back down, and gather the column back); a terminator byte instead clears the countdown, arms the next sequence step and rewinds the script pointer one, ending early, and every non-terminating call then decrements the countdown",
    cert: "seen",
  },
  0x15b5: {
    name: "loc_15b5",
    role: "a lone `ret` filling slot 15 of the sixteen-word arm table at 0x0F29 that dispatchSequenceSubStepArm indexes by the low nibble of SEQUENCE_SUBSTEP: it reads and writes nothing and returns into advanceAttractTowardGameStart (0x0F54), the continuation every arm of that table returns into. The address occurs once in the image as a little-endian word -- that table slot. Nibble 15 exists only transiently (arm 14 steps the sub-step to 15 and overwrites it with 3 in the same interrupt, interrupts disabled), so no dispatch reads it and the slot is unreachable filler",
    cert: "code",
  },
  0x15c2: {
    name: "dispatchSequencePhase0SubStepArm",
    role: "run the arm the LOW THREE BITS of the inner sequence step select from the word table laid inline just behind this entry; the arm is jumped to, so it returns straight to this entry's caller and nothing here runs after it",
    cert: "seen",
  },
  0x15fe: {
    name: "armAttractScreenShowingHighScore",
    role: "once a per-frame countdown lapses, arm a fresh screen: enqueue four fixed ring commands, seed a marker byte into two cells, patch six cells from a following table (value + 0x05 marker), print the six-digit readout, set two sub-states, and enqueue a fifth command when the gate cell is set",
    cert: "seen",
  },
  0x1651: {
    name: "dispatchSequencePhase1SubStepArm",
    role: "the inner level of the two-level sequence machine for one outer mode: run the arm the RAW inner index selects out of a word table laid inline just after this entry, then this mode's shared tail advanceSequenceElseStartFreePlayGame (0x167B); the doubling that turns the index into an offset wraps at eight bits, so a large index folds back onto the head of the table",
    cert: "seen",
  },
  0x1690: {
    name: "startGameOnFreePlay",
    role: "start a game for whichever start button the input mirror shows held -- two players if the two-player bit is set, one if only the one-player bit is -- stocking each started player's block with the lives setting, and charging no credit",
    cert: "seen",
    why: "the name predicts the routine is unreachable on a coin cabinet and reachable with no coin on a free-play one, and both halves were measured. On the default coinage a read tap counted zero across four driven MAME runs including a real two-player game, while the sibling coin start site ran; with the DSW0 port read forced to the value MAME's own driver calls Free Play -- proved by COINAGE_SETTINGS and FREE_PLAY both reading all-ones while the credit cell stayed zero -- it ran and started a game with nothing inserted. Which arm is which was then fixed by changing only the button: at mirror 0x08 only the one-player arm's program counters wrote, at 0x10 only the two-player arm's, and those are the masks the driver gives the one- and two-player start buttons. All three callers test the free-play cell before tail-jumping here, which is why this one takes no credit where startTwoPlayerGame subtracts two in packed BCD",
  },
  0x172a: {
    name: "seatSequencePhase3AndResetSubStep",
    role: "jump the sequence machine to its last outer phase and restart the inner index at zero; both stores are constants and neither cell is read first, so this is an unconditional jump to a fixed place rather than a step",
    cert: "seen",
  },
  0x17e2: {
    name: "foldImageBlockIntoSignatureThenAdvanceSequence",
    role: "raise one flag cell to all bits, fold a fixed block of the program image into a running total seeded from an image byte and bank the result, then step the inner sequence index -- one step of the tamper-check sequence",
    cert: "seen",
  },
  0x17fb: {
    name: "trampolineToAdvanceSequenceSubStep",
    role: "a sequence step that does no work of its own -- it only moves the inner index on, so reaching it costs one turn and changes nothing else",
    cert: "seen",
  },
  0x17fe: {
    name: "dispatchSequencePhase2SubStepArm",
    role: "the inner level of the two-level sequence machine for one outer mode: run the arm the RAW inner index selects out of a word table laid inline just after this entry; this mode's tail does nothing at all, which is why every arm here simply ends",
    cert: "seen",
  },
  0x181e: {
    name: "parkSpritesAndArmLineWipeThenAdvanceSequence",
    role: "one step of a screen-clearing sequence: park every sprite out of sight, copy the glyph and colour showing at one fixed character cell into one fixed two-byte record, arm the line wipe to run from the plane's fifth line, and step the sequence's inner index on last; both the cell and the record are fixed here, so nothing a caller was holding chooses either",
    cert: "seen",
  },
  0x1830: {
    name: "postAttractInfoCaptions",
    role: "one arm of the two-level sequence machine (inner index 2 of dispatchSequencePhase2SubStepArm): stamp the copyright strip and flash its line, then post a fixed run of caption commands (command 1) -- 0x01, 0x14, 0x15; the bonus-life pair 0x0F/0x10 when BONUS_LIFE_SETTING is zero, else 0x11/0x12; 0x16, 0x00 -- and finish with 0x19 when CREDIT_COUNT is two or more (stepping the sequence twice) or 0x17 otherwise (stepping once)",
    cert: "seen",
  },
  0x1980: {
    name: "rearmHeldControlRepeat",
    role: "clear the one-bit press history a caller points at, and hand back a zero. A history is a byte a control's bit is rolled into every other frame, and its owner acts on the frame the low three bits read 001; while a control stays held the byte fills and that pattern cannot recur, so clearing it is what lets the same press act again",
    cert: "seen",
    why: "the name claims an EFFECT that lives entirely outside this routine -- that a control held down repeats -- and the machine could have said otherwise three ways. Driven under MAME into high-score initials entry, which is a state no instrument had visited: holding the panel bit whose history saturates at 0xFF cleared 0xA996 127 times, at a gap of 16 frames on every one of the 126 gaps, and stepped the letter index 128 times; holding the bit whose history saturates at 0x7F cleared 0xA995 145 times, at 14 frames on every one of the 144 gaps, and stepped the letter the other way, wrapping at 0x1A. Sixteen and fourteen frames are eight and seven samples, which is what the two saturation constants predict with nothing fitted, and the two arms never once cleared each other's cell. The negative control is a call site that DOES NOT EXIST: 0xA997 is the same history mechanism in the same routine with no call to this one, and holding ITS control committed a letter exactly once in the whole screen. In the same staging with nothing held the scanner ran 2041 times and this routine ran zero times. The routine is dark in undriven attract on the real machine, so none of this is visible without driving the state. What the name does NOT claim is the handed-back zero: at both call sites the byte is dead -- 0xFF and 0x7F both give 7 under `and 0x07`, so the branch is the same whether the zero is handed back or not",
  },
  0x1afc: {
    name: "sampleCellGlyphAndColour",
    role: "take what is currently showing at one character cell -- its glyph byte and the colour byte of the same cell -- and lay the two down side by side as a two-byte record. One pointer reaches both planes because they hold the same grid at the same offset and are told apart by a single address bit. The cell itself is not touched, so what the caller gets is a reading and not a reservation",
    cert: "seen",
    why: 'the reading a name has to choose between is SAMPLE and SAVE-FOR-RESTORE: both copy a cell into RAM, and only what happens to the record afterwards tells them apart. A write tap on the record cells across a driven MAME game on the real ROM settles it. The glyph half came back CONSTANT -- 0xA5 on all 15733 writes -- while the colour half alternated, 0x05 on 7865 and 0x10 on 7868, so the cell being read is blinking under the routine and the copy tracks it frame by frame; a fixed pair would have made "sample" pointless and a constant colour would have made it a plain save. A read tap on the same cells then enumerated the consumers rather than grepping for them: exactly two program counters ever read the record, 0x202D and 0x2036, and both are COMPARISONS inside advancePlayerAnimationStrip (against 0xA5, then against 0x05 or 0x10). Nothing writes the pair back to any cell in that run, which is what a restore would have to do. The two call sites fix the cells from outside: stepCopyrightScreenAwaitingStart samples 0xA61C into 0xABFE every frame, parkSpritesAndArmLineWipeThenAdvanceSequence samples 0xA5FC into 0xACBE once. The second record took ZERO reads in the run, so what consumes it is unmeasured and this entry does not claim one. Dispatches are a clean A/B: 15735 across a driven game, ZERO across two undriven attract runs of 180 and 300 emulated seconds',
  },
  0x1f01: {
    name: "turnShipTowardTargetHeading",
    role: "steer the ship one notch toward the wanted heading a table selects (leave it when already there, snap on when within one notch, else step the short way round the compass by three notches — four once the era's low digit reaches three), then fall into the shared world-scroll tail",
    cert: "seen",
  },
  0x1f55: {
    name: "negateVelocityIntoWorldScrollThenDressSprite",
    role: "negate both velocity components into the world scroll cells, so the world moves opposite the player, then dress the player's sprite for its heading",
    cert: "seen",
  },
  0x1f99: {
    name: "loc_1f99",
    role: "direction-table bytes decoded as code, not a routine: they unwind a run of stack words and leave by an unpredictable transfer. Reached only through the tamper derail into the 0x1F2E table, taken iff TAMPER_GLYPH_STRIP is not 0xA5 or TAMPER_COLOUR_STRIP is not 0x05/0x10, which never fires on a genuine image",
    cert: "code",
  },
  0x200c: {
    name: "presentChecksumForTamperTest",
    role: "put the byte the caller has been carrying where a result is read from, so the verdict of an image check can be taken; on the way it walks an address forward twice, by a wide step and then by that same byte, and the address it lands on is never dereferenced by anything downstream. It reads and writes no memory, so the walk is arithmetic and not a fetch",
    cert: "seen",
    why: "the tempting name is a table-index helper -- add a stride, add an offset, return a byte -- and the caller chain refutes it. Its only reachable entry is the tail chain showCreditLine -> sumImageBlockForTheTamperCheck -> parkTheImageTotalForTheTamperVerdict -> advanceSequenceUnlessImageTampered: sumImageBlockForTheTamperCheck folds a run of image bytes into A with `add a,(hl)`, parkTheImageTotalForTheTamperVerdict hands it on to B, and advanceSequenceUnlessImageTampered calls here and then `cp 0x67`, branching to loc_0f8d on a mismatch and tail-jumping to advanceSequenceSubStep on a match. loc_0f8d pops four words off the stack and unwinds -- it is the tamper arm, not an error return -- so the byte this entry moves into A is a verdict and the compared constant is baked in. That the walked address is a decoy is not read off the code, it is a claim about the callers, and neither branch of advanceSequenceUnlessImageTampered touches HL. Under MAME on the real ROM, with a PC-filtered read tap: 5 dispatches over 300 emulated seconds of attract, 3 over 180, 1 over a driven game, and in EVERY run the count equals sumImageBlockForTheTamperCheck's and advanceSequenceUnlessImageTampered's exactly, so the fold and the test are one chain with no second entrance. Every dispatch was captured with A = 0x67 and B = 0x67 -- the sum already correct -- and the tamper arm loc_0f8d, tapped in the same runs as the control, took ZERO dispatches in all three. A genuine image never fails, which is the only outcome that lets the game boot; a wrong constant or a second caller would have shown here. cert stays honest about one thing: with A and B equal at every observed entry, no capture can distinguish `ld a,b` from leaving A alone, and that half is read from the image",
  },
  0x214b: {
    name: "flyDemoShipByScript",
    role: "attract-demo autopilot step: tick the dwell count in the low six bits of DEMO_SCRIPT_DWELL and, when it runs out, step the script pointer and load the next dwell/turn byte; the top two bits then turn PLAYER_HEADING three notches (01 one way, 10/11 the other, 00 not at all), and it tails into scrollWorldAtTheEraPace (0x1F42)",
    cert: "seen",
  },
  0x28b7: {
    name: "seatCraftSlot0ThenDispatchByEra",
    role: "seat the record cursor and the sprite-entry cursor on one fixed object slot, then run the era-keyed dispatch over it; the pair of immediates is the whole of what distinguishes this entry from the four siblings that share its shape -- the two gated ones later in the chain differ by more",
    cert: "seen",
  },
  0x28c2: {
    name: "seatCraftSlot1ThenDispatchByEra",
    role: "seat the record cursor and the sprite-entry cursor on one fixed object slot, then run the era-keyed dispatch over it; the pair of immediates is the whole of what distinguishes this entry from the four siblings that share its shape -- the two gated ones later in the chain differ by more",
    cert: "seen",
  },
  0x28cd: {
    name: "seatCraftSlot2ThenDispatchByEra",
    role: "seat the record cursor and the sprite-entry cursor on one fixed object slot, then run the era-keyed dispatch over it; the pair of immediates is the whole of what distinguishes this entry from the four siblings that share its shape -- the two gated ones later in the chain differ by more",
    cert: "seen",
  },
  0x28d8: {
    name: "seatCraftSlot3ThenDispatchByEra",
    role: "seat the record cursor and the sprite-entry cursor on one fixed object slot, then run the era-keyed dispatch over it; the pair of immediates is the whole of what distinguishes this entry from the four siblings that share its shape -- the two gated ones later in the chain differ by more",
    cert: "seen",
  },
  0x28e3: {
    name: "seatCraftSlot4ThenDispatchByEra",
    role: "seat the record cursor and the sprite-entry cursor on one fixed object slot, then run the era-keyed dispatch over it, with no gate in front of it",
    cert: "seen",
  },
  0x28ee: {
    name: "seatMotherShipSlotThenDispatchByEraUnlessArmed",
    role: "run the era-keyed dispatch over the mother ship's slot, but only while the armed cell is clear -- a set cell returns at once, leaving the slot unserviced for the frame",
    cert: "seen",
  },
  0x28fe: {
    name: "seatCraftSlot6ThenDispatchByEraUnlessArmed",
    role: "run the era-keyed dispatch over one fixed object slot, but only while the mother ship's armed cell is clear -- a set cell returns at once, leaving the slot unserviced for the frame",
    cert: "seen",
  },
  0x290e: {
    name: "dispatchSeatedSlotByEraIndex",
    role: "run the arm the LOW THREE BITS of the ERA INDEX select from the word table laid inline just behind this entry, over the slot the caller seated; the arm is jumped to, so it returns straight to this entry's caller and nothing here runs after it",
    cert: "seen",
  },
  0x291e: {
    name: "foldBlockIntoTotal",
    role: "fold a run of image bytes into a total the caller has already seeded, walking a SECOND pointer alongside it in lockstep. The second walk adds nothing: each step overwrites the same byte-wide holder, so only the last byte it passes survives, and on a genuine image its leftover went unread by every RAM signature the pass sampled. A count of zero means a full 256 bytes, the total wraps at eight bits, and no memory is written",
    cert: "seen",
    why: "the name calls the total the product and the second walk a passenger, and MAME could have refuted either half. The one call site seeds the total from (0x27C0), banks what comes back at 0xAA6F, and three frames later sequence arm 0x2730 does cp 0x76 / jp nz,0x2530 -- the 0x76 summed independently from the thirty ROM bytes at 0x335E matches the constant the check carries, and 0x2530 took zero hits on a genuine image. Flipping the returned total at the routine's own ret drove the machine into 0x2530 three times and moved 77 of 108 RAM signatures; flipping the byte the second walk left behind moved none of the 108. A control that failed to move anything would have made the second reading worthless, and it moved a great deal",
  },
  0x2b60: {
    name: "driftWithWorldScroll",
    role: "add the frame's world-scroll displacement to one object's two split 16-bit coordinates",
    cert: "seen",
    why: "negateVelocityIntoWorldScrollThenDressSprite writes the displacement pair as the NEGATION of a velocity pair on its way into the routine that refreshes the player sprite from its heading, and gameplay.md records that the background moves opposite the plane -- so adding that pair to a world-static object is what streams it past a fixed ship",
  },
  0x2bb4: {
    name: "decrementObjectStateThenFlyAtSlowestSpeed",
    role: "count an object's state byte down by one and let it fly on at the slowest of the velocity-table speeds; the countdown wraps at a byte and nothing here tests it, so reaching zero is the caller's business. Both entries into it are on the path a slot takes once its state byte is neither free, live nor held",
    cert: "seen",
  },
  0x2bde: {
    name: "retireSlotAndSubPixel",
    role: "take an object out of play, zeroing each coordinate WHOLE — occupancy byte, both sub-pixel remainders, and both sprite-entry coordinates",
    cert: "seen",
    why: "it clears the two sub-pixel remainders as well as the coordinates, which the sibling retire helper leaves standing; spawn paths differ on whether they reinitialise those cells, so which helper retired a slot can still be visible to its next occupant",
  },
  0x2c22: {
    name: "moveObjectByStateByteThenRunAppearance",
    role: "move one object for the frame according to its state byte, then run the shared appearance step over that same object: from thirty-two up it counts the state byte down and flies on at the slowest table speed, below thirty-two it only drifts with the world and the state byte is left alone; the appearance step runs on both paths",
    cert: "seen",
  },
  0x3cc4: {
    name: "hasReachedBoundaryBandSelectedByHeading",
    role: "answer, in the carry flag, whether an object has reached a boundary: the heading in the object's record chooses which of two adjacent and disjoint three-wide bands is tested on the sprite entry's byte at +0x31, and when that band test fails a second, four-wide window test on the same sprite entry's head byte (hasReachedHorizontalEdgeWindow) decides -- so carry is the OR of the two tests",
    cert: "seen",
  },
  0x3dda: {
    name: "serviceFixedSlotInEra1",
    role: "guard on the era index and, when it passes, hand two fixed bases to the shared slot servicer; the guard is the whole of the decision, and the bases are constants rather than anything a caller chose",
    cert: "seen",
  },
  0x3deb: {
    name: "serviceSlotByHeadByte",
    role: "service one slot, splitting three ways on the head byte of its record: zero does nothing at all, all-ones flies the object one step along the velocity it carries and retires it into the shared cooldown only once that step has put it on a retire line, and any OTHER value retires it on the spot without moving it first (that last arm is a code-level reading: no capture wrote the head byte with any value but zero or all-ones)",
    cert: "seen",
  },
  0x3e6c: {
    name: "flyAndRetireSlotCyclingShapeInEra4",
    role: "fly one object a step along the velocity it carries and retire its slot once that step has put it on a retire line; in one era of the game, and only that one, the object is also given the next frame of a fixed shape cycle before it moves, and the retire is last so a shape written this tick may go out in the same breath",
    cert: "seen",
  },
  0x3e8e: {
    name: "runSlotCountdownDriftAndAnimateElseRetire",
    role: "run one slot's counter down for a frame and take the slot out of play as soon as it has nothing left to run; the era cell not standing at the last era, or the counter already sitting one above the floor, ends it outright, and otherwise the counter drops by one and the slot drifts with the world",
    cert: "seen",
  },
  0x3f93: {
    name: "requestEraKeyedLaunchSound",
    role: "request the sound of a craft launching, taking the code from one of two program bytes according to whether the era has reached the fourth; both go through the play-gated door, so the attract demo stays silent",
    cert: "seen",
    why: "the split point is the claim and it is refutable per era. Read taps on both tail targets under MAME: the high arm fired 7 times on the one tape that reaches the fourth era and ZERO on every tape that stops below it, including a poked run held at the first era, while a poked run held at the fifth took it on most dispatches. Had both arms queued the same byte the distinction would not exist; the two program bytes differ. 'Launch' rather than the object's name is deliberate and rests on the caller: its one caller is the tail of a spawner that finds a free slot and writes a fresh record -- velocity, shape and the live state code -- with nothing after this call able to abort it, so the request is one-to-one with something appearing. What that something IS stays unnamed, and a sibling launcher reaches the low arm directly even in the fifth era, so this selector belongs to its own caller and not to launches in general",
  },
  0x409d: {
    name: "stampObjectStateByte3bThenRequestSound",
    role: "stamp one object's state byte to fifty-nine and ask for the sound that goes with it; the stamp is unconditional -- nothing here reads the byte first, and the ROM's test at this entry sends both of its answers to the same address",
    cert: "seen",
  },
  0x4afb: {
    name: "paintCreditCountPanel",
    role: "set the pen colour, the destination cell and the source byte, then paint them through the packed-digit painter; every one of the three is fixed here, so a caller chooses none of them",
    cert: "seen",
  },
  0x566e: {
    name: "requestTwoSoundsWhilePlaying",
    role: "ask for two sounds in a row, each code fetched from its own byte of the program image, both admitted only while a game is being played",
    cert: "seen",
    why: "requestTwoSounds is this routine's structural twin -- same two-fetch shape, same fall-through into the entry that supplies the second code -- and the ONLY difference between them in the image is the permission: this one enters enqueueSoundIfGameInProgress twice, which drops the request with the play flag clear, while the twin enters enqueueSoundIfGameOrAttract, which also admits the demo. That is what the name has to carry and either entry could refute it. Under MAME every dispatch of this routine was in the demo with the play flag clear, the state its own permission drops, while the twin dispatched 101 times in the same run",
  },
  0x56d2: {
    name: "requestRoundIntroSoundBurst",
    role: "ask for three sounds whose codes come from bytes of the program image, all three refused unless a game is being played, then leave through the two-request tail whose permission is looser -- so a state that drops the three can still admit the pair",
    cert: "seen",
  },
  0x58aa: {
    name: "loc_58aa",
    role: "fly one object a double step at the pace one fixed table of velocity samples sets; choosing the table and the mover is the whole of this entry, and a pointer the caller held is discarded",
    cert: "seen",
  },
  0x58b6: {
    name: "loc_58b6",
    role: "fly one object a step at twice the velocity one fixed table of samples sets, the shared drift added once; choosing that table is all this entry does",
    cert: "seen",
  },
  0x599d: {
    name: "loc_599d",
    role: "take the heading out of an object's own record and continue into the doubled velocity lookup, forwarding rather than replacing the table pointer the caller seated -- which is what separates it from the sibling shims that choose a table themselves",
    cert: "seen",
  },
  0x59c5: {
    name: "loc_59c5",
    role: "hand back the doubled component pair a heading handed straight in calls for, at the pace one fixed table of samples sets; choosing that table is all this entry does",
    cert: "seen",
  },
  0x59cb: {
    name: "loc_59cb",
    role: "hand back the doubled component pair a heading handed straight in calls for, at the pace a second fixed table of samples sets; choosing that table is all this entry does",
    cert: "seen",
  },
  0x59d1: {
    name: "loc_59d1",
    role: "hand back the doubled component pair a heading handed straight in calls for, at the pace a third fixed table of samples sets; choosing that table is all this entry does",
    cert: "seen",
  },
  0x2b83: {
    name: "hasReachedRetireLine",
    role: "answer whether an actor has drifted onto either of two fixed retire lines, within a narrow wrapped window, which is what makes its caller free the slot",
    cert: "seen",
    why: "resetPlayfieldAndArmNewRound pins the player's own sprite entry at (0x84, 0x78) and dressPlayerSpriteForHeading (0x20AF) never rewrites those two bytes, so the two lines at 0x04 and 0xF8 are each exactly +0x80 -- the antipode in a coordinate that wraps at 256; the callers that act on the carry use it to free the slot, though at least one path discards it",
  },
  0x2d62: {
    name: "driftOneTileSceneryAtThreeQuarters",
    role: "drift one scenery object at three quarters of the frame's world scroll, lay no further tile, and step both cursors onto the next slot",
    cert: "seen",
    why: "same family, same falsifiable arithmetic as driftThreeTileSceneryAtFiveQuarters: this is the one-tile member, so the era-4 arm that calls it twice can reach the band's eight slots only if it lays exactly one -- 2+2+1+1+1+1 -- and any second tile would overrun the band. Its callee driftAtThreeQuartersWorldScroll is already grounded to the scenery slots, and driftTwoTileSceneryAtThreeQuarters' entry lists this shape as its 'three quarters with one tile' sibling. It sits in the dispatcher's fifth-era arm, and under MAME the deep and era-advance captures reach it there; it writes nothing of its own beyond the return stack, consistent with laying no further tile",
  },
  0x2d68: {
    name: "driftOneTileSceneryAtHalf",
    role: "drift one scenery object at half the frame's world-scroll displacement, lay no further tile, and step both cursors onto the next slot -- the one-tile member of the parallax family, and the slowest rung, so what it moves reads as the farthest layer",
    cert: "seen",
    why: "the family's names rest on a fraction each, and the one thing that could break this member is a second wrapper sharing its rung -- then 'the half rung' would not be this entry's to own and the tile count would not be readable off its body. A PC-filtered read tap under MAME on the real ROM put that to the test three times and the counts came back IDENTICAL to driftAtHalfWorldScroll's in every run: 8427/8427 and 14153/14153 on two undriven attract runs of 180 and 300 emulated seconds, 5351/5351 on a driven one-player game held in the first era. Sole caller, measured, not derived from a grep -- and the grep could not have shown it, since the dispatch comes off a table the ROM reads at runtime. The rung itself is already watched: driftAtHalfWorldScroll's entry records a capture matching each wrapper to its own fraction on every dispatch and to the other two on none, every dispatch seated inside the eight scenery slots. What stays code-derived is the TILE COUNT: this entry places none of its own before stepping the slot, which is one tile per dispatch by construction, and mechanisms.md's era table reads the same count off the same body. Watched at eras 0 through 3 -- the attract runs visit the second through fourth, the driven run holds the first -- while the fifth era's list, which names it twice, was reached by no run here",
  },
  0x2d6e: {
    name: "driftAtFiveQuartersWorldScroll",
    role: "move one object by the frame's world-scroll displacement and a further quarter of it, so it over-travels the world; applied to both of its split coordinates, whole part in the sprite entry and fraction in the object record",
    cert: "seen",
    why: "the displacement pair it reads is written elsewhere as the negation of the player's own velocity, which gameplay.md describes independently as the background moving opposite the plane -- so it is the camera and nothing of the object's. Its only caller chain is the era-keyed dispatcher, which seats every dispatch inside the scenery slots. The fraction assignment makes a prediction its callers could refute: parallax depth should track sprite size, and each dispatched wrapper places a different number of tiles before stepping the slot -- smallest scenery on the slowest rung, largest on the fastest. Crossing any two of these names inverts that. A MAME run then watched all three addresses and matched each to its own fraction on every dispatch and the other two on none, every dispatch seated inside the scenery block. What that capture covers is the fraction and the slots; the rung ORDERING and the sprite-size correspondence stay code-derived, since it watched neither relative speed nor sprite size",
  },
  0x2d93: {
    name: "driftAtThreeQuartersWorldScroll",
    role: "move one object by three quarters of the frame's world-scroll displacement, applied to both of its split coordinates, whole part in the sprite entry and fraction in the object record",
    cert: "seen",
    why: "the displacement pair it reads is written elsewhere as the negation of the player's own velocity, which gameplay.md describes independently as the background moving opposite the plane -- so it is the camera and nothing of the object's. Its only caller chain is the era-keyed dispatcher, which seats every dispatch inside the scenery slots. The fraction assignment makes a prediction its callers could refute: parallax depth should track sprite size, and each dispatched wrapper places a different number of tiles before stepping the slot -- smallest scenery on the slowest rung, largest on the fastest. Crossing any two of these names inverts that. A MAME run then watched all three addresses and matched each to its own fraction on every dispatch and the other two on none, every dispatch seated inside the scenery block. What that capture covers is the fraction and the slots; the rung ORDERING and the sprite-size correspondence stay code-derived, since it watched neither relative speed nor sprite size",
  },
  0x2df4: {
    name: "driftAtHalfWorldScroll",
    role: "move one object by half the frame's world-scroll displacement, applied to both of its split coordinates, whole part in the sprite entry and fraction in the object record",
    cert: "seen",
    why: "the displacement pair it reads is written elsewhere as the negation of the player's own velocity, which gameplay.md describes independently as the background moving opposite the plane -- so it is the camera and nothing of the object's. Its only caller chain is the era-keyed dispatcher, which seats every dispatch inside the scenery slots. The fraction assignment makes a prediction its callers could refute: parallax depth should track sprite size, and each dispatched wrapper places a different number of tiles before stepping the slot -- smallest scenery on the slowest rung, largest on the fastest. Crossing any two of these names inverts that. A MAME run then watched all three addresses and matched each to its own fraction on every dispatch and the other two on none, every dispatch seated inside the scenery block. What that capture covers is the fraction and the slots; the rung ORDERING and the sprite-size correspondence stay code-derived, since it watched neither relative speed nor sprite size",
  },
  0x309b: {
    name: "advanceToNextSlot",
    role: "step the record cursor and the parallel sprite-entry cursor on to the next object slot",
    cert: "seen",
    why: "placeAbuttingTile uses it to step onto a further tile of the sprite it has just placed, while driftOneTileSceneryAtThreeQuarters and driftOneTileSceneryAtHalf use it to reach a different entity -- the callers disagree about what the next slot holds, so the unit it advances is the slot index, not the object",
  },
  0x3114: {
    name: "trampolineToLoc_307f",
    role: "a bare transfer to 0x307F and no return; no cell is read or written and no register moves",
    cert: "code",
  },
  0x3156: {
    name: "seatSceneryFillByte0x28ThenClearEraScenery",
    role: "fix the fill byte and transfer to 0x30D1 without returning; choosing that one constant is the entire content of the entry, so whatever the caller carried in its place is discarded",
    cert: "seen",
  },
  0x315b: {
    name: "loc_315b",
    role: "a bare transfer to 0x3176 and no return; no cell is read or written and no register moves",
    cert: "code",
  },
  0x339c: {
    name: "setSavedPenFromEra",
    role: "seed the pen (glyph and colour) that the active player's SAVED context block will hand back, from the two-byte record the era in that same block selects out of a ROM table; the live pen is left alone -- which is what separates it from seatCaptionPenFromEraFoldingTamperIntoPhase (0x335E), which also sets the live pen, folds an image block into a tamper check and can repaint",
    cert: "seen",
    why: "'saved' and 'era' are the two discriminating claims and each could have failed at the ROM. Forced 5920 times under MAME by a PC-gated opcode substitution at a per-frame host, its entire effect against a control that displaces the same host is TWO program counters writing TWO cells -- 0xAD1B taking 0xF1 every time and 0xAD1C taking era+1 -- with the sequencer cells, the command ring and every other byte of 0xAD00-0xAD3F identical, and ZERO of 57344 pixels changed on four frames where removing the host alone changes 91. That zero is what says SAVED: a one-player game never swaps a context in, so a write to a save block cannot reach the glass. A read tap over both save blocks through a 420 s two-player game then closes the chain the other way -- the sixteen-byte `ldir` at 0x4C8A reads all thirty-two save cells and lands 0xAD1B/0xAD1C in 0xAD0B/0xAD0C thirteen times, and plotPenCell stamps those two onto a character cell. The ROM's own nearer arm at 0x335E writes the same two cells with the same values three times unforced in the same log, and adds the live pair and a repaint, which is the difference the name carries. 'Era' rather than 'round': 0xAD14 is offset 4 of the save block and the save `ldir` at 0x1211 copies 0xAD04 there, and 0xAD04 is ERA_INDEX -- ROUND_NUMBER is 0xAD01 and is not read here",
  },
  0x3421: {
    name: "drawCaptionFivePastSharedColour",
    role: "paint the caption an index selects from the shared record table, taking the destination and the glyph run from the record but the colour from a cell outside it, five past that cell's value and kept to four bits",
    cert: "seen",
    why: "the discriminating claim is the OFFSET, and the image holds the set that makes it one: three handlers read the SAME cell and add 0, 5 and 10 before the same four-bit mask, all three ending in drawTextRun, while a fourth (drawTextRunByIndex) takes the colour the record itself carries. This is the +5 member; drawCaptionInPenColour is the +0 and drawCaptionTenPastSharedColour the +10. Measured on the real ROM with a read tap on the source cell attributed by program counter, over 9000 frames of undriven attract and 13200 frames of a coin-driven run: this entry took 22 and 33 dispatches, every one at destination 0xA673, and the colour it used was the source value plus five every time -- source 2,3,4 against used 7,8,9. In the SAME runs the +0 sibling painted that same destination at 2,3,4 and the +10 sibling at 12,13,14, so the three really do take turns at one caption rather than one of them cycling. The record's own colour byte, read at HL-1 on each dispatch, was 4 throughout and equalled the colour actually used on 0 of 22 and 0 of 33 dispatches -- so 'a colour the caption does not own' is measured and not inferred from the skipped `inc hl`. What the capture does NOT cover: which caption 0xA673 is, and whether any handler other than these four reaches the same record",
  },
  0x3855: {
    name: "stopFiveSlotAnimations",
    role: "leave five consecutive object records standing on the shape a finished animation ends on, with their step bytes cleared so nothing walks them again — but only while the byte the caller points at still reads zero, so it is a guarded settling and not a step",
    cert: "seen",
    why: "'stop' rather than 'start' is the claim, and the animation machine settles it: a record's step byte is counted down once per dispatch and the count it lands on indexes the run, so a step of zero is the run's FIRST byte and the countdown reads a zero step and returns before writing, which means nothing raises it again. The shape written is 0x11, and every one of the eighteen run pointers in the table at 0x3438 (0x346F..0x368F, 0x20 apart) has 0x11 as its first byte — so this writes precisely the resting state, and had any run started on something else the name would be wrong. The three sites that ARM an animation load 0x20 into the same byte, which is the opposite store. Watched on the real ROM through a write tap over 0xA850-0xA89F attributed by program counter: 100 writes from this routine across 9000 frames of undriven attract and 150 across 13200 frames of a coin-driven run, ten bytes per dispatch, every one either +8 taking 0x11 or +9 taking 0x00, on records sixteen apart from 0xA850. The tap's positive control is in the same column: the spawner at 0x36AF-0x3792 wrote into that same band 344 and 512 times in the same runs. The guard is the caller's: its only inbound transfer is a `jp z` from 0x36AF taken when LIFE_TICKS_MID & 0x0F is 7, with HL pointing at LIFE_TICKS_LOW, and every logged dispatch read 0xAD05 = 0x00 and 0xAD06 = 0x07. What is NOT claimed: what the five slots hold, or what 0x11 looks like",
  },
  0x3cd9: {
    name: "hasDriftedOffTheField",
    role: "answer whether an object has drifted onto the boundary its caller frees the slot at: the vertical window this arm owns is tested here, and when it is not met the same question is handed on to the horizontal one, so the answer is an OR of two windows on two axes and only the first is decided here",
    cert: "seen",
    why: "the effect claim is the caller's, and both callers agree: 0x3B77 and 0x4447 each take the carry and, on a yes, tail into a routine whose whole body is stores of zero — 0x3C0D zeroes two occupancy bytes and the entry's two coordinates, 0x46DB zeroes the occupancy byte and all four of the entry's coordinate bytes. Nothing else consumes the answer. Its own window is the falsifiable part and one bound could have been dead: read-tapped on the real ROM, gated by PC, this arm read the entry's vertical byte 743 times across 9000 frames of undriven attract and 905 across 13200 frames of a coin-driven run, sweeping 0x38 to 0xF0, and landed INSIDE its three-wide window exactly once — at 0xF0, the window's own first value. Rare and reachable, which is what an off-field test should look like; the horizontal half it hands to, 0x3CE1, took 1519 and 1681 reads over 0x31 to 0xCF and entered its four-wide window zero times, so the two axes are not the same test twice. It is an ARM, not an entry: its only inbound transfer is `jp nz,0x3cd9` from 0x3CC4, taken on the heading — 743 of 1521 and 905 of 1683 heading reads chose it — and 0x3CC4's other arm tests the SAME axis three lower, so the two windows are adjacent and disjoint and the heading picks which side of the line the object is approaching from. That is also why a three-wide window is not obviously steppable-over here, unlike hasReachedRetireLine's. NOT COVERED by the capture: the retirement actually following a yes (the single in-window hit was counted, not traced through to the occupancy byte), and which heading half means which direction",
  },
  0x3e36: {
    name: "stepFourActorSlots",
    role: "put four named actor slots through the shared per-slot step, in a fixed order, one after another, without asking first whether any of them holds anything — so the four are serviced as a group and the group's membership is fixed here rather than by the caller",
    cert: "seen",
    why: "'four, unconditionally, every time' is the whole of the claim and a tap can refute it outright. Read tap on the record band gated to the step's own state read, on the real ROM: across 9000 frames of undriven attract each of the four records 0xA810, 0xA820, 0xA830, 0xA840 was read exactly 6584 times, and across 13200 frames of a coin-driven run exactly 9866 times each — four equal counts, which a routine that skipped free slots could not produce, and 22208 of the 26336 attract reads returned 0x00 (free). The four IX bases pair with the four IY bases the routine loads beside them, 0xAA12, 0xAA14, 0xAA16, 0xAA18, under the record/entry mapping mechanisms.md states independently — (0xA810-0xA800)/8 = 2 and (0xA840-0xA800)/8 = 8 against 0xAA10 — so 'slot' is the right unit and 'actor' is the band those four sit in. The state values seen are the lifecycle's and nothing else: 0x00 and 0xFF throughout, plus one sighting each of a dying countdown (0x14 at 0xA810, 0x28 at 0xA830, 0x32 at 0xA840) and none at all at 0xA820. It is entry fifteen of the round engine's per-frame service list at 0x1199, and 6584 dispatches in 9000 frames is the sub-every-frame cadence that list is documented to run at. NOT claimed: what the four slots hold, or why these four and not the rest of the actor band",
  },
  0x3e63: {
    name: "dispatchObjectSlotByHeadByte",
    role: "split three ways on the head byte of the record an index register points at: zero returns with nothing done, all-ones hands over to one continuation and every other value to another. One byte read, nothing written, and neither continuation is given anything this entry computed",
    cert: "seen",
  },
  0x3ecb: {
    name: "stampObjectStateByte3bThenRequestTwoSounds",
    role: "force the head byte of the record the caller points at to 0x3B, then request two sounds (requestTwoSounds); what the byte held is discarded unread, so this is a clamp and not a step",
    cert: "seen",
  },
  0x3faf: {
    name: "dressSpriteShapeAndAttributeForHeadingSector",
    role: "point an object's sprite the way it is heading: round the heading in its record (+2) to one of sixteen sectors, and set the sprite entry's shape byte (+1) from that sector's entry in HEADING_SECTOR_SHAPE_TABLE and its attribute byte (+0x30) from the parallel table sixteen bytes on",
    cert: "seen",
  },
  0x4017: {
    name: "flyAlongBallisticArc",
    role: "fly one object a frame along a ballistic arc -- a constant sideways step whose sign the record's own flag fixes, and a stored velocity on the other axis that gains a fixed amount every frame -- carrying it with the world scroll in both axes, and retiring the slot outright once it leaves the field on either",
    cert: "seen",
    why: "'ballistic' says one axis is integrated and the other is not, which the spawner could have refuted: it seeds that velocity word to minus one whole pixel per frame -- pointing AWAY from the direction it then accelerates -- and sets the sideways flag from the sign of the thrower's offset against the player's pinned sprite entry, so the arc always leans toward the player. A constant-speed mover, or a flag drawn from a heading table or the generator, would have killed the name, and the neighbouring era arms do exactly those instead. Under MAME it took ZERO dispatches on the attract demo, which runs the second through fourth eras, and thousands on all three tapes held in the first -- its caller's era gate, measured -- and BOTH retire arms fired, so neither bound is dead. The name carries no object noun on purpose: gameplay.md records the manual describing the first era's thrown grenades in exactly these terms, which is what first suggested the reading, but that is an outside document and no capture here identifies what this object is",
  },
  0x40ab: {
    name: "retireSlot",
    role: "retire an object, zeroing only the INTEGER halves — occupancy byte and both sprite-entry coordinates — leaving the sub-pixel remainders standing",
    cert: "seen",
    why: "no file calls both this and the sibling retire helper -- the two caller sets are statically disjoint, which is what makes them two families' helpers rather than two versions of one; and retireSlotIntoSharedCooldown re-arms a cooldown byte after calling it, a slot going back on cooldown rather than an object deleted",
  },
  0x0010: {
    name: "fetchTableWord",
    role: "fetch the two-byte entry an index selects from a word table and hand back both the word and the address past it",
    cert: "seen",
    why: "0x0008 is fetchTableByte and 0x0018 offsetAddress; this routine calls 0x0018 and then reads a word -- it is the word member of that family by construction; it is reached by a one-byte restart where the wide-index sibling needs a three-byte call, which is what makes it the default form",
  },
  0x0028: {
    name: "retreatCharCursor",
    role: "step the character-cell cursor one cell back along the line being drawn, the inverse of the advance vector",
    cert: "seen",
    why: "paintDigitDroppingLeadingZero calls it on a blanked digit and returns so the caller's following advanceCharCursor nets to zero -- a suppressed digit consuming no cell is only coherent if the two are exact inverses on the same axis; MAME's ROT90 maps an increasing native row to a decreasing display column, which is the direction retreat names",
  },
  0x00a8: {
    name: "enableInterruptAndEnterForegroundLoop",
    role: "bring the machine up and never come back: set the interrupt-enable bit of the output latch from the low bit of the byte the caller carries, pet the watchdog, and fall into the foreground loop -- neither store reaches work RAM, and there is no return path",
    cert: "seen",
    why: "the refutable half is the ENABLE, and it was measured both ways in one run. Under MAME on the real ROM a write tap gated to this routine's own program counter caught exactly ONE store, 0xC300 <- 0x01 with the counter at 0x00A8; MAME's timeplt.cpp routes 0xC300-0xC30F to the LS259 whose Q0 is nmi_enable_w, so the low bit is the enable and the byte the caller hands over is the ROM byte at 0x4C87, which reads 0x01. The negative control is in the same trace and comes from the ROM itself: boot writes 0x00 into all eight latch offsets before this, and a fetch tap on the interrupt vector 0x0066 counted ZERO acceptances up to this routine's single entry at t=3.9217 s and the first one 11.6 ms later -- so the interrupt starts here and not earlier. The one-way half is corroborated from outside: the entry tap fired exactly ONCE in a 30 s attract run and this routine's latch store fired exactly once in each of three further 12 s runs, and mechanisms.md records the drain it falls into holding a single stack-pointer value over 4.5 million fetches of its loop head, which is what no return address looks like. The WATCHDOG store is named by the hardware map, not by the value: the driver maps 0xC200 writes to watchdog reset_w, which ignores its data -- so a name reading the byte as a watchdog argument would be wrong.",
  },
  0x00b1: {
    name: "tileCharPlaneWithBoxLattice",
    role: "tile the character plane with a lattice of boxes -- fourteen bands of sixteen, each box two cells wide and two lines deep, every one of them laid down by stampGridBox -- walking a cursor that starts a full line above the first band it writes and skips a line before each band, so the lattice keeps clear of the top of the plane and its bands come out contiguous; every position is counted out here and nothing is read to decide where a box goes",
    cert: "seen",
    why: "this address was watched directly, not inferred: under MAME it dispatched ONCE, at frame 33, in phase 0. The extent is the refutable half of the role, and it cross-derives from two directions that were not fitted to each other. From this side: fourteen bands of sixteen is 224 boxes of four cells, 896 writes, and a cursor from 0xA420 advancing a line per band plus two cells per box lands its last write at 0xA7BF. From the other: a MAME write tap gated to stampGridBox at 0x00C7 counted 224 dispatches of four writes each, 896 cells with not one written twice, spanning 0xA440-0xA7BF, a tiling of 28 of the plane's 32 lines across all 32 columns. Those writes are all this routine's and that is checkable rather than assumed: CALL 0x00C7 occurs at exactly ONE address in the 24576-byte image, 0x00BC, interior to this routine's own range, with no JP to it anywhere -- and that is a scan of the WORD and not merely of the opcode forms, because a computed dispatch would name no opcode: the bare word occurs at four further addresses, none preceded by a call or jump opcode, each inside a table of little-endian words stepping by about three -- data, not a dispatch table. The count could have come out otherwise -- a second execution would have shown 1792 writes to the same 896 cells, and it showed 224 dispatches in each of two independent runs. The role says 'lattice' and not 'background' deliberately: mechanisms.md records the same census finding the plane blank before the fill, the pattern standing from frame 35 to frame 236, 812 cells left at frame 240 and none at frame 300, so this is a power-on pattern that the boot wipe removes before the attract loop, and nothing draws on it",
  },
  0x00c7: {
    name: "stampGridBox",
    role: "lay the four corner tiles of one hollow sixteen-by-sixteen box into the character plane at the cursor -- two cells across and two rows down -- and give the cursor back unmoved",
    cert: "seen",
    why: "'box' is the refutable half and the tile ROM settles it: codes 86, 131, 199 and 239 decode through this board's character layout as a top edge with a left edge, a top edge with a right edge, and the two matching bottom halves, which assemble into a closed rectangle and nothing else. 'Grid' is the caller: tileCharPlaneWithBoxLattice runs this over 224 distinct cursors stepping two cells across and two rows down, and a MAME write tap attributed to this routine's own stores counted 896 writes to 896 DISTINCT cells spanning 0xA440-0xA7BF -- a regular tiling of 28 of the plane's 32 lines, where a caption would have been a handful. It does NOT claim a gameplay background: the same runs show the plane already blank before the fill, the fill standing for about 200 frames from power-on with the video-enable bit set, and the boot wipe erasing all 896 cells before the attract sequence starts",
  },
  0x018c: {
    name: "fetchWideTableWord",
    role: "fetch the word an index selects from a word table, with the index doubling carrying into the high byte so the table may run past the reach of its narrow sibling",
    cert: "seen",
    why: "the only thing separating it from fetchTableWord is that the index doubling carries into the high byte, so this is the form a table wider than 128 entries needs -- a distinction no call site currently exercises, which is exactly why the name must carry it rather than the call sites",
  },
  0x0b06: {
    name: "stampCopyrightStrip",
    role: "stamp the four fixed pieces of the copyright caption into the display-list shadow; it reads nothing, so re-stamping changes nothing",
    cert: "seen",
    why: "sibling hideCaptionSprites zeroes the vertical byte of exactly these four slots and nothing else, so an outside routine treats them as one addressable unit; the shapes it places decode out of the sprite ROM as the glyphs of the copyright caption, in the order it places them",
  },
  0x0e8d: {
    name: "drawSlotWithOneGlyph",
    role: "paint a two-cell character slot with a single glyph, blanking the other cell of the slot, give both the caller's colour, and step the cursor on to the next slot",
    cert: "seen",
    why: "the name predicts a write pair one cell apart with the blanking glyph on the lower address on every dispatch, and a MAME write tap gated to this routine saw 126 dispatches and 126 such pairs with no other shape. Two siblings fix the slot as two cells wide and not one: paintDoubleTile writes glyphs into BOTH cells of the same pair and paintQuadTile writes four, all three stepping the same cursor by the same amount -- so the blank is the unused half of a fixed-width slot. It is not leading-zero suppression, which mechanisms.md attributes to a different drawer that chooses its glyph three ways from a carry flag",
  },
  0x0e9c: {
    name: "paintDoubleTile",
    role: "lay one two-tile block into the character plane from a base code the caller fixes -- the base below the cursor and the base plus one at it -- colour both cells a plane below, and step the cursor clear of the block",
    cert: "seen",
    why: "the family is named by BLOCK SIZE, as paintQuadTile's entry records, and this is the member the count of FIVES drives -- checkable, and checked on the real machine. Neither MAME sweep reached it, because the only argument either sweep presented to the routine that splits a value into thirties, tens, fives and ones was 1; posting that routine's ring command by the ROM's own protocol with the argument 37 -- one thirty, no tens, one five, two units -- dispatched this routine exactly once, paintQuadTile exactly once and the single-tile painter twice more, and a write tap caught this one laying codes 0x32 and 0x33 into two character cells with colour 0x11 in the two cells a plane below. Any other reading of the denominations gives different counts",
  },
  0x0eeb: {
    name: "paintDigitDroppingLeadingZero",
    role: "paint one decimal digit, with its colour, into the cell a cursor names -- or drop it and give the cursor back where it started, so the digit occupies no cell at all. Only the low four bits of the value choose the shape. A digit is dropped only while a caller-set allowance is left; a non-zero digit spends the whole allowance at once, so nothing after the first significant digit can be dropped and a zero in the last place still prints",
    cert: "seen",
    why: "the discriminating claim is DROP versus BLANK, and the two differ in one observable: whether the suppressed place consumes a cell. 30 s of undriven attract under MAME reaches it ZERO times, so it was made to run on the real machine -- MAME, posting command 7 by the ROM's own protocol (the command byte written into the ring cell the read cursor at 0xA9B3 names) while holding ROUND_NUMBER at a chosen value. With 37 the routine was entered 904 times and made 1808 character-plane writes: glyph 0x64 into 0xA5B7 and glyph 0xB0 into 0xA597, one cell apart, each with its colour a plane below at 0xA1B7/0xA197. With 7 it was entered the SAME 904 times and made 904 writes -- the zero place wrote NOTHING, and the surviving glyph 0xB0 landed at 0xA5B7, the very cell the tens digit had occupied in the other run. A blanking implementation would have written the blank glyph 0xF1 at 0xA5B7 and pushed the 7 to 0xA597; it did neither. The register log carries the mechanism with it: the first entry of every pair arrives with the allowance at 1 and the second with it at 0, whether the first place painted or was dropped, and the cursor DE reads 0xA5B7 on both entries of the dropped run against 0xA5B7 then 0xA597 on the painted one -- the retreat and the caller's advance cancelling exactly. The control is not blind: the identical script with the poke disabled dispatched it ZERO times and produced zero writes, and the same tap fired 904 times under the poke. That the shapes are DECIMAL digits is the ROM's: the table at 0x0F06 decodes through this board's character layout as 0-9 in its first ten entries and the blanking tile in the eleventh -- a different code set from the 0x0DCC table but the same drawn glyphs, and the table runs into the code at 0x0F11 after that, so only the digits are addressable.",
  },
  0x0f11: {
    name: "advanceSequencePhase",
    role: "advance the outer sequence phase and restart its inner step index at zero",
    cert: "seen",
    why: "it executes zero times across a driven run -- every read of its entry byte is a checksum fold, none with the program counter at the address -- which corroborates from outside that all but one of its callers sit behind an anti-tamper test and are dead on a genuine image",
  },
  0x1226: {
    name: "handPlayOverToOtherPlayer",
    role: "give the turn to the other player: flip the one-bit active-player index, re-arm the shared sequence delay with a fixed span, and reseat the inner sequence index from a byte of the program image; nothing is copied here, and the flip is the only effect the skipped arm does not also have",
    cert: "seen",
    why: "the name predicts that a ONE-player game can never reach this entry, because the one-player start paths arm one save block and write zero into the other while the branch that arrives here is taken only when the OTHER block's first byte is non-zero -- so a two-player start must make it fire and a one-player start must not. Two MAME runs on the real ROM differing in one line of the driver, which start field it pulses, settled it: nine dispatches under a two-player start against ZERO under the one-player control, the selector alternating 0/1 on each of the nine, and the counts closing against the ten deaths the same runs recorded. It could have come out either way and the control is what makes the nine mean anything. Which player each value names is fixed outside this routine too: the code at 0x078D posts caption index 9 or 10 on this cell, and those two records of the table at 0x0C50 are identical but for the one glyph that the score field independently fixes as 1 versus 2. A read of video RAM at the two score fields through the same run shows the inactive player's six cells frozen and the active player's moving, swapping at every flip",
  },
  0x1319: {
    name: "fillCellRun",
    role: "fill a fixed-length run of character cells with one byte, stepping a cell at a time along the line",
    cert: "seen",
    why: "its callers pass video-RAM starts with the blanking character and colour-RAM starts with a computed colour, so the unit it steps is the tilemap cell in both planes rather than a byte address; the stride is the one advanceCharCursor steps as one cell along a line",
  },
  0x1563: {
    name: "restoreColumnFromSavedRun",
    role: "put a saved thirty-two cell picture back onto the character plane: twenty-eight bytes down one column of cells a row apart, then four into two two-cell columns beside it. Every address is fixed here -- the run it reads, the column it lays and the two stubs are all this entry's choice, not a caller's -- and it overwrites the cells whole rather than merging into them",
    cert: "seen",
    why: "the direction is what a name has to get right, and it is fixed by two things outside the routine. First, the run it reads from, 0xA400-0xA41F, is the first row of the character plane, and MAME's driver puts the visible window at rows 2 through 29 (`set_visarea(0, 32*8-1, 2*8, 30*8-1)` over a 32x32 TILEMAP_SCAN_ROWS map) -- so the run is thirty-two cells of video RAM that are never displayed, which is a backing store and not a picture. Second, both call sites bracket their tick with the pair: advanceScriptedCharPlaneBandTo2 and advanceScriptedCharPlaneBandTo4 each call THIS entry near the top and its inverse gatherCharColumnIntoBackingRun (0x158C) near the bottom, mutating cells of the same column in between (advanceScriptedCharPlaneBandTo2 does `inc (0xa5f0)` on one of the four stubs). Read run-first-save-last, the column is the working copy and the hidden row is where it survives whatever else draws over the screen; read the other way round, the two calls would cancel and the mutation would never persist. On the glass the geometry is a line, not a column: under the rotation mechanisms.md measured -- display_x = 239 - native_y, display_y = native_x -- a fixed video-RAM column is a constant display_y, so the twenty-eight cells at column 17 spanning rows 2-29 are a full-width horizontal line at display_y 136-143, and the four stub cells at columns 16 and 18, rows 15 and 16, are sixteen-pixel segments at display_x 104-119, centred, one line above the run and one below. Its callers sit at inner steps 1, 2 and 3 of the sequence whose outer phase cell is 0xA9AB, dispatched as entry 14 of the `rst 0x30` table at ROM 0x0F29. Under MAME the round-clear captures reach it: it reads the whole hidden row 0xA400-0xA41F and writes the column cells and the four stub cells",
  },
  0x158c: {
    name: "gatherCharColumnIntoBackingRun",
    role: "gather one column of the character plane into a thirty-two byte run -- the column's twenty-eight cells a row apart, then the two two-cell columns beside it -- overwriting the run whole rather than merging into it; it is the exact inverse of restoreColumnFromSavedRun (0x1563) over the same cells in the same order",
    cert: "seen",
  },
  0x15b6: {
    name: "hideAllSprites",
    role: "zero every slot of the vertical sprite shadow band, which parks all of them above the first visible line, hiding them without retiring any",
    cert: "seen",
    why: "the slots it zeroes are exactly the ones the renderer scans, and its four-slot sibling hideCaptionSprites uses the identical idiom on the caption's slots alone -- one routine hiding a caption, this one hiding everything",
  },
  0x2b52: {
    name: "releaseHeldObject",
    role: "count a held object's release delay down and, when it expires, step its state code to the live one and re-arm the delay",
    cert: "seen",
    why: "all five callers reach it through the same state-byte ladder and tail-jump here only when that byte is exactly the held value, so the increment is invariably held-to-live and never an open-ended bump; retireSlot's entry records other routines re-arming this same cell as a cooldown",
  },
  0x2bef: {
    name: "steerTowardAimHeading",
    role: "turn an object's heading one step toward the heading it aims at, the short way round, at a rate a small table supplies for the current mode cell",
    cert: "seen",
    why: "the byte it writes is the one an object's own movement routine reads to pick a velocity -- the 0x58bc family, which carries an inlined copy of that lookup -- so this steps the heading motion follows, and the cell it steps toward is the target rather than the other way round",
  },
  0x3058: {
    name: "placeAbuttingTile",
    role: "place an object's next sprite tile flush against the current one and step both cursors onto it",
    cert: "seen",
    why: "driftThreeTileSceneryAtFiveQuarters chains two of these and driftNearestSceneryTriTile chains one plus the diagonal sibling placeDiagonallyAbuttingTile, both tail-jumping into advanceToNextSlot -- so a slot boundary here is a tile boundary, which is exactly why that routine's own entry declines to call the unit an object",
  },
  0x40b8: {
    name: "askForSoundWhileTheGroupIsClear",
    role: "ask for one sound on every thirty-second frame from the third era on, and only while none of the three records at 0xA8C0, 0xA8D0 and 0xA8E0 is live; any one of those four tests failing ends the entry having done nothing at all",
    cert: "seen",
    why: "an entry of the round engine's service list, sitting immediately before the routine that WALKS that same group of records from 0xA8C0 and carrying the identical era test, so the pair is one subsystem's motion and one subsystem's sound. A MAME read tap PC-gated at the entry took 11471 dispatches over 300 driven seconds and evaluated all four conditions at each one: 3 dispatches had all four true and the fetch of the jp that asks was counted exactly 3 times, with zero passes carrying a false condition and zero refusals carrying four true ones -- so the gate is the conjunction and not a subset of it. The counter's low five bits were spread across all 32 values at the entry (356-360 each), so the thirty-second-frame test is a real filter on a free-running cell rather than a test the dispatch time already decides. Holding the era at 4 in a second run took the passes from 3 to 16. What is NOT established is which sound: the byte it asks for is ROM[0x07FE] = 0x86, and 0x86 does appear in the small set of codes the sound latch actually receives (9 writes in the run where this entry made 3 requests), but the latch is written by the interrupt epilogue's queue drain rather than by the requester, so the counts cannot be matched one to one and something else queues 0x86 too",
  },
  0x41ec: {
    name: "endApproachNow",
    role: "make the countdown at +0x04 of the record a caller points at read zero, so that record's handler takes its expired arm on the next frame instead of counting the rest of the delay down; one store and nothing else",
    cert: "seen",
    why: "the single store is coherent only through its caller, which re-aims the record at a point every sixteenth frame and calls here only when BOTH axis distances to that point are under 16 -- so the trigger is arrival, not a timer. The only path in requires era 4 (`cp 0x04 / jp z,0x4194` on the era cell). Under MAME with the era held at 4, every dispatch had IX = 0xA8C0, the record's ordinal at +0x0F = 0x0C, both distances at entry (A and D) under 16, and a NON-ZERO countdown (0x01, 0x07, 0x21), so the store cuts a live delay short rather than restating a zero. What the countdown gates is decided by 0x4194, which reads it",
  },
  0x43e8: {
    name: "sumImageBlockForTheTamperCheck",
    role: "add a run of program-image bytes into one eight-bit total and pass it down the tail chain that compares it with the value a genuine image gives, leaving on the ordinary path or into the trap; a length of zero means 256 bytes, and the total wraps",
    cert: "seen",
    why: "the chain is three tail jumps -- this entry, parkTheImageTotalForTheTamperVerdict, then 0x5303, which calls 0x200C (ending ld a,b, handing the total back) and does cp 0x67 / jp nz,0x0F8D; 0x0F8D is a two-byte data table jumped to as code, which is the tamper trap. The one caller fixes HL = 0x086B and B = 0x14 as its last act, and those twenty image bytes sum to exactly 0x67, so a genuine image passes by construction. Under MAME every dispatch had HL = 0x086B and B = 0x14, the recomputed total was 0x67, the clean arm at 0x530B was fetched and 0x0F8D never was. The routine itself is generic in HL and B",
  },
  0x46ba: {
    name: "setMotherShipVelocityFromHeading",
    role: "give the Mother-Ship the two velocity words its current heading picks out of the velocity table the era selects -- the word at the heading and the word a quarter turn behind it -- and park them at +0x0C and +0x1C of the record pair, which is where its motion reads them",
    cert: "seen",
    why: "the era chooses a table and nothing else: each of the five arms in the word table at 0x46C4 is a bare ld hl,<table> into the shared 0x596E, which does the whole lookup -- DE = table[(IX+0x02)], BC = table[(IX+0x02) - 0x40]. The arms name 0x59D7, 0x5E00, 0x5E00, 0x2E3E, 0x08FA for eras 0 to 4, rungs of the ladder of scaled copies of one waveform (peaks 206, 256, 306, 331), so what an era buys is a SPEED: one used rung below the player at eras 0-3 and level with it at era 4. Under MAME, holding the kill quota at zero and walking the era, every dispatch had IX = 0xA8A0, the arm followed the era, and every byte the block at 0x46CE stored matched the value recomputed from ROM (era-indexed arm, then that arm's table at the record's heading byte). The mask admits eight indices where the table defines five; indices 5-7 would read the start of the block at 0x46CE as an arm address, unreachable while the era cell stays 0-4",
  },
  0x4809: {
    name: "showParachutistAward",
    role: "start the parachutist slot's exit: put its state byte at the top of the dying countdown, ask for the sound that goes with collecting it, and swap its sprite tile to the glyph for the award the slot's own rung byte selects -- with one fixed glyph once the rung passes the four the table holds, so the lookup never reads on past the table",
    cert: "seen",
    why: "the rung byte is (IX+0x07) with IX = 0xA8F0 from the only caller, i.e. PARACHUTIST_RUNG (0xA8F7), the rescue awards already paid this life. ROM 0x482D holds f9 fc 8d 8e and the out-of-range arm writes a single 0x8F, so the first four rungs each select their own glyph and every later rung the same one. Under MAME, with IX = 0xA8F0 and IY = 0xAA2E, the rung read at entry went 0x00 then 0x01 and the glyph written to (IY+0x01) was 0xF9 then 0xFC, matching ROM[0x482D + rung] each time; the rung is read before it steps, so a life's first award pays the bottom rung. The other stores are constants: 0x3B into the state byte (the top of the 0x01-0x3B dying-countdown band) and 0x6C into (IY+0x30). The sound is ROM[0x079B] = 0x16, asked for through the play-gated shim at 0x57FF; which sound that is is not established",
  },
  0x4bd9: {
    name: "trampolineToSelectFoldBlock",
    role: "a bare transfer to 0x08AE and no return; no cell is read or written and no register moves",
    cert: "seen",
  },
  0x4dcf: {
    name: "paintGlyphOverBlankInColourThenStepCursor",
    role: "write the caller's glyph into the character cell the cursor names and the blank glyph into the cell one address below, lay the caller's colour beside both in the colour plane, and step the cursor one cell along the line -- one column of the pair stampTwoByTwoTileBlock writes. Its one call site, the loop at 0x4D9A in drawEmblemStripThenGuardImage (ring command 5), clears the row's tail from 0xA783 down to 0xA623 passing 0xF1 as the glyph, so there both cells come out blank. The return to the character plane SETS the plane bit rather than restoring it, so a cursor that arrived on the colour side would end on the glyph side",
    cert: "seen",
  },
  0x4dde: {
    name: "awardBonusLifeAtScoreMark",
    role: "award an extra life when the active player's score reaches a bonus mark, once per mark. Only while PLAY_ACTIVE is set; bit 0 of the settings byte at 0xA9C3 picks the mark table at ROM 0x4E1B or 0x4E30, and cpir looks for an EXACT match on the top byte of the active player's packed-decimal score (0xAD35 or 0xAD38 by ACTIVE_PLAYER). Bit 0 of 0xAD03 makes it one-shot: a match with the bit already set does nothing, and the first non-matching call clears it. A fresh match sets the bit, increments LIVES_REMAINING, posts ring command 5 with the count from before the increment, and tail-jumps into requestBonusLifeSound. Called once per pass of serviceRoundThenResolvePlayerState",
    cert: "seen",
  },
  0x51de: {
    name: "postChainedHitScore",
    role: "post a scoring command to the ring, stepping the award up while consecutive hits keep landing inside the chain window and wrapping back round after the eighth",
    cert: "seen",
    why: "expireHitChain, an entry in the round engine's service block, ticks the chain window down and clears the step cell when it expires -- without that outside reset the argument would not restart, so the chaining is fixed by a routine other than this one; and it posts through postCommand, which drops the pair on a full ring, so it posts rather than awards",
  },
  0x565f: {
    name: "requestEnemyLaunchSound",
    role: "read the byte at 0x07A2 and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5664: {
    name: "requestAttackerSpawnSoundEra0",
    role: "read the byte at 0x16DE and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5669: {
    name: "requestEnemyLaunchSoundLateEra",
    role: "read the byte at 0x4C9F and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5674: {
    name: "requestAttackerSpawnSoundLateEra",
    role: "read the byte at 0x276B and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5679: {
    name: "requestLateEraProgressSound",
    role: "read the byte at 0x07FE and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x567e: {
    name: "requestPlayerShotSound",
    role: "read the byte at 0x3270 and request it as a sound code, admitted while a game is being played or the cell at 0xA9C6 is set",
    cert: "seen",
  },
  0x568e: {
    name: "requestObjectState3bSound",
    role: "read the byte at 0x2D87 and request it as a sound code, only while a game is being played",
    cert: "seen",
    why: "named for the data cell it requests, OBJECT_STATE_3B_SOUND 0x2D87 [seen], and in the family shape of the requestXSound siblings: its one caller is stampObjectStateByte3bThenRequestSound, which stamps an object's state byte to 0x3B and then asks for this sound. The state, not 'death', is the name because the stamp's callers include non-combat objects (the cell's own recorded reasoning). Two blind derivations converged on this name",
  },
  0x56e4: {
    name: "requestInterRoundSoundPair",
    role: "read the byte at 0x27CB and request it as a sound code, then the byte at 0x33A0; both go through the door at 0x5617, which admits them while a game is being played or while the cell at 0xA9C6 is set. Reached as a call from advanceScriptedCharPlaneBandTo4 and by falling out of the bottom of requestRoundIntroSoundBurst; the same shape as requestTwoSounds at 0x5683 with a different pair of program bytes",
    cert: "seen",
  },
  0x57f1: {
    name: "requestCoinSound",
    role: "read the byte at 0x322E and request it as a sound code, with no permission test",
    cert: "seen",
  },
  0x57f7: {
    name: "requestCurrentEraSound",
    role: "request the sound code that the era index selects out of a run beginning twelve codes up, only while a game is being played; the sum is not clamped",
    cert: "seen",
  },
  0x57ff: {
    name: "requestParachutistAwardSound",
    role: "read the byte at 0x079B and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5805: {
    name: "requestBonusLifeSound",
    role: "read the byte at 0x2D4E and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x580b: {
    name: "requestMotherShipWarpSound",
    role: "read the byte at 0x49EE and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5811: {
    name: "requestPlayerSpawnFlashSound",
    role: "read the byte at 0x07A9 and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5817: {
    name: "requestEnemyWaveSound",
    role: "read the byte at 0x273A and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x5834: {
    name: "requestRoundStartSound",
    role: "read the byte at 0x1767 and request it as a sound code, only while a game is being played",
    cert: "seen",
  },
  0x583a: {
    name: "requestHighScoreFiledSound",
    role: "read the byte at 0x18FA and request it as a sound code, only while a game is being played",
    cert: "seen",
    why: "named by its trigger, like requestRoundStartSound and requestBonusLifeSound: its only caller, fileScoreAfterGameOverHoldElsePassTurn, calls it only on the path where fileScoreIntoHighScoreTable DID file the finished score, just before the pen is blanked and initials entry begins; the path that files nothing never reaches it. The name claims the request only -- whether the in-game permission is still open at that moment is not MAME-checked. Two blind derivations converged on the reading (filed-path sound); one worded it HighScoreEntry, this wording is the more exact of the two",
  },
  0x5840: {
    name: "flyAtSlowestSpeed",
    role: "fly one object a single step at the slowest of the velocity-table speeds, choosing that table for the flier and deciding nothing else; reached as a call from two per-slot actor handlers and as a tail jump from a third",
    cert: "seen",
    why: "every entry into flyAlongHeading is a two-instruction shim fixing one velocity table, and the tables are one waveform scaled by its own peak (to within two units of the last place, with identical off-symmetry headings), so magnitude is the only thing a shim chooses -- which makes a speed the right thing to name it for. The ladder's order is fixed outside the flier: the routine that arms the player climbs the same tables as the era rises, and an enemy shim selects the table that routine reaches at the top, matching gameplay.md's fourth-era jets 'as fast and manoeuvrable as you'. This entry's table, 0x59D7, sits below the slowest the player is ever given. Under MAME every dispatch here was predicted by that table alone while a sibling shim ran a faster one on the SAME slot array, so an entry selects a speed and not an object class. 'Slowest' is a rank over the ROM tables: two rungs are selected only by shims whose addresses appear nowhere in the image",
  },
  0x5860: {
    name: "flyAtSecondFastestSpeed",
    role: "fly one object a single step at the pace of the velocity samples at 0x2E3E, choosing that table and deciding nothing else; a pointer the caller held is discarded. Its one reader, steerEnemyTowardShip (the era-4 arm of the handler table at 0x2914), alternates on bit 1 of the frame tick between this entry and 0x58AA, the shim that gives the double-velocity mover the ladder's bottom table, so the object does not stay on one rung",
    cert: "seen",
    why: "named by rank like its siblings flyAtSlowestSpeed and flyAtFastestSpeed: its table, 0x2E3E (peak 306), is second-fastest however the ladder is counted -- over the live flyAlongHeading shims (206/256/306/331), over the six ROM rungs (206/231/256/281/306/331; the 231 and 281 shims at 0x5846/0x585A are never entered, no absolute word or relative branch reaches them) -- so the rank does not depend on which tables are counted. Bytes 21 3E 2E C3 BC 58; its one entry is the jp at 0x2A19 in steerEnemyTowardShip, which alternates it with loc_58aa on bit 1 of the frame tick. 'SecondFastest' is a rank over tables, the same caveat flyAtFastestSpeed records: loc_58aa's doubled 206 moves farther per step. Converged with a third, independent derivation; the two first-pass derivers had offered an era-pace wording at low confidence",
  },
  0x5942: {
    name: "loc_5942",
    role: "hand back the perpendicular component pair for an object's heading from the velocity samples at 0x59D7, the ladder's bottom rung; choosing that table is all it does, an incoming pointer is discarded, and nothing is written. Two readers: armBomberSlotWhenTimerFires stores the pair straight into the slot it arms, and it is the era-0 word of the arm table at 0x46C4 that setMotherShipVelocityFromHeading dispatches",
    cert: "seen",
  },
  0x596b: {
    name: "loc_596b",
    role: "hand back the perpendicular component pair an object's heading calls for, at the pace the velocity samples based at 0x08FA set; choosing that table is all this entry does, an incoming pointer is discarded, and the pair is the whole product -- no memory is written",
    cert: "seen",
  },
  0x596e: {
    name: "velocityForHeading",
    role: "look up the velocity vector for a heading: two perpendicular components a quarter turn apart, read from the table the caller supplies",
    cert: "seen",
    why: "negateVelocityIntoWorldScrollThenDressSprite negates the pair this returns into the very cells driftWithWorldScroll adds to every world-static object -- negated player velocity applied to everything else is the camera, which gameplay.md records independently; the selectable tables hold a near-constant magnitude around the heading circle, not an exact one, with anomalous words widening the spread",
  },
  0x0bff: {
    name: "drawTextRun",
    role: "paint one caption into the character plane and give every cell of it one colour, taking glyphs in order from a run that ends at a fixed terminating code",
    cert: "seen",
    why: "the runs its callers select decode, through the board's own tile layout, into the English captions the public record independently names -- and two of them spell the exact bonus settings MAME reads off DSW1 -- so the bytes it copies are glyph codes and not a display list. NOT text in every case: two records instead select second-bank tiles with three pen levels, a shaded banner strip where a byte is a piece of a letter, which this name does not cover",
  },
  0x0f7b: {
    name: "loadDifficultyRecord",
    role: "copy the four-byte record an index selects out of a fixed table and into the four cells that hold the difficulty settings in force; scaling the index by the record width is done as a BYTE, so an index of sixty-four or more selects a record a wider multiply would not",
    cert: "seen",
    why: "'difficulty' is the claim. The index it is normally handed is a three-bit cell the boot-time DIP unpack fills, and the table has exactly eight records; MAME's port definition names that DIP field Difficulty, eight positions from 1 (Easiest) to 8 (Difficult). Under MAME, driving the field through all eight positions and reading the DERIVED cells back, the index took 0 to 7 in the labels' order and the four destination cells took the eight distinct ROM rows in the same order. Three bytes are the escalation rung a round starts on, bracketed by rounds completed at 6 and 11 by startNextRound; the first reached ERA_RUNG rising 0,0,0,2,4,7,11,15. The fourth lands in ERA_RUNG_PERIOD and falls 13,12,11,10,9,7,5,5: harder setting, higher start and faster climb. Negative control: with no credit taken all eight positions gave the same record, because the attract path reaches this entry through the call site that passes a literal instead of the DIP cell",
  },
  0x1098: {
    name: "multiplexSpriteSlots",
    role: "wait until the raster has passed each of eight scenery slots, then move that slot half a screen in both axes so the same sprite shows twice in one frame; a slot whose request bit is clear is left alone",
    cert: "seen",
    why: "the slots it edits are exactly those the sprite DMA fills from the shadow block the era-keyed parallax dispatcher writes, and the partner it moves is that slot's X byte while the request it clears is its Y byte -- so the two writes are one object repositioned, not two objects. A near-twin performs the same edit on the same slots but SKIPS a slot whose beam has not arrived instead of spinning for it, and that contrast is what identifies the wait as this routine's purpose",
  },
  0x1a9a: {
    name: "applyEraRungSettings",
    role: "apply the tuning row that the era and its escalation rung together select, scattering the row's ten bytes over twelve cells -- two spawner caps, two aim windows, two cooldown periods and their live countdowns, and two thresholds",
    cert: "seen",
    why: "'settings' is the claim, and a wave-composition table would have refuted it. Under MAME while the rung climbed, every destination took a monotone ladder -- one cooldown period stepping 0x32, 0x28, 0x1E, one threshold 0x50 through 0xA0, one cap 0, 1, 2 -- and two destinations are live countdowns another routine runs: the vblank service decrements 0xA817 and 0xA8F4, and six sites reload them from 0xA814 and 0xA8F6, which this routine writes in the same breath; unrelated constants could not form a period-and-countdown pair. ★ It is reached by FALL-THROUGH from the life-start routine at 0x19F0 as well as by the tail jump from the escalation timer, so round start applies the row too. The name does NOT say every setting is about attack: two of the twelve are read by paths not tied to attacking",
  },
  0x1ae4: {
    name: "freeAndNumberEveryObjectSlot",
    role: "lay out the object array's twenty-three records, sixteen bytes apart from a fixed start: clear each record's occupancy byte and stamp its sixteenth byte with that record's position in the run, counting from one. Nothing is read, so the run comes out the same however it went in",
    cert: "seen",
    why: "the stamped byte is an IDENTITY other code selects by: countTheKillAndGrantTheSharedToken writes a record's own stamp, plus a top bit, into one shared cell when a timer expires, and 0x2C31 retires an object outright unless that cell's low seven bits match its own stamp -- a writer and reader that would be incoherent if the byte were a countdown or a type code. The run is the whole array: 0xA810 through 0xA970 at a stride of sixteen is the actor band plus the scenery band, every slot but the player's. Under MAME the twenty-three stamped bytes read 1 through 23 and every occupancy byte zero on each dispatch; its one caller is the life-start routine, so it runs once per life, not once a frame",
  },
  0x1ed1: {
    name: "readPlayerControls",
    role: "hand back the control word of whichever cabinet panel currently faces the picture",
    cert: "seen",
    why: "the flag it selects on is the byte the vblank service latches into the LS259 bit MAME reports as flip-screen, and the two cells it chooses between are the frame mirrors of the driver's mono panel and its cocktail twin -- so which panel faces the picture is fixed by hardware outside this routine. Its callers then split the returned word three different ways (the stick nibble, the fire bit edge-detected into a burst, and, in initials entry, individual bits each shifted into their own one-bit edge history), which is what makes the whole word the product rather than any one field",
  },
  0x2a3c: {
    name: "refreshSpriteFromHeading",
    role: "store the shape byte and the attribute byte that show an object pointing the way it is heading into that object's own sprite entry",
    cert: "seen",
    why: "spriteForHeading returns the pair and this is one of the two sites that consume it; the two bytes land at +0x01 and +0x30 of the same sprite entry whose +0x00 and +0x31 the parallax and flight helpers write as coordinates, so what is stored is a sprite rather than a state code. Under MAME it runs in driven play and never in an undriven run, so what it dresses is not on screen in attract",
  },
  0x2a47: {
    name: "refreshSecondEraSpriteFromHeading",
    role: "show one of the second era's enemy craft pointing the way it is heading: the shared heading lookup picks a shape and the byte beside it, and each is stored into the object's own sprite entry shifted by a fixed bias -- sixteen on the shape, fifty-three on the attribute -- so this era's craft is drawn from its own block of the sprite ROM in its own colour. The attribute's two flip bits survive the addition because every entry of the lookup's attribute table carries the same low colour field, so the bias moves the colour and leaves the facing alone",
    cert: "seen",
    why: "the claim is that the bias is ERA-keyed. The arm that reaches it is chosen by `ld a,(0xad04); and 0x07; rst 0x30` on the table at ROM 0x2914 (entries 0x2927, 0x294c, 0x2984, 0x29b0, 0x29d5), so dispatch is by era index alone. Under MAME with a PC-filtered read tap keyed on the era cell, an attract run visiting the second, third and fourth eras dispatched this entry only at era 1 while the third- and fourth-era arms ran and contributed none, and a driven game held in the first era never dispatched it and dispatched refreshSpriteFromHeading instead -- complementary zeros both ways. It dresses the seven ordinary enemy-craft records 0xA850-0xA8B0 into sprite entries 0xAA1A-0xAA26, as mechanisms.md's record-to-entry formula predicts. Its one caller returns immediately after it",
  },
  0x2a57: {
    name: "spriteForHeading",
    role: "pick the sprite shape, and the byte beside it, that show an object pointing the way it is heading, alternating between two shape banks as a frame counter's bit turns over",
    cert: "seen",
    why: "its callers store the two returned bytes into a sprite entry's tile-code and control slots and nothing else, so the pair is a sprite and not a state code; the attribute table's colour field is identical in every entry while only its two flip bits vary, so that byte is a flip attribute rather than a per-sector palette pick, and it is the MIRRORING those bits give that lets a handful of shapes cover the whole circle. Two object classes use it, so it is not the player's",
  },
  0x2e31: {
    name: "displaceByFiveQuarters",
    role: "move a coordinate by a displacement and a further quarter of it, so what it carries leads what moves by the whole of it; the quarter rounds down rather than toward zero",
    cert: "seen",
    why: "the sole caller of each is a byte-identical wrapper differing from the other two only in which of these it calls, and from driftWithWorldScroll only in applying a fraction -- so the fraction is the whole of what distinguishes them, while the scroll cells, the object and every memory write belong to the caller. These three read no scroll cell, touch no object and write no memory. A prediction that could have failed and did not: if each fraction has exactly one wrapper, the dispatch ratio across the era-0 handler list must be one to two to one, and it is measured at one to two to one on both attract and driven runs",
  },
  0x303e: {
    name: "displaceByThreeQuarters",
    role: "move a coordinate by three quarters of a displacement, so what it carries trails what moves by the whole of it",
    cert: "seen",
    why: "the sole caller of each is a byte-identical wrapper differing from the other two only in which of these it calls, and from driftWithWorldScroll only in applying a fraction -- so the fraction is the whole of what distinguishes them, while the scroll cells, the object and every memory write belong to the caller. These three read no scroll cell, touch no object and write no memory. A prediction that could have failed and did not: if each fraction has exactly one wrapper, the dispatch ratio across the era-0 handler list must be one to two to one, and it is measured at one to two to one on both attract and driven runs",
  },
  0x304d: {
    name: "displaceByHalf",
    role: "move a coordinate by half a displacement, so what it carries keeps half the pace of what moves by the whole of it",
    cert: "seen",
    why: "the sole caller of each is a byte-identical wrapper differing from the other two only in which of these it calls, and from driftWithWorldScroll only in applying a fraction -- so the fraction is the whole of what distinguishes them, while the scroll cells, the object and every memory write belong to the caller. These three read no scroll cell, touch no object and write no memory. A prediction that could have failed and did not: if each fraction has exactly one wrapper, the dispatch ratio across the era-0 handler list must be one to two to one, and it is measured at one to two to one on both attract and driven runs",
  },
  0x5205: {
    name: "expireHitChain",
    role: "run the chained-hit window down by one and, on every frame after it has reached zero, clear the chain step so the next hit starts the award ladder from the bottom again",
    cert: "seen",
    why: "that this routine alone ends a chain is the claim: under MAME a write tap across a driven run attributed every write of the window cell and the step cell to this routine and the poster it serves, and the poster has no path that resets the step itself, so without this the award ladder would never restart. Its two arms are exclusive and exhaustive: tick count plus clear count equalled the dispatch count exactly. 'Expire' rather than 'tick' because the clear is not edge-triggered -- it fires on every idle frame, not only the frame the window empties",
  },
  0x5211: {
    name: "destroyTargetsHitByShots",
    role: "destroy every target a live shot has reached, spending the shot with them, and post the score for each; the sweep does not stop at the first, so one shot can take several in a pass",
    cert: "seen",
    why: "every caller fixes the outer array at the six-slot table fireAndSweepPlayerShots owns and arms only on a fire-button rising edge, and varies only the inner list -- so the sweep runs shots against targets and not the reverse. The state code it writes is the one stepDyingObjectState converts into a death countdown before retiring the slot, so destroy is the object's fate rather than this routine's bookkeeping. Kills also arrive through another routine's inline collision. That one shot can take several targets in a pass is read off the code rather than separately observed",
  },
  0x58a4: {
    name: "flyAtFastestSpeed",
    role: "fly one object a single step at the pace of the velocity samples at 0x08FA, choosing that table and deciding nothing else; a pointer the caller held is discarded",
    cert: "seen",
    why: "the mirror of flyAtSlowestSpeed (0x5840), whose recorded reasoning names a flyAlongHeading shim by the speed its table sets: this shim fixes VELOCITY_TABLE_08FA, peak 331, the top rung of the six-rung ROM ladder 206/231/256/281/306/331 (the 231 and 281 rungs' flyAlongHeading shims at 0x5846 and 0x585A are never entered -- a whole-image word scan finds neither address). 'Fastest' is a rank over the tables, the same caveat flyAtSlowestSpeed records -- a double-velocity mover on the 206 table moves farther per step. Its one caller is serviceEra3EnemyCraftSlot, matching gameplay.md's fourth-era jets 'as fast ... as you'. Two blind derivations converged",
  },
  0x58bc: {
    name: "flyAlongHeading",
    role: "fly one object a single step along the heading it holds, and in the same add carry it with the world: each coordinate gains its own velocity component PLUS the shared per-frame scroll pair, so nothing else may drift this object",
    cert: "seen",
    why: "the pair it adds to every coordinate is the same pair driftWithWorldScroll applies to world-static objects, so this is that camera application and the object's own velocity folded into one add -- which is why none of its callers drifts the object separately, and why reading the name as velocity-only and adding a drift beside it would apply the camera twice. Its first half is byte-identical to velocityForHeading",
  },
  0x0b39: {
    name: "flashCopyrightLine",
    role: "make the copyright line change colour every frame: ask for the same glyph run at the same place in one of two colours, choosing between them on the low bit of the frame counter, which it only reads. The request goes on the command ring and is dropped when the slot the write cursor names has not been consumed, so a frame can silently miss its turn",
    cert: "seen",
    why: "the two arguments are 0x00 and 0x1F, and both records they select in the caption table at 0x0C50 give destination 0xA6BC and the SAME thirteen glyph codes (a copyright mark, KONAMI, 1982), differing in one byte, the colour, 0x10 against 0x05 -- so only the colour can alternate. Under MAME a write tap on the line's first colour cell 0xA2BC saw the shared caption painter's store at 0x0C07 alternate 0x05 and 0x10 frame by frame, while the glyph cell 0xA6BC took only the copyright mark 0x30: colour moves, shape does not. Entry taps put this address and 0x0B46 on alternate frames, this routine's own arm producing the 0x10 write and 0x0B46 the 0x05 one. Command 1 is the caption drawer that takes the record's OWN colour byte (table 0x0BBC slot 1 -> 0x0BF2). 0x0B46 is reached from nowhere else in the image, so the pair is one act",
  },
  0x0b46: {
    name: "enqueueFixedCommandOnRing",
    role: "queue one fixed command, with its one fixed argument, in the command ring -- both bytes are chosen here and whatever the caller held is discarded; the pair is dropped when the slot the write cursor names has not been consumed, and this entry never learns that",
    cert: "seen",
  },
  0x0b93: {
    name: "runCommandRingDrainLoop",
    role: "the foreground loop: take commands off the ring one at a time and run each, for ever. A read cursor names a cell; while its high bit is set the cell is empty and the loop polls again -- the ring is refilled from outside the loop, so this is where the foreground waits for the frame. An occupied cell gives up a command byte and an argument byte, both freed BEFORE the command runs so a command may reuse the pair it arrived in, and the command's low nibble indexes a sixteen-way table. Where the handler lands is the exit test: it is handed one fixed place to come back to, and anything else means it has taken the machine somewhere this loop no longer owns",
    cert: "seen",
  },
  0x0c0f: {
    name: "drawCaptionInPenColour",
    role: "paint the caption a caller's index selects, taking the glyph run from a record in the table at 0x0C50 and colouring every cell from the low nibble of the shared colour cell instead of from the record's own colour byte",
    cert: "seen",
    why: "which byte the colour comes from is the only thing separating this entry from its siblings, and a sibling settles it the other way: loc_0bf2 walks the same table and the same record layout and loads the colour FROM the record's third byte -- the byte this routine steps over -- so that byte is the record's own colour and skipping it is the whole of what this entry contributes; loc_0c23 is the same skip with a fixed offset added. mechanisms.md reaches the same split from a colour-cell write tap, recording that four handlers draw from one record table, one taking the record's colour and the others deriving it from a single cell",
  },
  0x0c23: {
    name: "drawCaptionTenPastSharedColour",
    role: "paint the caption an index selects from the shared record table, taking the destination and the glyph run from the record but the colour from a cell outside it, ten past that cell's value and kept to four bits",
    cert: "seen",
    why: "the discriminating claim is the OFFSET: the handler table at 0x0BBC sends three entries to routines that read the SAME cell and add 0, 5 and 10 before the same four-bit mask, all ending in drawTextRun, while a fourth takes the record's own colour. The name does not say the colour cycles, because that was refuted: under MAME, in attract and in a driven game, this handler painted caption 27 only at source value 2 and caption 28 only at source value 3 -- its own colour never moved. The flashing comes from the three handlers taking turns at one caption",
  },
  0x0c39: {
    name: "eraseTextRunByIndex",
    role: "erase the caption an index selects: the index picks the same record drawTextRunByIndex uses, and every cell the record's glyph run covers is overwritten with the blank code, leaving the colour plane exactly as it was",
    cert: "seen",
    why: "the discriminating claim is erase-not-repaint, and one cell settles it: under MAME the video-RAM cell 0xA4E0 took the blank code from THIS routine's store in a driven game, and a glyph from drawTextRun's store in attract -- one cell, one painter, one eraser -- and no colour-plane write was ever attributed to it. The ring's handler table at 0x0BBC seats drawTextRunByIndex at slot 1 and this at slot 3, and its one direct caller uses it where the second player's label must be absent while the two-player arm draws that same caption, so it is the draw handler's inverse. Its store fires about a dozen times per dispatch: a caption's length, not a screen's and not one cell",
  },
  0x181d: {
    name: "noOpSequencePhase2Tail",
    role: "an arrival point with nothing to do: no cell is read or written and no register moves",
    cert: "seen",
  },
  0x3ce1: {
    name: "hasReachedHorizontalEdgeWindow",
    role: "answer whether the byte at the head of a sprite entry has reached its wrap point, testing a four-wide window that straddles zero -- so it measures a wrapped distance rather than bounding a range, which is what lets a byte stepping several units at a time land inside the window instead of over it",
    cert: "seen",
  },
  0x5854: {
    name: "loc_5854",
    role: "fly one object a single step at the pace the velocity samples based at 0x5E00 set, choosing that table and deciding nothing else",
    cert: "seen",
  },
  0x594e: {
    name: "loc_594e",
    role: "hand back the perpendicular component pair an object's heading calls for, at the pace the velocity samples based at 0x5E00 set; choosing that table is all this entry does",
    cert: "seen",
  },
  0x5965: {
    name: "loc_5965",
    role: "hand back the perpendicular component pair an object's heading calls for, at the pace the velocity samples based at 0x2E3E set; choosing that table is all this entry does",
    cert: "seen",
  },
  0x01b5: {
    name: "armLineWipeFromFifthLine",
    role: "arm the character-plane wipe to start at the plane's fifth cell and to run for a count taken from a fixed cell of the program image rather than carried as an immediate; neither armed cell is read here, and nothing a caller held survives into either",
    cert: "seen",
    why: "the name claims a PARTIAL wipe, a definite start and length, and both are countable through blankNextLine, which blanks one line per dispatch while its callers return early as long as the count survives. Under MAME the boot arm (armWholePlaneWipeThenDerailOnATamperedImage: cursor at the plane's first cell, immediate 32) is followed by exactly 32 dispatches of blankNextLine and each dispatch of this entry by exactly 27, and the two cells read back in the frame it ran held the fifth cell and 27. It fires on the credit and game-over transitions and never in undriven attract",
  },
  0x01c2: {
    name: "blankNextLine",
    role: "blank one line of the character plane in both planes, step the wipe's cursor on to the next line, and count the lines still owed down by one; the zero test is left in the flags for the caller",
    cert: "seen",
    why: "the name claims a line at a time, not a screen and not a cell, and that is countable from outside: a read tap at this entry on the real ROM under MAME counted exactly 32 dispatches through the boot wipe, in two independent runs. A whole-screen wipe would have been one, a cell at a time 1024, and 32 is the tilemap's line count. Both callers then `ret nz` on the flag it leaves, which is what makes the wipe span frames rather than run to completion inside one call -- so a name saying merely 'blank' would drop the half the callers use",
  },
  0x026f: {
    name: "plotPenCell",
    role: "stamp the current pen glyph and pen colour into the one character cell a row cell and a column cell name, and hand back the video-plane address of that cell",
    cert: "seen",
    why: "the name predicts an exact address: under MAME a write tap recomputed 0xA400 + row*32 + column the way the ROM does -- eight-bit row multiply, column added to the low byte with the carry discarded -- and every write the routine made landed on that cell or its colour twin, where a reading that kept the carry would miss at every row wrap. drawInterpolatedPenRun uses the returned address as a product: it subtracts a target cell from it to decide whether to keep stepping",
  },
  0x0365: {
    name: "publishSpriteShadow",
    role: "gather the sprite shadow into the two hardware banks, three runs per bank in an order that is not their order in memory, transforming each byte by which half of its sprite it is and which way round the cabinet has the picture; then, inside one window of the sequence, ask for the eight scenery slots to be shown a second time half a screen away",
    cert: "seen",
    why: "the transform table says which byte is which coordinate: the second byte of each bank-1 sprite is complemented past fourteen when upright and merely incremented when turned round, and 241-(b+1) = 240-b, so that byte is vertical under the driver's sy = 241 - value; likewise the first byte of a bank-0 sprite is horizontal, the second the tile code, and the first byte of a bank-1 sprite the attribute, since the turned-round arm toggles exactly its two flip bits. Under MAME both banks matched that reconstruction on all 48 bytes on every quiet frame upright, and with the Cabinet dip at cocktail on player two's turn every bank-0 byte matched the TURNED-ROUND reconstruction; this entry's dispatch count equalled the NMI count, as a sole caller in the vblank service predicts. The eight sprites it raises are the whole scenery band, three promoted to the front and five sent to the back, offset half a screen on both axes on the slots multiplexSpriteSlots walks",
  },
  0x07d2: {
    name: "blankFourteenCharCells",
    role: "blank a fixed run of fourteen character cells, walking back one native row at a time from a fixed cell, and give every one of them the same colour",
    cert: "seen",
    why: "the extent of the run is the claim: under MAME a write tap gated to this routine's program counters found exactly 0xA79F - 0x20k for k = 0..13, each written only with the blanking glyph, and no other video address. The name does not say where that is on screen: the run holds a native COLUMN and varies the native row, which under this board's ROT90 is a display ROW",
  },
  0x0809: {
    name: "drawKillMeter",
    role: "repaint the meter that shows how many kills are still owed: a bar of era-selected glyphs one cell long per four kills, an end glyph carrying the remainder, and one blanking cell past it",
    cert: "seen",
    why: "the name says these cells ARE the bar the player sees, which a pixel A/B can refute. Three MAME runs identical in every input but the count forced into KILLS_REMAINING for the three frames before a snapshot: two runs forcing the same value produced byte-identical images, and two counts four apart differed in 33 pixels confined to one 8x8 character cell at the bottom of the glass. Reading the video-RAM strip back for seven forced counts also matched, at every one of the seven, the bar length and end glyph the era's own ROM row predicts",
  },
  0x17b9: {
    name: "guardBlockOrBlankDisplay",
    role: "fold a block of the program image and let the sequence step on only if it still adds up; otherwise switch the display off and copy one character cell into TAMPER_WITNESS",
    cert: "seen",
    why: "two things outside the routine could have refuted it and did not. The block it folds is 51 bytes from 0x0B06, which is the entry of stampCopyrightStrip -- the guard covers a routine, not an arbitrary span -- and the fold over the real image comes to exactly the value compared, while shifting the seed by one takes the other arm. Its address also sits in the word table at 0x1659 that dispatchSequencePhase1SubStepArm dispatches, at the eighth entry, so the sequence really is what it gates",
  },
  0x308a: {
    name: "placeDiagonallyAbuttingTile",
    role: "carry an object diagonally onto one more sprite entry, cornering off the one it already occupies: a pitch back along the high axis and a pitch on along the low one, in one 16-bit add so the low axis's wrap borrows",
    cert: "seen",
    why: "the write-set confirms it is placeAbuttingTile's diagonal sibling: the step is -16 on the entry's +49 byte and +16 on its +0 byte. driftNearestSceneryTriTile chains placeAbuttingTile then this one, laying three tiles on three corners of a square -- the fourth corner is never written; driftThreeTileSceneryAtFiveQuarters chains two straight ones and lays a strip",
  },
  0x3dfb: {
    name: "retireSlotIntoSharedCooldown",
    role: "retire a slot the way retireSlot does and then arm its delay byte from one shared address instead of leaving it clear, so every slot retired here goes out holding the same value",
    cert: "seen",
    why: "'cooldown' is retireSlotIntoCooldown's claim about the same record byte; this routine re-arms that byte after calling retireSlot. 'Shared' is what it adds, and the source could have been an immediate: it is one address read by six sites, and under MAME its value moves -- 0x1E through the attract demo, then 0x42, 0x48 and 0x4E across a driven game -- restamped by the routine that loads a per-era table block",
  },
  0x3e05: {
    name: "flyAlongStoredVelocity",
    role: "fly one object a single step along the velocity held in its own record, and in the same add carry it with the world; each coordinate gains its stored word plus the shared per-frame scroll",
    cert: "seen",
    why: "the four bytes it reads at +0x0A..+0x0D are written by other routines and never by this one: spawnAimedEnemyIntoEraBankWhenInWindow and launchBankEnemyWhenAimedNearPlayer each call a doubled-velocity shim and store the returned pair straight into exactly those four. So 'stored velocity' names a value some other routine banked, which is a claim their write-sets could have refuted. Its sibling flyAlongHeading looks the velocity up from the heading instead, and both add the same world-scroll pair -- so nothing else may drift an object this moves",
  },
  0x3e7e: {
    name: "animateFixedShapeCycle",
    role: "give a sprite entry the next frame of an eight-frame cycle from a fixed shape base, and one fixed control byte beside it; nothing of the object is read, so two entries written in one tick get the same shape",
    cert: "seen",
    why: "the name claims a cycle that is fixed and not the object's. Its one caller reaches it as `call z` after comparing ERA_INDEX with 4, and under MAME read taps at this entry saw no dispatch in runs that stayed in eras 0-3 and a steady stream in one holding era 4. Nothing of the object is read, so two entries written in one tick cannot be told apart, which a name tied to an object class could not survive",
  },
  0x50ee: {
    name: "destroyPlayerAndMotherShipOnContact",
    role: "destroy the player and the Mother-Ship together when they touch, zero the Mother-Ship's remaining-hit count at +0x04 so the contact destroys it outright instead of costing it one hit, and tail-transfer to the chained hit score; this is the wider of two first-axis windows, the arm its caller ramTestPlayerVsMotherShip selects at eras 0 and 4",
    cert: "seen",
  },
  0x5121: {
    name: "destroyTargetsReachedByFixedAttacker",
    role: "destroy every target of a caller's run that one fixed attacker -- the player's own ship -- has reached, marking both destroyed and posting the chained score for each; the attacker's state is tested once, so one pass can take several",
    cert: "seen",
    why: "the attacker is not a parameter, and which object it is decides whether this duplicates destroyTargetsHitByShots or is the other half of the collision system. Under MAME a write tap on the attacker's state byte attributed by program counter settled it: this routine is one of only three writers of the destroyed code, each such write is followed within a frame by a death-countdown reload and, at the end of the countdown, by the life-start routine writing the live code again. The entry it tests stayed at one pinned screen position while the world scrolled and showed no correlation with the fire button. It also leaves both cursors where the sweep ended, and the caller's tail target reads them",
  },
  0x526a: {
    name: "emptyBothDeferredCellLists",
    role: "put both deferred character-cell lists back to empty, parking each cursor four bytes past its own head",
    cert: "seen",
    why: "doing BOTH in one breath is what separates it from the publish step it is the empty branch of: under MAME a write tap by program counter saw this routine write the two heads equally often, while drainBothDeferredCellLists's own reset writes only the staging head. The values are the sentinels both drains test for -- one masking the low byte before subtracting four, the other subtracting four directly -- so 'empty' is fixed by two readers outside this routine. The pair is not a double-buffered display list: the copy runs one way on every pass and the two walkers are asymmetric (see drainBothDeferredCellLists)",
  },
  0x52d2: {
    name: "paintDeferredCells",
    role: "paint the deferred cell list into the character plane and its colour plane: each four-byte entry gives a colour-plane address, the shape to put a plane above it and the colour to put at it, with one shared bias added to every colour. How many are pending comes off the low half of the list's own write cursor, so the whole list lives inside one page; an entry whose colour cell already has the high-priority bit set is passed over untouched, and a cursor that scales to a count of zero is not empty -- the loop runs 256 times",
    cert: "seen",
    why: "the name says these writes ARE the cells the queueing routine banked: each stored address has bit 10 set to reach the character plane for the glyph and cleared again for the attribute, and DEFERRED_WRITE_CURSOR records the four-byte entry shape and the empty test. Under MAME, with a write tap over the whole character plane attributed by program counter, every cell this routine's glyph store wrote was blanked on the following pass by the routine that drains the second list, with no exception in either direction; the tap is not blind, since other program counters writing the same plane (the kill meter's stores among them) were counted separately. The colour bias comes from the low nibble of PEN_COLOUR",
  },
  0x530e: {
    name: "blankCellsPaintedLastPass",
    role: "blank the character-plane cells the previous pass painted: walk the second deferred cell list, which the shared caller filled by copying the paint list wholesale after draining it, and write the blank shape a plane above each entry's address, leaving the colour byte exactly as it was. The pending count comes off the masked low half of that list's own cursor -- the mask drops the top bit the caller sets when it copies -- and an entry whose colour cell already has the high-priority bit set is passed over",
    cert: "seen",
    why: "'painted last pass' is the claim, and it comes from the CALLER: the caller drains this list, then drains the paint list, then copies the paint list wholesale onto this one with 0x80 added to the cursor, then parks the paint cursor back on its first entry -- so this list at pass N should be the paint list of pass N-1 exactly. Under MAME, with a write tap over the character plane attributed by program counter and compared per pass keyed on the caller's dispatch, the set of cells this routine blanked equalled the set the paint routine wrote on the previous pass, in BOTH directions, with zero exceptions; other program counters writing the same plane were excluded by attribution. The pair is not a double buffer, but this pass-N-equals-pass-N-minus-1 relation holds",
  },
  0x5337: {
    name: "queueTileStampForObject",
    role: "queue a two-by-two block of character cells for an object's position onto the deferred write list, one four-byte entry per cell, skipping a pair whose glyph is zero",
    cert: "seen",
    why: "the noun 'tile' is the claim, and the routine alone cannot settle it -- it only builds an address from a base of 0xA000. The routine that drains the list does: it takes each stored address, sets bit 10 to reach 0xA4xx and writes the glyph there, clears it again and writes the attribute at 0xA0xx. Those are this board's video and colour RAM, so the entries are character cells in both planes and not sprite records",
  },
  0x59a0: {
    name: "doubledVelocityForHeading",
    role: "turn a heading handed straight in into the velocity pair the caller's table gives for it, doubled; the doubling wraps at sixteen bits and nothing is written",
    cert: "seen",
    why: "'doubled' distinguishes this body from velocityForHeading, and its consumers show the doubling is the product rather than an artefact: the three shims that fix a table tail-jump here, and their callers bank the pair straight into an object record's +0x0A..+0x0D, which flyAlongStoredVelocity then integrates every frame. 'ForHeading' rather than 'ForObject' is the other half -- loc_599d enters this same body after reading the heading off an object, so taking it as a value is exactly what this entry contributes",
  },
  0x08ae: {
    name: "selectFoldBlock",
    role: "hand back where a fixed block of the program image starts and how many bytes of it to take; nothing is read and nothing is written",
    cert: "seen",
    why: "the name says the pair it returns is a fold's source and count, and the caller could have refuted that: the only transfer into this address is a tail jump from 0x4bd9, whose single caller loads a seed byte and then immediately calls 0x291e -- which IS add a,(hl) / inc hl / djnz, over exactly the count returned here -- and banks the total in a cell a later sequence arm reads. A copy would have used ldir and a painter would have used the character cursor; neither appears anywhere on that path",
  },
  0x0b2b: {
    name: "hideCaptionSprites",
    role: "park the four sprites of the copyright caption above the first visible line by zeroing the vertical byte of each, leaving the rest of their slots standing",
    cert: "seen",
    why: "under MAME, attributed by program counter over driven play, one of those four bytes was written by stampCopyrightStrip's store and zeroed only by this routine's, and the four went from the stamped ladder to all-zero on the frame a start press raised PLAY_ACTIVE -- so it fires when a game begins, on the slots the stamper filled. That those slots are the copyright caption's is re-derivable: the shapes the stamper puts in them decode out of the sprite ROM as a copyright mark and then KO, NA, MI",
  },
  0x0d57: {
    name: "paintPlayerOneScoreReadout",
    role: "enter the shared packed-decimal digit routine at 0x0D73 with one fixed triple -- first cell 0xA781, the three-byte field whose high end is 0xAD35, and a fixed colour; choosing that triple is the whole entry and whatever the caller held is discarded",
    cert: "seen",
  },
  0x0d61: {
    name: "paintPlayerTwoScoreReadout",
    role: "enter the shared packed-decimal digit routine at 0x0D73 with a second fixed triple -- first cell 0xA501, the three-byte field whose high end is 0xAD38, and a fixed colour; choosing that triple is the whole entry and whatever the caller held is discarded",
    cert: "seen",
  },
  0x0d6b: {
    name: "paintHighScoreReadout",
    role: "enter the shared packed-decimal digit routine at 0x0D73 with a third fixed triple -- first cell 0xA641, the field whose high end is 0xA98D, and a fixed colour; the routine walks the field downward, so the high end is where it starts",
    cert: "seen",
  },
  0x0daf: {
    name: "paintSuppressedDigit",
    role: "paint one four-bit digit into the cell the cursor names with the caller's colour a plane below, using the blank glyph instead when the digit is zero and no significant digit has been seen yet, and stepping the caller's flag on at the first that is",
    cert: "seen",
    why: "the suppression is the claim and it is refutable per dispatch: a PC-gated tap under MAME logged the digit, the caller's flag and the destination cell on every entry, and the SAME digit zero painted the blanking glyph while the flag was clear and the glyph '0' once it was set, with the flag turning over exactly at the first non-zero digit -- the six-cell field then read blank, 1, 0, 0, 0, 0 for a value of ten thousand. The glyph it picks for a suppressed zero is independently the game's blank: one caption handler writes that same code to erase a caption, and the pictogram strip pads with it",
  },
  0x0e70: {
    name: "paintQuadTile",
    role: "lay one four-tile block into the character plane from a base code the caller fixes, give all four the caller's colour a plane below, and leave the cursor clear of the block for the next one",
    cert: "seen",
    why: "'quad' is the discriminating claim: the routine that decomposes a value into counts of thirty, ten, five and one calls a DIFFERENT painter per denomination and chains the cursor between them -- one tile for the units, two for the fives, and this one for both the tens and the thirties with only the base code and the colour differing -- so what this entry contributes is the block SIZE, and the four codes are the caller's base plus 0..3. Under MAME, with ROUND_NUMBER seated at ten or more, it lays one four-tile block per call at the caller's base with the caller's colour one plane below. Such arguments are anticipated: one of the two sites posting its caller's ring command passes ROUND_NUMBER, a cell stepped on the path that steps ERA_INDEX and tested against 6 and 11 elsewhere, and ten is the smallest value that gives the tens a non-zero count",
  },
  0x323a: {
    name: "stepShapeAnimation",
    role: "count one record's step timer down and refresh that record's shape byte from the entry the NEW count selects, in the run its own selector byte points at; a timer already at zero is left alone",
    cert: "seen",
    why: "the sharp claim is that the count is also the INDEX rather than only a delay, and that is checkable from outside the routine. Watching one record's three fields under MAME produced six distinct (selector, count) pairs, and in every one the shape byte equalled the byte the ROM's own run-pointer table at 0x3438 puts at that count -- a plain delay would have left the shape unrelated to it. That table has eighteen usable entries and each run is 32 bytes, which is exactly the count the three sites that START an animation load into the step; and since the countdown ends at index 0, every run's FIRST byte is the shape a finished animation is left standing on -- the same shape loc_3855 writes, alongside a zeroed step, into its five records",
  },
  0x32eb: {
    name: "petWatchdogThroughStartupDelayThenStartMachine",
    role: "hold the machine still at power-on and then hand it over: count twelve passes down in a work-RAM cell, petting the watchdog 256 times inside each so the board is never reset while nothing happens, leave the cell and the two counting registers at zero and the pointer on the cell, tell the audio processor to go quiet, pick up the byte that decides the interrupt-enable bit, and fall into the routine that starts the machine",
    cert: "seen",
  },
  0x33b8: {
    name: "headingToward",
    role: "return the heading from an object to a point as a byte of a 256-step circle: the signs and relative sizes of the two axis differences pick one of eight octants, and the shorter leg over the longer places the answer at one of thirty-two rungs inside it",
    cert: "seen",
    why: "an index would not survive arithmetic only an angle admits, and three places do it. The octant table at ROM 0x3415 holds the eight multiples of 32 once each, with bit 5 of each base doubling as a run-backwards flag, so the eight octants tile 0x00 to 0xFF with no overlap and no gap; the equal-legs table at ROM 0x341D holds exactly the four diagonals and is four bytes long, its fifth byte being an instruction. And launchBankEnemyWhenAimedNearPlayer subtracts the object's own heading from the returned value, biases by 0x10 and tests against 0x20, a wrapped alignment window, while reaimAndAnimateEnemyCraftOnPhaseTick adds half a turn before storing it into the cell steerTowardAimHeading turns toward",
  },
  0x3c0d: {
    name: "retireObjectAndHold",
    role: "take an object and the slot one stride on out of play -- both record heads, both coordinates of the caller's sprite entry and of one fixed entry -- then set a further byte of the caller's record to a non-zero constant instead of clearing it",
    cert: "seen",
    why: "'hold' says the byte left standing is a delay rather than a survivor of the wipe, and watching it could have refuted that: under MAME the record head went to zero and that byte jumped to 128 in the same frame, then counted down by one every OTHER frame, which is the cadence of the routine at 0x3c25 -- it gates the decrement on FRAME_TICK's low bit and branches only when the byte reaches zero. Its two siblings retireSlot and retireSlotAndSubPixel clear their record and stop; this one retires a second record and a fixed entry as well, and arms the delay",
  },
  0x4984: {
    name: "pulseSlot1CoinCounter",
    role: "drive coin slot 1's mechanical counter through one pulse for each coin the machine still owes it -- energise the line, release it at the half-way count, and take one off the debt as the pulse ends -- so a debt of two comes out as two separate pulses; with nothing owed it does nothing",
    cert: "seen",
    why: "the slot number is the load-bearing half: 0x49D6 is byte-identical for all thirty-six bytes but for three operands -- a different debt cell, a different timer and a different LS259 line -- so an unqualified 'pulse the coin counter' would name two routines. Under MAME the slot-2 routine was dispatched on every tape and drove nothing, because no tape coined the second slot. The pulse is measured against an undriven control: with no coin the line, the debt and the timer took no writes; with five coins the line took five writes of one and five of zero, both from pcs inside this routine, the timer took 48 decrements per pulse, and the debt took five increments from the accept arm and five decrements from here. ★ This routine is entered three ways, one of them a fall-through from the credit path, so it runs TWICE on the frame a coin is banked -- its MAME dispatch count came out at the undriven count plus one per coin on every driven tape",
  },
  0x49d6: {
    name: "pulseSlot2CoinCounter",
    role: "drive coin slot 2's mechanical counter through one pulse for each coin the machine still owes it -- energise the line, release it at the half-way count, and take one off the debt as the pulse ends -- so a debt of two comes out as two separate pulses; with nothing owed it does nothing",
    cert: "seen",
  },
  0x4a9d: {
    name: "stepThirteenScriptedGlyphCells",
    role: "step thirteen cells of the character plane on by one shape each, but only where a script says so, walking that script through one shared cursor cell that is left wherever the walk ended; two bits of one incoming byte set the directions independently -- the low bit reads the script backwards and steps the shape DOWN, the next bit takes the cells a row up instead of a row down",
    cert: "seen",
  },
  0x4acc: {
    name: "unpackCoinage",
    role: "turn the two four-bit coinage settings into the byte each coin slot's accept arm works from, and raise the free-play flag when either of them reads free play",
    cert: "seen",
    why: "the subject matter is the whole of the name, and it is a MAME experiment that could have gone the other way. Forcing the DSW0 port to eight values and reading the destinations back, each carried exactly the coins-and-credits pair MAME's own label gives that nibble's setting, each destination followed its OWN nibble while the other moved independently, FREE_PLAY came up only for the settings labelled free play, and a control cell in the same block did not move. Which destination belongs to which slot is fixed outside this routine: the accept arm that debounces the coin-1 bit reads COIN_SLOT_1_RATIO and the one debouncing coin 2 reads COIN_SLOT_2_RATIO",
  },
  0x4b19: {
    name: "stepSequenceUnderChecksum",
    role: "step the sequence's inner sub-step on, folding a block of the program image on the way; a total that does not match advances the outer phase instead, which derails the sequence rather than halting it",
    cert: "seen",
    why: "the name says the mismatch arm cannot run on a genuine image, and a measurement could have contradicted it: under MAME this routine's own entry is reached, yet its `call nz` at 0x4B2A is never taken (no return address is ever pushed at that PC), and the fold over the real image comes to exactly the byte it is compared with. This entry has no static call site anywhere in the image -- it is reached only as the eleventh entry of the word table at 0x1659 that dispatchSequencePhase1SubStepArm dispatches -- so what it is FOR is fixed by that table and by nothing that could be mistaken for a caller",
  },
  0x51b3: {
    name: "markObjectsTouchingPlayer",
    role: "replace the state byte of every object in a caller's run that lies inside a wrapped box around the player's sprite entry, while the player is alive; the box is the caller's, the player's own state is untouched and nothing is scored",
    cert: "seen",
    why: "that the reference is the PLAYER is what the name adds over the mechanism, and it rests on evidence outside the routine: three sibling sweeps read the same guard cell and the same reference pair, and the write tap behind destroyTargetsReachedByFixedAttacker already attributed that pair to the ship held at one screen position through a driven game. What separates this entry is what it does NOT do -- the other three also write the destroyed code into the player's own state. Only two of those three go on to post a score: destroyPlayerAndObjectsTouchingIt does not. Under MAME it marked ten times in 300 s of attract, every mark on the same record, which is the single object every one of its four call sites leaves the cursor on",
  },
  0x5634: {
    name: "enqueueTransitionSoundBurst",
    role: "queue seven sound codes back to back with no play test: six fetched one each from its own cell of the program image, so an edit to the image changes what is asked for, and a seventh formed by adding the era index to a fixed base",
    cert: "seen",
  },
  0x5683: {
    name: "requestTwoSounds",
    role: "request two sounds in a row, each code fetched from its own byte of the program image, both admitted by the shared play-or-demo permission",
    cert: "seen",
    why: "'sounds' is a claim about where the codes end up, and it is settled outside this routine by the rest of the path: the drain at 0x55d4 takes the queue's head, hands it to 0x55f8, which writes it to 0xC000 -- the sound-data latch in the driver's memory map -- and pulses the LS259 bit MAME wires to the second Z80's IRQ trigger. So the bytes reach another processor as commands rather than sitting in RAM. Neither code is baked in: each is read from a program byte, and the two bytes are far apart, so this is a chosen pair and not a run walked through",
  },
  0x5628: {
    name: "enqueueSoundUnconditional",
    role: "queue a sound code with no permission test, so it is queued whether or not a game is being played",
    cert: "seen",
    why: "it is the unconditional way into the enqueue body at 0x562A: its own two pushes (HL, then the code in AF) fall straight into that body, which pops them back, steps SOUND_QUEUE_COUNT on and stores the code at the slot the new count selects. Under MAME (attract, a state enqueueSoundIfGameInProgress would drop) every fetch at 0x5628 was followed by exactly one count bump at pc 0x562D and exactly one store at pc 0x5631 of the A value held at entry, with no test between; the fetches came from the six call sites in enqueueTransitionSoundBurst 0x5634 and from that routine's tail-jump carrying its last code. The enqueue body 0x562A has no ROUTINES entry: no call, jump or table word anywhere in the ROM holds its address (a byte scan finds none); it is entered only by falling through from this entry or by the relative jr nz branches at 0x5612, 0x561D and 0x5623 in the two gated entries, always with the caller's HL and the code already pushed. So this entry is grounded on the pairing of its own fetches with those writes",
  },
  0x5617: {
    name: "enqueueSoundIfGameOrAttract",
    role: "queue a sound code when either the play flag or the cell at 0xA9C6 is set; only with both clear is the request dropped",
    cert: "seen",
  },
  0x560c: {
    name: "enqueueSoundIfGameInProgress",
    role: "queue a sound code, but only while a game is being played; with the play flag clear the request is dropped and nothing is left behind for a later frame",
    cert: "seen",
  },
  0x0b4c: {
    name: "sumByteRunAndCompareToExpected",
    role: "add a run of bytes together and answer whether the total is the byte the caller named; the length means a full 256 when it is zero, the total wraps at eight bits, nothing is written, and the answer is left for the caller rather than acted on here",
    cert: "seen",
  },
  0x0bf2: {
    name: "drawTextRunByIndex",
    role: "paint the caption an index selects: the index picks a record from one word table, and the record supplies the destination cell, the colour and the glyph run that drawTextRun then paints",
    cert: "seen",
    why: "the name claims selection by index into a table of a definite size, and both halves are refutable from outside. A PC-gated read tap under MAME logged the accumulator on 1578 dispatches across 200 s of undriven attract and the largest index ever presented was 31 -- and the byte one past the table's 32nd entry is 0x0C90, which is the entry of the very routine that calls this one, so the table cannot be longer. Every one of those 32 records names a destination inside video RAM and ends its run on drawTextRun's terminator, while the two records past the end name 0x7E1C and 0x0D0D, neither of which is video RAM. It does NOT claim every record is text: drawTextRun's own entry records that two of them are a shaded banner strip instead",
  },
  0x20af: {
    name: "dressPlayerSpriteForHeading",
    role: "dress the player's own sprite entry to face the way the ship is heading: round the heading byte to the nearest of thirty-two equal sectors and write the shape and the byte beside it straight into the entry, from two parallel thirty-two-entry tables in the program image. The entry and both tables are fixed here, so nothing about which object this is comes from the caller",
    cert: "seen",
    why: "'the player's' is the claim, and the sprite entry is the thing that could have refuted it. The life-start routine seats this ship's record head alive, writes the heading cell this entry reads, pins the entry's two coordinate bytes at 0x84 and 0x78, and only then calls this -- and PLAYER_STATE's own entry, grounded by a write tap, records 0xA800 as the head of that record, of which the heading cell is the third byte. Watched under MAME through a credited game, sampled once a frame: with the state byte alive, the entry's shape byte equalled the ROM table's entry for the heading's sector and the byte beside it equalled the parallel table's, on 4419 samples out of 4419, while the two coordinate bytes never left 0x84 and 0x78. The 2937 samples taken while the state byte was NOT alive are excluded and counted rather than dropped -- the ship is mid-explosion there and the shape is not this routine's. A crossed table, a sixteen-sector rounding, or an entry belonging to some other object would each have produced mismatches and produced none",
  },
  0x2755: {
    name: "freeAllShotSlots",
    role: "free all six of the player's shot slots, zeroing each record's occupancy byte and its second-axis coordinate but not its first; the fill byte and the record stride are both fetched from program space rather than written as immediates",
    cert: "seen",
    why: "that the array is the player's shots is fixed outside this routine: fireAndSweepPlayerShots reads the panel through readPlayerControls, rotates the fire bit into carry, shifts it into a two-bit edge history and tests for exactly a rising edge before arming this same six-record table, and destroyTargetsHitByShots fixes its outer array here too. The name then predicts a cadence a tap could refute -- freeing the shots belongs to the start of a life, not to a frame or a round -- and under MAME its store fired 9 times on a tape whose life-start store wrote PLAYER_STATE alive exactly 9 times. Its only caller is that life-start routine. Patch-sensitive by construction: change either fetched byte and it clears a different array with a different stride",
  },
  0x2a97: {
    name: "dressSpriteForFineHeading",
    role: "dress one sprite entry to face the way its object is heading, resolving the heading to thirty-two sectors and writing the shape code and the attribute beside it directly into the entry, alternating between two shape banks as a frame counter's bit turns over",
    cert: "seen",
    why: "'Fine' is a rank against exactly one sibling and it has to be checkable: spriteForHeading rounds to sixteen sectors and RETURNS the pair, this rounds to thirty-two and STORES it -- the mask is 0x3F with a pre-add of half a sector, where sixteen sectors would need 0x1E. The sharper claim is that the second table byte is a flip attribute and not a per-sector palette, and one tap could have killed it: the sprite entry's attribute byte took 914 writes from this routine's store and the value histogram of those writes contains ONLY 0x5C and 0xDC, summing to exactly 914 -- two values differing in one bit across every dispatch, where a palette pick would have spread. Reachability was measured rather than assumed: 7126 dispatches on the one tape that reaches the third era and zero on three tapes that do not, which is its handler's seat in the era-keyed table. It does not say what the object is",
  },
  0x2afc: {
    name: "dressSpriteForCoarseHeading",
    role: "point an object's sprite the way it is heading, by rounding its heading byte to the nearest of sixteen sectors and taking a shape pair from two parallel tables",
    cert: "seen",
  },
  0x2b38: {
    name: "animateSelectedShapeCycle",
    role: "give one sprite entry the current frame of a four-frame shape cycle, from the block a record byte selects, and one fixed attribute beside it",
    cert: "seen",
    why: "'Selected' is the whole discriminator against animateFixedShapeCycle, and the two bodies settle it: that sibling's base is a literal while this one's is four times a record byte, and its cycle is eight frames from the counter's bits 1-3 where this one is four from bits 2-3. Reachability was measured rather than assumed -- read taps under MAME counted zero dispatches on two tapes that stayed in eras 0-1 and 48894 on a third that held the era at 4. It does not claim what the record byte IS; only that it selects",
  },
  0x2c31: {
    name: "driveObjectAppearanceByPhaseBand",
    role: "drive one object's appearance from its own state byte, in three bands, on the path a slot takes once that byte is neither free, live nor held: at forty-two and above only the tint moves, cycling with the frame counter; from ten to forty-one a halved value picks a shape out of a fixed sixteen-entry table; and below ten the slot is retired outright unless a single shared request cell names it by the record number stamped at the record's sixteenth byte -- while named it holds one fixed shape and tint, advances the byte on seven frames in eight, and on the first value alone posts a command and clears the request",
    cert: "seen",
  },
  0x2cbc: {
    name: "runSceneryForEra",
    role: "seat the record cursor and the sprite-entry cursor on the first scenery slot, then run one of three fixed lists of parallax wrappers, chosen by the era index",
    cert: "seen",
    why: "the arms test the era against 0 and then 4, so the name predicts the last era gets its own list while the middle eras share one -- which mechanisms.md derives independently as this dispatcher splitting the era {0}, {1,2,3}, {4}. A MAME run holding the era at 4, whose undriven stretch ran at era 1, measured both arms with one instrument and every wrapper's count is this routine's own dispatch count times its place in the arm's list, exactly: 963 dispatches at era 1 gave 963 / 1926 / 963 across that arm's three calls, 15817 at era 4 gave 31634 to each of its three doubled calls, and each arm's members sat at zero in the other's context",
  },
  0x2d15: {
    name: "driftThreeTileSceneryAtFiveQuarters",
    role: "drift one scenery object at five quarters of the frame's world scroll, lay two further tiles flush against it in a straight strip, and step both cursors past the object so the caller lands on the next slot",
    cert: "seen",
    why: "the fraction and the tile count are the whole claim, and the family could have contradicted either: its four siblings are the same calls with one term changed each, and driftTwoTileSceneryAtThreeQuarters' own entry already lists a 'five quarters with three' sibling from a separate derivation. A prediction that could have failed: the scenery band is eight slots wide, and each member consumes one slot per tile, so every arm of the era-keyed dispatcher must total exactly eight -- the era-0 arm comes to 3+2+2+1, the middle arm to 3+2+2+1 and the era-4 arm to 2+2+1+1+1+1, all landing on the band boundary. Under MAME it was dispatched 11999 times on a tape held in the first era and ZERO on the attract demo, which never runs that era in the round phase -- the {0} {1,2,3} {4} split ERA_INDEX's entry records independently. Its callee driftAtFiveQuartersWorldScroll is already grounded with every dispatch seated inside the scenery block. It does not say which object",
  },
  0x2d2d: {
    name: "stepTwoTileSceneryAtFiveQuarters",
    role: "advance one two-tile scenery object: drift it at five quarters of the world scroll, lay its second tile flush against the first, and step both cursors past the pair",
    cert: "seen",
    why: "the fraction and the tile count are both counts a run can refute. The fraction: its drift call is driftAtFiveQuartersWorldScroll and no other, and that helper's count in an era-4 MAME run equals this routine's exactly. The tile count: two slots go per dispatch, one inside placeAbuttingTile and one at the tail, so advanceToNextSlot must run eight times per dispatch of the last era's arm in the era-keyed scenery dispatcher at ROM 0x2CBC -- 126536 against that dispatcher's own 15817 dispatches, which is eight, and a tile count wrong by one breaks it. It is also the only member of its family absent from every other arm of that dispatcher, measured at zero across four runs that never reached era 4",
  },
  0x2d36: {
    name: "driftTwoTileSceneryAtThreeQuarters",
    role: "drift one scenery object at three quarters of the frame's world scroll, place a second tile flush against it, and step both cursors past the object so the caller lands on the next slot",
    cert: "seen",
    why: "the fraction and the tile count are the claim, and the family could have contradicted either: its four siblings are the same three calls with one term changed each -- three quarters with one tile, five quarters with two, five quarters with three, a half with one -- and every one of them tails into advanceToNextSlot. Its callee driftAtThreeQuartersWorldScroll is already grounded with every dispatch seated inside the scenery block, and the era-keyed scenery dispatcher calls this entry twice in a row from two of its arms, which is the shape of two consecutive two-tile items in a parallax list. It does not say which object",
  },
  0x2db8: {
    name: "startNextRound",
    role: "start the next round: step the round number, roll the era on and wrap it after the fifth, set the round's difficulty byte from one of three sources by round bracket, refill the kill quota, and clear two flags while arming a third",
    cert: "seen",
    why: "a routine that starts a round must re-arm the quota that ends one, and must advance the era on the schedule the era cell independently follows -- both are checkable against other code and both hold. It reloads KILLS_REMAINING from KILL_QUOTA, which is written once at boot with 56 and is not era-keyed; its era roll wraps at five, which is what ERA_INDEX's own entry records from a separate derivation; and its round brackets at 6 and 11 are the escalation mechanisms.md derives independently as banded by rounds completed rather than by era. Both callers gate it on a round being over. NOT REACHED by three MAME sweeps -- none completed a round -- and a write tap corroborates from the other side: across a run covering boot, attract, the demo and a driven game, not one of this routine's stores fired, every write to those cells coming from the per-player context copy instead",
  },
  0x3252: {
    name: "guardBlockOrDerailSequence",
    role: "fold a fixed span of the program image and let the sequence's inner step go on if it still adds up; a span that does not fold to the expected value throws the sequence a whole phase forward instead, which derails it rather than halting it",
    cert: "seen",
    why: "named after guardBlockOrBlankDisplay, whose name states its failure arm, because the failure arm is what separates the four members of this family and this one's could have gone either way. Two of them jump at data or outside the image and simply kill the machine; stepSequenceUnderChecksum takes BOTH arms, advancing the phase and then always stepping the sub-step. This one is a tail jump to one or the other and never both. Its pass arm is advanceSequenceSubStep and its failure arm advanceSequencePhase, and under MAME this entry is reached while its failure jump at 0x3266 is never taken -- the pass tail at 0x3269 runs every time -- which is what an arm that cannot run on a genuine image looks like from outside",
  },
  0x3ce9: {
    name: "mirrorTwoTileObjectByHeading",
    role: "dress two adjacent sprite entries with a consecutive pair of shape codes from the block HITS_REMAINING selects, so the object wears its damage, and mirror the pair -- swapping which entry takes the lower code, and flipping both -- on whichever half of the heading circle it is in",
    cert: "seen",
    why: "if the two arms are a mirror rather than two different poses then the two attributes must be one colour differing in a flip bit, and the swap must fall at two antipodal headings. Both held: the attributes are 0x6D and 0xED, and the board decodes a sprite's second bank byte as six colour bits, an inverted flip-X and a flip-Y, so those two are the same colour differing only in flip-Y; and the boundary is the heading biased by a quarter turn against a half, which is exactly 0x40 and 0xC0. Watched under MAME the entry's code byte took 172 writes from each arm and its attribute byte 172 of each value, summing to the 344 dispatches a read tap counted on the same tape. It does not say what the object is, and unlike spriteForHeading it resolves the heading to one bit. The block selector is HITS_REMAINING, read as the most hits minus what is left -- so a fresh object and a damaged one are drawn from different blocks",
  },
  0x41f1: {
    name: "animateFixedShapeCycleFromShape50",
    role: "give one sprite entry the current frame of an eight-frame shape cycle from a fixed base, and one fixed byte beside it; the frame is picked from bits one to three of FRAME_TICK, so the cycle turns over once every sixteen counts. Nothing about the object is read, so two entries written in one tick get the same shape",
    cert: "seen",
    why: "'FromShape50' is the one thing that separates it from its sibling animateFixedShapeCycle, and the two bodies settle it: both take their frame from bits one to three of FRAME_TICK (`ld a,(0xa980) / rrca / and 0x07` at 0x3E7E and at 0x41F1), so the two cycles run at the same rate and in step, and they differ only in their constants -- this one starts the cycle at shape 0x50 and pins the attribute to 0x0A, the sibling starts at 0x40 and pins 0x44. 'Fixed' is the other half: neither body reads anything of the object, which is why two entries dressed in one tick cannot be told apart. Under MAME, read taps counted ZERO dispatches on an undriven attract run reaching eras 0-3, a driven run in era 0 and a driven run with the kill quota forced empty, and 2618 on a run holding ERA_INDEX at 4 -- the gate its two callers sit behind; on that run it wrote the full eight-frame shape cycle and the fixed byte beside it. The shapes on the glass are not pixel-checked",
  },
  0x4201: {
    name: "steerTowardAimOneUnitAFrame",
    role: "turn an object's heading one unit toward the heading it aims at, on every dispatch, standing still once the heading sits on the aim or one unit past it; the direction test is taken on the gap PLUS ONE, so a gap of exactly 127 turns the LONG way round and the standing band is off centre",
    cert: "seen",
    why: "the two halves of the name separate this from its sibling steerTowardAimAtFixedRate, whose own entry describes this address as 'the same biased tests with a step of one'. The step is one where the sibling's is two, and this body reads no counter where the sibling gates on the frame counter's low two bits -- so this turns on every dispatch at one unit and the sibling on three frames in four at two units. Under MAME, read taps counted 4939 dispatches here across eras 2 and 3 and ZERO in era 0 and in a run holding the era at 4, while the sibling's entry records zero in eras 0-1 and 8225 at era 4. Their callers agree -- 0x4117 calls this one and then a flier and a dresser, 0x41B8 calls the sibling in the same slot of the same shape. ★ The name does NOT say 'the short way round': the +1 bias makes a gap of 127 turn long, and because the step is ONE the resting point is decided by the side it approached from",
  },
  0x421f: {
    name: "steerTowardAimAtFixedRate",
    role: "turn an object's heading two units toward the heading it aims at, on the three frames in four when the frame counter's low two bits are not both clear; a fixed step, where its sibling steerTowardAimHeading takes its rate from a table",
    cert: "seen",
    why: "the name says the byte it writes is the heading MOTION follows, and its caller could have refuted that: flyTowardShipStandoffThenEndApproach re-aims by writing the aim byte every sixteenth frame, calls this routine, and then calls the flier whose first instruction reads the very byte this one wrote. A caller that used the result as a table index, or a flier that read the aim instead, would have killed the name. Read taps under MAME counted zero dispatches on two tapes in eras 0-1 and 8225 on one holding the era at 4. ★ The name deliberately does NOT say 'the short way round': the direction test is taken on the gap PLUS ONE, so a gap of exactly 127 turns long; the standing band is two wide and off centre, at gaps of 0 and 255; and because the step is TWO the gap's parity is invariant, so which of those two it comes to rest on follows that parity and not the side it approached from. Sibling 0x4201 has the same biased tests with a step of one, which makes it side-determined instead -- same shape, different mechanism",
  },
  0x44dc: {
    name: "dressSpriteFlutterShapesByFrameTickBit",
    role: "give an object the two shapes of a two-frame flutter, the pair picked by one bit of a counter cell and nothing the object holds",
    cert: "seen",
  },
  0x46ce: {
    name: "fileTwoPairsIntoObjectRecordHighByteFirst",
    role: "file two register pairs into an object's record as four bytes, each pair high byte first and so stored the opposite way round from a word",
    cert: "seen",
  },
  0x46db: {
    name: "retireEntryPairIntoCooldown",
    role: "clear a record's occupancy byte and both coordinates of TWO neighbouring sprite entries, then arm the record's delay byte with a fixed value rather than leaving it clear",
    cert: "seen",
    why: "'pair' is the whole of the claim and the caller settles it from outside: armMotherShipOrStep refuses to spawn unless the occupancy bytes of BOTH the record at 0xA8A0 and the record one stride on are clear, and then hands this routine that record with the matching entry base 0xAA24 -- so the thing retired occupies two entries by the caller's own test, not by this routine's shape. Its second caller reaches it conditionally from a different file, so the shape is not one caller's habit. The byte it arms is the offset retireSlotIntoCooldown and retireObjectAndHold arm with 0xF0 and 0x80; this site's value is 95, and nothing here fixes the tick rate",
  },
  0x4831: {
    name: "postNextParachutistBonus",
    role: "post the next rung of the rescue award to the command ring and step the per-life rung count on; the first four rungs each take their own value from a four-entry table and every rung after them takes the same top value, so the ladder rises and then caps",
    cert: "seen",
    why: "the ladder is decodable outside this routine, through a table it never touches: the four bytes it posts are arguments to ring command 4, whose handler indexes a packed-decimal table and adds the result to the player's score, and decoding all five gives 1,000 / 2,000 / 3,000 / 4,000 then 5,000 for ever -- monotone, round and capping. mechanisms.md derives the same ladder and cap independently. ★ 'per-life' is measured: under MAME the rung cell took writes from this routine's increment with the values 1, 2, 3 and from the life-start routine resetting it. A poked run also took the capped arm under MAME -- rung 4 read, 0x040F posted, the rung written 5 -- so both halves of the ladder are observed. Its caller returns early in the final era, which is the one era mechanisms.md records as having no parachutists",
  },
  0x4853: {
    name: "spawnAtEdgeAhead",
    role: "on a cooldown, and only on alternate frames, place a free slot at the field-edge position the player's current heading selects, clear its sub-pixel remainders and mark it live",
    cert: "seen",
    why: "a heading-indexed table gives one answer per dispatch, so a MAME write tap on the slot's two coordinate bytes recomputed the index the ROM's way and compared: 19 placements, 19 matches on both bytes, over eight heading sectors. Both halves of the name are properties of that table and both hold -- all sixteen pairs lie within sixteen of a field border, and against the player position the same run measured, each pair lies within 41 degrees of the heading that selects it. That second check is the one that could have failed, and on a first derivation with the player's two axis bytes crossed it did; the measurement corrected the axes. What it places is fixed from outside: its caller seats one dedicated record and sprite entry and opens by reading the era index, comparing and returning, which is the singleton manager mechanisms.md derives independently for the parachutist and the reason there are none in the final era",
  },
  0x48ad: {
    name: "retireSlotIntoCooldown",
    role: "take an object out of play -- occupancy byte and both of its sprite entry's coordinates -- and then arm the record's delay byte instead of leaving it clear, so the slot is held rather than freed",
    cert: "seen",
    why: "'cooldown' is the claim and it is refutable: if that byte were scratch nothing would read it. Six sites outside this routine form the loop instead -- the per-slot handler tests it and, when it is non-zero, diverts the whole slot to the routine that counts it down; two routines decrement it; and the sibling that calls retireSlot re-arms this same byte immediately afterwards, which retireSlot's own entry already records. Its first three stores are retireSlot byte for byte, so the arming is the entire difference. It does not claim how long the delay is: this entry writes 0xF0 where retireObjectAndHold writes 0x80, and nothing here fixes the tick rate",
  },
  0x4b30: {
    name: "copyThreeTilemapCellsFromBothPlanes",
    role: "copy three tilemap cells into three two-byte keeps, reading each cell twice because its two planes sit a fixed distance apart",
    cert: "seen",
  },
  0x4b4b: {
    name: "drawRandomByte",
    role: "draw the next pseudo-random byte: advance the seventeen-byte shift register one place, fill the vacated head with the exclusive-or of two taps, and hand back that feedback plus the frame counter, so two draws at different moments differ even where the register has not moved",
    cert: "seen",
    why: "if this is the game's generator the register must be seeded from somewhere and must have no other writer, and a write tap could have found a dozen. It found two program counters: this routine's feedback store, and the block copy that seeds seventeen bytes from the program image. Its four callers each consume the accumulator immediately as a draw and each shapes it differently: a bit, a signed jitter around a heading, a compare against a threshold cell, and a masked table index. ★ Anything that pins this game's entropy pins THIS",
  },
  0x4ba5: {
    name: "loadDefaultHighScores",
    role: "copy forty bytes of program space into the five-entry high-score table, which is the only way that table is ever initialised",
    cert: "seen",
    why: "the block's first column runs 0,1,2,3,4, which fits five eras and five ranks equally, so the column cannot settle the noun and other code has to. It does: one routine compares each record's score field against the CURRENT PLAYER'S score cell, slides the tail down by exactly one eight-byte record when it is beaten, and then renumbers that first column 0,1,2,3,4 -- an insertion sort with a rank key, which an era table would never receive. Another draws all five records into video RAM. The ROM defaults are monotone decreasing in the compared field. Watched under MAME the destination took exactly one write, at boot, and none through a full driven game, which is what a table of DEFAULTS looks like. It does not claim what the four bytes past each score are",
  },
  0x4d2b: {
    name: "isScoreBelow",
    role: "answer whether one three-byte score is below another, both read most significant byte first from the two addresses given and DOWNWARD, all three equal counting as not below; nothing is written -- the answer, mirrored into carry for the caller to branch on, is the whole product",
    cert: "seen",
    why: "'score' rests on the operands, which are chosen entirely outside -- the body is a three-byte compare and nothing more. Its only caller walks five eight-byte records, calls this against each, takes the first for which the answer is 'not below', slides the tail down by one record with lddr, copies three bytes in and renumbers the records' first column 0,1,2,3,4: an insertion sort with a rank key. loadDefaultHighScores' entry derives the same table from the other end. Under MAME, through a credited game to game over, it was dispatched five times in ONE frame, with the candidate pointer at the active player's score triple (ACTIVE_PLAYER read 0) and the standing pointer walking 0xAB0B at a stride of eight. The five standing values decoded most-significant-byte-first as 10000, 8800, 8460, 6520 and 4300 -- monotone decreasing and byte-identical to the ROM defaults; the candidate was 5700 and the sweep inserted at the last record",
  },
  0x4d67: {
    name: "advanceSexagesimalDigit",
    role: "advance one two-digit packed-decimal place of a base-sixty counter, storing the stepped value before testing it and replacing it with zero once it reaches sixty; the answer comes back in the carry, inverted, so a set carry means it did NOT wrap",
    cert: "seen",
    why: "base sixty rather than base a hundred is the claim, and the value histogram of a MAME write tap could have refuted it: the cell it steps took writes at 00-09, 10-19, 20-29, 30-39, 40-49, 50-59 and 60 and at no other value -- no invalid packed-decimal nibble ever appeared -- and the wrap store fired exactly as often as the value 60 was written. The inverted carry is what its caller consumes: the caller chains it over three neighbouring cells and stops at the first that does not wrap, so the flag and not the byte is the product, and the carry into the second place was one-to-one with the first place's wrap in every run. ★ The counter it serves is NOT a clock, and the name says 'sexagesimal' rather than 'seconds' because of it: one wrap took 84, 95, 120 and 140 frames on four different tapes, because the caller runs once per dispatch of the round engine's service block and that block does not run every frame",
  },
  0x4daf: {
    name: "stampTwoByTwoTileBlock",
    role: "stamp one two-cell-square emblem at the cursor, colour all four cells walking back across the square, and leave the cursor past it",
    cert: "seen",
  },
  0x4f5d: {
    name: "stagePlayerShotSweepAgainstTargetsAndRun",
    role: "stage the two cursor cells and the eight fixed arguments -- the six-slot player shot run, a three-slot target run at a sixteen-byte stride, and a box seven by fifteen -- then tail-jump into destroyTargetsHitByShots, which does the destroying; choosing the runs is the whole of what this entry contributes",
    cert: "seen",
  },
  0x4f7e: {
    name: "destroyFixedTargetHitByShots",
    role: "destroy the one fixed target the player's shots have reached, spending each shot that reached it and posting the score for each; the target's liveness is tested ONCE, ahead of the sweep, so several shots can be spent on it in a single pass",
    cert: "seen",
    why: "the swept array is the claim, and its record layout could have contradicted it: this routine reads each record's coordinates at the same two offsets destroyTargetsHitByShots uses on its own outer array, which is this same six-record table, which fireAndSweepPlayerShots arms only on a fire-button rising edge. Watched under MAME both of its stores fired -- the target's state byte nine times and a shot's occupancy byte once -- so the hit path is observed and not inferred. ★ The guard sits BEFORE the loop and is never re-tested, which is why the role says so: a reader who assumes it re-arms will predict one hit per call and be wrong",
  },
  0x4fbf: {
    name: "destroyCraftAndMotherShipHitByShots",
    role: "run the shot sweeps for the stretch of a round in which the Mother-Ship is on the field: stage the two cursor cells, sweep the six player shots against FIVE ordinary craft rather than the usual seven, then fall through into the sweep that runs the same six shots against the Mother-Ship's own state byte and screen position. Choosing the shorter craft run is the whole of what this entry adds",
    cert: "seen",
    why: "the claim is that this is the arm taken while the two-slot object is out, and that FIVE is five because that object holds the last two of the seven ordinary craft slots -- both refutable, and several independent sites in the ROM agree. Its caller reads one flag and sends the sweep here when it is set and to a SEVEN-craft sweep of the same run when it is clear; the spawner raises that flag only when the kill quota has reached zero and both the record at 0xA850+5 strides and the record one further on are free, and arms the second of those with seven; the two ordinary per-slot handlers for exactly those two records return early while the flag is set; and a further site shortens its own walk of the same run to five under the same test. The arithmetic closes: 0xA850 plus five strides IS that object's record. Measured on the real ROM under MAME, two runs differing in one line of the driver -- whether KILLS_REMAINING is forced to zero: ZERO dispatches here across the control, whose caller was dispatched 2090 times in the same run, against 1361 in the poked run, every one of them attributed to the flag-set state and none to the flag-clear state that the same run entered nine times. The arming was watched four times and wrote seven into the counter each time, which is the manual's seven hits on an object the manual says appears after the quota's 56. ★ It does not CALL the second sweep, it falls into it: this entry and 0x4FE0 have equal dispatch counts in both runs",
  },
  0x4fe0: {
    name: "destroyMotherShipAndShotOnMutualHit",
    role: "sweep the six player-shot slots for one that has reached the single fixed two-slot target, mark both destroyed and post the score for each; the first-axis window is widened for two of the era values, by a data swap rather than a second body",
    cert: "seen",
  },
  0x507e: {
    name: "destroyFixedTargetReachedByPlayer",
    role: "destroy one fixed target and the player with it when the two touch, zero the target's HITS_REMAINING so the contact kills it outright rather than costing it a hit, and tail-transfer to the scoring routine; four tests must all pass, so nothing at all is written unless every one of them does",
    cert: "seen",
    why: "the reference it measures the target against is what the name adds, and it is fixed outside this routine: it reads the same sprite-entry pair three sibling sweeps use, and the write tap behind destroyTargetsReachedByFixedAttacker attributed that pair to the ship that holds one screen position while the world scrolls past. Undriven play never satisfies the four-test conjunction, but under MAME a poked run that brings the ship onto a fixed target does, and all three of its stores fire, followed by the player's and the target's deaths",
  },
  0x5152: {
    name: "destroySlotsAndPlayerOnContact",
    role: "sweep a run of slots against the player's own sprite entry and, for every overlap, write the destroyed marker into both the slot and the player and post the score; the sweep does not stop at the first",
    cert: "seen",
    why: "were this the shots-against-targets sweep it would neither refuse to run on the player's state byte nor write it, and it does both: a MAME write tap attributing every write of PLAYER_STATE by program counter through a driven game caught this routine's own store six times, each the destroyed marker. mechanisms.md derives independently that the collision chain's members differ in what else they write, and that two of them write the player and post a score; this is one of those two",
  },
  0x5185: {
    name: "destroyPlayerAndObjectsTouchingIt",
    role: "destroy the player and every object of a caller's run that lies inside a wrapped box around the player's sprite entry, while the player is alive; one window width serves both axes, nothing is scored, and the sweep runs on past the first",
    cert: "seen",
    why: "the name makes two claims the family splits on -- that the player's OWN state takes the destroyed code, and that nothing is scored. A MAME write tap settled the first: across a driven run the destroyed code reached PLAYER_STATE from exactly three program counters, one of them this routine's store, which fired together with its target store in a single event; markObjectsTouchingPlayer's store never appears. The second is structural: its two nearer siblings both call the scoring routine and this one has no path to it. ★ It hands back more than memory: the occupancy cursor in E -- stepped by 0x10 with no carry into D, so it wraps inside its own page -- and the sprite-entry cursor in IY, stepped by two. Its callers at 0x4EF9 and 0x4F21 reload only B, L and H before tail-jumping into markObjectsTouchingPlayer, so DE and IY carry straight over",
  },
  0x55f8: {
    name: "sendSoundCommand",
    role: "hand one byte to the audio processor: write it into the one-byte latch that processor reads, then drive its attention line high and back low, the edge that makes it look",
    cert: "seen",
    why: "'the' latch is a uniqueness claim: a MAME write tap across boot, attract, the demo and driven play found every write to the sound-data latch coming from this routine's store and no second program counter. The attention line took exactly twice as many writes, a high from one instruction paired with a low from the other, and a read tap at this entry counted one dispatch per latch write. The driver's memory map has that address as sound data to the second Z80 on WRITE, and the LS259 bit as that processor's interrupt trigger. ★ The latch address is split BY DIRECTION -- read, it is the scanline counter -- so the sites elsewhere that load from it are not reading what this routine wrote. It does not claim what any particular byte MEANS",
  },
  0x58fe: {
    name: "flyAlongHeadingAtDoubleVelocity",
    role: "fly one object a single step along the heading it holds, with TWICE its own velocity component and the shared world scroll added once, so nothing else may drift this object",
    cert: "seen",
    why: "if only the velocity term doubles then the difference from flyAlongHeading must be exactly two instructions, each sitting immediately after a velocity load and neither after a scroll load -- and the two bodies are byte-identical but for two inserted adds, in exactly those places. Both entries are reached only through two-instruction table-fixing shims. Read taps counted zero dispatches on two tapes in eras 0-1 and 38749 on one holding the era at 4. ★ It says 'Velocity' and not 'Step' on purpose: flyAlongHeading's entry already warns that a reader who takes it for velocity alone will apply the camera twice, and a name saying the whole step doubles would make that same error in the other direction",
  },
  0x10f8: {
    name: "loc_10f8",
    role: "give five display-list slots a second appearance half a screen away: a slot is a byte pair whose first byte carries a request in its top bit, and where that bit is set the pair trades half a byte range -- the requester gives that half up and the partner takes it on, which is what carries the slot into the far half of the display. A slot with no request is stepped over rather than stopped at, so a gap in the middle costs the slots after it nothing",
    cert: "seen",
    why: "kept hex because the image has no entry point here for an English name to be about. A scan of the whole 24 KB for the little-endian word 0x10F8, at every alignment, finds two occurrences and neither is behind a call or a jump opcode; the only transfers that land here are relative branches at 0x10DD and 0x1104, both interior to multiplexSpriteSlots (0x1098-0x1198). The same scan finds entry points where they exist -- 0x1098's word three times behind a `cd` and 0x10FD's once behind a `c4`, the CALL and CALL NZ those two are reached by. The entry exists because spinRemainingSpriteMultiplexSlots's tail transfers here; what the body does is a stretch of multiplexSpriteSlots' job rather than a job of its own",
  },
  0x12e2: {
    name: "loc_12e2",
    role: "run the sequence delay down by one and, on the frame it reaches zero and only then, let the sequence take its next decision; the countdown wraps rather than sticking, so a delay that starts at zero buys a full 256 frames before that decision comes round again, and on every other frame the one decremented cell is the whole effect",
    cert: "seen",
    why: "kept hex because any name built from its body names the shared prologue and not this routine: a byte-pattern scan of the image finds `ld hl,0xA9EB / dec (hl)` at 0x12E2, 0x16D6, 0x174E, 0x1792, 0x196A, 0x330B and 0x56B8, so the countdown is an idiom the image reuses. Two of those are arms of the SAME inline jump table at 0x0F29 -- 0x330B at arm 8 and this address at arm 11 -- so a delay name could not tell even that table's routines apart. What is left once the prologue is subtracted is the single tail this entry chooses, and passTurnToOtherPlayerIfLivesElseStepSequence's own entry already carries that decision",
  },
  0x1748: {
    name: "holdCopyrightThenEraseTheCoinInvitation",
    role: "hold one sequence step for as long as its delay cell counts, restamping the copyright strip and flashing its line on every frame of the wait, and on the frame the delay expires queue two erase requests -- caption records 3 and 4, whose glyph runs read PLEASE DEPOSIT COIN and AND TRY THIS GAME -- then step the sequence on. A cell holding zero on arrival wraps to 255 and waits the long way round rather than leaving at once. ★ The expiry frame also does the load-bearing thing the name drops: it copies the glyph showing at 0xA63C and the colour of the same cell into the pair at 0xACC7, and that pair is a COPYRIGHT TAMPER WITNESS rather than a screen save. 0xA63C is the fifth cell of the `(c) KONAMI 1982` caption -- the N, glyph 0x3B -- and the arm at 0x30E3 reads the pair back, tests the glyph against 0x3B and the colour against 0x05 or 0x10, and derails to 0x315B on anything else",
    cert: "seen",
    why: "both halves of the name are refutable off the image and both hold. The erase half: the two requests carry command 3, which the ring's sixteen-way handler table at 0x0BBC seats at eraseTextRunByIndex, with arguments 3 and 4, and records 3 and 4 of the caption table at 0x0C50 hold the glyph runs the tile ROM draws as PLEASE DEPOSIT COIN and AND TRY THIS GAME -- so what is erased is the invitation, not the copyright this same routine has spent the wait restamping. The witness half: the caption record at 0x086B puts the copyright line's first cell at 0xA6BC and the cursor rst steps 0x20 BACK per cell, so the record's fifth glyph lands at 0xA63C, and that glyph is 0x3B, which the tile ROM draws as an N. The same arithmetic puts the A at 0xA61C, the cell sampleCellGlyphAndColour's entry already records as sampled every frame with a colour alternating 0x05 and 0x10 -- which are exactly the two values 0x30E3's arm accepts. So a tampered credit moves the glyph, the witness carries the move, and the check derails the sequence instead of failing cleanly, which is this ROM's standing idiom",
  },
  0x1f42: {
    name: "scrollWorldAtTheEraPace",
    role: "move the world past the ship at the pace the era sets, READING the heading rather than deciding it -- some paths in write it first, others arrive with whatever is already there: one of three fixed sample tables is picked from ERA_INDEX alone -- the opening era its own, the next two sharing a second, everything from the third era up sharing a third -- and the pair that table gives for the ship's heading is handed on to be negated into the world scroll cells. Choosing the table is the whole of what this entry decides",
    cert: "seen",
    why: "'pace' is the claim, and the three tables could have differed in shape rather than size and killed it. Read out of the image they are the same 256-sample turn at three amplitudes -- 256, 306 and 331 -- so the era buys speed and nothing else; a table that turned at a different rate, or a fourth read, would have shown here. That the pair becomes the WORLD's motion and not the ship's is fixed by the continuation rather than by this body: negateVelocityIntoWorldScrollThenDressSprite negates both components into the scroll cells before dressing the ship, which is what makes 'scrollWorld' true and 'flyShip' false. ERA_INDEX is the only cell this entry reads",
  },
  0x28a1: {
    name: "stepSevenCraftSlots",
    role: "work seven fixed object slots in one fixed order, each through the entry that seats its own pair of cursors; the order is the whole of what this entry decides, and nothing here reads or writes a slot itself. ★ Seven is the SET's size and not the per-frame count: the last two slots stand down while MOTHER_SHIP_ARMED is set, so on that arm only FIVE slots step",
    cert: "seen",
    why: "the five-slot arm is qualified rather than observed: on the coin-then-start and undriven demo tapes MOTHER_SHIP_ARMED read zero at every dispatch, so the observed evidence covers the seven-slot arm only. Which two stand down is fixed from the far side: seatMotherShipSlotThenDispatchByEraUnlessArmed and seatCraftSlot6ThenDispatchByEraUnlessArmed are the two gated entries, and their own entries record that a set cell returns at once and leaves the slot unserviced, while destroyCraftAndMotherShipHitByShots's entry derives independently that the Mother-Ship holds the last two of the seven ordinary craft slots. A name saying 'step five' would be false on every frame the tapes run",
  },
  0x2cdb: {
    name: "blankOneLineThenGuardBlockOrDerailSequence",
    role: "one turn of the line wipe, and on the turn that finishes it, one tamper test: a single line is blanked per turn and the turn ends there while lines are still owed; the turn that clears the last one folds a fixed 1024-byte span of the program image together with exclusive-or into an eight-bit total and compares it against the total an untampered image gives. Matching steps the sequence's INNER index, so the sequence carries on; not matching steps the OUTER phase instead, restarting the inner index somewhere else entirely -- derailing the sequence rather than halting it",
    cert: "seen",
    why: "the compound name is the finding. The second half is the family guardBlockOrDerailSequence at 0x3252 belongs to, and the two bodies are the same test: an exclusive-or fold of a fixed span against a baked-in constant, advanceSequenceSubStep on a match and advanceSequencePhase on a mismatch, each reached as a tail and never both. Only the span differs -- 768 bytes from 0x0008 there against 1024 bytes from 0x4980 here -- so a name for this one that did not carry the family's would leave two identical mechanisms with unrelated names. The first half is what the family name would drop: the wipe gate sits in FRONT and the test runs on one turn in many, so a reader taking this for a plain guard will expect it every dispatch",
  },
  0x2d3f: {
    name: "showCreditLine",
    role: "one sequence step that puts the credit line up: while FREE_PLAY is set it does nothing but move the sequence's inner index on; otherwise it repaints the panel field from the packed-decimal credit count at 0xA986, queues caption record 8 -- whose glyph run reads CREDIT -- and then reads a guard byte that decides everything after. Anything but zero transfers to 0x2E3E, which carries no routine, so that transfer RAISES rather than running; zero stamps the copyright strip into the display list, asks for its line in this frame's colour, and folds the twenty-byte run at 0x086B into a total for the chain that judges it. What writes the guard byte is not established here",
    cert: "seen",
    why: "'credit' is fixed twice over from outside this body. The caption: record 8 of the table at 0x0C50 holds the glyph run 0x77 0xD7 0x34 0x87 0xFD 0xDC, which the tile ROM draws as C R E D I T. The count: the cell it repaints through paintCreditCountPanel is 0xA986, the same packed-decimal byte startOnePlayerGame takes one off at the one-player start and startTwoPlayerGame takes two off at the two-player one -- and startGameOnFreePlay's entry already records that free play charges nothing, which is exactly the arm this entry paints nothing on. The derail target is checkable rather than merely absent: 0x2E3E is the amplitude-306 sample table scrollWorldAtTheEraPace hands to velocityForHeading for the middle eras, so the tamper arm enters a sine table as code",
  },
  0x3215: {
    name: "startOnePlayerGame",
    role: "stock the machine for a game with only the FIRST player's context filled in: park the caption sprites, raise PLAY_ACTIVE, clear PLAYER_TWO_LIVES and the flag beside PLAY_ACTIVE, load PLAYER_ONE_LIVES from the settings cell carrying the starting count, TAKE ONE CREDIT off the packed-decimal count at 0xA986 and repaint the panel field from it, copy a fixed set of tilemap cells into their keeps, and send the sequence machine to its last phase. The subtract is decimal-corrected the way the hardware does it, so a byte that was never valid packed decimal still lands where the hardware would put it",
    cert: "seen",
    why: "the CHARGE is the only axis separating this from startGameOnFreePlay's one-player arm at 0x1719, so a name saying merely 'start a one-player game' would name both. The two are the same seven stores in the same order -- xor a, ld (0xAD31),a, ld (0xAD20),a, dec a, ld (0xAD30),a, ld a,(0xA9C1), ld (0xAD10),a -- at 0x3219 and at 0x1719, and both then transfer to 0x172A; this entry alone puts `ld hl,0xA986 / ld a,(hl) / sub 1 / daa / ld (hl),a` and a repaint between them. startTwoPlayerGame is that same insert with 2 for the two-player start, and startGameOnFreePlay's entry records that all three of its callers test the free-play cell before reaching it -- which is why the free arm has no debit to be told apart by",
  },
  0x382d: {
    name: "pickScriptAtRandomOrInTurn",
    role: "draw a byte and let one comparison against a threshold cell decide which of two entirely different answers the caller gets: a draw at or above the threshold is folded down to one of four values and handed straight back, writing nothing; a draw below it ignores the drawn byte completely and instead steps a five-long cycle counter on, wrapping it to zero once it would leave the cycle, stores it and hands THAT back. ★ The two arms draw from DISJOINT halves rather than sampling one pool two ways: the random arm can only answer 5 through 8, the rotation only 0 through 4, so which arm ran is recoverable from the answer alone",
    cert: "seen",
    why: "the disjointness is structural: the random arm returns the drawn byte modulo four plus five and the rotation arm returns a counter reset the moment it would reach five, so the two ranges cannot meet whatever the threshold cell holds. 'Script' is the callers' word and it is checkable at one remove: both store the answer at a freshly-seated object's +0x0A, and stepShapeAnimation (0x323A) reads that byte as an index into the word table at 0x3438, fetches the run it points at and takes that run's C'th byte -- C being a counter it steps down each pass -- into the object's +0x08. So the answer selects a sequence that is then walked, which makes it a script rather than a speed or a coordinate; one of the two callers biases it by nine first, so the two spawn sites draw from different stretches of the same table. On the coin-then-start and undriven demo tapes every value 0 through 8 came up, so neither arm is dead code",
  },
  0x4117: {
    name: "chaseOneAimPointAndRetireAtTheLine",
    role: "run one object through a whole frame of chasing: re-aim it, turn it, move it, dress its sprite, and retire it once it has drifted onto a retire line. Re-aiming is RATIONED rather than done every frame -- the object carries a phase byte and the aim is recomputed only on the frames whose low four bits match it, which spreads a crowd across sixteen frames and leaves each object a stale aim in between; a phase byte above 15 can never match FRAME_TICK's low four bits at all, so such an object is never re-aimed. ★ The point is neither the only one nor a constant: it is one of SIX two-byte points packed at 0xAC74-0xAC7F, and those twelve bytes are rewritten as a block. The turn, the move and the dressing run every frame regardless, and the counter pair the caller holds is put back before the retire test",
    cert: "seen",
    why: "'one aim point' says the choice belongs to this entry and not to the mechanism, and the sibling shows the choice is real: 0x41B8 has the same shape and aims at 0xAC75 and 0xAC79 out of the same twelve-byte block, while this entry takes 0xAC7F, whose partner byte headingToward reads one below it. The point is not fixed either: layOutEnemyAimPointsFromScrollAngle writes all twelve of those bytes through IX-indexed stores off 0xAC64, offsets 0x10 through 0x1B with no branch between them, from a value it recomputes each pass, and on the undriven demo tape the block's contents change as the game runs. The retire half is fixed outside as well: hasReachedRetireLine's entry describes its test as what makes its caller free the slot, and retireSlot is that freeing",
  },
  0x44c9: {
    name: "restartAnimationCounterThenDressFlutterSprite",
    role: "close out one object's animation and dress its sprite entry: the counter the caller carries is read without the top bit that selected this path, and once what is left has reached three the counter cell in the object's record is put back to zero -- below three it is left alone. Either way both attribute slots of the sprite entry take the one code fixed here, and the two shape codes are then chosen by the flutter this entry hands on to",
    cert: "seen",
    why: "an English name that said what the animation IS would overclaim: what the object ends up looking like is settled a routine further on (dressSpriteFlutterShapesByFrameTickBit), the counter it may clear is an offset in a record whose owner it never reads, and the top bit it masks away was set by the caller that chose this path. So the name takes only the MECHANISM this body performs -- restart the record counter once what is left reaches three, write the one attribute code into the two fixed slots, hand the shapes on -- and says what the entry DOES here, not what the animation downstream means",
  },
  0x4b67: {
    name: "seedRandomRegister",
    role: "copy a fixed seventeen-byte run of program space at 0x4B84 into the random register block, then check the image that run came out of: three bytes taken from two fixed words of program space are added to one constant, and any total but zero means the program space being read is not the one the constant was picked for -- on that outcome control transfers to 0x6000, outside the image, so it raises rather than running. ★ The copy is unconditional and COMPLETE before the check runs, so nothing this entry wrote is gated by it",
    cert: "seen",
    why: "the image refuses two readings. It is NOT seeding under a checksum of the seed: the guard's operands are `ld ix,(0x086D)` and `ld hl,(0x0870)`, and 0x086D-0x0871 is the middle of the copyright caption's record -- the record's colour byte 0x10, the (c) glyph 0x30 and the K glyph 0x7C -- which with the routine's own 0x44 come to zero exactly; the block at 0x4B84 is not read by the guard at all, and the copy has finished when the guard runs, so a tampered credit line raises AFTER the register has been seeded. It is also NOT seeded once: two CALLs reach this address, at 0x251B inside initColdStartRamThenSeedConfig and at 0x2852 inside loc_27B1, and the entry runs more than once in undriven attract, so a reader who takes the register as fixed from boot will be wrong",
  },
  0x4f35: {
    name: "dispatchShotSweepByMotherShipArmed",
    role: "choose between the round's two shot sweeps and, on one of the two arms only, stage the full seven-target run: while MOTHER_SHIP_ARMED is set the sweep that also covers the standing object runs instead, and that sweep stages its own runs, so this entry gives it nothing but the branch; while the cell is clear the two cursor cells the shared sweep reloads between passes are staged here first, so every pass restarts on the run chosen here, and the shared sweep then runs six shots against seven targets inside one box. Both counts handed over are seven, so the first pass is no shorter than the rest",
    cert: "seen",
    why: "no verb is true of BOTH arms -- one arm is pure staging with a tail, the other a bare branch into a sweep that stages everything itself -- so the name takes the one thing true of both, the DISPATCH on MOTHER_SHIP_ARMED. That cell is the same one destroyCraftAndMotherShipHitByShots's entry describes from the far side. Neither the coin-then-start nor the undriven demo tape reaches the armed arm: the cell read zero at every dispatch",
  },
  0x5286: {
    name: "drainBothDeferredCellLists",
    role: "one pass of the deferred cell machinery: blank the cells the erase list names, paint the cells the pending list names, then copy the pending list wholesale onto the erase list and park the pending cursor back on its own first entry. The copy length is the pending cursor's own byte, cursor included, so it lands the pending count on top of the erase cursor and the line after replaces that with the same count plus a mark in the top bit; where nothing is pending both cursors are parked instead and no copy happens; and a cursor of ZERO is not nothing pending -- the count is a block-copy length, and a length of zero means the whole address space. ★ NOT a double buffer: the copy runs one way, 0xAE00 onto 0xAE80, on every pass, and the two lists hold different jobs rather than alternating ones",
    cert: "seen",
    why: "the double-buffer reading is the one this name has to refuse, and the asymmetry of the two drains refuses it. blankCellsPaintedLastPass walks the 0xAE80 list and writes only the character plane, putting the blank shape in and leaving every colour cell as it was; paintDeferredCells walks the 0xAE00 list and writes both planes, shape and colour, with a shared tint bias; their walks even start at different offsets, 0xAE84 against 0xAE04. The copy this entry makes always runs from 0xAE00 onto 0xAE80 and never back, and it is a wholesale block copy rather than an append. So the lists cannot exchange roles the way a double buffer's do: one is a list of edits to make, the other a record of last pass's edits to take back",
  },
  0x55d4: {
    name: "sendOldestQueuedSoundCommand",
    role: "send the byte at the head of the pending-sound queue, then close the gap it left: a count cell at 0xAC43 says how many bytes are waiting and the bytes follow it from 0xAC44, and a count of zero is left untouched with nothing going out. Otherwise the count comes down by one, the head byte goes out, and every byte still waiting slides one place down so the head slot always holds the next one. The send happens whether or not anything is left to slide, so emptying the queue costs no slide; and nothing bounds the count, so a large one slides bytes in from past the queue's own cells",
    cert: "seen",
    why: "'oldest' is the FIFO claim and the producer is what could have refuted it: appendSoundCommandToQueue bumps the count at 0xAC43 and stores the new byte at 0xAC43 plus the bumped count -- the TAIL -- while this entry takes 0xAC44, the head. Opposite ends, so the byte that goes out is the one that has waited longest, and a stack would have put both at the same end and needed no slide at all. That the byte reaches the audio processor rather than sitting in RAM is sendSoundCommand's claim and its own entry already carries it, which is why this name says 'send' and not 'latch'",
  },
  0x598e: {
    name: "loc_598e",
    role: "hand back the doubled component pair an object's OWN heading calls for, at the pace the first of the three fixed tables of samples sets; the heading comes off the record and any pointer the caller was holding is discarded, so choosing that table is all this entry adds",
    cert: "seen",
    why: "kept hex, and the family is the reason: five siblings of exactly this shape are kept hex -- 0x58B6, 0x599D, 0x59C5, 0x59CB and 0x59D1 -- each a two-instruction shim differing from the next only in the table immediate or in where the heading comes from. An English name here would have to say what the pace MEANS, which class of object moves at it, and nothing reachable from a shim decides that; naming one member and leaving five hex would claim a distinction the bodies do not carry",
  },
  0x5994: {
    name: "loc_5994",
    role: "hand back the doubled component pair an object's OWN heading calls for, at the pace the second of the three fixed tables of samples sets; the heading comes off the record and any pointer the caller was holding is discarded, so choosing that table is all this entry adds -- it is loc_598e with the other table immediate",
    cert: "seen",
    why: "kept hex for the same reason as loc_598e, which it is byte-for-byte apart from the table address: the same five siblings of this shape are hex, and the only fact an English name could add here is what the pace means, which no shim settles",
  },
  0x0000: {
    name: "trampolineToSeatTheStackAndSettleTheControlLatch",
    role: "a bare transfer to 0x07B1 and no return; no cell is read or written and no register moves",
    cert: "seen",
    why: "named by its transfer target under the trampolineTo convention: the three bytes `c3 b1 07` are a bare `jp 0x07B1` whose entire content is the jump to seatTheStackAndSettleTheControlLatch, so the name claims nothing beyond the jump. A RESET-flavoured name would be wrong: reset is a property of the Z80 and the board wiring, not of these three bytes. Its counterpart at 0x4BD9 (`c3 ae 08`) is trampolineToSelectFoldBlock; the two transfer to different routines, so naming both asserts no false distinction",
  },
  0x00d8: {
    name: "saveAccumulatorForFrameInterrupt",
    role: "one byte, `push af`, falling into the register-save prologue at 0x00D9 that owns the rest of the frame service and the frame's work; the two bytes it stacks land in work RAM, so they are part of what the machine leaves behind",
    cert: "seen",
    why: "named for the one thing this entry does that 0x00D9 does not -- the `push af` that opens the register save 0x00D9 continues -- and deliberately not 'enter the frame interrupt', which would put the frame service's identity on the one byte that is not the service. Three code-shaped arrivals reach it: `c3 d8 00` at 0x0066, the NMI vector, and `c4 d8 00` at 0x00A2 and at 0x49D0; `21 d8 00` at 0x0098 is a `ld hl` that seeds a checksum, and the other occurrences of the word -- 0x0940, 0x0AB2, 0x5C16 and 0x5DE8 -- follow a 0x00 byte rather than a transfer opcode. The stack balances at the `call nz` arrivals: 0x00D9 pushes nine words on top of this one's, 0x0174 pops those ten in mirror order, and the call's return address sits where the NMI's pushed program counter would. Both guarding sums pass on the shipped image -- sum(0x00D8,256) = 0x87 against the `sub 0x87` at 0x00A0 and sum(0x27DE,256) = 0xC5 against the `sub 0xc5` at 0x49CE -- so on a patched image those two sites run one whole frame service out of band and return from it normally: corruption, not a crash",
  },
  0x019a: {
    name: "armWholePlaneWipeThenDerailOnATamperedImage",
    role: "seat the character-plane wipe on the plane's very first cell and put a whole plane's worth of lines against the counter beside it, so the next pass starts at the top with everything still to do; then fold a fixed 240-byte run of the program image into one eight-bit total and, on anything but the total a genuine image gives, transfer into bytes that carry no routine. ★ The wipe is armed EITHER WAY -- the fold gates nothing above it, and the run it folds lies elsewhere in the image and has nothing to do with the wipe -- so a reader who takes this for a guarded arm will be wrong on every dispatch",
    cert: "seen",
    why: "'whole plane' and 'derail' are the two claims. Whole plane is exact rather than approximate: BLANK_LINE_CURSOR is seated at 0xA400 and BLANK_LINES_LEFT at 32, and blankNextLine walks a line in steps of 32 while advancing that cursor by ONE, so 32 lines of 32 cells is the whole 0xA400-0xA7FF plane and the count is an exact fit rather than an estimate. Derail: the mismatch arm is `call nz,0x0167`, and 0x0167 is not a routine -- it is CAPTION RECORD 9, whose pointer sits at 0x0C62 in the record table at 0x0C50, and which reads destination 0xA66F, colour 0x14 and nine glyphs before the 0xB9 terminator at 0x0173, the byte immediately before the interrupt epilogue, which is WHY executing it falls into 0x0174. Its two `pop af` consume the two return addresses the `call 0x019a` and the `call nz` pushed but NOT the arm-return word the frame service pushed at 0x0158, so the epilogue then unwinds one word out of step and returns to a saved register value: control destroyed rather than reported. The separation the name relies on is checked rather than assumed -- the folded run is 0x4BA5-0x4C94, which opens `ld hl,0x4bb1 / ld de,0xab08 / ld bc,0x0028 / ldir / ret` and contains neither the wipe machinery nor either armed cell -- and sum(0x4BA5,0xF0) recomputes to 0x11 exactly, matching the `sub 0x11`, so a genuine image passes by construction",
  },
  0x01e1: {
    name: "armThePenRouteThenColdStartOnATamperedImage",
    role: "put the cell-stamping pen back at the start of its route -- leg index to zero and both coordinates to the route's first point, each written a word at a time so the whole-cell part and the fraction below it land together, and each lifted out of a fixed pair of program bytes rather than carried as a literal -- then fold a fixed 256-byte run of the image into one eight-bit total and, on anything but the total a genuine image gives, transfer into the cold start, which clears the work RAM the stack sits on and never comes back here. The arming is unconditional: the fold gates nothing above it",
    cert: "seen",
    why: "'the route's first point' is exact and it is the claim that could have failed: the word at ROM 0x0D45 is 0x1000 and the word at 0x280C is 0x0400, giving row 0x10 and column 0x04, and entry zero of the leg table at 0x0290 is `10 04` -- the identical point. The pen is a real stamping cursor rather than an inferred one: drawInterpolatedPenRun treats 0xA9E3 and 0xA9E5 as fixed-point pairs, interpolates toward a target and calls plotPenCell each step off the whole-cell halves of those two pairs, then does `inc (0xa9e2)` and indexes the leg table with the result -- so 0xA9E2 is a leg index and the two pairs below it are the cursor plotPenCell is aimed with. 'Pen' is house vocabulary and not a coinage: plotPenCell's own entry already names the two cells it stamps from, and 0xAD0C is the one drawCaptionInPenColour calls the pen colour. sum(0x0E33,0x100) recomputes to 0xFD exactly, matching the `sub 0xfd`, and the checked run holds neither seed word nor the leg table; 0x0069 clears 0xB411, 0xB410 and 0xA800-0xAFFF by `ldir` and ends `jp 0x5866`, so 'cold start' is not too strong. ★ The name refuses to say WHAT the pen draws, and the image is why: three operand-visible `call 0x01e1` sites exist, at 0x076A, 0x3333 and 0x3396, and TWO of them set the stamp glyph to 0xF1, the blanking glyph, immediately beforehand (`ld a,0xf1 / ld (0xad0b),a` at 0x0765 and at 0x332E), so on those paths the trace ERASES rather than draws, and the third sets neither cell. 'Route' rather than 'line' is deliberate for a second reason: the leg table reads `10 04 11 04 … 1c 04 1d 04` and then TURNS, `1d 05 1d 06 1d 07 …`, so it is an L -- rows down one column, then columns across one row",
  },
  0x07ad: {
    name: "parkTheImageTotalForTheTamperVerdict",
    role: "park the eight-bit total the image fold arrives with into B, where the helper the verdict arm calls hands it back to A after its own address arithmetic has clobbered A; then hand on by jump, so the verdict's own exits carry this entry too. Nothing is read or written and no flag moves",
    cert: "seen",
    why: "named rather than kept hex because three of the four links in its chain are named: sumImageBlockForTheTamperCheck (0x43E8) -> this entry -> advanceSequenceUnlessImageTampered (0x5303) -> presentChecksumForTamperTest (0x200C). 0x43E8 (`xor a / add a,(hl) / inc hl / djnz / jp 0x07ad`) and 0x200C (`add hl,de / rst 0x18 / ld a,b / ret`) are each as register-generic as `ld b,a / jp`, and both are named off this chain. The register move has a derivable purpose: 0x5303's `call 0x200c` runs `add hl,de` and `rst 0x18`, both of which clobber A, and 0x200C's last act `ld a,b` hands the total back for the `cp 0x67` at 0x5306. Unlike loc_598e and loc_5994, which are interchangeable members of a family of shims, this entry has no siblings and the chain either side of it decides its meaning. A scan of the whole 24 KB for the little-endian word 0x07AD, at every alignment, finds two occurrences -- the operand of the `jp 0x07ad` at 0x43ED, and an accidental pair at 0x1A9C straddling the operand of `ld a,(0xad04)` and the `rlca` after it. Operand scan only, with no write or dispatch tap, so no exclusivity is claimed",
  },
  0x07b1: {
    name: "seatTheStackAndSettleTheControlLatch",
    role: "power-on: probe the expansion socket and give the machine away to it if a board answers there, otherwise seat the stack at the top of work RAM, kick the watchdog, drive the four control lines the latch's first eight addresses carry low, raise the video-enable line from a byte of the program image, and hand on to the cold start. No work memory is touched -- the whole effect is the seated stack and the latched lines. ★ Latch bits 5, 6 and 7 are NEVER WRITTEN here: the walk stops at 0xC307 and the only other store is to 0xC308, so 'settle the control latch' is five of its eight lines and not all eight",
    cert: "seen",
    why: "how many lines the walk settles is where this name could have been wrong, and the board layer decides it rather than the ROM. boards/timeplt/memory.js routes a write in 0xC300-0xC30F as writeControlLatch((addr - 0xc300) >> 1, value & 1) and hardware.json records the same -- TWO ADDRESSES PER BIT -- so the eight-address walk over 0xC300-0xC307 settles bits 0, 1, 2 and 3, each written twice: four lines, not eight. 0xC308 is bit 4, which io.js exports as LATCH_VIDEO_ENABLE and reads back as videoEnabled, so it is a fifth line and not a ninth; memory.js carries a standing comment against the `& 7` misreading that would make the walk eight lines. ROM[0x2D4B] = 0x01, so the picture is enabled out of an image byte rather than a literal and patching that byte leaves the machine dark. The definite article is earned: there is exactly one LS259 on this board. ★ What the name deliberately does not claim is the expansion branch -- on a stock board 0x6000 is unmapped and the `cp 0x55` should never match, but the float was not measured here, so the role calls it a probe and stops there",
  },
  0x15e2: {
    name: "startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase",
    role: "the first arm of the sequence machine's outer phase zero: arm the whole-plane wipe, then hand the inner index the step that actually runs that wipe, then subtract a 256-byte block of the program image from the outer phase and exclusive-or a fixed key into the difference. Neither number lands as an immediate -- the inner index is read out of a program byte that is the low half of an address inside an instruction, and the phase is never assigned, only folded -- so it is a tamper test that CORRUPTS the sequence rather than refusing to run. ★ The dispatch that reaches it masks with `and 0x03`, so arrival proves only that the phase is congruent to zero modulo four, which is less than it looks like: 0x04, 0x08 and 0x0C are not fixed points of the fold. That the phase is left standing rests on SEQUENCE_PHASE's own recorded range of four values and not on anything this arrival establishes",
    cert: "seen",
    why: "'start' is the weakest word in the name and it survives, because the scheduling store is this entry's own: armWholePlaneWipeThenDerailOnATamperedImage only ARMS -- its own name says so -- and this entry arms and then picks the step that consumes what was armed. Read end to end off the image: the frame service's phase table at 0x015F is `15c2 1651 17fe 0f1f`, so phase 0 goes to 0x15C2; 0x15C2 is `ld a,(0xa9ac) / and 0x07 / rst 0x30` with an inline word table at 0x15C8 whose entry 0 is this address; ROM[0x1749] = 0x06 and 0x1748 is `cd 06 0b`, so the index really is the low half of a call operand; and entry 6 of that same table is 0x15FE, which opens `call 0x01c2 / ret nz` -- blankNextLine, the step that runs the wipe. The fold recomputed here: sum(0x5648,256) = 0xB2 and the key is 0x4E, so the phase becomes ((phase - 0xB2) & 0xFF) ^ 0x4E, whose fixed points are the sixteen values of 256 that share no bit with 0x4E -- 0 and 1 among them, 2 and 3 not. ★ A reader who assumes eight live arms in the 0x15C8 table will be wrong six times: only entries 0 and 6 are arms, and the bytes from 0x15D6 are CAPTION RECORD 5 -- destination 0xA660, colour 0x14, eight glyphs and a 0xB9 terminator at 0x15E1, the byte immediately before this entry. Parking caption text where a table or a trap points is this ROM's standing idiom",
  },
  0x19da: {
    name: "checkTheCopyrightLineColoursOrDerail",
    role: "walk the thirteen colour cells under the copyright line and derail on the first one that has been changed: starting at 0xA2BC and stepping back 32 a cell, every cell must hold one of exactly two colours, and the first that holds anything else transfers into bytes that carry no routine and never come back. ★ The two accepted colours are the COLOUR BYTES OF THE LINE'S TWO RECORDS, which differ in nothing else -- 0x10 in the record at 0x086B and 0x05 in the record at 0x4900, both carrying destination 0xA6BC and the same thirteen glyphs -- so the pair is what the line's own flashing writes, and not a wipe colour beside a pen colour. Thirteen good cells return having done nothing",
    cert: "seen",
    why: "the identification is arithmetic and it is a strict coincidence test with no slack in it. The copyright line's record is reached through the table at 0x0C50, whose first word is 0x086B; that record's destination is 0xA6BC and it holds thirteen glyphs before drawTextRun's 0xB9 terminator, and advanceCharCursor steps the cursor by -32 a cell, so the line's character cells are 0xA6BC, 0xA69C … 0xA53C and their colour twins (& ~0x0400) are 0xA2BC, 0xA29C … 0xA13C. The two lists agree: same start, same stride, same direction, same count of thirteen. The line is TWO records and not one, which is what makes 'record zero' under-determined and the colour pair explicable: record 31, pointer 0x4900, carries the same destination and the same thirteen glyphs `30 f1 7c 68 3b a5 38 fd f1 96 5d 17 9b`, and differs from record 0 in exactly one byte, the colour. drawCaptionInPenColour masks its colour with `& 0x0F` and so could never write 0x10 at all, which rules the pen out as the source of the second value. 'Derail': 0x49FA is CAPTION RECORD 4 -- pointer at 0x0C58, destination 0xA6EE, colour 0x14, seventeen glyphs and a 0xB9 terminator at 0x4A0E -- so what the transfer enters is text, and the offending colour, the cell it came from and the count still owed are DEBRIS those bytes happen to consume rather than an argument to anything. Two static call sites reach this entry, `call 0x19da` at 0x176A and at 0x1797, so no role here may say 'the caller'",
  },
  0x1f3e: {
    name: "snapHeadingOntoTheTurnTarget",
    role: "end a turn by writing the heading the turn was steering toward straight into the player's heading cell, then fall into the world scroll every arm of the turn reaches; the target arrives in a register and nothing is read, so the whole of the entry is that one store",
    cert: "seen",
    why: "'snap' is the claim, and the two sibling arms settle it without leaving the enclosing routine: 0x1F68 is `sub d / add a,b / ld (0xa802),a` and 0x1F6F is `add a,d / add a,b / ld (0xa802),a`, the live heading stepped by D, which is 3 or 4 off ERA_INDEX's low nibble -- those arms STEP, and this one writes the target itself. A store of the target in place of a step is a snap. B holds the target from 0x1F05, where it is loaded from the direction table at 0x1F2E, to this entry: no opcode in between writes B. The arrival condition is arithmetic: C is live minus target, the entry is taken on C + 1 < 3 so C is 0xFF, 0x00 or 0x01, and C == 0 has already left at the `jp z,0x1f42` -- so the two live values are one step either side. ★ No transfer targets this address: turnShipTowardTargetHeading runs these two instructions inline, and a reachability check over three tapes, with turnShipTowardTargetHeading and scrollWorldAtTheEraPace as positive controls, counts no dispatch here. The name omits the world scroll because scrollWorldAtTheEraPace is a tail several arms of the turn reach, and naming the fall-through would name the shared tail rather than this arm",
  },
  0x2bba: {
    name: "countTheKillAndGrantTheSharedToken",
    role: "the tick a hit object's death begins: ask for the pair of death sounds and take one off the round's kill quota -- both UNCONDITIONAL -- and then, only past three guards, grant this record the single-holder token at 0xA821, its own slot ordinal marked with a top bit. The guards are the record's cooldown byte carrying its top bit, the shared arming cell being set, and the shared countdown beside it reaching zero on this step; the countdown is spent whenever the first two pass, so every claimant spends a tick and not only the one that wins. The quota is floored rather than wrapped -- a count already at zero is left alone",
    cert: "seen",
    why: "the trade the name makes is clean rather than lopsided: 'countTheKill' carries the quota decrement, 0xAD02 being KILLS_REMAINING, and the only act dropped is the sound request, which the role carries. 0x5683 is requestTwoSounds and enqueueSoundIfGameOrAttract drops a request unless 0xAD30 or 0xA9C6 is set, so 'ask for' is right where 'play' would be wrong. The two shared cells are sized together by the spawner rather than guessed at: 0x36AF's wave spawn zeroes 0xA811, counts filled slots into it, then writes 0xE4 to 0xA812 and re-stamps 0xA811 from 0xACC1, the round's craft count. What the token BUYS is not claimed here: driveObjectAppearanceByPhaseBand is the consumer, and freeAndNumberEveryObjectSlot's entry already records the writer and the reader agreeing that the record's sixteenth byte is a slot identity. ★ 'The tick a death begins' holds for the REACHABLE callers only. Three static call sites exist -- `call z,0x2bba` at 0x2B9D and `call 0x2bba` at 0x2BB0, both inside stepDyingObjectState and both leaving the state byte at 0x3B (the 0x3C path decrements it at 0x2BB4, the other path stores it at 0x2BAC), and `call 0x2bba` at 0x2A38, which sits after `ld (ix+0x00),0xff` and so calls with the object left ALIVE. That third site is DEAD: no absolute reference and no relative branch lands on the block 0x2A2A-0x2A3B, its single little-endian hit at 0x196F straddles a `jr nz` displacement and the `ld hl,(0xa993)` after it, the instruction before it at 0x2A28 is an unconditional `jr`. Shown live, it would widen the role from 'death begins' to 'an object has been hit'",
  },
  0x2e19: {
    name: "unpackTheFirstThreeSwitchSettings",
    role: "open the settings block: store, whole, the byte the caller has already worked out from the switch port's low two bits, then peel the next two switch bits into a cell each, one bit per cell and nothing else in it, and hand the byte on rotated so the last bit spent sits lowest -- twice over, in both registers that carry it -- to the continuation that peels the rest. Nothing is read from memory and control never comes back. ★ 'Switch settings' is established at the CALLER and at the three cells' readers, not inside a routine that reads no memory at all: the caller at 0x52C0-0x52CF is `ld a,(0xc200) / cpl / ld c,a / and 0x03 / add a,0x03 / cp 0x06 / jr nz,+2 / ld a,0xff / jp 0x2e19`, so C arrives as the complemented DSW port and A as 3, 4, 5 or the folded 0xFF",
    cert: "seen",
    why: "'first three' is a boundary rather than a guess, because the byte is fully accounted for across this entry and its continuation: here the port's low two bits (already folded into a count by the caller) go whole into 0xA9C1, bit 2 into 0xA9C2 and bit 3 into 0xA9C3, and 0x49A8 then takes bits 4-6 into 0xA9C4 -- DIFFICULTY_SETTING, whose own entry calls a cell three bits wide that the boot-time DIP unpack fills -- and bit 7 into 0xA9C6, which enqueueSoundIfGameOrAttract reads as its second sound permission. All three destinations are READ AS SETTINGS elsewhere in the image, which is what makes 'settings' a claim: 0xA9C1 is the cell startOnePlayerGame's role already calls the settings cell carrying the starting count; 0xA9C3 is read at 0x4DE3, where `and 0x01` picks between the bonus-mark tables at 0x4E1B and 0x4E30, exactly as the extra-life entry records; and 0xA9C2 -- the weakest leg -- is read at 0x00FD, where a zero forces 0xA987 and that byte is then written to 0xC302, an LS259 line, which is the cabinet switch. A scan of the whole 24 KB for the little-endian word 0x2E19, at every alignment, finds one occurrence, the operand of the `jp 0x2e19` at 0x52CF; that is an operand scan, so an indexed or computed arrival would be invisible to it and no exclusivity is claimed. ★ 'Switch settings' was chosen over 'DIP' to match the existing 'the settings byte at 0xA9C3', and over 'cabinet settings' because one of these bits IS the cabinet position and that phrase would read as a category and one of its members at once",
  },
  0x3793: {
    name: "loc_3793",
    role: "seat the record cursor and the sprite-entry cursor on the highest of five consecutive object slots, set the turn count to five, and transfer into the body that fills the first free one; all three are constants chosen here, nothing is read and nothing is written, and control does not come back",
    cert: "seen",
    why: "kept hex because the image has no entry point here for an English name to be about: a scan of the whole 24 KB for the little-endian word 0x3793, at every alignment, finds none, so no table can name it and nothing absolute reaches it; the one transfer that lands here is a RELATIVE `jr z` at 0x37C8, interior to another routine's body. What the body does is a stretch of that routine's job rather than one of its own: 0x37BD decides, and this block stages one arm of that decision while the other arm stages inline at 0x37CA. runSceneryForEra has the same seat-two-cursors-and-transfer shape under an English name, but it CHOOSES between three lists; this block chooses nothing. spawnEnemyCraftWhenBandUnderTwo transfers here when KILLS_REMAINING is zero",
  },
  0x37bd: {
    name: "gateTheFreeSlotSearchAndPickItsRun",
    role: "decide whether this is a spawning tick and, if it is, choose which run of object slots the free-slot search walks: the caller points at a counter cell and only two of its values open the gate, every other value ending the entry with nothing staged; past the gate the count of kills still owed picks between two runs of the one slot file -- while any are owed the run starts two records higher and is as long as the round's craft count asks, and once none are owed a fixed run of five starts lower -- and control leaves for the search without coming back. The role names no address for the gate byte on purpose: it is read through a pointer, so the routine itself cannot know what it is",
    cert: "seen",
    why: "the gate opens on exactly 0x00 and 0x30, and the counter is PACKED DECIMAL, which is what turns two arbitrary bytes into two moments of a cycle: HL is set to 0xAD05 at 0x36BC and the four instructions before the `jp c,0x37bd` at 0x36C9 -- `ld a,(0xad06)`, `and 0x0f`, `cp 0x07`, `jp z` -- leave it alone, and LIFE_TICKS_LOW's own entry records that cell taking only 00-09, 10-19 … 60 under a MAME write tap at cert seen. 0xACC1 is the round's craft count, the first destination of applyEraRungSettings's scatter (`ld a,(de)` at 0x1AC3, `ld (0xacc1),a` at 0x1AC4). The two runs address the same band from different ends: owed is 0xA8B0 / 0xAA26 for as many turns as 0xACC1 asks, cleared is 0xA890 / 0xAA22 for five, and the tail steps both cursors DOWNWARD. The quota-picks-the-count idiom is not local either -- 0x3702 loads B from 0xACC1 and replaces it with 5 when 0xAD02 is zero, the same rule and the same two numbers at a second site. ★ 'Search' rather than 'sweep' is the body's own shape: 0x37D6 opens `ld a,(ix+0x00) / and a / jp nz,0x3847`, so an OCCUPIED slot writes nothing and goes straight to the tail while a free one is filled and the routine returns -- at most one slot per entry, the walk stopping at the first free one",
  },
  0x3847: {
    name: "closeOneTurnOfTheFreeSlotSearch",
    role: "close one turn of the search for a free object slot and decide whether there is another: step the record cursor back one whole sixteen-byte record and the sprite-entry cursor back one two-byte entry, so the search walks its bank downward, strike one off the turn count, and while any remain transfer back to the body that tries one slot; when the last is struck off the search ends having filled nothing and this entry simply returns. The wide scratch pair the backward step is built from is left standing on the way out",
    cert: "seen",
    why: "it is `dec b` followed by `jp nz` and not `djnz`, so the flags the jump reads are the decrement's -- which is the difference from closeOneTurnOfTheSlotSweep, whose otherwise twin body ends in a real `djnz`. A scan of the whole 24 KB for the little-endian word 0x3847, at every alignment, finds one occurrence, the operand of the `jp nz,0x3847` at 0x37DA, which is the body's SLOT-IS-OCCUPIED arm: every turn closed here is a turn that found the slot taken, and that is what makes 'search' the right noun and 'sweep' the wrong one. ★ It is named where loc_3793 is kept hex because the reference is ABSOLUTE -- the address appears as a word behind a jump opcode, the exact thing loc_10f8 recorded as absent for itself -- and it has a job of its own, a complete loop-closing act, where advanceToNextSlot is this body minus the loop. It is the shared tail of a different routine, not a stretch of one",
  },
  0x410b: {
    name: "closeOneTurnOfTheSlotSweep",
    role: "close one turn of the per-slot sweep over an object bank: step the record cursor on one whole sixteen-byte record and the sprite-entry cursor on one two-byte entry, strike one off the turn count and go round again while any remain, ending the sweep when the count runs out; several arms of the sweep's body converge here rather than one, and the record stride is left standing in the wide scratch pair on the way out",
    cert: "seen",
    why: "'sweep' against closeOneTurnOfTheFreeSlotSearch's 'search' is the discriminating word, and the two bodies are opposite in both polarity and termination: 0x40EA opens `ld a,(ix+0x00) / and a / jp z,0x410b`, so a FREE slot is skipped to the tail and a live one is serviced, and no arm returns early -- every arm converges here and the count alone ends the sweep -- where 0x37D6 skips the occupied slot and returns the moment it fills a free one. The convergence is a scan result and here are the arms: `jp z,0x410b` at 0x40EE, `jr 0x410b` at 0x4106, `jp 0x410b` at 0x4191, 0x41A1 and 0x41B5, `jp nc,0x410b` at 0x41AF, plus the fall-through after the `call 0x413c` at 0x4108; a sixth occurrence of the word, at 0x2A86, sits inside a data run and is not a transfer. That is why the name says 'close one turn' and not 'return from the handler'. The count is not a constant either: the sweep's entry at 0x40D6 is `ld a,(0xad04) / cp 0x02 / ret c`, then `ld ix,0xa8c0 / ld iy,0xaa28`, then `ld a,(0xa8c6) / and a / ret z / ld b,a`, and 0xA8C6 is the third destination of applyEraRungSettings's scatter, at 0x1ACE. ★ advanceToNextSlot (0x309B) is `ld de,0x0010 / add ix,de / inc iy / inc iy / ret`, byte-identical up to the ending, so these two names must differ by the loop and by nothing else",
  },
  0x429c: {
    name: "setTheLaunchFacingInsideOneAimWindow",
    role: "the last gate in front of a launch, and the one thing the launcher is told: on one of the two coordinates the sprite entry carries, the firing object must lie inside a window centred on a fixed line whose half-width is READ FROM 0xA8E6 rather than baked in, and outside it this entry ends and nothing is launched; inside it the OTHER coordinate is compared against a second fixed line, and which side it falls on is handed to the launcher at 0x42B7 in the narrow scratch byte as a plain zero or one, which that routine turns into a mirroring of the NEW object's sprite rather than of the firing one's. ★ 0xA8E6 is one of the two aim windows applyEraRungSettings scatters, which is why the name says 'one' and not 'the'; the cell also has a NON-WINDOW reader at 0x43AE (`ld a,(0xa8e6) / ld (ix+0x04),a`, seeding a record countdown), and mechanisms.md marks what each of those twelve scattered cells governs as not fully settled",
    cert: "seen",
    why: "the window is not a plain 'within the half-width', which is why the role claims a centre and no width: the cell is doubled and the coordinate re-centred in a BYTE, so half-widths of 0x00 and 0x80 both shut the window over every coordinate and anything above 0x80 reopens it narrower and off centre. That 0xA8E6 is a window at all is checked by the idiom rather than by a count of cells: the shape `ld a,(cell) / ld d|b,a / add a,a / ld c|e,a / ld a,LINE / sub (iy+off) / add a,d|b / cp c|e` occurs at four sites -- 0x3D47 and 0x4278 on 0xA8D6, 0x3F9E and this entry on 0xA8E6 -- so exactly two cells serve as half-widths, matching the 'two aim windows' applyEraRungSettings's role already names, and the indefinite article is right. The mirroring was followed rather than assumed: 0x42B7 copies the firing object's coordinates into the free slot the pointers at 0xA991 / 0xA993 name and stores the handed byte at the new record's +0x01, and the first-era arm at 0x42EC does `ld a,c / rrca / sra a / and 0xc0 / add a,0x0b`, giving attribute 0x0B for zero and 0xCB for one -- the two flip bits, and nothing else, differing. ★ The player is kept out of the name deliberately, following hasReachedRetireLine, whose role says 'two fixed retire lines' and leaves the derivation to its why: 0x84 and 0x78 are immediates here, and that they are the player's own pinned sprite-entry pair is a fact about the caller and not about these bytes. One static inbound, `jp z,0x429c` at 0x4296, taken when ERA_INDEX reads zero, with the other arm of that same test reaching 0x42B7 carrying the object's own heading -- so what this entry is, is the first era's substitution of an alignment-and-side facing for a heading-follows one",
  },
  0x00d9: {
    name: "serviceVerticalBlankInterrupt",
    role: "the vertical-blank service body, entered by falling through from the one-byte `push af` at 0x00D8 (saveAccumulatorForFrameInterrupt): publish the sprite shadow and drain the deferred cell lists, close the interrupt gate (0xC300 <- 0) and kick the watchdog (0xC200), set SCREEN_UNFLIPPED and the flip-screen latch 0xC302 from ACTIVE_PLAYER and UPRIGHT_CABINET, latch the five complemented input/DIP ports into DIP1_MIRROR, IN0_MIRROR, IN1_MIRROR, IN2_MIRROR and COINAGE_SETTINGS, step FRAME_TICK and the packed-decimal BCD_FRAME_COUNTER, take BANK_LAUNCH_COOLDOWN, WAVE_CLAIM_TIMER and ATTACKER_SPAWN_COOLDOWN one step toward zero, service the coin inputs, then run the arm of the four-word table at 0x015F (0x15C2 / 0x1651 / 0x17FE / 0x0F1F) that the low two bits of SEQUENCE_PHASE select, with the epilogue 0x0174 pushed as its return so the frame closes there",
    cert: "seen",
    why: "each clause is a write or a transfer made from inside 0x00D9-0x015E, and each was watched under MAME in five captures (attract, driven play, the boss-armed tape and two Mother-Ship kill runs): once per frame the body writes 0x00 to 0xC300 (pc 0x00ED) and to 0xC200 (0x00F0), SCREEN_UNFLIPPED (0x00F4) and 0xC302 (0x0109), the five port mirrors 0xA9AD-0xA9B1 (0x0110-0x012C; the IN0 mirror 0xA9AE stays 0 through undriven attract and takes nonzero values in driven play), FRAME_TICK through every byte value (0x0132) and BCD_FRAME_COUNTER in packed-decimal steps (0x0139); the three countdowns are written only while nonzero (0x0141, 0x0149, 0x0151). The body is fetched exactly as often as the epilogue 0x0174 in every capture, and all four arms of the table were fetched -- 0x15C2 (the boot wipe), 0x1651 (attract), 0x17FE (the credit state) and 0x0F1F (the round engine). It is an entry of its own, not a stretch of 0x00D8: `jp nz,0x00d9` at 0x08C4 (erasePenRouteThenOpenInitialsEntry's tamper arm) transfers to it directly",
  },
  0x0174: {
    name: "sendOneQueuedSoundThenUnwindTheFrameInterrupt",
    role: "close the vertical-blank service: send the oldest queued sound byte (sendOldestQueuedSoundCommand), unstack the two register banks the service saved, reopen the interrupt gate from the program byte at 0x1600 (0xC300 <- 0x01) and return into the interrupted code; reached as the resume address the service pushes at 0x0155, never by a call",
    cert: "seen",
    why: "the gate write is the role-defining one and it is this body's own: under MAME, in each of five captures, pc 0x0187 wrote 0x01 to 0xC300 once per frame -- the same count as the frames the service body 0x00D9 ran and as its 0x00 write to 0xC300 at pc 0x00ED, so the gate the service closes is reopened here and nowhere else; the send is its callee's [seen] role. The only occurrence of the word 0x0174 in the image is the `ld hl,0x0174` at 0x0155 that the service follows with `push hl`, so control returns into this address rather than calling it; the address is absolute, which makes it an entry and not a fragment",
  },
  0x43f0: {
    name: "loc_43f0",
    role: "one frame of the Mother-Ship, dispatched on the head byte of its record MOTHER_SHIP_STATE (0xA8A0) with its sprite pair at MOTHER_SHIP_ENTRY (0xAA24). Head 0x00 (idle): count the delay at +0x0E down, and once it is spent and ROUND_TRANSITION_HOLD is clear, launch the ship at a position chosen from PLAYER_HEADING, raising its hits-to-absorb (+0x04) to 5 if below 6 and requesting the era's sound. Head 0xFF (live): move both tiles by the ship's velocity and the world scroll, dress them for the heading or retire the ship at the field edge, and while BANK_LAUNCH_COOLDOWN is spent and a tile is on screen but outside the near band around the player, fire an aimed shot into the first free of the shot slots 0xA830/0xA840 and re-arm the cooldown. Any other head is a hit (0xF0, written by the collision sweep) or a dying step: while +0x04 holds hits one is spent and the ship goes back to live; otherwise, at head 0xEF it sweeps the fifteen object records (each live one takes a staggered dying code from 0x14 in steps of 10 and scores 200), holds the round (ROUND_TRANSITION_HOLD=0xFE) and restarts the head at 0xE4, then counts the wreck down through its warp shapes, at 0xB4 flashes it and posts the 3,000-point award, and at 0 goes idle and releases ROUND_TRANSITION_HOLD to 0xFF",
    cert: "seen",
    why: "kept hex because the image has no absolute entry point here for an English name to be about: a scan of the whole 24 KB for the little-endian word 0x43F0, at every alignment, finds none, so no table can name it and nothing absolute reaches it; the only transfer that lands here is the RELATIVE `jr nz` at 0x43C0 in armMotherShipOrStep, across sumImageBlockForTheTamperCheck at 0x43E8 -- a range fragment, the same rule as loc_10f8/loc_3793/loc_5254. Every phase of the role was watched under MAME making its own writes, at pcs inside this body's arms (0x43F0-0x4446, 0x4535-0x459A, 0x45B3-0x46B9, 0x46F0-0x47B2; the callees housed in the span, 0x4447 and 0x46BA, are left out, and the overlapping 0x459B entry was never fetched): the entry 0x43F0 is the dispatcher and writes nothing, and all three of its arms ran; idle wrote the +0x0E delay counting down (pc 0x453C); launch wrote +0x02 as 0x00 or 0x80 (0x468E), the hit floor 5 (0x469B) and the head 0xFF (0x469F); live wrote both tiles' coordinates and fractions (0x4415-0x443E); the absorb arm stepped +0x04 down (0x4547) and put the head back to 0xFF (0x454A); the death sweep cleared HITS_REMAINING (0x455B), wrote 0x14 + 10*k into record head 0xA810 + 16*k for k up to 12 (0x4572), set ROUND_TRANSITION_HOLD 0xFE (0x4584) and the head 0xE4 (0x4587); the countdown wrote the second tile's coordinates, the warp shapes, the head and the 0xFF flattening (0x45C3-0x4609); the flash wrote head 0xB3, codes 0xFE/0xFD and attribute 0x6C (0x4623-0x4632); the end wrote ROUND_TRANSITION_HOLD 0xFF (0x4648) and head 0x00 (0x464B); and the fire test 0x46F0 and slot search 0x4734, which only test, led to 0x474C writing SCRATCH_PTR_A/B, the shot's velocity words, code 0x4D, attribute 0x62, head 0xFF into 0xA830/0xA840 (0x47A9) and the cooldown (0x47AF). The eleven exported arms are interior to the body and carry effect names only",
  },
};
