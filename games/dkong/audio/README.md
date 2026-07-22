# games/dkong/audio/ — what Donkey Kong's sound writes mean

Audio here is a layer **above** emulation. We do not emulate the I8035 sound CPU and we do
not simulate the discrete analog sound circuits. We watch the Z80's writes to the sound
hardware and play a named sample. This directory answers the prerequisite question: **what
does each of those writes actually mean?**

`sounds.js` is the machine-readable answer (data only, no logic, no imports). This file is
the argument behind it, the provenance, and — most importantly — the part the next piece of
work depends on: **which sounds have sample bytes somewhere and which have none at all.**

Everything below was established three independent ways and cross-checked:

- **(a) MAME 0.288 source**, at `~/src/mame0288` — `src/mame/nintendo/dkong.cpp`,
  `dkong_a.cpp`, `src/devices/machine/latch8.cpp`. Cited as `file:line`.
- **(b) Real ROM write traces** captured from MAME 0.288 with this repo's own tooling
  (`tools/mame_golden.py --writes`) over six input tapes. These say **when the game writes
  what**, which is what lets a write be *named*. Cited as `trace <tape>`.
- **(c) A direct stimulus sweep** of the sound hardware on real MAME 0.288 (from the
  sample-recorder work). This says **which writes make sound and how they behave**, but it
  names nothing. Cited as `stimulus sweep`.

(b) and (c) do different jobs and neither substitutes for the other. A name without (a) or
(b) is a guess; a `kind` without (c) is a guess.

---

## The hardware surface

Three write surfaces, all already declared in `boards/dkong/hardware.json` and already
routed by `boards/dkong/memory.js` → `boards/dkong/io.js`:

| address | device | engine hook | what a write does |
|---|---|---|---|
| `0x7C00` | ls175.3d | `io.writeSoundLatch3d(v)` | selects one of 16 **tunes** for the I8035 |
| `0x7D00`–`0x7D07` | ls259.6h | `io.writeSoundLatch6h(bit, v & 1)` | sets latch bit `n` from the value's LSB |
| `0x7D80` | (write side) | `io.writeAudioIrq(v & 1)` | asserts/clears the I8035's **interrupt** line |

Reads at `0x7C00` / `0x7D00` / `0x7D80` are `IN0` / `IN2` / `DSW0` — different devices at the
same addresses. That is already handled by the board; it is restated here because it is the
easiest way to misread a trace.

### The eight ls259.6h bits do not all go to the same place

This is the single most important structural fact, and it is not visible from the address map:

```
dkong_a.cpp:1322-1350  (dkong2b_audio)
  bit 0  -> discrete DS_SOUND0_INP     analog circuit   "walk"
  bit 1  -> discrete DS_SOUND1_INP     analog circuit   "jump"
  bit 2  -> discrete DS_SOUND2_INP     analog circuit   "boom"/stomp
  bit 3  -> virtual port2 bit5 -> I8035 P2.5            CPU INPUT PIN
  bit 4  -> I8035 T1 (inverted)                         CPU INPUT PIN
  bit 5  -> I8035 T0 (inverted)                         CPU INPUT PIN
  bit 6  -> discrete DS_SOUND6_INP     ** node does not exist in dkong2b_discrete **
  bit 7  -> discrete DS_SOUND7_INP     ** node does not exist in dkong2b_discrete **
```

Bits 0–2 are the *only* discrete-analog sounds. Bits 3–5 are **input pins the sound CPU
polls**; whatever they produce is I8035 code. Bits 6–7 are wired in the machine config only
because `radarscp_audio` derives from `dkong2b_audio` — `dkong2b_discrete` declares inputs for
`SOUND0/1/2` and `DISCHARGE` only (`dkong_a.cpp:349-353`), and a discrete write to a
non-existent node is a logged no-op (`discrete.cpp:1098-1115`).

The stimulus sweep independently confirms the last point: bits 6 and 7 are **measured silent**,
and holding either high across a full latch sweep produced 14/14 byte-identical clips — so they
are not hidden mode, bank or page selects either.

### How the ROM drives all of this

Game code never touches the latches. It writes a scheduling block in RAM, and one service
routine (ROM `0x00E0`, called from the NMI at `0x00BF`) pushes it to hardware once per frame:

| RAM | meaning |
|---|---|
| `0x6080`–`0x6087` | per-trigger frame counters. Nonzero → decrement, write `1` to `0x7D00+n`; zero → write `0`. Game code stores **3**. |
| `0x6088` | same, for the `0x7D80` IRQ line |
| `0x6089` | **background** tune → `0x7C00` whenever `0x608B == 0`. Held ⇒ loops. |
| `0x608A` / `0x608B` | **priority** tune + frame count; overrides `0x6089` while `0x608B != 0`. Game code stores 3 ⇒ a 3-frame pulse. |
| ROM `0x011C` | silence-everything: zeroes `0x7D00`–`0x7D07`, `0x7D80`, `0x7C00` and `0x6080`–`0x608B` |

