# RAM verification — the world and the system (ADVERSARIAL RE-DERIVATION)

**Scope.** Independent re-derivation of every named address in `ram-findings-world.md`. Each row
was treated as WRONG until my own experiment reproduced the evidence. Nothing here was taken on the
drafter's word; every "confirmed" below is a run I executed or a ROM site I opened and read.

**Harness.** `node tools/emit.js` (headless translation, dumps 0x6000-0x6BFF + sprite + video per
frame via `--state-out`, 5120 B/frame). A work address `0x60xx` sits at byte `addr-0x6000` in each
frame. Scratch analysis scripts lived outside the repo and are deleted. Nothing committed;
`translated/`, `boards/`, `web/`, `ram.js`, and the drafter's file were not touched.

**Runs I executed** (all from `games/dkong/`, 2600 frames unless noted):

| run | command tail | isolates |
|---|---|---|
| `base` | `--input 0x7d00=0x80@400:once --input 0x7d00=0x04@460:once` | 1-player game to first death |
| `sub7` | base `+ --poke 0x600a=0x07@1700:once` | **what sub-state 7 does mid-board** |
| `sub16` | base `+ --poke 0x600a=0x16@1700:once` | **what sub-state 0x16 does (positive control)** |
| `b2/b3/b4` | base `+` the `move_suite.py` board-select poke set @465 | board-dependent bytes |
| `task` | base `+ --poke 0x60c4=0x00 --poke 0x60c5=0x05 --poke 0x60b0=0xc6 @1700:once` | scheduler ring |
| `hiscore` | task `+ --poke 0x60b4=0x99@1690:once` | high-score compare |
| DIP sweep | node script setting `Inputs._dsw0` before `runFrames(60)` | 0x6020-0x6026 |
| coin test | node script pulsing IN2 bit7 under 3C/1C and 1C/2C coinage | 0x6001/0x6002/0x6003 |

---

## TALLY

**52 named addresses/blocks examined. UPHELD 52 · DOWNGRADED 0 · REFUTED 0 · UNVERIFIED 0.**

The only **REFUTED** item is a *prior project belief the drafter itself corrects*: the label
**"rescue flag" on 0x600A** (from arcade2 commits `14da179`/`e5b7bab`). The drafter's replacement
name is UPHELD. So all three §9 corrections stand, and every proposed name holds — several with
inferred sub-details I flag below. No name in the draft needs to be pulled.

Confidence key: **high** = I reproduced a decisive experiment; **med** = ROM site is unambiguous
but the run exercised it only partially or the sub-detail is inferred.

---

# ★ THE HIGH-STAKES ONE: 0x600A — decisively resolved

**Verdict: the drafter is RIGHT. 0x600A is a SUB-STATE DISPATCH INDEX. Value 7 = the opening
Kong-climb cutscene, NOT a rescue. The prior "rescue flag" label is REFUTED. The genuine
board-complete sub-state is 0x16.**

### First, the thing that is NOT in question

Board-to-board progression and the level loop are real and validated-by-play (Karl confirms this
independently, and my `sub16` run below reproduces an advance directly). **This is a naming
correction, not a capability regression.** A future reader must not read "REFUTED: rescue flag" as
"progression is broken." What was mislabelled is the *byte*, not the *behaviour*.

### The ROM mechanism (opened and read, not trusted)

`rst 0x28` (ROM 0x0028) is `add a,a / pop hl / add hl,de / jp (hl)` — it doubles A and jumps
through the 2-byte-stride table that follows the call site. The in-game handler at ROM 0x06FE is
`ld a,(0x600a) / rst 0x28` against the 29-entry table at **0x0702**. Entry by index (from
`out/dk.asm`):

```
idx 7  -> 0x0A76   the intro handler: ld a,(0x6385) / rst 0x28  -> Kong-climb cutscene table @0x0A7A
idx 8  -> 0x0BDA   "how high" screen
idx 10 -> 0x0C91   board setup / level start
idx 13 -> 0x127C   gameplay
idx 14 -> 0x12F2   player-1 death handler
idx 0x16 (22) -> 0x1615   the board-CLEARED sequence
```

So `0x600A = 7` selects the cutscene handler, which then walks its OWN step index `0x6385` 1→7.
And the rivet-count-zero test at ROM **0x1E80** is `ld a,(0x6290) / and a / ret nz / ld a,0x16 /
ld (0x600a),a` — board-complete writes **0x16**, never 7.

### Experiment 1 — poke 0x600A=7 mid-board (`sub7` run). Raw deltas:

Poked at f1700, when 0x600A was 0x0D (gameplay). Result — an **exact replay of the opening
cutscene**, and the board does NOT move:

```
0x600A : 0x0d (f1695) -> 0x07 (f1700, the poke)
0x6385 : 1@f1701 -> 2@f1765 -> 3@f2013 -> 4 -> 5 -> 6 -> 7@f2293   (identical to the f466-1234 intro)
0x608A : 0x01 (intro tune) at step 2 ; 0x0F (roar) at step 7 @f2326  (identical audio to the real intro)
then    : 0x600A falls to sub-state 8 (how-high), 0x608A -> 0x02 (level-start tune)

0x6227 (BOARD)   : 0x01 for the ENTIRE run — never moves
0x6229 (LEVEL)   : 0x01 for the ENTIRE run — never moves
0x622A/B (SEQPTR): 0x65/0x3A (= ROM 0x3A65, the table start) for the ENTIRE run — never moves
```

