# Porting a new game

Nothing in the method is Donkey Kong specific. A new game differs along two independent axes — its
**CPU** and its **board** — and brings one thing of its own, its **ROM**.

## The three layers

```
core/cpu/<chip>.js        the processor        shared by every game using that CPU
boards/<driver>/          the arcade hardware  shared by every game on that PCB
games/<romset>/           the translated ROM   one per game
```

- **CPU** (`core/cpu/z80.js`, and future siblings) is fully game-agnostic. A new Z80 game reuses it
  verbatim; a new CPU (6502, 6809, …) is a new module here.
- **Board** (`boards/<driver>/`: memory map, i/o chips, video/palette/geometry) is named after its
  **MAME driver**. Games on the same PCB share it — Donkey Kong Jr. and Donkey Kong 3 would reuse
  `boards/dkong/`; Frogger would need `boards/galaxian/`.
- **Game** (`games/<id>/`) is the ROM translation plus a **manifest** declaring its cpu, board, ROM
  images (with checksums), and metadata.

A game's `manifest.js` ties the three together, and the machine assembles CPU + board + translated
ROM at load time.

## The manifest's `inputs` block is required for the web player

`web/` is game-agnostic: it derives its keyboard map and its worker port list entirely from
`manifest.inputs`, never from hardcoded literals. A manifest that omits `inputs` can still pass
every gate — the pixel harness never reads it — but it can't be played in the browser. Declare:

- **`ports`** — the input-port addresses the board exposes, e.g. `{ in0, in1, in2 }`, matching the
  board's i/o module (`boards/<driver>/io.js`).
- **`actions`** — logical action name → `{ port, bit }`, e.g. `right: { port: 0x7c00, bit: 0x01 }`.
  One entry per button/direction the game reads, plus `coin` and `start1` (and `start2` if the
  cabinet has a two-player start).
- **`keys`** — `KeyboardEvent.code` → action name, e.g. `ArrowRight: "right"`. The web player builds
  its per-port key→bit maps from this at load time; it needs no per-game code of its own.

See `games/dkong/manifest.js` for the reference shape.

## Bringing a validated game up in the browser — the web contract

A game that passes the pixel gate offline still will not run in the web player until it meets the
live-worker contract. `web/worker.js` + `web/player.html` drive every game the same way, but that
"same way" is a real interface the game's Machine, board, and manifest must satisfy. Here they are as
a checklist so the next game is right the first time:

1. **Register it.** Add the id to `games/registry.js`; the selector reads this.

2. **Assemble EVERY declared ROM image to `games/<id>/rom/`, not just `maincpu`.** The dev path
   fetches each `manifest.rom.images` entry from there. `tools/build-rom.mjs` concatenates parts in
   order and **does not honor an image's `offsets`** — so a gapped image (The Pit's `gfx` is
   `p9`@0x0000 + `p8`@0x1000 with a 2 KB hole) assembles to the wrong bytes and fails its sha256, and
   the other images silently never get built. Fix build-rom to honor `offsets`, or assemble the gapped
   image by hand and verify against the pinned sha256.

3. **Build the routine registry with STATIC imports — never `node:fs` / `file://`.** A registry that
   `readdirSync`s `translated/` and `await import()`s each file works in Node (tests, `render.js`) but
   the browser has no `node:fs` and rejects `file://` loads ("Cross-origin script load denied"). DK
   hand-lists its imports; a game with too many routines needs a **generated** static list — see
   `tools/gen-thepit-registry.mjs` → `translated/_registry.generated.js`, kept honest by a sync-check
   test. Ensure no `node:` built-in appears anywhere in the browser load path (machine, board,
   translated, registry).

