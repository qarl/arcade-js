// SPDX-License-Identifier: GPL-3.0-only
//
// Donkey Kong — game manifest. Declares which CPU + board this romset runs on,
// how to assemble its (uncommitted, copyrighted) ROM, and metadata for the
// launcher. This is the single source of truth for the ROM part list + checksums
// (tools/build-rom.mjs reads it; nothing duplicates the part names).
//
// NOTE: the deeper hardware config (memory map, i/o bit maps, video decode,
// frame timing, ROM entry points) currently lives in the board + machine code
// (boards/dkong/*, games/dkong/machine.js). Those migrate into this manifest as
// declarative data when the core is parameterized for a second board — see
// core/README.md. Kept in code for now to preserve the pixel-validated engine
// byte-for-byte.

export default {
  id: "dkong",
  title: "Donkey Kong",
  year: 1981,
  manufacturer: "Nintendo",
  orientation: "vertical",     // portrait; the display is rotated 90° CCW
  screen: { width: 256, height: 224 },

  cpu: "z80",                  // core/cpu/z80.js
  board: "dkong",              // boards/dkong/
  mameDriver: "dkong.cpp",     // the board is named after its MAME driver

  // The declarative input contract the game-agnostic web layer reads: it builds
  // its keyboard map, coin/start buttons, and worker port list from here, so no
  // DK-specific ports/keys/bits are hardcoded in web/. A second game supplies its
  // own inputs block and the same web player drives it. Values mirror the board's
  // input ports (boards/dkong/io.js) and the historical web/player.html bindings.
  inputs: {
    ports: { in0: 0x7c00, in1: 0x7c80, in2: 0x7d00 },
    // logical action -> { port address, bit mask }
    actions: {
      right:  { port: 0x7c00, bit: 0x01 },
      left:   { port: 0x7c00, bit: 0x02 },
      up:     { port: 0x7c00, bit: 0x04 },
      down:   { port: 0x7c00, bit: 0x08 },
      jump:   { port: 0x7c00, bit: 0x10 },
      coin:   { port: 0x7d00, bit: 0x80 },
      start1: { port: 0x7d00, bit: 0x04 },
      start2: { port: 0x7d00, bit: 0x08 },
    },
    // web-player keyboard bindings: KeyboardEvent.code -> action name
    keys: {
      ArrowRight: "right", KeyD: "right", ArrowLeft: "left", KeyA: "left",
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      Space: "jump", KeyZ: "jump", KeyX: "jump",
      Digit5: "coin", KeyC: "coin", Digit1: "start1", Digit2: "start2",
    },
  },

  // Optional audio contract, read by the game-agnostic web player exactly the way
  // `inputs` is: `map` is the declarative sound-command map (games/dkong/audio/
  // sounds.js — data only), `synth` the module that RE-CREATES the board's
  // discrete analogue effects, `samples` the directory the local recorder writes
  // to. ALL THREE PATHS ARE RELATIVE TO THIS GAME'S DIRECTORY.
  //
  // The two sound sources are not equally available, and that asymmetry is the
  // whole point of having both:
  //   • `synth` ships with arcade-js and needs nothing installed — DK's walk,
  //     jump and boom are discrete circuits with no sample data in any ROM, so
  //     they are synthesised from measured circuit parameters and are our own
  //     work. Every visitor hears these.
  //   • `samples` holds the tunes, which come out of a second CPU running its
  //     own ROM and so can only be recorded — LOCALLY, by the visitor's own
  //     `make samples` from their own MAME + ROM. That directory is gitignored
  //     and normally ABSENT; a fresh clone therefore plays the three effects and
  //     no music. Where a recording exists it overrides the synthesis of the
  //     same name (see the AUDIO section of web/player.html).
  // Omitting this block in another game's manifest means that game has no audio
  // layer at all; omitting just `synth` means it has no synthesisable effects.
  audio: {
    map: "audio/sounds.js",
    synth: "audio/synth.js",
    samples: "audio/samples",
    // Filenames record_samples.py gives a clip, by write. Kept here rather than in
    // sounds.js because it is a property of the RECORDER's output layout, not of
    // the hardware: sounds.js is the hardware map and stays free of file paths.
    // `irq` is the 0x7D80 line, which carries the death tune -- it is a third
    // write surface, not a trigger bit, so it gets its own id.
    clipIds: { trigger: "trig{n}", latch: "latch_{vv}", irq: "irq" },
  },

  // ROM assembly: MAME part filenames (from your own dkong.zip), concatenated in
  // address order into the flat images the engine loads. sha256 + size verify each,
  // so a wrong/damaged romset fails loudly. ROM bytes are copyrighted and never
  // committed — see rom/README.md.
  rom: {
    zip: "dkong.zip",
    images: {
      maincpu: {
        parts: ["c_5et_g.bin", "c_5ct_g.bin", "c_5bt_g.bin", "c_5at_g.bin"],
        size: 16384,
        sha256: "b24ea34a6554489184374635e5646f5e0dd4fccaec4c78c84fbfb9a6ea328c5d",
      },
      gfx1: {
        parts: ["v_5h_b.bin", "v_3pt.bin"],
        size: 4096,
        sha256: "fff4f3dfb860834d9a3d57bc794a7d0a84d3da19d86dd051bbd9ebba8501f581",
      },
      gfx2: {
        parts: ["l_4m_b.bin", "l_4n_b.bin", "l_4r_b.bin", "l_4s_b.bin"],
        size: 8192,
        sha256: "db4f7a4433febed7e609bd2705ad22b2ac4610299f61c37877116f646a457873",
      },
      proms: {
        parts: ["c-2k.bpr", "c-2j.bpr", "v-5e.bpr"],
        size: 768,
        sha256: "740d05416129bf52126396d814c39a517134132e18b202e8058ecdbde453b278",
      },
    },
  },

  // Per-routine overrides: swap a translated/ routine for an optimized/ rewrite,
  // but only once it passes the equivalence gates (games/dkong/optimized/harness.js).
  //
  // SCHEMA. Declarative, so it is resolvable from both Node and the browser
  // worker (each resolves it with resolveOverrides() in machine.js, which uses
  // the dynamic import both provide). Each entry is:
  //
  //   "<hex dispatch target>": { module: "<path from this dir>", export: "<name>" }
  //
  // e.g.  "0x01c3": { module: "./optimized/handlers.js", export: "handler_01c3" }
  //
  // The KEY is the exact rst-0x28 dispatch target dispatchGameState() switches on
  // (games/dkong/translated/nmi.js); the VALUE names the optimized module + its
  // named export to route that address to.
  //
  // An entry is added here ONLY after its optimized routine is proven EQUAL by
  // the harness (games/dkong/optimized/harness.js). The three below are each
  // proven byte-identical to their translated oracle and now run live: the run
  // paths (games/dkong/tools/emit.js and web/worker.js) resolve this declarative
  // block with resolveOverrides() and hand the resulting Map to the Machine.
  //
  // This block is DECLARATIVE and therefore NOT resolvable synchronously, so the
  // Machine constructor no longer consumes it directly (it would throw on the
  // { module, export } form). A Machine built with no opts.overrides runs the
  // exact translated behaviour; a run path that wants these live resolves them
  // first (see machine.js resolveOverrides + the constructor's default).
  optimized: {
    "0x01c3": { module: "./optimized/handlers.js", export: "handler_01c3" },
    "0x05c6": { module: "./optimized/handlers.js", export: "handler_05c6" },
    "0x05e9": { module: "./optimized/handlers.js", export: "handler_05e9" },
    "0x0611": { module: "./optimized/handlers.js", export: "entry_0611" },
  },
};