One hardware wrinkle: `ls175.3d` is configured `maskout 0xF0` / `xorvalue 0x0F`
(`dkong_a.cpp:1318-1320`), applied **on read**, so **only the low nibble is significant** and
the I8035 sees its one's complement. The sweep confirms this from the outside: `0x10`–`0x1F`
mirror `0x00`–`0x0F`; `0x20`/`0x40`/`0x80` behave exactly like `0x00`; `0xFF` (2.007 s) matches
`0x0F` (2.010 s). `sounds.js` keys on the value the **Z80 writes**, which is what a JS player
observes.

Also measured, and worth knowing before writing a player: **the latch write itself drives the
sound CPU.** Muting the `0x7D80` IRQ line and re-running the whole tune sweep gave 14/14
byte-identical clips, so the ROM's audio-IRQ pulses are not what starts a tune. `0x7D80` is its
own separate event.

### `kind` vs `measured` — do not conflate them

`sounds.js` carries two different classifications, on purpose:

- **`kind`** — how the **ROM uses** the command. `oneshot` = fired as a 3-frame pulse;
  `loop` = parked in the background slot `0x6089` and held until the ROM changes it.
- **`measured`** — what the **hardware does** under direct stimulus. `behaviour: "level"`
  means the clip length tracks how long the bit is held; `"oneshot"` means the hold length is
  irrelevant.

They differ, and that difference is the thing a player has to get right:

| line | ROM usage | hardware | what a player must do |
|---|---|---|---|
| `0x7D00` walk | 3-frame pulse | **level** (0.37 s @ 0.25 s hold → 3.13 s @ 3.0 s) | **gate** a sample on the bit |
| `0x7D01` jump | 3-frame pulse | **one-shot**, 0.51 s fixed | fire on the rising edge, let it run |
| `0x7D02` boom | 3-frame pulse | **one-shot**, 1.825 s fixed | fire on the rising edge, let it run |
| `0x7D03` coin/spring | 3-frame pulse | **level** (0.574 s → 3.095 s) | gate |
| `0x7D04` falling | 3-frame pulse | **level + decay tail** (1.649 s → 4.587 s) | gate, then let the ~1.4 s tail finish |
| `0x7D05` item/score | 3-frame pulse | **level** (0.794 s → 3.252 s) | gate |

So the earlier intuition that "the 3-frame hold is a handshake, not a duration" is **only true
for jump and boom**. For the four level-driven lines the hold *is* part of the duration, and
the ROM's 3-frame (≈0.05 s) hold is exactly what turns a level-driven oscillator into a
footstep-length blip.

---

## CONFIRMED — trigger lines (`0x7D00`–`0x7D07`)

Six of the eight make sound. "Silent" below is *measured*, not assumed: the per-run noise floor
was peak 1.1 / rms 0.7 out of 32767, with the detection threshold 35 dB above it, and the whole
sweep is reproducible (same sweep twice → byte-identical output).

