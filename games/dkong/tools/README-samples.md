<!-- SPDX-License-Identifier: GPL-3.0-only -->
# `record_samples.py` — record DK's sounds from your own ROM

`games/dkong/tools/record_samples.py` drives **your** MAME against **your** Donkey Kong
romset and captures the machine's sounds to individual WAV files on **your** disk.

It is a **discovery sweep**, not a sound map: it does not assume which write means which
sound. It writes to the sound hardware, records what came out, and reports peak/RMS for
every write so it is obvious which ones made sound. That output is the evidence a sound
map is built from.

---

## The copyright position

Donkey Kong's audio is Nintendo's copyrighted work — exactly like its sprites and its
program ROM. **This repository ships none of it, and never will.**

The posture is identical to the existing bring-your-own-ROM design in `games/dkong/rom/`:

| ships in git | never ships in git |
| --- | --- |
| the recorder, the sweep schedule, the analysis | any Donkey Kong audio |

You generate the samples locally, from a romset you own, on your own machine. The output
directory `games/dkong/audio/samples/` is in `.gitignore` (`games/*/audio/samples/`).
**Do not commit or redistribute anything this tool produces.**

## Why record instead of extract

DK's sound is two different machines glued together:

* an **I8035 sound CPU** with its own tune/sample ROM data, and
* **discrete analogue circuits** (the jump, the walk, the hammer …) which have no sample
  data anywhere — MAME synthesises them from a netlist.

There is nothing to extract for the second class. Recording MAME's mixed audio output
covers both uniformly, which is why this records rather than extracts.

---

## Usage

Requires: MAME on `PATH` (tested with 0.288), a `dkong` romset in `--rompath`,
Python 3. numpy is used if present and a pure-stdlib path is used if not; WAV I/O is the
stdlib `wave` module.

```sh
# default sweep: 8 trigger bits, sound-latch values 0x00-0x1f (pulse + sustain
# pass each) and the 0x7D80 IRQ line -> games/dkong/audio/samples/
games/dkong/tools/record_samples.py --rompath ~/Downloads

# see the plan and the exact MAME command line without running anything
games/dkong/tools/record_samples.py --dry-run

# prove the capture is clean: residual level at every slot boundary
games/dkong/tools/record_samples.py --report-gaps

# longer sweep of latch values, with the sound CPU poked after each one
games/dkong/tools/record_samples.py --phases latch,latchtrig --latch-values 0x00-0x3f
```

`--help` documents every option, including the copyright position.

### How it runs

1. MAME boots `dkong` headless under **the project's determinism flags** — the argv is
   built by `tools/mame_golden.py:build_mame_argv`, the same function the pixel-golden
   captures use (fresh empty `nvram`/`cfg`, `-nocheat`, `-noautosave`, `-frameskip 0`,
   `-nothrottle`, `-video none`). `-wavwrite` and `-samplerate` are added on top.
   `-wavwrite` works even under `-sound none`: the recording is taken from the mixer, not
   from an audio device, so no host audio hardware is involved.
