# Galaxian — mechanism map

A code-grounded model of how Galaxian plays, built from the translated + idiomatic layers and confirmed
against the real ROM under MAME. This is a **living** document: it grows as the idiomatic decompile
spiral climbs. Right now it covers the **leaf helpers** understood in decompile batches 1–2 and
understanding pass 1; the higher-level per-frame orchestration that calls them (the main loop at 0x200a,
the rst-28 state dispatchers) is disassembled and translated but not yet idiomatically decompiled, so its
narration here is deliberately thin and flagged.

**Confidence tags** (never recalled — grounded or derived): `[seen]` a MAME observation terminates the
chain (a write-tap value trajectory, a control-poke); `[code]` a confident reading from the faithful
translated behaviour, MAME not yet consulted for this specific claim; `[guess]` plausible, unverified.
The outside-in frame is `gameplay.md` (public sources, blind to the ROM) — used to orient, never as a
source of truth. Cells are named in `idiomatic/names.js`, which is the single source for each cell's
name/role/tag.

## Random numbers
`advanceRandomSeed` steps an 8-bit linear-congruential generator: it reads `RNG_SEED` (0x401e), replaces
it with `seed*5+1` (mod 256), and returns the new byte as the frame's random draw. `[seen]` — the seed
cell's value trajectory (01→02→06→09→0b→0d…) was observed advancing on the real machine, and 0x401e has
exactly one writer, this routine. Callers across the object logic consume the draw for timing and target
selection; what each does with it is not yet claimed.

## Top-level sequence state machine
A one-byte index, `SEQUENCE_STATE` (0x400a), drives the attract/setup sequence: a dispatcher reads it and
`rst 0x28`-vectors to the matching handler. Two adjacent bytes, 0x4008 and 0x4009, form a **two-tier dwell
cascade** that times how long each step holds.

`tickCascadeCountdown` is the shared timer primitive `[seen]`: it decrements the byte its caller points at
and, on a zero-crossing, steps to the next in-page byte and increments it — a borrow rippling from one tier
into the next. Its callers pass the 0x4009 tier, so an expiry carries into `SEQUENCE_STATE` itself,
advancing the sequence. `enterSequenceStep1` `[code]` is the handler that forces the index to step 1 and
arms that dwell to (3,3); `reloadSequenceDwellTimer` `[code]` re-arms the 0x4009 tier to 80 ticks after a
handler picks the next step. `armStateAdvanceGate` `[code]` and `armSubstateAdvanceGate` `[seen]` write the
"armed" marker 3 into two gate bytes (0x41b5, 0x4195) that later state handlers test to take their
advance-and-show branches, and `clearGateOnPendingRequest` `[code]` acknowledges a pending request flag
(0x420b bit0) by clearing it and the behaviour gate 0x4208 it governs. (Several of these fire only in
states the attract + one-player captures did not reach, so they remain `[code]` pending a deeper capture.)

## The object/formation field
Object records live in a work-RAM block at 0x4020 that the vblank service blits whole to the sprite/scroll
hardware at 0x5800 each frame — so writes into 0x4020… are what ultimately move things on screen.
`seedObjectRamShadowField` `[seen]` lays a static pattern into one interleaved (stride-2) field of that
shadow from a ROM template at init, and `broadcastToStridedTable` `[seen]` writes a common byte across a
nine-cell stride-2 run (blanking a field when its caller passes zero).

Formation sweep is an oscillator over a 16-bit swept position (0x420e) bounded by a low/high pair: when the
position reaches the upper bound `setSweepDescending` `[seen]` sets `OBJ_SWEEP_DIRECTION` (0x420d) to 1, and
at the lower bound `setSweepAscending` `[seen]` clears it to 0 — the flag the mover reads to pick its
increment/decrement arm, bouncing the value between the limits.