| bit | name | source | hardware | peak | what it is | naming evidence |
|---|---|---|---|---|---|---|
| 0 | `walk` | **discrete** | level | 14222 | one per footstep | `dkong_a.cpp:1323`, `dkong.cpp:194`; trace `coin_start` play-mode — rises every 12 frames *only* while Right is held |
| 1 | `jump` | **discrete** | one-shot | 4532 | Mario leaves the ground | `dkong_a.cpp:1324`, `dkong.cpp:195`; trace `coin_start` play-mode — rises every 48 frames, exactly the tape's `JUMP_PERIOD` |
| 2 | `boom` | **discrete** | one-shot | 12093 | Kong's stomp/chest-pound; a barrel dropping into the oil drum; Kong's landing thud | `dkong_a.cpp:1325`, `dkong.cpp:196`; trace — 6 rises during the intro climb, then every 32 frames on 50m/75m/100m while Kong pounds |
| 3 | `coin_or_spring` | **I8035** (P2.5) | level | 16193 | coin insert; each 75m spring | `dkong_a.cpp:1338`, `dkong.cpp:197`; trace — rises at frame ~404 in *every* capture (the tape's coin frame), and 147× at ~25-frame spacing on 75m |
| 4 | `falling` | **I8035** (T1) | level + decay | 12212 | Kong's fall at the rivet ending; Mario falling too far; a spring dropping off the edge | `dkong_a.cpp:1350`, `dkong.cpp:198`; trace `level3_full` — 48 rises, every 80 frames, 5 frames before a spring |
| 5 | `item_or_jump_score` | **I8035** (T0) | level | 20176 | hammer/prize pickup; scoring for a jumped-over barrel | `dkong_a.cpp:1349`, `dkong.cpp:199`; trace `test_hammer_25m_lower` (rises 29 frames before the hammer music) and `test_prize_50m_hat` (rises at the prize pickup) |
| 6, 7 | unused on this board | none | **silent** | — | no effect | `dkong_a.cpp:349-353`; ROM never writes `0x6086`/`0x6087`; trace — written once each, with 0, by the boot silence routine; sweep — silent, and inert as a modifier |

A control run also showed bit 5 produces **its own** sound rather than acting as a strobe for
the tune latch (`latch 0x00 + trig5` ≈ `trig5` alone, 0.793 s vs 0.794 s) — which is what
`sounds.js` claims for it.

ROM sites for each are listed in `sounds.js`.

## CONFIRMED — the IRQ line (`0x7D80`)

`death` — the only event on this line. Writing nonzero asserts the sound CPU's interrupt
(`dkong_a.cpp:1257-1263`); `dkong.cpp:202` labels it "dead"; ROM `0x12A8` is the sole writer
(the death state `entry_128B`). Trace `coin_start` idle-90s: exactly 3 rises in 90 s — one per
life — each ~64 frames after the `boom` that killed Mario.

**The death tune is not a tune-latch value, and looking for one is a dead end.** Worth stating
because the assumption is natural: every other tune comes out of `0x7C00`, so surely one of its
16 values is "death". A `--writes` trace of an actual death (`coin_start`, idle, 45 s) says no:

```
frame 1661.3   7C00 <- 00     the hit: the board's background music is silenced
frame 1726.1   7D80 <- 01     65 frames later: the sound CPU's interrupt is asserted
frame 1729.1   7D80 <- 00     3 frames (~50 ms) later: released
```

No `0x7C00` value is written between the silence and the IRQ pulse. Death is the IRQ line.

**Measured, no longer open.** The recorder now has an `irq` phase that drives `0x7D80` directly
with the ROM muted off the sound hardware. Driving it alone produces a **3.245 s** tune, peak
20618 — so `measured.audible` is `true` and the waveform is recorded (`irq.wav`). Held for 24 s
it repeats (24.22 s), which is what every I8035 tune does under a sustained line and which the
ROM never asks for; the ROM's hold is 3 frames.

That 3-frame hold is a **handshake, not a duration**: the tune is ~65× longer than the hold, so
a player that stops it when the line drops replaces the death tune with a ~50 ms click. This is
the same shape of mistake as gating `jump` or `boom`, and the opposite of the *correct* rule for
`walk` — see the `kind` vs `measured` table above, and the playback rules below.

## Tune codes (`0x7C00`) — 4 bits, all I8035

Measured: `0x00` and `0x0A` are silent; the other 14 values each produce a **distinct** sound.

### Two stimulus passes, because one cannot tell a background from a jingle

Every tune value is driven twice: a **0.25 s pulse** and a **24 s hold**. That is not
redundancy — it is the measurement that separates the two things `kind` claims:

* Five values, and exactly five — `0x03`, `0x04`, `0x08`, `0x09`, `0x0B` — **stop when the
  latch is released**. Their pulse clip is the length of the pulse (0.11–0.38 s) and their hold
  clip runs the full 24 s. These are *sustained* tunes: the latch is what keeps them going.
* The other nine **outlast the pulse by many times** and finish on their own (0.75 s–6.86 s
  from a 0.25 s pulse). These are self-contained tunes; the pulse is a handshake.

Those five are precisely the five this map calls `kind: "loop"`, derived independently from the
ROM parking them in the background slot `0x6089`. **Two unrelated methods agreeing** is the
strongest statement here about `kind`. It says nothing about any *name*, so no `confidence`
moves because of it.

One curiosity worth recording: holding a *self-contained* tune replays it, because the 8035
re-reads the latch when a tune ends. `0x0D` is the single exception — 0.749 s from a pulse,
0.786 s from a 24 s hold. It plays once and stays quiet.

### The phrase length is measured, and it is what a looping clip must be

For the five sustained tunes, the recorder finds the **repeating phrase** by normalised
autocorrelation over the 24 s hold and cuts the clip to exactly one period:

| value | name | phrase | corr | notes in the phrase | the old pulse clip |
| --- | --- | ---: | ---: | ---: | --- |
| `0x03` | `out_of_time` | **4.9192 s** | 0.94 | 42 | 0.394 s — 8 % of it |
| `0x04` | `hammer` | **2.9515 s** | 0.96 | 18 | 0.365 s — 12 % |
| `0x08` | `bgm_25m` | **2.2949 s** | 1.00 | 10 | 0.243 s — 11 %, **1 note** |
| `0x09` | `bgm_50m` | **1.3523 s** | 1.00 | 9 | 0.305 s — 23 % |
| `0x0B` | `bgm_100m` | **3.9338 s** | 1.00 | 24 | 0.221 s — 6 %, **1 note** |

The right-hand column is a defect, not trivia: the clips shipped before this measurement were
recorded at the 0.25 s pulse, so each was a **fragment** of its phrase, and the player looped
the fragment. That is what "the background music is missing notes" was.

Two things had to be got right, and both are measurements rather than guesses:

* **The hold must be long enough.** At a 12 s hold, `0x0B`'s phrase estimate was unstable —
  1.4757 s in one slot and 3.9338 s in another (1.4761 s is a strong *sub*-phrase peak at
  corr 0.986, against 0.9999 for the real one). The search cap is a quarter of the hold, so the
  answer is always something seen at least four times, and 24 s is the first hold at which
  every tune on this board pinned. Cross-check: `0x10`–`0x1F` mirror `0x00`–`0x0F` on the
  hardware, and the two independent recordings of each tune in one sweep now agree to the
  sample (4.919/4.919, 2.951/2.952, 2.295/2.295, 1.352/1.352, 3.934/3.934).
* **The fundamental, not a note.** A musical phrase autocorrelates strongly at note spacings
  too. `0x0B`'s peaks are on a 0.4917 s grid; taking the smallest strong one would loop a
  single note. The search takes the global maximum and then checks only whole sub-multiples
  (L/2…L/5), which is how a *multiple* of the true period is rejected without falling for a
  *fraction* of it.

Seam check on the cut clips: the wrap discontinuity is 0.11 %–1.31 % of peak amplitude, and the
50 ms after the loop point matches the 50 ms that would have followed in the continuous
recording. They join.

| value | name | kind | confidence | audible? | meaning |
|---|---|---|---|---|---|
| `0x00` | `silence` | none | **CONFIRMED** | silent | no tune / stop the loop |
| `0x01` | `intro` | one-shot | **CONFIRMED** | yes | the Kong-climbs opening, right after Start |
| `0x02` | `level_start` | one-shot | **CONFIRMED** | yes | "How High Can You Get?" / start-of-board cue — fires once per life |
| `0x03` | `out_of_time` | loop | *INFERRED* | yes | bonus timer's high digit hits 0 |
| `0x04` | `hammer` | loop | **CONFIRMED** | yes | while a hammer is active; the previous BGM is saved in `0x6389` and restored |
| `0x05` | `rivet_end_even` | one-shot | *INFERRED* | yes, **6.79 s** | rivet-board ending, completed-board counter `0x6229` even |
| `0x06` | `hammer_hit` | one-shot | *INFERRED* | yes | hammer smashes a barrel/fireball |
| `0x07` | `level_end` | one-shot | *INFERRED* | yes | reaching Pauline on 25m/50m/75m |
| `0x08` | `bgm_25m` | loop | **CONFIRMED** | yes | board type `0x6227 == 1` (girders/barrels) |
| `0x09` | `bgm_50m` | loop | **CONFIRMED** | yes | board type 2 (conveyors / "pie factory") |
| `0x0A` | `bgm_75m` | loop | **CONFIRMED (binding)** | **SILENT — see conflict below** | board type 3 (elevators/springs) |
| `0x0B` | `bgm_100m` | loop | **CONFIRMED** | yes | board type 4 (rivets) |
| `0x0C` | `rivet_end_odd` | one-shot | *INFERRED* | yes, **6.82 s** | rivet-board ending, `0x6229` odd |
| `0x0D` | `rivet_removed` | one-shot | *INFERRED* | yes | Mario pops a rivet out |
| `0x0E` | `rivet_stage_cleared` | one-shot | *INFERRED* | yes | last rivet gone — step 0 of the Kong-falls sequence |
| `0x0F` | `roar` | one-shot | **CONFIRMED** | yes, 2.010 s | Kong's roar at the end of the opening climb |

Every value in the table has a located ROM write site (in `sounds.js`). The **CONFIRMED** ones
were additionally *observed being written by the game* in a MAME trace; the *INFERRED* ones
were not, because no tape in this repo completes a board, runs the bonus timer out, or hits
something with a hammer — their meaning is read off the surrounding ROM code and agrees with
MAME's comment block. That is good evidence. It is not the same as having watched it happen.

The sweep raises no confidence on its own: knowing `0x06` makes *a* sound does not tell you it
is the hammer hit. It does add one nice piece of *supporting* evidence: `0x05` and `0x0C` are
the two longest sounds on the entire latch (~6.79 s and ~6.82 s), which is what an end-fanfare
**pair** should look like and what two unrelated effects should not — consistent with the ROM
site, where a single instruction picks between them on the parity of `0x6229`.

---

## Where the evidence disagrees

Reported, not resolved. Picking a winner silently is how a wrong map gets believed.

### 1. `0x0A` — the driver and the ROM say "75m background music"; the hardware says silence

- **For the name:** `dkong.cpp:187` calls it "Background 3 (springs)"; ROM `0x0CF7` writes it
  into the *background* slot on the `0x6227 == 3` arm of the board-setup dispatch; and trace
  `level3_full` shows `0x7C00` held at `0x0A` for the entire 75m board.
- **Against it making a sound:** the stimulus sweep found `0x0A` to be the **only** value
  besides `0x00` that produces no audio — measured against a floor 35 dB below the detection
  threshold, reproducibly.

Both can be true at once. Either (a) the 75m board genuinely has no background track and `0x0A`
is a documented no-op the game still selects, or (b) tune `0x0A` needs I8035 state that an
isolated latch poke does not set up. **What is confirmed is the binding** (`0x0A` is what the
game writes for 75m); **what is contradicted is that it is music.** The way to settle it is to
record audio from a real 75m playthrough, not to reason about it further. Until someone does,
a player should expect silence there and must **not** ship a fabricated 75m theme.

### 2. `dkong.cpp:217-218` on the 8035's `P2.5` and `T0`

The header says `P2.5` is "active low when jumping" and `T0` "select sound for jump (Normal or
Barrell?)". The ROM does not support this. `P2.5` is ls259.6h bit 3, which the ROM drives from
the **coin** routine (`0x019A`, right after the `IN2` bit-7 coin read at `0x017B`) and from the
**spring** object (`0x2EA1`) — never from jumping. Jumping is bit 1, which goes to a discrete
circuit and never reaches the 8035. Similarly `T0` (bit 5) is driven as a discrete event by the
pickup/score routines (`0x295F`, `0x1DE2`, `0x1E44`), and the sweep's control run shows it
produces its own sound rather than modifying anything. The traces agree with the ROM: `7D03`
rises at the tape's coin frame in every capture and 147× on the spring board; `7D05` rises once
at a hammer grab and once at a prize pickup. **We follow the ROM.** Note `dkong.cpp:111` marks
that whole comment block "(preliminary)", and its *memory-map* half (`7d03 coin input/spring`,
`7d05 barrel jump/prize`) matches the ROM exactly — it is only the 8035 pin notes that don't.

