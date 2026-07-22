# RAM findings — the world and the system (DRAFT, for independent verification)

**Status: DRAFT. Every row below is a *claim*, not a fact of the ROM.** Per `README.md` §4 the
agent that proposes a name must not be the one that confirms it, so nothing here has been
written into `ram.js`. A verifier should re-derive each row from the citations — most of them
are one `emit.js` invocation.

Scope: board/level state, scoring, coin/credit, and the engine's own bookkeeping. Mario/player
state (0x6200-0x6226 and the object arrays) is another drafter's half and is deliberately absent.

---

## Method

Two independent tracks, and a row is only `confirmed` when at least one of them is decisive.

**1. Differential state diffing.** `games/dkong/tools/emit.js` runs the translation headlessly and
dumps all of 0x6000-0x6BFF per frame (`--state-out`); a small script reads the dump and reports,
per address, the frames at which it changed. Runs used:

| run | command (from `games/dkong/`) | what it isolates |
|---|---|---|
| `base` | `node tools/emit.js --frames 2600 --state-out OUT --input 0x7d00=0x80@400:once --input 0x7d00=0x04@460:once` | one-player game to first death |
| `two` | as above but `0x7d00=0x80@400`, `0x7d00=0x80@430`, `0x7d00=0x08@460` | two-player alternation |
| `b2/b3/b4` | `base` + the `move_suite.py` board-select poke set at frame 465 | which bytes are board-dependent |
| `task` | `base` + `--poke 0x60c4=0x00@1700:once --poke 0x60c5=0x05@1700:once --poke 0x60b0=0xc6@1700:once` | injects one task into the scheduler ring |
| `hiscore` | `task` + `--poke 0x60b4=0x99@1690:once` | forces the high-score compare to fire |
| `p2score` | `two` + the same injection at frame 2500 (slot 0x60DA, award 7) | proves the score slot follows 0x600D |
| `sub7` | `base` + `--poke 0x600a=0x07@1700:once` | what sub-state 7 actually is |
| DIP sweep | a 15-line node script that sets `machine.io.inputs._dsw0` before `runFrames(60)` | the whole 0x6020-0x6026 block |

**2. Disassembly.** `games/dkong/out/dk.asm` plus the docstrings in `games/dkong/translated/*.js`
(which carry the original mnemonics), plus raw-ROM scans for reference sites in the 23 % of the
binary the tracer has not reached. MAME 0.288 (`~/src/mame0288/src/mame/nintendo/dkong.cpp`) was
used only for the DIP-switch and input-port meanings.

All scratch lived outside the repo and has been deleted. Nothing was committed.

---

