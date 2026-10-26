# Centipede — how the machine works

Centipede (Atari, 1981) runs on a single MOS 6502. This document narrates how the
idiomatic JavaScript port of that program works, subsystem by subsystem, at the level
someone who has never seen the game's internals could follow. It describes the machine
as it IS — the cells each subsystem owns, its control flow, and why each step matters —
not the history of how the port was built.

**Grounding tags.** Each claim carries the confidence tag of the cell or routine it
concerns, taken from `idiomatic/names.js`: `[seen]` — a role a MAME observation confirmed;
`[code]` — read from the routine's own behaviour; `[guess]` — a tentative reading. This
document never re-invents a `[seen]`; the tag, not the prose, records that MAME confirmed a role.

## Boot + self-test

This subsystem owns the power-on reset entry and the trap that a failed self-test falls into. It begins the moment the processor comes out of reset and either delivers the machine to the game's main loop or, when an operator holds the service switch, runs the board through its memory diagnostics.

The reset entry first wipes RAM clean. A single descending sweep walks one index across the low page (`loc_00`), the stack page (`loc_0100`), and the four video/object pages (`loc_0400`, `loc_0500`, `loc_0600`, `loc_0700`) at once, writing zero into each, so every plane of work RAM starts from a known-blank state before anything reads it [code]. It then quiets the hardware latches that could otherwise carry stale state across the reset: the POKEY control ports `SKCTL` [seen] and `AUDCTL` [seen] are zeroed so no sound leaks, a dead store lands on `loc_2400` (a ROM-space address the machine ignores — it is written only so the mirror matches the original exactly) [code], and the flip-screen latch `FLIP_SCREEN` [seen] is dropped so the display orientation is defined.

With RAM and latches settled, the entry reads the service switch to decide where to go. The switch lives in bit 5 of input port `IN0` [seen], idle-high and pulled low only while an operator holds it [code]; `IN0` bit 6 is the beam's vblank edge, toggling once per frame [code]. When the switch reads idle, this is a normal boot: it snapshots the option DIP bank `DSW1` [seen] into the configuration byte `CONFIG_DIP_BYTE` [seen] (whose upper bits later select a ROM table variant), seeds a few flags to their power-on values (`loc_86`, `loc_c1`, `loc_c2` to 0xff and `loc_ff` to 1) [code], loads the high-score mirror out of NVRAM and validates it, and then hands control to the game's main loop, which never returns [code]. That is the entire normal path — the rest of the subsystem exists only for the operator diagnostic.

When the service switch is held instead, control drops into the self-test. It first paints a small colour ramp into the palette cells `PALETTE_COLOR_04`–`07` and `PALETTE_COLOR_0D`–`0F` [seen] and silences all four POKEY channels via `AUDC1`–`AUDC4` [seen], giving the test screen a defined look and no sound. Then it marches memory. The zeropage march visits every cell of `loc_00`: each must first read back zero (proof the earlier wipe held), after which a single set bit is walked upward through the byte, each write immediately read back and compared, so a stuck or shorted bit surfaces the instant it fails to echo [code]. A second march covers whole pages through a 16-bit pointer built from `loc_8b` (low, held at zero) and `loc_8c` (high, the page number): it tests page 1, then pages 4 through 7, deliberately skipping pages 2–3 because they are unmapped [code]. Note that `loc_8c` here is a live page counter driving the march, not a fixed base. Any mismatch in either march aborts immediately into the error reporter.

If both marches pass, the test branches on a coin/option bit (bit 4 of `IN1` [seen]): set, it hands off to the checksum-display screen, which does not return. Otherwise it builds the on-screen diagnostic itself — re-clearing zeropage, seeding the `loc_64` row with a fill glyph, and painting a descending grid of glyph codes through the same `loc_8b`/`loc_8c` pointer across pages 7 down to 4 [code]. It then runs an input-response screen: it spins until the service switch clears, shifts a pacing value in `loc_8a`, kicks the watchdog `WATCHDOG` [seen] each pass so the board is not reset out from under the test, and waits for any control to be actuated (a change in the top three bits of `IN1`) [code]. Once a control is seen, it floods the play and object pages with a response colour, brightens two palette cells, and settles into a final review loop that does nothing but hold the screen — waiting on the service switch and kicking the watchdog forever [code].

A failing march reports through a short beep-and-halt path. The number of beeps encodes the fault: a zeropage failure derives its count from the single fail-flag bit, while a page failure folds in the position of the failing byte, and a low-page failure reports in the simpler zeropage style [code]. The reporter drives an audible tone on channel 1 (`AUDF1` [seen], `AUDC1` [seen], armed via `SKCTL` [seen]), toggling the tone on and off in step with the beam — each half of a beep spins through a fixed number of vblank edges on `IN0`, kicking `WATCHDOG` [seen] as it goes so the count can play out — and repeats until the beep counter underflows [code]. It then waits, still kicking the watchdog, until the service switch is released, and halts the processor in a bare endless loop that no longer kicks `WATCHDOG`, so on the board the watchdog resets the machine and, with the switch released, it boots normally [code].

The halt trap `spinToSelfHalt` is the same idea in a different place: a self-jump that hangs the processor forever, writing nothing. No instruction in the program jumps to it; its only reference is the 6502 NMI vector at 0x3ffa, and the board wires only the IRQ line, so it never runs. It would park the CPU, without kicking the watchdog, if an NMI ever arrived [code].

## Main-loop spine + dispatchers

This subsystem is the game's outermost control structure: the entry that brings a round into existence and the per-frame loop that drives every other subsystem, one tick at a time, forever.

Execution begins at `loc_200e`, the game entry. It does three things in order and then never returns. First it calls `initRoundState` to seed the round's working state — the cells a fresh board needs before anything can move. Then it calls `plotRecordFieldColumns` to lay down the record field, the static playfield scaffolding the round is played on. Only once the state is seeded and the field is drawn does it hand control to `mainLoop`, which it enters as a continuation of itself so that the per-frame pauses inside the loop propagate all the way back out to the machine that is running it. That last detail matters: the entry is not a function that sets up and returns, it is the trunk the whole frame loop hangs from.

`mainLoop` is that loop — an unbounded `for(;;)` that repeats once per displayed frame. The first thing each iteration does is wait. The CPU has nothing to compute until the next frame heartbeat arrives, so the loop pauses at the top; that pause *is* the frame boundary, the point where the display's vertical-blank tick lands and the frame's interrupt work gets serviced before the loop resumes. This is why the loop needs no timer of its own — the wait for the heartbeat is the clock.

When the loop wakes, it acknowledges the heartbeat it was waiting on. The 32V interrupt raises the low bit of cell `0x8a` [code]; the loop consumes that bit with a single right-shift of `0x8a`, clearing the "a frame is ready" flag so the next iteration will block again until the following frame. Immediately after, it kicks the hardware watchdog: it writes the just-sampled `IN0` [seen] value into `WATCHDOG` [seen]. The value written is incidental — it happens to be the freshly read vblank/input port, and it is not compared against anything — what matters is that the write *happens* every frame, because a watchdog that stops being kicked resets the machine. So the head of every frame is: block for the heartbeat, consume the heartbeat bit, prove liveness to the watchdog.

The body of the frame is then a fixed chain of subsystem dispatches, run in a deliberate order. It opens with `loc_2561` (the wave/board service) and `updateSoundChannels`, the sound engine that pushes one frame's worth of bytes into the POKEY channels. Then comes the spine's one branch point: it calls `loc_2741`, the object/spawn dispatcher, and inspects its answer. That dispatcher does the frame's object-spawn and object-movement work and reports back whether the rest of the frame should run — when it returns false the loop `continue`s, abandoning the remainder of this frame's chain and looping straight back to the heartbeat wait [code]. This is a genuine short-circuit: on ticks where the spawn dispatcher has consumed the frame with its own work, the heavier render-and-simulate tail is simply skipped for that tick, and only ticks it green-lights run the full pipeline.

Past that gate, the frame runs its full subsystem tail in sequence, and the ordering encodes the data dependency from bookkeeping through simulation to rendering. It first flushes deferred non-volatile writes with `tickEaromWriteback`, then runs `loc_2119`. `plotObjectCoordinates` renders the current object positions. `beginCentipedeSegmentSweep` opens the centipede segment pass, and `serviceTimerBank` ages the bank of countdown timers that gate periodic events. `loc_2ace` advances a movement sub-step accumulator. The remaining calls carry the actors forward: `advanceColumnHeadingState` and `stepHeadSegment` progress the centipede's column/head state, `spawnActorOnTimer` releases a new actor when its own periodic countdown expires, `steerHeadAndSeedVelocity` picks the head's heading and lays down a fresh velocity seed, and `loc_2059` continues the object update. Near the end, `advanceDeathRespawnSequence` steps the death-and-respawn state machine so a killed player or cleared board moves through its animation, and finally `scanForRangedCellAndSeed` walks the playfield cell stream looking for a cell in range to seed. When the tail finishes, the loop returns to the top and blocks for the next heartbeat.

The whole subsystem is therefore very small in its own right — a handful of cells (`0x8a` [code] as the heartbeat latch, `WATCHDOG` [seen] and `IN0` [seen] as the liveness poke) and one conditional — but it is the ordering authority for the entire game: it fixes that every frame begins with a heartbeat-gated wait, always kicks the watchdog, always runs board-service and sound, and then either bails early on the spawn dispatcher's say-so or runs the fixed simulate-and-render chain to completion.

## Timing / periodic-event scheduling

This subsystem keeps the game's periodic clocks turning: a bank of general-purpose countdown timers with a slow master frame counter, a gated spawner that drops fresh actors on a self-adjusting interval, and a per-channel cadence stepper that paces segment spawns. Three routines own it — `serviceTimerBank` ($34 timer block, $41/$43/$d7/$ef/$00, $da/$db), `spawnActorOnTimer` ($97/$87/$a0/$88, the $34 slot array with its $64/$54/$74/$44 fields, $a1/$94/$f0, $100a), and `tickSpawnCadence` ($88/$94/$87/$9c/$41/$ef/$9f). All of the control flow described here is `[code]`, read from behaviour; the only cells whose identity is MAME-confirmed `[seen]` are the spawn timer `$a0`, the POKEY RNG `$100a`, and the field-scan pointer pair `$da/$db`.

**Servicing the countdown-timer bank.** `serviceTimerBank` sweeps fourteen countdown bytes based at `$34`, walking index `0x0d` down to `0x00` `[code]`. Each byte is read and classified by magnitude: any value below `0xF9` is resting and is left untouched, so idle timers cost nothing; a value of exactly `0xF9` is a "just-expired" marker that is *not* decremented but does request a master re-arm; and any value `0xFA` or above is a live countdown that gets decremented by one and, if it lands on zero this pass, likewise requests a re-arm `[code]`. This is why the numbering runs high — a timer counts *up* through `0xFA…0xFF` toward the `0x00` expiry, so a byte near `0xF9` is nearly done, not nearly full. The re-arm request matters only on the top slot: it fires solely when the index is `0x0d` (the master, the first iteration of the descending loop) and only while the frame counter `$43` has its `0xAF` bits clear, and when it fires it refreshes `$41` from `$d7 ^ $ef` `[code]`. That folded value at `$41` is the shared key the cadence stepper later range-tests, so this step is what couples the timer bank to the spawn cadence.