### 3. MAME's "Background 1/2/3/4" tune names

`dkong.cpp:185-188` calls `0x08/0x09/0x0A/0x0B` "Background 1 (barrels) / 4 (pie factory) /
3 (springs) / 2 (rivets)". Those numbers are not the height order and reading them as such will
produce a wrong map. Go by `0x6227`, which the traces pin directly: `08→25m`, `09→50m`,
`0A→75m`, `0B→100m`.

---

## The part that decides the next piece of work: sample bytes vs. no sample bytes

### Discrete analog — **there is no sample data anywhere, in any ROM**

`walk` (`0x7D00`), `jump` (`0x7D01`) and `boom` (`0x7D02`) are **analog circuits** on the
sound board. MAME models them as a discrete netlist:

- walk — 4049 inverter oscillator → 555 VCO → RC trigger, `dkong_a.cpp:415-436`
- jump — 4049 inverter oscillator → 555 VCO → RC trigger, `dkong_a.cpp:378-410`
- boom — LFSR noise → LS161 divider → RC envelope, `dkong_a.cpp:356-376`

There are no bytes to extract. A sample for these must be **recorded** — from a real machine,
from MAME's own audio output, or generated by porting the netlist. This is three sounds, and
they are the three most frequently heard ones in the game. Note also that walk is level-driven,
so "a sample" for it is really a loopable body plus an attack/release, not a fixed clip.