4. **The Machine must implement the web-worker contract** (match `games/dkong/machine.js`):
   - a **synchronous constructor** — `new Machine(rom, { inputs, gfx, proms, overrides })` with no
     pre-built registry (the worker cannot `await Machine.create`); build the registry from the static
     table inside the constructor;
   - an exported **`resolveOverrides(spec, baseUrl)`** — resolves `manifest.optimized` to a
     `Map<addr, fn>`, empty when there is none (the worker calls it for every game);
   - the **live-render interface**: a `captureVideo` flag, a `videoFrames` array, and a
     `finishRasterFrame()` that pushes the composed RGB frame, called at each frame boundary while
     `captureVideo` is set. Offline the flag stays off and nothing changes;
   - an exported **`Inputs`** class in `boards/<id>/io.js`. The worker does `new Inputs()`; live keys
     actually flow via the worker's `applyInputs` override onto `io.inputAssert`, so if the io reads
     `inputAssert` this can be an inert placeholder.

5. **Inputs are manifest-driven across IN0/IN1/IN2 — declare each action's real port.** The page maps
   keys per `manifest.inputs.ports/actions`; coin/start are **not** always on the same port (DK: IN2;
   The Pit: IN1). Declare them where the board actually reads them; the page routes all three ports.

6. **★ Orientation: record the EXACT MAME `ROT`, never a `"vertical"`/`"horizontal"` boolean.** The
   `GAME()` macro's `ROT0/ROT90/ROT180/ROT270` *is* the screen orientation: `ROT90` = `SWAP_XY|FLIP_X`
   = 90° **clockwise**; `ROT270` = `SWAP_XY|FLIP_Y` = 90° **anti-clockwise**. **DK is `ROT270`, The Pit
   is `ROT90` — opposite directions.** Collapsing both to `orientation: "vertical"` records "portrait"
   but throws away *which way*, so the display comes out 180° wrong — **upside down**. Copy the game's
   `ROT` straight out of its MAME `GAME()` line into the manifest and have the renderer apply it
   faithfully (not a boolean "is it rotated").

7. **Unported audio → silent, not broken — but you can add sound without porting the audio hardware.**
   A game whose sound CPU/chips are not translated runs with no audio, which is expected. To give it
   sound anyway, record and replay one clip per soundlatch command — see **Audio without emulating the
   sound hardware** below.

## Audio without emulating the sound hardware — record and replay

A game's sound almost always lives on a *second* CPU (its own Z80/i8035 + PSG/DAC chips) the port has
not translated — and you do not need to translate it to have sound. The board's main CPU asks for a
sound by writing a **command byte to a soundlatch**; that write is the entire game-side interface. So
tap it and play a **recording of what the real hardware produced for that command** — no second CPU,
no chip emulation. Same "audio above the emulation" stance DK uses, in its simplest form.