The board type, the level, and the sequence pointer are byte-frozen. Poking 7 replays the intro;
it does not rescue and it does not advance. **This is the drafter's exact claim, reproduced.**

### Experiment 2 — poke 0x600A=0x16 mid-board (`sub16`, the positive control). Raw deltas:

Poked at f1700. This IS the board-complete path, and it advances exactly per the sequence table:

```
0x600A : 0x0d (f1695) -> 0x16 (f1700, the poke)   [dispatches ROM 0x1615, board-cleared sequence]
0x6227 (BOARD)   : 0x01 -> 0x04   @f1933           25m -> 100m
0x622A/B (SEQPTR): 0x65 -> 0x66   @f1933           0x3A65 -> 0x3A66
0x6229 (LEVEL)   : 0x01 unchanged                  (correct: level only ticks after 100m)
```

Sequence table `0x3A65 = [01 04] ...`, so completing 25m (entry 0 = 01) advances to entry 1 = 04 =
100m. **This is the real "advance 25m->100m" the old commit saw — driven by 0x16, not 7.**

### Reconciling the old commit (both failure modes considered)

Commit `14da179`: *"reaches Pauline -> rescue (0x600A=7) -> full advance 25m->100m."* Reading the
two experiments together, the old observer's *capability* was real (Mario reached Pauline, the board
advanced) but the *attribution* was backwards. The rescue/board-complete runs through sub-state
**0x16** (ROM 0x1615), which advances the sequence pointer and rebuilds the board — and the NEW
board opens with its **intro cutscene, sub-state 7**. The observer sampled 0x600A right around the
transition, saw 7 (the next board's intro), and named 7 "rescue." The number they saw was 7; the
thing that did the work was 0x16 one moment earlier. So: **the old commit mislabelled what it saw;
the drafter's correction is the accurate one.**

| addr | drafter's name | prior belief | MY verdict | recommended {name, confidence} |
|---|---|---|---|---|
| `0x600A` | `SUB_STATE` (idx; 7=cutscene, 0x16=board-clear) | "rescue flag, 7=rescue→advance" | **UPHELD** (drafter) / **REFUTED** (prior "rescue flag") | `GAME_SUBSTATE`, **high** |

```js
/** Sub-state dispatch index WITHIN the current GAME_STATE. In-game (state 3) the handler at
 *  ROM 0x06FE does `ld a,(0x600a) / rst 0x28` through the 29-entry table at 0x0702:
 *  7=opening Kong-climb cutscene (NOT a rescue), 8=how-high, 10=board setup, 13=gameplay,
 *  14=P1 death, 0x16=board-cleared/advance. Board-complete writes 0x16 (ROM 0x1E80 rivet-zero;
 *  girder/rescue boards likewise). NOTE: this is a corrected name — arcade2 commit 14da179 called
 *  this address a "rescue flag" after seeing 7 at a board transition; 7 is the NEXT board's intro.
 *  Board-to-board progression and the level loop are real and validated-by-play regardless of this
 *  byte's name. Proven: poking 7 mid-board replays the intro and freezes BOARD/LEVEL/SEQPTR;
 *  poking 0x16 advances 25m->100m. */
export const GAME_SUBSTATE = 0x600A;
```

---

# The other two §9 corrections — re-derived

### (b) 0x6019 is the SPIN counter (~140×/frame), NOT a frame counter — UPHELD

Per-frame deltas measured from `base` over f500-1200 (histogram, mod 256):

```
0x601A "FRAME"        : +255 (= -1)  700/700 frames         -> decrements exactly once per NMI
0x6019 "SPIN_COUNT"   : +138..+142 in gameplay (peak +142 320x, +141 219x); a lighter cluster
                        +87..+91 during the cutscene phase — NEVER +1                (workload-jittery)
0x6384 "PRESCALER"    : +1        700/700 frames             -> the real +1/frame counter
```

0x6019 advances ~140/frame and its jitter tracks how much work the frame did — off by two orders of
magnitude from a frame count, and exactly the entropy `sub_0057` (ROM 0x0057:
`0x6018 += 0x601A + 0x6019`) folds into the PRNG. **Minor refinement to the draft:** the spin count's
range is *wider* than the stated "138-142" once the cutscene is included (~87-142) — which only
strengthens the "unpredictable entropy" point. 0x601A is the sole frame counter (decrementing);
0x6383 is its latched copy (byte-identical at 2592/2600 boundaries — the 8 exceptions are the
overrun frames README §2 predicts). **Correction (b) holds.**

### (c) 0x6049/0x604A/0x604B are player-2 saved-context offsets, NOT board registers — UPHELD

The context block is 8 bytes. Read directly from `out/dk.asm`:

```
ROM 0x09AB:  ld hl,0x6040 / ld de,0x6228 / ld bc,0x0008 / ldir     P1 saved -> live
ROM 0x09FE:  ld hl,0x6048 / ld de,0x6228 / ld bc,0x0008 / ldir     P2 saved -> live   <-- the recipe's ldir
ROM 0x12FE:  ld hl,0x6228 / ld de,0x6040 / ... ldir                live -> P1 (save on death)
ROM 0x1350:  ...          / ld de,0x6048 / ... ldir                live -> P2 (save on death)
```

So 0x6048 is the base of P2's 8-byte saved context; offsets 1/2/3 = 0x6049/0x604A/0x604B =
saved LEVEL / SEQPTR-lo / SEQPTR-hi. `move_suite.py` pokes them *because* ROM 0x09FE `ldir`s
0x6048→0x6228 on the next restore and would otherwise clobber the live poke. The P1 equivalents are
0x6041/0x6042/0x6043. **Correction (c) holds.** (Two smaller refinements also verified: score is
little-endian 3-byte BCD — see §4 below; 0x6083 is written by the coin routine at ROM 0x019A.)

---

# The strong structural claims — re-derived

### Board-sequence table @ ROM 0x3A65 — UPHELD (byte-exact)

Read straight from `rom/maincpu.bin`:
`3A65: 01 04 | 01 03 04 | 01 02 03 04 | 01 02 01 03 04 | 01 02 01 03 01 04 | 7F` (terminator @0x3A79).
= L1 25/100, L2 25/75/100, L3 25/50/75/100, L4 25/50/25/75/100, L5+ 25/50/25/75/25/100 — the
documented DK order, pinning **0x6227 1/2/3/4 = 25/50/75/100m**. Advance/wrap read at ROM 0x178E
(`inc hl / ld a,(hl) / cp 0x7f / jp nz / ld hl,0x3a73`) and its level-incrementing twin ROM 0x193D
(`... 21 29 62 34` = `ld hl,0x6229 / inc (hl)`): the 0x7F terminator reloads **0x3A73** (start of the
L5+ group at table offset 14), which is why levels 5+ repeat forever. `sub16` reproduced one advance.

### Task scheduler — UPHELD (injected a task, watched it score). Raw deltas from `task`:

```
f1699  TAIL 0x60B0=0xC4  HEAD 0x60B1=0xC4  slot 0x60C4/C5=FF/FF  P1score 0x60B3=0x00
f1700  TAIL=0xC6 (poked) HEAD=0xC4          slot=00/05 (poked)    0x60B3=0x00
f1701  TAIL=0xC6         HEAD=0xC6 (advanced) slot=FF/FF (freed)   0x60B3=0x05   <- score 000500
```

Confirms: ring at 0x60C0-0x60FF, 2 B/slot `[opcode,arg]`, 0xFF=free; TAIL=enqueue, HEAD=dequeue.
Opcode dispatch table @ROM 0x0307 (raw `1c 05 9b 05 c6 05 e9 05 11 06 2a 06 b8 06` = 0x051C, 0x059B,
0x05C6, 0x05E9, 0x0611, 0x062A, 0x06B8). Opcode 0 = add-to-score; arg = index into the award table
@ROM 0x3529 (`00 00 00 / 00 01 00 / ... / 00 05 00`), so arg 5 = +500 landing in 0x60B3 (base+1) —
which is only consistent with **little-endian** BCD. The `hiscore` run doubled this: forcing P1 to
990500 overwrote HIGH_SCORE 0x60B8-BA with `00 05 99` (MSB pair 0x99 at the top address = little-
endian), replacing the 007650 template default.

### Bonus-timer period `max(0xDC − 2·bonus, 0x28)` and the two tick modes — UPHELD

From `b2/b3/b4` at board start (bonus = `min(10·L+40, 80)`):

```
L2: BONUS 0x62B1=0x3C(60) START 0x62B0=0x3C PERIOD 0x62B3=0x64(100)   max(0xDC-120,40)=100 ✓
L3: BONUS=0x46(70)        START=0x46         PERIOD=0x50(80)          max(0xDC-140,40)= 80 ✓
L4: BONUS=0x50(80)        START=0x50         PERIOD=0x3C(60)          max(0xDC-160,40)= 60 ✓
```

Tick spacing measured: board 2 decrements 0x62B1 every **exactly 100** frames (f1562,1662,1762,…),
board 4 every **exactly 60** (f1521,1581,1641,…) — metronomic, driven by the timed decrementer at
ROM 0x2FCB (gated `ld a,0x0E` = boards 2/3/4). Board 1 (`base`) is **irregular** (ticks at f1464,
1490, 1587 — 26, 97 apart) because 25m decrements via the barrel-release routine at ROM 0x2CB8
(gated `ld a,0x01`). **Both tick modes confirmed.**

---

# Full verdict table

Every row = **UPHELD** (my experiment or the cited ROM site reproduced the drafter's evidence).
"exp" names the run; "ROM" means I opened the cited site in `out/dk.asm`/`rom/maincpu.bin`.

## §1 Game state / NMI dispatch

| addr | name | verdict · how I re-derived | conf |
|---|---|---|---|
| `0x6005` | `GAME_STATE` | UPHELD · `base`: 0→1@f5, →2@f401(coin), →3@f461(start); rst 0x28 table @0x00CA | high |
| `0x600A` | `GAME_SUBSTATE` | UPHELD (see high-stakes section); "rescue flag" REFUTED | high |
| `0x6007` | `ATTRACT` | UPHELD · `base`: 1 from f5, 0 from f402; NMI skips joystick read `jp nz` @0x0080 | high |
| `0x6008` | `SUBSTATE_TIMER_LO` | UPHELD(inferred) · ROM rst 0x20 @0x0020 `dec (0x6008) / jr z,0x0018` cascades to 0x6009. Not seen decrementing in my runs (observed waits used rst 0x18 on 0x6009 directly) — pairing is by ROM structure | med |
| `0x6009` | `SUBSTATE_TIMER` | UPHELD · `base`: counts 0x40→0 at 1/frame from f466; rst 0x18 @0x0018 `dec (hl) / ret z / inc sp inc sp` | high |
| `0x6385` | `INTRO_STEP` | UPHELD · `base` & `sub7`: walks 1→7 across the cutscene; dispatched by ROM 0x0A76 | high |

## §2 Board / level / context

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x6227` | `BOARD` | UPHELD · seq-table 1/2/3/4=25/50/75/100m; `b2/b3/b4` + `sub16` advance | high |
| `0x6229` | `LEVEL` | UPHELD · `b2/b3/b4` bonus=10·L+40; inc @ROM 0x1951 `21 29 62 34` | high |
| `0x622A/B` | `BOARD_SEQ_PTR` | UPHELD · ROM ptr, init 0x3A65, advance/wrap @0x178E/0x193D→0x3A73; `sub16` 0x65→0x66 | high |
| `0x6228` | `LIVES` | UPHELD · `base`: 3@f463→2@f1957(death); ldir offset 0; death `dec (hl)` @0x12FC | high |
| `0x622C` | `PLAY_INTRO` | UPHELD · `base`: 1@board-start, 0 after death; zeroed by ROM 0x12F6 `xor a / ld (0x622c),a` | high |
| `0x622D` | `BONUS_LIFE_AWARDED` | UPHELD(inferred) · `base`: 0 at board start (not yet awarded); latch `ret nz` @ROM 0x0350 | med |
| `0x622E` | `HOW_HIGH_INDEX` | UPHELD(inferred) · `base`: 1 at the how-high screen (f1235); ROM 0x0C05 | med |
| `0x622F` | `HOW_HIGH_LAST_SEQ` | UPHELD(inferred) · `base`: 0x65 = 0x622A low byte; ROM 0x0C11 | med |
| `0x6040-47` | `P1_CONTEXT` | UPHELD · ldir ROM 0x09AB(restore)/0x12FE(save) | high |
| `0x6048-4F` | `P2_CONTEXT` | UPHELD · ldir ROM 0x09FE(restore)/0x1350(save) | high |
| `0x6290` | `RIVETS_LEFT` | UPHELD · `b4`: =8 at 100m init; `dec` @ROM 0x1A86; zero→0x16 @ROM 0x1E80 | high |
| `0x6292-99` | `RIVET_PRESENT[8]` | UPHELD(inferred) · `b4` f1500: 8 flags all =1; 0x6291=0 correctly NOT in the array | med |

## §3 Bonus timer

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x62B1` | `BONUS` | UPHELD · units of 100 pts; `b2/b3/b4`=60/70/80; dec @ROM 0x2FE5/0x2CDA | high |
| `0x62B0` | `BONUS_START` | UPHELD · `b*`: = BONUS at start, held constant; written only @ROM 0x0F8E | high |
| `0x62B3` | `BONUS_PERIOD` | UPHELD · =100/80/60 for L2/3/4; tick spacing exact; ROM 0x0F97 | high |
| `0x62B4` | `BONUS_TICK` | UPHELD · reload-of-0x62B3 countdown; ROM 0x2FCE `dec (hl) / ret nz` | high |
| `0x62B2` | `BONUS_EVENT_MARK` | UPHELD(inferred) · ROM 0x2C57 `cp c / sub 0x08 / ld (0x62b2),a` | med |
| `0x6386` | `BONUS_EXPIRED_STEP` | UPHELD(inferred) · rst 0x28 table @ROM 0x1A07; set=1 by both dec sites | med |

## §4 Score / high score / bonus-life DIP

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x60B2-B4` | `P1_SCORE` | UPHELD · `task`: award 5→0x60B3=5 (little-endian); slot-select sub_055f @ROM 0x055F | high |
| `0x60B5-B7` | `P2_SCORE` | UPHELD · sub_055f: `ret z` on 0x600D then `ld de,0x60b5`; 0x600D=1→P2 | high |
| `0x60B8-BA` | `HIGH_SCORE` | UPHELD · `hiscore`: 990500 overwrote 007650 default; compare @ROM 0x0540 | high |
| `0x6021` | `DIP_BONUS_LIFE` | UPHELD · DIP sweep 0x80/84/88/8C→07/10/15/20 (BCD thousands) | high |

## §5 Coins / credits / DIP block

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x6020` | `DIP_LIVES` | UPHELD · DIP sweep 0x80/81/82/83→3/4/5/6 | high |
| `0x6022` | `DIP_COINS_FOR_1P` | UPHELD(inferred) · DIP sweep tracks coinage; display-only per ROM 0x07AD | med |
| `0x6023` | `DIP_COINS_FOR_2P` | UPHELD(inferred) · DIP sweep (0x80→2, 0xff→10); display-only; VRAM split not re-checked | med |
| `0x6024` | `DIP_COINS_PER_CREDIT` | UPHELD · coin test 3C/1C: 3 coins→1 credit, partial resets | high |
| `0x6025` | `DIP_CREDITS_PER_COIN` | UPHELD · coin test 1C/2C: 1 coin→2 credits | high |
| `0x6026` | `DIP_UPRIGHT` | UPHELD · DIP sweep 0x80→1, 0x00→0; NMI `jp nz,0x0098` @ROM 0x0087 | high |
| `0x6001` | `CREDITS` | UPHELD · `base` 0→1@f401→0@f461; coin test exact under 3 coinages | high |
| `0x6002` | `COINS_PARTIAL` | UPHELD · coin test 3C/1C: 1,2 coins→partial 1,2; 3→0 (rolls into credit) | high |
| `0x6003` | `COIN_EDGE` | UPHELD · coin test: each coin counts once (held line does not repeat-credit) | high |

## §6 Frame sync / counters / PRNG

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x601A` | `FRAME` | UPHELD · −1/frame 700/700; NMI @ROM 0x00B5 | high |
| `0x6383` | `FRAME_SEEN` | UPHELD · = 0x601A at 2592/2600 boundaries (8 overrun frames); ROM 0x02D1 | high |
| `0x6019` | `SPIN_COUNT` | UPHELD · +138..142/frame (never +1); ROM 0x02CD | high |
| `0x6018` | `RANDOM` | UPHELD · sub_0057 `0x6018 += 0x601A + 0x6019`; 2576 changes, full byte range | high |
| `0x6384` | `DIFFICULTY_PRESCALER` | UPHELD · +1/frame 700/700; ROM 0x037F | high |
| `0x6381` | `DIFFICULTY_CLOCK` | UPHELD · `base`: 257-frame cadence (f5,262,519,…), resets at board build | high |
| `0x6380` | `DIFFICULTY` | UPHELD · `base`: =1 on L1, resets to 0 at board build; ROM 0x038F | high |

## §7 Task scheduler

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x60C0-FF` | `TASK_RING` | UPHELD · `task`: slot 0x60C4/C5 FF→00/05→FF; boot fills 0xFF @ROM 0x0298 | high |
| `0x60B0` | `TASK_TAIL` | UPHELD · `task`: advancing to 0xC6 enqueued the entry; ROM 0x30A3 | high |
| `0x60B1` | `TASK_HEAD` | UPHELD · `task`: 0xC4→0xC6 the frame after dispatch; ROM 0x02BF | high |

## §8 Sound scheduler

| addr | name | verdict · how | conf |
|---|---|---|---|
| `0x6080-87` | `SND_TRIGGER[8]` | UPHELD(structure) · `base`: 3→2→1→0 countdown pattern; per-bit sound *names* inherited from `audio/README.md`, not independently re-derived | med |
| `0x6088` | `SND_IRQ_TRIGGER` | UPHELD(inferred) · same countdown shape; ROM 0x010E→0x7D80 | med |
| `0x6089` | `SND_BGM` | UPHELD · `base`: 0x08 from f1395 (25m theme); ROM 0x0102 | high |
| `0x608A` | `SND_PRIORITY` | UPHELD · `base`/`sub7`: 0x01(intro),0x0F(roar),0x02(level); ROM 0x0108 | high |
| `0x608B` | `SND_PRIORITY_FRAMES` | UPHELD · `base`: writes are 3 then 2,1,0 on consecutive frames; ROM 0x00FA | high |

---

# ram.js header comments (ready to paste above each constant)

The high-stakes `GAME_SUBSTATE` block is in the high-stakes section above. The rest:

```js
/** Top-level game state: 0 power-on, 1 attract, 2 credited, 3 in-game. NMI dispatches through the
 *  4-entry rst 0x28 table at ROM 0x00CA on this value. Observed: →1@f5, →2 at the coin frame, →3 at
 *  the start frame. */
export const GAME_STATE = 0x6005;

/** Non-zero while no credited game is in progress (attract). Gates the NMI joystick read
 *  (`jp nz` @ROM 0x0080), the sound driver (`ret nz` @0x00EA), and rst 0x08. 1 from power-on, 0 the
 *  frame a credit is accepted (@ROM 0x08BE), 1 again at game over. */
export const ATTRACT = 0x6007;

/** Frames remaining before the current sub-state may proceed; counts down 1/frame. rst 0x18
 *  (ROM 0x0018) decrements it and, unless it hit 0, discards the caller's remainder. The
 *  "wait N then go to sub-state M" idiom writes N here and M into 0x600A (the next byte). */
export const SUBSTATE_TIMER = 0x6009;

/** Prescaler paired with SUBSTATE_TIMER: rst 0x20 (ROM 0x0020) decrements this and, on underflow,
 *  falls into rst 0x18 to tick 0x6009. Low/fast half of the two-byte sub-state timer. */
export const SUBSTATE_TIMER_LO = 0x6008;

/** Step index of the opening Kong-climb cutscene; ROM 0x0A76 does `ld a,(0x6385) / rst 0x28` on it
 *  against the 8-entry table at 0x0A7A. Walks 1→7 over the cutscene (roar audio 0x608A=0x0F at
 *  step 7). Reached only while GAME_SUBSTATE (0x600A) == 7. */
export const INTRO_STEP = 0x6385;

/** Current board type: 1=25m girders, 2=50m conveyors, 3=75m elevators, 4=100m rivets. Re-derived
 *  from *BOARD_SEQ_PTR on every context restore (ROM 0x09B6/0x0A09). Per-board setup dispatch at
 *  ROM 0x0FCB. Proven: poking 1..4 selects the four boards; the sequence table pins the mapping. */
export const BOARD = 0x6227;

/** Level number, 1-based binary, clamped to 99 (`cp 0x64` @ROM 0x06E4). Bonus = min(10*LEVEL+40,80).
 *  Incremented once per completed level at ROM 0x1951 (`ld hl,0x6229 / inc (hl)`) when the board
 *  sequence hits its 0x7F terminator. */
export const LEVEL = 0x6229;

/** 16-bit ROM pointer (lo,hi) into the board-order table; init 0x3A65. Board-complete does
 *  `inc hl / ld a,(hl) / cp 0x7f`; on the 0x7F terminator it reloads 0x3A73 (start of the L5+ group),
 *  so levels 5+ repeat forever. The byte it points at is copied to BOARD. */
export const BOARD_SEQ_PTR = 0x622A; // +1 = high byte

/** Lives remaining for the player currently up; offset 0 of the live context (0x6228-0x622F).
 *  Init from DIP_LIVES; `dec (hl)` on death (ROM 0x12FC), `inc` on bonus-life award. Observed
 *  3@f463 → 2@f1957 one frame into the death sub-state. */
export const LIVES = 0x6228;

/** 1 = still play the opening cutscene for this player. Template value 1; zeroed by BOTH death
 *  handlers (ROM 0x12F6 `xor a / ld (0x622c),a`). ROM 0x0A71 reads it: non-zero advances 0x600A to
 *  sub-state 7 (cutscene), zero advances to 8 (how-high) — which is why post-death boards skip the
 *  intro. */
export const PLAY_INTRO = 0x622C;

/** Latch so the extra life is granted once per player. `ret nz` guards the score compare at
 *  ROM 0x0350; set to 1 the moment LIVES is incremented. 0 at each board start (not yet awarded). */
export const BONUS_LIFE_AWARDED = 0x622D;

/** Height index for the "HOW HIGH CAN YOU GET?" interlude, clamped to 5. Stepped when BOARD_SEQ_PTR
 *  differs from the copy in 0x622F; reset to 0 on level increment (ROM 0x195C). */
export const HOW_HIGH_INDEX = 0x622E;

/** Copy of BOARD_SEQ_PTR's low byte, used only to detect the pointer moved (ROM 0x0C11). */
export const HOW_HIGH_LAST_SEQ = 0x622F;

/** Player 1's saved 8-byte context (LIVES,LEVEL,SEQPTR_lo,SEQPTR_hi,PLAY_INTRO,BONUS_LIFE,
 *  HOW_HIGH_INDEX,HOW_HIGH_LAST_SEQ). `ldir`'d to the live block 0x6228 on restore (ROM 0x09AB) and
 *  from it on death (ROM 0x12FE). */
export const P1_CONTEXT = 0x6040;

/** Player 2's saved 8-byte context, same field order. Restore ldir at ROM 0x09FE (0x6048→0x6228),
 *  save at ROM 0x1350. NOTE: 0x6049/0x604A/0x604B are P2's saved LEVEL/SEQPTR — NOT board registers;
 *  move_suite pokes them so this ldir doesn't clobber the live poke on the next restore. */
export const P2_CONTEXT = 0x6048;

/** Rivets still in place on 100m; init 8 from ROM template 0x3DAC. `dec (hl)` per rivet removed
 *  (ROM 0x1A86); at 0 the board-complete test at ROM 0x1E80 forces GAME_SUBSTATE = 0x16. */
export const RIVETS_LEFT = 0x6290;

/** 8 per-rivet present flags (1 = still there) at 0x6292-0x6299; ROM 0x1A7B indexes 0x6292+b,
 *  tests+clears it, then decrements RIVETS_LEFT. (0x6291 sits just below and is NOT part of the array.) */
export const RIVET_PRESENT = 0x6292; // [8]

/** Bonus counter in units of 100 points (on-screen value = BONUS*100). Set at board start to
 *  min(10*LEVEL+40, 80); reaching 0 sets 0x6386=1. Ticks down via two mechanisms: the timed
 *  decrementer (boards 2/3/4, ROM 0x2FCB) or the barrel-release routine (board 1, ROM 0x2CB8). */
export const BONUS = 0x62B1;

/** The board's starting bonus, held constant for the whole board (denominator for barrel-release
 *  pacing at ROM 0x2C12/0x2C33 and the end-of-board tally). Written only at ROM 0x0F8E. */
export const BONUS_START = 0x62B0;

/** Frames between bonus ticks = max(0xDC - 2*bonus, 0x28); reload value for BONUS_TICK. Computed at
 *  ROM 0x0F97. Measured: L2→100, L3→80, L4→60 frames (metronomic on boards 2/3/4). */
export const BONUS_PERIOD = 0x62B3;

/** Countdown to the next bonus tick; reloaded from BONUS_PERIOD. ROM 0x2FCE `dec (hl) / ret nz`. */
export const BONUS_TICK = 0x62B4;

/** Next BONUS value at which the board's periodic spawn event fires; init to BONUS_START, stepped
 *  down by 8 on each match. ROM 0x2C57 `cp c / sub 0x08 / ld (0x62b2),a`. */
export const BONUS_EVENT_MARK = 0x62B2;

/** Small state machine (0-3) run by `ld a,(0x6386) / rst 0x28` at ROM 0x1A07; set to 1 by both
 *  bonus-decrement sites the moment BONUS hits 0. */
export const BONUS_EXPIRED_STEP = 0x6386;

/** Player 1 score: 3-byte LITTLE-endian packed BCD (0x60B4 = most-significant pair). Award opcode 0
 *  adds a 3-byte entry from the table at ROM 0x3529 (arg = index). Slot selected by sub_055f
 *  (ROM 0x055F) on 0x600D. Proven: award 5 (+500) landed in 0x60B3, the middle byte. */
export const P1_SCORE = 0x60B2;

/** Player 2 score, same 3-byte little-endian BCD format. sub_055f returns 0x60B5 when 0x600D != 0.
 *  Attract-mode placeholder is AA AA AA (ROM template 0x01BA). */
export const P2_SCORE = 0x60B5;

/** High score, same format; default 007650 from ROM template 0x01BA. Updated by the downward
 *  MSB-pair-first compare at ROM 0x0540; on a new high, 3 bytes are copied here. Proven: forcing
 *  P1 to 990500 overwrote this with 00 05 99. */
export const HIGH_SCORE = 0x60B8;

/** Extra-life threshold in BCD thousands: 0x07/0x10/0x15/0x20 = 7000/10000/15000/20000. Derived
 *  from DSW0 bits 2-3 at ROM 0x0214; compared against the score's thousands pair at ROM 0x036E. */
export const DIP_BONUS_LIFE = 0x6021;

/** Lives per game, 3-6, from DSW0 (ROM 0x020E `and 0x03 / add a,0x03`). Copied into LIVES at game
 *  start. DIP sweep: 0x80/81/82/83 → 3/4/5/6. */
export const DIP_LIVES = 0x6020;

/** Coins needed for a 1-player game — DISPLAY value only, written to VRAM 0x756C by ROM 0x07AD. */
export const DIP_COINS_FOR_1P = 0x6022;

/** Coins needed for a 2-player game — DISPLAY value only, written to VRAM 0x756E by ROM 0x07B1
 *  (with a tens-digit split for "10"). */
export const DIP_COINS_FOR_2P = 0x6023;

/** Coins the mechanism must swallow per credit group (ROM 0x01A2). Coin test: 3 coins at 3C/1C →
 *  1 credit, partial resets. */
export const DIP_COINS_PER_CREDIT = 0x6024;

/** Credits awarded per completed coin group (ROM 0x01A9). Coin test: 1 coin at 1C/2C → 2 credits. */
export const DIP_CREDITS_PER_COIN = 0x6025;

/** Cabinet: 1 = upright, 0 = cocktail (DSW0 bit 7, ROM 0x024F). Selects whether P2 reads IN1 in the
 *  NMI (`jp nz,0x0098` @0x0087); mirrored to the flip-screen latch 0x7D82. Sweep: 0x80→1, 0x00→0. */
export const DIP_UPRIGHT = 0x6026;

/** Credit count, BCD, capped at 0x90 (ROM 0x01AC). Consumed by the start handlers; while non-zero
 *  the attract handler advances GAME_STATE. Observed 0→1 at coin, →0 at start. */
export const CREDITS = 0x6001;

/** Coins accumulated toward the next credit; reset to 0 when it reaches DIP_COINS_PER_CREDIT
 *  (ROM 0x01A0). Coin test 3C/1C: 1,2 coins → 1,2; the 3rd rolls a credit and resets it to 0. */
export const COINS_PARTIAL = 0x6002;

/** Edge latch for the coin line (IN2 bit 7). Held 1 while no coin present; a coin counts only when
 *  it finds the latch set, then clears it — so holding the coin line does not repeat-credit
 *  (ROM 0x017B). Proven by the coin test: each pulse counted exactly once. */
export const COIN_EDGE = 0x6003;

/** Frame counter: DECREMENTED once per vblank NMI (ROM 0x00B5). Everything periodic keys off it
 *  (`and 0x0F`, `and 0x1F`, rst 0x30 guards). Measured: exactly -1 every frame. */
export const FRAME = 0x601A;

/** The main loop's latched copy of the last FRAME it serviced; the loop spins on
 *  `ld a,(0x601A) / cp (hl) / jr z` (ROM 0x02D1) — the wait-for-vblank. Byte-identical to FRAME at
 *  the frame boundary except on overrun frames. */
export const FRAME_SEEN = 0x6383;

/** Spin counter: incremented once per main-loop pass, ~140×/frame (NOT a frame counter). Its jitter
 *  with per-frame workload is the point — it feeds the PRNG. Measured +138..+142 in gameplay, never
 *  +1 (ROM 0x02CD). */
export const SPIN_COUNT = 0x6019;

/** Pseudo-random accumulator: sub_0057 (ROM 0x0057, called each vblank) does
 *  0x6018 += FRAME + SPIN_COUNT — a decrementing counter plus a jittery one. Read as entropy at
 *  ROM 0x2186 etc. Measured: 2576 changes over 2600 frames, full byte range. */
export const RANDOM = 0x6018;

/** Increments once per serviced frame; sub_037f (ROM 0x037F) returns unless it wrapped, so the block
 *  below runs every 256 frames. Measured +1/frame. */
export const DIFFICULTY_PRESCALER = 0x6384;

/** Increments every 256 frames; every 8th increment recomputes DIFFICULTY (ROM 0x0386). Reset at
 *  board start. Measured: 257-frame cadence, resets when the board is built. */
export const DIFFICULTY_CLOCK = 0x6381;

/** Difficulty ramp = min(LEVEL + (DIFFICULTY_CLOCK >> 3), 5) — rises with level AND time on board
 *  (ROM 0x038F). Consumed by barrel/enemy behaviour (ROM 0x2186 etc). =1 on level 1. */
export const DIFFICULTY = 0x6380;

/** Task ring: 32 slots × 2 bytes [opcode, argument] at 0x60C0-0x60FF. 0xFF opcode = free (boot fills
 *  all 64 bytes 0xFF, ROM 0x0298; the dispatcher writes 0xFF back on consume). Opcode 0 = add-to-
 *  score. Proven by injecting (0,5) and watching P1_SCORE = 000500. */
export const TASK_RING = 0x60C0;

/** Enqueue pointer — low byte of an address in page 0x60. sub_309f writes [D,E] at 0x6000+TAIL and
 *  advances by 2, wrapping 0xFE→0xC0 (ROM 0x30A3); a full slot silently drops the request. Init 0xC0. */
export const TASK_TAIL = 0x60B0;

/** Dequeue pointer, same encoding. The main loop reads (0x6000+HEAD); 0xFF opcode = "no task".
 *  Advances by 2 after dispatch (ROM 0x02BF). Proven: 0xC4→0xC6 the frame after a task ran. */
export const TASK_HEAD = 0x60B1;

/** 8 per-latch-bit sound trigger counters at 0x6080-0x6087 (ls259.6h). sub_00e0 (ROM 0x00E0, per
 *  NMI) walks them with 0x7D00-0x7D07: non-zero → decrement and assert the bit, zero → deassert.
 *  Game code stores 3 (a 3-frame assert). Per-bit sound names are audio/README.md's, not re-derived. */
export const SND_TRIGGER = 0x6080; // [8]

/** Same countdown shape, driving the I8035 sound-CPU interrupt line at 0x7D80 (ROM 0x010E). */
export const SND_IRQ_TRIGGER = 0x6088;

/** Background tune index → 0x7C00 while SND_PRIORITY_FRAMES is 0; held, so the tune loops
 *  (ROM 0x0102). Observed 0x08 (25m theme) from f1395 on board 1. */
export const SND_BGM = 0x6089;

/** Priority tune index → 0x7C00 while SND_PRIORITY_FRAMES != 0, overriding SND_BGM (ROM 0x0108).
 *  Observed 0x01 (intro) then 0x0F (roar) during the cutscene, 0x02 at level start. */
export const SND_PRIORITY = 0x608A;

/** Countdown for SND_PRIORITY; game code stores 3, so a priority tune is a 3-frame pulse
 *  (ROM 0x00FA). Observed writes are 3 then 2,1,0 on consecutive frames. */
export const SND_PRIORITY_FRAMES = 0x608B;
```

---

# Notes for the next reviewer

- **Nothing was DOWNGRADED or REFUTED among the drafter's proposals.** The single REFUTATION targets
  the *older* project belief ("0x600A = rescue flag"), and the drafter is the one correcting it.
- **Lowest-confidence rows to keep an eye on:** `0x6008` (paired-timer LO half — right by ROM
  structure but I never caught it decrementing; the observed sub-state waits ran through rst 0x18 on
  0x6009 directly), and the `SND_TRIGGER[8]` per-bit sound *names* (inherited from `audio/README.md`,
  not independently re-derived here — the countdown *structure* is confirmed).
- **The little-endian BCD fact is load-bearing** and now double-proven (task award landed in base+1;
  high-score MSB pair landed at the top address). Any score edit must respect it.
