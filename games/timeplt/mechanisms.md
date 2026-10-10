# Time Pilot — how the machine actually works

A model of Konami's Time Pilot (`timeplt`, 1982) derived from the program's own routines and
checked against the real ROM running under MAME. Its companion, `gameplay.md`, describes the same
game from the outside using only the public record; this document explains what the code does to
produce that game, and says plainly where the code does not settle something.

**Every claim carries a confidence tag, carried from the cell or routine's entry in `names.js`.**

- **`[seen]`** — the role was observed on the real ROM under MAME: a write, a read, a value change or
  a dispatch that only that role explains.
- **`[code]`** — read from the routines that touch it. The mechanics are exact; the role is an
  inference the machine has not yet been watched confirming.
- **`[guess]`** — plausible and unconfirmed. Not to be relied on.

A wrong role stated confidently is worse than no name at all, so where the code leaves a question
open this document says so, and §9 collects those questions.

---
## §2 The frame: one interrupt, four modes
Time Pilot's main processor has one heartbeat: a non-maskable interrupt at every vertical blank. Nearly all of the game runs inside that interrupt. The foreground program, once power-on is finished, does one thing forever: it takes drawing commands off a ring buffer and executes them. Every decision (reading the panel, counting coins, choosing what the screen is doing, flying the ship, sending a sound) happens in the vertical-blank service. The service does it by running one arm of a two-level **sequence machine**, whose outer level is the machine's mode. There are four modes: the power-on wipe, the attract presentation, the "credit on the board, press start" screen, and the round engine. The round engine is shared by the attract demo and real play. This part covers power-on, the frame service, coins and sound, the machine itself and the first three modes up to the moment a game starts, and then the round engine (mode 3) that both the demo and a real game run.

### Power-on: from reset to the first frame

The processor starts at 0x0000, `trampolineToSeatTheStackAndSettleTheControlLatch` [seen]. That is three bytes that jump straight to `seatTheStackAndSettleTheControlLatch` (0x07B1) [seen]. The first decision is about the expansion socket. The routine reads EXPANSION_SOCKET_PROBE 0x6000, and only the value 0x55 would send control off into an expansion board. A board with nothing fitted never answers 0x55, so the program carries on. The byte it read is written to WATCHDOG_RESET 0xC200, which kicks the watchdog. Then it zeroes the eight latch addresses from NMI_ENABLE_LATCH 0xC300 upward. The control latch takes its data from the low bit and chooses the line from the address, two addresses per line, so those eight writes clear four lines. They are the interrupt enable, the flip-screen line, the audio-interrupt line and the audio-mute line. A ninth write sets VIDEO_ENABLE_LATCH 0xC308 from DISPLAY_ON_VALUE 0x2D4B, a program byte holding 1, which turns the picture on. Last, the stack is seated at SPRITE_RAM_BASE 0xB000, so it grows down into the top of work RAM.

Power-on then passes through a chain of routines, each ending by jumping to the next, and none of them returns:

- **`clearWorkRamAndSpriteBanksThenColdInit` (0x0069) [seen]** kicks the watchdog between steps. It clears 48 bytes of the second sprite bank twice, once from SPRITE_BANK1_SLOT0_Y 0xB411 and once from SPRITE_BANK1_BASE 0xB410, then zeroes all 2 KB of work RAM from PLAYER_STATE 0xA800 [seen]. After the clear every cell described below starts at zero, including SEQUENCE_PHASE and SEQUENCE_SUBSTEP. The first sprite bank at 0xB010 is not cleared here.
- **`clearScreenRamAndVerifyImageThenColdInit` (0x5866) [seen]** fills the colour plane with 0x10 and the character plane with glyph 0xF1, the blank glyph, 1024 bytes each. It takes the two plane bases from program words: COLOUR_RAM_BASE_WORD 0x2581 holds 0xA000 and VIDEO_RAM_BASE_WORD 0x4A37 holds 0xA400. Then it sums the whole program image, 0x0000–0x5FFF, onto a starting total of the first program byte, kicking the watchdog once per byte. On a genuine image the total is 0xAF.
- **`initColdStartRamThenSeedConfig` (0x2511) [seen]** fills the 64-byte COMMAND_RING 0xAC00 [seen] with 0xFF, which marks every cell free. Then it seeds the random register: `seedRandomRegister` (0x4B67) [seen] copies 17 program bytes from 0x4B84 into RANDOM_REGISTER 0xAB30 [seen]. Next, `loadDefaultHighScores` (0x4BA5) [seen] copies 40 bytes from 0x4BB1 into HIGH_SCORE_TABLE_BASE 0xAB08 [seen]. That fills five eight-byte records, which read as 10,000, 8,800, 8,460, 6,520 and 4,300. Finally, `emptyBothDeferredCellLists` (0x526A) [seen] parks DEFERRED_WRITE_CURSOR 0xAE00 [seen] and DEFERRED_BLANK_CURSOR 0xAE80 [seen] on their first entries.
- **`seedGameConfigFromDipSwitches` (0x52AA) [seen]** turns the switch banks into settings:
  - HIGH_SCORE_HI 0xA98D [seen] gets the byte at 0x08C9 (1), so the high-score readout starts at 10,000.
  - KILL_QUOTA 0xA9CD [seen] gets the byte at 0x0874 (56). This matches the 56 enemies per era in gameplay.md.
  - The coin bank DSW0 at 0xC360 is complemented, because every port is active-low, and stored in COINAGE_SETTINGS 0xA9B1 [seen]. `unpackCoinage` (0x4ACC) [seen] then turns it into the two coin ratios; see below.
  - From DSW1 at 0xC200, complemented, the low two bits give the lives: 3, 4 or 5. The fourth setting would be 6, but it is stored as 0xFF instead. gameplay.md reports this setting as "256". The code stores the all-ones byte. Each lost life takes one off it and the game ends when it reaches zero, so in code it plays as 255 lives (§9 keeps the on-screen behaviour open).
  - `unpackTheFirstThreeSwitchSettings` (0x2E19) [seen] stores the lives in STARTING_LIVES 0xA9C1 [seen], bit 2 in UPRIGHT_CABINET 0xA9C2 [seen] and bit 3 in BONUS_LIFE_SETTING 0xA9C3 [seen].
  - `finishBootSelfTestAndColdStart` (0x49A8) [seen] stores bits 4–6 in DIFFICULTY_SETTING 0xA9C4 [seen] and bit 7 in DEMO_SOUNDS_ENABLE 0xA9C6 [seen].
- **`finishBootSelfTestAndColdStart`** also sets FLIPSCREEN_LATCH 0xC302 from FLIPSCREEN_INIT_BYTE 0x0C3E (1). It then paints the power-on picture: `tileCharPlaneWithBoxLattice` (0x00B1) [seen] calls `stampGridBox` (0x00C7) [seen] 14 bands × 16 times. Each call stamps a 2×2 block of glyphs 86/131/199/239 into the character plane. The first block goes at 0xA440, two 32-cell rows into the plane, and each band covers two rows, so the 14 bands fill rows 2–29. The result is a lattice of boxes. Finally it sums 256 bytes at BOOT_SELFTEST_CHECKSUM_BASE 0x27DE against 0xC5.
- **`petWatchdogThroughStartupDelayThenStartMachine` (0x32EB) [seen]** holds the machine still. It makes 12 passes of 256 watchdog kicks each, counting SEQUENCE_DELAY 0xA9EB [seen] down from 12 to 0 as it goes. The lattice stays on screen for this whole delay. Then it sends sound command 0 straight to the audio processor to quiet it.
- **`enableInterruptAndEnterForegroundLoop` (0x00A8) [seen]** sets the interrupt-enable line from NMI_ENABLE_BYTE 0x4C87 (1), kicks the watchdog, and enters `runCommandRingDrainLoop` (0x0B93) [seen] for good.

Several of these steps carry an image check. The work-RAM clear sums 256 bytes at 0x00D8 against 0x87, and the self-test tail sums the 0x27DE block. On a mismatch, those two run one frame's service out of band before carrying on. The whole-image sum, the random-seed guard (three program bytes plus 0x44 must come to zero) and the others send a tampered image somewhere unrecoverable. On a genuine image none of these arms is taken.

**The foreground loop.** `runCommandRingDrainLoop` reads the cell that COMMAND_READ_CURSOR 0xA9B3 [seen] names in the 64-cell ring. If that cell's high bit is set, the ring is empty and the loop looks again. This idle spin is where the vertical-blank interrupt almost always lands. An occupied cell yields a command byte and an argument byte. Both are marked free (0xFF) before the command runs, and the read cursor steps two cells, wrapping inside the ring.

The command's low nibble picks a handler from a 16-slot table in the program image:

| Slot | Handler |
|---|---|
| 1 | draw a text run by index |
| 2 | draw a caption in the pen colour |
| 3 | erase a text run by index |
| 4 | award score to a player |
| 5 | the emblem strip |
| 6 | a count drawn as a pictogram strip |
| 7 | the round-number caption |
| 10, 11 | captions drawn 5 or 10 past the shared colour |

Anything that wants text on screen, whether frame code or foreground code, calls `postCommand` (0x0038, the RST 0x38 vector) [seen]. It writes the pair at COMMAND_WRITE_CURSOR 0xA9B2 [seen] and steps that cursor two. If the cell it names is still occupied, the pair is dropped silently. So captions are requested inside the interrupt and drawn later, outside it.

### The vertical-blank service

The interrupt vector at 0x0066, `enterVblankInterrupt` [seen], jumps to 0x00D8, `saveAccumulatorForFrameInterrupt` [seen]. That is a one-byte register save that falls into the service body, `serviceVerticalBlankInterrupt` [seen] at 0x00D9. The body saves both register banks, and nothing the game keeps lives in registers across the interrupt. One frame's work happens in this order:

1. **Publish the display.** `publishSpriteShadow` (0x0365) [seen] copies the sprite shadow in work RAM into the two hardware sprite banks. It transforms the bytes according to which way round the picture is. `drainBothDeferredCellLists` (0x5286) [seen] blanks the character cells painted last pass and paints the ones now pending.
2. **Close the gate, kick the watchdog.** NMI_ENABLE_LATCH 0xC300 is set to 0, so a second vertical blank cannot land in the middle of this frame. WATCHDOG_RESET 0xC200 is written.
3. **Settle the picture's orientation.** SCREEN_UNFLIPPED 0xA987 [seen] is cleared only when ACTIVE_PLAYER 0xAD32 [seen] is non-zero and UPRIGHT_CABINET [seen] is zero. Otherwise it is set to 1, and FLIPSCREEN_LATCH 0xC302 [seen] is driven from it. ★ UPRIGHT_CABINET holds the *complemented* switch bit. On the upright setting, switch 0x04 is clear, so the cell reads 1, and zero in this cell means a cocktail cabinet. The only case that turns the picture round is player two's turn on a cocktail table.
4. **Latch the ports.** Five ports are read, complemented (all are active-low) and stored:

   | Port | Mirror cell |
   |---|---|
   | DSW1 0xC200 | DIP1_MIRROR 0xA9AD [seen] |
   | IN0 0xC300 | IN0_MIRROR 0xA9AE [seen] |
   | IN1 0xC320 | IN1_MIRROR 0xA9AF [seen] |
   | IN2 0xC340 | IN2_MIRROR 0xA9B0 [seen] |
   | DSW0 0xC360 | COINAGE_SETTINGS [seen] |

   In IN0_MIRROR, bit 0 is coin 1, bit 1 coin 2, bit 2 service, bit 3 the 1-player start and bit 4 the 2-player start. The write is unconditional, so the mirror shows what the panel is asserting on this frame and nothing more. ★ COINAGE_SETTINGS is refreshed every frame, but the coin ratios are unpacked from it only at power-on. A coinage switch moved while the machine runs changes this cell and not the charge.
5. **Step the clocks.** FRAME_TICK 0xA980 [seen] goes up by one, wrapping at a byte. BCD_FRAME_COUNTER 0xA9CE [seen] steps as a two-digit packed-decimal count, 00 to 99 and round again. Three countdowns are each taken one closer to zero and stop there: BANK_LAUNCH_COOLDOWN 0xA817 [seen], WAVE_CLAIM_TIMER 0xA812 [seen] and ATTACKER_SPAWN_COOLDOWN 0xA8F4 [seen].
6. **Service the coins.** `serviceCoinInputs` (0x48BE) [seen]; see below.
7. **Run the sequence machine.** The low two bits of SEQUENCE_PHASE 0xA9AB [seen] select one of four phase arms from the table at SEQUENCE_PHASE_ARM_TABLE 0x015F: 0x15C2, 0x1651, 0x17FE, 0x0F1F. That arm runs.
8. **Send one sound and reopen the gate.** `sendOneQueuedSoundThenUnwindTheFrameInterrupt` [seen] (0x0174) sends the oldest queued sound byte. It then sets NMI_ENABLE_LATCH from NMI_REENABLE_BYTE 0x1600, a program byte holding 1, and the service unwinds back into the foreground loop.

### Coins, credits and coin counters

Every frame, `serviceCoinInputs` runs three input handlers and then two counter drivers. All three handlers debounce the same way. They shift the current IN0_MIRROR bit into a history byte and act only when the history's low three bits read 001: released, released, pressed. A held input or a bouncing contact counts once.

- **Service credit:** `awardOneCreditOnDebouncedInputEdge` (0x48E7) [seen] watches IN0 bit 2 through SERVICE_CREDIT_DEBOUNCE 0xA983 [seen]. On an edge it requests the coin sound and awards exactly one credit through `awardCoinCreditThenPulseCoinCounter` (0x496E) [seen]. No coin is recorded for the counter.
- **Coin slot 1:** `tallyCoinSlot1AndAwardCredit` (0x4941) [seen] shifts IN0 bit 0 into COIN_SLOT_1_DEBOUNCE 0xA9C7 [seen]. On an edge it:
  1. requests the coin sound;
  2. bumps COIN_ACCEPTED 0xA981 [seen], the number of pulses the mechanical counter is still owed (one per coin, not per credit);
  3. adds 0x10 to COIN_SLOT_1_ACCUMULATOR 0xA9C8 [seen].

  COIN_SLOT_1_RATIO 0xA9C9 [seen] holds coins-required-minus-one in its high nibble and credits-given in its low nibble. The coinage table at COINAGE_VALUE_TABLE 0x4B95 gives one-coin-one-credit as 0x01 and two-coins-one-credit as 0x11. While the ratio byte is still at or above the accumulator, the coin only waits. Once the accumulator passes it, the accumulator gives back (high nibble + 1) × 0x10, which carries any extra coins forward. Then, unless FREE_PLAY 0xA9C0 [seen] is set, the ratio's low nibble is added in packed decimal to CREDIT_COUNT 0xA986 [seen]. The count saturates at 99, and `paintCreditCountPanel` (0x4AFB) [seen] repaints the two digits at 0xA47F.
- **Coin slot 2:** `meterCoinageTowardCreditOnEdge` (0x4911) [seen] is the same for IN0 bit 1. It uses COIN_SLOT_2_DEBOUNCE 0xA9CA [seen], COIN_ACCEPTED_SLOT_2 0xA982 [seen], COIN_SLOT_2_ACCUMULATOR 0xA9CB [seen] and COIN_SLOT_2_RATIO 0xA9CC [seen], which comes from the other nibble of the coin switches. It credits through the same shared tail.

`unpackCoinage` decodes each nibble of COINAGE_SETTINGS through the coinage table. Nibble value 15 also raises FREE_PLAY to 0xFF, and either slot can raise it. On free play, coins are still counted, still sound and still drive the mechanical counters, but no credit is ever banked.

Coins drive the mechanical counters as separate pulses:

- `pulseSlot1CoinCounter` (0x4984) [seen] does nothing while COIN_ACCEPTED is zero. Otherwise it loads COIN_PULSE_TIMER 0xA984 [seen] with 48 and raises COIN_COUNTER_0_LATCH 0xC30A. The timer then counts down, the line drops when it reaches 24, and on the frame it reaches zero one owed pulse is paid off. So two quick coins give two distinct clicks.
- `pulseSlot2CoinCounter` (0x49D6) [seen] is the twin, using COIN_ACCEPTED_SLOT_2, COIN_PULSE_TIMER_SLOT_2 0xA985 [seen] and COIN_COUNTER_1_LATCH 0xC30C.

★ The shared crediting tail, `awardCoinCreditThenPulseCoinCounter`, ends by falling into slot 1's pulse driver. It does this even when the credit came from slot 2 or the service input, and slot 1's own credit path does the same. So on any frame where a credit is completed (banked, or, under free play, merely reached), slot 1's pulse driver runs twice, and slot 2's driver never runs from that tail.

### The sound queue

The main processor never waits on the audio processor. Sound requests are appended to a queue:

- SOUND_QUEUE_COUNT 0xAC43 [seen] holds how many bytes are waiting.
- The bytes follow it from SOUND_QUEUE_HEAD 0xAC44 [seen], right after the 64-cell command ring.
- The enqueue body at 0x562A (`appendSoundCommandToQueue`) bumps the count and stores the new code at the count's own offset, so codes line up in arrival order.
- Nothing checks for room, and the count wraps at a byte.

Producers reach the queue through one of three gates:

- `enqueueSoundUnconditional` (0x5628) [seen] always queues: it has no test of its own and falls straight into the append.
- `enqueueSoundIfGameInProgress` (0x560C) [seen] queues only while PLAY_ACTIVE 0xAD30 [seen] is set.
- `enqueueSoundIfGameOrAttract` (0x5617) [seen] queues while PLAY_ACTIVE or DEMO_SOUNDS_ENABLE is set.

A request that fails its gate is dropped for good, not deferred. The coin sound, `requestCoinSound` (0x57F1) [seen], goes through the unconditional gate. Its code is the program byte at COIN_SOUND 0x322E (1).

Draining happens once per frame, at the very end of the service. `sendOldestQueuedSoundCommand` (0x55D4) [seen] does nothing on an empty queue. Otherwise it takes one off the count, sends the head byte, and slides every remaining byte down one place. `sendSoundCommand` (0x55F8) [seen] is the handshake. It writes the byte to SOUND_COMMAND_LATCH 0xC000, then drives AUDIO_IRQ_LATCH 0xC304 high and back low. That edge makes the audio processor look. Because only one byte leaves per frame, a burst of N requests is heard over N frames. Power-on is the one sender that goes around the queue: it sends 0 directly.

### The sequence machine

Two cells hold the whole mode of the machine:

- **SEQUENCE_PHASE 0xA9AB [seen]** is the outer phase. The frame service uses only its low two bits.
- **SEQUENCE_SUBSTEP 0xA9AC [seen]** is the inner step within that phase.

Each phase arm reads SEQUENCE_SUBSTEP and jumps through a word table laid inline right after the dispatch (the RST 0x30 inline-table dispatch). The four phases differ in mask, table size and tail:

| Phase | Entry | Sub-step mask | Arms | Shared tail |
|---|---|---|---|---|
| 0 | 0x15C2 [seen] | 3 bits | 8 slots, 2 real | none |
| 1 | 0x1651 [seen] | low 7 bits | 13 | `advanceSequenceElseStartFreePlayGame` (0x167B) [seen] |
| 2 | 0x17FE [seen] | low 7 bits | 5 | `noOpSequencePhase2Tail` (0x181D) [seen] |
| 3 | 0x0F1F [seen] | low nibble | 16 | `advanceAttractTowardGameStart` (0x0F54) [seen] |

In phase 0, only slots 0 and 6 of the table at PHASE0_SUBSTEP_DISPATCH_TABLE 0x15C8 name real code. In phases 1 and 2 the entry doubling wraps at eight bits, which is why only the low 7 bits of the step matter. For phases 1–3 every arm is followed by that phase's shared tail, which runs after the arm on every frame. Phase 2's tail does nothing.

An arm moves the machine in a few ways:

- `advanceSequenceSubStep` (0x0F1A) [seen] adds one to SEQUENCE_SUBSTEP.
- `advanceSequencePhase` (0x0F11) [seen] adds one to SEQUENCE_PHASE and clears SEQUENCE_SUBSTEP.
- `seatSequencePhase3AndResetSubStep` (0x172A) [seen] jumps straight to phase 3, step 0.
- An arm can also write a phase and step pair directly.

An arm that has not finished its work simply returns without stepping, so it runs again next frame. That is how every hold and wipe below is timed: one call per frame.

★ **Tamper checks.** Most arms in phases 0–2 fold a block of the program image into a byte and compare it with the value a genuine image gives. The mismatch arms differ by arm:

- Some step the phase instead of the sub-step, which knocks the sequence off course without stopping it.
- One switches the display off.
- Some jump into data run as code.
- One folds the image straight into SEQUENCE_PHASE, so a patched image ends up with a corrupted phase.

On a genuine image every check passes and the mismatch arms are dead. They are noted below only where they shape how an arm is written.

### Phase 0: the power-on wipe

After the RAM clear, the first frame finds phase 0, step 0.

**Slot 0: `startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase` (0x15E2) [seen].** It first calls `armWholePlaneWipeThenDerailOnATamperedImage` (0x019A) [seen]:

- BLANK_LINE_CURSOR 0xA989 [seen] is set to the plane's start, 0xA400.
- BLANK_LINES_LEFT 0xA988 [seen] is set to 32.
- 240 program bytes from 0x4BA5 must sum to 0x11.

Then it sets SEQUENCE_SUBSTEP from WIPE_SUBSTEP_SEED 0x1749, a program byte that is the low half of an instruction operand and holds 6. Last, it rewrites SEQUENCE_PHASE: it subtracts the 256 bytes at 0x5648 from the phase and XORs 0x4E into the result. On a genuine image this leaves phase 0 unchanged.

**Slot 6: `armAttractScreenShowingHighScore` (0x15FE) [seen]** runs every frame from then on. Each call first runs `blankNextLine` (0x01C2) [seen], which erases one line of the character plane:

- It walks 32 cells, 32 addresses apart, writing glyph 0xF1 into each and colour 0x10 into the matching colour-plane cell.
- It advances the cursor by one line.
- It counts BLANK_LINES_LEFT down by one.

So the power-on lattice is wiped one line per frame. On the 32nd frame, when the count reaches zero, the arm lays out the first attract screen:

1. It posts commands (1,5), (1,6), (1,7) and (6,1), which are three text runs and a pictogram strip.
2. It seeds the two marker cells HIGH_SCORE_MARKER_CELL_LOWER 0xA701 [seen] and HIGH_SCORE_MARKER_CELL_UPPER 0xA6E1 [seen] with 0x13.
3. It walks the six three-byte records at HIGH_SCORE_PATCH_TABLE 0x163F; each names a cell, which gets the record's glyph, and the cell after it gets 0x05.
4. It paints the high score with `paintHighScoreReadout` (0x0D6B) [seen].
5. It writes phase 1, step 2 directly. Under free play it also posts caption 13.

So power-on joins the attract sequence at its third step, skipping the pen-route erase.

### Phase 1: the attract cycle

Phase 1 is the title and copyright presentation. Its tail, `advanceSequenceElseStartFreePlayGame`, runs after every arm and is what lets the player cut in:

- If CREDIT_COUNT is non-zero, it steps the phase to 2 and the credit screen takes over on the next frame. Because the coin was banked earlier in the same frame, a coin inserted during the title screens switches mode at once.
- If there is no credit but FREE_PLAY is set, a start button held in IN0_MIRROR (bits 3 or 4) hides all 24 sprites and starts a game on the spot; see "Starting a game".

The thirteen arms run in order, one or more frames each:

- **Step 0, `erasePenRouteThenAdvanceStep` (0x074B) [seen].** Checks 256 bytes at 0x4AA0 against 0xB8. Sets PEN_COLOUR 0xAD0C [seen] to 5 and PEN_GLYPH 0xAD0B [seen] to the blank glyph 0xF1. `armThePenRouteThenColdStartOnATamperedImage` (0x01E1) [seen] sends the pen back to leg 0 of its route (PEN_ROUTE_LEG 0xA9E2 [seen]) at the route's start point, after checking 256 more bytes. The arm then steps once. If PEN_COLOUR already held 5 when it arrived, it steps twice, skipping step 1 entirely.
- **Step 1, `advancePenRunAnimationStep` (0x1734) [seen].** Each frame, `drawInterpolatedPenRun` (0x0201) [seen] draws one leg of the route with the pen glyph. Because the pen glyph is blank, this erases the route one leg per frame. When the route reseats on a zero row, the 34 bytes at 0x1748 are summed negatively into BANK_LAUNCH_COOLDOWN 0xA817. That result is zero on a genuine image; the countdown cell is borrowed here as a tamper total. Then the arm steps.
- **Step 2, `showCreditLine` (0x2D3F) [seen].** Under free play it only steps. Otherwise it:
  1. repaints the credit digits;
  2. posts caption 8;
  3. requires BANK_LAUNCH_COOLDOWN to be zero;
  4. stamps the copyright strip with `stampCopyrightStrip` (0x0B06) [seen]: four sprite entries from PLAYER_ENTRY 0xAA10 [seen], shapes 4–7, butted together at fixed positions;
  5. requests the copyright line with `flashCopyrightLine` (0x0B39) [seen];
  6. sums the 20 bytes at COPYRIGHT_CAPTION_RECORD 0x086B [seen] and steps only if the total checks out.

  `flashCopyrightLine` posts caption 31 on even FRAME_TICK frames and caption 0 on odd ones. Called every frame, it makes the line alternate.
- **Step 3, `buildCopyrightScreenThenVerifyImage` (0x083E) [seen].** Flashes the line, stamps the strip, and posts captions 0, 1, 3, 4, 5, 6, 7, 20 and 21. Then it checks a 24-byte XOR fold against 0xC9 and steps.
- **Step 4, `holdCopyrightThenEraseTheCoinInvitation` (0x1748) [seen].** A hold. Every frame it re-stamps the strip, flashes the line and counts SEQUENCE_DELAY down. On expiry it copies the glyph and colour of one copyright cell into TAMPER_GLYPH_KONAMI 0xACC7 [seen], posts erase commands (3,3) and (3,4), and steps. The count starts from whatever SEQUENCE_DELAY holds. After power-on that is zero, which wraps, so the hold lasts 256 frames.
- **Step 5, `paintReadoutsThenSampleWitnessOrDerail` (0x176A) [seen].** `checkTheCopyrightLineColoursOrDerail` (0x19DA) [seen] walks 13 colour cells from 0xA2BC, stepping back 32 each time, and requires each to be 0x10 or 0x05, the line's two flash colours. The arm then requires the glyph at 0xA67C to be 0x7C. It posts caption 19 and paints the five labelled readouts with `paintFiveLabelledNumericReadouts` (0x4BDC) [seen], the high-score table. It copies a witness glyph and colour into TAMPER_GLYPH_READBACK 0xADFB [seen] and TAMPER_COLOUR_READBACK 0xADFC [seen], and steps.
- **Step 6, `holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail` (0x178C) [seen].** A second hold, again counting SEQUENCE_DELAY from zero, so 256 frames. On expiry it re-checks the line colours. It then checks one caption glyph through a pointer built from a program byte: the first opcode of the parachutist routine, plus 2 for the low half and plus 0x6A more for the high half. On a genuine image that lands on the copyright line's "N" cell, which must hold 0x3B. It copies the glyph and colour at 0xA67C into TAMPER_GLYPH_COPY 0xAB43 [seen] and steps.
- **Steps 7–11: five image checks, one frame each.**
  - `guardBlockOrBlankDisplay` (0x17B9) [seen] sums a seed byte and 51 bytes of the strip stamper's own code against 239. A mismatch writes DISPLAY_OFF_VALUE 0x4C89 (0) to VIDEO_ENABLE_LATCH and never steps.
  - `guardBlockOrDerailSequence` (0x3252) [seen] XOR-folds 768 bytes from 0x0008; a mismatch steps the phase instead.
  - `foldImageBlockIntoSignatureThenAdvanceSequence` (0x17E2) [seen] sets TAMPER_FOLD_FLAG 0xAA3F [seen] to 0xFF and banks a signature of an image block in TAMPER_IMAGE_SIGNATURE 0xAA6F [seen].
  - `stepSequenceUnderChecksum` (0x4B19) [seen] sums 256 bytes at 0x0BCC, starting from 137, against the program byte at 0x1A50.
  - `trampolineToAdvanceSequenceSubStep` (0x17FB) [seen] only steps.
- **Step 12, `verifyImageSignatureThenStartAttractDemoOrDerail` (0x2730) [seen].** Requires the banked signature to be 0x76. Then it:
  1. hides the four caption sprites with `hideCaptionSprites` (0x0B2B) [seen];
  2. seeds the demo autopilot with `seedDemoAutopilotScript` (0x210E) [seen]. The script is picked by PLAYER_ONE_ERA_INDEX 0xAD14 [seen]. The same routine checks that TAMPER_GLYPH_READBACK holds 0xFD and the colour readback holds 0x10 or 0x05;
  3. clears TWO_PLAYER_GAME 0xAD31 [seen], PLAYER_TWO_LIVES 0xAD20 [seen], PLAY_ACTIVE and SEQUENCE_SUBSTEP;
  4. gives PLAYER_ONE_LIVES 0xAD10 [seen] one life;
  5. writes SEQUENCE_PHASE = 3.

  The attract demo is therefore the real round engine, flown by the autopilot, with PLAY_ACTIVE clear. Phase 3 alone does not mean a game is being played.

The cycle closes from inside phase 3. Its arm 12, `restartAttractSequence` (0x12FB) [seen], clears PLAY_ACTIVE, SEQUENCE_SUBSTEP and ACTIVE_PLAYER. It sets SEQUENCE_PHASE from ATTRACT_SEQUENCE_START_PHASE 0x16D3 (1). It then writes SEQUENCE_SUBSTEP a second time from a fold of program bytes (the word at 0x4902 plus the byte at ATTRACT_RESTART_FOLD_BYTE 0x4901 [seen], high and low halves XORed, minus 155). On a genuine image that fold comes to zero. So after each demo the attract cycle restarts at phase 1, step 0, and this time step 0 does run. The pen-route erase in step 1 follows unless PEN_COLOUR already holds 5 when step 0 runs, in which case step 0 steps twice and skips it. How the demo reaches that arm is described under *Phase 3 — the round engine* below.

While the demo flies, phase 3's tail `advanceAttractTowardGameStart` is what lets a player in. With PLAY_ACTIVE set it does nothing. In the demo:

- a non-zero CREDIT_COUNT writes SEQUENCE_PHASE from SEQUENCE_PHASE_ON_CREDIT 0x1736 (2) and zeroes the sub-step, so the demo is abandoned for the credit screen;
- with no credit, free play plus a held start button starts a game directly, exactly as phase 1's tail does.

★ **An edge case (code reading only):** a credit banked on the same frame that phase 1's step 12 runs meets the tail after the arm has already written phase 3. The tail then steps the phase to 4. Its low two bits select phase 0, so the machine re-runs the power-on wipe: the phase fold leaves a value whose low bits are still 0, and slot 6's wipe then writes phase 1, step 2. From there phase 1's tail sees the credit and moves on to phase 2. This path has not been watched running.

### Phase 2: a credit on the board, waiting for start

Phase 2 is entered at step 0, either from phase 1's tail or from the demo. It is only ever entered with CREDIT_COUNT non-zero. Its tail does nothing, so nothing in phase 2 checks free play.

- **Step 0, `parkSpritesAndArmLineWipeThenAdvanceSequence` (0x181E) [seen].** `hideAllSprites` (0x15B6) [seen] zeroes the Y byte of all 24 sprite slots from PLAYER_SPRITE_Y 0xAA41 [seen]. `sampleCellGlyphAndColour` (0x1AFC) [seen] copies the cell at 0xA5FC aside. `armLineWipeFromFifthLine` (0x01B5) [seen] sets BLANK_LINE_CURSOR to 0xA404, the fifth line, and BLANK_LINES_LEFT from the program byte at 0x0CCD (27). Then the arm steps.
- **Step 1, `blankOneLineThenGuardBlockOrDerailSequence` (0x2CDB) [seen].** One `blankNextLine` per frame. It starts from the fifth line and erases 27 lines over 27 frames, lines 4–30. The first four lines and the last line are left untouched. When the wipe finishes it checks a 1024-byte XOR fold at 0x4980 against 0x43 and steps.
- **Step 2, `postAttractInfoCaptions` (0x1830) [seen].** Stamps the strip, flashes the line, and posts captions 1, 20 and 21. Then comes a bonus-life pair: 15 and 16 when BONUS_LIFE_SETTING is zero, 17 and 18 otherwise. Then 22 and 0. Last it looks at CREDIT_COUNT:
  - with two or more credits it posts caption 25 and steps twice, to step 4;
  - otherwise it posts caption 23 and steps once, to step 3.
- **Step 3, `stepCopyrightScreenAwaitingStart` (0x07E6) [seen]**, the one-credit wait. Each frame it re-stamps the strip, flashes the line and samples a copyright cell. Then:
  - if the 1-player start (IN0_MIRROR bit 3) is held, it starts a one-player game;
  - if CREDIT_COUNT is exactly 1, it keeps waiting;
  - if more credits have arrived, it posts caption 25 and steps to the two-credit wait.
- **Step 4, `stepTwoCreditCopyrightScreenAwaitingStart` (0x188A) [seen]**, the two-credit wait. The same re-stamp and flash, then it checks the 2-player start (bit 4) first and the 1-player start (bit 3) second. With neither held it returns and waits.