### I8035 + its ROMs — bytes exist, but mostly as *program*, not as *audio*

Everything else — all 16 tune codes on `0x7C00`, the `death` IRQ on `0x7D80`, and the three
flag lines `0x7D03`/`0x7D04`/`0x7D05` — is produced by the **I8035** (an MB8884 in MAME,
`dkong_a.cpp:1341`) writing an 8-bit DAC through port P1 (`dkong_a.cpp:1245-1248`,
`dkong_p1_w` → `DS_DAC`). Its two ROMs, from the `dkong` romset (`dkong.cpp` `ROM_START(dkong)`):

| part | size | CRC32 | role |
|---|---|---|---|
| `s_3i_b.bin` | 2048 B | `45a4ed06` | I8035 **program** ROM (mirrored to fill `0x0000`–`0x0FFF`) |
| `s_3j_b.bin` | 2048 B | `4743fe92` | banked **sample** ROM at `0x1000`, read 256 bytes at a time |

The sample ROM is reached only when port-2 bit 6 is set: `dkong_tune_r` then returns
`m_snd_rom[0x1000 + (page & 7) * 256 + offset]` (`dkong_a.cpp:1230-1243`); otherwise the same
read returns the tune latch. MAME documents that second ROM as *"Compressed sound sample
(Gorilla roar in DKong)"* (`dkong.cpp:213`).