1. **Record one clip per command (`games/<id>/tools/record_samples.py`, adapt DK's).** It drives real
   MAME once, headless, and for each command byte injects it to the soundlatch and captures what MAME
   emits into `cmd_<decimal>.wav`, writing an `index.json` of which commands sounded, the file each
   landed in, and whether the clip loops. Three things will bite the next game:
   - **Mute the ROM's own soundlatch writes** while you inject, or the game's own audio fights your
     stimulus. A Lua write-tap that swallows writes to the latch address does it.
   - **Know how the command triggers.** On The Pit the soundlatch write does **not** assert the audio
     CPU's interrupt — that CPU polls the latch on its own VSYNC IRQ — so "triggering" is just *hold
     the byte ≥1 frame*. Read the driver for whether a latch write raises an IRQ or is polled.
   - **Two signal traps:** the PSG idle DC bias can step by thousands of LSB between sounds, so
     **median-center each segment**, not mean-center, or silent tails read as signal; and `soft_reset`
     re-runs the autoboot script, so it cannot isolate one command — separate clips by the
     pulse-vs-sustain *stop timing* instead.

2. **Committed contract vs. BYO recordings — the same split as the ROM.**
   - **Committed:** `manifest.audio = { map: "audio/sounds.js", samples: "audio/samples" }`, and
     `audio/sounds.js` — **data only** — declaring the model and latch address
     (`{ model: "clips", soundLatch: 0x… }`). No per-command table and no invented sound names live
     here: names are evidence-based, and the per-command facts are a measurement of the ROM.
   - **Gitignored (BYO):** everything under `audio/samples/` — the WAVs *and* `index.json`. It is
     ROM-derived audio, so it is copyright, exactly like the ROM. A fresh clone is silent until the
     user runs the recorder against their own ROM; that is the point, not a gap.

3. **The web side — one generic tap, two playback models.**
   - `web/worker.js` forwards each tapped sound write to the page, deduped **by address** (a `Map`
     keyed by the raw write address), so a **single** soundlatch works as cleanly as DK's several latch
     surfaces — only a *changed* value at an address ships. Guard any polled surface behind a
     board-capability check so a board that lacks it ships no spurious edge.
   - `web/player.html`'s `setupAudio()` dispatches on `SOUNDS.model`. DK's default model schedules
     discrete synth effects + recorded tunes across trigger/latch/irq surfaces; the **`"clips"`** model
     is the simple one — load `index.json`, one clip per command, play that command's clip on its write.

4. **★ The trap that will get you: do NOT loop off the recorder's `loop` flag.** The recorder cannot
   reliably tell a looping tune from a sustained one-shot — its clips are fixed-length captures, and on
   The Pit it detected **no real loop point on any command** (`loop_period` null throughout) yet still
   flagged most as "loop." Honor that and the last tune of the boot burst **drones forever**. The board
   has one sound CPU, so model **one voice**: a new command stops the previous and plays it **once**,
   nothing loops. If a game genuinely needs looping music, earn it by detecting a **real loop point** in
   the recorder — never off the sustained-to-slot-end heuristic.

## The steps

The porting-specific glue is the three layers above, the `inputs` block below, keeping the ROM out
below, and registering the game — add its id to `games/registry.js`, write `games/<id>/manifest.js`
(ROM part list + sha256 checksums + the `inputs` block), and a `Makefile` `rom` target.

**Plumb `--input` and `--poke` in that same first pass**, not once the layer looks done. Skip it and
every gate you run measures attract mode only, which leaves most of the ROM unexecuted while
reporting clean — see [integration testing](integration-testing.md) for the three seams.

**★ A new game gets its whole-machine swap gate in its FIRST unit, before the module count grows.**
A gate scoped to one routine cannot observe a property of the assembled system. The same blindness
hides the prior question — whether anything dispatches the routine at all (see [idiomatic
generation](idiomatic-generation.md), *How a routine joins the layer*). Build the gate while there
is one routine to bisect, and **commission it to FAIL**: a gate built to prove it catches a break is
a gate, one built to pass is a decoration.

The **method** — the model that turns a ROM into validated, *understood* JavaScript — has its
authoritative, executable form in **[the runbook](runbook.md)** (§0→§5, run top to bottom), with the
conceptual map in **[The Method](README.md)** (one oracle, a Structure⇄Meaning spiral up the call
graph, then Ship). Its detailed Structure/Meaning techniques are in
[idiomatic generation](idiomatic-generation.md), building on the disassembly, translation, and
gate mechanics in the disassembly-through-pixel-gate docs.

## The ROM stays out

Arcade ROM data is copyrighted and is **never committed**. Each game ships a manifest that lists the
part filenames and their checksums; `make -C games/<id> rom` assembles the images from a dump the user
supplies and verifies them against the pinned sha256, so a wrong romset fails loudly. This repo
distributes tools, translation, and analysis metadata — never the original bytes.

## A validation gotcha you *will* hit: RNG that races the beam

Most arcade games seed randomness from a spin counter the main loop increments while waiting for the
vblank interrupt. It is timing-derived, so a cycle-accurate-but-not-exact translation forks it within
a few frames and every RNG-driven sprite drifts — a long pixel diff then looks broken though the logic
is identical. Don't chase cycle-exactness for it; **pin the entropy** for equivalence testing instead
(declare `manifest.entropyPin`, run with `--pin-entropy`). The full method — discovery, the pin, and
the convergent diff for the residual DMA artifact — is the *Entropy pinning* section of
[idiomatic generation](idiomatic-generation.md).