Per-object motion planning: `commitMoveToTargetX` `[seen]` arms one object record (addressed through IX) to
slide toward a chosen X — storing the target, the signed per-frame step, a zeroed accumulator, and the next
planner sub-state — and `settleObjectXAtRest` `[seen]` walks an object's coordinate up one count per frame
until it lands within 5 of a rest value (200) and then holds. `bumpCountIfNeighborsInactive` `[code]` is a
look-ahead helper returning a count bumped only when two neighbouring slots are both inactive, and
`markValueOutOfRange` `[code]` is a clamp's out-of-range arm forcing a fold index to a 0x80 sentinel.

A small object-animation dispatch (for a deactivated/dying object) has `armObjectAnimAndRequestSound`
`[code]` seed its timers and post a position-keyed sound request on entry, `endObjectAnimOnTimerExpiry`
`[code]` clear the object's state flag when the dwell expires, and `noopAnimDispatchSlot` `[code]` as the
table's empty terminal slot. These sit in states the current captures did not enter.

## Sound
Galaxian's sound is memory-mapped discrete hardware (no sound CPU); the idiomatic layer stages values that
a per-frame driver latches to the sound registers. `stageSoundPitch` `[seen]` writes the pitch shadow
`SOUND_PITCH`; `advanceSoundPitchRamp` `[seen]` walks a {countdown,pitch} pair to sweep the pitch upward a
fixed step per tick; `stagePitchAndRaiseSoundFlag` `[code]` stages a pitch and raises a composite flag.
`armSoundSequenceOnRequest` `[seen]` and `armSoundSequenceForSelector16` `[code]` arm a gated sound sequence
— clearing the request, raising the active flags, and publishing the sequence-data pointer. `broadcastSoundLfoLevel`
`[seen]` saves an LFO level and fans it, rotated one bit per write, across the four LFO-frequency latches.
`driveDecayingSoundSweep` `[code]` and `driveGatedSquareTone` `[code]` run per-frame countdown-driven effects
straight to the sound registers (hardware writes, not in the work-RAM tap, so they stay `[code]` here).

## Coins, credits, and the HUD
Coin service: `pulseCoinCounter` `[seen]` drives the coin-counter output pulse and ticks its width timer
(observed on the coin-insert capture); `clearCoinLockout` `[code]` releases the mechanism by clearing the
lockout latch (a hardware write); `setCoinPhaseFlag` `[code]` raises the coins-per-credit phase flag on the
first coin of a pair; `presetCreditCount` `[code]` presets credits to 9 (a free-play/mode branch) and
`clampCreditsToMax` `[code]` pins the credit counter back to its 99 ceiling.

Screen and HUD painting: `resetScreenFillState` `[seen]` rewinds the VRAM write cursor to base, re-arms a
full-page fill length, and clears the dispatch flag and game state (input-gated); `drawTextColumn` `[code]`
draws a run of characters down a VRAM column (font tile = source byte − 0x30); `reloadExpiredCounterAndTally`
`[seen]` refills one expired counter cell from a ROM table and bumps a running tally. Score display:
`drawBcdDigit` `[code]` paints one BCD digit as a font tile with leading-zero blanking and advances the
cursor; `selectCurrentPlayerScore` `[code]` and `selectPlayerStatusVram` `[code]` return the active player's
score field and status-column VRAM base; `stampTilePair` `[code]` and `drawDoubleHeightTile` `[code]` stamp
consecutive / double-height glyph pairs into the tilemap. `endMessageScrollOnExpiry` `[seen]` ticks a
countdown and clears `MESSAGE_SCROLL_ENABLE` on the zero-crossing to stop the attract message scroller.

## Open questions
- The per-frame orchestration (main loop 0x200a, the rst-28 state dispatchers, the object update engine) is
  translated but not idiomatically decompiled — its narration above is inferred from the leaves it calls.
- Several sequence/coin/animation handlers stay `[code]` because their states were not reached by the
  attract + single-coin/one-player captures; a deeper poke-cycle capture is owed to lift them.
- Cell roles are `[code]` pending their own grounding pass (a routine being `[seen]` grounds its role, not
  automatically every cell it touches).