**Advancing the slow master frame counter.** After the byte sweep, the routine drives the `$43` frame/step counter, but only under three guards, each of which matters `[code]`. First, if `$43 & 0xAF` is zero the counter is inactive and the routine stops; it advances `$43` only when the mask is nonzero (the re-arm is gated in the opposite polarity — it fires when the mask is clear). Second, `$43` only advances on every fourth frame, tested as `$00 & 0x03 == 0`, which stretches the count into a coarse, slow clock rather than a per-frame one. Third, once `$43` reaches `0x28` it is clamped and stops climbing. When all three permit, the counter is incremented by one `[code]`. The step that carries it across the top — the frame where the pre-increment value is `0x27`, moving `$43` to `0x28` — is a one-shot: it seeds the playfield cell-stream scan pointer to `0x0400` by writing `0x00` into `$da` `[seen]` and `0x04` into `$db` `[seen]`, kicking off the field scan exactly once as the counter tops out. A current-state caution: the wrap test reads the *pre-increment* `$43` value (a 6502 `inc` quirk carried faithfully), so the comparison is against the old count, and the seed fires on the `0x27`-valued frame, not after `$43` already shows `0x28` `[code]`.

**The gated periodic spawner.** `spawnActorOnTimer` is the interval-driven actor factory, and it refuses to do anything unless two flags agree: the enable byte `$97` must be set and the busy byte `$87` must be clear `[code]`. Past those gates it services its own countdown `$a0` `[seen]` — while `$a0` is still nonzero it simply decrements it and leaves, so nothing spawns mid-interval. Only on the frame `$a0` reaches zero does the spawn body run. It picks a per-index "channel" selector from `$88`, then scans the twelve actor slots at `$34+s` from high index to low, looking for the first free one — a slot whose byte has its high (sign) bit set counts as free `[code]`. If every slot is occupied nothing spawns and the countdown is not reloaded, so a full field naturally throttles spawning. When a free slot `y` is found the routine claims it by zeroing `$34+y` and seeds the new actor's fields: an orientation-folded value `0x40 ^ $f0` into `$64+y`, and motion seeds `0xFC` into `$54+y` and `0x02` into `$74+y` `[code]`.

**Self-accelerating interval and the random variant.** After spawning, the countdown is reloaded from a per-channel value at `$a1+x` — and this reload is a ratchet, not a constant. As long as the stored reload is `0x60` or greater it is reduced by `0x08` and written back before use, so each spawn on that channel shortens the next interval, and the spawns come faster and faster until the reload floors out below `0x60` `[code]`. The reduced value is what gets loaded into `$a0` for the next cycle. Finally a coin-flip from the POKEY random register `$100a` `[seen]` picks the new actor's variant: if bit 1 is set it takes variant A, writing `0x02` into `$44+y`; otherwise variant B overrides the earlier motion seed with `0x04` into `$54+y` and uses the mirrored value `0xFE` in `$44+y` `[code]`. Either way the per-channel spawn counter at `$94+x` is bumped, recording how many actors that channel has produced `[code]`.

**Pacing the per-slot spawn cadence.** `tickSpawnCadence` steps the finer, per-slot spawn rhythm and shares its selector `$88` with the spawner `[code]`. It first checks a combined gate: when the per-slot byte `$94+x` OR-ed with the shared arm byte `$87` is zero — both clear — the slot is idle and ready to advance, so the routine steps that slot's phase counter `$9c+x` by one and re-arms the gate by writing `0x40` into `$87`, then returns `[code]`. (Note the same `$94+x` cell the spawner uses as a spawn *tally* is read here as a *gate*, and the same `$87` that gates the spawner's busy check is the shared arm byte — these cells are read for different purposes across the two routines, so their exact combined meaning is behaviour-derived, not grounded.) When the slot is not idle, the routine instead range-tests the folded key `$41 ^ $ef` — the very value `serviceTimerBank` refreshes into `$41` — and bails out unless it is at least `0x9c` `[code]`. Past that threshold it decrements a shared countdown `$9f`, and each time `$9f` reaches zero it hands off to `seedSegmentSpawnState` to seed the next segment spawn `[code]`. So the segment-spawn beat is gated by both the arming handshake on `$87`/`$94` and the folded timing key that the master timer bank keeps refreshed, tying all three routines into one periodic-scheduling loop.

## Round lifecycle, wave setup + death/respawn

This subsystem owns the transitions between play states: bringing a fresh round up from cold cells, servicing the pending-wave banner each frame until a wave actually commits, seeding the per-wave working values, and — once the player loses an object on screen — ticking a countdown that either blanks a dying cell, hands a spawn slot forward, or tears the wave down and rebuilds it. Everything below is read from the routine behaviour ([code]); the hardware ports and a handful of accumulator cells it touches are MAME-confirmed ([seen]), and the bare zero-page working cells it shuffles are behavioural placeholders whose exact semantics are inferred from how the code uses them.

### Bringing a round up: initRoundState

`initRoundState` [code] is the board/round setup entry. It first arms the sound path — writing 0x20 into the POKEY AUDCTL control latch [seen] and, a few statements later, cycling the POKEY SKCTL serial/keyboard-control register [seen] from 0x00 to 0x03 so the audio hardware comes back clean for the new round. Between those two writes it seeds the round's working state: it loads the countdown pair $9b/$9c to 0x0c and the step pair $9d/$9e to 0x02, takes a single RNG snapshot from $ff and mirrors that one byte into three cells ($88, $53, $83) so the slot index and two downstream consumers all start from the same random seed, and then wipes two blocks — the seven-cell SFX timer bank $b2..$b8 and the six-cell $a8 slot table — so no stale effect timer or slot entry survives into the new round. It folds the hardware RNG into $c8 with a deliberately self-cancelling expression, `(POKEY_RANDOM ^ POKEY_RANDOM) + $c8`: the two reads of the POKEY RANDOM register [seen] net to zero while the poly counter sits at origin, so this is a mixing step that is a no-op in the clock-free case rather than a real state change — worth flagging because it *looks* like it should perturb $c8 but does not while the poly counter is idle. Having reset that state, it rebuilds the segment sprite tables, arms the spawn-timer trio — the SPAWN_TIMER cell [seen] plus its companions $a2 and $a3 all to 0xc0 — and seeds the segment spawn state and the wave state. It has no final store of its own to return through; instead its last act is to hand the frame to the playfield reset (`resetPlayfieldAndSeedMushrooms`), whose own tail chain carries the return back out. So a fresh round always ends with the playfield cleared and re-mushroomed.

### The per-frame wave banner: loc_2561

`loc_2561` [code] is the wave/board-start service that runs every frame but does almost nothing on most of them. It always reseeds a few wave-select cells up front: it copies the DSW2 config source byte [seen] into $d3, derives a low-two-bit selector into $8d, and computes a difficulty-scaled count into $a4 from bits 3-2 of the CONFIG_DIP_BYTE [seen] (`((byte & 0x0c) >> 2) + 2`) — so the difficulty count is always current even when no wave is starting. Its real gate is the pending-wave flag $86: unless bit 7 of $86 is set it returns immediately here, which is the common path. When a wave start *is* pending it lays the banner status rows and folds the two live counters — $c8 and the segment-movement accumulator SEGMENT_MOVE_ACCUM_B [seen] — together; while either counter is nonzero it keeps emitting the counting-down banner rows and two masked status digits (splitting off the tens above 9). Only when the count is truly spent and the flip byte $dc has not gone negative does it reach the commit block. Committing a wave clears the working cells ($fb, $fc, $9a, the segment cross-count SEGMENT_ROW_CROSS_COUNT [code] and accumulator SEGMENT_MOVE_ACCUM [seen]), chooses a slot index into $89 (either a fixed 0x02 or a fallback read of $ff, gated by an IN1 poll [seen] so a held input can abort or defer the commit), sets $a5 to the difficulty count minus one, bumps $86, refreshes the checksum snapshot, and runs two config-indexed table lookups that feed the paired object cells $ae/$af and $b0/$b1. If IN0 bit 4 is set [seen] it broadcasts a 0x80 through the state block first. It finishes by calling `initRoundState` and then the grid-border draw — so a committed wave flows straight into the full round setup described above.

### Seeding the wave values: seedWaveState

`seedWaveState` [code] is the small initializer both `initRoundState` and the death/respawn restart lean on to set the per-wave numbers. It folds the two difficulty/seed parameters $ef and $f0 into the working cells $40 and $70 by fixed XOR constants (0x1c and 0xf8), giving each wave a deterministic-but-scrambled starting pair. It then rejection-samples the POKEY RANDOM register [seen]: it keeps only bits 7-3 (`& 0xf8`) and re-rolls until the value is at least 0x10, then stores that value minus 4 into $60 — so $60 always lands in a bounded, "large enough" band rather than near zero. It picks a small per-wave count into $80 by indexing a table at $ab with the slot index $88 and choosing 3 when that byte is 6 or more, else 2. Finally it clears the head-velocity seed HEAD_VELOCITY_SEED (0x50) [code] and $b8 so the wave starts with no carried velocity.

### The death/respawn dispatcher: advanceDeathRespawnSequence

`advanceDeathRespawnSequence` [code] is the per-frame heart of the lose-an-object path. It is gated twice at the top: if the $87 countdown is already zero there is nothing to do, and if the field-scan pointer high byte FIELD_SCAN_PTR_HI [seen] is nonzero the sequence is paused. Otherwise it ticks $87 down by one and returns while it is still counting — so every branch below fires only on the single frame the countdown reaches zero, which is what paces the whole death animation. When the countdown expires it selects one of several mutually exclusive actions in priority order:

- **Blank a flagged cell.** If $d6 is set, it redraws a row, writes 0x00 into the cell the draw cursor $91 points at (erasing the dying glyph), clears the $d6 flag, and reseeds the player-shot start cells. This is the simplest exit — one cell blanked per expiry.
- **Fall through to a rebuild.** If `$43 & 0xaf` is zero it forwards to `loc_2505` (below), i.e. straight into a segment sprite-table rebuild.
- **Hand off to the reseed chain.** Otherwise it reseeds the shot cells, and if $86 is negative it optionally transposes the screen bitmap and plots the record field columns (only when $01's high bit is set, which it also clears), then hands off to the segment-spawn reseed.
- **Restart the whole wave.** If both object cells $a5 and $a6 read zero — meaning no object is left on screen — it decrements the life/round counter $86, runs the sorted-object-table build, and (when $ef is set and $c2 is negative) broadcasts a 0x80 through the state block with a transpose. It then performs the full wave restart in place: seed the segment spawn state, rebuild the segment sprite tables, seed the wave state, set $00 to 1, draw a pointer row, clear the per-slot output latch at $1c02 + $89 [seen], fold the high-score checksum, and load $f9/$fa to 0x3d/0x00. This is the path that recycles the board after the last object dies.
- **Step a spawn slot forward.** If exactly one slot remains (`$89 - 1 == 0`) it defers to `decrementSlotAndRedrawBorders`. Otherwise it works the current slot $88 against the $a4 slot-timer table: an empty slot on the first pass is *armed* for a fresh spawn — it bumps $a7, reloads $87 to 0x80, sets $43 and $42 to 0xf9, draws two rows, and paints the slot's glyph — while a later empty pass instead decrements $a7. It then switches to the mirror slot (`$88 ^ 0x03`); if the mirror is also empty it abandons the attempt into `decrementSlotAndRedrawBorders`. When the mirror is live it commits to it, folds a flag into $ee (calling `seedStateBlockConstants` when that flag lands on 0x82), reloads the SPAWN_TIMER [seen] from the $a1 table, and (for slot 1) broadcasts through the state block. A special case fires when the working column index is 2 and that slot matches slot 0 with $ad clear: it writes 0x0c into $94+cx and runs a full playfield reset + mushroom reseed, after which the mushroom sweep leaves the column index wrapped one past zero. Finally it marks the chosen slot busy (`$c2 |= 0x40`), reloads $87 to 0xa0, paints the glyph, sets $43/$42/$d6 to 0xf9, and tails into `decrementSlotAndRedrawBorders`.

The reason this is a countdown-gated dispatcher rather than a straight-line routine is that each of these actions wants its own dwell time on screen — a blank, an arm, a mirror-switch, a full restart — so $87 is reloaded to a fresh interval (0x80, 0xa0, etc.) at each step and the whole routine idles until it expires again. Note $87 is a live reloaded interval counter, not a static delay constant.

### Closing a slot: decrementSlotAndRedrawBorders

`decrementSlotAndRedrawBorders` [code] is the short chain the dispatcher tails into whenever a slot's turn is over. It counts the current slot's $a4 timer down by one, repaints the two vertical grid side-borders (so the field frame stays intact through the slot churn), and then hands off into the segment/wave reseed chain. It is deliberately tiny — its whole job is the timer decrement plus the border repaint before the reseed.

### The thin forward: loc_2505

`loc_2505` [code] is a single-statement entry that forwards straight to the segment sprite-table rebuild and returns its result. It carries no state, sets nothing up, and branches nowhere; it exists only as the target the death/respawn dispatcher jumps to when `$43 & 0xaf` is zero, so that "rebuild the sprite tables" is reachable as its own labelled entry.

### The spider/flea spawn-and-move spine: loc_2741

`loc_2741` [code] is the per-tick spawn-and-move routine for the secondary objects, gated on the object-active flags $c1/$c2 and the pending flags $ee/$ef. Its very first test decides the caller's whole frame: if both object slots are idle (`($c1 & $c2) & 0x80`) it returns truthy, which tells the caller to run the full per-frame subsystem chain; every other exit returns falsy, telling the caller this tick's heavy work is already done and to skip that chain. When no object is up and none is pending it kicks a fresh screen/wave setup — writing 0x82 into $ee, seeding the state-block constants, transposing the bitmap, plotting the object coordinates, and reseeding the shot cells. On an active tick it paints the status glyph for the live slot (only while $89's high bits are set), lays two fixed status rows, seeds the draw cursor $91/$92 from the flip bytes $f5/$f7, and plots a three-byte record at the slot's base offset. It then folds one input bit into the phase accumulator $9a — bit 3 or bit 2 of IN1 [seen] depending on whether $ef is set — and shifts $9a left, so the object's cadence is driven partly by live input.

At the top of a phase cycle (`($9a & 0x1f) == 0x18`) it advances the spawn-column counter $c0. Below the wrap (counter under 3) it just re-arms one slot cell and continues; on a full cycle it marks the current slot spent and, only when a spawn is pending ($ef nonzero), drives the entire respawn: broadcast 0x80, transpose, reseed the shot cells, plot the object coordinates, rebuild the segment sprite tables, and re-seed both the segment spawn state and the wave state — i.e. it reuses the same wave-seeding routines as the round-init and death-restart paths. The tail sub-steps refresh the checksum snapshot, run the object-mover, redraw the two object rows and clear the three sprite-shadow cells ($0589/$05a9/$05c9) when either object is still active, and re-home one object toward its target lane by folding a signed delta (via `negateA` for negative magnitudes) into the lane table at $1a, clamping the result into the 0..0x1a band. The net effect is that this routine both schedules when a new secondary object spawns (through the $9a phase counter and the $c0 column counter) and nudges the live one's lane each frame, while telling the main loop through its truthy/falsy return whether the rest of the per-frame chain still needs to run.

## Centipede segment + head motion

This subsystem is the whole moving centipede: the three-column body strip that
marches the creature across the field a row at a time, the per-slot segment
walk that carries each individual body cell along its own heading, the head's
orientation/velocity steering, and the spawn-seed and sprite-table rebuild that
bring a fresh centipede into being. The pieces are strung together as chains of
step handlers — each stage does its small write and then continues into the
next — so the exposition below follows those chains rather than listing the
routines alphabetically. Because almost every cell these routines touch is a
bare zero-page placeholder, the roles below are read from behaviour and carry
[code] unless a cell's own registry entry is marked [seen]; the load-bearing
[seen] cells are called out where they appear.

### The three-column body strip (the marching accumulator)

The coarsest motion is the body strip advancing one row-step at a time.
`advanceAllSegmentColumns` is a one-line preload: it sets the column cursor to
the last column (index 2) and hands to `advanceSegmentColumns`, which walks the
cursor down 2 → 1 → 0 [code].

`advanceSegmentColumns` owns the shared movement machinery. For each column it
looks at that column's step cell `SEGMENT_COL_BODY` (0xcf array, cols 0..2)
[seen] and a per-column control bit selected out of the `IN1` input port [seen]
— bit 7 for columns ≥ 2, bit 6 for column 1, bit 5 for column 0. With the
control bit clear the column takes the ordinary step: the low-5-bit step index
is nudged toward its clamp (backed off by one when it is past 0x1b, or every 8th
frame when the low bits of `SEGMENT_MOVE_FRAME_COUNTER` (0xd4) [seen] are all
set). With the control bit set it takes the wrap/reset branch, adding 0x20 to
the body and either storing the wrapped value, clamping to 0x1f, or re-arming to
0x1f while loading the life timer directly to 0x78. Either way the column then
runs its timers through the shared `storeAndTick` helper: the shared reload
timer `SEGMENT_RELOAD_TIMER` (0xd2) [seen] is refilled to 0xf0 unless IN1 bit 4
is set, and while that reload timer runs it counts down and blanks this column's
body plus its life slot `SEGMENT_COL_LIFE_TIMER` (0xcc array) [seen]. The carry
gate that decides whether the column contributes to motion fires only when that
per-column life timer decrements exactly to zero — the moment matters because
it is the once-per-life-cycle tick that lets a column push the creature forward
rather than every frame [code].

When the gate fires, the column folds a small per-column "row delta" (0 for
column 0, a bit of `loc_d3` for columns 1 and 2) plus one into the two parallel
movement accumulators `SEGMENT_MOVE_ACCUM` (0xca) and `SEGMENT_MOVE_ACCUM_B`
(0xc9) [seen], and bumps that column's progress counter in the `loc_c5` array
[code]. Two accumulators are kept in lockstep so the phased tail can consume one
while the other survives. After the last column, the accumulator is measured
against a per-row threshold looked up in `SEGMENT_ROW_THRESHOLD_TABLE` (0x3413,
a ROM table indexed by the row phase `loc_d3` >> 5) [seen]: a borrow leaves the
accumulator alone and the routine falls through to the phased tail; otherwise it
commits the reduced accumulator, bumps the row-crossing counter
`SEGMENT_ROW_CROSS_COUNT` (0xcb) [code], and bumps it a second time on the top
row (Y == 3) — that double-bump is what makes the top row cross faster. A guard
throws if the crossing counter wraps to zero here, catching a control path that
would have run off the end of the threshold table [code].

Every exit from the column walk continues into
`stepPhasedCountersAndWrapCells`, the per-tick bookkeeping tail. A 2-bit phase
from `loc_d3` picks a sub-step of 0, 1, or 1→2 that is subtracted from the
16-bit accumulator (low byte `SEGMENT_MOVE_ACCUM_B`, high byte
`SEGMENT_ROW_CROSS_COUNT`, with `loc_c8` as an extra wrap counter); the
accumulator floors at zero rather than wrapping past it, so motion never runs
backward on an underflow. Then the movement frame counter `SEGMENT_MOVE_FRAME_COUNTER`
(0xd4) [seen] ticks, and only on even frames a two-pass sweep normalises the
three `loc_c5` progress cells into a modulo-0x10 grid: pass 1 subtracts 0x10
from any cell ≥ 0x10, and only if pass 1 changed nothing does pass 2 subtract
0x11 from each nonzero cell, stopping at the first result that goes negative
[code]. Keeping those counters folded into a small grid is what keeps the
column progress readings bounded frame after frame.

### The per-segment walk (each body cell on its own heading)

Below the strip, each individual segment slot is moved on its own. The walk
begins at `beginCentipedeSegmentSweep`: while the `loc_87` gate is nonzero the
entire sweep is skipped, otherwise on frames whose low nibble of `loc_00` is
zero it arms the channel-2 SFX timer `SFX_TIMER_CH2` (0xb3) [seen] to 7 (the
marching footstep), seeds the segment index at the last slot 0x0b, and drops
into `moveCentipedeSegment` [code]. That mover recurses back down the slots as
it decrements the index, so one entry walks the whole strip.

`moveCentipedeSegment` is the heart of the walk — it advances one slot X by one
motion step and then continues into whichever step handler its wall/edge tests
select. It first reads the phase byte `loc_34+X`: a negative phase (bit 7 set)
means the slot is retired and it goes straight to the loop tail. Otherwise, on
even `loc_00` frames it bumps the phase (keeping bit 3 clear), then classifies
the coordinate's low bits — near an edge below phase 0x10 it flags `loc_97`.
When the slot sits on its home column (`loc_94` indexed by `loc_88` reads 1) it
re-seeds both heading deltas `loc_44+X` and `loc_74+X` to ±2 by their current
sign, which is how a segment "snaps" to a fresh straight heading each time it
re-crosses home. From there it runs a cascade of tests — a bit-6 distance check
between `loc_63+X` and `loc_64+X`, a bit-5 straight-to-edge shortcut, and the
coordinate `loc_54+X` against the high (≥0xf0) and low (<0x10) wall bands with
`loc_74+X` deciding the turn — and each outcome is a hand-off to one of the
sibling handlers. Its inner `probeAheadAndCollide` helper resolves the tile cell
ahead of the segment: a clear cell with no column neighbour keeps the plain
step, a blocking or mushroom-band cell (marking bit 5 of the phase on the way)
diverts to the edge resolver [code].

The edge resolver `resolveEdgeExit` classifies the segment against the wall via
the sign of `loc_74+X`, the direction selector `loc_ef`, and the folded
coordinate keyed through `loc_f0`, and finishes through one of three tails: the
direct-store tail, the negate-then-store tail, or the direction-reversal
handler. `resolveForwardEdge` handles a segment advancing away from the wall
with a low folded coordinate: it walks the trailing neighbour slots looking for
one to fold back — clearing that neighbour's phase bits, negating its delta,
snapping its coordinate to the grid, and clearing its link — before turning.
`storeCoordAndStep` folds `loc_74+X` into the coordinate `loc_64+X` (`loc_ef`
selecting add vs subtract) and hands the new coordinate onward [code].

The handoff targets form a small ring:

`commitSegmentCoord` writes the freshly computed coordinate into `loc_64+X` and
continues into `advanceSegmentCoordAndArm` [code].
`advanceSegmentCoordAndArm` advances the segment coordinate `loc_54+X` by its
own delta `loc_44+X`, then probes whether the segment now sits in range of the
reference point. If the probe arms the slot the segment is done; otherwise the
low three bits of the state field `loc_64+X` pick the next stage — value 4 means
the segment is aligned and flips its delta, anything else moves on to the next
segment [code]. `reverseSegmentDeltaAndStepCoord` is that flip: it negates the
delta `loc_44+X` in place, and when the neighbour link `loc_74+X` is not yet set
it seeds the link with the negative magnitude of the flipped delta and nudges
the coordinate ±4 following the new sign, then falls through to the next-segment
step — this is how a segment reverses direction at a wall and drags its
following segment's link with it [code]. `advanceSegmentLoopIndex` is the loop
tail: it steps the segment cursor to the previous slot, ends the walk once it
runs past the first slot, and otherwise re-enters `moveCentipedeSegment` for the
next segment [code].

Threaded through the walk is `detectColumnCollision`, which answers whether
another live object shares object X's column within a row band of it. It stamps
X into the scratch pair `loc_8b`/`loc_8c`, reads X's column `loc_64+X`, row
`loc_54+X`, and delta key `loc_44+X` once up front, then scans slots 0x0c..0x00
for a different active object (row byte `loc_34+Y` below 0xf4 marks it live) in
the same column whose wrapped, key-folded row delta reads within the band
(≥ 0xf4). It returns carry set on the first such neighbour — this is the test
that keeps two segments from marching through each other, and that lets the head
steer around its own body [code].

### The head slot: stepping and routing

The lead segment is handled by `stepHeadSegment`. It folds the head coordinate
`loc_72` against the vertical selector `loc_ef` and hard band-gates it (≥ 0xf3
exits to the tail spine). On a target match — the head equal to the biased row
coordinate built from `loc_73` and `loc_f0` — it either drops the whole sweep
into the spawn tick (when the `loc_43` state gate is busy, or when a probe of
`IN1`/`POKEY_RANDOM` bits picked by the owner slot `loc_86` hits) or arms the
channel-3 reload cell `SFX_TIMER_CH3` (0xb4) [seen] to 0x0b. It then rolls the
head position forward (publishing the prior row into `loc_8b`/`loc_8d`),
resolves the destination grid cell from the biased row, and — for a cell in the
stampable band — stamps it, treating the two boundary codes specially by
resetting the step cell and rolling the path accumulator before stamping the
cell empty. An empty destination continues into the per-segment router with the
slot index seeded to 0x0d [code].

`routeSegmentByRange` range- and collision-tests one segment slot and routes it.
A coarse X-band gate on the slot coordinate `loc_34+X` and a folded horizontal
distance to the head (`loc_64+X` ^ `loc_f0`, then a magnitude against `loc_72`)
skip a slot that is too far; the surviving slots measure a folded vertical
distance against `loc_62` and dispatch by slot class. The trailing slots
(X < 0x0c) tick their delay, clear a heading bit, resolve and stamp their tile
cell, and continue into the redraw tail. The active head slot (X == 0x0c) either
steers a nearby collision or bumps the shared column limit `loc_80`. The last
slot (X == 0x0d) runs the ballistic finish, and the tighter near/wide gates on
the head slot can skip the ordinary y-window test. When no class matches, the
slot index steps down through `advanceSegmentSlotLoop`, which decrements the
slot counter and — on underflow — finishes the sweep by handing to the
spawn-cadence tick, otherwise loops back to the router for the next slot [code].

The ballistic branch `finishBallistic` seeds the shot origin `loc_d7`,
tri-states its redraw index by the fired distance (from `loc_71` − `loc_73`),
arms the sweep cells `loc_9f`/`loc_a1`, silences the channel-4 SFX timer
`SFX_TIMER_CH4` (0xb5) [seen], and clamps the shared vertical limit `loc_61`
into [0x10, 0xf0] before continuing into the mover seed [code].

### Head orientation and velocity steering

`steerHeadAndSeedVelocity` is the head's per-tick steering decision. It reads
the head's folded orientation `loc_40` and folded position `loc_70`: at the top
of the orientation range it guards the wrap, within a narrow band it goes
straight to the velocity-commit stage, and otherwise — only near the top of the
position range, on the right tick phase (`loc_00` == 0), for a young slot
(`loc_9a`-indexed length below 0x0b), when the RNG permits — it re-seeds the
head before committing. The `seedHead` helper writes a fresh orientation into
`loc_40`, a random small velocity (magnitude 2 when the slot is wide and the RNG
allows, else 1; sign from the RNG) into the head velocity seed
`HEAD_VELOCITY_SEED` (0x50) [code], a random position into `loc_70`, and clears
`loc_60`/`loc_80`. The `commitVelocity` helper either reseeds the whole wave
(when the `loc_43` control cell is live) or folds the seeded step onto the
running velocity `loc_60` — its direction chosen by `loc_ef` — and hands it to
the velocity store [code].

`advanceHeadOrientation` is the head's orientation routine, sharing one body
across two entries. The wrap guard `guardHeadOrientationWrap` unfolds the
orientation byte the caller forwards, returns once it reaches the top of its
range (≥ 0xfa), and otherwise re-seeds the wave state — a fresh
heading/velocity. The per-tick stepper `advanceHeadOrientationAndStampTile`
rotates the orientation by one of four values every 4th tick (folded through the
`loc_ef` mask into 0x30..0x33), resolves the tile the head faces at `loc_70`,
and — only when that cell reads in the band [0x3c, 0x40) — stamps a masked
marker back into it through the working tile pointer `TILEMAP_PTR_LO` (0x32)
[seen]. That conditional stamp is how the head eats a mushroom it walks into
[code]. `storeHeadVelocity` commits the head's new velocity into `loc_60`/`loc_8b`
and then branches on its zero-ness: a nonzero velocity advances the head
orientation, a zero velocity reseeds the wave [code].

### Column heading/dwell and the drifting row target

A separate small machine steers an object's vertical drift toward a row target.
`advanceColumnHeadingState` runs per frame, gated on the state flag `loc_43`
(none of the mask 0xaf bits set). With the heading `loc_41` in its high branch
it bails until the heading reaches the far edge and then re-arms the tick
countdown; in the low branch it steps the heading every 4th frame (wrapping past
a fold boundary keyed by `loc_f2`), ticks the dwell timer `loc_a1`, and on
wrap-through-zero conditionally swaps the column drift delta `loc_51` in and out
of its stash `OBJECT_X_DRIFT_STASH` (0xbe) [seen] — pausing or resuming the
horizontal drift — negates the vertical steer cell `OBJECT_Y_STEER` (0x81)
[seen] when a config bit and the RNG agree, and re-arms the dwell timer to 0x30.
Finally it folds the drift delta out of the row cell `loc_61`, mirrors it into
`loc_8b`, computes a summed heading from `loc_71` ± `OBJECT_Y_STEER` (sign by
`loc_ef`), and continues into the row-target steerer with that heading [code].

`tickColumnCountdown` is the countdown that heading branch re-arms: most ticks
just decrement `loc_a1`, and on wrap-through-zero it reloads a fresh random
interval (0x0f or 0x2f), re-arms the channel-4 companion timer `SFX_TIMER_CH4`
(0xb5) [seen] to 0x14, and re-arms `loc_41` to 0x14 folded with `loc_f2` [code].

`steerObjectRowTarget` commits a new row target `loc_71` and steers the drift
toward it. If the resolved tile cell at the target is occupied by a high tile
class it clears the cell and decrements the matching table entry (the object
having consumed a mushroom there). A retired column (`loc_61` == 0xff) just
reseeds the spawn state and returns. Otherwise it derives a keyed distance from
a BCD-reduced per-object counter (`loc_ab` indexed by `loc_88`, floored at zero,
halved and clamped, scaled), checks it against `loc_71` with the direction
selector `loc_ef`, and — combining that nearness test, the sign of
`OBJECT_Y_STEER`, and a same-column collision test at slot 0x0d — decides
whether to flip the drift cell before dispatching the distance-fold step [code].

### Spawning a fresh centipede and rebuilding its sprites

`seedSegmentSpawnState` is the init leaf that seeds the fixed spawn cells for the
object slot selected by `loc_88`. It derives a selector (2, dropped to 1 when
the slot's gate byte `loc_ab` is zero and a config-derived threshold clears the
`loc_a9` slot), stores it in `OBJECT_Y_STEER` (0x81) [seen], mirrors it via
two's-complement when a `POKEY_RANDOM` (0x100a) [seen] bit is set into `loc_51`,
folds a fixed key into the heading cell `loc_71`, and seeds `loc_61`, `loc_41`,
`loc_a1`, and `SFX_TIMER_CH4` (0xb5) [seen] to constants — RAM only, no live-out
[code]. `reseedSegmentSpawnState` chains that with the wave-start seed and falls
into the sprite-table rebuild spine, a straight-line reinitialise with no
branches [code].

`rebuildSegmentSpriteTables` rebuilds a segment's five 12-entry sprite tables
for the object selected by `loc_88`. When the gate `loc_94` is clear and the
counter `loc_9c` is at least 3, it ticks the length counter `loc_9a` (wrapping
0 → 0x0c) and resets it to 1 or 2 by `loc_ab`. It seeds the [0] entries (length,
negate flag from `loc_00`, the folded base `0xf8 ^ loc_f0`, and 0x80 into the
coordinate row) across `loc_34`/`loc_74`/`loc_44`/`loc_64`/`loc_54`, then in the
descriptor-copy loop copies the per-slot descriptor rows (`loc_43`, `loc_73`,
`loc_53`) into the tables for slots 1..length−1, the sign of each descriptor
picking the coordinate base. When the length counter is not yet full it
random-fills the remaining slots from `POKEY_RANDOM` and `loc_f4`, and finally
marks the slot rebuilt by writing 0x0c into `loc_94` and copying `loc_fe` into
`loc_97`. Two's-complement mirrors are inlined and the outputs are all RAM
[code].

### The shared no-op landings

Two trivial leaves absorb the "nothing to do here" exits of the walk.
`returnImmediately` and `returnNoop` do nothing observable — several
segment-done and no-op paths fold onto them so those paths share a single
return [code].

## Path / coordinate integrator + signed-delta math

This subsystem is the machine that turns a signed per-frame delta into smooth, clamped motion along a coordinate axis, and — on a separate track — grinds a segment's BCD position toward a target along a scripted path. Two spines run through it: a sub-pixel *movement integrator* that walks the `$63`/`$73` coordinate pair a fraction of a step at a time, and a *BCD path accumulator* that advances a target-relative decimal position and steps a phase index. Around both sit the small signed-delta arithmetic primitives that clamp, halve, negate, and fold-to-magnitude the bytes those spines consume.

### The signed-delta arithmetic primitives

Three tiny routines do the register-level math the spines lean on. `negateA` is the plain two's-complement negate, `A = (-A) & 0xff`, assuming binary mode `[code]`. `foldSignedMagnitude` is the tail of the classic 6502 "abs" idiom: it negates `A` only when the caller's sign input (the N-flag) says the value is negative, so with N reflecting `A` the effect is `abs(A)` — it recomputes nothing, it just threads the sign in `[code]`. `clampAndHalveSignedDelta` does the heavier lifting: it first snaps a delta to the playfield rails — values strictly inside `0x08..0xf8` fold to whichever rail (`0x08` or `0xf8`) is nearer, while both extremes pass through untouched — then arithmetic-halves the clamped value, replicating the sign bit into the vacated bit7 (the halved delta lands in Y), and packs the bit rotated out of the halve into A's bit7 with carry left clear for the caller's follow-on add `[code]`. That halve-with-remainder is what makes the motion sub-pixel: the dropped low bit is the fractional part carried forward, and the clear carry lets the caller chain the halved delta straight into an accumulate.

### The movement integrator spine

`loc_2ace` is the gated axis-delta integrator for the `$63` axis. It runs only while the master enable `$86` is non-negative and the `$43` control bits (masked `& 0xaf`) are clear; either condition returns it early `[code]`. When it does run it snapshots `$73` into `$8d`, swaps `$b9` with `$fe`, halves the *old* `$b9` toward the rails through `clampAndHalveSignedDelta`, and folds the halved magnitude into `MOVE_SUBSTEP_ACCUM_A` (`$84`) — the fractional accumulator for this axis `[seen]`. It then falls straight into its companion with the halved delta in A and the accumulate's carry live.

`loc_2aeb` is that companion, the `$73`-axis half of the pair `[code]`. It adds the incoming halved delta plus carry into `$63` and parks the running sum in `$8b`; then it resolves the tile cell at (`$73`, row 0). This is the collision gate: if that destination cell is occupied it reloads `$63` unchanged (the object does not move into a filled cell), and only an empty cell lets the summed coordinate through, clamped into the band `[$0b, $f4]` `[code]`. After the coordinate write it applies the same enable check on `$86`, then negates `$bb` (zeroing the source cell as it goes), halves that toward the rails, accumulates it into `MOVE_SUBSTEP_ACCUM_B` (`$85`) — the `$73`-axis fractional accumulator `[seen]` — and falls through with the newly halved delta and its accumulate carry.

`clampCoordToBand` is the next stage: it advances the `$73` coordinate by the delta (plus carry-in) and clamps the sum into the valid band, seeding `$8b = $63` first for a cell probe `[code]`. The band keeps the coordinate out of two dead zones — sums fold to `0x08`/`0x30`/`0xc8`/`0xf0` at the edges and pass through only inside `[0x08,0x31)` and `[0xc8,0xf1)` — but as in the companion, an occupied destination tile leaves `$73` exactly as it was. When the sign cell `$86` is non-negative it hands off to the routing follow-up; otherwise it returns `[code]`.

`routeByCoordDelta` is that follow-up, and it decides where the motion's bookkeeping lands based on the signed gap between `$72` and `$8d` `[code]`. The `$ef` flag inverts which side of the delta bails: when `($ef != 0)` matches `(delta >= 0)` it goes straight to the `$72`/`$62` fixup. Otherwise it takes the *magnitude* of the delta (via `foldSignedMagnitude`): a wide gap (`>= 5`) hands off to the arm-flag tail, while a narrow one falls through to the same fixup.

`loc_2b79` is the zero-page state fixup at the bottom of the spine: it derives `$72 = ($73 + (0x04 ^ $f0)) & 0xff` (a plain 8-bit add, carry cleared), mirrors `$62 = $63`, and falls into a second entry point `[code]`. That second entry — reached both by fall-through and as a sibling's carry branch — is the `$43`-mask gate tail, which arms `$42` to `0x28` whenever any of the `$43` mode bits (`& 0xaf`) are set `[code]`. This is why `routeByCoordDelta` can route directly to the tail for a wide gap: it wants only the `$42` arming, not the `$72`/`$62` rewrite.

### The BCD path accumulator spine

The second spine advances a segment's decimal position toward a scripted target. `advancePathAccumulator` is its core `[code]`. While enabled (`$86` non-negative) it preserves the caller's index in `$8d`, then folds the per-step delta held in `$8b` into the low word of the accumulator — `$a7`/`$a9` indexed by `$88` — using NMOS-faithful BCD adds, and rolls the companion pair on a decimal carry: `$a1` steps down by two (BCD subtract) and `$ab` up by one. It then does a 16-bit binary compare of the accumulator (`$ab:$a9`) against the target (`$af:$ad`); until that reaches the target it simply returns. Once reached, it advances the target by an indexed 16-bit table step — the low byte from the shared table reader, the high byte from the table at `$21c0` offset by an index derived from bits 5-4 of the mode byte `$fd` `[seen]` — and bumps the phase index `$a4`. A phase below `0x06` increments, arms the ch2 priority SFX timer `$b6` to `0x11`, and redraws the grid side borders; a phase above `0x06` is out of range and spins forever, leaving the watchdog to fire `[code]`. (Counterintuitively, `$a4` here is a live phase *counter* advanced each time the target is met, not a static index.)

Several routines are front doors onto that core. `decrementActiveObjectDelay` saves the caller index into `$8d`, indexes the delay bank `$94` by the active-object selector `$88`, ticks that entry down by one, and falls straight into `advancePathAccumulator`, passing the step through `[code]`. `loc_3037` stashes Y as the step addend at `$8b`, seeds the accumulator with A = 0, runs the BCD advance, and falls into `loc_303e` `[code]`; `loc_303e` arms the timer cell `$b2` to `0x13` and frees slot X's row byte (`$34+x = 0xff`, high bit set) before falling into `loc_3046` `[code]`; `loc_3046` runs the `loc_2b79` zero-page fixup and falls into the spawn-cadence tick `[code]`. So a single entry near the top of this chain both advances the path and resets the per-slot timer, row, and fixup state around it.

`maybeDecrementTableEntry` is a sibling counter-maintenance step: it forms `v = ($32 & 0x1f)` from the working tile pointer low byte `[seen]` and picks a band from `$ef` — when `$ef == 0` it decrements only if `v < 0x0c`, otherwise only if `v >= 0x14` — and when in-band it decrements the zero-page table byte at `$d7 + $88`, the effective address wrapping within page 0 so a decrement of zero wraps to `0xff` `[code]`.

### The layout/spine driver

`loc_2119` ties the two spines into the per-frame layout pass, and runs only while `$86` bit7 is set `[code]`. It primes the layout-draw cells `$91`-`$94`, drives the pointer/config row writers, and then — provided `$00` bit7 and the `$43` mode bits are clear — clamps two targets into their bands and steps each through a movement spine: it derives the `$53` target from `$63`'s band and steps it through `loc_2aeb`, then derives the `$83` target from `$73`'s band (snapshotting `$73` into `$8d` first) and steps it through `clampCoordToBand`, each with a cleared carry. Finally it runs the tail-writer pass, which invokes `routeByCoordDelta` and then folds an EOR checksum of the 20-byte block at `$2120` into `$fe` `[code]`. When the `$43` mode bits are set instead, it skips the target clamps and jumps straight to that tail-writer pass.

## Playfield grid, tiles + mushroom seeding

The playfield is a tile-map grid held in video RAM, addressed through a single 16-bit working cell pointer whose low and high bytes live at $32 and $33 [seen]. Every routine in this subsystem reaches a grid cell the same way: it composes those two bytes into an address and reads or writes one byte there. The byte's value is the tile: a zero means the cell is empty, and a stamped mushroom (or solid) glyph is written as `0x3f ^ $ef` [code]. That `$ef` fold mask is the recurring hinge of the whole subsystem — it is XORed into almost every stamped byte and it also selects which column thresholds count, so one body of code paints both the upright and the mirrored (flipped-cabinet) orientation without branching into two copies [code]. Wherever you see `0x3f ^ $ef`, `0x1f`, or `0x00` being written, that is a mushroom/solid tile, a border tile, or a blank.

The grid is brought to life by `resetPlayfieldAndSeedMushrooms` [code], the routine that clears the field and lays down the random mushroom carpet. It first writes the fixed value `0x0f` into the playfield colour cell $1404 [seen], clears a scratch cell and the $c2 slot, and fans the first colour record out through `loadPaletteRecordPair` so the palette is defined before anything is drawn. It then zeroes the four video/object pages $0400, $0500, $0600 and $0700 [code] a byte at a time, wiping any prior field. The heart of the routine is a 46-column sweep (the outer counter runs 0x2d down through 0x00). For each column it builds a pseudo-random cell pointer into $8d/$8e by folding the POKEY hardware RNG at $100a [seen] against a cycling column stride in $8b (which walks 0x1b down to 0x02 and wraps), so the mushroom positions are scattered but reproducible only while the poly counter sits at its origin — this is a clock-free layer, and the random draw is only stable when that counter is idle [code]. Each drawn cell is a mushroom stamped as `0x3f ^ $ef`; before stamping, the routine decides whether that (empty) cell should bump a per-column tally in the $d7 array — the index it thresholds is `$8d & 0x1f`, and whether the comparison is "below 0x0c" or "at least 0x14" flips on whether $ef is zero, i.e. on the orientation [code]. When the sweep finishes it has no return of its own; it flows straight on into `seedPlayerShotStartCells`, so the shot/start seeding is part of the same reset act [code].

`loadPaletteRecordPair` [code] is the colour half of that setup. Indexed by X, it reads a three-byte record out of the ROM palette table at $2676 [code] and fans it into two palette triples in a fixed permutation: for a record `[b0, b1, b2]` it writes `b2` into $140e and $1406, `b0` into $140f and $1405, and `b1` into $140d and $1407 [seen] — triple A being `(b0, b2, b1)` and triple B `(b1, b2, b0)`. Those six palette RAM cells are read by the video layer, which is why they never appear in the state diff. `seedPlayerShotStartCells` [code] is the init leaf the reset falls into: it plants six fixed player/shot start cells, three of them ($43, $73, $72) EOR-folded against the orientation bytes $f0–$f2 so the launch coordinates mirror for a flipped cabinet, while $63 and $62 take the plain un-mirrored midline seed of 0x80 [code].

The grid's frame is drawn by `drawGridSideBorders` [code], which paints the two vertical side runs of the play border. It builds a 16-bit draw cursor in $91/$92 by folding fixed constants against the $f6/$f7 orientation bytes, then walks a fixed six-cell run (the count lives in $8b), handing each cell to the shared cell-writer with a glyph chosen by the sign of a down-counter: a `0x1f` border tile while the counter is non-negative, a `0x00` blank once it goes negative. The whole thing runs twice — the second run uses the opposite constants and starts its counter at `6 - $a6` with the glyph polarity inverted, so the two runs address opposite sides and taper their border-versus-blank split from opposite ends [code]. The starting offsets in $a5 and $a6 are therefore what shrink the play area's sides as the field narrows.

Two routines form the shared machinery for touching one arbitrary cell. `resolveTileCellAtXY` [code] is the "test-and-position" helper: given a screen X in A and a row in Y, it computes the column as `A>>3` (rounded by bit 2), folds the row into $8b as `Y*8`, and rolls the row's top bits into the pointer high byte, applying a vertical clamp and a top-row wrap special case, so it leaves a valid, on-grid cell pointer in $32/$33. It then fetches that cell and returns it in A (0 for empty, else `cell ^ $ef`) with the zero/negative flags set from it, which is how its callers branch on empty-versus-occupied [code]. `stampEmptyTileCell` [code] is the write counterpart: it reads the cell already pointed to by $32/$33 and does nothing if it is occupied, so an existing mushroom is never overwritten. Otherwise it looks at the low-five-bit column code from the pointer low byte, refuses the two edge columns (0 and 0x1f) outright, and — again keyed on whether $ef is zero — excludes one further column per orientation and decides whether this column both bumps the per-slot counter in the $d7 array (indexed by the actor slot in $88) or merely writes. When it does write, the stamp is once more `0x3f ^ $ef` [code].

Objects lay mushrooms as they move, and that path runs `stampGridCellAtObject` [code]. It stashes the object's cell value into $70; if the $f0-folded value is tiny (below 4) it treats the object as having reached the edge and re-seeds the wave instead of stamping. Otherwise it runs a slot-12 range/collision check and two low-bit frame gates (bits of the frame counter $00 and of the POKEY RNG), and only on a fully clear pass does it resolve the grid cell directly under the object — using column `(0x04 ^ $f3) + $70` at row 0 — and stamp it through the pair above [code]. Feeding that is `loc_2059` [code], a gated per-object state step: it bails unless the $43 mask is clear and the object's $ef-folded X and $f0-folded Y offsets fall inside their bands (with an extra per-slot bounds test against the $9a/$ab/$d7 arrays when the object is near the top edge), then cycles the $40 attribute every fourth frame, copies $60 into $8b, steps $70 by ±$80 with the sign taken from $ef, and continues into `stampGridCellAtObject` with that stepped value [code]. `loadObjectTileInputs` [code] is the small marshaller this family uses: for one object slot it copies the slot's base byte into scratch $8b, derives a ±1 step (0xff when the heading byte's sign bit is set, else 0x01) into Y, and loads the slot's coordinate byte into A, packaging the position and heading for a tile-cell probe.

Cells are also erased and reseeded by a slow field walk. `scanForRangedCellAndSeed` [code] runs only once every eighth frame and only when the ch1 priority cell $b7 is clear [seen], then walks the 16-bit field-scan pointer $da/$db [seen] forward through the cell stream. It stops at the first cell whose low six bits land in the `[0x38, 0x3f)` band — a "ripe" range — erases it by writing `0x3f ^ $ef`, advances an accumulator spine, and turns the pointer's stream position into a pair of seed coordinate cells ($8b/$6f and $5f) by folding the address up three bits and inverting its low bits, so a new object can be spawned where the scan landed [code]. The walk is boundary-guarded: a zero high byte or the top-of-page fold ends the pass, and a pointer that wraps all the way around hands off to the table-column draw rather than looping [code].

Finally, `transposeScreenBitmap` [code] treats the whole tile grid as a monochrome bit image and rotates it. It walks the 32×30 map eight tiles at a time from the video base, packing each group of eight cells into an 8-bit mask (a bit set when the tile's low six bits reach the solid glyph band, `>= 0x38`), swaps that mask through a one-column scratch buffer at $0100 — which shifts the image one column per pass — and writes the swapped-in column back out, rendering every cell as either a blank `0x00` or a solid `0x3f ^ $ef` tile [code]. It pages the pointer high byte up on each row wrap and stops once it has covered all of video RAM (high byte 0x07, low reaching 0xc0) [code].

## Object marshalling, slot arming + text/record plotting

This subsystem does three jobs that share machinery: it lays glyphs and numbers into video RAM through a single moving draw cursor, it keeps a key-sorted table of the active objects, and it arms the per-slot timer/flag block when an object comes into range. The plotting primitives sit underneath everything else, so they come first.

### The draw cursor and the byte-plot primitive

Every character this subsystem draws goes out through one 16-bit output cursor held at `loc_91`/`loc_92`, and `writeMaskedByteAndAdvancePointer` is the single store step [code]. It reads the byte to lay down, XORs it with the mask cell `loc_ef` (a zero byte is a special case — it is stored unmasked, so a blank stays blank regardless of the mask), and writes it through the current cursor value. Then it advances: the low half of the cursor steps by a flip-aware stride of `0x20 ^ mask`, and any carry out of that low-byte add rolls into the high half together with a per-column high adjust taken from `loc_f3`. The routine hands back the high-byte advance carry-out as its exit carry, which matters because the row-drawing loop above it uses that carry to thread digit state from one plotted byte to the next. Callers seed the cursor once and then call this repeatedly to walk a column of tiles down the screen. `plotZpTableByteAtCursor` is the thinnest wrapper on top: it reads one source byte from the zero-page table at `loc_1a` indexed by Y and plots it, laying a table byte per call without returning the byte.

### Normalizing characters and printing digit pairs

`plotNormalizedCharCode` maps a raw character or nibble code to its font-tile code before plotting. With carry clear the input is treated as a plain character and bit 5 is folded on; with carry set it is treated as a hex digit, keeping only the low nibble and folding bit 5 on unless the nibble is zero. Either way a code that has climbed to `0x2a` or above is wrapped back down by `0x29`, and the normalized byte is handed to the store primitive. Its exit carry is deliberate: it is set only when the entry carry held and the low nibble was zero — the "this digit was a leading zero" signal that lets a caller blank leading zeros across a multi-digit field.

`plotByteAsTwoDigits` prints one byte as its two nibble digits, high nibble then low, each through `plotNormalizedCharCode` [code]. The entry carry picks digit mode for the high nibble; the low nibble inherits that carry only when the high nibble was itself a zero digit, otherwise its carry is cleared. Its own exit carry is set only when the whole byte was zero in digit mode, so a chain of these carries the leading-zero suppression forward across a whole number.

### Rows from the pointer-descriptor table

`writePointerTableRow` draws one row of a screen layout from a ROM descriptor [code]. A selector in A plus the low two bits of the mode/config cell `CONFIG_DIP_BYTE` [seen] index the ROM row-descriptor pointer table at `loc_346d` [seen] to fetch a descriptor pointer; the selector's top bit is meanwhile rotated into the sign cell `loc_8c`, which the emit loop reads as a blank-out flag. The descriptor's first word is the emit-target cursor (taken from offset 0 when `loc_ef` is zero, else offset 2), and the tile codes begin at descriptor offset 4. The shared emit loop then walks the descriptor: it keeps each byte's low six bits, forces the byte to blank on the `0x20` space code or whenever the sign cell is flagged negative, folds a `0x30`-range code down into the `0x20` range, and stores it through the cursor primitive — ending the row at the first descriptor byte whose top bit is set. `rewritePointerTableRowFromStart` re-enters that same loop at descriptor offset 0 keeping the current descriptor, and `redrawPointerTableRowUnblanked` uses it to redraw: it clears the blank/sign cell `loc_8c` first so the re-emit draws the row unblanked [code].

### The higher-level readouts

Three routines compose the primitives into full readouts. `readFdBitsTableByte` is a small helper they lean on: it takes bits 5–4 of `CONFIG_DIP_BYTE` [seen], shifts them to an even index of 0/2/4/6, and returns that byte of the ROM table at `loc_21bf` [seen] in A with the index in Y so a caller can reuse the same index against a parallel table [code].

`plotConfigTableRow` draws a config-selected line [code]. It reads the first table byte via that helper and the adjacent parallel-table byte from `CONFIG_PARALLEL_TABLE` [code], stashing them in `loc_ae`/`loc_b0`. It lays a fixed layout row first (selector 6), then plots the parallel byte as a glyph and the first byte as a digit pair, and finishes with a trailing zero printed as a digit pair — the digit printer's exit carry feeding forward through the chain so the layout row's carry seeds the glyph, whose carry seeds the first print, whose carry reaches the tail zero.

`plotObjectCoordinates` prints an object's coordinate bytes as decimal [code]. It seeds the cursor's flip masks at `loc_91`/`loc_92` from the flip cells `loc_f5`/`loc_f7`, then feeds each coordinate byte to the two-digit plotter — a high pair, an optional middle pair drawn only when `loc_89` is not 1, then the low pair — carrying the first-and-last-digit mark of each pair through as the digit-mode carry, and tail-plots the final byte with carry cleared.

`plotRecordFieldColumns` lays out the sorted object table itself as a column-by-column grid [code]. It draws a header row (selector 7), then walks the three-byte records in threes: for each record it seats the cursor at the running column base with high byte `0x05`, prints the record's three fields as digit pairs (the first field's leading-zero carry inheriting into the second field, the third cleared), writes a blank separator cell, and plots three glyph bytes for the record out of the zero-page table via `plotZpTableByteAtCursor`. The next column base is derived from the advanced cursor's low bits, and the walk ends once the record index reaches `0x18`.

### Object marshalling — the sorted slot table

`buildSortedObjectTable` maintains that record table [code]. It opens by marking two high-water cells `loc_c1`/`loc_c2` to `0xff`, then advances two multi-byte rate accumulators in NMOS decimal (BCD) arithmetic: the wider accumulator at `loc_018e`–`loc_0191` ticks up by the `loc_fb`/`loc_fc` delta, and only when it does *not* carry out of its top does the narrower accumulator at `loc_018b`–`loc_018d` advance by the `loc_89` rate — so the wide accumulator's overflow gates its partner. It then inserts each of the two active objects into the table by a 24-bit key assembled from the object-field triple at `loc_a8`/`loc_aa`/`loc_ac`: scanning the three-byte slot records at `loc_02`, the first slot whose key is smaller than the object's takes it. `insertSlot` opens that slot by shifting every record above the insertion point up by one three-byte record (copying the parallel `loc_17`/`loc_1a` block in step), seeding the vacated head record to `01 00 00`, and writing the object's three key bytes into the freed slot. A trailing clamp bumps the high-water mark `loc_c2` by three when it is non-negative and still at or above `loc_c1`, capping it at `0xff` once it reaches `0x18`; and when both marks stay negative it clears `loc_01` and calls `plotRecordFieldColumns` to redraw the whole grid.

`copyZpStateToSnapshot` is the companion that lets an integrity check read a stable copy of this state [code]. It marks the same two flag cells `0xff`, copies two nine-byte zero-page blocks (`loc_02`… and `loc_1a`…) up into the page-1 snapshot buffer at `HIGH_SCORE_TABLE` [seen] and `loc_0181`, then folds that snapshot into the running checksum; the returned delta is dead at its caller.

### Slot arming — range test then stamp

`armSlotWhenObjectInRange` decides whether object X is close enough to the reference point to arm its slot [code]. It measures the horizontal distance `|loc_54,X − loc_63|` and the vertical distance `|loc_64,X − loc_73|` as signed magnitudes; the horizontal magnitude must clear its bound (`0x0a` for slot `0x0d`, otherwise `0x07`) and the vertical must clear `0x07`, and any miss bails with carry set and no writes. On a hit it stashes the horizontal magnitude in `loc_8d` and passes the summed distance on to the arming step — routing slot `0x0d` through the value-gated entry `enterArmBlockUnlessValueHigh` and every other slot straight into `armSlotState` with carry set when the summed distance is `0x0c` or more. `enterArmBlockUnlessValueHigh` is a compare-first shim: it arms only when the passed value is below `0x0e`, threading X through to the stamp and letting the arm block decide the rest.

`armSlotState` is where the stamp lands. It is caller-gated by its entry carry: with carry set it is a no-op that touches nothing, and only with carry clear does it write. When it fires it stamps a batch of fixed constants into `loc_87`/`loc_43`/`loc_42` (`0x30`/`0x20`/`0x28`), retires slot X's row byte by writing `0xff` at `loc_34+X`, and — unless the sign cell `loc_86` is negative — arms the channel-1 priority SFX timer `SFX_TIMER_CH1_PRIORITY` to `0x13` [seen]. It then clears a small block of per-object working cells, including the companion SFX timers `SFX_TIMER_CH2`/`SFX_TIMER_CH3`/`SFX_TIMER_CH4` [seen], and returns carry clear.

### Seeding and broadcasting the state block

Two routines drive the `loc_ef`–`loc_f8` state block that governs the plotting masks and the flip latch. `seedStateBlockConstants` stamps that block back to its fixed startup constants, sets the flip-screen latch `FLIP_SCREEN` to `0x80` (bit 7 set) [seen], mirrors that write to the dead store `loc_2400` [code], and clears the `loc_bd`/`loc_bf` pair — a straight-line seeder with no branches or inputs [code]. `broadcastByteToStateBlock` is its per-frame counterpart: it reads one source byte from `loc_fe` and fans that same value across the whole block plus the `loc_bd`/`loc_bf` pair, driving the flip-screen latch `FLIP_SCREEN` [seen] from bit 7 of the value and mirroring the same write into the dead store `loc_2400` [code]. Where the seeder writes distinct constants, the broadcast sets the block to a single uniform value.

## Frame IRQ, trackball + sprite shadows

This subsystem is the frame interrupt: a single pass that samples the trackball, advances the frame clocks, and rebuilds every object's sprite-shadow row before acknowledging the interrupt. Four routines form one continuous machine — `serviceFrameIrq` is the front, `buildObjectShadowEntry` and `storeSpriteShadowEntry` walk the object table, and `accumulateTrackballAndReturnFromIrq` is the tail — and they hand control to one another in a fixed order each time the interrupt fires. `stepAxisBySelectorBits` is a small pure helper the front leans on. All four routines are certified [code], described from their behaviour.

The front, `serviceFrameIrq`, opens by checking the shared reload timer `SEGMENT_RELOAD_TIMER` [seen]: while that cell is nonzero it keeps a sound cue alive by loading the POKEY channel-2 frequency and control registers `AUDF2`/`AUDC2` [seen] with a fixed pitch and volume. This runs on every slot, armed or not, so the tone tracks the timer rather than the frame beat.

The real work is gated on the 32V beat — bit 6 of the input latch `IN0` [seen]. Off the beat there is nothing new to integrate, so the front passes straight to the interrupt tail. On the beat it advances the frame clocks: the short watchdog counter `loc_8a` [code] and the running frame counter `loc_00` [code] both increment, and when `loc_00` wraps to zero it carries into `loc_01` [code] and into a packed-decimal companion pair `loc_fb`/`loc_fc` [code], which are bumped through a BCD add so the frame count is also available in decimal form. Two sanity limits guard against a runaway: if `loc_8a` [code] has reached 8, or the object limit `loc_c8` [code] is out of its valid range, the machine treats it as a hung frame and halts; a merely-high `loc_c8` is clamped back down to 18. These are counters and live limits, not static constants.

The front then reads the trackball. It takes the current object index `loc_88` [code] and pulls an axis-selector byte from the input port `IN0+3` [seen], pre-shifting it left a nibble for object 2 so the relevant selector bits land in the top of the byte. `stepAxisBySelectorBits` decodes the top two bits of that byte into a one-step nudge of a carried step value: the `0x` selector steps the value down, clamped into the `0xfa..0xff` window; the `10` selector steps it up, clamped into `0x01..0x06`; the `11` selector zeroes it. It then shifts the selector byte left twice so the next pair of bits is ready, and returns both the stepped value and the shifted byte without touching memory. The front applies this twice: axis 0's stepped value is written back to `TRACKBALL_AXIS0_STEP_STATE` [seen] and folded into accumulator `loc_b9` [code]; the shifted byte drives axis 1, whose stepped value is written to `TRACKBALL_AXIS1_STEP_STATE` [seen] and folded — negated — into `loc_bb` [code]. These two step-state cells are the per-axis memory carried between frames.

Before descending into the shadow builder, the front normalizes the current object's angle cell `loc_c2+xObj` [code]. If bit 7 is set the cell is treated as an animating angle: it advances by 3 and wraps back to 0 at 42, so it is a live phase counter rather than a fixed value; if instead bit 6 is set the cell is simply masked to its low six bits. Either way the resulting angle is used to refresh the object's palette pair. The front then enters the shadow builder for the full object range.

`buildObjectShadowEntry` does one object's shadow refresh, indexed by X. It copies the object's vertical field `loc_64+x` [code] straight into the high shadow row `SPRITE_SHADOW_VPOS+x` [seen]. It then builds the horizontal shadow: it starts from `loc_54+x` [code] and, for every object except index 13, folds in the sign of `loc_44+x` [code] by adding one when that field is negative; the result lands in `SPRITE_SHADOW_HPOS+x` [seen], and the captured sign bit is held in the sign latch `SHADOW_SIGN_LATCH` [seen] for use a moment later. What happens next depends on the self-test input, bit 5 of `IN0` [seen]. In normal play the tile/attribute source `loc_34+x` [code] is passed through untouched to the store tail. Under self-test the routine derives a substitute value from `loc_34+x`: high object slots use the cell as-is; for the low slots, a value already at or above `0x30` in the low six bits is kept, otherwise the low nibble is stashed in `SHADOW_TILE_LOW_NIBBLE` [seen] and combined with a small offset chosen from the low three bits of the vertical field `loc_64+x` [code]. Whatever substitute results is XORed with the held sign latch before being handed on — this is the path that lets the self-test exercise the shadow table with derived patterns rather than live tile codes.

`storeSpriteShadowEntry` is the tail of the object loop. It writes the value it was handed into the object's code row `SPRITE_SHADOW_CODE+x` [seen], then builds the matching attribute byte from bit 6 of `loc_34+x` [code], raising a floor for the low object slots, and stores it OR'd with a fixed base into `SPRITE_SHADOW_ATTR+x` [seen]. It then decrements the object index; while the index stays non-negative it loops back into `buildObjectShadowEntry` for the next object, and only when the index underflows does it fall through to the interrupt tail. These four shadow rows — code, horizontal, vertical, attribute — are the per-object table the display picks up from RAM.

`accumulateTrackballAndReturnFromIrq` is the tail every path converges on, and it splits on the self-test bit of `IN0` [seen]. Under self-test it runs the spine service, mirrors three cells of `loc_c5` [code] out to the output latch `loc_1c00` [seen], and folds a checksum across a ROM table at `loc_2003` [seen]; a nonzero checksum only stashes a marker byte in dead stack scratch, since a good image sums to zero. In normal play it instead maintains a diagnostic display: while its high bit is clear it increments the counter `loc_d5` [code], resets that counter to zero on the 32V edge of `IN0` [seen], and ramps the four diagnostic palette cells at `PALETTE_COLOR_04` [seen] from a shifted, carry-propagated copy of the counter, so those cells cycle colour as the counter climbs. Whichever branch ran, the tail then integrates the raw trackball counters a second way: for each axis it reads the raw counter from `IN0+x` [seen], subtracts the previously-sampled value held in `loc_bd+x` [code] to get a signed nibble delta, and refreshes that sample cell. The delta is sign-extended, then hysteresis-filtered against the last committed delta in `TRACKBALL_LAST_DELTA+x` [seen]: a sudden reversal that disagrees with the raw counter's own sign is rejected and the previous delta is reused, which suppresses jitter at the direction change. The accepted delta is committed back to `TRACKBALL_LAST_DELTA+x` [seen] and folded into the per-axis accumulator `loc_b9+x` [code]. Finally the routine writes to the interrupt-acknowledge port `IRQ_ACK` [seen], clearing the interrupt so the next frame can fire.

## Sound channels + EAROM NVRAM access

Two unrelated pieces of hardware share this corner of the machine: the four-voice POKEY sound chip, driven once per frame from a bank of countdown timers in zero page, and the ER2055 EAROM that keeps the high-score table alive with the power off. The sound path is pure output — it consumes state and pushes bytes at the audio registers. The EAROM path is slow serial I/O, spread across many frames because the chip needs real time to erase and burn each cell.

### The per-frame POKEY updater

Every frame `updateSoundChannels` refreshes the four POKEY voices. Its first act is a global mute check: it reads the master audio flag `$86` [code], and if that byte is negative it zeroes all four control/volume registers `AUDC1`..`AUDC4` [seen] and returns. Clearing the control registers rather than the frequency registers is what actually silences the chip — a POKEY voice with volume zero makes no sound regardless of its pitch — so this one branch is the machine's kill switch for all audio at once.

When audio is live, it latches the frame counter `$00` [code] and walks the voices in turn. Each voice is fronted by a sound-effect countdown timer in zero page, and the shape is always the same: while the timer is nonzero, decrement it, use its value to index a pair of ROM byte tables, and copy one byte into that voice's frequency register and one into its control register; when the timer has run down to zero, leave the control register at zero so the voice falls silent. The timer is thus both the "how far into this effect are we" cursor and the on/off gate, and the ROM tables are the recorded envelope the effect plays back one step per frame.

The highest voice, feeding `AUDF4`/`AUDC4` [seen], runs off timer `$b5` [seen] but only on odd frames (`$00 & 1`), so it advances at half rate. It is also the one voice that wraps rather than simply stopping: when its decrement reaches zero the timer reloads to `0x14`, making it a free-running loop instead of a one-shot. Its two bytes come from the tables at `0x3187` (frequency) and `0x319b` (volume) [code]. On even frames it is left untouched, holding whatever it last wrote.

The next voice, `AUDF3`/`AUDC3` [seen], runs off timer `$b4` [seen] every frame. It reads its frequency from the table at `0x317c` [code] but, unlike the others, does not table-lookup its volume — while active its control register is pinned to the constant `0x64`, so this voice always plays at one fixed loudness and only its pitch is animated.

Voice two, `AUDF2`/`AUDC2` [seen], is the busiest and is chosen by a small priority ladder. First comes the pitched pre-empt timer `$b6` [code]: if it is armed, the voice is claimed for a "pitched" effect, but it is gated on `$00 & 7` so it only advances every eighth frame. On its frame it decrements, and as long as it has not yet hit zero it plays a value from the table at `0x31af` [code] with volume `0xa4`; on the frame it reaches zero it releases its claim and falls through to the decision below. If `$b6` was already idle the code goes straight to that decision.

That decision is a collision/skitter router built from three game-state comparisons, each derived from a running cell XORed against a companion cell: `$70 ^ $f0`, `$43 & 0xaf`, and `$40 ^ $ef` [all code]. If `$70 ^ $f0` is at least `0xf8`, or `$43 & 0xaf` is nonzero, or `$40 ^ $ef` is `0x34` or more, the voice is handed to the `$b3` effect (below). Otherwise the difference `$40 ^ $ef` picks between two textures. In the band from `0x20` up to `0x34` it plays the `$b8` sweep: `$b8` [code] is a free-running counter that counts down and, on hitting zero, reloads to `0x14` — worth stressing that `$b8` is this self-reloading cursor, not a static base — and its current value indexes the table at `0x31c0` [code] into `AUDF2`, again at volume `0xa4`. Below `0x20` there is no table at all: it builds a noise pitch arithmetically from `$70 ^ $f4` [code] — shift right one, complement, force the top bit set — and writes that into `AUDF2` at volume `0xa4`. The forced high bit keeps the value in the upper half of the frequency range so the noise stays in a fixed register no matter what the game state was.

The `$b3` effect that all three collision comparisons route to is the ordinary timer-driven voice for channel two, off timer `$b3` [seen], reading frequency from `0x316e` and volume from `0x3175` [both code], and going silent when the timer expires. Notice that when a comparison sends control here but `$b3` itself is idle, the net result is silence on this voice — the router decides *that* a collision sound should play, and `$b3` decides *whether* one currently is.

Voice one, `AUDF1`/`AUDC1` [seen], is shared between two timers by priority. The priority timer `$b7` [seen] wins when it is armed; otherwise the plain `$b2` timer [code] drives the voice. Both read the same ROM tables, frequency from `0x3148` and volume from `0x315b` [both code] — the two timers play the same recorded effect, so `$b7` is simply a higher-priority trigger for it. The `$b2` path runs every frame. The `$b7` path is gated on `$00 & 3`, advancing only every fourth frame, and it applies one twist: when its looked-up volume is nonzero it is nudged up by `2`, so the priority version of the effect plays slightly louder than the background `$b2` version. Both go quiet as their timer reaches zero.

### Reading one EAROM cell

`readEaromCell` performs a single serial read of the ER2055 high-score NVRAM. The chip is exposed through three memory windows: an address/data latch base `$1600` [seen], a control register `$1680` [seen], and a data-out window `$1700` [seen]. To read cell X the routine writes to `$1600 + X`, which latches the address X into the chip, then bit-bangs the control register through `0x08`, `0x09`, `0x08` — read mode with the clock taken low, high, then low again. It is that final falling clock edge that makes the chip latch the addressed cell into its data-out register; the byte is then read back from `$1700 + X`. Finally the control register is written `0x00` to release chip-select and clock. The fetched byte is what the caller wants.

### Flushing the high-score mirror back to NVRAM

`tickEaromWriteback` [code] is the slow background machine that copies the RAM high-score mirror at `$0178` [seen] back into the EAROM, at most one slot per pass, because erasing and writing a cell each take a whole phase of real chip time. It runs only every fourth frame, keyed off `$00 & 3` [code]; on the other three frames it returns immediately, and on the frame it does run it first writes `0` to the control register to make sure the chip's control lines are released before it starts.

Two zero-page cells hold its state: a cursor `$f9` [code] pointing at the slot under consideration, and a phase word `$fa` [code] whose bottom bit selects which half of the erase/write cycle to perform. If the cursor's high bit is set, nothing is pending and it returns. Otherwise it shifts `$fa` right by one to consume the current phase bit, and branches on the bit it shifted out.

When that bit is set, it is the *commit* half: the byte staged on the previous pass is now burned in. It writes `0x02` to the control register to arm a write, then `0x0a` to strobe the commit, and steps the cursor down one slot so the next pass considers the neighbour.

When the bit is clear, it is the *scan/erase* half. It walks the cursor downward looking for the first slot where the NVRAM disagrees with the RAM mirror. For each slot it reads the live cell out of the chip, compares it against the mirror byte at `$0178 + X`, and if they match it steps X down and keeps scanning; if X runs off the bottom (its high bit sets) every slot already agrees and it parks the cursor there with nothing pending. The moment it finds a mismatch it stops on that dirty slot: it parks the cursor on X, writes `0x06` to the control register to arm an erase, latches the RAM byte it wants to persist into the chip's address/data window at `$1600 + X`, and strobes `0x0e` to erase the cell. It then bumps `$fa` so the next pass through this machine takes the commit half and actually writes the freshly-erased cell. Splitting erase from write across two passes is what keeps each frame's work bounded to a single chip operation, so persisting the whole table costs many frames but never stalls the game.

## High-score table + display

The high-score subsystem keeps a 64-byte block of RAM as a live mirror of the game's ER2055 NVRAM, guards that mirror with a rolling checksum, and paints its contents on the operator self-test screens. The block begins at `HIGH_SCORE_TABLE` (0x0178) [seen], and its last used byte is the integrity fingerprint `HIGH_SCORE_CHECKSUM` (0x01b5) [seen]; folded in at `table+0x12` is a `HIGH_SCORE_CONFIG_BYTE` (0x018a) [seen] snapshot of the machine's option settings.

**Loading the mirror.** `loadHighScoreTableFromEarom` walks the index X from 0x3f down to 0, reads each NVRAM cell, and stores it into the RAM mirror so that the rest of the machine sees the persisted table as ordinary memory [code]. The step that matters comes after the loop: X has by then decremented past zero and wrapped to 0xff, and that 0xff is parked into the writeback cursor `loc_f9` — the sentinel meaning "no dirty slot pending" [code]. This is the point of loading fresh from the device: the mirror now agrees with NVRAM byte-for-byte, so the background writeback ticker has nothing to flush and must be told so explicitly.

**The checksum.** `foldHighScoreChecksum` is the cheap integrity probe the rest of the subsystem leans on. It seeds an accumulator with 0xff and XORs the 61 table bytes (offsets 0x3c..0) into it, reads whatever checksum was stored last, overwrites `HIGH_SCORE_CHECKSUM` with the fresh fold, and reports back `old ^ new` [code] — the delta between this fold and the previous one, which is zero exactly when the table is unchanged. The counterintuitive point for a reader: the value handed back to callers is that *delta*, not the checksum itself; the freshly computed checksum has already been published into 0x01b5 as a side effect [seen], and the old byte is surfaced separately so a caller can decide to restore it.

**Boot-time integrity gate.** `validateOrResetHighScores` [code] runs the table through a short gauntlet at power-up and comes out having either promoted the top entry into the zeropage working copy or wiped the table clean. It first copies the ROM template `HIGH_SCORE_INIT_TABLE` (0x3a69) [seen] into the zeropage staging area at `loc_02` [code]. Then it takes the checksum probe: any nonzero delta means the stored bytes no longer fold to their recorded checksum — a corrupt or first-boot table — and it jumps straight to the clean-table path. Surviving that, it recomputes the option snapshot as `CONFIG_DIP_BYTE` (0x00fd) [seen] masked with 0x7c, compares it against the stored `HIGH_SCORE_CONFIG_BYTE` before overwriting it, and, if the operator has changed the relevant DIP settings, records the new snapshot and bails without rebuilding — the scores are kept but not promoted, because they belong to a different configuration. It then treats a zero at `loc_017a` [code] as an empty leading entry and resets. Finally it validates the nine bytes of the top entry (X = 8..0): each byte is staged into the zeropage copy, and any byte ≥ 0x9a or with an illegal BCD low nibble (≥ 0x0a) is proof of garbage and forces the reset; a clean byte lets the paired secondary entry at `loc_0181` be promoted into `loc_1a` [code]. The reset path itself, `zeroFillAndRecordConfig`, zeroes the table bytes (0x3e..0) and stamps the current config snapshot so the freshly blanked table is immediately consistent with the machine's options [code].

**Display on the self-test screens.** The table is surfaced to a human only on the operator self-test, which is reached while the service switch is held. `selfTestChecksumPass` (the `loc_3c97` entry) rebuilds the work and video pages, folds the program banks for the ROM checksum readout, and — relevant here — reloads the high-score mirror straight from NVRAM, copies the seven-byte high-score header from `loc_018b`.. down into the `loc_8e` work row, and runs a packed-BCD countdown that repeatedly subtracts that header value from an accumulator until it underflows, landing the iteration count in `loc_8d` [code]; a wholly zero header skips the loop. `loc_3c97` then falls through into the input-test screen [code].

`selfTestInputPass` (the `loc_3d57` entry) is the per-frame service loop that actually draws the score. Amid pacing on a timing bit and the service switch and debouncing the input ports, it folds the table with `foldHighScoreChecksum` and then re-publishes the *prior* checksum back into `HIGH_SCORE_CHECKSUM` [seen] — so the displayed byte tracks the last-known-good fold rather than the in-progress one. If the fold delta is nonzero (the table is settling), it plots those two delta digits through the digit writer. Once the delta reads zero, it instead plots the stored score from the three packed-BCD bytes `loc_018d`/`loc_018c`/`loc_018b` most-significant first, followed by a bonus multiple derived from the `loc_8d` countdown count [code]. When the operator's inputs have quiesced, it flips `HIGH_SCORE_CHECKSUM` with 0xff and arms the writeback cursor `loc_f9` (0x3d) and `loc_fa` (0) [code] — the gesture that marks the block dirty so the writeback ticker will persist the change back to NVRAM. `loc_3d57` runs this pass forever, and `loc_3fd6` is a bare trampoline that transfers control into that same loop head [code].