## 1. Game state and the NMI dispatch

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x6005` | `GAME_STATE` | Top-level state machine, index into the 4-entry `rst 0x28` table at ROM 0x00CA (`0x01C3, 0x073C, 0x08B2, 0x06FE`). Observed values: **0** = power-on init, **1** = attract, **2** = credited / starting, **3** = game in progress. | ROM 0x00C6 `ld a,(0x6005)` / `rst 0x28` (`translated/nmi.js:114-170`, table listed at `nmi.js:166`, dispatcher `nmi.js:2126-2140`). Empirical `base`: 0 → 1 @ f5, → 2 @ f401 (the coin frame), → 3 @ f461 (the start frame). Writers: 0x01E7 (=1, power-on), 0x0761 `inc (hl)` (attract → 2 when 0x6001 ≠ 0), 0x095A (=3, game start), 0x147A (=1, game over). | **confirmed** |
| `0x600A` | `SUB_STATE` | Sub-state index *within* the current `GAME_STATE`. Each top-level handler does `ld a,(0x600A); rst 0x28` against its own table: state 1 → ROM 0x0748 (10 entries), state 2 → ROM 0x08B6 (2), state 3 → ROM 0x0702 (29). Advanced by `inc (hl)` all over, and by the timer at 0x6009. | ROM 0x06FE `ld a,(0x600a) / rst 0x28`, table at 0x0702 (`translated/state0.js:494-510`); ROM 0x0746 and 0x08B2 do the same. Empirical `base`: the values walk 1,5,6,7,8,10,11,12,13,14 and **14 is the frame 0x6228 drops 3 → 2**, i.e. table idx 14 = ROM 0x12F2 = the player-1 death handler. | **confirmed** |
| `0x6007` | `ATTRACT` | 1 while no game is being played, 0 once a credit exists. Gates three things: the NMI skips the whole joystick read (`jp nz,0x00B5`), the sound driver returns immediately (`ret nz` at 0x00EA), and `rst 0x08` (ROM 0x0008) discards the caller's return address when bit 0 is set, skipping in-game-only work. | ROM 0x0080, 0x00E6, 0x0008 (`translated/nmi.js:114-170`, `nmi.js:679-700`, `translated/mainloop.js:118-140`). Writers: 0x01D3 (=1, power-on), 0x08BE (=0, credit accepted), 0x147D (=1, game over). Empirical `base`: 1 from f5, 0 from f402. | **confirmed** |
| `0x6008` | `SUB_STATE_TIMER_LO` | Fast half of the sub-state delay. `rst 0x20` (ROM 0x0020) decrements it and, on reaching 0, falls into `rst 0x18`'s body to decrement 0x6009 as well. | ROM 0x0020-0x0025 `ld hl,0x6008 / dec (hl) / jr z,0x0018`. | **inferred** |
| `0x6009` | `SUB_STATE_TIMER` | Frames remaining before the current sub-state may proceed. `rst 0x18` (ROM 0x0018) decrements it and, unless it hit 0, discards the caller's return address so the caller's remainder is skipped. The idiom "wait N frames then go to sub-state M" is written as `ld hl,0x6009 / ld (hl),N / inc hl / ld (hl),M`. | ROM 0x0018-0x001F (`translated/nmi.js:952-980`). The paired-write idiom at ROM 0x17AD (0x30, 8), 0x132B (0xC0, 0x10), 0x1962 (0xE0, 8), 0x09C1-0x09D5. Empirical `base`: counts down 1/frame from 0x40 at f466. | **confirmed** |
| `0x6385` | `INTRO_STEP` | Step index of the opening Kong-climb cutscene; `ld a,(0x6385) / rst 0x28` against the 8-entry table at ROM 0x0A7A. | ROM 0x0A76. Empirical `sub7`: steps 1→7 twice (f466-1234 naturally, f1701-2469 after the poke), with 0x608A = 0x01 at step 1 and 0x0F at step 7 — exactly the `intro` and `roar` commands `audio/sounds.js` cites at ROM 0x0ADB and 0x0BBD. | **confirmed** |

---

## 2. Board, level and the board-sequence table

The per-player *context* is an 8-byte block. The live copy is **0x6228-0x622F**; player 1's saved
copy is **0x6040-0x6047** and player 2's is **0x6048-0x604F**. `ldir` moves the block both ways
(ROM 0x09AB and 0x09FE restore; ROM 0x12FE and 0x1350 save on death). At game start offset 0 is
loaded from the DIP lives count and offsets 1-7 come from the 7-byte ROM template at **0x095E**:
`01 65 3a 01 00 00 00` (ROM 0x0919-0x094D).

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x6227` | `BOARD` | Current board type: **1 = 25 m girders, 2 = 50 m conveyors, 3 = 75 m elevators, 4 = 100 m rivets.** Not part of the saved context — it is re-derived from `*BOARD_SEQ_PTR` on every restore. | ROM 0x0FCB `ld a,c / rst 0x28` with the per-board setup table at 0x0FCD (`0000, 0FD7, 101F, 1087, 1131`); ROM 0x0CA7-0x0CC0 dispatches the background tune the same way, and `audio/sounds.js` independently names those four arms `bgm_25m / bgm_50m / bgm_75m / bgm_100m` (its citations 0x0CD9, 0x0CEC, 0x0CF7, 0x0CC0). `rst 0x30` (ROM 0x0044) treats it as a **bit index**: `ld a,MASK / rst 0x30` keeps the caller only if bit (0x6227−1) of MASK is set — e.g. `ld a,0x01` at 0x2C03 = board 1 only, `ld a,0x0E` at 0x2FCB = boards 2/3/4. Empirical `b2/b3/b4`: poking it yields three visibly different boards (this is the mechanism `move_suite.py` already relies on). | **confirmed** |
| `0x6229` | `LEVEL` | Level number, plain binary, 1-based, clamped to 99 (`cp 0x64 / ld a,0x63` at ROM 0x06E4). Displayed as two digits by the divide-by-10 loop at ROM 0x06ED → VRAM 0x74A3/0x74C3. Incremented once per completed *level* at ROM 0x1954. | ROM 0x06D7-0x06FD; ROM 0x1951 `ld hl,0x6229 / inc (hl)` (raw-ROM scan; this site sits in the tracer's unreached span, disassembled by hand from bytes `21 29 62 34`). Consumers: bonus scaling (ROM 0x0F7A), difficulty (ROM 0x0394), rivet-clear tune parity (ROM 0x1918). Empirical `b2/b3/b4`: poking 0x6229 = 2/3/4 changes the starting bonus to 60/70/80 exactly as `10·level + 40` predicts. | **confirmed** |
| `0x622A` `0x622B` | `BOARD_SEQ_PTR` | 16-bit **ROM** pointer to the current entry of the board-order table. Initialised to **0x3A65**. Advancing: `ld hl,(0x622A) / inc hl / ld a,(hl) / cp 0x7F` — on the `0x7F` terminator it reloads **0x3A73**, which is why levels 5+ repeat forever. The byte it points at is copied to 0x6227. | ROM 0x178E-0x17A2 (`translated/state0.js:17235`) and its level-incrementing twin at ROM 0x193D. Restores at ROM 0x09B6 / 0x0A09. Table bytes (from `rom/maincpu.bin`), grouped by level: `3A65: [01 04] [01 03 04] [01 02 03 04] [01 02 01 03 04] [01 02 01 03 01 04] 7F` — i.e. L1 = 25/100, L2 = 25/75/100, L3 = 25/50/75/100, L4 = 25/50/25/75/100, L5+ = 25/50/25/75/25/100, which is exactly Donkey Kong's documented board order and is the strongest single check on the 1/2/3/4 mapping above. | **confirmed** |
| `0x6228` | `LIVES` | Lives remaining for the player currently up; context offset 0. Initialised from the DIP count 0x6020, `dec (hl)` on death, `inc (hl)` on the bonus-life award. Also drives the on-screen life icons (ROM 0x06C7). | ROM 0x12FC / 0x134E (death), 0x037B (bonus life), 0x0922 / 0x0941 (init from 0x6020). Empirical `base`: 3 at f463, 2 at f1957 — one frame after 0x600A entered the death sub-state. Empirical `two`: 0x6228 tracks whichever of 0x6040 / 0x6048 belongs to the player who is up. | **confirmed** |
| `0x622C` | `PLAY_INTRO` | 1 = still play the opening Kong-climb cutscene. Template value 1; permanently zeroed by **both** death handlers. Read at ROM 0x0A71: non-zero advances 0x600A by 1 (→ sub-state 7, the cutscene), zero advances it by 2 (→ sub-state 8, the "how high" screen). | ROM 0x0A63-0x0A75 (`translated/state0.js:1606`), writers ROM 0x12F6 and 0x1348. | **inferred** |
| `0x622D` | `BONUS_LIFE_AWARDED` | Latch so the extra life is granted once per player. `ret nz` guards the whole compare; set to 1 at the moment 0x6228 is incremented. | ROM 0x0350-0x037C (`translated/mainloop.js:298-340`). | **confirmed** |
| `0x622E` | `HOW_HIGH_INDEX` | Height index for the "HOW HIGH CAN YOU GET?" interlude, clamped to 5. Incremented whenever 0x622A differs from the copy kept in 0x622F; reset to 0 by the level-increment path at ROM 0x195C. | ROM 0x0C05-0x0C22. | **inferred** |
| `0x622F` | `HOW_HIGH_LAST_SEQ` | Copy of 0x622A's low byte, used only to detect that the board-sequence pointer moved. | ROM 0x0C11-0x0C1F. | **inferred** |
| `0x6040`-`0x6047` | `P1_CONTEXT` | Player 1's saved copy of 0x6228-0x622F (same field order). | `ldir` sites ROM 0x09AB (restore) and 0x12FE (save). Empirical `two`: 0x6040 goes 3→2→1→0 at f2077/4543/6241, interleaved with 0x6048's 3→2→1→0 at f3694/5392/7282. | **confirmed** |
| `0x6048`-`0x604F` | `P2_CONTEXT` | Player 2's saved copy of the same block. | ROM 0x09FE (restore), 0x1350 (save), 0x0909/0x091F (init). | **confirmed** |
| `0x6290` | `RIVETS_LEFT` | Rivets still in place on 100 m. Initialised to 8 from the ROM template at 0x3DAC. `dec (hl)` each time a rivet is removed; when it reaches 0 the sub-state is forced to 0x16 (= ROM 0x1615, the board-cleared sequence). | ROM 0x1A86 `ld hl,0x6290 / dec (hl)` and ROM 0x1E80-0x1E87 `ld a,(0x6290) / and a / ret nz / ld a,0x16 / ld (0x600a),a` (`translated/state0.js:11198`). Empirical `b4`: 8 at board init. | **confirmed** |
| `0x6292`-`0x6299` | `RIVET_PRESENT[8]` | One flag per rivet (1 = still there). ROM 0x1A7B indexes `0x6292 + b`, tests it, clears it, and only then decrements 0x6290. Template `3DAC: 08 01 01 …` sets all eight. | ROM 0x1A7B-0x1A89. | **inferred** |

---

## 3. Bonus timer

The whole block is set up at board start by ROM 0x0F7A-0x0FA4 (`translated/state0.js:6054` and
`:6068`), from `LEVEL`:

```
bonus  = min(10*LEVEL + 40, 80)      -> 0x62B0, 0x62B1, 0x62B2   (units of 100 points)
period = max(0xDC - 2*bonus, 0x28)   -> 0x62B3, 0x62B4           (frames)
```

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x62B1` | `BONUS` | The bonus counter, **in units of 100 points** — the on-screen value is `0x62B1 × 100`. Reaching 0 sets `0x6386 = 1`. | ROM 0x2FE5 and 0x2CDA both `ld hl,0x62b1 / dec (hl)`. Empirical: in `base` it goes 0x32→0x31→0x30→0x2F and the *only* VRAM cell that moves in lockstep is 0x74C6, which goes 0 → 9 → 8 → 7 — the hundreds digit of 5000 → 4900 → 4800 → 4700. In `b2/b3/b4` it starts at 60/70/80 for levels 2/3/4. | **confirmed** |
| `0x62B0` | `BONUS_START` | The board's starting bonus, kept constant for the whole board. Used as the denominator for barrel-release pacing (`0x62B0 − 2`, `0x62B0 / 2` compared against 0x62B1 at ROM 0x2C12/0x2C33) and by the end-of-board tally at ROM 0x063A. | ROM 0x0F8E-0x0F96 writes it; nothing else writes it. Empirical `base`: 0x32 for the whole board while 0x62B1 counted down. | **confirmed** |
| `0x62B3` | `BONUS_PERIOD` | Frames between bonus ticks; reload value for 0x62B4. | ROM 0x0F97-0x0FA4 computes `0xDC − 2·bonus` (min 0x28) and stores it to 0x62B3 **and** 0x62B4 (HL is left at 0x62B3 by the preceding 3-byte loop). ROM 0x2FE1 reloads 0x62B4 from it. Empirical: level 1→120, level 2→100, level 3→80, level 4→60 frames, and in `b2/b3/b4` 0x62B1 decrements at **exactly** that spacing (1562→1662 = 100; 1542→1622 = 80; 1521→1581 = 60). | **confirmed** |
| `0x62B4` | `BONUS_TICK` | Countdown to the next bonus tick. | ROM 0x2FCE `ld hl,0x62b4 / dec (hl) / ret nz`. | **confirmed** |
| `0x62B2` | `BONUS_EVENT_MARK` | The next value of `BONUS` at which the board's periodic spawn event fires; initialised to the starting bonus and stepped down by 8 each time it matches. | ROM 0x2C57-0x2C5E `ld a,(0x62b2) / cp c / ret nz / sub 0x08 / ld (0x62b2),a`, with C = 0x62B1 from ROM 0x2C0C. | **inferred** |
| `0x6386` | `BONUS_EXPIRED_STEP` | Small state machine (0-3) run by `ld a,(0x6386) / rst 0x28` at ROM 0x1A07; set to **1** by both bonus-decrement sites at the moment 0x62B1 hits zero. | ROM 0x2CE3, 0x2FEC (writers), ROM 0x1A07-0x1A14 (table). | **inferred** |

**Worth knowing, and not obvious:** the bonus ticks by two completely different mechanisms.
`rst 0x30` gates the timed decrementer at ROM 0x2FCB with `ld a,0x0E` — boards **2, 3 and 4 only**.
On board 1 the bonus is decremented by the barrel-release routine at ROM 0x2CB8 instead, gated
`ld a,0x01`. That is why `base` (25 m) shows irregular spacing (66, 26, 97 frames) while
`b2/b3/b4` are metronomic.

---

## 4. Score, high score, and the bonus-life DIP

Scores are **3-byte packed BCD, little-endian** — the byte at `base+2` is the most significant
pair. Three slots of identical shape, selected by `entry_059b` (A = 0 → P1, 1 → P2, 2 → high).

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x60B2`-`0x60B4` | `P1_SCORE` | Player 1's score, 3-byte little-endian BCD. | ROM 0x055F `sub_055f`: `ld de,0x60B2 / ld a,(0x600D) / and a / ret z / ld de,0x60B5` (`translated/mainloop.js:1407`). Empirical `task`: injecting task (0, 5) — award index 5 — moved **0x60B3** from 0 to 5, i.e. score 000500, which is only consistent with little-endian. Award table ROM 0x3529, stride 3: `00 00 00 / 00 01 00 / 00 02 00 …` = 0, 100, 200 … 700. `prize_suite.py:15` already asserts award deltas on this address. | **confirmed** |
| `0x60B5`-`0x60B7` | `P2_SCORE` | Player 2's score, same format. | Same routine. Empirical `p2score`: with 0x600D = 1, the same injection landed on **0x60B6** (= 000700), not on 0x60B3. Attract-mode placeholder is `AA AA AA` (ROM template 0x01BA). | **confirmed** |
| `0x60B8`-`0x60BA` | `HIGH_SCORE` | High score, same format. Default **007650** from the ROM template at 0x01BA — nine bytes `00 37 00` / `aa aa aa` / `50 76 00`, `ldir`'d to 0x60B2 at ROM 0x01C9. | ROM 0x0540-0x055C: compare the just-updated score against 0x60BA downward, and on `jp nz` with no borrow copy 3 bytes into 0x60B8. Empirical `hiscore`: forcing P1's score to 990500 made 0x60B8-0x60BA become `00 05 99`, overwriting the 7650 default. | **confirmed** |
| `0x6021` | `DIP_BONUS_LIFE` | Extra-life threshold in **BCD thousands**: 0x07 / 0x10 / 0x15 / 0x20 = 7000 / 10000 / 15000 / 20000. | ROM 0x0214-0x0226 (`translated/state0.js:5700`) derives it from DSW0 bits 2-3 by `a = 5; repeat n: a = daa(a+5)`. ROM 0x036E compares it against the score's thousands pair (high nibble of `base+1` and low nibble of `base+2`, swapped by four `rrca`). Empirical DIP sweep: DSW0 0x80/0x84/0x88/0x8C → 0x07/0x10/0x15/0x20, matching MAME `dkong.cpp:1052-1056`. | **confirmed** |
| `0x622D` | see §2 | the "already awarded" latch for that compare | | |

---

## 5. Coins, credits and the DIP block

`sub_0207` (ROM 0x0207-0x0265, `translated/state0.js:5700`) reads DSW0 once at power-on and
expands it into seven consecutive bytes. The empirical DIP sweep below drove `_dsw0` through all
of MAME's documented settings and read the block back after 60 frames.

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x6020` | `DIP_LIVES` | Lives per game, 3-6 (DSW0 bits 0-1 + 3). Copied into `LIVES` at game start. | ROM 0x020E `and 0x03 / add a,0x03`. DIP sweep: 0x80/81/82/83 → 3/4/5/6. MAME `dkong.cpp:1047-1051`. | **confirmed** |
| `0x6022` | `DIP_COINS_FOR_1P` | Coins needed for a one-player game — a *display* value only, written to VRAM 0x756C by ROM 0x07AD. | ROM 0x0247. DIP sweep: 1C/1C→1, 2C/1C→2, 3C/1C→3, 4C/1C→4, 5C/1C→5, 1C/nC→1. | **inferred** |
| `0x6023` | `DIP_COINS_FOR_2P` | Coins needed for a two-player game — display only, written to VRAM 0x756E, with a special case that splits "10" across 0x756E/0x758E. | ROM 0x0249, ROM 0x07B1-0x07BB. DIP sweep: 1C/1C→2, 2C/1C→4, 3C/1C→6, 4C/1C→8, 5C/1C→10, 1C/2C→1, 1C/3C→1, 1C/4C→1. Every value is "how many coins buy two credits", which is what makes the 5C/1C→10 tens-digit special case necessary. | **inferred** |
| `0x6024` | `DIP_COINS_PER_CREDIT` | Coins the mech must swallow per credit group. | ROM 0x01A2-0x01A7 `ld de,0x6024 / ld a,(de) / sub (hl) / ret nz` (`translated/nmi.js:538-560`). DIP sweep + coin test: 4 coins at 2C/1C → 2 credits; at 3C/1C → 1 credit + 1 partial. | **confirmed** |
| `0x6025` | `DIP_CREDITS_PER_COIN` | Credits awarded per completed group. | ROM 0x01A9-0x01B2. Coin test: 4 coins at 1C/2C → **8** credits. | **confirmed** |
| `0x6026` | `DIP_UPRIGHT` | Cabinet: 1 = upright, 0 = cocktail. The NMI uses it to decide whether player 2 reads IN1 (`ld a,(0x6026) / and a / jp nz,0x0098`); it is also mirrored to the flip-screen latch 0x7D82 at ROM 0x13AD. | ROM 0x024F-0x0259 (DSW0 bit 7), NMI ROM 0x0087-0x0098. DIP sweep: 0x80 → 1, 0x00 → 0. MAME `dkong.cpp:1066-1068` (`0x80` = Upright). | **confirmed** |
| `0x6001` | `CREDITS` | Credit count, BCD, capped at 0x90 (`cp 0x90 / ret nc`). Consumed by the start handlers; while non-zero the attract handler advances `GAME_STATE`. | ROM 0x01AC-0x01B2 (`translated/nmi.js:538`), ROM 0x073F. Empirical `two`: 0 → 1 @ f401 → 2 @ f431 → 0 @ f461 when 2-player start consumed both. Coin test: exact under three coinage settings. | **confirmed** |
| `0x6002` | `COINS_PARTIAL` | Coins accumulated toward the next credit; reset to 0 when it reaches 0x6024. | ROM 0x01A0-0x01A8. Coin test: 4 coins at 3C/1C leaves `0x6001 = 1, 0x6002 = 1`; 3 coins leaves `1, 0`. (Invisible under the harness default 1C/1C, where it returns to 0 within the same frame.) | **confirmed** |
| `0x6003` | `COIN_EDGE` | Edge latch for IN2 bit 7. Held at 1 while no coin is present; a coin only counts when it finds the latch set, then the latch is cleared — so holding the coin line does not repeat-credit. | ROM 0x017B-0x019E (`translated/nmi.js:538-560`, whose docstring states exactly this). MAME `dkong.cpp:1039` (IN2 bit 0x80 = COIN1). | **confirmed** |

---

## 6. Frame sync, the free-running counters and the PRNG

This is the piece the brief asked to get exactly right, and the existing note is **imprecise**:
0x6019 is *not* a frame counter.

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x601A` | `FRAME` | The frame counter. **Decremented once per vblank NMI** at ROM 0x00B5-0x00B8. Everything periodic keys off it (`and 0x0F` at ROM 0x0319, `and 0x1F` at ROM 0x2C2A, four `rst 0x30` guards at 0x3110-0x3131 …). | `translated/nmi.js:114-170`. Empirical `base`: exactly −1 every frame, 1396 decrements in 1400 frames, no other delta. | **confirmed** |
| `0x6383` | `FRAME_SEEN` | The main loop's latched copy of the last `FRAME` it serviced. The loop spins on `ld a,(0x601A) / cp (hl) / jr z,0x02BD` and only stores the new value once the NMI has moved it. **This is the wait-for-vblank.** | ROM 0x02D1-0x02DA (`translated/mainloop.js:23-115`). Empirical `base`: byte-identical to 0x601A at every frame boundary. | **confirmed** |
| `0x6019` | `SPIN_COUNT` | Incremented once per **main-loop pass**, i.e. once per spin iteration — *not* once per frame. Its only real job is to be unpredictable: the number of spins varies with how much work the frame did. | ROM 0x02CD-0x02D0. Empirical `base`: the frame-boundary delta is **138-142**, never 1. Consumed as entropy at ROM 0x03F3, 0x2C3C, 0x34CC and folded into 0x6018 every NMI. | **confirmed** |
| `0x6018` | `RANDOM` | Pseudo-random accumulator. `sub_0057` (ROM 0x0057, called from the NMI at 0x00B9) does `0x6018 += 0x601A + 0x6019` once per vblank — a decrementing counter plus a jittery one. | `translated/nmi.js:506-535`. Read as a random value at ROM 0x1DF5, 0x218C, 0x229A, 0x22F6, 0x2303, 0x31F6, 0x3221, 0x331F, and via `call 0x0057` at 0x2C41, 0x2EBA, 0x308B. Clearest single use: ROM 0x2186-0x2193 `ld a,(0x6380) / rra / inc a / ld b,a / ld a,(0x6018) / and 0x03 / cp b / ret nc` — a difficulty-weighted coin flip. Empirical `base`: 2576 changes in 1400 frames, no structure. | **confirmed** |
| `0x6384` | `DIFFICULTY_PRESCALER` | Increments once per serviced frame; `sub_037f` returns immediately unless it wrapped, so the block below it runs every 256 frames. | ROM 0x037F-0x0385 (`translated/mainloop.js:1753`). Empirical `base`: +1 every frame. | **confirmed** |
| `0x6381` | `DIFFICULTY_CLOCK` | Increments every 256 frames; every 8th increment (`and 0x07 / ret nz`) recomputes `DIFFICULTY`. Reset at board start. | ROM 0x0386-0x038E. Empirical `base`: steps at f5, 262, 519, 775, 1031, 1287 — a 257-frame cadence — and resets to 0 at f1397 when the board is built. | **confirmed** |
| `0x6380` | `DIFFICULTY` | `min(LEVEL + (DIFFICULTY_CLOCK >> 3), 5)` — the classic DK ramp: it rises with the level *and* with time spent on the board. | ROM 0x038F-0x039E. Consumed at ROM 0x2186 (barrel behaviour, above), 0x22D2, 0x2C23, 0x2DDF, 0x30FA, 0x3190, 0x31DD. Empirical `base`: 1 on level 1. | **confirmed** |

---

## 7. The task scheduler

The main loop is a task-queue runner. This whole section was verified in one shot by **injecting a
task and watching it execute** (`task` run).

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x60C0`-`0x60FF` | `TASK_RING` | 32 slots × 2 bytes: `[opcode, argument]`. **0xFF in the opcode byte means "free"** — boot fills all 64 bytes with 0xFF (ROM 0x0291-0x029A). The dispatcher writes 0xFF back into both bytes as it consumes an entry. | ROM 0x0298 (`translated/boot.js:85`), ROM 0x02E8-0x02EE (`translated/mainloop.js:577`). Empirical `task`: 0x60C4/0x60C5 were 0xFF, the poke made them 0x00/0x05, and one frame later they were 0xFF again. | **confirmed** |
| `0x60B0` | `TASK_TAIL` | Enqueue pointer — the **low byte** of an address in page 0x60. `sub_309f` (ROM 0x309F, `translated/state0.js:2382`) writes D then E at `0x6000 + 0x60B0` and advances by 2, wrapping 0xFE → 0xC0. If the slot is not free the request is silently dropped. | ROM 0x30A3-0x30B8, init to 0xC0 at ROM 0x029E. Empirical `task`: manually advancing it to 0xC6 was exactly what made the injected entry be seen. | **confirmed** |
| `0x60B1` | `TASK_HEAD` | Dequeue pointer, same encoding. The main loop reads `(0x6000 + 0x60B1)`; `add a,a` tests bit 7, so 0xFF (free) means "no task — do the per-frame work and then wait for vblank", and anything else dispatches. | ROM 0x02BF-0x02C5 and 0x02E3-0x02F6. Empirical `task`: 0x60B1 advanced 0xC4 → 0xC6 the frame after the injection. | **confirmed** |

**The dispatch, for the record.** `loc_02e3` recomputes `e = (2·opcode) & 0x1F` (A has already been
doubled by the `add a,a` test), reads the argument into C, then indexes the 7-entry pointer table at
**ROM 0x0307**: `051C, 059B, 05C6, 05E9, 0611, 062A, 06B8`. So opcode 0 = add-to-score (argument =
index into the ROM 0x3529 award table), opcode 1 = clear a score slot, opcode 5 = the end-of-board
bonus tally. Opcodes 2, 3, 4, 6 are not characterised here. The `task` run demonstrates opcode 0
end-to-end: `(0, 5)` → `P1_SCORE` = 000500.

---

## 8. Sound scheduler block

Structure lifted from `games/dkong/audio/README.md` and re-checked against the ROM; the individual
sound *names* are that document's work and its confidence values, not new claims of mine.

| address | proposed name | meaning | evidence | confidence |
|---|---|---|---|---|
| `0x6080`-`0x6087` | `SND_TRIGGER[8]` | One frame-counter per ls259.6h latch bit. `sub_00e0` (ROM 0x00E0, called from the NMI at 0x00BF) walks all eight in lockstep with 0x7D00-0x7D07: non-zero → decrement and drive the latch bit to 1; zero → drive 0. Game code stores 3, giving a 3-frame assert. | `translated/nmi.js:679-740`. Known writers: 0x1D91→0x6080 (walk), 0x1BAC→0x6081 (jump), 0x019A→0x6083 (coin — note this is the *coin* routine, an independent cross-check), 0x295F/0x1DE2/0x1E44→0x6085. 0x6086/0x6087 are never written by any addressing mode. | **confirmed** |
| `0x6088` | `SND_IRQ_TRIGGER` | Same countdown shape, driving the I8035 interrupt line at 0x7D80. | ROM 0x010E-0x0118; writer ROM 0x12A8. | **confirmed** |
| `0x6089` | `SND_BGM` | Background tune index → 0x7C00 whenever 0x608B is 0. Held, so the tune loops. | ROM 0x0102-0x010B. Empirical `sub7`: 0x08 from f1395 (25 m theme) on board 1, matching `sounds.js`'s ROM-0x0CD9 citation. | **confirmed** |
| `0x608A` | `SND_PRIORITY` | Priority tune index → 0x7C00 while 0x608B ≠ 0, overriding 0x6089. | ROM 0x0108-0x010B. Empirical `sub7`: 0x01 then 0x0F during the opening cutscene, 0x02 at level start. | **confirmed** |
| `0x608B` | `SND_PRIORITY_FRAMES` | Countdown for the above; game code stores 3, so a priority tune is a 3-frame pulse. | ROM 0x00FA-0x0109. Empirical `sub7`: every write is 3 followed by 2, 1, 0 on consecutive frames. | **confirmed** |

---

## 9. Corrections to beliefs the project already holds

These are the reason this exercise was worth doing. All three are load-bearing.

**(a) `0x600A` is not a "rescue flag".** The progression record describes it that way and pokes it
to 7 to trigger board completion. It is the **sub-state dispatch index**, and 7 selects the
**opening Kong-climb cutscene** (table idx 7 = ROM 0x0A76), not a rescue. Demonstrated: the `sub7`
run pokes `0x600A = 7` at frame 1700 mid-board, and the machine replays *exactly* the sequence it
had already played at frames 466-1234 immediately after the game started — 0x6385 stepping 1→7,
0x608A = 0x01 (`intro`) at step 1 and 0x0F (`roar`) at step 7 — then falls into sub-state 8, the
"how high" screen. **The board type 0x6227 and the sequence pointer 0x622A never change.** The
board only "advanced" in the earlier experiment because the cutscene ends by handing off to the
board-start path, not because 7 means rescue. The genuine board-complete sub-state is **0x16**
(ROM 0x1615): the rivet-count-zero test at ROM 0x1E80 writes precisely that.

**(b) `0x6019` is not a frame counter.** The lead calls it "incremented right before" the compare,
which is true but reads as if it were a second frame counter. It is incremented once per *spin
iteration*: measured at **138-142 per frame**. The frame counter is 0x601A alone (decrementing);
0x6383 is the main loop's latched copy. Anything that treats 0x6019 as a frame count will be wrong
by two orders of magnitude — and its jitter is exactly what makes it useful as PRNG entropy.

**(c) `0x6049` / `0x604A` / `0x604B` are not board-select registers.** `move_suite.py` pokes them
alongside 0x622A/0x622B/0x6227/0x6229, which reads as if they were a parallel set of board fields.
They are offsets 1, 2 and 3 of **player 2's saved context block at 0x6048** — i.e. the saved copies
of `LEVEL`, `BOARD_SEQ_PTR`. The poke recipe works because ROM 0x09FE `ldir`s 0x6048→0x6228 on
restore. The player-1 equivalents are 0x6041/0x6042/0x6043. Anyone generalising the recipe needs to
know which block a given poke lands in.

Two smaller refinements: the score at `0x60B2` is specifically **little-endian** 3-byte BCD (the
`hiscore` and `task` runs both turn on this), and the sound block's `0x6083` is written by the
*coin* routine at ROM 0x019A as well as by the spring code — a useful independent confirmation that
the 6h latch bit 3 line really is "coin or spring" as `audio/sounds.js` has it.

---

## 10. Rejected — examined, evidence too thin to name

**50 addresses.** Listing them is the point: each was looked at and deliberately left as hex.

- **No ROM reference at all**: `0x6004`, `0x6006`, `0x600B`, `0x600C`. Established by scanning the
  raw 16 KB image for every addressing mode that can name an absolute address (`21/3A/32/11/01/2A/22/31`
  and the `ED`-prefixed 16-bit loads), not just the 77 % the tracer reaches.
- **Written once at boot and never read** in any path I could trace: `0x6000`.
- **Board/animation scratch I could locate but not pin to a meaning**: `0x6030`, `0x6031`,
  `0x6032`, `0x6034`, `0x6035`, `0x6036`, `0x6038`, `0x603A` (a 6-byte descriptor block written
  wholesale at ROM 0x1499 plus a VRAM pointer at 0x6036 — plausibly a marquee/animation record,
  but "plausibly" is not evidence), `0x6060`, `0x6100`, `0x611C`, `0x61A5`, `0x61B1`, `0x61C6`,
  `0x61C7`.
- **Engine scratch in the 0x63xx region** whose consumers I did not chase far enough to name:
  `0x6300`, `0x6310`, `0x6340`, `0x6341`, `0x6342`, `0x6343`, `0x6345`, `0x6346`, `0x6348`,
  `0x6350`, `0x6382`, `0x6387`, `0x6388`, `0x638C`, `0x638F`, `0x6390`, `0x6391`, `0x6392`,
  `0x6393`, `0x63A0`.
- **Board-object bookkeeping adjacent to the bonus and rivet blocks**: `0x62AA`, `0x62AC`,
  `0x62AF`, `0x62B5`, `0x62B6`, `0x62B7`, `0x62B8` (a clean /4 prescaler at ROM 0x03AB, but for
  object logic rather than world state), `0x62B9`, `0x62BA`, and `0x6291` — a 0/1 flag that sits
  immediately below the rivet array and is *not* part of it (ROM 0x1A43/0x1A4D/0x1A51, all inside
  the tracer's unreached span; found only by the raw scan).

Two more are *deliberately out of scope rather than rejected*: **`0x6010` / `0x6011`** are the
NMI's debounced control latch (ROM 0x009F-0x00AC writes the pair; ROM 0x2194 reads bits 0/1 as
left/right). They are engine bookkeeping by provenance but controller state by meaning, so they sit
on the boundary with the player drafter's half and I have left them for whoever owns input.