A two-player game can only be started from step 4, which is reached only with at least two credits. Phase 2 has no timeout: it waits until a start button is pressed.

### Starting a game

There are three ways to start a game, and all of them end by writing phase 3, step 0 through `seatSequencePhase3AndResetSubStep`. On the next frame the round engine begins at its first arm, this time with PLAY_ACTIVE set.

**`startOnePlayerGame` (0x3215) [seen]**:

1. hides the four caption sprites;
2. clears TWO_PLAYER_GAME and PLAYER_TWO_LIVES;
3. sets PLAY_ACTIVE to 0xFF;
4. loads PLAYER_ONE_LIVES from STARTING_LIVES;
5. subtracts one from CREDIT_COUNT in packed decimal and repaints the credit digits;
6. copies three tilemap cells into their keeps from the record table at 0x0D1B, using `copyThreeTilemapCellsFromBothPlanes` (0x4B30) [seen].

**`startTwoPlayerGame` (0x189E) [seen]**:

1. hides the caption sprites;
2. sets both PLAY_ACTIVE and TWO_PLAYER_GAME to 0xFF;
3. loads both players' lives from STARTING_LIVES;
4. runs `setUpTwoPlayerStartObjectOnce` (0x460E) [seen], which acts only when TAMPER_GLYPH_COPY disagrees with the glyph now at 0xA67C;
5. subtracts two credits in packed decimal and repaints.

**`startGameOnFreePlay` (0x1690) [seen]** is reached from phase 1's tail or the demo's tail, and only under free play. The callers have already hidden all 24 sprites. It checks the 2-player button first. Both arms set PLAY_ACTIVE and load player one's lives. The two-player arm also sets TWO_PLAYER_GAME and loads player two's lives; the one-player arm clears both. No credit is charged, and unlike the credited one-player start, no tilemap cells are copied aside.

### Phase 3 — the round engine

Everything that happens between a start button and the return to attract — including the attract demo, which flies the real game with the play flag clear — runs inside phase 3 of the two-level sequence machine. The frame service picks the phase from the low two bits of SEQUENCE_PHASE 0xA9AB [seen], and phase 3 hands the frame to dispatchSequenceSubStepArm [seen], which takes the low nibble of SEQUENCE_SUBSTEP 0xA9AC [seen] as the index into a sixteen-word table. Because the index is masked to a nibble and all sixteen slots name a real step, no value can fall off the table. One step runs per frame service, and each step decides for itself whether to stay where it is (by returning) or move on (by incrementing SEQUENCE_SUBSTEP through advanceSequenceSubStep [seen], or by writing it outright).

After whichever step ran, the same continuation always follows: advanceAttractTowardGameStart [seen]. In a real game it does nothing, because PLAY_ACTIVE 0xAD30 [seen] is set. In the demo it is the way out. A banked credit (CREDIT_COUNT 0xA986 [seen] non-zero) sends the machine to the phase byte stored at SEQUENCE_PHASE_ON_CREDIT 0x1736, which reads 2 — the push-start screen — with the sub-step cleared. On free play (FREE_PLAY 0xA9C0 [seen]), a start button held in IN0_MIRROR 0xA9AE [seen] hides the sprites and starts a game directly through startGameOnFreePlay [seen].

Phase 3 is entered in two ways. startOnePlayerGame, startTwoPlayerGame and startGameOnFreePlay [seen] raise PLAY_ACTIVE, load the lives from STARTING_LIVES 0xA9C1 [seen] and call seatSequencePhase3AndResetSubStep [seen], which unconditionally stores 3 and 0. The attract sequence's last step, verifyImageSignatureThenStartAttractDemoOrDerail [seen], writes phase 3 and sub-step 0 itself, with PLAY_ACTIVE cleared and one life in PLAYER_ONE_LIVES, and that entry is the demo.

#### The sixteen steps

The table is easiest to follow as the life of a game.

**Step 0 — arm the game (armRoundStartThenStepSequence [seen]).** This step asks for the round-start sound. It then gives both saved player contexts a fresh start: each player's kills-owed cell (PLAYER_ONE_KILLS_REMAINING 0xAD12 [seen] and its twin) is filled from KILL_QUOTA 0xA9CD [seen]. Era, bonus-life latch (PLAYER_ONE_BONUS_LIFE_LATCH 0xAD13 [seen]), Mother-Ship-armed flag and pen colour are zeroed, ACTIVE_PLAYER 0xAD32 [seen] is set to player one, and round number and round-armed are set to 1. The step then splits on PLAY_ACTIVE.

- **In a credited game** it zeroes both score triples and posts command 4 with award index 0 to the command ring, which repaints the score labels. It loads the difficulty record the Difficulty switch selects (see *The gameplay-config bank*). It folds a program block into the picture-enable latch (see *ROM self-checks*). Both players' start rungs are copied from START_RUNG_ROUNDS_1_5 0xA9D3 [seen], and SEQUENCE_DELAY 0xA9EB [seen] is set to 150 before the step advances.
- **In the demo** it cycles ATTRACT_STAGE_COUNTER 0xA9D0 [seen] through 1, 2, 3 and back to 1. It uses that value as player one's era (PLAYER_ONE_ERA_INDEX 0xAD14 [seen]) and that value plus one as player one's round number. The demo therefore only ever flies eras 1, 2 and 3 — 1940, 1970 and 1982 — never 1910 or 2001. This matches gameplay.md's report of the Konami set's attract mode. It zeroes FRAME_TICK 0xA980 [seen], BCD_FRAME_COUNTER 0xA9CE [seen] and SCRIPT_CYCLE_COUNTER 0xA9CF [seen], and re-seeds the random generator. It clears the shot array (PLAYER_SHOT_ARRAY 0xAA80 [seen] and up) and the player/actor block (PLAYER_STATE 0xA800 [seen] and up). It then loads the third difficulty record (setting 3) whatever the switches say, and copies both players' start rungs from it. Every demo therefore starts from the same generator state on the same fixed difficulty. The delay is set to 90.

**Step 1 — seat the caption pen (seatCaptionPenFromEraFoldingTamperIntoPhase [seen]).** A two-byte glyph/colour record is chosen by the active player's era. It comes from ERA_PEN_TABLE 0x0F8D [seen], whose bytes are also the code of loc_0f8d [code]. The record is written both into that player's saved pen (PLAYER_ONE_PEN_GLYPH 0xAD1B [seen], or PLAYER_TWO_PEN_GLYPH 0xAD2B [seen]) and into the live PEN_GLYPH 0xAD0B / PEN_COLOUR 0xAD0C [seen]. If the colour did not change, the step advances twice, which skips step 2. The pen is then sent back to the start of its route, and the step advances.

**Step 2 — trace the pen route (blankCaptionThenAdvancePenRunStep [seen]).** Each frame, this step blanks the fourteen kill-meter cells (blankFourteenCharCells [seen]) and draws one leg of the pen's route (drawInterpolatedPenRun [seen]). Each leg stamps PEN_GLYPH/PEN_COLOUR along a line interpolated between two route points. The step stays put until the route reseats on row zero, and then advances. The code does not establish what the traced route looks like on the glass.

**Step 3 — load the player's context (loadActivePlayerContextAndPostRoundHud [seen]).** The active player's saved sixteen-byte block (PLAYER_ONE_LIVES 0xAD10 or PLAYER_TWO_LIVES 0xAD20 [seen]) is copied over the live block at LIVES_REMAINING 0xAD00 [seen]. The live block carries lives, ROUND_NUMBER 0xAD01, KILLS_REMAINING 0xAD02, BONUS_LIFE_LATCH 0xAD03, ERA_INDEX 0xAD04, the life-tick counter, START_RUNG 0xAD0A, the pen pair, MOTHER_SHIP_ARMED 0xAD0D and ROUND_ARMED 0xAD0E [all seen]. This copy-in, together with the copy-out when a life or round ends, is the whole of the two-player machinery. Each player keeps their own era, round, kills owed, bonus latch and start rung, and a dead player's kill count survives to their next life. In a real game the step then posts two HUD commands and advances:

- command 6 with ROUND_NUMBER, which drawCountAsPictogramStrip [seen] paints as a row of pictograms in thirties, tens, fives and ones;
- command 5 with lives minus one, which drawEmblemStripThenGuardImage [seen] paints as up to six reserve-ship emblems.

**Step 4 — reset the playfield (postRoundStartCaptionsAndResetPlayfield [seen]).** Captions go up first.

- In the demo the caption is READY.
- In a game it is PLAYER 1 or PLAYER 2 (caption 9, or 10 when ACTIVE_PLAYER is 1). That is followed by command 7, the round-number caption (drawRoundNumberCaption [seen]), when ROUND_ARMED is set, or by READY when it is not.

The kill meter is then repainted, and resetPlayfieldAndArmNewRound [seen] prepares a fresh life:

- It zeroes the world scroll, the life-tick counter, MOTHER_SHIP_ARMED, PARACHUTIST_RUNG 0xA8F7 [seen] and ROUND_TRANSITION_HOLD 0xACC6 [seen].
- It reloads ERA_RUNG_TIMER 0xA9D7 from ERA_RUNG_PERIOD 0xA9D6 and sets ERA_RUNG 0xACC0 from START_RUNG [all seen].
- It points the ship at heading 0x80 with PLAYER_STATE set to 0xFF (alive).
- It retires every object slot and seats the era's scenery.
- It scatters the ten-byte era/rung settings row into the spawn and launch parameters (see *The difficulty ladder*).

Because this runs at every life start, the parachutist ladder and the difficulty rung both go back to their starting values each time the player dies. The kills owed do not.

**Step 5 — the round intro (flyRoundIntroFlashingEraYearThenEraseIntroCaptions [seen]).** The ship and the scenery fly, but no enemies do. On odd FRAME_TICKs the step counts SEQUENCE_DELAY down, so each unit of delay costs two frames. While ROUND_ARMED is set, the low nibble of FRAME_TICK re-posts the era's caption (caption record 26 plus ERA_INDEX) under three different drawing commands (2, 10 and 11), at nibbles 0, 5 and 10. That makes the era year flash in turn. ROUND_ARMED is set only on the first life of a round (startNextRound stores 0xFF; step 0 stores 1). A life restarted after a death therefore gets the plain READY intro with no year banner and no round-number caption. When the delay runs out, the step erases captions 9, 14 and 26, clears ROUND_ARMED, sets the delay to 42 and advances.

**Step 6 — the enemy-free lead-in (flyEnemyFreeLeadInThenStepSequence [seen]).** The ship, the scenery and the player's own shots run for the 42 frames of the delay, which here counts down every frame. Then the step advances into the round proper.

**Step 7 — the round (serviceRoundThenResolvePlayerState [seen]).** This one step is the game. Every frame it runs the subsystem services in a fixed order, interleaving sprite multiplex passes:

1. enemy re-aim;
2. the player's frame;
3. the player's shots;
4. the enemy wave driver;
5. the parachutist;
6. the Mother-Ship gate (armMotherShipOrStep [seen]);
7. the seven craft slots;
8. the scenery;
9. the era-2-and-later object bank, the era-1 bomber and the era-1 fixed slot;
10. the four actor slots;
11. the era-0 ballistic-object bank;
12. the collision pass for the era;
13. a group sound request;
14. the bonus-life check;
15. the hit-chain expiry;
16. the difficulty escalation;
17. the kill-meter repaint.

Then it reads PLAYER_STATE, and that one byte chooses among three exits:

- 0xFF, the player is alive, so try to finish the round (advanceRoundWhenFieldCleared [seen]);
- 0, the dying sequence is over, so take a life (loseLifeAndHandOver [seen]);
- anything else means the player is still dying, and the step returns to run again next frame.

**Steps 8–12 — game over, filing and back to attract.** These are covered under *The high-score table and initials entry*. In outline:

- fileScoreAfterGameOverHoldElsePassTurn [seen] holds the game-over banner and then tries to file the score;
- erasePenRouteThenOpenInitialsEntry [seen] erases the pen route and opens initials entry;
- stepHighScoreInitialsEntry [seen] runs the entry;
- loc_12e2 [seen] counts SEQUENCE_DELAY down every frame and then either passes the turn to the other player or advances;
- restartAttractSequence [seen] ends the game.

restartAttractSequence clears PLAY_ACTIVE, the sub-step and ACTIVE_PLAYER. It sets the phase from the program byte ATTRACT_SEQUENCE_START_PHASE 0x16D3, which reads 1, the attract sequence. It then writes the sub-step a second time through a fold over program bytes (see *ROM self-checks*).

**Steps 13–14 — the round-won transition.** These are covered under *Round won* below.

**Step 15 — nothing.** loc_15b5 [code] reads nothing, writes nothing and returns.

#### How a round is won

advanceRoundWhenFieldCleared [seen] acts only when three things are true at once:

- KILLS_REMAINING 0xAD02 [seen] is zero, meaning the quota of 56 is spent;
- ROUND_TRANSITION_HOLD 0xACC6 [seen] is non-zero, meaning the Mother-Ship's closing sequence has raised it (0xFE at the formation rebuild, 0xFF when the warp finishes);
- all fifteen object records from ACTOR_RECORD_SLOT0 0xA810 [seen], at a stride of 16 bytes, read empty.

Any one of them failing is a silent return, so the round simply keeps running until the field has drained. When all three hold, it requests the seven-sound transition burst (enqueueTransitionSoundBurst [seen]).

In the demo it then puts the machine back at the top of the attract sequence. It reloads ROUND_TRANSITION_HOLD from ROUND_TRANSITION_HOLD_SEED 0x07D1 (which reads 0), hides the sprites, clears PLAY_ACTIVE and ACTIVE_PLAYER, sets SEQUENCE_PHASE to 1 and clears the sub-step.

In a game it does four things:

1. Zeroes twenty-three sprite Y bytes from ACTOR_SPRITE_Y_SLOT0 0xAA43 [seen].
2. Runs startNextRound [seen]:
   - ROUND_NUMBER goes up by one, with no cap below the byte's own limit;
   - ERA_INDEX goes up by one and wraps from 4 back to 0, which is the loop back to 1910;
   - START_RUNG is reloaded from the start-rung cell for the round's bracket: START_RUNG_ROUNDS_1_5 0xA9D3, START_RUNG_ROUNDS_6_10 0xA9D4 or START_RUNG_ROUNDS_11_UP 0xA9D5 [all seen];
   - KILLS_REMAINING is refilled from KILL_QUOTA;
   - MOTHER_SHIP_ARMED and ROUND_TRANSITION_HOLD are cleared and ROUND_ARMED is set to 0xFF.
3. Copies the live context out to the active player's save block.
4. Sets SEQUENCE_SUBSTEP to the byte at NEXT_ROUND_START_SUBSTEP 0x4A35, which reads 13.

KILL_QUOTA is written once at boot from the ROM byte DEFAULT_KILL_QUOTA 0x0874 (56) and never again [seen]. The quota is therefore 56 in every era, on every loop and at every difficulty. The only things a later loop changes are the start rung (by round bracket) and, through it, the spawn parameters.

#### Round won: the band animation and the between-era transition

Step 13 (armRoundWonBandAnimationThenStepSequence [seen]) runs for one frame and stocks the animation's control block:

| Cell | Value |
|---|---|
| INTRO_ANIMATION_STEP 0xA9F0 [seen] | 0, from the program byte INTRO_ANIMATION_STEP_SEED 0x3213 [seen] |
| PLAYER_FLASH_TICK 0xA9F1 [seen] | 0 |
| BAND_TO2_PASS_COUNTDOWN 0xA9F2 [seen] | 0xFF |
| SPRITE_COLOUR_CYCLE_COUNTDOWN 0xA9F3 [seen] | 4 |
| BAND_TO4_PASS_COUNTDOWN 0xA9F4 [seen] | 0xFF |
| COLOUR_FLOOD_COUNTDOWN 0xA9F6 [seen] | 8 |
| BAND_SCRIPT_CURSOR 0xA9F7 [seen] | BAND_SCRIPT_START 0x56F1 |

It lays a backing row at the head of the character plane (0xA400): thirteen cells of 0x14, two of 0x00, thirteen more of 0x14 and four of 0x0E. It colours the band's two thirteen-cell runs and three short stubs with PEN_COLOUR plus fixed offsets. It then refreshes the active player's saved pen from the era table (setSavedPenFromEra [seen]). Because startNextRound has already advanced the era, that saved pen is the *new* era's colour.

Step 14 (stepRoundStartIntroAnimation [seen]) then plays the animation. It acts only on frames where FRAME_TICK bit 1 is clear, which is two frames in every four. It dispatches on INTRO_ANIMATION_STEP, and each sub-animation writes the next value itself:

- **0:** flash the ship. PLAYER_SPRITE_ATTRIBUTE 0xAA40 [seen] alternates between colours 62 and 0, with the mirror bits kept. At PLAYER_FLASH_TICK 8 it requests the spawn-flash sound and moves to 1.
- **1:** the flash continues while advanceScriptedCharPlaneBandTo2 [seen] starts the band script. Even passes blank the band. Odd passes restore the saved column, nudge the stub cells by script bits, step thirteen cells of each run through the script, and gather the column back. The script's 0xFF terminator moves to 2.
- **2:** cyclePlayerSpriteColourThenAdvanceStepAtZero [seen] tints the ship (colour 55 for one call, then 63). Alongside it, advanceScriptedCharPlaneBandTo4 [seen] plays the second half of the script in the opposite sense, lowering the stubs where the first half raised them. The countdown reaching zero moves to 3.
- **3:** band-to-4 runs on its own until a script byte with any bit above bit 0 appears. That byte requests the inter-round sound pair and moves to 4.
- **4:** floodColourPlaneWithSavedPlayerColour [seen] paints a rectangle of 28 rows × 27 cells of the colour plane, from COLOUR_FLOOD_FIRST_CELL 0xA044, with the active player's saved pen colour (PLAYER_ONE_PEN_COLOUR 0xAD1C or PLAYER_TWO_PEN_COLOUR 0xAD2C [seen]). This is the playfield taking on the new era's colour. When SCREEN_UNFLIPPED 0xA987 [seen] reads 0 it paints from the far corner backwards, which changes the order of the writes but not which cells are painted. It then moves to 5.
- **5 (and anything higher):** set SEQUENCE_DELAY to 90, hide all sprites, run the context load and HUD post of step 3, and then overwrite the sub-step with INTRO_SUBSTEP_RELOAD 0x2750, which reads 3.

From there the new era starts at step 3, not at step 1 as a life after a death does, so the pen is not re-seated or traced. Steps 3 and 4 run again (the context load runs twice), then the intro, which flashes the new year banner because ROUND_ARMED is 0xFF, then the lead-in, then step 7. What the band looks like on the glass is not established by the code alone.

#### Losing a life, the hand-over, and game over

loseLifeAndHandOver [seen] runs as soon as PLAYER_STATE reads 0:

1. It hides the sprites.
2. **If ROUND_TRANSITION_HOLD is non-zero it runs startNextRound first.** A player who dies after the Mother-Ship's closing sequence has raised the hold still banks the round. The next life starts in the next era, without the band animation.
3. It requests the transition sound burst.
4. It decrements LIVES_REMAINING and copies the live context out to the active player's save block.

If the count reached zero it hands to postGameOverBanner [seen]. That routine posts PLAYER 1 or 2 (command 2, caption 9 or 10) and GAME OVER (command 10, caption 11), sets SEQUENCE_DELAY to 180 and advances to step 8. Reached with PLAY_ACTIVE clear, it instead runs restartAttractSequence.

If the count did not reach zero, the turn passes to the other player only if the other player's saved lives are non-zero. SEQUENCE_DELAY is set to 90 and the sub-step to HANDOVER_SUBSTEP_SEED 0x4B52, which reads 1. The next life (or the other player's turn) therefore re-enters at step 1, seats that player's pen, and traces the route only if the colour changed. In a two-player game the players alternate on every death until one runs out. When one player runs out, step 8 files that player's score, and the turn then passes to the survivor through passTurnToOtherPlayerIfLivesElseStepSequence and handPlayOverToOtherPlayer [seen]. If the score makes no rank this happens at once from step 8. If it does, it happens from loc_12e2 [seen] at step 11, after initials entry. The hand-over flips ACTIVE_PLAYER, sets SEQUENCE_DELAY to 90 and seats sub-step 1.

The demo is started with a single life in PLAYER_ONE_LIVES (verifyImageSignatureThenStartAttractDemoOrDerail [seen]). The demo ship's first death therefore reaches postGameOverBanner with PLAY_ACTIVE clear, which returns the machine to the attract sequence through restartAttractSequence. Clearing the round also ends the demo, through the attract branch of advanceRoundWhenFieldCleared.

### Scoring, bonus lives and the high score

**The score is posted, not added.** Every award in the game is a command-ring pair: command 4 with an award index. It goes onto the 64-cell COMMAND_RING 0xAC00 [seen] through postCommand [seen], and the foreground loop runCommandRingDrainLoop [seen] later hands it to awardScoreToPlayer [seen]. So points are credited outside the frame that earned them. postCommand silently drops the pair if the cell at COMMAND_WRITE_CURSOR 0xA9B2 [seen] is still occupied, which means **a full ring loses the award**.

awardScoreToPlayer does nothing unless PLAY_ACTIVE is set, so the demo scores nothing. Index 0 does not add anything: it repaints the score labels, and in a one-player game erases the absent second score. Any other index selects a three-byte packed-decimal increment from SCORE_AWARD_TABLE 0x0D27. That increment is added low byte first into the active player's score: PLAYER1_SCORE_LO 0xAD33 – PLAYER1_SCORE_HI 0xAD35, or PLAYER2_SCORE_LO 0xAD36 – PLAYER2_SCORE_HI 0xAD38 [seen]. The carry out of the top byte is discarded, so **the score rolls over from 999,999 to zero**.

The table's entries are:

| Award index | Points |
|---|---|
| 1 – 9 | 100 to 900, in steps of 100 |
| 10 | 1,000 |
| 11 | 1,500 |
| 12 | 2,000 |
| 13 | 3,000 |
| 14 | 4,000 |
| 15 | 5,000 |

The posting sites seen in the code:

- **Shot-down targets and ramming contacts go through postChainedHitScore [seen].** It does not post a flat 100. While CHAIN_WINDOW 0xA99D [seen] is still counting, each hit steps CHAIN_STEP 0xA99E [seen] and posts index (step mod 8) + 1. A hit arriving after the window has run out posts index 1. Every hit reloads the window to 30, and expireHitChain [seen] counts it down once per round-engine pass, holding CHAIN_STEP at zero once it is empty. Hits in quick succession therefore pay 100, 200, … 800 and then wrap to 100. **This disagrees with gameplay.md's flat "100 per common enemy"; the code wins.**
- The hit-soaking object posts index 11 (1,500) when its level reaches 0x40 (advanceHitSoakingObjectThenAnimateDeath [seen]).
- The wave's claim-token holder posts index 12 (2,000) once, when driveObjectAppearanceByPhaseBand [seen] consumes CLAIM_TOKEN 0xA821 [seen].
- The Mother-Ship's warp posts index 13 (3,000) (loc_43f0).
- The Mother-Ship's formation-rebuild arm posts index 2 (200) once for each of the fifteen slots that held a live craft.
- The parachutist posts through postNextParachutistBonus [seen], which pays the rungs of PARACHUTIST_BONUS_ARG_TABLE 0x484F — indices 10, 12, 13 and 14 (1,000, 2,000, 3,000, 4,000) — and then index 15 (5,000) for every rescue after that. The rung counter is PARACHUTIST_RUNG 0xA8F7 [seen], which is zeroed at every life start. The ladder therefore restarts on death and on a new era, as gameplay.md's secondary sources say.

**The high score shown on screen is promoted live.** After every award, the player's score is compared most-significant byte first with the single displayed high score, whose top byte is HIGH_SCORE_HI 0xA98D [seen]. If it is strictly greater it is copied over and repainted. That cell starts at the ROM byte DEFAULT_HIGH_SCORE_HI 0x08C9, which reads 1, with the two lower bytes left zero by the work-RAM clear: a displayed high score of 10,000.

**Bonus lives match on the top score byte.** awardBonusLifeAtScoreMark [seen] runs every round-engine pass while PLAY_ACTIVE is set. BONUS_LIFE_SETTING 0xA9C3 [seen] bit 0 chooses one of two ROM mark lists. Each list is a length byte followed by the packed-decimal top-byte values (tens of thousands) at which a ship is awarded:

- **Bit 0 clear** — BONUS_LIFE_MARK_TABLE_BIT0_CLEAR 0x4E1B: twenty marks at 10,000, 60,000 and then every 50,000 up to 960,000.
- **Bit 0 set** — BONUS_LIFE_MARK_TABLE_BIT0_SET 0x4E30: seventeen marks at 20,000, 80,000 and then every 60,000 up to 980,000.

The test is an exact match of the active player's top score byte against the list. No award is worth more than 5,000, so the top byte can never step over a mark. BONUS_LIFE_LATCH 0xAD03 [seen] bit 0 makes the award one-shot: a match while the latch is set does nothing, and the first pass that matches nothing clears it. The latch lives in the per-player context, so each player's latch is separate.

An award increments LIVES_REMAINING. It posts command 5 with the pre-increment count, which repaints the reserve emblems, and requests the bonus-life sound. The lists end at 960,000 or 980,000, so no ship is awarded between the last mark and the rollover. Once the score wraps past 999,999, the same marks match again. This bears on gameplay.md's Wikipedia-only "extra lives up to 960,000" claim: the code has the ceiling, but it applies per trip round the score counter, not for ever.

### The high-score table and initials entry

The table is five eight-byte records from HIGH_SCORE_TABLE_BASE 0xAB08 to HIGH_SCORE_TABLE_END 0xAB2F [seen]. Each record holds a rank byte, a three-byte packed-decimal score (low, middle, high) three initials at +4..+6 and a 0xF1 pad byte at +7. At cold start, loadDefaultHighScores [seen] copies forty bytes from DEFAULT_HIGH_SCORE_TABLE 0x4BB1 over it. The default scores are 10,000, 8,800, 8,460, 6,520 and 4,300. The table lives only in RAM, so a power cycle restores the defaults.

**Filing (step 8).** fileScoreAfterGameOverHoldElsePassTurn [seen] first counts SEQUENCE_DELAY down every frame, which holds the GAME OVER banner for 180 frames. It then calls fileScoreIntoHighScoreTable [seen]. That routine walks the records from the top (HIGH_SCORE_REC0_SCORE_HI 0xAB0B [seen]) and compares the active player's score with each using isScoreBelow [seen], most significant byte first. The score belongs at the first record it is *not* below, so a tie files above the standing entry.

To make room, the records beneath the slot slide down eight bytes, which drops the old fifth record. Three blank name cells (glyph 0xF1) and the score are written into the slot. SCRATCH_PTR_A 0xA991 [seen] is left pointing at the first name cell, and SCRATCH_PTR_B 0xA993 [seen] at the screen cell for that rank's initials, HIGH_SCORE_INITIALS_CELL_BASE 0xA531 plus twice the rank [seen]. The rank column is renumbered 0–4.

A score that beats none of the five is dropped. In that case step 8 erases captions 9 and 11 and sets the sub-step to the program byte SKIP_INITIALS_SUBSTEP_SEED 0x0843 [seen], which is 11 — the operand of a call instruction, read as data. It then passes the turn or advances, going straight past the delay of step 11 to step 12. A filed score instead requests a sound, sets the pen to the blank glyph in colour 0, re-arms the pen route and advances.

**Opening the entry (step 9).** erasePenRouteThenOpenInitialsEntry [seen] traces the pen route one leg per frame. Because the pen was set to the blank glyph, this *erases* what step 2 drew. When the route is finished it:

- posts five captions (command 1, records 19, 0, 20, 21 and 12);
- paints the five labelled readouts of the table (paintFiveLabelledNumericReadouts [seen]);
- clears the four press histories and INITIALS_LETTER_INDEX 0xA999 [seen];
- sets INITIALS_SLOTS_LEFT 0xA99A to 3 [seen];
- stamps the first letter at the cursor;
- records that cell's colour in INITIALS_LOCKED_LETTER_COLOUR 0xA990 [seen];
- advances.

**The entry (step 10).** stepHighScoreInitialsEntry [seen] alternates by FRAME_TICK parity.

On odd frames it flashes the cursor. INITIALS_CURSOR_FLASH_TIMER 0xA99C [seen] steps, and its bit 4 picks the cursor cell's colour, 0x14 or 0x10.

On even frames it samples the control panel facing the picture (readPlayerControls [seen]: IN2_MIRROR 0xA9B0 when the screen is turned round, else IN1_MIRROR 0xA9AF [seen]). Four controls are shifted into their press histories: back into INITIALS_BACK_PRESS_HISTORY 0xA995 [seen], forward into INITIALS_FORWARD_PRESS_HISTORY 0xA996 [seen], fire into INITIALS_COMMIT_PRESS_HISTORY 0xA997 [seen], and a bit-0x20 control into INITIALS_ALT_COMMIT_PRESS_HISTORY 0xA998 [seen]. A "fresh press" is a history whose last three samples read off, off, on.

- A fresh commit, on either commit control, locks the shown letter into both the saved record and the screen. It moves both pointers on and decrements INITIALS_SLOTS_LEFT. Reaching zero finishes the entry at once. A held commit only commits once, because its history is never emptied.
- A fresh forward or back press steps INITIALS_LETTER_INDEX round a ring of 27, looked up in INITIALS_LETTER_GLYPH_TABLE 0x12C7 [seen]: A to Z, then one dot mark.
- A held control auto-repeats because its history is emptied once it saturates. Forward saturates at 0xFF (8 samples), back at 0x7F (7 samples), so **held back repeats slightly faster than held forward**.

Also on even frames, every eighth frame decrements SEQUENCE_DELAY as the entry clock. Nothing reloads it between step 8 and here, so it starts from the zero step 8 left. It therefore wraps and gives the player 256 ticks of eight frames. Running out blanks the cursor cell and finishes the entry. Finishing sets SEQUENCE_DELAY to 60, requests the transition burst and advances.

Throughout the entry, once *both* players' saved lives are zero, the next game can start without waiting:

- on free play, either start button starts it;
- with one credit, only a lone 1-player start is accepted;
- with two or more credits, the 1-player button alone starts a one-player game, and any other start combination starts a two-player game.

**Steps 11 and 12.** loc_12e2 [seen] counts the 60 frames down and then hands the turn to a player who still has lives, or advances to restartAttractSequence.

### The gameplay-config bank (DSW1)

The switch bank at DSW1_PORT 0xC200 (the read side of the watchdog address) is read, complemented (the switches are active-low) and unpacked **once at boot**. seedGameConfigFromDipSwitches and unpackTheFirstThreeSwitchSettings [seen] handle the low four bits, and finishBootSelfTestAndColdStart [seen] handles the rest:

| Bits | Cell | Meaning |
|---|---|---|
| 0–1 | STARTING_LIVES 0xA9C1 [seen] | 3, 4 or 5 lives; the fourth setting would compute 6 and is stored as 0xFF instead, which is 255 lives (gameplay.md's manual says 256) |
| 2 | UPRIGHT_CABINET 0xA9C2 [seen] | the frame service turns the screen round for player two only when this cell reads 0 |
| 3 | BONUS_LIFE_SETTING 0xA9C3 [seen] | chooses the bonus-mark list and the pair of bonus captions the attract screen shows |
| 4–6 | DIFFICULTY_SETTING 0xA9C4 [seen] | 0–7, in the order MAME labels 1 (Easiest) to 8 (Difficult) |
| 7 | DEMO_SOUNDS_ENABLE 0xA9C6 [seen] | enqueueSoundIfGameOrAttract [seen] drops a sound request unless this is set or a game is in play |

The frame service also re-latches the complemented bank into DIP1_MIRROR 0xA9AD [seen] every frame, but nothing reads that mirror. Moving a switch therefore has no effect until the next reset. The coinage bank (DSW0) is covered with the credit pipeline.

#### The difficulty ladder

DIFFICULTY_SETTING is read in exactly one place: the credited branch of step 0, which hands it to loadDifficultyRecord [seen]. That routine copies a four-byte record from DIFFICULTY_RECORD_TABLE 0x186A into START_RUNG_ROUNDS_1_5, START_RUNG_ROUNDS_6_10, START_RUNG_ROUNDS_11_UP and ERA_RUNG_PERIOD [all seen]. The eight records are:

| Setting | Start rung, rounds 1–5 | Rounds 6–10 | Rounds 11+ | Rung period |
|---|---|---|---|---|
| 1 | 0 | 2 | 6 | 13 |
| 2 | 0 | 3 | 7 | 12 |
| 3 | 0 | 4 | 8 | 11 |
| 4 | 2 | 6 | 10 | 10 |
| 5 | 4 | 8 | 12 | 9 |
| 6 | 7 | 10 | 13 | 7 |
| 7 | 11 | 13 | 14 | 5 |
| 8 | 15 | 15 | 15 | 5 |

The demo always uses the third record.

The switch therefore sets two things: which rung each loop *opens* on, and how quickly the rung climbs within a life. The climbing is done by escalateDifficultyRungOnCounterWrap [seen] on every round-engine pass. It advances a three-place base-sixty counter, LIFE_TICKS_LOW 0xAD05, LIFE_TICKS_MID 0xAD06 and LIFE_TICKS_HIGH 0xAD07 [seen], through advanceSexagesimalDigit [seen]. Each time the low place wraps, ERA_RUNG_TIMER counts down. When the timer reaches zero it is reloaded from ERA_RUNG_PERIOD, ERA_RUNG climbs by one (capped at 15), and applyEraRungSettings [seen] re-scatters the settings row.

**The life-tick counter is not a clock.** It counts round-engine passes, and the pass rate varies with how much work each pass does, so the same number of steps takes a varying number of frames [seen].

The settings row is chosen by (ERA_INDEX × 16) + ERA_RUNG through the pointer table ERA_RUNG_SETTINGS_POINTER_TABLE 0x1B04, so there are sixteen rungs for each of the five eras. Its ten bytes feed twelve cells [all seen]:

- BANK_LAUNCH_SLOT_COUNT 0xA844
- BANK_LAUNCH_HEADING_HALF_WIDTH 0xA837
- BANK_LAUNCH_NEAR_HALF_WIDTH 0xA827
- BANK_LAUNCH_COOLDOWN 0xA817 together with its reload BANK_LAUNCH_COOLDOWN_PERIOD 0xA814 (one byte fills both)
- ROUND_CRAFT_COUNT 0xACC1
- SCRIPT_PICK_THRESHOLD 0xACC4
- ATTACKER_SPAWN_SLOT_COUNT 0xA8C6
- ATTACKER_SPAWN_WINDOW_HALF 0xA8D6
- ATTACKER_SPAWN_AIM_WINDOW_HALF 0xA8E6
- ATTACKER_SPAWN_COOLDOWN 0xA8F4 together with ATTACKER_SPAWN_COOLDOWN_PERIOD 0xA8F6 (one byte fills both)

resetPlayfieldAndArmNewRound performs the same scatter at every life start, from the rung it has just reset to START_RUNG. Dying therefore drops the difficulty back to the round's opening rung. This is the whole of "harder": gameplay.md's quoted manual line ("the number of planes attacking you, the speed and number of shots and grenades are gradually increased") is these spawn and launch parameters, stepped by rung within a life and by round bracket across loops.

### The random generator

RANDOM_REGISTER 0xAB30 [seen] is a seventeen-byte shift register. Each call to drawRandomByte [seen]:

1. moves every byte one place along;
2. writes the exclusive-or of the bytes now at positions 7 and 16 into the head;
3. returns that feedback **plus FRAME_TICK**.

So two draws made at different frames differ even where the register has not moved. seedRandomRegister [seen] fills the register from a fixed seventeen-byte run at RANDOM_REGISTER_SEED_SOURCE 0x4B84. It does this at cold start and again at the start of every attract demo, where FRAME_TICK has also just been zeroed, so each demo begins from identical generator state. A real game is not re-seeded; it inherits whatever state the attract cycle left.

The draws feed the enemy wave builder, the free-slot spawner and pickScriptAtRandomOrInTurn [seen]. That routine compares a draw against SCRIPT_PICK_THRESHOLD. A draw at or above it yields one of four movement scripts, 5 to 8. A draw below it yields the next value of the five-long round-robin SCRIPT_CYCLE_COUNTER. A higher threshold therefore biases the game toward the ordered cycle.

The seeding routine carries its own guard. It adds three program bytes (from the words at 0x086D and 0x0870) to the constant 0x44, and the sum must come to zero. If it does not, control jumps to 0x6000, outside the 24 KB program image.

### ROM self-checks and anti-tamper witnesses

Time Pilot does not check its ROM once and refuse to run. Checks are spread through boot, attract and the round engine, and almost none of them fails cleanly. The recurring idiom is that a program block is folded into a value that *already has a job*: the sequence phase, the picture latch, a sub-step seed, a sound code. On a genuine image the fold nets out and the value is unchanged; on a patched image the machine goes somewhere wrong, often far from the patch and long after it. Every fold covers program bytes only, so on a genuine image each is a constant and its failure arm is dead code. Several of the blocks are live code read as data: for example, LEAD_IN_CHECKSUM_BASE 0x0831 starts inside drawKillMeter [seen], and the 0x0F8D pen table is loc_0f8d [code].

**Boot.**

- clearScreenRamAndVerifyImageThenColdInit [seen] sums the whole image, 0x0000–0x5FFF, counting the byte at 0x0000 twice, and the total must be 0xAF. A mismatch jumps into a data table and runs it as code.
- finishBootSelfTestAndColdStart [seen] sums the 256 bytes at BOOT_SELFTEST_CHECKSUM_BASE 0x27DE, which must total 0xC5. A mismatch runs one frame service out of band (saveAccumulatorForFrameInterrupt [seen]) and then cold-starts anyway.
- The random-seed guard jumps to unmapped 0x6000.

**Checks that throw the sequence forward a phase.** Several arms call advanceSequencePhase [seen] on a mismatch. From phase 3 that makes the phase 4, whose low two bits select **phase 0, the boot wipe** — a tampered image restarts the attract cycle from the wipe in the middle of a game. The in-game sites are:

| Arm | Block and test |
|---|---|
| Step 2 | XOR of 256 bytes at IMAGE_GUARD_BLOCK_0BDD_BASE 0x0BDD must be 0x1C |
| Step 4 | XOR of 256 bytes at ROUND_START_CHECKSUM_BASE 0x4C99 must be 0x6B [seen] |
| Step 8's filed path | 8-bit sum of 256 bytes at HIGH_SCORE_FILED_CHECKSUM_BASE 0x01F1 must be 0x19 [seen] |

The attract arms stepSequenceUnderChecksum and guardBlockOrDerailSequence, and the push-start arm blankOneLineThenGuardBlockOrDerailSequence [seen], also call advanceSequencePhase on a mismatch. From phases 1 and 2 this moves the machine one phase on, not to the wipe.

**Folds into the phase itself.** These write SEQUENCE_PHASE unconditionally and leave it at 3 only on a genuine image. A patched image gets an arbitrary phase byte, whose low two bits pick an arbitrary mode with an unreset sub-step.

- *Subtract-folds.* Each subtracts 256 program bytes from the phase and closes with an XOR key. The two only cancel for a phase of 3, which is always the case when these arms run.
  - Step 0's demo branch: SEQUENCE_PHASE_CHECKSUM_BASE 0x3310, key 0x90 [seen].
  - Step 5, every frame: ROUND_INTRO_CHECKSUM_BASE 0x4D9F, key 0xA2 [seen].
  - Step 6, every frame: LEAD_IN_CHECKSUM_BASE 0x0831, key 0xC2 [seen].
  - Step 6, on the frame the delay expires: LEAD_IN_EXPIRY_CHECKSUM_BASE 0x12A7, key 0x59 [seen].
- *Additive folds.*
  - Step 1: thirty bytes at CAPTION_PEN_CHECKSUM_BASE 0x178C [seen], plus 0x2C.
  - Step 2: twenty bytes of advancePenRunAnimationStep's code at 0x1734, plus 0x77.
- *The sub-step seed.* restartAttractSequence's second write of the sub-step folds a word read from 0x4902 and the byte at ATTRACT_RESTART_FOLD_BYTE 0x4901 [seen], less 155. On a genuine image that comes to 0; on a patched one the attract sequence restarts at some other step.

**The picture latch.** Step 0 writes (XOR of DISPLAY_LATCH_CHECKSUM_BASE 0x1550 [seen]) + 1 to VIDEO_ENABLE_LATCH 0xC308. Step 3 writes (XOR of TAMPER_CHECKSUM_SPAN_BASE 0x5B50) − 1 to the same latch. On the genuine image these come to 0x4D and 0x51, both odd. A patched block writes a different value, which can turn the picture off mid-game. The attract arm guardBlockOrBlankDisplay [seen] switches the display off outright on a mismatch. It also overwrites TAMPER_WITNESS with the glyph and colour of a character cell copied from the display (TAMPER_WITNESS_SAMPLE_CELL 0xA65C).

**Cold starts.**

- armThePenRouteThenColdStartOnATamperedImage [seen] runs at steps 1 and 8. Its 256-byte sum at PEN_ROUTE_CHECKSUM_BASE 0x0E33 [seen] must be 0xFD, or the machine cold-starts.
- drawCountAsPictogramStrip, the round-number HUD, folds the three image words at 0x009D, 0x00A0 and 0x00A3, which must net 0x69, or it jumps to the reset vector.

**Derails into data.** These arms jump into bytes that are not code and destroy control:

| Arm | Test | Landing |
|---|---|---|
| drawEmblemStripThenGuardImage [seen], the reserve-ships HUD | XOR of 0x0711–0x0810 plus 25 must be 0 | the default high-score block at 0x4BB1, run as code |
| Step 9 | XOR of INITIALS_ENTRY_CHECKSUM_BASE 0x4880 must be 0x30 [seen] | the frame service, entered from outside an interrupt |
| erasePenRouteThenAdvanceStep [seen], attract | 8-bit sum of 256 bytes at 0x4AA0 must be 0xB8 | loc_08fa [code] |

**Witnesses: the screen as a checksum.** During the attract sequence, glyph/colour pairs are placed in work RAM. Most are copied from the character plane as the genuine image painted it. The attract screen's patch list also seeds TAMPER_WITNESS and TAMPER_GLYPH_COPY directly with literal values. TAMPER_IMAGE_SIGNATURE, which is checked alongside them, is a fold of program bytes rather than a screen sample. Much later, often in the middle of play, routines compare those copies against literals. A patched caption, font or colour therefore survives attract and only bites in play:

- **TAMPER_WITNESS 0xAD39 [seen]** is seeded with glyph 0x68 and colour 0x05. When eras 0–3 seat their scenery, seedSceneryEntriesThenRunScenery [seen] requires 0x68, then 0x10 or 0x05. Otherwise it diverts into the tail of an unrelated sprite-entry fill (loc_307f [code], through trampolineToLoc_307f [code]).
- **TAMPER_GLYPH_KONAMI 0xACC7 [seen]** holds the "N" of the "(c) KONAMI 1982" caption, with its colour in the next cell. holdCopyrightThenEraseTheCoinInvitation [seen] copies both from the caption cell when the copyright hold expires. Two steps later, holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail [seen] reads the same caption cell through a pointer built from a program byte, derails unless it holds 0x3B, and then seats TAMPER_GLYPH_COPY. The era-4 scenery seat, clearSceneryEntriesThenRunEraScenery [seen], requires 0x3B and then colour 0x05 or 0x10. Otherwise it jumps into a packed table run as code (loc_315b [code]). Attract step 6 already derails when that same caption cell's glyph is not 0x3B, and steps 5 and 6 derail when any of the copyright line's thirteen colour cells (checkTheCopyrightLineColoursOrDerail [seen]) is not 0x10 or 0x05. Until step 4 first copies the cell, the pair holds the literal 0x3B and 0x05 that the power-on patch list (armAttractScreenShowingHighScore [seen]) seeds. So a patched copyright caption derails in attract once the checks after step 4 have run. A game started by a credit or a free-play start before then plays with the literal pair if step 4 has not yet run, or with the patched copy if it has, and in the second case it dies on reaching 2001. This path has not been watched running.
- **TAMPER_GLYPH_COPY 0xAB43 [seen]** holds glyph 0x7C, copied from TAMPER_GLYPH_SOURCE_CELL 0xA67C. It is checked in two places:
  - When the Mother-Ship's warp finishes, loc_43f0 requires 0x7C followed by colour 0x10 or 0x05. Otherwise it enters stepMotherShipWarpFlashFrame [code] through a misaligned prologue that pops the stack out of step.
  - At a two-player start, setUpTwoPlayerStartObjectOnce [seen] compares the copy with the live cell. A mismatch replays a fragment of the Mother-Ship warp's bookkeeping, including a 3,000-point award.
- **TAMPER_GLYPH_STRIP 0xABFE / TAMPER_COLOUR_STRIP 0xABFF [seen]** are rechecked at the start of every player death. The round engine hands the player's frame to advancePlayerAnimationStrip [seen] whenever PLAYER_STATE is neither 0 nor 0xFF. On that animation's opening frame (state 0xB4 or above; a kill sets 0xF0) the routine requires glyph 0xA5 and colour 0x05 or 0x10. Otherwise it diverts into direction-table bytes run as code (loc_1f2e [code]).
- **TAMPER_GLYPH_READBACK 0xADFB / TAMPER_COLOUR_READBACK 0xADFC [seen]** gate the demo's autopilot seed (seedDemoAutopilotScript [seen]). The glyph must be 0xFD and the colour 0x10 or 0x05; otherwise control lands in a data trap, loc_2251 [code].
- **TAMPER_IMAGE_SIGNATURE 0xAA6F [seen]** holds the folded signature of a program block (foldImageBlockIntoSignatureThenAdvanceSequence [seen]). It must read 0x76 before the demo starts (verifyImageSignatureThenStartAttractDemoOrDerail [seen]); otherwise control transfers to 0x2530.

**Program bytes standing in for constants.** Beyond the explicit checks, many values the sequence needs are fetched from program bytes rather than written as immediates, so a patch anywhere near them misroutes the machine:

- NEXT_ROUND_START_SUBSTEP 0x4A35 (13)
- HANDOVER_SUBSTEP_SEED 0x4B52 (1)
- INTRO_SUBSTEP_RELOAD 0x2750 (3)
- ATTRACT_SEQUENCE_START_PHASE 0x16D3 (1)
- SEQUENCE_PHASE_ON_CREDIT 0x1736 (2)
- ROUND_TRANSITION_HOLD_SEED 0x07D1 (0)
- SKIP_INITIALS_SUBSTEP_SEED 0x0843 [seen], a call operand
- INTRO_ANIMATION_STEP_SEED 0x3213 [seen], an instruction operand
- six of the seven codes in the transition sound burst

**What a bad copy does:** it boots only if the whole-image sum and the boot block agree. It may then play normally for a while before it restarts from the wipe, freezes on a jump into data, blanks its picture, lands in the wrong attract step, or asks for the wrong sounds. Which of these happens, and when, depends on which bytes were changed.

## §3 The world moves, not the ship

Time Pilot's ship never goes anywhere. Its sprite is placed once at the middle of the picture and stays there. What the joystick changes is the ship's *heading*, and each frame that heading is turned into a velocity which is applied, negated, to everything else on the screen. So the camera is simply the ship's velocity reversed, and every other moving thing in the game (clouds, enemies, shots, the Mother-Ship, parachutists) picks up that reversed velocity as part of its own motion. This section follows that chain from the stick to the heading, from the heading to the scroll, and from the scroll to the scenery. It then covers the three separate counters the game uses where the manual only says "round": the era, the round number and the difficulty rung.

### The ship is pinned; the camera is its negated velocity

When a life or round begins, resetPlayfieldAndArmNewRound [seen] writes the player's sprite entry at PLAYER_ENTRY 0xAA10 [seen] and PLAYER_SPRITE_Y 0xAA41 [seen] to 132 and 120. It sets PLAYER_STATE 0xA800 [seen] to 0xFF (alive), points PLAYER_HEADING 0xA802 [seen] at 128, and zeroes both scroll words. From then on, no routine that runs for the player writes those two coordinate bytes again. Each frame only the sprite's shape and attribute bytes are rewritten by dressPlayerSpriteForHeading [seen], which rounds the 256-step heading to the nearest of 32 sectors and looks the shape and attribute up in the two parallel 32-entry halves of PLAYER_HEADING_SHAPE_TABLE 0x20CE. The ship turns on the spot and never translates.

The motion lives in two 16-bit cells, WORLD_SCROLL_Y 0xA808 [seen] and WORLD_SCROLL_X 0xA80A [seen]. Both are 8.8 fixed point, so 256 means one pixel per step. Only two routines write them. resetPlayfieldAndArmNewRound [seen] zeroes them. negateVelocityIntoWorldScrollThenDressSprite [seen] takes the ship's velocity pair for this frame, negates each component as a 16-bit quantity, stores the results, and then dresses the ship's sprite. Neither of those writers remembers the ship's velocity anywhere else. The ship has no position and no stored velocity of its own: the scroll pair is its motion. The only other thing the game keeps about the ship is which way it points.

The consequence is easy to miss: nothing reverts the scroll between frames. dispatchPlayerFrameByState [seen] returns at once when PLAYER_STATE is zero. While the state byte is counting through an animation it hands off to the animation strip, and that path doesn't touch the scroll either. So WORLD_SCROLL_Y and WORLD_SCROLL_X keep the last value they were given until the next playfield reset zeroes them, and while the ship is exploding the world goes on drifting at the dead ship's last speed and direction [seen]. The drift ends with the countdown, not with the reset: when PLAYER_STATE reaches zero, loseLifeAndHandOver [seen] hides every sprite, and from then until the reset the scenery's coordinates stand still even though the scroll still holds the dead ship's velocity [seen].

### From stick to heading: the turn

dispatchPlayerFrameByState [seen] routes the live ship's frame based on the stick. It asks readPlayerControls [seen] for the panel word and keeps the low four bits. If they are all clear, the stick is centred and it goes straight to scrollWorldAtTheEraPace [seen]: the heading is left alone and the ship keeps flying the way it points, so there is no throttle and no stopping. If any direction bit is set, it goes to turnShipTowardTargetHeading [seen]. In the attract demo, with PLAY_ACTIVE 0xAD30 [seen] clear, the stick is ignored. flyDemoShipByScript [seen] then nudges the heading by 3 steps either way (or not at all) from a dwell-and-command script at DEMO_SCRIPT_DWELL 0xADF2 [seen] / DEMO_SCRIPT_POINTER_LO 0xADF3 [seen], and falls into the same scroll routine.

turnShipTowardTargetHeading [seen] uses the four direction bits as an index into a 16-byte table, STICK_HEADING_TABLE 0x1F2E [seen]. That address also decodes as a routine, loc_1f2e [code], but only a tampered image ever runs it as code. The panel's bits are left 0x01, right 0x02, up 0x04 and down 0x08, and the table maps them to eight target headings spaced 32 apart: left 0, down-left 32, down 64, down-right 96, right 128, up-right 160, up 192, up-left 224. Heading therefore increases anticlockwise on the glass, and the 128 seated at life start faces right. Pairs that no stick can produce, such as left+right, read 0 from the table, which is the same target as left.

The turn itself is a small state machine on the difference *current minus target*, taken as a wrapped byte:

- If the difference is zero, nothing changes.
- If the target is exactly one step away on either side, the heading is set onto it. This is the arm the ROM enters at 0x1F3E, snapHeadingOntoTheTurnTarget [seen].
- Otherwise the heading moves a fixed number of steps round the shorter way. It goes up when the difference is 128 or more and down when it is less. When the target is exactly opposite (a difference of 128), the heading always goes up.

The step size depends on the era. It is 3 steps while ERA_INDEX 0xAD04 [seen] is below 3, and 4 steps in the fourth and fifth eras. The code masks the era to its low four bits before comparing, which has no effect on the values 0–4 the cell holds. A step of 4 divides the 32-step spacing, so the heading always lands exactly on a target. A step of 3 does not. If the remaining gap is 1 more than a multiple of 3, the heading lands one step short and snaps on. If it is 2 more than a multiple of 3, the heading lands two short, which is outside the snap window, so it steps past the target by one and snaps back on the next dispatch. That one-step overshoot is part of how the early eras handle.

So the ship can't flip round instantly. Reversing course is an ordinary turn of 128 steps. It takes 44 dispatches at the slow step (42 steps of 3 bring the heading 2 short, one more step overshoots by 1, and a snap lands it) and 32 at the fast one. The heading sweeps through the half-circle between the two targets, and dressPlayerSpriteForHeading draws every sector on that half-circle along the way. This settles the "can it about-face?" disagreement in gameplay.md: the code only allows a sweep round, never a flip.

Enemy craft turn on a separate rule, described with the enemies. Their step comes from TURN_RATE_BY_ERA_TABLE 0x2C1D (1, 1, 2, 2, 5 by era) through steerTowardAimHeading [seen]. In the fifth era, when a craft's native-Y byte is within 72 of either reference value 120 or 132, steerEnemyTowardShip [seen] temporarily overwrites ERA_INDEX with 0 around the turn to select the slow rate, and then writes 4 back. Outside that window it turns at the fifth era's own rate of 5. That is safe only because the fifth era's handler is its sole caller. For a moment, "the era" cell is not the era.

### From heading to velocity, and which axis is which

velocityForHeading [seen] reads the pair from a velocity table. The table is 256 signed 16-bit samples, one per heading step, and it looks like a cosine. The first component is the sample at the heading and the second is the sample a quarter-turn (64 steps) earlier, so the two components are perpendicular. The table's peak value is the speed. Across the circle, the length of the resulting vector stays within about 4–5% of that peak (4% in the opening-era table, nearer 5% in the two fastest). The diagonals are within 1% of it (about 254 against 256 in the opening-era table). The low points are a few irregular samples, such as headings 51 and 243, where the length is about 246.

scrollWorldAtTheEraPace [seen] passes the first component on as the one that lands in WORLD_SCROLL_Y and the second as the one that lands in WORLD_SCROLL_X. **Those names refer to the board's native raster axes, not the player's view.** The board is mounted ROT90. Native Y is the display's horizontal axis, mirrored (`display_x = 239 - native_y`), and native X is the display's vertical axis (`display_y = native_x`).

Check this against heading 0, which is stick-left. The first component is +256 along native Y, which is leftwards on the glass. WORLD_SCROLL_Y gets −256, which slides the world rightwards. Now heading 64 (down): the second component is the table's first sample, +256 along native X, which is downwards, and the world slides up. In each case the world moves against the stick, as gameplay.md describes. Anyone reading WORLD_SCROLL_Y as "vertical scroll" gets the axis wrong. Anyone reading it as "horizontal" gets the axis right but has the sign mirrored.

### The era sets the pace

scrollWorldAtTheEraPace [seen] reads the heading; it doesn't set it. Some paths write the heading before calling it and others arrive with whatever heading is already stored. It chooses the velocity table from ERA_INDEX 0xAD04 [seen] alone, split three ways:

- The opening era (1910) uses OPENING_ERA_VELOCITY_TABLE 0x5E00, which peaks at 256 (1.0 pixel per step).
- The second and third eras (1940, 1970) share SECOND_FASTEST_VELOCITY_TABLE 0x2E3E [seen], which peaks at 306 (about 1.2 pixels). The same bytes are also a trap target on the tamper path.
- The fourth and fifth eras (1982, 2001) share VELOCITY_TABLE_08FA 0x08FA, which peaks at 331 (about 1.3 pixels). Those bytes also double as the checksum-failure landing loc_08fa.

These are three of five velocity tables in the image that have the same shape at different sizes. The other two are VELOCITY_TABLE_5C00 0x5C00 (peak 231) and SLOWEST_VELOCITY_TABLE 0x59D7 [seen] (peak 206). Together the peaks run 206, 231, 256, 306, 331, a ladder in steps of 25 with no 281 among the tables any routine loads (a 281-peak table does sit at 0x2530, but no routine loads it as a table). Enemy movers pick from the same ladder, including at double length through doubledVelocityForHeading [seen]. So "faster" and "slower" in this game always mean a different table, never a scaled value. The Mother-Ship takes its speed from the ladder by era the same way (setMotherShipVelocityFromHeading [seen]): its arm table at 0x46C4 holds one word for each of the five eras and ends where fileTwoPairsIntoObjectRecordHighByteFirst [seen] begins, at 0x46CE. The era is masked to three bits, so indices 5–7 would read that routine's own bytes as arm words. The eighth names the six-digit painter, handed a cursor inside that same routine, so its first store would be a write to ROM. No writer of ERA_INDEX found stores anything above 4: the direct stores are the round wrap in startNextRound and the 0 and 4 around the fifth era's turn, and the context copies bring in the per-player era cells, which are only ever set to 0, to the demo's 1–3, or from ERA_INDEX itself. So in play only the table's first five words are read.

Two consequences follow. First, the turn rate and the pace don't change together. Pace changes at eras {0}, {1,2}, {3,4}; turn step changes at {0,1,2}, {3,4}. Second, the pace depends only on the era and ERA_INDEX wraps. After 2001 it goes back to 0, so the second loop's 1910 scrolls and turns exactly like the first. Whatever the manual's "speed … gradually increased" refers to, it isn't the ship.

### Everything rides the scroll

Inside the round engine's per-dispatch block, serviceRoundThenResolvePlayerState [seen] runs the player's frame (and so the new scroll) second. Only reaimAndAnimateEnemyCraftOnPhaseTick [seen] runs before it. When the low place of the life tick counter reads 00–09 or 30–39, it re-aims and animates at most one enemy craft. On other values whose units digit is 7, it instead lays out the enemy aim points around the ship's centre from the heading as it stood before this dispatch's turn. Neither branch moves any object. Every shot, enemy, parachutist, Mother-Ship and scenery mover comes after, so everything that moves reads the scroll the ship has just set. For sprite objects each coordinate is held split: the whole pixel sits in the sprite entry (`+0x31` for native Y, `+0x00` for native X) and the fraction sits in the object's record (`+3` and `+5`). Player shots are the exception. Both halves of each shot coordinate are in the shot's own record as a 16-bit word at `+3` and `+5`, the shot is drawn by tile stamp, and it is culled when it leaves the field. The two halves are added as one 16-bit number, so movement smaller than a pixel accumulates in the fraction. Nothing is clamped, and a byte coordinate simply wraps at 256.

- driftWithWorldScroll [seen] adds exactly the scroll pair. Something moved only this way is fixed in the world and streams past the pinned ship.
- flyAlongHeading [seen] adds the scroll *plus* the object's own velocity for its own heading, from a table the caller chooses. flyAlongHeadingAtDoubleVelocity [seen] does the same at twice the length. Enemy flight is always "own motion + camera".
- flyAlongStoredVelocity [seen], flyAlongBallisticArc [seen] and the Mother-Ship's own stepper, reached through armMotherShipOrStep [seen], likewise add WORLD_SCROLL_Y / WORLD_SCROLL_X on top of their own motion.
- A player shot is launched by fireAndSweepPlayerShots [seen] with a stored per-step displacement of −4 × the scroll, which is four times the ship's own velocity. Each sweep then adds the scroll again, so a shot moves across the screen at three times the ship's velocity while travelling through the world at four times it.

### Depth: scenery that lags and leads

The scenery (clouds, and the asteroids of the last era) is the one thing that does not ride the scroll one-for-one. Three wrappers take the same scroll pair and change it first:

- driftAtHalfWorldScroll [seen] goes through displaceByHalf [seen], moving by the displacement minus half of it (half the pace).
- driftAtThreeQuartersWorldScroll [seen] goes through displaceByThreeQuarters [seen], moving by the displacement minus a quarter (three-quarter pace).
- driftAtFiveQuartersWorldScroll [seen] goes through displaceByFiveQuarters [seen], moving by the displacement plus a quarter (five-quarter pace).

The halves and quarters are taken with an arithmetic shift, so they round toward negative. An object at half or three-quarter pace falls behind the world and reads as distant. One at five-quarter pace moves past faster than the world and reads as nearer than the playfield. That is the whole parallax model. There are three scenery depths around the playfield's 1:1: two behind it (half and three-quarter pace) and one in front of it (five-quarter pace).

A scenery object can be wider than one sprite. Only its first tile drifts. placeAbuttingTile [seen] positions each further tile from the tile before it, the same native X and native Y plus 16, which is one sprite's width. placeDiagonallyAbuttingTile [seen] positions a tile 16 back on native Y and 16 on along native X, with a wrap on the low byte carrying into the high one. After each tile, advanceToNextSlot [seen] steps the record cursor by 16 and the sprite-entry cursor by 2. Because the extra tiles are rebuilt from the head every frame, a multi-tile cloud never comes apart.

### Seating and running the scenery per era

The scenery occupies eight sprite slots starting at SCENERY_RECORD_SLOT0 0xA900 [seen] and SCENERY_ENTRY_SLOT0 0xAA30 [seen]. runSceneryForEra [seen] starts at the first slot and chooses one of three running orders from ERA_INDEX. Each order fills exactly eight slots.

- **1910 (era 0):** one three-tile object at five-quarter pace (driftThreeTileSceneryAtFiveQuarters [seen]), two two-tile objects at three-quarter pace (driftTwoTileSceneryAtThreeQuarters [seen]), and one single tile at half pace (driftOneTileSceneryAtHalf [seen]).
- **1940–1982 (eras 1–3):** the same list, except that the near object is a cornered three-tile shape (driftNearestSceneryTriTile [seen]: one abutting tile and one diagonal tile).
- **2001 (era 4):** two two-tile objects at five-quarter pace (stepTwoTileSceneryAtFiveQuarters [seen]), two single tiles at three-quarter pace (driftOneTileSceneryAtThreeQuarters [seen]) and two single tiles at half pace.

Any index other than 0 or 4 falls to the middle order and is not rejected. The scenery's era split is therefore {0}, {1,2,3}, {4}, which is different from both the pace split and the turn split. There are three independent readings of one era cell, and none of them agrees with the others on where the boundaries are.

Nothing retires a scenery object when it leaves the picture. Both of its byte coordinates just wrap round the 256-wide space, in every era, and its slot keeps its shape byte; the shape bytes change only when a playfield reset seats a new era row [seen].

The scenery is laid out again at every playfield reset. resetPlayfieldAndArmNewRound [seen] calls seatEraSceneryRowThenClearAndRunScenery [seen], which copies eight bytes from the era's row of ERA_SCENERY_ROW_TABLE 0x3176 [seen] into the shape bytes of the eight slots, SCENERY_SPRITE_CODE_SLOT0 0xAA31 [seen] at stride 2. It then hands clearSceneryEntriesThenRunEraScenery [seen] a fill byte, 0xCC, or 0x28 in the fifth era. That routine writes the fill byte into the eight attribute bytes from SCENERY_SPRITE_ATTRIBUTE_SLOT0 0xAA60 [seen] at stride 2, and then sets the starting positions:

- Below the fifth era, seedSceneryEntriesThenRunScenery [seen] takes four packed pairs from SCENERY_SEED_TABLE 0x316E. Each pair supplies a native-Y byte (written to a slot's `+0x31`, and plus 16 to the next slot's) and a native-X byte (written to both slots).
- In the fifth era, eight pairs from ERA4_SCENERY_SEED_TABLE 0x315E seat all eight slots directly.

In both cases it runs one scenery frame immediately. Each seating path has its own anti-tamper sentinel pair: the four-object path checks TAMPER_WITNESS 0xAD39 [seen] and the byte after it, and the fifth-era path checks TAMPER_GLYPH_KONAMI 0xACC7 [seen] and the byte after it. A genuine image always passes them. Because the positions come from fixed tables, the sky starts from the same layout on every life.

### Era, round and rung are three different counters

The manual's "Round 6 is identical with Round 1 … but harder" is implemented with three separate cells:

- **ERA_INDEX 0xAD04** [seen] is which of the five eras is being played, 0–4. startNextRound [seen] increments it and wraps it to 0 after the fifth. It selects pace, turn rate, scenery, enemy handlers and the spawn-settings row.
- **ROUND_NUMBER 0xAD01** [seen] counts rounds and does not wrap at five. startNextRound [seen] increments it too.
- **ERA_RUNG 0xACC0** [seen] is an escalation rung from 0 to 15 within the current era. It is the only thing that makes a later lap harder.

startNextRound [seen] connects them. After the increments it uses the *new* round number to choose a starting rung: START_RUNG_ROUNDS_1_5 0xA9D3 [seen] for rounds below 6, START_RUNG_ROUNDS_6_10 0xA9D4 [seen] for rounds 6–10, and START_RUNG_ROUNDS_11_UP 0xA9D5 [seen] from 11 on. The chosen value goes into START_RUNG 0xAD0A [seen]. startNextRound also refills KILLS_REMAINING 0xAD02 [seen] from KILL_QUOTA 0xA9CD [seen], which is loaded once at boot from the ROM byte at 0x0874 (DEFAULT_KILL_QUOTA, value 56). That fill never depends on the era or the rung, so every round of every lap asks for the same 56. It clears MOTHER_SHIP_ARMED 0xAD0D [seen] and ROUND_TRANSITION_HOLD 0xACC6 [seen], and sets ROUND_ARMED 0xAD0E [seen] to 0xFF. The same routine is reached from advanceRoundWhenFieldCleared [seen]. It is also reached from loseLifeAndHandOver [seen] when a life ends while ROUND_TRANSITION_HOLD is still up, so dying during the round-won transition still moves on to the next era.

The rung row is applied by (era × 16) + rung, indexing ERA_RUNG_SETTINGS_POINTER_TABLE 0x1B04. That table holds 80 pointers (five eras × sixteen rungs), each to a ten-byte row. resetPlayfieldAndArmNewRound [seen] (at a reset) and applyEraRungSettings [seen] (at each climb) spread that row over twelve cells:

- the bank-launch family: BANK_LAUNCH_SLOT_COUNT 0xA844, BANK_LAUNCH_HEADING_HALF_WIDTH 0xA837, BANK_LAUNCH_NEAR_HALF_WIDTH 0xA827, and one byte into both BANK_LAUNCH_COOLDOWN 0xA817 and BANK_LAUNCH_COOLDOWN_PERIOD 0xA814 (all [seen]);
- ROUND_CRAFT_COUNT 0xACC1 [seen] and SCRIPT_PICK_THRESHOLD 0xACC4 [seen];
- the attacker-spawn family: ATTACKER_SPAWN_SLOT_COUNT 0xA8C6, ATTACKER_SPAWN_WINDOW_HALF 0xA8D6, ATTACKER_SPAWN_AIM_WINDOW_HALF 0xA8E6, and one byte into both ATTACKER_SPAWN_COOLDOWN 0xA8F4 and ATTACKER_SPAWN_COOLDOWN_PERIOD 0xA8F6 (all [seen]).

So difficulty means how many craft come, how often, and from how wide a window. It never affects how fast the world or the ship moves.

### The difficulty rung climbs during a life

resetPlayfieldAndArmNewRound [seen] seeds ERA_RUNG from START_RUNG and loads ERA_RUNG_TIMER 0xA9D7 [seen] from ERA_RUNG_PERIOD 0xA9D6 [seen]. It also zeroes the three-place base-sixty counter LIFE_TICKS_LOW / MID / HIGH 0xAD05–0xAD07 [seen]. This reset runs at every round arm and after every lost life: loseLifeAndHandOver [seen] sends the sequence back to sub-step 1, and from there the round-start arm reaches the reset again. So the rung returns to the round's starting value each time a new ship appears.

After that, once per dispatch of the round engine, escalateDifficultyRungOnCounterWrap [seen] advances LIFE_TICKS_LOW through advanceSexagesimalDigit [seen]. That is a packed-decimal step that rolls over at 60, carrying into the middle and high places. Only when the low place rolls over does it decrement ERA_RUNG_TIMER. When the timer reaches zero, it reloads the timer from ERA_RUNG_PERIOD, raises ERA_RUNG by one up to a maximum of 15, and calls applyEraRungSettings [seen] to spread the new row. The rung therefore climbs once every *period* × 60 round-engine dispatches for as long as the ship survives, then stays at 15. The counter measures round-engine work rather than time, because the engine is not dispatched on every frame. A timer loaded with zero would never climb, but no difficulty record supplies zero.

### The DIP sets the ladder

At power-on, seedGameConfigFromDipSwitches [seen] complements DSW1 (0xC200) and splits it up:

- Bits 0–1 give lives 3, 4 or 5; the fourth setting is stored as 0xFF. This goes into STARTING_LIVES 0xA9C1 [seen].
- Bit 2 goes into UPRIGHT_CABINET 0xA9C2 [seen].
- Bit 3 goes into BONUS_LIFE_SETTING 0xA9C3 [seen]. These three are handled by unpackTheFirstThreeSwitchSettings [seen].
- Bits 4–6 go into DIFFICULTY_SETTING 0xA9C4 [seen], where 0 is the easiest.
- Bit 7 goes into DEMO_SOUNDS_ENABLE 0xA9C6 [seen]. These last two are handled by finishBootSelfTestAndColdStart [seen].

The vblank service also stores a complemented copy of the bank every frame in DIP1_MIRROR 0xA9AD [seen].

When a credited game starts, armRoundStartThenStepSequence [seen] calls loadDifficultyRecord [seen] with DIFFICULTY_SETTING. That routine copies one four-byte record from DIFFICULTY_RECORD_TABLE 0x186A into START_RUNG_ROUNDS_1_5, START_RUNG_ROUNDS_6_10, START_RUNG_ROUNDS_11_UP and ERA_RUNG_PERIOD. armRoundStartThenStepSequence then seeds both players' PLAYER_ONE_START_RUNG 0xAD1A [seen] / PLAYER_TWO_START_RUNG 0xAD2A [seen] from the first of the four. The eight records in the ROM are:

| DIP setting | start rung, rounds 1–5 | rounds 6–10 | rounds 11+ | rung period |
|---|---|---|---|---|
| 0 (easiest) | 0 | 2 | 6 | 13 |
| 1 | 0 | 3 | 7 | 12 |
| 2 | 0 | 4 | 8 | 11 |
| 3 | 2 | 6 | 10 | 10 |
| 4 | 4 | 8 | 12 | 9 |
| 5 | 7 | 10 | 13 | 7 |
| 6 | 11 | 13 | 14 | 5 |
| 7 (hardest) | 15 | 15 | 15 | 5 |

A harder setting starts higher and climbs sooner. The loop escalation is only the move from one starting-rung column to the next at rounds 6 and 11, so a lap is harder than the previous one only because each life starts higher on the same per-era rows. At the hardest setting every column is already 15. The rung is at its maximum from the first ship, so there is no escalation during a life or between laps at all.

The attract demo ignores the switch. It loads record 2 directly, and it cycles ATTRACT_STAGE_COUNTER 0xA9D0 [seen] through 1, 2 and 3 into PLAYER_ONE_ERA_INDEX 0xAD14 [seen]. As a result the demo only ever shows 1940, 1970 and 1982.

### Cabinet and flip

Every frame, serviceVerticalBlankInterrupt recomputes SCREEN_UNFLIPPED 0xA987 [seen]. It is 1 unless ACTIVE_PLAYER 0xAD32 [seen] is non-zero (player two) *and* UPRIGHT_CABINET reads zero, in which case it is 0. The service copies the value to FLIPSCREEN_LATCH 0xC302. Three readers use it:

- publishSpriteShadow [seen] selects a turned-round set of byte transforms when it copies the sprite shadow to the two hardware banks.
- readPlayerControls [seen] returns IN2_MIRROR 0xA9B0 [seen] (the second, cocktail panel) instead of IN1_MIRROR 0xA9AF [seen].
- floodColourPlaneWithSavedPlayerColour [seen] floods its colour from the opposite corner.

The two panels use the same bit layout. Because the picture is turned round along with the panel, the heading table STICK_HEADING_TABLE 0x1F2E serves both players unchanged.

UPRIGHT_CABINET is named for the value it holds. The flip happens when that cell is **zero**, and SCREEN_UNFLIPPED only reads 0 on a cocktail cabinet with player two up. So the cell holds 0 on a cocktail cabinet and 1 on an upright: "cabinet type, 1 = upright" [seen]. Under MAME the boot write at 0x2E22 stores 01 on an upright run and 00 with the cabinet switch set to cocktail, and on the cocktail run FLIPSCREEN_LATCH 0xC302 [seen] is written 00 at 0x0109 on player two's turns and 01 on player one's, the player-two value coming from the 0x0103 write of SCREEN_UNFLIPPED.

### Fixed ROM tables the world reads

Every constant in this section is data burned into the program image, and several of those tables share their addresses with code:

- **Stick to target heading:** 16 bytes at STICK_HEADING_TABLE 0x1F2E.
- **Velocity ladder:** 256 signed words each at SLOWEST_VELOCITY_TABLE 0x59D7, VELOCITY_TABLE_5C00 0x5C00, OPENING_ERA_VELOCITY_TABLE 0x5E00, SECOND_FASTEST_VELOCITY_TABLE 0x2E3E and VELOCITY_TABLE_08FA 0x08FA, with peaks 206/231/256/306/331. The ship uses the last three, by era.
- **Ship sprite by heading:** PLAYER_HEADING_SHAPE_TABLE 0x20CE, 32 shapes and then 32 attributes.
- **Player shot launch point by heading:** PLAYER_SHOT_SPAWN_POSITION_TABLE 0x2771. It has 32 entries, and each is a pair of whole-pixel coordinates (native Y, native X) on a small ring around the pinned ship at (120, 132).
- **Enemy turn rate by era:** TURN_RATE_BY_ERA_TABLE 0x2C1D.
- **Scenery:** shape rows at ERA_SCENERY_ROW_TABLE 0x3176, eight per era; starting positions at SCENERY_SEED_TABLE 0x316E (eras 0–3) and ERA4_SCENERY_SEED_TABLE 0x315E (era 4).
- **Spawn tuning:** ERA_RUNG_SETTINGS_POINTER_TABLE 0x1B04, 80 pointers to ten-byte rows.
- **Difficulty records:** DIFFICULTY_RECORD_TABLE 0x186A, eight four-byte records.
- **Kill quota:** the byte at 0x0874 (DEFAULT_KILL_QUOTA), 56.

Several of these tables (at 0x2E3E, 0x08FA, 0x1F2E, and the 206-peak table at 0x59D7) share their bytes with jump targets on the anti-tamper paths. On a genuine image the world only ever reads them as data.

## §4 Objects: one array, two tables, and two ways onto the screen
Everything that moves in Time Pilot, except the player's shots, is one entry in a single array of twenty-four object slots. Each slot owns two pieces of memory in two different tables: a sixteen-byte **record** in work RAM at 0xA800 + 16·i, which holds what the object *is* and how it is moving, and a two-byte **sprite entry** at 0xAA10 + 2·i, which holds what the hardware will draw. The two tables are walked in lockstep. Every loop that visits more than one slot carries a record cursor and an entry cursor side by side and steps them together, sixteen bytes and two bytes at a time, so that the pair always names the same slot; advanceToNextSlot [seen] is that step on its own, and closeOneTurnOfTheSlotSweep [seen] and closeOneTurnOfTheFreeSlotSearch [seen] are the same step fused onto the end of a sweep turn (the search walks the pair *backwards*). Nothing in the code ever converts one cursor into the other, so the correspondence is kept by discipline alone. A sweep that stepped one cursor and not the other would silently start driving one object's sprite from another object's record.

### The array, slot by slot

The twenty-four slots are laid out in fixed bands by kind:

- Slot 0 is the player: its record starts at PLAYER_STATE 0xA800 [seen] and its entry at PLAYER_ENTRY 0xAA10 [seen].
- Slots 1–4 are the four actor slots, records from ACTOR_RECORD_SLOT0 0xA810 [seen] and entries from ACTOR_ENTRY_SLOT0 0xAA12 [seen].
- Slots 5–11 are the seven-slot enemy-craft band, records from CRAFT_RECORD_SLOT0 0xA850 [seen] and entries from CRAFT_ENTRY_SLOT0 0xAA1A [seen]. Slot 10, the band's sixth slot, is the Mother-Ship: MOTHER_SHIP_STATE 0xA8A0 [seen] paired with MOTHER_SHIP_ENTRY 0xAA24 [seen].
- Slots 12–14 are the three-slot era-object bank, from ERA_OBJECT_RECORD_SLOT0 0xA8C0 [seen] and ERA_OBJECT_ENTRY_SLOT0 0xAA28 [seen].
- Slot 15 is the parachutist, PARACHUTIST_RECORD 0xA8F0 [seen] and PARACHUTIST_ENTRY 0xAA2E [seen].
- Slots 16–23 are the scenery band, from SCENERY_RECORD_SLOT0 0xA900 [seen] and SCENERY_ENTRY_SLOT0 0xAA30 [seen]. A separate driver, runSceneryForEra [seen], runs this band instead of the object handlers.

The craft band is not served by a loop. stepSevenCraftSlots [seen] calls seven small entries in a fixed order, and each one seats its own record and entry cursors (for example CRAFT_RECORD_SLOT0 with CRAFT_ENTRY_SLOT0) and hands them to dispatchSeatedSlotByEraIndex [seen]. That routine picks the per-era handler from the low three bits of ERA_INDEX 0xAD04 [seen]. Of the eight table words, the five era services and the round-won band animation of sequence step 14 are real code, and the other two point outside the program. The last two craft entries, the Mother-Ship slot and slot 11 (CRAFT_RECORD_SLOT6 0xA8B0 [seen] / CRAFT_ENTRY_SLOT6 0xAA26 [seen]), stand down while MOTHER_SHIP_ARMED 0xAD0D [seen] is set. The Mother-Ship draws on two sprite entries, and slot 11's entry is its second tile. MOTHER_SHIP_ARMED is raised when the Mother-Ship is armed and cleared only at round start or life start, so from arming until then (even after the Mother-Ship is destroyed) neither slot runs as a craft.

The sprite entry's two bytes are only half of it. The table at 0xAA10 holds a coordinate byte at +0 and the sprite code (shape) at +1. A second table lies exactly 0x30 bytes further on and holds the attribute byte (colour and flip) at +0x30 and the other coordinate at +0x31. For the player these are PLAYER_SPRITE_CODE 0xAA11 [seen], PLAYER_SPRITE_ATTRIBUTE 0xAA40 [seen] and PLAYER_SPRITE_Y 0xAA41 [seen]. So each slot really owns four display bytes in two parallel runs, and those runs are what the hardware finally receives (below). An object drawn from two sprites takes the next slot's entry as its second tile. placeAbuttingTile [seen] copies the +0 coordinate across and puts the +0x31 coordinate one sprite pitch (16) further on. The dying two-tile object in advanceHitSoakingObjectThenAnimateDeath [seen] writes its second tile the same way, at entry+2 and entry+0x33.

### Coordinates: whole part in the entry, fraction in the record

Each object has two coordinates, and each is a sixteen-bit number stored in two places: the whole (pixel) byte in the sprite entry and the fraction byte in the record. The +0x31 coordinate's fraction is record byte +3, and the +0 coordinate's fraction is record byte +5. Every mover glues whole and fraction into one number, adds a displacement, and splits the result back, so a speed of less than a pixel per frame builds up in the fraction until it carries into the whole byte. It is not lost. Both halves wrap together at sixteen bits, and the visible byte wraps at 256.

The displacement always has two parts. One part belongs to the object, and the other is the world's own motion for the frame: the pair of words WORLD_SCROLL_Y 0xA808 [seen] (added to the +0x31 coordinate) and WORLD_SCROLL_X 0xA80A [seen] (added to the +0 coordinate). Every mover adds that shared pair, so every object moves with the scrolling sky and not with the screen. The movers differ only in where the object's own part comes from:

- driftWithWorldScroll [seen] adds nothing of the object's own. It moves the object only with the world.
- flyAlongHeading [seen] asks velocityForHeading [seen] for a pair of components. It reads the object's heading from record byte +2 as a point on a 256-step circle, and takes the sample at the heading and the sample a quarter-turn back from a caller-chosen table of 256 signed words. The two samples are perpendicular, and the table chosen sets the speed. flyAtSlowestSpeed [seen] is flyAlongHeading bound to the slowest table, and flyAtFastestSpeed [seen] is flyAlongHeading bound to the fastest, VELOCITY_TABLE_08FA 0x08FA; serviceEra3EnemyCraftSlot [seen] flies its craft with it. flyAtSecondFastestSpeed [seen] is bound to 0x2E3E (peak 306); steerEnemyTowardShip [seen] alternates it with a double-velocity step on the slowest table. flyAlongHeadingAtDoubleVelocity [seen] doubles the object's components but still adds the world's displacement only once.
- flyAlongStoredVelocity [seen] reads the object's own velocity words from the record: bytes +10/+11 for the +0x31 coordinate and +12/+13 for the +0 coordinate. It folds the world displacement into the same add. That is why no object moved this way is also drifted: a second drift would apply the world's motion twice.
- flyAlongBallisticArc [seen] moves the +0x31 coordinate by a fixed step of 384 per frame (one and a half pixels), with the sign taken from record byte +1. It moves the other coordinate by a speed word at record bytes +7/+8 that grows by 9 every frame, so the object falls faster and faster along a curve.
- The scenery uses displaceByHalf [seen], displaceByThreeQuarters [seen] and displaceByFiveQuarters [seen]. They take the world displacement scaled by one-half, three-quarters or five-quarters: the whole displacement less half of it, less a quarter of it, or plus a quarter of it, with each half or quarter taken by a signed shift that rounds toward the negative. driftAtHalfWorldScroll [seen] is the half-rate case. This is the parallax: some scenery lags the world and some leads it.

### The record, byte by byte

The record layout depends partly on the object's kind, but the following is common to all. The code sets it out like this:

- **+0, the head byte**, is the slot's life state. It is described in the next subsection, and every handler branches on it first.
- **+1** is the aim heading for steered objects. Spawns set it equal to the heading. Re-aim code writes into it the result of headingToward toward an aim point, and steerTowardAimHeading [seen] turns **+2**, the current heading, toward it by a per-era step. For the ballistic object, +1 is instead the direction flag of its fixed step.
- **+3 and +5** are the two coordinate fractions described above. Two of the craft spawns, spawnEnemyIntoFreeSlotElseStepSearch [seen] and the wave fill in driveEnemyWaveForLifePhase [seen], zero both while stocking the record. The era-4 wave spawn spawnEnemyWaveIntoFreeSlots [seen] and spawnAtEdgeAhead [seen] do not zero them.
- **+4, +6 and +7** change meaning with the kind. +4 is a countdown in the final-era chase (stepSlotApproachThenBreakawayRetire [seen]) and a quadrant seed in dressSpriteForHeadingOrRetireAtEdge [seen]. +6 is that routine's wind-down counter. +7/+8 are the ballistic speed word.
- **+8, +9 and +10** are the craft's scripted-animation triple, stepped by stepShapeAnimation [seen]. +9 is a step timer and +10 selects a run through SHAPE_RUN_POINTER_TABLE (0x3438). Each step counts +9 down by one and loads +8 with that run's byte at the new count, so the count is also the index and the run plays backwards, stopping on its last entry when the timer reaches zero. stepShapeAnimation fills +8 like an animation frame, but the reader that consumes it for craft, reaimAndAnimateEnemyCraftOnPhaseTick [seen], uses it as an aim-point selector and never as a sprite code. That reader indexes the aim-point table ENEMY_AIM_POINT_TABLE 0xAC65 [seen] by it, treats 0x10 as "hold course", and treats 0x11 as "aim at the table base, turn half a turn away, then hold". So on a craft this "animation" is a flight script, not a picture. stopFiveSlotAnimations [seen] sets +8 to 0x11 and clears +9 in the first five craft records (slots 5–9), but only while LIFE_TICKS_LOW reads zero. Its one caller, driveEnemyWaveForLifePhase, calls it when the life phase is 7. That sends those craft into the break-away. On objects moved by flyAlongStoredVelocity, +10 to +13 are the two velocity words instead.
- **+14** is the slot's personal timer or marker, and each family uses it in its own way. For a craft spawned held, it is the release delay. Once the craft is released it holds 128, and countTheKillAndGrantTheSharedToken [seen] reads that top bit to decide whether the craft's death counts toward the wave claim. Retire paths also reload it as a respawn cooldown (see below).
- **+15** is the slot's number. freeAndNumberEveryObjectSlot [seen] writes 1 to 23 into it for slots 1–23 when a round is set up, and no other code writes it. Several parts of the code use that fixed number as a phase key, which spreads work across frames: launchAttackerIntoFreeSlot [seen] only runs for a craft on the frame where (FRAME_TICK 0xA980 [seen] AND 7) + 5 equals its number, so each of the seven craft gets one frame in eight. chaseOneAimPointAndRetireAtTheLine [seen] re-aims only when FRAME_TICK's low nibble equals the number. The shared claim token CLAIM_TOKEN 0xA821 [seen] names its holder as number + 0x80.

**Warning: some bytes inside these records are not per-object state at all.** Several slots' interior bytes are used as round-wide settings and counters, loaded by resetPlayfieldAndArmNewRound [seen] or kept by other subsystems. Examples:

- PLAYER_HEADING 0xA802 [seen] is the player record's +2, and the two world-scroll words are the player record's +8 and +10.
- WAVE_KILL_COUNTDOWN 0xA811 [seen] and WAVE_CLAIM_TIMER 0xA812 [seen] sit inside actor slot 0's record, and CLAIM_TOKEN 0xA821 [seen] inside actor slot 1's.
- BANK_LAUNCH_COOLDOWN_PERIOD 0xA814 [seen], BANK_LAUNCH_COOLDOWN 0xA817 [seen], BANK_LAUNCH_NEAR_HALF_WIDTH 0xA827 [seen], BANK_LAUNCH_HEADING_HALF_WIDTH 0xA837 [seen] and BANK_LAUNCH_SLOT_COUNT 0xA844 [seen] sit at +4 and +7 of actor records.
- ATTACKER_SPAWN_SLOT_COUNT 0xA8C6 [seen], ATTACKER_SPAWN_WINDOW_HALF 0xA8D6 [seen] and ATTACKER_SPAWN_AIM_WINDOW_HALF 0xA8E6 [seen] are the +6 bytes of the era-object bank.
- ATTACKER_SPAWN_COOLDOWN 0xA8F4 [seen], ATTACKER_SPAWN_COOLDOWN_PERIOD 0xA8F6 [seen] and PARACHUTIST_RUNG 0xA8F7 [seen] are +4, +6 and +7 of the parachutist record.
- The Mother-Ship keeps MOTHER_SHIP_HITS_TO_ABSORB 0xA8A4 [seen] at its own +4 and MOTHER_SHIP_AIM_SIDE_TOGGLE 0xA8B4 [seen] at slot 11's +4.

An address inside the 0xA800–0xA97F block is therefore not automatically "field n of object i", and you have to know which byte it is before you can read it that way.

### The life of a slot: free, held, live, dying

The head byte at record +0 gives a slot's whole life story, and all the per-slot services read it the same way. The craft services (serviceEra0EnemyCraftSlot [seen], serviceEra2EnemyCraftSlot [seen], serviceEra4EnemyCraftSlot [seen] and their era-1 and era-3 siblings) branch on it four ways:

- **0: free.** The slot is left alone, or it is picked up by a spawn search. freeAndNumberEveryObjectSlot zeroes the head byte of all 23 non-player records at round setup.
- **0xFE: held.** The slot is claimed but not yet flying. releaseHeldObject [seen] counts +14 down once per frame, and when it reaches zero it adds one to the head (0xFE becomes 0xFF, live) and reloads +14 with 128. driveEnemyWaveForLifePhase [seen] creates held craft: when it fills a free craft slot for a new wave, it copies a per-slot delay from the wave descriptor into +14 and makes the slot live at once if that delay is zero, otherwise held. So a wave can come in as a staggered line.
- **0xFF: live.** The slot is flying. A live craft is steered toward its aim, flown one step at its era's speed (the slowest table in eras 0 and 2, faster tables in eras 1 and 3, and in era 4 from inside the steering step itself), tested against the retire line (retired if it has reached it), dressed for its heading (in era 4, given the next shape of a cycle instead), and given its launch chances. spawnEnemyIntoFreeSlotElseStepSearch [seen] claims a free slot by writing 0xFF first and then stocks the record: a starting position into the sprite entry's two coordinates, taken from ENEMY_SPAWN_RECORD_TABLE 0x3A3B through ENEMY_SPAWN_DIRECTION_INDEX_TABLE 0x39FB by PLAYER_HEADING cut to 64 directions and jittered at random by -8 to +7; aim and heading from PLAYER_HEADING turned half a turn, script selector +10, fractions zeroed, step timer 32 and one animation step taken, and +14 cleared. spawnAtEdgeAhead [seen], which brings the parachutist back, does the reverse and writes 0xFF *last*, after the coordinates and working bytes are in place.
- **Any other value: dying.** The value is a countdown. A collision writes 0xF0 into the head; the collision sweeps all use that value. stepDyingObjectState [seen] turns 0xF0 into 59 and counts the kill (countTheKillAndGrantTheSharedToken). A value of 60 or more counts down and flies on at the slowest speed, and exactly 60 counts the kill first, so the kill is counted once on either route. From 59 downward each frame takes one off. At zero the slot is retired. Otherwise moveObjectByStateByteThenRunAppearance [seen] takes a second step (another decrement and a slow flight) while the count is 32 or more, or only drifts with the world below 32, and then hands the look of the dying object to driveObjectAppearanceByPhaseBand [seen]. At 42 and above that routine keeps the attribute's top two (flip) bits, clears the rest, and puts FRAME_TICK's low nibble in the low four bits, so the tint cycles through sixteen values. From 10 to 41 it takes a shape from OBJECT_PHASE_SHAPE_TABLE (0x2C94) at (count − 10)/2 with a fixed tint. Below 10 the object survives only if CLAIM_TOKEN names it. If it does, it holds a fixed shape, pushes its count back up seven frames in eight, and on reaching count 1 posts a command and clears the token. If it does not, it is retired on the spot.

The other banks use the same vocabulary with their own twists. The era-object and actor sweeps (sweepObjectSlotBankByHead [seen], dispatchObjectSlotByHeadByte [seen], serviceSlotByHeadByte [seen]) treat 0xFF as "flying", but they differ on any other non-zero value. sweepObjectSlotBankByHead runs it as a one-shot countdown. dispatchObjectSlotByHeadByte runs it as a countdown only in era 4 and retires the slot at once in any other era. serviceSlotByHeadByte retires the slot straight into the shared cooldown (retireSlotIntoSharedCooldown). The one-shot countdown in runOneShotAnimatedObjectSlot [seen] re-stamps a value of 60 or more down to 59 once, then counts down, drifting and choosing a shape from ONE_SHOT_OBJECT_SHAPE_TABLE (0x4094) while it is 28 or more. When it reaches zero it simply clears both coordinate bytes of its entry. The parachutist (runParachutistSlot) reads 0 as "waiting to respawn", 0xFF as "in flight", 16 as "post the bonus", 60 and up as "show the award", and anything else as a countdown to retirement.

### Retiring and hiding

To retire a slot means to write 0 into its head byte and into both of its entry's coordinate bytes (+0 and +0x31), so the sprite is parked at coordinate zero. Different families add different extras to that basic job:

- **retireSlot** [seen] does exactly the basic job.
- **retireSlotAndSubPixel** [seen] also zeroes the two fraction bytes +3 and +5. The craft services and the dying-state machine use it.
- **retireSlotIntoCooldown** [seen] loads +14 with 240 as a respawn delay. The parachutist uses it, and spawnAtEdgeAhead counts that delay down on alternate frames before placing it again.
- **retireSlotIntoSharedCooldown** [seen] loads +14 from ATTACKER_SPAWN_COOLDOWN_PERIOD 0xA8F6 [seen].
- **retireEntryPairIntoCooldown** [seen] clears both entries of a two-sprite object and marks +14 with 95.
- **retireObjectAndHold** [seen] is the two-record variant: it retires the era-object bank's lead object and its second half, then stores 128 in +14. More exactly, it clears its own head byte, the head byte of the record after it, its own entry's coordinates, and the coordinates of the fixed entry ERA_OBJECT_ENTRY_SLOT1 0xAA2A [seen].

A retired slot's record keeps whatever else it held. Nothing else is cleared.

Hiding is a separate, cruder tool that ignores the records. hideAllSprites [seen] writes zero into the +0x31 coordinate byte of all 24 entries, starting at PLAYER_SPRITE_Y 0xAA41 [seen] and stepping by two, which parks every sprite at once between scenes without touching any object's state. hideCaptionSprites [seen] does the same for only the first four entries.

### Retire lines and edge tests

An object leaves play when its *screen* position reaches a boundary. Its world position doesn't matter, because the world has no edge. The tests only look at the whole bytes in the sprite entry, and because those bytes wrap at 256, every test is a small wrapped window rather than a greater-than comparison. That lets an object moving a few pixels a frame land inside the window instead of jumping past it.

- **hasReachedRetireLine** [seen] is the common test. It is true when the +0x31 byte is within one of 248 (247, 248 or 249) or the +0 byte is within one of 4 (3, 4 or 5). The craft services, the chasers, the parachutist and serviceSlotByHeadByte all use it.
- **hasReachedHorizontalEdgeWindow** [seen] is true when the +0 byte is in the four-wide window that straddles the wrap (254, 255, 0, 1).
- **hasDriftedOffTheField** [seen] is true when the +0x31 byte is 240–242, and otherwise hands on to the +0 window.
- **hasReachedBoundaryBandSelectedByHeading** [seen] first looks at the heading in record +2. For headings from 64 to 191 it hands on to hasDriftedOffTheField. For the other half of the compass it tests the adjacent band 237–239 on the +0x31 byte before handing on to the +0 window. So an object's direction of travel decides which of two neighbouring lines it retires on.
- **flyAlongBallisticArc** keeps its own limits: a band of 32 values straddling the wrap on the +0x31 byte (when that byte plus 16 is below 32), or a floor of 248 on the +0 byte.

Launch code uses the same entry bytes in the other direction. For example, launchAttackerIntoFreeSlot refuses to launch from a craft whose +0x31 and +0 bytes both lie within a window around 120 and 132 (0x78 and 0x84), which are the player's own sprite coordinates as resetPlayfieldAndArmNewRound seats them.

### Dressing a sprite for heading and frame

A record says which way an object is pointing, and the sprite entry has to show it. Because the hardware has only so many shapes, the dressing routines round the 256-step heading to a sector. They add half a sector before truncating, so the heading rounds to the nearest sector and the circle closes without a seam. The sector then picks a shape code for +1 and an attribute byte (colour and flip) for +0x30 out of parallel ROM tables. Mirroring through the flip bits lets a few drawn shapes cover the whole circle. The variants differ in resolution and in whether the frame counter adds a second pose:

- **spriteForHeading** [seen] rounds to 16 sectors, reads SPRITE_SHAPE_BY_SECTOR_TABLE (0x2A77) and SPRITE_MIRROR_BY_SECTOR_TABLE (0x2A87), and adds 8 to the shape whenever FRAME_TICK's bit 1 is set, so every heading alternates between two poses. refreshSpriteFromHeading [seen] stores that pair. refreshSecondEraSpriteFromHeading [seen] shifts it by fixed biases (+16 to the shape, +53 to the attribute) to reach another shape bank and tint.
- **dressSpriteForFineHeading** [seen] rounds to 32 sectors through two-byte entries of FINE_HEADING_SHAPE_TABLE (0x2ABC), with the same +8 flutter.
- **dressSpriteForCoarseHeading** [seen] and **dressSpriteShapeAndAttributeForHeadingSector** [seen] use 16 sectors and tables whose attribute half sits 16 bytes after the shape half, with no flutter.
- **dressPlayerSpriteForHeading** [seen] dresses the player's fixed entry from PLAYER_HEADING, using 32 sectors and PLAYER_HEADING_SHAPE_TABLE (0x20CE).
- **dressSpriteForHeadingOrRetireAtEdge** [seen] dresses a two-sprite object, so it fills +1/+3 and +0x30/+0x32. It first asks hasReachedBoundaryBandSelectedByHeading and retires the object through retireEntryPairIntoCooldown if the answer is yes. In the last era (ERA_INDEX 4) it runs the object's wind-down counter and hands the shapes to dressSpriteFlutterShapesByFrameTickBit [seen], a two-frame flutter keyed on FRAME_TICK bit 2. Otherwise the record's +4 byte, the era, and FRAME_TICK bit 1 (a two-frame pose) together choose a shape pair from HEADING_SHAPE_PAIR_TABLE (0x44F1) [seen]. The +4 byte is not a heading quadrant: the routine's only caller is the call at 0x4441 inside loc_43f0, which runs the Mother-Ship record, so +4 is MOTHER_SHIP_HITS_TO_ABSORB 0xA8A4 [seen], folded as ((7 − hits) >> 1) & 3 into a damage stage, and the era alone picks a colour from ERA_SPRITE_COLOUR_TABLE (0x4531). In this dressing step the heading at +2 only decides which half of the compass the object faces (the swap/mirror choice below). One half of the compass swaps the two shapes between the tiles and the other half adds 128 to the colour byte, which is how the pair is mirrored.

Some objects are animated without regard to heading. animateFixedShapeCycle [seen] and animateFixedShapeCycleFromShape50 [seen] step through eight consecutive shape codes from FRAME_TICK alone, so everything drawn through them animates in step. Both take the frame from FRAME_TICK bits 1–3, so they also run at the same rate, one shape every two frames; they differ only in where the cycle starts and what attribute it pins — shape 0x40 with attribute 0x44 for the first, shape 0x50 with attribute 0x0A for the second. animateSelectedShapeCycle [seen] uses the record's +4 to pick a block of four shapes and FRAME_TICK bits 2–3 to pick one within the block.

### Onto the screen

The sprite entries are only a shadow. Once per frame publishSpriteShadow [seen] copies them into the two hardware sprite banks at SPRITE_BANK0_BASE (0xB010) and SPRITE_BANK1_BASE (0xB410):

- It copies 48 bytes into each bank, which is 24 sprites.
- The copy is not in memory order. Hardware sprites 0–2 come from scenery slots 16–18, sprites 3–18 from array slots 0–15, and sprites 19–23 from scenery slots 19–23. Bank 0 takes the +0/+1 run, and bank 1 takes the +0x30/+0x31 run.
- On the way, each byte passes through a transform chosen by which half of the sprite it is and by SCREEN_UNFLIPPED 0xA987 [seen]:
  - Upright, bank 1's coordinate byte is stored as the complement of (value + 14), and everything else passes unchanged.
  - Turned round, bank 0's coordinate becomes the complement of (value + 15), bank 1's attribute has its two flip bits toggled, and bank 1's coordinate is stepped by one.

The eight scenery-fed hardware sprites (0–2 and 19–23) can be shown twice in one frame. During one window of the round (SEQUENCE_PHASE 0xA9AB [seen] at 3, sub-step from 5, the ROM byte at 0x0832, up to 7), publishSpriteShadow raises the top bit of both coordinate bytes of those eight. That bit is a request. multiplexSpriteSlotsSkipping [seen] watches SCANLINE_COUNTER (0xC000) for all eight sprites. Once the raster count added to a requesting sprite's bank-1 coordinate carries past 255, it clears the request and adds 128 to the sprite's bank-0 coordinate. multiplexSpriteSlots [seen] makes the same trade for every raised request, but it waits on the raster for each one, reading SCANLINE_COUNTER until that sprite's line has come. spinRemainingSpriteMultiplexSlots [code] joins that waiting pass part-way, at hardware sprite 19, and then waits out sprites 20–23 the same way. Either way, one hardware sprite can appear a second time in the same frame, half the coordinate range away.

That is the first way onto the screen: array slot → sprite entry → hardware sprite. The player's shots do not use it. They live in their own six-record array at PLAYER_SHOT_ARRAY 0xAA80 [seen], which is not paired with the sprite tables. The shot engine (fireAndSweepPlayerShots [seen]) draws each shot through queueTileStampForObject [seen] as a two-by-two block of pre-shifted tiles queued onto the character plane's deferred-write list. That path belongs with the shot and character-plane mechanisms.

### Sweeping the banks

The bank sweeps all run inside the vertical-blank service, not in a foreground loop. serviceVerticalBlankInterrupt publishes the sprites and drains the character-cell lists first, then steps the sequence machine; when the machine stands at phase 3, sub-step 7, the arm it runs is the round engine serviceRoundThenResolvePlayerState [seen], which calls the subsystems in one fixed order every frame: the craft re-aim and animation pass, the player, the player's shots, the enemy wave, the parachutist, the Mother-Ship arming/step, the seven craft slots, the scenery, the era-2-and-later object bank, the era-1 bomber and its companion slot, the four actor slots, the era-0 ballistic bank, the collision pass, a sound request, and then the bookkeeping: bonus life, hit-chain expiry, difficulty-rung escalation and the kill meter. After the closing sprite pass it resolves the player's state: a live player goes to the field-cleared round advance, and a player whose state is 0 goes to losing a life. Five times along that list, and once more at its end, it stops to run a sprite-doubling pass (see below); those passes are placed between subsystems deliberately, because they are timed off the raster.

#### The seven craft slots and the era dispatch

stepSevenCraftSlots [seen] is nothing but an order: it works slots 0 through 4 of the craft band, then the Mother-Ship slot, then slot 6, each through its own small entry that seats that slot's record and sprite entry — CRAFT_RECORD_SLOT0..4 at 0xA850, 0xA860, 0xA870, 0xA880, 0xA890 [seen] with CRAFT_ENTRY_SLOT0..4 at 0xAA1A-0xAA22 [seen], then MOTHER_SHIP_STATE 0xA8A0 [seen] with MOTHER_SHIP_ENTRY 0xAA24 [seen], then CRAFT_RECORD_SLOT6 0xA8B0 [seen] with CRAFT_ENTRY_SLOT6 0xAA26 [seen]. The first five entries (seatCraftSlot0ThenDispatchByEra [seen] and its four siblings) are unconditional. The last two, seatMotherShipSlotThenDispatchByEraUnlessArmed [seen] and seatCraftSlot6ThenDispatchByEraUnlessArmed [seen], return without touching anything while MOTHER_SHIP_ARMED 0xAD0D [seen] is non-zero. The reason is that the Mother-Ship occupies two consecutive records — its own and slot 6's — once it is armed, and from then on it is driven by armMotherShipOrStep [seen] (which hands a live boss to its stepper) rather than by the ordinary craft handler. Note the flag is not "the boss is on screen": once raised it stays raised until the next life or round is set up, so both slots stay out of the craft sweep until startNextRound [seen] or resetPlayfieldAndArmNewRound [seen] clears it. resetPlayfieldAndArmNewRound runs at every life start, one sequence sub-step after the active player's saved context (which includes this cell) has been copied back in, so an armed boss never carries over into the next life.

Every one of the seven entries ends in the same dispatcher, dispatchSeatedSlotByEraIndex [seen], which reads ERA_INDEX 0xAD04 [seen], keeps its low three bits, and runs the per-slot handler that the eight-word table behind it names. The five eras get their own craft handler: serviceEra0EnemyCraftSlot [seen], serviceEra1EnemyCraftSlot [seen], serviceEra2EnemyCraftSlot [seen], serviceEra3EnemyCraftSlot [seen] and serviceEra4EnemyCraftSlot [seen]. All five share one skeleton on the slot's head byte — free does nothing, 0xFE releases a held object (releaseHeldObject [seen]), any countdown value steps the dying state (stepDyingObjectState [seen]), and a live craft is steered, flown, tested against the retire line (hasReachedRetireLine [seen]) and, if it is still in play, given its sprite refresh and its launch attempts; the eras differ in how they steer, how fast they fly and what they launch. The sixth and seventh table words point outside the program image, so an era index of 5 or 6 would run into nothing; the eighth word is the round-won band animation of sequence step 14, stepRoundStartIntroAnimation [seen]. The routine that advances the era, startNextRound [seen], wraps it after the fifth era back to zero, and no writer found stores anything above 4, so in play the dispatcher takes only the first five arms.

A counterintuitive detail in the final era: its steering step, steerEnemyTowardShip [seen], writes the era cell itself. When the craft's probe byte is within a window of either of two reference values it forces ERA_INDEX to 0 for the duration of the turn and then stores 4 back. Because this is only reached from the era-4 craft handler, the store of 4 restores the value that was there — but for the length of that turn every reader of ERA_INDEX sees era 0. The cell is doing double duty as a turn-rate index there.

#### The four actor slots

stepFourActorSlots [seen] walks ACTOR_RECORD_SLOT0..3 at 0xA810, 0xA820, 0xA830, 0xA840 [seen], paired with ACTOR_ENTRY_SLOT0..3 at 0xAA12-0xAA18 [seen], and hands each to dispatchObjectSlotByHeadByte [seen]. That dispatcher reads only the head. Zero is left alone. All-ones goes to flyAndRetireSlotCyclingShapeInEra4 [seen]: the object moves one step along the velocity stored in its record (flyAlongStoredVelocity [seen]) and its slot is freed the frame that step puts it on a retire line; in era 4 only, it is first given the next shape of a fixed cycle (animateFixedShapeCycle [seen]), so a slot can receive a new shape and be retired in the same frame. Any other head value goes to runSlotCountdownDriftAndAnimateElseRetire [seen], and here the era matters again: outside era 4 the slot is retired on the spot. In era 4 the head byte itself is the countdown: a head of 1 retires the slot, and any other value drops by one each frame. A count that came in at 60 or more first re-stamps the object's state and asks for two sounds; the object then drifts with the world scroll, and while the count is 28 or more it picks one of eight shapes from a ROM table — each held for four counts, repeating — and writes it into the sprite entry with a fixed 3 into the attribute byte.

#### The era-object bank

Three slots, ERA_OBJECT_RECORD_SLOT0..2 at 0xA8C0, 0xA8D0, 0xA8E0 [seen] with entries at ERA_OBJECT_ENTRY_SLOT0..2 0xAA28, 0xAA2A, 0xAA2C [seen], hold whatever special object the current era fields. Which routine sweeps them depends on the era, and four different entries in the round engine each gate themselves on ERA_INDEX (serviceEra0BallisticObjectBank, serviceEra1BomberObject, serviceFixedSlotInEra1, sweepEra2PlusObjectBank):

- **Era 0.** serviceEra0BallisticObjectBank [seen] seats the bank with a count of three and routes the first slot by its head. The sweep that carries on from there comes in two interlocking halves: advanceSlotThenSweepObjectBankByHead [seen] steps to the next slot, skipping empty ones and flying ballistic (0xFF) ones along their arc with flyAlongBallisticArc [seen], until it meets a slot with any other marker; it then hands the remainder to sweepObjectSlotBankServicingFirstSlot [seen], which services that slot with runOneShotAnimatedObjectSlot [seen] — a shape-cycle countdown that drifts with the world and retires at zero — and carries on routing the rest the same way. The arc itself moves one axis by a fixed step and the other by a step that grows every frame, so the object accelerates; both axes also take the world scroll.
- **Era 1.** serviceEra1BomberObject [seen] owns slot 0 of the bank: an empty head arms it on a timer (armBomberSlotWhenTimerFires [seen]), a live head runs its two-tile move and aimed-spawn attempt (advanceTwoTileObjectThenTryAimedSpawn [seen]), and any other value soaks hits toward its death animation (advanceHitSoakingObjectThenAnimateDeath [seen]). Separately, serviceFixedSlotInEra1 [seen] services slot 2 of the bank through serviceSlotByHeadByte [seen]: a live object flies along its stored velocity and is retired into the shared cooldown only when that step puts it on a retire line, while any other non-zero head is retired where it stands without moving. The era test in serviceFixedSlotInEra1 is a step-down of the era byte that is zero only in era 1.
- **Era 2 and later.** sweepEra2PlusObjectBank [seen] does nothing below era 2, or when ATTACKER_SPAWN_SLOT_COUNT 0xA8C6 [seen] is zero; otherwise it runs that many turns of serviceSlotByMarkerThenCloseSweepTurn [seen] from the bank's first slot. Each turn routes on the head: free slots are passed over; a non-full marker is a drifting countdown stepped by stepDriftingCountdownObjectByEraFrames [seen] (which picks its frames from one of two tables — one for the final era, one for the rest); a full marker in era 4 runs the approach-then-breakaway handler stepSlotApproachThenBreakawayRetire [seen]; a full marker elsewhere with a non-zero countdown at record +0x0E is flown a step along its stored velocity, retired if that step puts it on a retire line, and ticked (flyLiveSlotAndTickCountdown [seen]); and a full marker whose countdown is spent chases its aim point for the frame (chaseOneAimPointAndRetireAtTheLine [seen]). Every one of those paths ends in closeOneTurnOfTheSlotSweep [seen], which strides both cursors a slot on, counts the turn off, and starts the next turn until the count is exhausted. Note that ATTACKER_SPAWN_SLOT_COUNT is itself byte +6 of the bank's first record.

Slot 1 of the era-object bank is not seated directly by any of the era-1 services. In era 1 its sprite entry is the bomber's second tile: every step, advanceTwoTileObjectThenTryAimedSpawn [seen] copies slot 0's X into it and sets its Y to slot 0's Y plus 16, and retireObjectAndHold [seen] clears slot 1's head and both coordinates of ERA_OBJECT_ENTRY_SLOT1 [seen] along with slot 0. In eras 0 and 2-4 it is reached only as the second step of the bank sweeps.

### Publishing the shadow to the sprite banks

The game never draws into the sprite hardware while it works. All the handlers above write into the shadow at 0xAA10-0xAA6F, and once a frame, first thing in the vertical-blank service, publishSpriteShadow [seen] copies it to the two hardware banks: bank 0 at 0xB010 (the X and shape bytes) and bank 1 at 0xB410 (the attribute and Y bytes), forty-eight bytes each, twenty-four sprites.

The copy is not in memory order. Each bank is gathered from three runs: first the three sprites starting at SCENERY_ENTRY_SLOT0 0xAA30 [seen] (scenery slots 16-18), then the sixteen sprites from PLAYER_ENTRY 0xAA10 [seen] (the whole active array, slots 0-15), then the five from SCENERY_ENTRY_SLOT3 0xAA36 [seen] (scenery slots 19-23); bank 1 takes the same three runs from SCENERY_SPRITE_ATTRIBUTE_SLOT0 0xAA60 [seen], PLAYER_SPRITE_ATTRIBUTE 0xAA40 [seen] and SCENERY_SPRITE_ATTRIBUTE_SLOT3 0xAA66 [seen]. So hardware sprites 0-2 and 19-23 are the eight scenery sprites and hardware sprites 3-18 are array slots 0-15 in order — which is what makes the eight scenery sprites the ones the doubling passes below can reach.

Every byte is transformed on the way, by which half of its sprite it is and by SCREEN_UNFLIPPED 0xA987 [seen]. With the picture upright, X, shape and attribute are copied as they are and only Y is changed, to the complement of Y+14 (that is, 241 − Y). With the picture turned round, X becomes the complement of X+15, the shape is copied, the attribute has its top two bits toggled, and Y becomes Y+1. All of these are byte-wide and wrap. Because the vertical-blank service rewrites SCREEN_UNFLIPPED only after the publish, each frame's sprites are laid out in the orientation decided on the previous frame.

After the copy, and only while SEQUENCE_PHASE 0xA9AB [seen] is 3 and SEQUENCE_SUBSTEP 0xA9AC [seen] lies between a floor of 5, read from the ROM byte at 0x0832, and 7 inclusive, the publish raises eight sprites — the three scenery sprites at the start of the bank and the five at the end. For each whose bank-1 Y byte has bit 7 clear, it adds 0x80 to that Y byte and to the matching bank-0 X byte; a sprite whose Y already has bit 7 set is left alone, so a second raise changes nothing. That bit is the request the doubling pass acts on, so the raise forces every scenery sprite into the doubled state for those sub-steps.

### Doubling the scenery sprites mid-frame

Twenty-four hardware sprites are not enough for the player, the enemies and a sky full of clouds, so the game uses each of the eight scenery sprites twice per frame by moving it while the picture is being scanned out. The request is bit 7 of the sprite's Y byte in bank 1. With the upright transform that bit comes out set whenever the shadow Y is 113 or less (241 − Y ≥ 128), or above 241 where the subtraction wraps; with the picture turned round, whenever Y+1 reaches 128. No scenery code sets the bit explicitly. Outside the publish's raise window the position sets it, and inside that window (phase 3, sub-steps 5–7) publishSpriteShadow forces it on all eight. The eight reachable pairs are Y at 0xB411, 0xB413, 0xB415 and 0xB437-0xB43F, each paired with the X byte at the matching offset in bank 0 (0xB010, 0xB012, 0xB014, 0xB036-0xB03E); the pairs are named from SPRITE_BANK1_SLOT0_Y / SPRITE_BANK0_BASE through SPRITE_BANK1_SLOT23_Y / SPRITE_BANK0_SLOT23_X.

The move itself is always the same trade: clear bit 7 of Y (take 128 off it) and add 128 to X. So a requesting sprite appears once at its published Y and X, and again, after the trade, half the byte range away on both. The timing comes from the raster: the counter read at 0xC000 is added to the request byte, and the trade is due once that sum carries out of eight bits — that is, once the counter has reached 256 minus the Y byte, a line that depends on where the sprite itself sits.

Two routines do the trade. multiplexSpriteSlotsSkipping [seen] is the opportunistic pass: for each of the eight pairs whose request is set and whose line the raster has already passed, it trades; one whose line has not come yet is left armed for a later pass. The round engine runs it five times at points spread through its service list, so trades happen close to the lines they belong to without waiting. multiplexSpriteSlots [seen] is the closing pass at the end of the list, and it does wait: for each pair still carrying a request it spins reading the raster counter until the line comes, then trades. So the end of the round engine is a busy-wait on the beam for any cloud whose line had not arrived — a frame's worth of game logic can finish early and still spend the remaining time here. The next vertical blank publishes fresh bytes from the shadow, which re-arms, for the new frame, every pair whose transformed Y (or the raise window) sets bit 7. The two lead-in arms that fly the ship before a round, flyEnemyFreeLeadInThenStepSequence [seen] and flyRoundIntroFlashingEraYearThenEraseIntroCaptions [seen], use the same pattern on a shorter list: two opportunistic passes, then the waiting pass.

A third entry into the pass, spinRemainingSpriteMultiplexSlots [code] at 0x10FD, starts part-way into the handling of the fourth pair (hardware sprite 19): if that sprite's line has come it trades it and then runs sprites 20-23 through the same waiting blocks as multiplexSpriteSlots, spinning on the raster for each one still requesting; if not, it rejoins the waiting pass at sprite 19 (loc_10f8 [seen]) and waits out all five. If the byte the caller tested carries no request, it skips sprite 19 and goes straight to the waiting blocks for 20-23. The only CALL to it in the image, at 0x15D9, sits inside caption record 5, whose bytes run as code only when holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail derails into record 8 at 0x15CA on a failed glyph check (§9); the image-tamper trap loc_0f8d [code] likewise ends by running the opportunistic pass. Neither is part of normal play.

### Player shots stamped into the character plane

The player's shots are not sprites. They are drawn as characters, and fireAndSweepPlayerShots [seen], called by the round engine right after the player, both launches and moves them.

Firing is considered only while PLAYER_STATE 0xA800 [seen] reads 0xFF (alive) and ROUND_TRANSITION_HOLD 0xACC6 [seen] is zero. On those frames the fire bit (bit 4 of the control read) is shifted into FIRE_BUTTON_EDGE_SHIFT 0xA98E [seen]; when its low two bits read 01 — released last frame, pressed now — SHOT_BURST_PENDING 0xAA81 [seen] is loaded with 3. A shot is launched if SHOT_SPAWN_COOLDOWN 0xAA82 [seen] is zero and, while PLAY_ACTIVE 0xAD30 [seen] is set, the burst count is non-zero; with PLAY_ACTIVE clear the burst count is not consulted, so the attract demo fires whenever the cooldown allows. The launch takes the first free record of the six in PLAYER_SHOT_ARRAY 0xAA80 [seen] (stride taken from a ROM word at 0x0D46 that holds 16). If all six are busy nothing happens — no sound, and neither the burst nor the cooldown is spent. Otherwise it requests the shot sound, stores −4 times each component of the world scroll (WORLD_SCROLL_Y 0xA808 [seen], WORLD_SCROLL_X 0xA80A [seen]) as the shot's two per-frame seeds at record +10 and +12, and looks up a word in the 32-entry ROM table at 0x2771 indexed by PLAYER_HEADING 0xA802 [seen] rounded to the nearest of 32 directions ((heading + 4) >> 3). The two bytes of that word become the whole parts of the shot's two coordinates, with zero fractions — so although the table is keyed on heading, what it supplies is a starting point by direction, not a velocity. The head becomes 0xFF, the burst count drops by one, and the cooldown is set to 6.

The sweep runs on every call whether or not anything fired. It first decrements the cooldown if it is non-zero — so, counting the launch frame's own decrement, a new shot can leave at most once every six calls. Then, for each of the six records: a zero head is skipped; any head other than 0xFF is freed on the spot, which is how a shot that something else has marked leaves the field; a live shot has each 8.8 coordinate advanced by its seed plus the current world-scroll component. Since the seed is −4 times the scroll at the moment of firing and the world scroll is the negated ship velocity, a shot fired on a steady course moves across the screen at three times the ship's velocity in the direction the ship was flying — four times, relative to the world. A shot is freed if its first coordinate's whole part lands in 0xF0-0xFF or its second's in 0xF8-0xFF or 0x00-0x0F; otherwise it is queued for drawing.

queueTileStampForObject [seen] turns a shot position into a two-by-two block of character cells. It biases both whole parts by 7; the top five bits give the row and column of the block's top-left cell in a 32-cell-wide plane based at 0xA000 (the colour plane), and the low three bits of each pick one of 64 pre-shifted records in a ROM table at 0x53D4, each holding four glyph/attribute pairs for the block's four cells. That is how a shot moves smoothly although it is drawn in eight-pixel cells: the glyph itself is pre-drawn at each of the 8 × 8 sub-cell offsets. Pairs whose glyph is zero are skipped, so a block can be partly empty. Each kept cell is appended as four bytes — colour-plane address low, high, glyph, attribute — to the list behind DEFERRED_WRITE_CURSOR 0xAE00 [seen], whose entries start at DEFERRED_WRITE_LIST 0xAE04 [seen]; the cursor is stepped within its own page (0xAE00-0xAEFF), so a list that ran long would run into DEFERRED_BLANK_CURSOR 0xAE80 [seen] and the blank list, then wrap onto its own head, instead of leaving the page. Six shots of four cells is 24 entries, well inside that.

The list is acted on at the next vertical blank by drainBothDeferredCellLists [seen], in three steps. First blankCellsPaintedLastPass [seen] walks the second list, at DEFERRED_BLANK_LIST 0xAE84 [seen] behind DEFERRED_BLANK_CURSOR 0xAE80 [seen], and writes the blank glyph (32) into the character plane at each named cell — the colour-plane address with bit 10 set (0xA400-0xA7FF) — leaving the colour as it was. Then paintDeferredCells [seen] walks the pending list and writes each glyph into the character plane and each attribute, plus the low nibble of PEN_COLOUR 0xAD0C [seen], into the colour plane. In both walks a cell whose colour byte already has bit 4 (0x10) set is passed over, so characters drawn with that bit are never overwritten or erased by shots. Finally the pending list is copied wholesale onto the blank list, the blank cursor's low byte is set to the pending cursor's low byte plus 0x80, which points it at the end of the copied list in the blank half of the page (0xAE80 + the same offset; the blank walk masks that 0x80 off again and takes away the four-byte header to get the list's length), and the pending cursor is parked back on its first entry; if nothing was pending, emptyBothDeferredCellLists [seen] parks both cursors instead. The copy runs one way every frame — it is not a swap — so each shot image is painted on the vertical blank after it was queued and erased on the one after that, when its successor is painted. The copy length is the pending cursor's low byte, and a byte of zero there would mean a copy of the entire address space rather than none; the shots cannot fill the list far enough to produce it.

## §5 The player's ship

### The player record and the pinned sprite

The ship is two things kept side by side. Its **record** begins at 0xA800 with PLAYER_STATE [seen], the byte that says what the ship is doing: 0xFF while it is alive and flying, 0xF0 at the moment something kills it, a falling count while it explodes, and zero once it is gone. The record's second byte, PLAYER_RECORD_SPARE_BYTE 0xA801 [seen], is cleared at every life start and read by no code at all. The third byte is PLAYER_HEADING (0xA802) [seen], which holds the direction of flight as a full byte, so one turn of the circle is 256 steps. Its **sprite entry** begins at PLAYER_ENTRY (0xAA10) [seen]. The entry's first byte is the native-X coordinate, the byte after it is PLAYER_SPRITE_CODE (0xAA11) [seen], PLAYER_SPRITE_ATTRIBUTE (0xAA40) [seen] carries the colour and the two mirror bits, and PLAYER_SPRITE_Y (0xAA41) [seen] is the native-Y coordinate.

The ship never moves on the glass. Its two coordinate bytes are set only by the life-start routine, resetPlayfieldAndArmNewRound [seen], which writes 132 into PLAYER_ENTRY and 120 into PLAYER_SPRITE_Y, and nothing that flies the ship ever changes them. The only other writers do not move the ship. hideAllSprites [seen] and hideCaptionSprites [seen] zero PLAYER_SPRITE_Y to hide the sprite, and loseLifeAndHandOver calls hideAllSprites at every life loss. On the attract copyright screen, stampCopyrightStrip [seen] reuses the entry for the first piece of the copyright caption strip, writing 216 into PLAYER_ENTRY and 160 into PLAYER_SPRITE_Y. Every collision test in the game measures against those two fixed bytes. The appearance of flight comes entirely from moving the world the other way (see "Speed and the world scroll" below).

The sprite is dressed for the heading by dressPlayerSpriteForHeading [seen]. That routine rounds PLAYER_HEADING to the nearest of 32 sectors, adding 4 and then dividing by 8. It uses the sector to index PLAYER_HEADING_SHAPE_TABLE (0x20CE), a table of 32 shape codes, and reads the matching attribute from the parallel table 32 bytes later. The shape table holds only the 16 codes 0xE8–0xF7. The attribute table supplies the mirror bits (0x40, 0x80 or 0xC0 in its top two bits) that make those 16 drawings cover all 32 sectors. Its colour field is zero in every entry. So the drawn ship has 32 facings, even though the heading underneath it has 256.

### One frame of the ship

Each pass of the round engine, serviceRoundThenResolvePlayerState [seen] calls dispatchPlayerFrameByState [seen] near the top of its fixed service list, and then calls fireAndSweepPlayerShots [seen] straight after it. dispatchPlayerFrameByState branches on PLAYER_STATE:

- **Zero:** it returns and does nothing.
- **Any value other than 0xFF:** the ship is exploding, and the frame goes to the explosion animation, advancePlayerAnimationStrip [seen].
- **0xFF:** the ship is alive, and PLAY_ACTIVE (0xAD30) [seen] makes one more split. With the flag clear, the attract demo is running and the ship is flown by the demo autopilot, flyDemoShipByScript [seen]. With the flag set, the controls are read. If the stick nibble is non-zero, turnShipTowardTargetHeading [seen] runs. If the stick is centred, the frame goes straight to scrollWorldAtTheEraPace [seen] and the heading is left exactly as it was.

All three flying paths end in the same scroll routine. The only difference between them is what, if anything, they do to the heading first.

The same routine also runs outside the round engine. The era-year caption hold (flyRoundIntroFlashingEraYearThenEraseIntroCaptions [seen]) and the enemy-free lead-in (flyEnemyFreeLeadInThenStepSequence [seen]) both call dispatchPlayerFrameByState, so the ship can already be steered in both. Only the lead-in also calls fireAndSweepPlayerShots, so the ship cannot fire while the year is on screen.

### Reading the controls

The vblank service copies both control panels into work RAM every frame, complemented so that a set bit means "asserted": IN1_MIRROR (0xA9AF) [seen] for the main panel and IN2_MIRROR (0xA9B0) [seen] for the cocktail panel. readPlayerControls [seen] returns one of the two, chosen by SCREEN_UNFLIPPED (0xA987) [seen]. When that cell is zero (a cocktail cabinet with the second player up) it returns the cocktail panel; otherwise it returns the main one. Callers split the returned word themselves:

- **Stick:** the low nibble is the stick. Bit 0 is left, bit 1 right, bit 2 up and bit 3 down, which matches MAME's port layout for this board.
- **Fire:** bit 4 is the fire button.

### Turning: eight targets on a 256-step circle

The stick does not set the heading directly. It picks a **target**, and the ship turns toward that target a few steps per frame.

turnShipTowardTargetHeading [seen] uses the stick nibble to index STICK_HEADING_TABLE, 16 bytes at 0x1F2E. The table holds the following targets:

| Stick | Target heading |
|---|---|
| left | 0 |
| down-left | 32 |
| down | 64 |
| down-right | 96 |
| right | 128 |
| up-right | 160 |
| up | 192 |
| up-left | 224 |

Impossible combinations, such as left and right together, read 0, the same value as left. Because the stick nibble is non-zero, the ship turns toward heading 0 as though left were pushed. The targets are 32 steps apart, which is an eighth of a turn.

The routine then compares PLAYER_HEADING with the target:

1. **Already on target:** nothing changes.
2. **Within one step either side:** the heading is set exactly onto the target. This arm is snapHeadingOntoTheTurnTarget [seen], which sits in the image directly after the table.
3. **Otherwise:** the heading moves toward the target the short way round. It moves by 3 steps per frame, or by 4 once ERA_INDEX (0xAD04) [seen] is 3 or more (the routine tests the value's low nibble). "The short way" is decided from the wrapped difference, heading minus target. A difference of 128 or more makes the heading increase and a smaller one makes it decrease. A target exactly opposite therefore always turns the increasing way.

The snap arm exists because 3 does not divide 32. A turn of an eighth of a circle at 3 steps per frame lands 2 short after ten frames, overshoots to one past on the eleventh, and is snapped onto the target on the twelfth. At 4 steps per frame the same turn takes exactly eight frames. A full reversal is legal and simply takes longer: 44 frames at 3 steps per frame, 32 frames at 4.

**Warning: the ship is not locked to eight headings.** Turning happens only while the stick is off-centre. If the stick is released mid-turn, the centred path skips the turn routine, so the ship keeps flying on whatever intermediate heading it had reached, and it stays there until the stick is pushed again. This contradicts the public description of eight locked facings in gameplay.md; the code shows the ship can hold any of the 256 headings.

The scroll step, velocityForHeading [seen], indexes its velocity table by the third byte of the object's record, which for the ship is PLAYER_HEADING. It reads the heading and never writes it, so a heading changed by the turn routine, a heading changed by the autopilot and a heading left alone all reach it the same way.

### Speed and the world scroll

scrollWorldAtTheEraPace [seen] uses ERA_INDEX to choose one of three velocity tables:

| Era | Table | Magnitude along the axes |
|---|---|---|
| 0 | 0x5E00 (OPENING_ERA_VELOCITY_TABLE) | 256 |
| 1 and 2 | 0x2E3E | 306 |
| 3 and 4 | 0x08FA (VELOCITY_TABLE_08FA) | 331 |

Each table is 256 signed 16-bit samples, one per heading step. velocityForHeading reads two samples: the one at the heading, and the one a quarter turn earlier as its perpendicular partner. Both are 8.8 fixed point, so the ship covers 1, about 1.2, or about 1.3 pixels per frame depending on the era. The diagonal samples are close to the same length (about 0.7 of the axis value on each component). There is no throttle anywhere in the code: speed is set by the era alone.

negateVelocityIntoWorldScrollThenDressSprite [seen] then negates both components and stores them as this frame's world scroll:

- **WORLD_SCROLL_Y (0xA808) [seen]:** takes the negated sample at the heading.
- **WORLD_SCROLL_X (0xA80A) [seen]:** takes the negated perpendicular sample.

The same routine finishes by calling dressPlayerSpriteForHeading. The two scroll words are the camera: every world object adds them each frame, so the world streams past the fixed ship.

The directions are consistent throughout. Heading 0 gives a positive sample on the native-Y axis, so WORLD_SCROLL_Y goes negative. On this ROT90 board that slides the world right on the glass, which reads as the ship flying left, the same direction the stick table assigns to heading 0.

Apart from bulk RAM clears (the power-on wipe of work RAM, and armRoundStartThenStepSequence [seen], which zeroes 0xA800-0xA97F, both words included, when it runs with PLAY_ACTIVE clear), only this routine and the life-start routine write the scroll words. As a result, **while the ship is exploding the world keeps drifting at the last velocity it had** [seen], because the explosion path never reaches the scroll routine. Both words keep that velocity until the next life's playfield reset zeroes them, but the drift itself stops when the countdown ends and loseLifeAndHandOver hides the sprites [seen].

### Firing

fireAndSweepPlayerShots [seen] spawns new shots only while PLAYER_STATE is 0xFF and ROUND_TRANSITION_HOLD (0xACC6) [seen] is clear. In every other state it only moves the shots already in flight. When it may spawn, it does the following in order:

1. **Edge detect.** It shifts bit 4 of the control word into FIRE_BUTTON_EDGE_SHIFT (0xA98E) [seen]. When the low two bits read binary 01 (released last frame, pressed this frame), it loads 3 into SHOT_BURST_PENDING (0xAA81) [seen].
2. **Burst gate.** During credited play no shot spawns while SHOT_BURST_PENDING is zero.
3. **Cooldown gate.** No shot spawns while SHOT_SPAWN_COOLDOWN (0xAA82) [seen] is non-zero.
4. **Spawn.** If both gates are open, the routine takes the first free slot of the six 16-byte records at PLAYER_SHOT_ARRAY (0xAA80) [seen]. Stepping the burst count down and reloading the cooldown to 6 happen together with the spawn. The sweep that follows ticks the cooldown down once per frame. The result is that a shot leaves at most every six frames, and one press gives a burst of three shots, twelve frames from first to last. Holding the button fires nothing further, because the edge needs a release.

**Warning:** SHOT_BURST_PENDING and SHOT_SPAWN_COOLDOWN are bytes 1 and 2 of shot slot 0's own record. The shot records do not use those two bytes.

When a shot spawns, requestPlayerShotSound [seen] is called and the slot is filled in as follows:

- **Velocity.** Bytes +10/+11 and +12/+13 get minus four times WORLD_SCROLL_Y and WORLD_SCROLL_X. This is four times the ship's own velocity, taken at the full 256-step heading at the moment of firing.
- **Start position.** The whole bytes of the two position words (+4 on the native-Y axis, +6 on the native-X axis) come from a 32-entry word table at 0x2771 (PLAYER_SHOT_SPAWN_POSITION_TABLE), indexed by the heading rounded to 32 sectors. Their fractions are zeroed.
- **Head byte.** Byte +0 goes from 0 to 0xFF.

**The 0x2771 table holds start positions.** Its entries are coordinate pairs on a ring of radius 6 around the pinned centre (native Y 120, native X 132). For example, sector 0 gives native Y 126 and native X 132, and sector 8 gives native Y 120 and native X 138. So a shot starts at the ship's nose.

Every frame, each live slot then moves by its stored velocity plus the camera scroll, which is a net three times the ship's velocity relative to the glass. After the ship turns, the shot keeps its own world direction. A slot is freed in any of three cases:

- its native-Y whole byte reaches 240 or more;
- its native-X whole byte leaves the range 16–247;
- its head byte is anything other than 0xFF. The shot-versus-target sweeps write 0xF0 into a shot that hits something, so this is how a spent shot is removed on the next sweep.

Shots have no sprites. Each surviving shot is drawn by queueTileStampForObject [seen], which queues a 2×2 block of character cells onto the deferred write list at DEFERRED_WRITE_CURSOR (0xAE00) [seen]. The block is chosen from 64 pre-shifted records by the low three bits of each coordinate.

### Being hit

The collision pass, dispatchCollisionPassByEra [seen], runs the player's contact tests on alternate frames (the even values of FRAME_TICK (0xA980) [seen]). Era 1 splits its work differently between the two frame parities (splitCollisionWorkByFrameParity [seen]). Every test that can kill the ship first refuses unless PLAYER_STATE is 0xFF, so a ship that is already dying cannot be hit again. Every test measures a wrapped box around the ship's pinned coordinates.

| Tested against | Routine | Outcome |
|---|---|---|
| The four actor slots from ACTOR_RECORD_SLOT0 (0xA810) [seen] | destroyPlayerAndObjectsTouchingIt [seen] | Ship and object both take 0xF0. No score. |
| The craft band from CRAFT_RECORD_SLOT0 (0xA850) [seen] | destroySlotsAndPlayerOnContact [seen] | Ship and craft both take 0xF0, and postChainedHitScore [seen] pays for the craft. Seven slots, or five while MOTHER_SHIP_ARMED (0xAD0D) [seen] is set. |
| The Mother-Ship record MOTHER_SHIP_STATE (0xA8A0) [seen], while armed | ramTestPlayerVsMotherShip [seen] | Same mutual kill as the craft band, scored. Its box along the native-X axis is wider in eras 0 and 4 (destroyPlayerAndMotherShipOnContact [seen]). |
| The era-object bank at ERA_OBJECT_RECORD_SLOT0 (0xA8C0) [seen] | destroyTargetsReachedByFixedAttacker [seen], all three slots, in every era except era 1 | Mutual kill, scored. |
| The parachutist at PARACHUTIST_RECORD (0xA8F0) [seen] | markObjectsTouchingPlayer [seen] | Only the parachutist's state is changed. The ship is unharmed. |

Era 1 tests its bank differently. There, destroyTargetsReachedByFixedAttacker is not called: destroyFixedTargetReachedByPlayer [seen] tests the ship against the bomber's first record alone (a mutual kill, scored, which also zeroes HITS_REMAINING), and destroyPlayerAndObjectsTouchingIt tests it against the bank's third record, the object the bomber launches (a mutual kill with no score). The bomber's second record is not tested by itself. Any of the killing tests stores 0xF0 in PLAYER_STATE. As the table shows, ramming a craft, the Mother-Ship or an era object scores it exactly as if it had been shot. The exceptions are contact with the actor slots and with era 1's launched object, which do not score.

### The explosion

On the next frame dispatchPlayerFrameByState sends the dying ship to advancePlayerAnimationStrip. That routine treats PLAYER_STATE itself as its countdown.

**Opening frame.** Any value of 0xB4 or more marks the opening frame. The routine:

- clamps the state to 0xB4;
- writes 0xFF into PLAYER_SPRITE_CODE. Sprite 255 in the sprite ROM is empty, so the ship's sprite disappears;
- calls requestRoundIntroSoundBurst [seen], and also calls requestLateEraProgressSound [seen] when ERA_INDEX is 2 or more;
- checks two anti-tamper witnesses, TAMPER_GLYPH_STRIP (0xABFE) [seen] and TAMPER_COLOUR_STRIP (0xABFF) [seen]. On a genuine image they always pass. If either fails, control jumps into the stick-to-heading table at 0x1F2E and executes its bytes as code.

**Countdown.** Every frame, the opening frame included, the state is decremented. On seven keyframe values (0xB3, 0xAB, 0xA3, 0x9B, 0x93, 0x8B, 0x83) the routine copies a block of 6 rows by 5 character cells into the character plane at PLAYER_ANIM_VRAM_BASE (0xA5AF). That block sits over the ship's pinned position, which is why the explosion can be drawn in tiles at all. The routine also writes ERA_INDEX + 0xC1 into the matching colour cells. The strip sequence is PLAYER_ANIM_STRIP_0, 1, 2, 3, 3, 2, 4, so the fireball grows and then shrinks. The last strip is filled entirely with glyph 0xF1, the glyph that surrounds the drawing in all the other strips, so it paints the explosion out. It is visible for about 48 frames.

**End of the countdown.** The count then runs on silently. On the 180th frame after the hit it reaches zero, and at the end of that same round-engine pass serviceRoundThenResolvePlayerState sees PLAYER_STATE at zero and calls loseLifeAndHandOver [seen]. That routine:

- hides the sprites;
- if ROUND_TRANSITION_HOLD is set (the round was already won), first runs startNextRound [seen], so the round still advances;
- requests the transition sound burst (enqueueTransitionSoundBurst [seen]);
- decrements LIVES_REMAINING (0xAD00) [seen];
- saves the 16-byte live context into the active player's slot;
- if lives remain, hands the turn over to the other player when the other player still has lives;
- if lives remain, sets SEQUENCE_DELAY to 90 and sends SEQUENCE_SUBSTEP (0xA9AC) [seen] back to sub-step 1, so the next life goes through the playfield reset again.

If no lives remain, it posts the game-over banner instead.

Throughout the countdown the rest of the round engine keeps running. Enemies and scenery keep moving, and the camera keeps its last velocity.

### The ship at round start and at each life

Sub-step 4 of the round engine, postRoundStartCaptionsAndResetPlayfield [seen], calls resetPlayfieldAndArmNewRound [seen]. That routine runs at the start of every life, not only at the start of a round. For the ship it:

- zeroes both world-scroll words, so the world stands still until the ship's first frame;
- zeroes SHOT_BURST_PENDING and ROUND_TRANSITION_HOLD;
- sets PLAYER_HEADING to 128, the target the stick table gives for "right";
- clears PLAYER_RECORD_SPARE_BYTE 0xA801 and sets PLAYER_STATE to 0xFF;
- pins the sprite at native X 132, native Y 120;
- dresses the sprite for its heading;
- frees all six shot slots through freeAllShotSlots [seen].

The ship is therefore alive and steerable from the first frame after the reset. That frame is the era-year caption hold at sub-step 5, followed by the enemy-free lead-in at sub-step 6, where the ship can also fire. Only then does the round engine proper, at sub-step 7, bring in enemies and collisions.

When a round is won, the warp animation stepRoundStartIntroAnimation [seen] recolours the ship. It runs on two frames out of every four. flashPlayerWhiteEveryOtherFrame [seen] alternates the colour field of PLAYER_SPRITE_ATTRIBUTE between 62 and 0 as PLAYER_FLASH_TICK (0xA9F1) [seen] counts, and on the tick that reads 8 it advances INTRO_ANIMATION_STEP (0xA9F0) [seen] and calls requestPlayerSpawnFlashSound [seen]. cyclePlayerSpriteColourThenAdvanceStepAtZero [seen] then switches the colour between 55 and 63 from SPRITE_COLOUR_CYCLE_COUNTDOWN (0xA9F3) [seen]. Both routines leave the mirror bits alone.

### The demo autopilot

The attract demo runs the real round engine with PLAY_ACTIVE clear, so the only difference in the ship is who flies it.

**Seeding the script.** verifyImageSignatureThenStartAttractDemoOrDerail [seen] calls seedDemoAutopilotScript [seen]. That routine chooses one of three heading-command scripts from the value in PLAYER_ONE_ERA_INDEX (0xAD14) [seen]:

| PLAYER_ONE_ERA_INDEX | Script |
|---|---|
| 0 or 3 | 0x218C (DEMO_AUTOPILOT_SCRIPT_FIRST) |
| 1 | 0x2251 (DEMO_AUTOPILOT_SCRIPT_SECOND) |
| 2 or 4 | 0x22FA (DEMO_AUTOPILOT_SCRIPT_THIRD) |

It points DEMO_SCRIPT_POINTER_LO/HI (0xADF3/0xADF4) [seen] at the chosen script's first byte and loads DEMO_SCRIPT_DWELL (0xADF2) [seen] with that byte plus one.

**Counterintuitive ordering:** the demo's era is decided after the script is chosen. The script is picked before the demo's own round-start arm, armRoundStartThenStepSequence [seen], runs. That arm advances ATTRACT_STAGE_COUNTER (0xA9D0) [seen] through 1, 2, 3, 1, and writes the new value into PLAYER_ONE_ERA_INDEX. That value then becomes the era the demo flies, because the demo loads player one's context. So the demo only flies eras 1 to 3. In the steady cycle, the script chosen from the previous value pairs the first script with era 1, the second with era 2 and the third with era 3. The first demo after boot or after a game uses whatever value was left behind.

**Flying.** Each frame flyDemoShipByScript steps a byte-coded script:

- The low six bits of DEMO_SCRIPT_DWELL are a frame count. The top two bits are a turn command: 00 holds the heading, 01 turns it down 3 steps per frame, and 10 or 11 turns it up 3 steps per frame.
- When the count is spent, the pointer advances and the next script byte is loaded plus one. A byte whose low bits are zero is skipped within the same frame.
- The routine then ends in the same scroll routine as the live ship.

The autopilot turns the heading directly, always by 3 steps per frame and with no target table. So the demo ship can hold any of the 256 headings. All three scripts open with four bytes of 60 frames with no turn, so the demo flies straight for its first four seconds.

The demo also fires. In fireAndSweepPlayerShots the burst gate applies only when PLAY_ACTIVE is set, so in the demo a shot leaves whenever the six-frame cooldown has expired and a slot is free. The result is a steady stream of shots with no button edges needed.

## §6 Killing, and being killed

Every object in play carries a state byte at the head of its record, and every kill in the game is the same act done to two of those bytes at once: a live object reads 0xFF, and a contact that counts stores 0xF0 into both parties. Nothing is removed on the spot. The collision code only marks; each object's own per-frame handler notices 0xF0 on its next turn and runs its death from there. Nearly everything that follows is therefore in two halves: which sweep marks what, and what each kind of object does once it finds itself marked.

Every test is the same kind of test. It compares two objects' whole-part coordinates on the two native axes (the sprite entry's +0x00 byte and its +0x31 byte) as a wrapped byte difference, biased by a half-width and compared against a full width, so each "box" is a window of so-many pixels either side, sometimes lopsided. The boxes differ from sweep to sweep and are given below where they matter.

### The collision pass

The round engine's service list, serviceRoundThenResolvePlayerState [seen], runs every mover first (the player, the shots, the wave spawner, the parachutist, the Mother-Ship, the seven craft slots, the era-2-to-4 weapon bank, the bomber and its third record, the four enemy-shot slots, and last the era-0 weapon bank) and only then calls dispatchCollisionPassByEra [seen], once per pass. So every contact is judged on positions already moved that pass, and every marked object dies on its handler's next turn, one pass later.

The pass does not run every sweep every time. dispatchCollisionPassByEra reads ERA_INDEX (0xAD04) [seen] and the low bit of FRAME_TICK (0xA980) [seen] and splits the work over two passes:

- **Eras 0, 2 and 3.** On odd ticks it runs dispatchShotSweepByMotherShipArmed [seen]: the player's shots against the craft. On even ticks it runs runAllCollisionSweepsThisFrame [seen]: shots against the era's weapon bank, then the player against everything.
- **Era 4** goes to dispatchEra4CollisionByFrameParity [seen]. Even ticks run the same runAllCollisionSweepsThisFrame. Odd ticks sweep the shots over one longer run that starts at ACTOR_RECORD_SLOT0 (0xA810) [seen] instead of at the craft. The run is eleven records long (the four enemy-shot slots plus all seven craft) while MOTHER_SHIP_ARMED (0xAD0D) [seen] is clear, and nine long (four plus five) while it is set, followed by destroyMotherShipAndShotOnMutualHit [seen]. This is the only era in which the enemy's own shots are in any shot sweep at all.
- **Era 1** goes to splitCollisionWorkByFrameParity [seen]. Odd ticks run the same craft shot sweep as eras 0, 2 and 3. Even ticks replace the weapon-bank shot sweep with a sweep against the one bomber, and then run the player-contact chain with two bomber-specific tests spliced in (see the era-by-era part below).

Shots live in their own six-record array at PLAYER_SHOT_ARRAY (0xAA80) [seen] with a 16-byte stride. They have no sprite entries and carry their coordinates in their own records. Only a shot that reads 0xFF is tested.

### What each sweep tests, and which contacts pay

**Shots against targets** go through destroyTargetsHitByShots [seen]. It takes each live shot in turn over a run of target records and their paired sprite entries. After every shot, it reloads the target cursors from the two scratch cells SCRATCH_PTR_A (0xA991) [seen] and SCRATCH_PTR_B (0xA993) [seen], so every shot is tested against the same run. A target must be live and must not sit in the narrow band of coordinates near zero that an unplaced or retired slot leaves behind. After that it must fall inside a box of 7 either side on both axes. On a hit, both state bytes take 0xF0 and a chained hit score is posted.

A counterintuitive detail: after a hit the sweep does not re-test the shot's own state. The same shot goes on through the rest of the run, so one shot can take several overlapping targets in one pass and is paid for each. The runs this body is handed are:

- all seven craft from CRAFT_RECORD_SLOT0 (0xA850) / CRAFT_ENTRY_SLOT0 (0xAA1A) [seen] while the Mother-Ship is unarmed
- only the first five craft while it is armed, inside destroyCraftAndMotherShipHitByShots [seen]
- the three-slot era weapon bank at ERA_OBJECT_RECORD_SLOT0 (0xA8C0) / ERA_OBJECT_ENTRY_SLOT0 (0xAA28) [seen], staged by stagePlayerShotSweepAgainstTargetsAndRun [seen]
- the era-4 long run described above

Two targets carry their own shot tests. The Mother-Ship is tested inside destroyCraftAndMotherShipHitByShots and destroyMotherShipAndShotOnMutualHit, against MOTHER_SHIP_STATE (0xA8A0) [seen], MOTHER_SHIP_ENTRY (0xAA24) [seen] and MOTHER_SHIP_SPRITE_Y (0xAA55) [seen]. The era-1 bomber is tested in destroyFixedTargetHitByShots [seen], against ERA_OBJECT_RECORD_SLOT0 and ERA_OBJECT_SPRITE_Y_SLOT0 (0xAA59) [seen]. Both use a box that is narrow on the first axis (6 either side; for the Mother-Ship in eras 0 and 4, 8) and long and one-sided on the second, reaching about 23 pixels along the craft's two-tile length. Neither re-reads the target's state inside its loop. So when several shots overlap the Mother-Ship in the same pass, each one is marked, each one pays a chain step, and the Mother-Ship still loses only one hit, because its handler absorbs one hit per turn.

**The player against things.** All of these sweeps refuse outright unless PLAYER_STATE (0xA800) [seen] reads 0xFF. They are listed in the order runAllCollisionSweepsThisFrame runs them. The cursor pair is handed from each sweep to the next, so together they walk the object array in address order. The exception: while the Mother-Ship is armed, the weapon sweep restarts at ERA_OBJECT_RECORD_SLOT0 and skips the two Mother-Ship records.

1. **Enemy shots.** destroyPlayerAndObjectsTouchingIt [seen] tests the four enemy-shot slots from ACTOR_RECORD_SLOT0 / ACTOR_ENTRY_SLOT0 (0xAA12) [seen] in a box of 5 either side. A touch marks both the player and the shot 0xF0, and **nothing is scored.**
2. **Craft.** destroySlotsAndPlayerOnContact [seen] continues into the craft band, over seven slots while the Mother-Ship is unarmed and five while it is armed. Its box is 7 either side on the first axis and 8 either side on the second. A touch marks both parties and **posts a chained hit score**. Because the craft is left at 0xF0 exactly as a shot would leave it, its handler then runs an ordinary death, and that death counts toward the kill quota. Ramming a craft is paid and counted as if it had been shot, at the price of the ship.
3. **The Mother-Ship,** only while it is armed. ramTestPlayerVsMotherShip [seen] picks the box by era: 8 either side on the first axis in eras 0 and 4 (handed to destroyPlayerAndMotherShipOnContact [seen]), 6 either side otherwise. The second axis is a lopsided window 35 long, reaching 25 one way and 9 the other. A touch marks both parties, posts a chained score, and clears MOTHER_SHIP_HITS_TO_ABSORB (0xA8A4) [seen]. That cell is the Mother-Ship's remaining-hit count (see below), so ramming the Mother-Ship destroys it outright instead of costing one hit.
4. **Era weapons.** destroyTargetsReachedByFixedAttacker [seen] tests the three era-weapon slots in a box of 6 either side. A touch marks both parties and **pays a chained score.** Colliding with a bomb or missile is paid; colliding with a craft's bullet is not.
5. **The parachutist.** markObjectsTouchingPlayer [seen] runs last over the one parachutist slot at PARACHUTIST_RECORD (0xA8F0) / PARACHUTIST_ENTRY (0xAA2E) [seen], with a box of 8 either side. It is the only contact that leaves the player alive. It checks PLAYER_STATE first, and on a touch it stores 0xF0 into the parachutist's state only. The pickup then runs its own award sequence (below).

The difference between the two Mother-Ship states matters here. MOTHER_SHIP_ARMED is raised when the ship is armed and is cleared only by the round start (startNextRound) and the playfield reset (resetPlayfieldAndArmNewRound). It stays up after the ship is destroyed, so for the rest of the round these sweeps keep using the five-craft runs and keep the Mother-Ship test in place. The test itself does nothing once the ship's state is no longer 0xFF.

### Scoring a hit: the chain

Every contact that pays posts through postChainedHitScore [seen], and what it posts is not a fixed 100. It puts command 4 on the command ring (COMMAND_RING, 0xAC00) [seen]. The argument is an index into SCORE_AWARD_TABLE (0x0D27), a table of 3-byte packed-decimal amounts. Entries 1 to 9 there are 100 to 900, entry 10 is 1,000, 11 is 1,500, 12 is 2,000, 13 is 3,000, 14 is 4,000 and 15 is 5,000.

- If CHAIN_WINDOW (0xA99D) [seen] has run down to zero, the hit posts index 1 (100) and leaves CHAIN_STEP (0xA99E) [seen] alone.
- If the window is still open, the hit increments CHAIN_STEP and posts `(step mod 8) + 1`.

Either way the window is reloaded to 30. So hits in quick succession pay 100, 200, 300 … 800, then wrap back to 100 and climb again. An isolated hit is always 100. expireHitChain [seen] runs once per service pass: it counts the window down, and on every pass after the window reads zero it holds CHAIN_STEP at zero. The chain is shared by every paying contact in the game: shots on craft, shots on weapons, each Mother-Ship hit, each bomber hit, and every ram.

The foreground loop pulls the command off the ring and runs awardScoreToPlayer [seen]. That routine does nothing unless PLAY_ACTIVE (0xAD30) [seen] is set, which is why the attract demo's kills never score. Otherwise it adds the amount into the current player's six-digit packed-decimal score, copies the score into the high score if it now leads, and repaints. Two consequences follow from paying through the ring. The points arrive a little after the hit, whenever the foreground gets to them. And postCommand [seen] drops the pair silently if the ring cell it would write is still occupied, so an award posted into a full ring is lost.

### How a craft dies, and the kill count

The seven craft slots are stepped by stepSevenCraftSlots [seen]. Each slot is handed to that era's slot service (serviceEra0EnemyCraftSlot … serviceEra4EnemyCraftSlot [seen]). The last two slots, MOTHER_SHIP_STATE and CRAFT_RECORD_SLOT6 (0xA8B0) [seen], stand down while MOTHER_SHIP_ARMED is set, because the Mother-Ship occupies both records. Each era's service splits on the state byte: 0x00 is free, 0xFE is held (released by releaseHeldObject [seen]), 0xFF flies, and any other value goes to stepDyingObjectState [seen].

stepDyingObjectState is where a kill is counted. When it finds 0xF0 it re-stamps the state to 0x3B and calls countTheKillAndGrantTheSharedToken [seen]. That routine requests the pair of death sounds and decrements KILLS_REMAINING (0xAD02) [seen], but never below zero, and it also services the formation claim (below). From 0x3B down the state is a death countdown. Each turn steps it down by one, and moveObjectByStateByteThenRunAppearance [seen] steps it again while it is 32 or more. The wreck flies on at the slowest speed while it is high and afterwards only drifts with the world. The slot is retired when the count reaches zero. driveObjectAppearanceByPhaseBand [seen] animates the wreck off the same count. From 42 up it keeps the shape and cycles the tint off the frame counter. From 10 to 41 it steps through a 16-entry explosion shape table at half the count's rate. Below 10 the wreck is retired at once unless it holds the formation token. A state of exactly 0x3C also counts a kill on the way down; the only way a craft reaches that value is the Mother-Ship sweep below.

KILLS_REMAINING is reloaded from KILL_QUOTA (0xA9CD) [seen], which is 56, when a round starts (startNextRound [seen]), and only this path decrements it. Only the seven craft slots reach stepDyingObjectState. So shooting an enemy shot, a bomb, a missile, the bomber or the Mother-Ship, or collecting a parachutist, scores without advancing the round. drawKillMeter [seen] repaints the bottom-of-screen bar from KILLS_REMAINING every pass. Once the count reaches zero, armMotherShipOrStep [seen] can arm the Mother-Ship.

### Enemy weapons and special craft, era by era

The four **enemy-shot slots** (ACTOR_RECORD_SLOT0 … ACTOR_RECORD_SLOT3, 0xA810-0xA840 [seen]) are filled by launchBankEnemyWhenAimedNearPlayer [seen]. The routine fires only when all of these hold: the craft is on its one-in-eight turn, BANK_LAUNCH_COOLDOWN (0xA817) [seen] has run out, and one of the first BANK_LAUNCH_SLOT_COUNT (0xA844) [seen] shot slots is free. The craft must also not be within BANK_LAUNCH_NEAR_HALF_WIDTH (0xA827) [seen] of the player's fixed screen position on both axes, its heading must be within BANK_LAUNCH_HEADING_HALF_WIDTH (0xA837) [seen] of the player's heading, and the heading toward the aim point must be within 16 of the craft's own. It then copies the craft's position into the free slot and gives it a velocity along that heading. The Mother-Ship also fires into the last two of these slots, under its own rules (see the Mother-Ship below): there is no heading-alignment test, and the shot is aimed at an aim point, swung alternately ±0x18 off. stepFourActorSlots [seen] flies them. In eras 0-3 no shot sweep includes these slots, so the craft's bullets cannot be shot down there. A bullet that touches the player takes the ship and pays nothing. Only in era 4 are they in the odd-tick shot sweep. A marked bullet explodes through a countdown animation in era 4 and is simply retired in any other era (runSlotCountdownDriftAndAnimateElseRetire [seen]).

The three-slot **era weapon bank** at ERA_OBJECT_RECORD_SLOT0 … ERA_OBJECT_RECORD_SLOT2 (0xA8C0-0xA8E0) [seen] holds something different in each era:

- **Era 0.** launchAttackerIntoFreeSlot [seen] and commissionStagedAttackerByEra [seen] stock the bank with thrown objects, and serviceEra0BallisticObjectBank [seen] flies them along flyAlongBallisticArc [seen]. The arc has a fixed step on one axis and a steadily growing step on the other, which reads as a dropped bomb's accelerating fall; what the objects look like on the glass is still open (§9).
- **Eras 2 and 3.** sweepEra2PlusObjectBank [seen] runs the same bank as chased objects. A launched weapon flies straight while a countdown runs (flyLiveSlotAndTickCountdown [seen]). After that it turns toward an aim point every frame, but re-aims at it only on the one frame in sixteen whose FRAME_TICK low nibble matches its phase byte (+0x0F) (chaseOneAimPointAndRetireAtTheLine [seen]). It keeps chasing until it drifts onto a retire line. By their behaviour these read as homing missiles; their on-glass identity is still open (§9).
- **Era 4.** The bank runs stepSlotApproachThenBreakawayRetire [seen]: the weapon homes while an approach countdown runs, then breaks away at double velocity.

In eras 0, 2, 3 and 4 the bank can be shot for a chained score, and ramming it also pays. A marked weapon runs its explosion out through the bank's countdown handlers.

**Era 1 is built differently.** The bank's first two records belong to one two-tile **bomber**. serviceEra1BomberObject [seen] services it only when ERA_INDEX is 1. While its head byte is 0x00, armBomberSlotWhenTimerFires [seen] counts the record's +0x0E delay down on even ticks. When the delay runs out it launches the bomber, provided the Mother-Ship is not armed. The launch aims the bomber off the player's heading, gives it a fixed velocity, sets HITS_REMAINING (0xA8DC) [seen] to 3 and marks it live. While live it flies straight (advanceTwoTileObjectThenTryAimedSpawn [seen]). It may launch an aimed object into the bank's third record, which serviceFixedSlotInEra1 [seen] flies. It wears its damage: mirrorTwoTileObjectByHeading [seen] picks its shape block from `3 − HITS_REMAINING`.

A hit reaches it only through destroyFixedTargetHitByShots on even ticks. Each hit pays a chain step and leaves the head at 0xF0. On the bomber's next turn, advanceHitSoakingObjectThenAnimateDeath [seen] checks HITS_REMAINING. While the count is non-zero it spends one, puts the head back to 0xFF, requests the hit sounds and flies on. So the first three hits are absorbed and **the fourth kills.** On the killing hit the head is set to 0x61 and counted down. Every eight counts above 0x40 it takes the next frame of DEATH_ANIMATION_SHAPE_TABLE (0x3C09). At exactly 0x40 it posts command 4 with index 11, which is **1,500 points**, and shows a fixed pair of shapes (the award display) until the count reaches zero. Then retireObjectAndHold [seen] clears both records and reloads the +0x0E delay to 128 for the next launch. None of this touches KILLS_REMAINING.

The bomber also has its own **ram test**. On even ticks in era 1, after the craft contact, destroyFixedTargetReachedByPlayer [seen] tests the player against the bomber (6 either side on the first axis, a lopsided window about 33 long on the second). A touch marks both parties, zeroes HITS_REMAINING and posts a chained score. With no hits left to absorb, the bomber goes straight into its death and still pays its 1,500 at 0x40.

The bomber's third record is not in any era-1 shot sweep. Instead, a later destroyPlayerAndObjectsTouchingIt tests it against the player alone (5 either side), which kills without paying. Whatever the bomber launches can hit you but cannot be shot. The era-1 chain also has no shot sweep against the enemy-shot slots and no weapon-bank ram test beyond these two records.

### The Mother-Ship and its hit counter

armMotherShipOrStep runs once per pass. It does nothing while ROUND_TRANSITION_HOLD (0xACC6) [seen] reads 0xFF. While MOTHER_SHIP_ARMED is set it runs loc_43f0 [seen]. Otherwise, on ticks where FRAME_TICK's low three bits equal 5, it checks three things together: KILLS_REMAINING, MOTHER_SHIP_STATE and the record one stride on. When all three are zero it raises MOTHER_SHIP_ARMED, writes 7 into MOTHER_SHIP_HITS_TO_ABSORB (the record's +4 byte), and hands the record pair to retireEntryPairIntoCooldown [seen], which clears the record head and both sprite entries and seeds the idle delay at +0x0E with 95.

loc_43f0 treats the record's head byte as a phase.

- **0x00 (idle)** counts a delay at +0x0E. When the delay runs out, the ship launches unless ROUND_TRANSITION_HOLD is non-zero. Its sprite is placed at the coordinate pair HEADING_SHAPE_TABLE (0x3C84) holds for PLAYER_HEADING [seen], nudged 16 steps one way or the other by bit 3 of FRAME_TICK. Its heading byte (+2) is set to 0 or 128, the top bit of PLAYER_HEADING plus 0xC0. setMotherShipVelocityFromHeading [seen] then sets its velocity from that heading, and its head becomes 0xFF. At that launch, a hit counter below 6 is raised to 5. A fresh ship keeps its 7. A ship that went idle and relaunched after taking two or more hits comes back needing six.
- **0xFF (live)** moves the pair by its own velocity plus the world's scroll and dresses it (dressSpriteForHeadingOrRetireAtEdge [seen]), which retires it back to idle with a fresh delay if it reaches the field edge. Then, off cooldown, if either of its two records is on screen but more than BANK_LAUNCH_NEAR_HALF_WIDTH from the player's fixed screen position (0x84, 0x78) on either axis, it fires into a free slot of the last two enemy-shot slots. The shot is aimed at an aim point and swung ±0x18 alternately by a side toggle, and its speed comes from the era's stage arm.
- **A hit (0xF0).** If MOTHER_SHIP_HITS_TO_ABSORB is still non-zero, the next step spends one, restores 0xFF and requests the hit sounds. So the ship absorbs seven hits and **the eighth destroys it.** Every hit, absorbed or not, pays a chain step from the collision sweep. HITS_REMAINING is the bomber's counter, and the Mother-Ship's death clears it.

When the counter is already zero, the ship's head counts down one per step from 0xF0 through a warp-and-flash sequence (the shapes come from MOTHER_SHIP_WARP_SHAPE_TABLE, 0x461B). One step in (the head at 0xEF), it **sweeps the field**:

- it clears HITS_REMAINING and queues the transition sound bursts
- it walks all fifteen object records from ACTOR_RECORD_SLOT0 to PARACHUTIST_RECORD
- each record that reads 0xFF gets a staggered dying code (0x14 for the first, then 10 more per record) and posts command 4 with index 2, **200 points** each
- each record held at 0xFE is cleared

It then sets ROUND_TRANSITION_HOLD to 0xFE and restarts its own count at 0xE4. The staggered codes make the swept objects go down one after another, each through its own death handler. Every swept craft gets a code of 0x3C or above (the first craft record is the fifth in the walk, so it gets exactly 0x3C). Each one therefore passes through the kill-count step on its way down, which requests the death sounds but cannot lower KILLS_REMAINING, already zero. A bomber caught flying goes through its normal death and still pays its 1,500. A parachutist caught in flight is sent into its award sequence, so it is paid its rescue award on top of the 200. When the count reaches 0xB4 the ship posts command 4 with index 13, **3,000 points**, and requests the warp sound if the player is alive. At zero it sets ROUND_TRANSITION_HOLD to 0xFF and returns to idle, handing over to the round advance.

The total for a Mother-Ship destroyed on its first launch is therefore eight chain-paid hits, 200 for each live object swept, and 3,000 at the flash; one that went idle and relaunched after two or more hits needs six more hits after the relaunch, on top of the ones it took before. Ramming it gives one chain-paid contact in place of the eight hits, then the same sweep and the same 3,000.

### Parachutists

runParachutistSlot [seen] runs the single parachutist slot in every era except era 4, where it returns at once. A free slot is handed to spawnAtEdgeAhead [seen]. That routine refuses while MOTHER_SHIP_ARMED is set and otherwise acts on odd ticks only, counting the slot's +0x0E delay down. When the delay runs out it places the parachutist at an edge position that the player's heading selects from a 16-sector table (EDGE_SPAWN_COORD_TABLE, 0x488D), and marks it live. While live it drifts along its stored velocity, animating off FRAME_TICK, and is retired into a cooldown if it reaches a retire line.

Collection is the parachutist's touch in markObjectsTouchingPlayer. Its state becomes 0xF0, and on its next turn showParachutistAward [seen] re-stamps it to 0x3B, requests the award sound, and shows the award shape chosen by PARACHUTIST_RUNG (0xA8F7) [seen], which is the record's +7 byte. The count then runs down one per pass. At 0x10, postNextParachutistBonus [seen] reads the rung, steps it, and posts command 4 with PARACHUTIST_BONUS_ARG_TABLE (0x484F) entry `rung` for the first four rungs: indices 10, 12, 13 and 14, which are **1,000, 2,000, 3,000 and 4,000**. For every rung after that it posts index 15, **5,000**. The rung keeps climbing past the table, so the award stays at 5,000. At zero the slot is retired into its cooldown. The rung is zeroed by resetPlayfieldAndArmNewRound [seen], the reset that also puts a fresh ship in place, and nothing else in this section resets it. No shot sweep includes the parachutist slot, so a parachutist cannot be shot. The one way to lose one is to let it reach a retire line. The Mother-Ship's sweep pays for it instead of losing it.

### Formations and the 2,000 bonus

In eras 0-3, driveEnemyWaveForLifePhase [seen] builds a formation inline across the craft band. Its row comes from WAVE_DESCRIPTOR_TABLE (0x397B), one of two rows per era picked by a random bit. Each member's spawn position is a pair from WAVE_EDGE_POSITION_TABLE (0x38E9), whose pairs trace the screen edge: the index is the member's descriptor byte plus an offset WAVE_HEADING_BIAS_TABLE (0x38D9) gives for PLAYER_HEADING rounded to sixteen directions, so where on the edge the formation appears shifts with the player's heading. The builder fills free craft slots up to ROUND_CRAFT_COUNT (0xACC1) [seen], or five once the quota is spent. For each member it copies a delay from the descriptor into the record's +0x0E byte. Every entry the ROM rows supply has a non-zero delay, so every member starts **held** at 0xFE. The builder tallies the members into WAVE_KILL_COUNTDOWN (0xA811) [seen] and loads WAVE_CLAIM_TIMER (0xA812) [seen] with 228, which the vertical-blank service counts down once a frame. If five or more members were placed, the tally stands as the countdown and the formation sound is requested (requestEnemyWaveSound [seen]). Otherwise the countdown is overwritten with ROUND_CRAFT_COUNT, and the sound plays only if the tally reaches that count. releaseHeldObject lets each member go when its delay runs out, and on release it reloads +0x0E with 128. That top bit is what marks the craft as a formation member.

countTheKillAndGrantTheSharedToken does the claim. It acts only when the dying craft's +0x0E top bit is set and WAVE_CLAIM_TIMER is still non-zero, and then it decrements WAVE_KILL_COUNTDOWN. The kill that brings the countdown to zero writes that craft's slot ordinal (its record's +0x0F), with the top bit set, into CLAIM_TOKEN (0xA821) [seen]. The payment comes from the wreck's own animation. When the death count falls below 10, driveObjectAppearanceByPhaseBand retires every wreck except the one CLAIM_TOKEN names. That one holds a fixed shape and tint, which is the bonus display. On most frames its count is bumped back up as fast as it steps down, so it lingers while the count creeps down one step every eight frames. When the count sits at 1 it posts command 4 with index 12, **2,000 points**, and clears the token, and the wreck retires on its next step.

The practical conditions for the bonus, as the code stands, are these. Enough kills of formation-marked craft (+0x0E top bit set) must land before WAVE_CLAIM_TIMER runs out, 228 frames after the formation spawned, to bring WAVE_KILL_COUNTDOWN to zero. Kills after the timer expires do not count down. A formation that placed fewer than five members, and fewer than ROUND_CRAFT_COUNT, is given a countdown larger than its own membership, so it needs marked kills beyond its own members; any that come have to be survivors of an earlier formation that still carry the 0x80 mark.

Era 4 gets its waves from spawnEnemyWaveIntoFreeSlots [seen] instead. That routine loads WAVE_CLAIM_TIMER but writes 0 into each craft's +0x0E and marks it live immediately, with no hold. None of those craft can satisfy the claim guard, so as far as these bodies show, **era 4 has no formation bonus.**

## §7 Score, and the ladder that ends

Time Pilot keeps three kinds of long-running tally, and none of them lives where the others do. A player's **score** sits in its own fixed triple of bytes that the two-player machinery never copies. A player's **lives, round, era and difficulty rung** sit in a sixteen-byte context block that is swapped in and out on every turn. And the **life tick counter**, a three-place base-sixty count of round-service passes during the current life, drives the difficulty ladder that climbs while the player stays alive and drops back when they die. This section follows those tallies from the award of a single point to the moment the machine gives up on both players and returns to attract.

### Scores: packed decimal, one byte pair per two digits

Each player's score is six decimal digits packed two to a byte. Player 1's score occupies PLAYER1_SCORE_LO 0xad33 through PLAYER1_SCORE_HI 0xad35, and player 2's occupies PLAYER2_SCORE_LO 0xad36 through PLAYER2_SCORE_HI 0xad38 [seen]. In both, the least significant pair of digits is at the lowest address and the hundred-thousands/ten-thousands pair is at the highest. ACTIVE_PLAYER 0xad32 [seen] chooses which triple an award goes into. The scores are **not** part of the per-player context block described below, so nothing needs to save or restore them. They stay in place, and the index picks the right one.

Scoring is always requested through the game's command queue. The requester posts command 4 with an award number, and the foreground loop runCommandRingDrainLoop [seen] later hands that number to awardScoreToPlayer [seen]. The award number indexes SCORE_AWARD_TABLE 0x0d27, a program-image table of three-byte packed-decimal increments. Reading its bytes gives the ladder:

| award | points | award | points |
|---|---|---|---|
| 1–9 | 100–900 | 12 | 2,000 |
| 10 | 1,000 | 13 | 3,000 |
| 11 | 1,500 | 14 / 15 | 4,000 / 5,000 |

Every entry has a zero low byte, so a Time Pilot score always ends in "00". awardScoreToPlayer does nothing at all while PLAY_ACTIVE 0xad30 [seen] is clear, which means the attract demo, running the real round engine, never scores. Otherwise it adds the increment into the active player's triple one byte at a time, starting with the low byte, carrying decimally between bytes. A carry out of the top byte is simply dropped, so **the score wraps from 999,900 back through zero** rather than saturating. It then compares the new score with the displayed high score, most significant byte first. Only a score that is strictly greater replaces all three bytes of the high score (0xa98b–0xa98d, with HIGH_SCORE_HI 0xa98d [seen] the most significant) and repaints it. A tie leaves the high score untouched. Finally it repaints only the active player's readout.

Award number 0 takes a different path. It adds nothing and repaints the score labels instead. In a two-player game (TWO_PLAYER_GAME 0xad31 [seen] set) it draws both labels and both scores. In a one-player game it draws the lone label and player 1's score, erases the second label, and blanks the six cells of player 2's readout starting at PLAYER2_SCORE_READOUT_BASE 0xa501, which removes the second score from the screen. The new-game arm posts this award-0 request once.

All three six-digit readouts share one painter, paintSixDigitFieldSuppressingLeadingZeros [seen]. paintPlayerOneScoreReadout [seen], paintPlayerTwoScoreReadout [seen] and paintHighScoreReadout [seen] only choose its inputs: the source triple's top byte, the first screen cell (PLAYER1_SCORE_READOUT_BASE 0xa781, 0xa501, and HIGH_SCORE_READOUT_BASE 0xa641 respectively) and colour 0x10. The painter walks down the triple two digits at a time. The first four digits share a single leading-zero flag, so zeros are blanked across the whole field until the first non-zero digit, not pair by pair. The last two digits are always drawn. A score of zero therefore reads "00", never a blank.

Who asks for which award is the business of the combat and object sections. What the award numbers show is this. The collision routines that destroy craft and shots, whether shots meeting a target or a craft rammed on contact, score through postChainedHitScore [seen]. That routine keeps a short-lived chain: CHAIN_WINDOW 0xa99d [seen] is reloaded to 30 on every kill and counted down once per round-service pass by expireHitChain [seen], which also zeroes CHAIN_STEP 0xa99e [seen] once the window has lapsed. A kill that arrives with the window at zero posts award 1 (100 points). A kill that arrives while the window is still open steps the chain and posts the next award, so closely spaced kills pay 100, 200, 300 and so on up to 800, then wrap back to 100. ⚠ This is a climbing chain, not the flat 100 per enemy the operator's manual describes, and the code wins. The fixed awards seen at their posting sites are award 11 (1,500) when the hit-soaking era-1 bomber finally dies (advanceHitSoakingObjectThenAnimateDeath [seen]) and award 12 (2,000) when a formation's shared claim token is cashed (driveObjectAppearanceByPhaseBand [seen]). The Mother-Ship's own stepper, reached through armMotherShipOrStep [seen], posts award 13 (3,000) at its warp flash and award 2 (200) for each live object record its field sweep sends down (§6). Parachutists pay through postNextParachutistBonus [seen]. Their step number is stored in the parachutist record at PARACHUTIST_RUNG 0xa8f7 [seen] and selects award 10, 12, 13 or 14 from PARACHUTIST_BONUS_ARG_TABLE 0x484f, then 15 for every later pickup. The ladder is 1,000 / 2,000 / 3,000 / 4,000, capped at 5,000. The playfield reset of every life and every round zeroes that step, so the ladder starts again at 1,000 after a death or an era change.

### Bonus lives: an exact match on the top digit pair

awardBonusLifeAtScoreMark [seen] runs on every round-service pass during play. BONUS_LIFE_SETTING 0xa9c3 [seen] is bit 3 of the complemented second switch bank, and its bit 0 selects one of two length-prefixed mark lists in the program image. With the bit clear the list is BONUS_LIFE_MARK_TABLE_BIT0_CLEAR 0x4e1b: twenty marks at 10,000, then 60,000, 110,000 and every 50,000 up to 960,000. With the bit set it is BONUS_LIFE_MARK_TABLE_BIT0_SET 0x4e30: seventeen marks at 20,000, then 80,000 and every 60,000 up to 980,000. Each mark is a single packed byte, compared with the top byte of the active player's score (the hundred-thousands and ten-thousands digits). The routine therefore asks only "is this player's score now inside a bonus band?"

BONUS_LIFE_LATCH 0xad03 [seen] makes the award fire once per band. When a match occurs with the latch clear, the routine sets the latch, adds one to LIVES_REMAINING 0xad00 [seen], and posts command 5 with the pre-award count, which is how the reserve-ship strip is redrawn. It also requests the bonus-life sound. Any pass that finds no match clears the latch again. No award is larger than 5,000, so a score can never jump over a whole ten-thousand band. Two consequences of the code are worth stating. First, **bonus lives stop after the last mark** (960,000 or 980,000 depending on the setting). Second, because the score wraps past 999,900 and the latch re-opens off-band, a score that rolls over re-enters the 10,000 band and **the marks pay again on the second time round**. The latch belongs to the context block, so each player has their own.

### Lives and their display

The starting count comes from the switches. At boot, seedGameConfigFromDipSwitches [seen] takes the low two bits of the complemented second bank and adds 3, giving 3, 4 or 5. The fourth setting (a sum of 6) is replaced by 255. unpackTheFirstThreeSwitchSettings [seen] stores that value in STARTING_LIVES 0xa9c1 [seen]. startOnePlayerGame [seen] copies it into PLAYER_ONE_LIVES 0xad10 [seen], zeroes PLAYER_TWO_LIVES 0xad20 [seen] and TWO_PLAYER_GAME, and takes one credit off CREDIT_COUNT 0xa986 [seen]. startTwoPlayerGame [seen] fills both players' lives and takes two credits. Both routines raise PLAY_ACTIVE and send the sequence machine to phase 3, the round engine.

The count is always displayed less one, meaning the ships in reserve rather than the one in the air. Two routines post command 5 with that value: the turn set-up step (below) when a turn begins, and the bonus-life award. The command lands in drawEmblemStripThenGuardImage [seen]. It does nothing unless play is active, stamps up to six two-by-two ship emblems leftward from EMBLEM_STRIP_TOP 0xa783, and blanks the rest of the strip. Any reserve beyond six is not shown.

A life ends in the round service. serviceRoundThenResolvePlayerState [seen] is sub-step 7 of the round engine and runs once per dispatch of that sub-step, which is not every frame. After servicing every subsystem it reads PLAYER_STATE 0xa800 [seen]. A value of 0xff (alive) sends it to the round-advance test. A value of 0 (dead) sends it to loseLifeAndHandOver [seen]. Anything else, meaning the ship is still dying, lets the frame pass.

### The life tick counter: three base-sixty places

LIFE_TICKS_LOW 0xad05, LIFE_TICKS_MID 0xad06 and LIFE_TICKS_HIGH 0xad07 [seen] form a three-place counter, each place one packed-decimal byte counting 00 to 59. The low place counts round-service passes, the middle place counts wraps of the low place (every sixty passes), and the top place counts wraps of the middle place. Because the service does not run on every frame, none of these is a fixed unit of time. resetPlayfieldAndArmNewRound [seen] zeroes all three at the start of every life and every round.

The counter is advanced by escalateDifficultyRungOnCounterWrap [seen] through advanceSexagesimalDigit [seen]. That routine adds one to a place with the hardware's decimal correction, writes the result back, and only then tests it. A result of 0x60 or more is overwritten with zero and reported as a roll-over, so a rolled place is written twice. Carries ripple upward only while each place rolls: the low place is stepped on every pass, the middle place only when the low place rolls over, and the top place only when the middle one does. Other subsystems read the counter as a phase. reaimAndAnimateEnemyCraftOnPhaseTick [seen] keys off the low place, and driveEnemyWaveForLifePhase [seen] keys its wave behaviour off the units digit of the middle place, a cycle of ten low-place wraps.

### The difficulty ladder: rungs that climb during a life

Each time the low place rolls over (the middle place does not need to roll), the same routine services the rung timer. If ERA_RUNG_TIMER 0xa9d7 [seen] is zero, escalation is switched off and nothing happens. Otherwise the timer is decremented. When it reaches zero it is reloaded from ERA_RUNG_PERIOD 0xa9d6 [seen], ERA_RUNG 0xacc0 [seen] climbs by one to a ceiling of 15, and applyEraRungSettings [seen] loads the row that the new rung selects. That row is reached through ERA_RUNG_SETTINGS_POINTER_TABLE 0x1b04, indexed by sixteen times ERA_INDEX 0xad04 [seen] plus the rung, and it names a ten-byte record that is spread over the enemy-launch and spawn cells. Those cells include ROUND_CRAFT_COUNT 0xacc1 [seen]. The meaning of each field belongs to the enemy sections. For this section, what matters is that **each era has sixteen rungs of parameters, and the longer a life lasts, the higher the rung.**

The climb starts from START_RUNG 0xad0a [seen]. The playfield reset copies START_RUNG into ERA_RUNG and reloads the timer from the period, so every death drops the player back to the round's starting rung. Which starting rung applies, and how fast the ladder climbs, is fixed per game by the difficulty switch. When a game starts, loadDifficultyRecord [seen] uses DIFFICULTY_SETTING 0xa9c4 [seen] to pick one of eight four-byte records at DIFFICULTY_RECORD_TABLE 0x186a. It copies that record into START_RUNG_ROUNDS_1_5 0xa9d3, START_RUNG_ROUNDS_6_10 0xa9d4 and START_RUNG_ROUNDS_11_UP 0xa9d5 [seen], with the fourth byte going into ERA_RUNG_PERIOD. The records in the image run from starting rungs 0/2/6 with a period of 13 wraps at the easiest setting to 15/15/15 with a period of 5 wraps at the hardest. The attract demo always loads record 2.

### Rounds and the era ladder that wraps

ROUND_NUMBER 0xad01 [seen] counts rounds from 1. ERA_INDEX 0xad04 [seen] picks which of the five eras the round is played in (0 through 4; in the gameplay frame these are 1910 through 2001). A new game starts both players at round 1, era 0.

A round is won inside the round service. advanceRoundWhenFieldCleared [seen] acts only when three conditions all hold: the kill quota is spent (KILLS_REMAINING 0xad02 [seen] is zero), ROUND_TRANSITION_HOLD 0xacc6 [seen] is non-zero (the Mother-Ship's own stepper raises it as its destruction plays out), and all fifteen actor records from ACTOR_RECORD_SLOT0 0xa810 onward read empty. When they do, and play is active, it clears the sprite rows and calls startNextRound [seen], then saves the context block into the active player's slot and seats SEQUENCE_SUBSTEP 0xa9ac [seen] from NEXT_ROUND_START_SUBSTEP 0x4a35. That seed is 13, the band animation a won round plays (armRoundWonBandAnimationThenStepSequence [seen], then stepRoundStartIntroAnimation [seen]). The animation's last step loads the context back in and reseats the sub-step at 3 from INTRO_SUBSTEP_RELOAD 0x2750. The same player carries straight on, because a won round never passes the turn. In the demo (play inactive) the same trigger instead restarts the attract sequence.

startNextRound is the whole of the ladder. It increments ROUND_NUMBER and moves ERA_INDEX forward, wrapping from 4 back to 0, so round 6 is era 0 again. It then chooses the round's START_RUNG by round bracket: rounds below 6 use START_RUNG_ROUNDS_1_5, rounds below 11 use START_RUNG_ROUNDS_6_10, and every later round uses START_RUNG_ROUNDS_11_UP. The brackets fall exactly on the first pass through the five eras, the second pass, and every pass after that, so **the loop gets harder by starting each round higher up the same rung ladder, not by a new table**. The ladder has three steps and then stops; from round 11 on, every loop starts from the same rung. KILLS_REMAINING is refilled from KILL_QUOTA 0xa9cd [seen], which only the boot path writes, copying DEFAULT_KILL_QUOTA 0x0874 (56). The quota is therefore 56 in every era of every loop. MOTHER_SHIP_ARMED 0xad0d [seen] and ROUND_TRANSITION_HOLD are cleared, and ROUND_ARMED 0xad0e [seen] is set to 0xff.

ROUND_ARMED marks the first life of a round. In play, postRoundStartCaptionsAndResetPlayfield [seen] always posts the player caption (caption argument 9, or 10 when player 2 is up); in the demo it posts only the default caption. If ROUND_ARMED is set, it also posts command 7, which draws the round number as two digits through drawRoundNumberCaption [seen]. The intro flight flyRoundIntroFlashingEraYearThenEraseIntroCaptions [seen] clears the flag when its delay runs out. So a restart after a death gets the default caption and no round number. When a turn begins, loadActivePlayerContextAndPostRoundHud [seen] also posts command 6 with ROUND_NUMBER. drawCountAsPictogramStrip [seen] renders that value as a strip of denomination blocks (thirties, tens, fives and ones, drawn smallest first from COUNT_PICTOGRAM_STRIP_START 0xa463), clamped at 99. The two-digit caption draws nothing once the round reaches 100. ROUND_NUMBER is a single byte that nothing caps. Following the code, round 256 would read as 0 and fall back into the first rung bracket. That consequence has not been observed.

Dying after the Mother-Ship is down still advances the round. loseLifeAndHandOver calls startNextRound itself whenever ROUND_TRANSITION_HOLD is set at the moment of death, before it saves the context. The player who lost that life therefore resumes in the next era.

### The two-player context: sixteen bytes in, sixteen bytes out

The live context is the sixteen bytes from LIVES_REMAINING 0xad00 through 0xad0f. The named fields are:

- LIVES_REMAINING 0xad00
- ROUND_NUMBER 0xad01
- KILLS_REMAINING 0xad02
- BONUS_LIFE_LATCH 0xad03
- ERA_INDEX 0xad04
- the three life-tick places 0xad05–0xad07
- START_RUNG 0xad0a
- PEN_GLYPH 0xad0b and PEN_COLOUR 0xad0c (the caption pen) [seen]
- MOTHER_SHIP_ARMED 0xad0d
- ROUND_ARMED 0xad0e

Each player has a save slot with the same layout: PLAYER_ONE_LIVES 0xad10 onward (for example PLAYER_ONE_ROUND_NUMBER 0xad11, PLAYER_ONE_KILLS_REMAINING 0xad12, PLAYER_ONE_START_RUNG 0xad1a [seen]) and PLAYER_TWO_LIVES 0xad20 onward [seen]. ACTIVE_PLAYER picks the slot. The block is saved in exactly two places, on every life lost (loseLifeAndHandOver) and on every round won (advanceRoundWhenFieldCleared). It is restored only by loadActivePlayerContextAndPostRoundHud. That routine is sub-step 3 of the round engine, and the last step of the round-won animation (sub-step 14) also calls it directly before reseating sub-step 3, so a won round restores the block and posts the HUD commands twice. loadActivePlayerContextAndPostRoundHud copies the saved block into the live one and, in play, posts the round number (command 6) and the reserve ships (command 5).

The context is armed once per game by armRoundStartThenStepSequence [seen], sub-step 0. In play it zeroes both scores and posts the award-0 label repaint. It fills both slots' kill counts from KILL_QUOTA, sets both round numbers and ROUND_ARMED flags to 1, zeroes both eras, bonus latches and Mother-Ship flags along with ACTIVE_PLAYER, zeroes both slots' middle and high tick places, and seeds both starting rungs from the first bracket of the freshly loaded difficulty record. Because the kill count lives in the context and the playfield reset never touches it, **a player's progress toward the Mother-Ship survives both a death and the other player's turn**. MOTHER_SHIP_ARMED, the parachutist step and the life tick counter, by contrast, are reset with the playfield on every life.

Losing a life is one step of loseLifeAndHandOver. It hides the sprites, advances the round if the transition hold is set, queues the transition sounds, decrements LIVES_REMAINING, and copies the block into the active player's slot. If the count is now zero it goes to game over. Otherwise, if the other player's saved lives are non-zero, it flips ACTIVE_PLAYER, so a player alone in the game, or whose opponent is out, simply keeps the turn. In either case it sets SEQUENCE_DELAY 0xa9eb [seen] to 90 and reseats the sub-step from HANDOVER_SUBSTEP_SEED 0x4b52 (1). The round engine then replays its opening steps and restores whichever context ACTIVE_PLAYER now selects.

### Game over, the high-score table, and the end of the ladder

When the last life goes, postGameOverBanner [seen] queues the player caption (argument 9 or 10) and the GAME OVER caption, sets SEQUENCE_DELAY to 180, and steps the sub-step to 8. The same routine, reached with play inactive, restarts attract instead.

Sub-step 8, fileScoreAfterGameOverHoldElsePassTurn [seen], counts that delay down. When it expires it tries to file the finished score with fileScoreIntoHighScoreTable [seen]. The board is five eight-byte records starting at HIGH_SCORE_TABLE_BASE 0xab08 [seen]. Each record holds a rank byte at +0, the score from low to high byte at +1..+3, and three initials at +4..+6. At boot loadDefaultHighScores [seen] copies it from DEFAULT_HIGH_SCORE_TABLE 0x4bb1, whose defaults read 10,000 / 8,800 / 8,460 / 6,520 / 4,300. The filer compares the active player's score, from its top byte downward, against each record in turn from the top (HIGH_SCORE_REC0_SCORE_HI 0xab0b), using isScoreBelow [seen]. It stops at the first record the score is **not below**, so a tie takes the slot above the standing entry. The records beneath slide down one place and the bottom one falls off. The new score is written in with its three name cells blanked. SCRATCH_PTR_A 0xa991 [seen] is left pointing at the record's name cells, and SCRATCH_PTR_B 0xa993 [seen] at the on-screen initials cell for that rank (HIGH_SCORE_INITIALS_CELL_BASE 0xa531 [seen] plus twice the rank). The ranks are then renumbered 0–4. This five-record board is separate from the single displayed high score at HIGH_SCORE_HI. That cell is seeded at boot from DEFAULT_HIGH_SCORE_HI 0x08c9 (a top byte of 01, i.e. 10,000) and promoted live by awardScoreToPlayer.

If the score beats no record, sub-step 8 erases the two banner captions (command 3 with arguments 9 and 11), seats the sub-step from SKIP_INITIALS_SUBSTEP_SEED 0x0843 (11) [seen], and decides the turn at once. If the score was filed, requestHighScoreFiledSound [seen] requests a sound (HIGH_SCORE_FILED_SOUND_CODE 0x18FA [seen], a program byte, only while a game is being played), the caption pen is set to the blanking glyph, and the pen route begins. Sub-step 9, erasePenRouteThenOpenInitialsEntry [seen], draws that route until it finishes. It then posts the table's captions, paints the five records with paintFiveLabelledNumericReadouts [seen], clears the press histories and INITIALS_LETTER_INDEX 0xa999, sets INITIALS_SLOTS_LEFT 0xa99a to 3 [seen], and shows the first letter at the cursor.

Sub-step 10, stepHighScoreInitialsEntry [seen], is the entry itself. On even frames it rolls four control bits into press histories. A fresh press of either commit control locks the shown letter into both the screen cell and the record, then moves on; after three letters the entry is finished. A fresh press of the forward or back control steps the letter round a 27-glyph ring, and a held control auto-repeats once its history saturates. On odd frames the cursor cell flashes. Every eighth frame the entry clock in SEQUENCE_DELAY ticks down, and when it runs out the cursor cell is blanked and the entry ends as well. The clock is not reloaded when entry opens. It carries over the zero that the game-over hold (sub-step 8) counted down to, so its first tick wraps it to 255, giving 256 ticks of the eighth-frame clock before entry times out. Finishing sets SEQUENCE_DELAY to 60 and steps to sub-step 11, loc_12e2 [seen], which counts those 60 frames. While the entry is running, a start press begins a new game immediately, but only if both saved lives counts are zero. On free play any start press counts; otherwise at least one credit is needed, and with exactly one credit only the one-player start works.

Every path out of game over, apart from a new game started during initials entry, ends in passTurnToOtherPlayerIfLivesElseStepSequence [seen]. If the other player's saved lives count is non-zero, handPlayOverToOtherPlayer [seen] flips ACTIVE_PLAYER, sets the 90-frame delay and reseats the sub-step at 1, and the survivor plays on alone, with their own era, round, rung and kill progress intact. If the count is zero, the sub-step steps to 12, restartAttractSequence [seen]. That routine clears PLAY_ACTIVE, the sub-step and ACTIVE_PLAYER, and sets SEQUENCE_PHASE 0xa9ab [seen] from ATTRACT_SEQUENCE_START_PHASE 0x16d3 (1, the attract sequence). Here the ladder does end: the game has no final era and no win. It stops only when both context blocks have run out of lives.

## §8 The character plane: text, the meter, and routines nothing reaches

Everything on Time Pilot's screen that is not a sprite is a cell of one 32×32 tilemap. The tile code is in the video plane, which starts at CHAR_PLANE_BASE 0xA400. The attribute byte is in the colour plane at COLOUR_PLANE_BASE 0xA000, exactly 0x400 below it. Every painter in this section that sets colour links the two planes through bit 10 of the address. The text and HUD painters write the glyph at a video-plane address, clear bit 10 of that address, and write the colour there. The shot-cell painter works the other way round: it starts from a colour-plane address and sets bit 10 to reach the glyph. The erasers, the kill meter and the band drawers write glyphs only. The attribute byte does more than set colour. Its low five bits choose one of 32 palettes. Bit 4 puts the cell in the category the board draws *over* the sprites rather than under them. Bit 5 selects the second 256-tile bank. Bit 6 mirrors the tile horizontally and bit 7 vertically. Only native rows 2 to 29 of the plane are visible, so row 0 (0xA400–0xA41F) can hold data that is never seen. The between-eras band uses it that way (see below).

The game is rotated on the glass, so a line of text does not run along a native row. It runs through successive native rows at a fixed column. advanceCharCursor [seen] (RST 0x20) moves the text cursor to the next character by subtracting 32, and retreatCharCursor [seen] (RST 0x28) steps back one by adding 32. Every caption, readout and meter below advances this way, so "the next cell along the line" always means 32 bytes lower in memory.

### Caption records

The game's fixed text lives in caption records reached through the word table CAPTION_RECORD_TABLE 0x0C50, indexed by caption number through fetchWideTableWord [seen]. A record is a start cell (a word, in the video plane), one colour byte, and a run of glyph codes ended by the byte 0xB9. drawTextRun [seen] walks the run: glyph into the video plane, colour into the colour plane, cursor advanced. It stops on 0xB9 and leaves the cursor one cell past the last glyph. Four entry points put a record on the screen:

- drawTextRunByIndex [seen] uses the colour stored in the record.
- drawCaptionInPenColour [seen] ignores the stored colour and uses the low nibble of PEN_COLOUR 0xAD0C [seen].
- drawCaptionFivePastSharedColour [seen] uses the pen colour plus 5, masked to a nibble.
- drawCaptionTenPastSharedColour [seen] uses the pen colour plus 10, masked to a nibble.

eraseTextRunByIndex [seen] walks the same record but writes the blank glyph 0xF1 into each of its cells and leaves the colour plane alone. Because it measures the run from the record, erasing one record blanks any other record of the same length at the same cell.

The records are not stored together. Their addresses are scattered through the program image, and several of them lie inside code (see the last subsection). Glyph codes are not ASCII. The digit table DIGIT_GLYPH_TABLE 0x0DCC maps 0–9 to 0x13, 0x96, 0x9B, 0xCD, 0xF3, 0x7F, 0x65, 0x02, 0x17, 0x5D. The letters can be decoded by requiring the texts to read consistently. Decoded that way, the table holds:

- **Record 0:** the copyright line, "© KONAMI 1982", in colour 0x10. **Record 31** is the same line in colour 0x05.
- **Attract and credit texts:** "PLAY", "READY", "PLEASE DEPOSIT COIN" / "AND TRY THIS GAME", "HI-SCORE", "1-UP", "2-UP", "CREDIT", "FREE PLAY", "PUSH START BUTTON", "ONE PLAYER ONLY" and "ONE OR TWO PLAYERS".
- **Two bonus-life caption pairs:** "1ST BONUS 10000 PTS." / "AND EVERY 50000 PTS." and the 20000/60000 pair. postAttractInfoCaptions [seen] picks the pair from BONUS_LIFE_SETTING 0xA9C3 [seen].
- **Play texts:** "PLAYER 1", "PLAYER 2", "GAME OVER", "INPUT YOUR INITIALS !", "SCORE RANKING TABLE" and "STAGE" followed by three blanks.
- **Records 26–30:** the five era years, each seven cells long and starting at the same cell 0xA673.
- **Records 20 and 21:** a pair drawn in colour 0x32. Bit 5 sends their codes to the second tile bank, so they are pictures, not letters.
- **Record 24:** starts with its terminator, so it draws nothing.

The copyright line holds a counterintuitive fact. COPYRIGHT_CAPTION_RECORD 0x086B [seen] is also data for other parts of the machine. Its "M" glyph, 0x38 at 0x0874, is DEFAULT_KILL_QUOTA: seedGameConfigFromDipSwitches copies that byte into KILL_QUOTA 0xA9CD [seen], and 0x38 is the 56 kills an era demands.

### Pens: the colour of the era

PEN_COLOUR 0xAD0C [seen] and PEN_GLYPH 0xAD0B [seen] are the pen pair in the active player's context. Each player keeps a saved copy: PLAYER_ONE_PEN_GLYPH 0xAD1B [seen] / PLAYER_ONE_PEN_COLOUR 0xAD1C [seen], and PLAYER_TWO_PEN_GLYPH 0xAD2B [seen] / PLAYER_TWO_PEN_COLOUR 0xAD2C [seen].

Both setSavedPenFromEra [seen] and seatCaptionPenFromEraFoldingTamperIntoPhase [seen] load the pair from ERA_PEN_TABLE 0x0F8D, two bytes per era, indexed by the player's era. The first five entries are glyph 0xF1 with colours 1, 2, 3, 4 and 5, so the pen colour is simply the era number plus one. The seat routine writes the live pen as well as the saved copy.

So any caption drawn "in pen colour" changes colour from era to era. Those captions are PLAYER n and READY at round start, GAME OVER, and the flashing era year. Masking to the low nibble also clears bit 4, so pen-coloured captions always sit in the under-sprite category. Most record colours (0x10, 0x11, 0x13, 0x14, and 0x32 for records 20/21) have bit 4 set and draw over the sprites. Record 31, the copyright line's flash partner, is colour 0x05, so it sits under them.

The same pair drives the attract pen plotter: plotPenCell [seen] stamps PEN_GLYPH into a video cell and PEN_COLOUR into its colour cell. erasePenRouteThenAdvanceStep [seen] turns that plotter into an eraser by setting the glyph to 0xF1 and the colour to 5.

### The command ring

Most text is not drawn by the code that decides to show it. The sequence arms run inside the vertical-blank service. Instead of drawing, they post a two-byte request into COMMAND_RING 0xAC00 [seen], a 64-byte ring of command/argument pairs. The foreground loop does the drawing.

**Posting.** postCommand [seen] is RST 0x38. It looks at the pair under COMMAND_WRITE_CURSOR 0xA9B2 [seen]. If that cell's high bit is set, the slot is free: it stores the command and argument and steps the cursor two on, modulo 64. If the slot is still occupied, the request is silently dropped. The ring is only ever marked free by the byte 0xFF: initColdStartRamThenSeedConfig [seen] fills all 64 cells with it at cold start. Every handler the ring reaches draws text or HUD, or adds score; sound requests travel through a separate queue (§2, The sound queue).

**Draining.** enableInterruptAndEnterForegroundLoop [seen] enables NMI, kicks the watchdog and falls into runCommandRingDrainLoop [seen]. The machine then stays in that loop for the rest of the time the game runs (enterCommandRingDrain [seen] at 0x0B90 is the loop's own back-edge). The loop reads the cell at COMMAND_READ_CURSOR 0xA9B3 [seen]. If the cell's high bit is set it spins. Otherwise it takes the command and argument, restores 0xFF to both cells, and wraps the read cursor within the ring. It then dispatches on the command's low nibble through the sixteen-word table at 0x0BBC, and the handler it reaches acts on the argument. Each handler returns to the top of the loop.

**The table.** It routes:

| Command | Handler | What it does |
|---|---|---|
| 1 | drawTextRunByIndex [seen] | caption in its own colour |
| 2 | drawCaptionInPenColour [seen] | caption in pen colour |
| 3 | eraseTextRunByIndex [seen] | erase a caption |
| 4 | awardScoreToPlayer [seen] | add score |
| 5 | drawEmblemStripThenGuardImage [seen] | reserve-ship emblems |
| 6 | drawCountAsPictogramStrip [seen] | stage pictograms |
| 7 | drawRoundNumberCaption [seen] | "STAGE nn" |
| 10 | drawCaptionFivePastSharedColour [seen] | caption, pen colour + 5 |
| 11 | drawCaptionTenPastSharedColour [seen] | caption, pen colour + 10 |

Commands 8, 9 and 12–15 all point at 0x0BDC, which is a single RET byte. Taking one of them only consumes the pair. Command 0 points at 0x0BDD, the byte after that RET; see the last subsection.

**Who posts what.** The attract screens post their layout as a burst of command-1 captions (buildCopyrightScreenThenVerifyImage [seen], postAttractInfoCaptions [seen], armAttractScreenShowingHighScore [seen], showCreditLine [seen], stepCopyrightScreenAwaitingStart [seen]). holdCopyrightThenEraseTheCoinInvitation [seen] erases the coin invitation pair with command 3.

The copyright line flashes through the ring. flashCopyrightLine [seen] alternates by FRAME_TICK 0xA980 [seen] parity:
- on odd ticks it posts record 0 (colour 0x10);
- on even ticks it calls enqueueFixedCommandOnRing [seen], which posts record 31 (colour 0x05).

checkTheCopyrightLineColoursOrDerail [seen] later insists that each of the line's thirteen colour cells holds exactly one of those two colours.

At round start, postRoundStartCaptionsAndResetPlayfield [seen] posts:
- in the attract demo, READY in pen colour;
- in a real game, PLAYER 1 or PLAYER 2 in pen colour, then either READY or, when ROUND_ARMED 0xAD0E [seen] is set, command 7's stage number.

flyRoundIntroFlashingEraYearThenEraseIntroCaptions [seen] flashes the era year while ROUND_ARMED is set. On frame-tick low nibbles 0, 5 and 10 it posts commands 2, 10 and 11 in turn with argument 0x1A + ERA_INDEX 0xAD04 [seen], cycling the year through three colours. When SEQUENCE_DELAY 0xA9EB [seen] runs out it posts three erases: PLAYER 1, STAGE, and year record 0x1A, which blanks whichever year is showing because all five share a cell and a length.

postGameOverBanner [seen] posts PLAYER n in pen colour and GAME OVER at pen + 5.

### The HUD strips the ring paints

**Score (command 4).** awardScoreToPlayer [seen] does nothing unless PLAY_ACTIVE 0xAD30 [seen] is set. A non-zero argument indexes three packed-decimal bytes in SCORE_AWARD_TABLE 0x0D27. They are added into the active player's score and that player's readout is repainted. If the new score beats the high score, the high score is copied over and its readout is repainted as well. Argument 0 is a full repaint:
- two-player game (TWO_PLAYER_GAME 0xAD31 [seen]): both "UP" labels and both scores;
- one-player game: 1-UP and its score, "2-UP" erased, and the six digit cells at 0xA501 blanked.

**Reserve ships (command 5).** Command 5 carries the number of reserve ships. loadActivePlayerContextAndPostRoundHud [seen] posts LIVES_REMAINING 0xAD00 [seen] minus one. awardBonusLifeAtScoreMark [seen] posts the pre-increment count, which is the same figure after the bump. drawEmblemStripThenGuardImage [seen] stamps up to six 2×2 emblem blocks with stampTwoByTwoTileBlock [seen] (tiles 9–12, colour 0x18), starting at EMBLEM_STRIP_TOP 0xA783 and advancing along the line. It then blanks with glyph 0xF1, colour 0x10, down to EMBLEM_STRIP_FLOOR 0xA623.

**Stage pictograms (command 6).** drawCountAsPictogramStrip [seen] draws a count, capped at 99, as tally marks from COUNT_PICTOGRAM_STRIP_START 0xA463, moving the other way. It breaks the count into thirties and tens (four-tile blocks), fives (two-tile) and ones (single glyph 0x01). It draws the ones first and the thirties last, then blanks up to the same floor 0xA623. The two strips share one two-cell-wide band and grow toward each other from opposite ends. The HUD load posts ROUND_NUMBER 0xAD01 [seen] here; the high-score attract screen posts 1.

**Stage number (command 7).** drawRoundNumberCaption [seen] draws the "STAGE" record in pen colour and backs the cursor up two cells. It paints ROUND_NUMBER in pen colour as two digits into the last two of the record's three trailing blanks. A leading zero is dropped and a trailing zero always shows. A stage number of 100 or more is not drawn at all.

Each of these three HUD painters ends by checking a span of the program image. The anti-tamper section covers what happens on a mismatch.

### The kill meter

drawKillMeter [seen] is not a ring command. serviceRoundThenResolvePlayerState [seen] calls it directly on every pass of the round engine, and postRoundStartCaptionsAndResetPlayfield [seen] calls it once at round start.

It indexes KILL_METER_GLYPH_ROW_TABLE 0x087C with ten times ERA_INDEX, so each era has its own ten-byte row:
- two bar glyphs;
- eight end glyphs, of which entries 0 and 4 are the blank 0xF1 in every era's row.

From KILLS_REMAINING 0xAD02 [seen] it draws one cell per four kills still owed, taking bits 2 to 6 of the count, so the bar is at most 31 cells and a count of 128 or more wraps. Cells start at KILL_METER_BAR_START_CELL 0xA79F, advance along the line, and alternate between the two bar glyphs. After the full cells it writes the end glyph selected by the count's low three bits, and caps the run with one 0xF1.

Bit 2 of the count is also the parity of the full-cell count. So the end glyph comes from the half of the row that matches the bar glyph it continues, and its remaining two bits show the leftover 1–3 kills as a partial cell. With the default quota of 56 the bar starts fourteen cells long and shrinks toward the start cell as kills are made. It shows kills still owed before the Mother-Ship, as gameplay.md's "progress bar" suggests.

Two consequences of the code:
- Only the one cell past the end is blanked, so the meter depends on being redrawn often enough that it never shrinks by more than a cell between draws.
- drawKillMeter writes glyphs only. The meter's colour comes from blankFourteenCharCells [seen], which loadActivePlayerContextAndPostRoundHud [seen] runs first: fourteen 0xF1 cells in colour 0x16 from the same start cell.

### Wipes

armLineWipeFromFifthLine [seen] seats BLANK_LINE_CURSOR 0xA989 [seen] at BLANK_LINE_START_CELL 0xA404 (native column 4 of row 0). It loads BLANK_LINES_LEFT 0xA988 [seen] from the ROM byte BLANK_LINES_COUNT 0x0CCD, which is 27.

Each call of blankNextLine [seen] blanks one whole line: 32 cells stepping +32 through every native row, glyph 0xF1 in colour 0x10. It then moves the cursor one cell over (not 32) to the next line and counts down, returning true only when the count reaches zero. Its callers return early until then (armAttractScreenShowingHighScore [seen] is one), so a wipe costs one line per call and is spread over successive calls.

### Deferred cell lists: player shots on the character plane

Player shots are not sprites. fireAndSweepPlayerShots [seen] calls queueTileStampForObject [seen] for each live slot of PLAYER_SHOT_ARRAY 0xAA80 [seen].

queueTileStampForObject turns the shot's two position bytes, each biased by 7, into:
- a cell address in the colour plane;
- an 8×8 sub-cell phase that selects one of 64 pre-shifted records at PRESHIFTED_TILE_RECORD_TABLE 0x53D4.

Each record gives four glyph/attribute pairs for a 2×2 block of cells. The routine appends a four-byte entry for every non-zero glyph: colour-cell address low, address high, glyph, attribute. The entry goes to the list at DEFERRED_WRITE_LIST 0xAE04 [seen] at DEFERRED_WRITE_CURSOR 0xAE00 [seen]. The cursor steps within its own page 0xAE00–0xAEFF, so an overfull list first runs into the blank list at 0xAE80 and then wraps onto its own header. The walkers also mask the entry count to 31.

The vertical-blank service runs drainBothDeferredCellLists [seen] once per frame, right after the sprite shadow is published. The drain works in three steps:

1. **Blank last frame's cells.** blankCellsPaintedLastPass [seen] walks DEFERRED_BLANK_LIST 0xAE84 [seen]. It masks the top bit off DEFERRED_BLANK_CURSOR 0xAE80 [seen] to count the entries, then writes glyph 0x20 into the video plane at each entry's address. Note that this blank is 0x20, not the 0xF1 that text uses.
2. **Paint this frame's cells.** paintDeferredCells [seen] writes each entry's glyph into the video plane. It writes the entry's attribute into the colour plane with the low nibble of PEN_COLOUR added, so shots take the era's tint.
3. **Hand over.** If the paint list was empty, emptyBothDeferredCellLists [seen] resets both cursors to their list heads. Otherwise the whole paint list, header included, is copied onto the blank list, and the blank cursor is set to the paint cursor's low byte plus 0x80. The paint cursor is then reset so the next frame starts an empty list.

So every shot cell painted on one frame is blanked on the next unless it is queued again. Both the blank and the paint skip any cell whose current colour byte already has bit 4 set. That protects over-sprite HUD and caption cells from being overwritten or erased by a passing shot.

One edge exists in the code: the copy length is the paint cursor's low byte, and a list that had wrapped exactly to low byte 0 would make that copy run through the whole address space. emptyBothDeferredCellLists [seen] also runs at cold start.

### The scripted band between eras

When a round is won, armRoundWonBandAnimationThenStepSequence [seen] stocks the nine-byte control block at INTRO_ANIMATION_STEP 0xA9F0 [seen] (0xA9F0–0xA9F8), leaving 0xA9F5 untouched:
- step 0, read from INTRO_ANIMATION_STEP_SEED 0x3213 [seen];
- PLAYER_FLASH_TICK 0xA9F1 [seen] = 0;
- BAND_TO2_PASS_COUNTDOWN 0xA9F2 [seen] = 0xFF;
- SPRITE_COLOUR_CYCLE_COUNTDOWN 0xA9F3 [seen] = 4;
- BAND_TO4_PASS_COUNTDOWN 0xA9F4 [seen] = 0xFF;
- COLOUR_FLOOD_COUNTDOWN 0xA9F6 [seen] = 8;
- BAND_SCRIPT_CURSOR 0xA9F7 [seen] = BAND_SCRIPT_START 0x56F1.

It then does two things to the character plane.

First, it fills the invisible row 0 at CHAR_PLANE_BASE with a 32-byte saved picture: thirteen 0x14 glyphs, two 0x00, thirteen more 0x14, and four 0x0E.

Second, it colours the cells that picture belongs to. The 28 visible cells of native column 0x11, from CHAR_PLANE_COLUMN_BASE 0xA451 (row 2) to CHAR_PLANE_LOWER_RUN_BOTTOM 0xA7B1 (row 29), form a line across the screen. names.js gives the on-glass mapping as display_y = native_x. The line is made of three parts:
- an upper run of thirteen, ending at CHAR_PLANE_UPPER_RUN_BOTTOM 0xA5D1;
- two centre cells, CHAR_PLANE_COLUMN_MID_TOP 0xA5F1 and CHAR_PLANE_COLUMN_MID_BOTTOM 0xA611;
- a lower run of thirteen, starting at CHAR_PLANE_LOWER_RUN_TOP 0xA631.

Beside the centre sit four stub cells, in native columns 0x10 and 0x12 of rows 15 and 16. On the glass the line is the horizontal streak through the centre of the screen at display_y 136-143, where the player's jet sits, and the four stubs are the corners of a diamond-shaped bulge on that streak around the jet: CHAR_PLANE_STUB_UPPER_RIGHT 0xA5F0 [seen] above the streak and right of centre, CHAR_PLANE_STUB_UPPER_LEFT 0xA610 [seen] above it and left, CHAR_PLANE_STUB_LOWER_RIGHT 0xA5F2 [seen] below it and right, and CHAR_PLANE_STUB_LOWER_LEFT 0xA612 [seen] below it and left. So native column 0x10 is the row of tiles above the streak and column 0x12 the row below it, while native row 15 is the right-hand tile of each pair and row 16 the left. The band always gives all four the same glyph, and their colour bytes differ only in the two top bits, so the one tile shape is drawn mirrored into the four corners.

The colouring uses fillCellRun [seen], which fills thirteen cells stepping −32:
- upper run: 0x20 + pen;
- lower run: 0xA0 + pen, so the lower half is the vertical mirror of the upper, both in the second tile bank;
- column-0x10 stubs and the centre pair: 0xA0/0x20 + pen;
- column-0x12 stubs: 0xE0/0x60 + pen, which adds the horizontal mirror.

The second half of this work, from the fifteenth row-0 byte (the second 0x00) onward, is also a separate entry at 0x4A42, paintCaptionColourBandAndStepSequence [seen]. Starting one cell past the caller's cursor, it writes a caller-supplied head byte, thirteen caller-supplied body bytes and the four 0x0E bytes, and then does all of the colouring. On a genuine image it runs only as this routine's fall-through. The saved pen is then refreshed from the era.

**The dispatcher.** stepRoundStartIntroAnimation [seen] runs only on frames where FRAME_TICK bit 1 is clear. It dispatches on INTRO_ANIMATION_STEP:
- 0: the player flash;
- 1: the flash plus advanceScriptedCharPlaneBandTo2 [seen];
- 2: the sprite colour cycle plus advanceScriptedCharPlaneBandTo4 [seen];
- 3: band-to-4 alone;
- 4: floodColourPlaneWithSavedPlayerColour [seen];
- 5: sets the sequence delay, hides the sprites, reloads the player context and posts the HUD (above), and reloads the sub-step.

**The band drawers.** Both drawers alternate on bit 0 of their pass countdown.

On an even count they blank both thirteen-cell runs, the two centre cells and the four stubs to 0xF1, so the band blinks.

On an odd count they make a drawing pass:
1. restoreColumnFromSavedRun [seen] copies row 0's saved picture back onto the column and the four stubs.
2. They edit it under the script. Where a script byte is non-zero, stepThirteenScriptedGlyphCells [seen] bumps that cell's glyph code by one, walking thirteen cells up or down with the script cursor moving forward or back.
3. gatherCharColumnIntoBackingRun [seen] saves the edited picture back into row 0.

Band-to-2 moves forward and adds one per flag. Each pass it reads a stub bit (all four stubs step together), a centre bit (both centre cells), then thirteen flags applied outward from the centre along the upper run. It rewinds the cursor thirteen and applies the same thirteen flags outward along the lower run. The two halves therefore change as mirror images, from the centre toward both ends.

The script at 0x56F1 is 255 bytes of 0 and 1 between 0xFF sentinels at 0x56F0 and 0x57F0. Band-to-2 uses fifteen bytes per pass, so it makes exactly seventeen drawing passes. It then hits the upper sentinel, zeroes its countdown, sets step 2 and backs the cursor up one.

Band-to-4 replays the same bytes in reverse and subtracts one per flag. The glyphs walk back to where they started. It stops on any byte that is neither 0 nor 1, which is the lower sentinel. It then sets step 4 and asks for requestInterRoundSoundPair [seen].

The colour cycle (cyclePlayerSpriteColourThenAdvanceStepAtZero [seen]) runs alongside band-to-4 and sets step 3 when its own countdown ends. The flood then paints a 27×28 rectangle of the colour plane from COLOUR_FLOOD_FIRST_CELL 0xA044 in the active player's saved pen colour. It walks the rectangle backwards when SCREEN_UNFLIPPED 0xA987 [seen] is zero.

What the band's tile codes look like on the glass is not stated by the code (open).

### Bytes that are text and code at once, and routines nothing reaches

The ring's slot-0 handler at 0x0BDD is a complete routine that nothing reaches. It looks up a caption record and writes its glyphs into the video plane without touching the colour plane: a "redraw text in the colours already there" drawer. It sits immediately after the one RET byte that slots 8, 9 and 12–15 share. None of the ring's posters posts command 0; the posted commands are 1–7, 10 and 11. So the handler is present, wired into the table, and dead. Its bytes are still read, because IMAGE_GUARD_BLOCK_0BDD_BASE 0x0BDD starts a checksummed span. Caption record 24 is similar: it is present and empty, and no poster found in the code asks for it.

Several caption records share their bytes with instruction streams that only a failed anti-tamper guard ever enters. On a genuine image each of these is text, and runs as code only on a failed guard:

- **Record 9 ("PLAYER 1") at 0x0167** is loc_0167 [code]. armWholePlaneWipeThenDerailOnATamperedImage [seen] calls it only when its image total misses.
- **Record 2 ("READY") at 0x307F** is loc_307f [code]. Its start-cell bytes 0x73 0xA6 decode as `ld (hl),e / and (hl)`. It is entered only through trampolineToLoc_307f [code], which seedSceneryEntriesThenRunScenery [seen] takes when TAMPER_WITNESS 0xAD39 [seen] does not hold its planted glyph and colour.
- **Record 4 ("AND TRY THIS GAME") at 0x49FA** is where checkTheCopyrightLineColoursOrDerail [seen] derails. Its own bytes end in a `jr c` to the band-colouring entry 0x4A42 that cannot fire, because the preceding `and l` clears carry.
- **Record 17 at 0x459B** is the entry stepMotherShipWarpFlashFrame [code]. loc_43f0 and paintReadoutsThenSampleWitnessOrDerail [seen] transfer there only on a failed witness or glyph check. Run as code, it pops its caller's return slot and misaligns the stack.
- **Record 8 ("CREDIT") at 0x15CA** is also an instruction stream that names.js gives no entry of its own. holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail [seen] jumps there only when the glyph it samples is not 0x3B.
- **The era pen table ERA_PEN_TABLE 0x0F8D** doubles as loc_0f8d [code], the trap advanceSequenceUnlessImageTampered [seen] springs on a checksum mismatch.

A patched text or pen table therefore changes code, and a patched routine changes text. The anti-tamper section covers how the guards use this.

---

## §9 What is still open

These are the questions the routines do not settle on their own, grouped by the part of the machine they belong to. Where it is known, each says what would close it.

### The frame and the sequence

- The starting-lives setting that folds to 6 is stored in STARTING_LIVES as 0xFF, where gameplay.md says '256'. In code each lost life takes one off LIVES_REMAINING and the game ends at zero, so 0xFF plays as 255 lives, except that a bonus life awarded while the byte reads 0xFF adds one and wraps it to 0. Neither has been watched in play, and nor has how the lives HUD shows the count beyond the six-emblem clamp. A MAME run on that setting, losing lives and watching LIVES_REMAINING and the emblem strip, would close both.
- DIP1_MIRROR (0xA9AD) is re-latched every frame and nothing uses it. Across every MAME full-span read-tap capture, the only read of 0xA9AD is the power-on wipe's ldir at 0x0091. What remains open is only whether a path none of the captures ran, such as the service switch held at boot, reads it. A read tap on such a run would close it.
- COINAGE_SETTINGS is refreshed every frame, but the coin ratios are unpacked only at power-on. So a coinage switch changed while the machine runs should have no effect until reset. This is a code reading. Changing the switch mid-run under MAME and inserting coins would confirm it.
- How long phase-1 steps 4 and 6 hold when the attract cycle restarts after the demo is open. SEQUENCE_DELAY's value on arrival from phase 3 is not traced. After power-on they hold 256 frames each.
- Edge case, code reading only: if a credit is banked on the same frame phase-1 step 12 runs, the phase-1 tail steps the phase from 3 to 4. Its low two bits then select phase 0, which re-runs the whole-plane wipe, then goes to phase 1, step 2, then phase 2. It has not been observed. A MAME run injecting a coin on that frame would show it.
- setUpTwoPlayerStartObjectOnce acts only when TAMPER_GLYPH_COPY disagrees with the glyph at 0xA67C. Under MAME it runs on each captured two-player start, and each time both cells hold 0x7C, so it returns without acting. Whether any genuine run makes the two cells disagree is open, and so are the counter and the slot its acting arm would act on. A MAME run that takes its jump at 0x4617 into the acting arm would close both.
- The default high-score values (10,000 / 8,800 / 8,460 / 6,520 / 4,300) are decoded from DEFAULT_HIGH_SCORE_TABLE 0x4BB1 using the record layout names.js gives at [seen] (rank, then score lo/mid/hi). They have not been read off the high-score screen. Each default record also carries three initials at +4..+6 (0x7C/0x11/0x68, 0x3B/0x11/0xA5, 0x38/0x11/0xFD, 0x68/0x11/0x68, 0xBF/0x11/0xA5), and several match the glyph values the tamper witnesses test for. The witness cells are not painted from these records. Under MAME their writers are the power-on wipe, the attract screen's patch list and copies taken from character cells. The patch list is HIGH_SCORE_PATCH_TABLE 0x163F, six address/value triples that armAttractScreenShowingHighScore [seen] walks, writing each value and then colour 0x05 into the cell after it. It writes 0x68 into TAMPER_WITNESS, 0x7C into TAMPER_GLYPH_COPY, 0xA5 into TAMPER_GLYPH_STRIP, 0xFD into TAMPER_GLYPH_READBACK, 0x3B into TAMPER_GLYPH_KONAMI and 0x38 into LINE_WIPE_SAMPLE_RECORD. The copies carry the same glyphs because the copyright caption (COPYRIGHT_CAPTION_RECORD) paints them into the source cells. The matching values are shared glyph codes, not a copy of the high-score records.

### The round engine and machine-wide services

- The values the map quotes from these ROM tables, program-image constants and hardware cells were read from the ROM image directly; names.js tags each of them [seen] on MAME taps of the code that reads or writes them, not on an on-screen check of the values: SCORE_AWARD_TABLE 0x0D27, BONUS_LIFE_MARK_TABLE_BIT0_CLEAR / _SET 0x4E1B / 0x4E30, PARACHUTIST_BONUS_ARG_TABLE 0x484F, DIFFICULTY_RECORD_TABLE 0x186A, ERA_RUNG_SETTINGS_POINTER_TABLE 0x1B04, DEFAULT_HIGH_SCORE_TABLE 0x4BB1, DEFAULT_KILL_QUOTA 0x0874, DEFAULT_HIGH_SCORE_HI 0x08C9, NEXT_ROUND_START_SUBSTEP 0x4A35, HANDOVER_SUBSTEP_SEED 0x4B52, INTRO_SUBSTEP_RELOAD 0x2750, ATTRACT_SEQUENCE_START_PHASE, SEQUENCE_PHASE_ON_CREDIT, ROUND_TRANSITION_HOLD_SEED, BAND_SCRIPT_START, COLOUR_FLOOD_FIRST_CELL, VIDEO_ENABLE_LATCH, DSW1_PORT, RANDOM_REGISTER_SEED_SOURCE and its guard words, IMAGE_GUARD_BLOCK_0BDD_BASE, TAMPER_CHECKSUM_SPAN_BASE, BOOT_SELFTEST_CHECKSUM_BASE, the three score-readout bases, EMBLEM_STRIP_TOP and COUNT_PICTOGRAM_STRIP_START.
- The pen route's appearance on screen is not established. That is the route phase-1 step 1 erases, phase-3 step 2 traces and step 9 erases; the map describes it only as a route drawn or erased one leg per frame. A MAME snapshot mid-trace would close it.
- The round-won character-plane band animation is described only mechanically (the band script at 0x56F1, the backing row at 0xA400). What it looks like on the glass is not established.
- TAMPER_IMAGE_SIGNATURE's mismatch transfer (jp nz,0x2530 at 0x2735) lands in a data run. The bytes at 0x2530 are a 256-sample velocity table with a peak of 281, which no routine loads as a table. names.js calls it a jump off the genuine path. Where executing those bytes as code actually ends is not established. A MAME run with a patched signature, tracing PCs after 0x2530, would settle it.
- VIDEO_ENABLE_LATCH (0xC308) is an LS259 output, so it takes only data bit 0, with 1 as picture-on (DISPLAY_ON_VALUE is 0x01, DISPLAY_OFF_VALUE 0x00). The genuine checksum folds written into it come to 0x4D and 0x51, both odd. That a patched block turns the picture off is a code-level inference and has not been observed.

### The world

- Scenery objects wrap round the 256-wide byte space and are never retired [seen]. Where on the glass the wrapped pass shows up has not been checked.
- The scenery seed tables hold starting positions, not appearance. seedSceneryEntriesThenRunScenery's own names call the packed bytes 'tint' and 'shape'. names.js describes SCENERY_SEED_TABLE as a (native-Y, native-X) starting-position table [seen], because the bytes land at sprite entry +0x31 and +0x00, the native-Y and native-X coordinates that driftWithWorldScroll moves. ERA4_SCENERY_SEED_TABLE is the same. The routine's local names need re-deriving.
- Which colours and flips the scenery attribute fill bytes select on screen has not been checked: 0xCC in eras 0–3 and 0x28 in era 4.
- ROUND_NUMBER is one byte. After 255 rounds it would wrap, and startNextRound would fall back to the rounds-1–5 start rung. This follows from the code and has not been observed. Poking ROUND_NUMBER to 0xFF under MAME and clearing a round would show it.

### Objects

- Parking value. Every retire and hide path writes 0 into the coordinate bytes. After the upright transform, the bank-1 +0x31 byte comes out as ~(0+14) = 241. Whether coordinate 0 actually puts a sprite off the glass is not established from the code. A MAME snapshot with a parked slot would settle it.
- retireSlotAndSubPixel also zeroes the fractions (+3/+5) and retireSlot does not. Both families respawn through paths that may re-zero the fractions anyway, so whether the difference is ever observable is open.
- The consumer that turns record +14 = 95 (retireEntryPairIntoCooldown) into a Mother-Ship or two-tile respawn delay is not traced, nor the one for +14 = 128 (retireObjectAndHold, releaseHeldObject).
- The formation-bonus wreck is held on screen because driveObjectAppearanceByPhaseBand re-increments its count 7 frames in 8 while stepDyingObjectState decrements it every frame, and the 2,000 award is posted only on a frame where the count reads 1. What the held shape and tint look like on the glass has not been seen. A MAME snapshot during a formation claim would show it.
- In stepDyingObjectState, head values of 0x3C and above, apart from the collision's 0xF0, fly on and count down. For craft, the Mother-Ship's field sweep writes such values, giving the seven craft records the codes 0x3C to 0x78, and MAME shows it writing 0x3C to 0x64 at PC 0x4572. No writer of a craft head value from 0x79 to 0xEF has been found. advanceHitSoakingObjectThenAnimateDeath uses its own 0x61 ladder, on the era-1 object only.
- Which part of the screen or scenery the eight doubled hardware sprites (0–2, 19–23) cover is not established. See also the doubling geometry under *Sweeping and drawing*.

### Sweeping and drawing

- The screen geometry of the doubling is open. The code shows the trade fires once the raster counter at 0xC000 reaches 256 minus the hardware Y byte, and that the second appearance is 128 away in both bytes. Not checked: how that trigger line relates to where the sprite's first appearance is scanned out, and which screen direction the +128 X / −128 Y move goes. A MAME frame capture with a single scenery sprite raised would close both.
- sweepObjectSlotBankByHead (0x3FF9) is the loop head of the era-0 three-slot ballistic bank. serviceEra0BallisticObjectBank (0x3FEA) falls into it whenever ERA_INDEX is 0, and the djnz back-edges at 0x4008/0x400B return to it. What that bank's objects are in gameplay terms is open.
- Slot 1 of the era-object bank (0xA8D0) is not seated directly by either era-1 service. Whether the era-1 bomber's two-tile body uses it has not been checked.
- On-glass identity by era is not established for the four enemy-shot slots (ACTOR_RECORD_SLOT0 run), the era-1 fixed slot 2 and the era-2+ weapon bank: bullets, bombs, missiles or formations. The code settles only who fills them and how their head bytes route. names.js tags ACTOR_RECORD_SLOT0 [seen] on its head-byte traffic under MAME (the slot dispatcher, the launch search, the contact and shot sweeps, the launch claim and retireSlot), which does not show what the slots look like on screen. A MAME snapshot per era would close it.
- The shot's on-screen speed is 3× the ship's velocity, and 4× relative to the world. This is worked out from the launch seed and from the reading that the scroll is the negated ship velocity. MAME has not confirmed it.
- spinRemainingSpriteMultiplexSlots (0x10FD) is [code]: nothing enters it as a subroutine except through an anti-tamper derail. Its bytes are shared: 0x10FD is also the `jr z` inside sprite 19's block of multiplexSpriteSlots, so every closing pass runs 0x10FD onward, which grounds multiplexSpriteSlots and not this entry. The only CALL to it in the image, the CALL NZ at 0x15D9, lies inside caption record 5 (entry 5 of the record table at 0x0C50 points at 0x15D6: destination 0xA660, colour 0x14, then the glyph run `c4 fd 10 ed 77 68 d7 34` up to the 0xB9 terminator). Those glyphs run as code only when holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail finds the glyph at 0xA63C is not 0x3B and takes the `jp nz,0x15CA` at 0x17A6 into record 8, whose decode runs straight on into record 5. grounding-debt.txt carries it as anti-tamper. A PC tap on 0x10FD cannot test this, because the closing pass runs that instruction every time; a fetch of 0x15D9 would.

### The player's ship

- The sounds requested by requestRoundIntroSoundBurst and requestLateEraProgressSound on the explosion's opening frame are not identified. Their names suggest another occasion, but this call site belongs to the explosion. Capturing the sound latch under MAME at that frame, and playing the codes, would identify them.
- Glyph 0xF1, which fills the final explosion strip, is taken to be the plain background tile because it surrounds every other strip. The tile bitmap has not been checked.
- The demo autopilot pairs script to era only because the demo loads player one's context (armRoundStartThenStepSequence zeroes ACTIVE_PLAYER). After boot, or after a real game, the selector is the stale PLAYER_ONE_ERA_INDEX, so the pairing can mismatch then. What the scripts do when they run past their end is also open, because no terminator has been seen.
- These timings are worked out from the bodies and assume the round-engine arm runs once per frame: 12 frames per 45 degrees at 3 steps per frame, 44 frames per reversal, a 180-frame death countdown, about 48 frames of visible explosion, and a shot every 6 frames. None has been measured.
- The demo never flies era 0 (1910) or era 4 (2001), because ATTRACT_STAGE_COUNTER cycles 1 to 3 in armRoundStartThenStepSequence. This agrees with gameplay.md's arcade-history claim but has not been observed.

### Killing and being killed

- The Mother-Ship takes 8 hits in the code, not the manual's 7. armMotherShipOrStep seeds MOTHER_SHIP_HITS_TO_ABSORB (0xA8A4) with 7. The live step absorbs a hit while the counter is non-zero, so the eighth hit kills. No MAME count of hits-to-kill has been taken.
- Chained hit scores climb 100, 200 … 800 and then wrap to 100. The award index is (CHAIN_STEP mod 8)+1 into SCORE_AWARD_TABLE, within a 30-pass window. That contradicts the public 'every enemy 100': only isolated hits pay 100. This rests on the code and the ROM table bytes and has not been checked against a MAME score readout.
- The enemy-shot slots (0xA810–0xA840) are in a shot sweep only in era 4. By the code, craft bullets cannot be shot down in eras 0–3, which contradicts the public 'any bullet shot down 100'. Not checked under MAME.
- In era 1, whatever the bomber launches into ERA_OBJECT_RECORD_SLOT2 (0xA8E0) can only be contact-tested against the player, which pays no score. It can never be shot. Not checked under MAME.
- Era 4 appears to have no formation bonus. spawnEnemyWaveIntoFreeSlots writes +0x0E = 0 and marks craft live with no hold, so countTheKillAndGrantTheSharedToken's top-bit guard never passes. Some other path that sets +0x0E bit 7 on an era-4 craft has not been ruled out.
- The Mother-Ship's field sweep pays 200 points for every 0xFF record from 0xA810 to 0xA8F0. By the code that includes enemy shots and era weapons. A flying bomber also pays its 1,500, and a live parachutist is pushed into its award sequence and paid its rung award. gameplay.md's question 4 ('the Mother-Ship kill sweeps the remaining craft') fits this reading. None of these side effects has been observed. A MAME score readout across a Mother-Ship kill with a known field would confirm it.
- CHAIN_WINDOW (30) and how long the formation token stays displayed are counted in service-list passes, not frames. The real-time length of the chain window is open.
- The formation bonus needs every held-then-released member to die before WAVE_CLAIM_TIMER (228 vblanks) runs out. How rammed members and members that retired off-screen are handled is from the code only. An off-screen retire never counts down, so the claim fails.

### Score and the ladder

- The initials-entry clock should be 256 ticks of every eighth frame, starting from the zero step 8 leaves in SEQUENCE_DELAY: no routine writes SEQUENCE_DELAY between step 8 and the entry. This follows from the code and has not been timed.
- The context-block bytes 0xAD08, 0xAD09 and 0xAD0F have no names in names.js and show no role. Under MAME they are touched only by the power-on wipe, the two block saves (0x1211, 0x12B2) and the block restore (0x4C8A), and they read zero in every capture. Whether a routine the captures did not run gives them a value is open.
- Nothing copies the five-record high-score board into the single displayed high score (0xA98B–0xA98D, topped by HIGH_SCORE_HI 0xA98D). Under MAME the displayed score's only writers are the power-on wipe, the boot seed at 0x52AD that copies the ROM byte at 0x08C9, and awardScoreToPlayer's promotion at 0x0CD5. Whether a path outside the captured runs links the two is open.
- Bonus lives paying again after the score wraps past 999,900 follows from the code and has not been observed.
- The initials entry samples four control bits. Three map to the known panel: 0x01 left, 0x02 right, 0x10 fire. The physical control behind bit 0x20, the alternate commit, is not identified. MAME's port layout for the board, or pressing each control during entry, would identify it.

### The character plane

- The caption texts in §8 are decoded but have not been seen on screen. Only the digit mapping comes from the code (DIGIT_GLYPH_TABLE 0x0DCC). The letter mapping is inferred from how consistently the records read: records 12, 14 and 19 read as INPUT YOUR INITIALS !, STAGE and SCORE RANKING TABLE only under it. Records 20 and 21 (colour 0x32, second tile bank), which the copyright screen, the bonus-information screen and the initials screen all post, are pictorial and not identified. A MAME snapshot of each caption would confirm the mapping.
- The ring's slot-0 handler at 0x0BDD draws a caption's glyphs without touching colour. It is unreached as far as the code shows: no routine posts command 0, and a ROM byte scan for immediate ring posts (ld de,nn / ld d,n before RST 0x38) found no command 0. A post whose command is loaded from a register could still exist. A MAME PC-hit on 0x0BDD would close it.
- Caption record 24 (0x3ED2, start cell 0xA692) has no glyphs, because its terminator comes first. No poster for caption 0x18 appears in the routines or in a ROM byte scan. Not checked under MAME.
- What the between-eras band's tile codes (0x14/0x0E and their bumped successors, second tile bank) look like on the glass is not established.
- The kill meter blanks only one cell past the bar's end. That is safe only if the bar shrinks by at most one cell between draws, which holds because the round engine redraws it every pass. This is a code-level inference, not an observation.
- blankCellsPaintedLastPass blanks shot cells with glyph 0x20, where text uses 0xF1 as its blank. What glyph 0x20 shows has not been checked, though sky is the likely reading. A look at its tile bitmap would settle it.