So, concretely:

- **`roar` (`0x0F`)** is the one Donkey Kong sound that plausibly has real sample bytes — 2 KB
  of them, in a packed format that would have to be decoded. (Measured length 2.010 s; 2 KB of
  raw 8-bit PCM at any plausible rate is far shorter than that, which is itself evidence the
  data is packed rather than PCM.)
- **The music and jingles** (`0x01`–`0x0E`) are *synthesised by the 8035 program*. There is no
  waveform in the ROM to lift; producing them from ROM data means emulating the 8035, not
  extracting a file.
- **`coin_or_spring`, `falling`, `item_or_jump_score`, `death`** are likewise 8035 output.

Practical consequence: **for a sample-player, every Donkey Kong sound has to be recorded or
synthesised.** Nothing here is a "rip the samples out of the ROM" job. The only thing the ROM
buys you is `roar`, and only if someone decodes the packing.

Also note: this project's `games/dkong/rom/` does **not** currently build or ship the sound
ROMs at all. `games/dkong/manifest.js` assembles `maincpu`/`gfx1`/`gfx2`/`proms` only, so even
`s_3j_b.bin`'s bytes are not available to the engine today. Adding them is a manifest change,
not a research problem.

## What is genuinely UNKNOWN

- **Whether `0x0A` is silence-by-design or a measurement artefact** (conflict 1 above). This is
  the biggest open question in the map.
- **What the 8035 does with `T0`, `T1` and `P2.5`** internally — whether each starts its own
  sound or selects a variant of one. The sweep shows each produces audio and follows the level;
  it does not show what the program is doing. Settling that needs a disassembly of
  `s_3i_b.bin`, which has not been done.
- **Whether any tune other than `roar` reads the `s_3j_b.bin` sample ROM.** MAME's comment
  attributes it to the roar; nothing rules out other uses. Same disassembly would settle it.
- **The musical identity of `0x05` vs `0x0C`** — two rivet-ending tunes selected by the parity
  of the completed-board counter `0x6229` (ROM `0x1913`). We know the branch and we know both
  are ~6.8 s long; we have never heard either in context.
- **What `0x7D80` sounds like on its own** — never driven in isolation (see above).
- **Per-tune durations** for most latch values. Only `0x05` (6.79 s), `0x0C` (6.82 s) and
  `0x0F` (2.010 s) were reported individually; the rest are known only to fall in
  0.221 s–6.818 s.

## Empirical basis

**ROM write traces** — six captures, MAME 0.288, `tools/mame_golden.py --writes` +
`tools/writeio.py` decoding, with transitions extracted from the raw write stream (the ROM
rewrites the latches every frame, so only the *changes* are events):

| tape | seconds | what it pinned |
|---|---|---|
| `coin_start` (idle) | 35, 90 | boot silence, coin, intro, 6 stomps, roar, level-start, 25m BGM, death ×3 |
| `coin_start` (`TAPE_MODE=play`) | 90 | walk (10 rises), jump (60 rises, exactly on the tape's 48-frame period) |
| `level3_full` | 90 | 75m BGM `0x0A`, spring `7D03` ×147, falling `7D04` ×48 |
| `level4_full` | 90 | 100m BGM `0x0B`, Kong pounding `7D02` ×47 |
| `test_hammer_25m_lower` | 60 | `7D05` at the grab, tune `0x04` held for the hammer's life, revert to `0x08` |
| `test_prize_50m_hat` | 60 | 50m BGM `0x09`, `7D05` at the prize pickup |

Tune values `0x03`, `0x05`, `0x06`, `0x07`, `0x0C`, `0x0D`, `0x0E` were **never observed being
written by the game** — no tape completes a board, empties the bonus timer, or lands a hammer
blow. They are marked `inferred` in `sounds.js` and should stay that way until a tape reaches
them.

**Stimulus sweep** — from the sample-recorder work: each trigger bit and each latch value
driven directly on real MAME 0.288 with the `dkong` ROM and the audio recorded, with holds of
0.25 s and 3.0 s to separate level-driven from one-shot behaviour. Noise floor peak 1.1 / rms
0.7 out of 32767, detection threshold 35 dB above it, sweep reproducible byte-for-byte across
runs. Controls: `0x7D80` muted during the latch sweep (14/14 identical ⇒ the latch write drives
the sound CPU); `0x7D06`/`0x7D07` held high across the latch sweep (14/14 identical ⇒ genuinely
inert); `latch 0x00 + trig5` vs `trig5` alone (⇒ bit 5 is a sound, not a strobe).

## Consistency gate

`games/dkong/test/audio-map.test.js` asserts the map's internal shape (names present and
unique, trigger indices 0–7 complete, `kind`/`source`/`confidence`/`measured.behaviour` from
the allowed sets, latch keys `0x00`–`0x0F` complete, the discrete/I8035 split matching
`dkong_a.cpp`, and that a `confirmed` entry carries at least two citations). It needs no ROM
and no audio; it cannot check that the map is *right*, only that it is *well-formed and
internally coherent*.