2. A generated Lua autoboot script installs **write taps** on `0x7C00`,
   `0x7D00-0x7D07` and `0x7D80` that replace every *program*-originated write with the value the sweep
   is currently holding. The ROM cannot touch the sound hardware while the sweep runs, so
   attract-mode sounds cannot contaminate a clip. (Everything muted is write-only from the
   Z80's side, so this cannot change what the program computes.)
3. After `--boot` seconds of settling, the sweep runs one **slot** at a time; each slot
   does its writes and then leaves silence for the rest of its own gap. The `latch` and
   `irq` phases run every value **twice** — a `--hold` PULSE slot and a much longer
   `--sustain-hold` SUSTAIN slot, with their own `--sustain-gap` — because one pass cannot
   tell a self-contained tune from a sustained one. See "Two passes" below.
4. The Lua script logs the **measured** emulated time of every slot, so the wav is split on
   real timestamps rather than assumed ones.
5. Each slot is sliced out, mean-removed (MAME's discrete netlist carries a decaying DC
   offset after power-on; a raw abs-max would read that offset as "sound"), trimmed to the
   sounding part, and written as its own WAV.

### Output format

Written to `--out` (default `games/dkong/audio/samples/`):

| file | contents |
| --- | --- |
| `trig<n>.wav` | what setting ls259.6h bit *n* produced (`0x7D00+n` ← 1, held `--hold`, then ← 0) |
| `latch_<vv>.wav` | what sound-latch value `0xvv` produced — the pulse pass, or one measured phrase of the sustain pass if the value proved sustained |
| `irq.wav` | what pulsing `0x7D80`, the I8035 interrupt line, produced (the death tune) |
| `latch_<vv>_trig<b>.wav` | `latchtrig` phase: latch value plus a pulse on trigger bit *b* |
| `index.json` | the full run record: MAME argv, schedule, mute ranges, and per-clip `peak` / `rms` / `duration_s` / `silent` / `clipped_at_slot_end` / `pulse_duration_s` / `sustain_duration_s` / `gated` / `loop` / `loop_period_s` / `loop_corr` |

Clips are mono 16-bit PCM at `--samplerate` (default 48000), matching MAME's mixer output.
**Silent slots produce no file** — they are listed in the report and in `index.json` with
`"silent": true`, so "no file" always means "measured silent", never "not tried".

### Two passes, and why one is not enough

The I8035 keeps playing only while the latch holds a *background* tune, and it re-reads the
latch when a tune ends. So a single short-hold pass gives you 0.24 s of `bgm_25m` — one
fragment of a 2.29 s phrase — and looping that fragment is audibly wrong. Recording it that
way was a real, shipped defect: "the background music is missing notes."

Each `latch`/`irq` value is therefore driven twice, and the tool **classifies** rather than
consulting the sound map:

* **gated** — the pulse clip is the length of the pulse (within 0.25 s) *and* the sustain clip
  is ≥3× longer. The write selects a sustained tune. The clip written to disk is **one
  measured loop period** of the sustain pass: a whole repeating phrase whose end joins its
  start. `loop: true`, with `loop_period_s` and `loop_corr` in `index.json`.
* **not gated** — the sound outlasts the pulse and finishes by itself. The clip written is the
  **pulse pass**: the tune, played once, exactly as the ROM's 3-frame handshake fires it.

The period search is a normalised autocorrelation over the held region, capped at a quarter of
`--sustain-hold` so whatever it returns was seen at least four times. It takes the **global
maximum** and then tests only whole sub-multiples (L/2…L/5): a musical phrase autocorrelates
strongly at note spacings too, and taking the smallest strong peak would loop a single note.
Both failure modes were observed on this board — see `games/dkong/audio/README.md`.

`--sustain-hold` is a measurement, not a default someone liked. At 12 s, DK tune `0x0B`'s phrase
came out 1.4757 s in one slot and 3.9338 s in another; at 24 s every tune pins, and the two
mirror recordings of each tune (`0x0X` and `0x1X`) agree to the sample.

---

## Measured results (MAME 0.288, `dkong`, macOS arm64, 2026-07-22)

This section is what the tool actually produced here, not what it is expected to produce.
A full default run (triggers + `0x00-0x1F` pulse & sustain + the IRQ line) is 1 391 emulated
seconds and takes **~76 s wall clock**; it wrote **35 clips / 9.7 MB**.

### Sound triggers — ls259 at 6H, `0x7D00+n` sets bit *n* from the data LSB

Six of the eight bits make sound. Two make none.

| write | peak | rms | clip @ `--hold 0.25` | clip @ `--hold 3.0` | reading |
| --- | ---: | ---: | ---: | ---: | --- |
| `0x7D00` = 1 | 14222 | 246 | 0.371 s | 3.134 s | **level** — sounds while the bit is high |
| `0x7D01` = 1 | 4532 | 398 | 0.514 s | 0.512 s | **one-shot** |
| `0x7D02` = 1 | 12093 | 1251 | 1.825 s | 1.825 s | **one-shot** |
| `0x7D03` = 1 | 16193 | 1119 | 0.574 s | 3.095 s | **level** |
| `0x7D04` = 1 | 12212 | 1659 | 1.649 s | 4.587 s | **level**, with a tail |
| `0x7D05` = 1 | 20176 | 680 | 0.794 s | 3.252 s | **level** |
| `0x7D06` = 1 | 0 | 0.0 | — | — | **SILENT** |
| `0x7D07` = 1 | 0 | 0.0 | — | — | **SILENT** |

The level/one-shot column matters for the player: a level sound must be started and
stopped by the trigger's 1→0 edges, not fired as a fixed-length one-shot.

### Sound latch — ls175 at 3D, `0x7C00`, read by the I8035

Both passes, per value. "pulse" is the 0.25 s hold, "sustain" the 24 s hold; **gated** means
the sound stopped when the latch was released, i.e. the value selects a sustained tune.

| write | pulse | sustain | gated | clip written |
| --- | ---: | ---: | :---: | --- |
| `0x00` | — | — | — | **SILENT** |
| `0x01` | 5.423 s | 26.21 s | no | 5.423 s (the tune, once) |
| `0x02` | 2.620 s | 26.26 s | no | 2.620 s |
| `0x03` | 0.357 s | 24.07 s | **yes** | **4.9192 s phrase** (corr 0.94) |
| `0x04` | 0.381 s | 24.09 s | **yes** | **2.9515 s phrase** (corr 0.96) |
| `0x05` | 6.762 s | 26.28 s | no | 6.762 s |
| `0x06` | 1.130 s | 24.33 s | no | 1.130 s |
| `0x07` | 3.746 s | 26.29 s | no | 3.746 s |
| `0x08` | 0.110 s | 24.05 s | **yes** | **2.2949 s phrase** (corr 1.00) |
| `0x09` | 0.374 s | 24.05 s | **yes** | **1.3523 s phrase** (corr 1.00) |
| `0x0A` | — | — | — | **SILENT** |
| `0x0B` | 0.341 s | 24.19 s | **yes** | **3.9338 s phrase** (corr 1.00) |
| `0x0C` | 6.860 s | 26.33 s | no | 6.860 s |
| `0x0D` | 0.749 s | 0.786 s | no | 0.749 s — the one tune that does **not** replay while held |
| `0x0E` | 3.271 s | 24.53 s | no | 3.271 s |
| `0x0F` | 2.034 s | 25.85 s | no | 2.034 s |

So **14 distinct sound-CPU tunes**, peaks 13 099 – 32 382. The two longest one-shots are
`0x05` (6.76 s) and `0x0C` (6.86 s). Full per-value numbers land in `index.json`.

### The IRQ line — `0x7D80`, the I8035's interrupt

| write | pulse | sustain | gated | clip written |
| --- | ---: | ---: | :---: | --- |
| `0x7D80` = 1 | 3.245 s (peak 20 618) | 24.22 s | no | 3.245 s — the **death tune** |

Previously unmeasured, because no phase drove it. It is the only event on this line, the ROM
pulses it for 3 frames on every death, and the tune it starts is ~65× longer than that pulse.

**Only the low nibble is used.** `0x10-0x1F` reproduce `0x00-0x0F`: the silence pattern is
exact (`0x10` and `0x1A` silent, matching `0x00` and `0x0A`) and every tune's duration
agrees to within the run-position spread described below — e.g. `0x01`/`0x11` = 5.423 s /
5.421 s, `0x0C`/`0x1C` = 6.860 s / 6.808 s — and the five *gated* tunes now give a sharper
check still, because a measured phrase length is a property of the tune rather than of the
slot: `0x03`/`0x13` = 4.9192/4.9192, `0x04`/`0x14` = 2.9515/2.9516, `0x08`/`0x18` and
`0x09`/`0x19` and `0x0B`/`0x1B` all identical to the sample. Spot checks outside that window agree too:
`0x20`, `0x40` and `0x80` are silent like `0x00`, and `0xFF` (2.007 s) matches `0x0F`
(2.010 s). These are envelope matches, not byte matches — two slots at different times in
a run are never byte-identical (see below).

### Controls run to make those numbers trustworthy

| experiment | result | what it establishes |
| --- | --- | --- |
| same sweep run twice | **14/14 clips byte-identical** | the capture is deterministic, like the pixel goldens |
| slot-boundary residual (`--report-gaps`) | at the noise floor for all 40 slots | muting works; the ROM is genuinely off the sound hardware, and no clip bleeds into the next |
| noise floor, measured per run | peak 1.1, rms 0.7 (of 32767) | the 64-unit silence threshold sits 35 dB above the measured floor and 54 dB below full scale, so "SILENT" means silent |
| also mute `0x7D80` (the I8035's IRQ line) | **14/14 byte-identical** | the tunes are driven by the latch **write itself**; the ROM's audio-IRQ pulses play no part |
| hold `0x7D06` = 1 across a latch sweep | **14/14 byte-identical** | bit 6 is not a mode/page select either — it is inert |
| hold `0x7D07` = 1 across a latch sweep | **14/14 byte-identical** | same for bit 7 |
| `latchtrig` with bit 5 | 16/16 sounded; `latch_00_trig5` = 0.793 s ≈ trig5 alone (0.794 s) | bit 5 is an independent sound, not a latch strobe |

### The one real caveat: clips are reproducible per-schedule, not per-value

Re-running an **identical** sweep gives byte-identical clips. Shifting the schedule
(`--boot 6` → `--boot 9`, everything else equal) gives **14/14 clips that differ
byte-wise**, with envelopes that mostly match closely but not always — e.g. latch `0x0E`
peaked 17 852 in one and 29 522 in the other, and latch `0x0D` lasted 0.727 s vs 0.786 s.

The same spread shows up between a value and its `+0x10` mirror inside a single run
(`0x0B` = 0.221 s vs `0x1B` = 0.303 s), so it is a function of *when* a slot fires, not of
what was written. Two causes, both real: the machine carries state the sweep does not
control (the analogue netlist's charge, the sound CPU's internal position, and the ROM's
ongoing writes to the `0x7D80-0x7D87` control latch — not muted, because it also carries
flipscreen, the NMI mask and the DMA DRQ); and a short sound's *trimmed* length depends on
exactly where its decay crosses the silence threshold, which amplifies small differences.

So: **treat a captured clip as one valid rendition of a sound, not as a canonical
waveform.** For a stable sample set, pin `--boot`, `--gap` and `--hold` and re-record
everything in one run — which is what the defaults do.

---

## What this can and cannot capture — honestly

**Can:**

* All six audible discrete/analogue trigger sounds, including whether each is level-driven
  or a one-shot — the class that has no extractable sample data at all.
* All fourteen I8035 sound-CPU tunes reachable from the sound latch.
* The negative results: `0x7D06`, `0x7D07`, latch `0x00` and latch `0x0A` produce nothing,
  and that has been checked with a long hold and with the ROM fully muted.

That is the whole `0x7C00` + `0x7D00-0x7D07` write surface the board exposes
(`boards/dkong/hardware.json` → `writeRanges` `sound_latch`, `sound_trig`), so the sweep is
exhaustive over the *addresses*, and over the low nibble of the latch it is exhaustive over
the *values*.

**Cannot:**

* **Name anything.** This tool proves "write X makes sound Y"; it cannot tell you Y is
  "jump". Naming needs the other half of the evidence: which write the ROM makes at which
  game moment. That is already capturable —
  `tools/mame_golden.py --writes --lua-dir games/dkong/tools/lua` traces every write to
  `0x7C00` and `0x7D00-0x7D07` with cycle stamps. Cross the two and you have the map.
* **Mixes.** Real DK plays several things at once (walk under a tune, hammer over BGM).
  Each clip here is one sound in isolation. That is the right raw material for
  `core/audio.js`'s per-sample player, but it means a recording of *gameplay* would not
  sound like the sum of these clips fired independently.
* **Anything MAME itself gets wrong.** These are recordings of MAME's discrete netlist and
  I8035 emulation, not of a physical PCB. Where MAME's DK sound differs from real hardware,
  so does this.
* **Loops and sustains, cleanly.** Level-driven triggers are captured for whatever
  `--hold` was used. For values measured **gated**, the tool now *does* find the loop point —
  a whole autocorrelation period of the sustain pass — so those clips are loopable as recorded.
  For the rest it does not, and does not need to: they are self-contained tunes.
* **Anything past `--gap`.** A sound longer than the gap is truncated. The tool flags this
  per clip (`CUT OFF at slot end` / `"clipped_at_slot_end": true`) rather than silently
  shortening it — at the old 4 s default, latch `0x01`/`0x05`/`0x0C` were all being cut,
  which is why the default is now 8 s.
* **Non-`dkong` romsets.** The addresses and the sweep are DK-board specific. The
  *approach* transfers; the constants do not.