---

# How it is wired

Everything above is *what the writes mean*. This section is *how the running game turns them
into sound*. Five files, four layers, and one deliberately thin wire between the emulation and
everything else.

```
Z80 (translated)  ─write 0x7C00 / 0x7D00-07─▶  boards/dkong/io.js
                                                  io.onSoundWrite   ← THE WIRE (nullable)
                                                        │
                                          web/worker.js │  edge-filter, batch per frame
                                                        ▼
                                     postMessage {type:"sound", ev:[addr,value,…]}
                                                        │
                                          web/player.html  resolve through ▶ audio/sounds.js
                                                        ▼
                                              core/audio.js  SamplePlayer
                                                        ▼
                                       audio/samples/*.wav   (yours, gitignored, usually absent)
```

## 1. The tap — `boards/dkong/io.js`

```js
io.onSoundWrite = (addr, value) => { … };   // default: null
```

Called **after** the latch has been updated, for writes to `0x7C00` and `0x7D00`–`0x7D07` and
nothing else. `value` is what the device stored, so the ls259 arm reports the masked bit (0 or
1), not the raw byte.

It is **zero-cost when unset**, which is the property the whole design depends on:

* Both call sites (`writeSoundLatch3d`, `writeSoundLatch6h`) were *already* functions reached
  only by those exact addresses — `boards/dkong/memory.js` routes them there. So the tap adds
  no dispatch and no branch anywhere else on the write path. An ordinary RAM, VRAM, sprite-RAM
  or control-latch write never even loads the field.
* When null the added work is one monomorphic field load and one `!== null` compare, per sound
  write. DK makes about ten of those per frame, out of 50 688 cycles.
* Nothing is allocated — here or in the caller.
* It **cannot** change emulation: it runs after the store, its return value is discarded, and
  it only ever sees values the machine has already committed. The one way a listener could
  perturb a frame is by throwing, so the contract is that it must not.

`0x7D80` is **not** tapped. It is the I8035's IRQ line — the `death` entry above — but it
shares its address range with flipscreen, the NMI mask and the DMA DRQ, and no recorder phase
captures it, so there is no clip it could ever play. Wiring it would be dead weight on the
write path.

The proof that it is inert is not an argument, it is the gates: `move_suite.py` (6/6) and
`prize_suite.py` (9/9) run the real ROM and fail on *any* rendering change.

## 2. Edges, not writes — `web/worker.js`

The tap is armed **only** after the page says it has samples (`postMessage {type:"audio",
enabled:true}`). With no samples the message is never sent, `io.onSoundWrite` stays null, and
the engine is byte-for-byte what it was.

When armed, the worker keeps the last value seen per latch and forwards only **changes**. That
is not an optimisation, it is the correct semantics: the ROM's sound service routine (`0x00E0`,
called from the NMI) rewrites all nine latches *every frame*, so the raw stream is ~600
writes/second of mostly-nothing, while what a player needs is exactly the 0→1 and 1→0 edges.
Edges are batched and posted once per frame, next to the framebuffer publish. **No audio data
crosses the worker boundary** — only `(addr, value)` pairs.

## 3. Resolution and playback — `web/player.html`

The page is game-agnostic: it reads `manifest.audio` (`map`, `samples`, `clipIds`) exactly the
way it reads `manifest.inputs`, and hardcodes no Donkey Kong value. It then makes three
decisions, all from data in `sounds.js`:

| decision | field it uses | why that one |
| --- | --- | --- |
| play this at all? | `kind`, `measured.audible`, `conflict` | anything `none`, measured silent, or flagged conflicting is **skipped** |
| trigger: gate or fire? | `measured.behaviour` | what the **hardware** does |
| tune / IRQ: loop or one-shot? | `kind` | how the **ROM** uses the command |

The middle two rows are the `kind`-vs-`measured` distinction this README argues for above, and
they are used on purpose in opposite places. Concretely:

* `behaviour: "level"` (walk, coin/spring, item/score) → started on the rising edge, `stop()`ed
  on the falling one.
* `behaviour: "level+decay"` (falling) → started on the rising edge and **not** stopped: the
  map measures its clip outlasting the hold by ~1.4 s, so that tail is part of the sound.
* `behaviour: "oneshot"` (jump, boom) → fired on the rising edge and left to run.
* `kind: "loop"` (the BGMs, hammer, out-of-time) → played looping, and stopped the moment the
  tune latch changes to anything else — including `0x00`, which is "no tune". At most one of
  these sounds at a time: it is *the background*, and a latch write replaces it.
* `kind: "oneshot"` on the latch (intro, level start/end, roar, rivet jingles) **and on the IRQ
  line** (death) → fired once and **never stopped by the line reverting**. The ROM's 3-frame
  pulse out of `0x608A`/`0x6088` is a handshake; the sound CPU plays 0.7 s–6.9 s of tune by
  itself, long after the ~50 ms hold is over. These voices are not tracked and are not stopped
  by the *next* latch write either — only the background is.

That last pair is one rule with two directions, and both directions are audible if reversed:
stop one-shots on the revert and every tune becomes a 50 ms click; let backgrounds survive a
latch change and 25 m music plays over 100 m music forever. Nothing here special-cases death —
it is `kind: "oneshot"` on a third write surface, and that is all the player knows about it.

Measured in headless Chrome, instrumenting `AudioBufferSourceNode.start/.stop/ended` on a real
play-through to a real death:

```
31.664 s  worker: 7D80 <- 01      the ROM asserts the IRQ
31.665 s  start   death   3.245 s buffer
31.714 s  worker: 7D80 <- 00      released 50 ms later — the 3-frame handshake
34.911 s  ended   death           ran 3.246 s: the whole tune, never stopped
```

and, on the same run, the background rule doing its job: `bgm_25m` started looping at 26.231 s,
ran 4.354 s (its 2.295 s phrase, twice round) and was `stop()`ed at 30.585 s by the `7C00 <- 00`
the ROM writes at the moment Mario is hit.

**`0x7C00 = 0x0A` gets no sound.** It carries a `conflict`, so it is skipped by the same rule
that skips the two dead ls259 bits. Nothing is invented for it, and
`games/dkong/test/audio-wiring.test.js` fails if that ever silently reverses.

Clip filenames come from `manifest.audio.clipIds` (`trig{n}`, `latch_{vv}`, `irq`) — the
recorder's output layout, deliberately *not* in `sounds.js`, which is the hardware map and stays
free of file paths.

**The `0x7D80` edge is polled, not tapped.** The board exposes a write tap for `0x7C00` and
`0x7D00`–`0x7D07` only; `0x7D80` shares its ls259 with flipscreen / NMI-mask / DRQ and the board
stores it as `io.audioIrq` without a tap. `web/worker.js` therefore samples that field once per
frame and runs it through the same edge rule as the tapped surfaces. Frame granularity is
sufficient *by measurement*, not by hope: the ROM's sound service routine loads `0x6088` with 3
and decrements it per frame, so the line is held for three frames and a per-frame poll sees both
edges with two frames to spare.

## 4. The missing-samples path is the normal one

arcade-js ships no Donkey Kong audio, so `audio/samples/` is gitignored and usually **absent**.
The page makes exactly **one** probe — `audio/samples/index.json`, the recorder's own record of
which writes sounded and what file each landed in — and on a miss it returns quietly:

* no `SamplePlayer` is constructed and no `AudioContext` is created,
* the **Sound** button stays hidden and `M` does nothing,
* the worker is never told to arm the tap, so the engine is never touched,
* the page logs nothing, throws nothing, and shows nothing.

Measured, headless Chrome over CDP, samples removed: status `running`, game rendering, `0`
AudioContexts, `0` sample starts, `0` page console output, `0` exceptions, `0` unhandled
rejections. The only console line at all is Chrome's own built-in
`Failed to load resource: … 404` for that one probe — a browser network notice, not something
the page emitted, and unavoidable for any client-side optional-asset check.

Using `index.json` rather than guessing filenames is what keeps it to one request: silent slots
produce no file, so a naive per-clip fetch would 404 for every measured-silent write.

## 5. Getting the samples

```sh
make samples                       # your MAME + your romset -> games/dkong/audio/samples/
make samples SAMPLEFLAGS=--dry-run # print the plan and the exact MAME command line
make samples ROMPATH=/path/to/roms
```

Needs MAME on `PATH` and a `dkong` romset you own. See `games/dkong/tools/README-samples.md`.
The output is Nintendo's copyrighted audio: it stays on your machine, and `.gitignore` has
`games/*/audio/samples/` so it cannot be committed by accident.

One honest caveat about what you get: a recorded clip is *one valid rendition* of a sound, not
a canonical waveform (see README-samples.md). The looping clips are now a **whole measured
phrase** rather than the fragment they used to be — one autocorrelation period of a 24 s
sustained capture — so what loops is the tune's own repeat, not an arbitrary cut. What that is
*not* is a capture of the tune as the 8035 would play it in game context, with the ROM's own
timing around it. It sounds like Donkey Kong; it is not a claim of sample-exactness, and nothing
about it has been diffed against MAME the way the video has.
