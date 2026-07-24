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
  // e.g.  "0x01c3": { module: "./optimized/handler_01c3.js", export: "handler_01c3" }
  //       (one file per routine; the module basename matches the export)
  //
  // The KEY is the exact rst-0x28 dispatch target dispatchGameState() switches on
  // (games/dkong/translated/nmi.js); the VALUE names the optimized module + its
  // named export to route that address to.
  //
  // An entry is added here ONLY after its optimized routine is proven EQUAL by
  // the harness (games/dkong/optimized/harness.js). Every entry below is proven
  // byte-identical to its translated oracle and runs live: the run
  // paths (games/dkong/tools/emit.js and web/worker.js) resolve this declarative
  // block with resolveOverrides() and hand the resulting Map to the Machine.
  //
  // This block is DECLARATIVE and therefore NOT resolvable synchronously, so the
  // Machine constructor no longer consumes it directly (it would throw on the
  // { module, export } form). A Machine built with no opts.overrides runs the
  // exact translated behaviour; a run path that wants these live resolves them
  // first (see machine.js resolveOverrides + the constructor's default).
  optimized: {
    "0x01c3": { module: "./optimized/handler_01c3.js", export: "handler_01c3" },
    "0x05c6": { module: "./optimized/handler_05c6.js", export: "handler_05c6" },
    "0x05e9": { module: "./optimized/handler_05e9.js", export: "handler_05e9" },
    "0x0611": { module: "./optimized/entry_0611.js", export: "entry_0611" },
    "0x051c": { module: "./optimized/entry_051c.js", export: "entry_051c" },
    "0x059b": { module: "./optimized/loc_059b.js", export: "loc_059b" },
    "0x062a": { module: "./optimized/entry_062a.js", export: "entry_062a" },
    "0x06b8": { module: "./optimized/entry_06b8.js", export: "entry_06b8" },
    "0x06fe": { module: "./optimized/loc_06fe.js", export: "loc_06fe" },
    "0x073c": { module: "./optimized/handler_073c.js", export: "handler_073c" },
    "0x0763": { module: "./optimized/handler_0763.js", export: "handler_0763" },
    "0x0779": { module: "./optimized/handler_0779.js", export: "handler_0779" },
    "0x07c3": { module: "./optimized/loc_07c3.js", export: "loc_07c3" },
    "0x07cb": { module: "./optimized/loc_07cb.js", export: "loc_07cb" },
    "0x084b": { module: "./optimized/loc_084b.js", export: "loc_084b" },
    "0x08b2": { module: "./optimized/loc_08b2.js", export: "loc_08b2" },
    "0x08ba": { module: "./optimized/loc_08ba.js", export: "loc_08ba" },
    "0x08f8": { module: "./optimized/loc_08f8.js", export: "loc_08f8" },
    "0x0986": { module: "./optimized/loc_0986.js", export: "loc_0986" },
    "0x09ab": { module: "./optimized/loc_09ab.js", export: "loc_09ab" },
    "0x09d6": { module: "./optimized/sub_09d6.js", export: "sub_09d6" },
    "0x09fe": { module: "./optimized/sub_09fe.js", export: "sub_09fe" },
    "0x0a1b": { module: "./optimized/sub_0a1b.js", export: "sub_0a1b" },
    "0x0a37": { module: "./optimized/loc_0a37.js", export: "loc_0a37" },
    "0x0a63": { module: "./optimized/loc_0a63.js", export: "loc_0a63" },
    "0x0a76": { module: "./optimized/loc_0a76.js", export: "loc_0a76" },
    "0x0a8a": { module: "./optimized/loc_0a8a.js", export: "loc_0a8a" },
    "0x0bda": { module: "./optimized/loc_0bda.js", export: "loc_0bda" },
    "0x0abf": { module: "./optimized/loc_0abf.js", export: "loc_0abf" },
    "0x0ae8": { module: "./optimized/loc_0ae8.js", export: "loc_0ae8" },
    "0x0b06": { module: "./optimized/loc_0b06.js", export: "loc_0b06" },
    "0x0b68": { module: "./optimized/loc_0b68.js", export: "loc_0b68" },
    "0x0bb3": { module: "./optimized/loc_0bb3.js", export: "loc_0bb3" },
    "0x3069": { module: "./optimized/loc_3069.js", export: "loc_3069" },
    "0x2913": { module: "./optimized/entry_2913.js", export: "entry_2913" },
    "0x309f": { module: "./optimized/sub_309f.js", export: "sub_309f" },
    "0x0c91": { module: "./optimized/loc_0c91.js", export: "loc_0c91" },
    "0x127c": { module: "./optimized/loc_127c.js", export: "loc_127c" },
    "0x128b": { module: "./optimized/entry_128b.js", export: "entry_128b" },
    "0x12ac": { module: "./optimized/loc_12ac.js", export: "loc_12ac" },
    "0x12de": { module: "./optimized/loc_12de.js", export: "loc_12de" },
    "0x17b6": { module: "./optimized/loc_17b6.js", export: "loc_17b6" },
    "0x1839": { module: "./optimized/loc_1839.js", export: "loc_1839" },
    "0x186f": { module: "./optimized/loc_186f.js", export: "loc_186f" },
    "0x1880": { module: "./optimized/loc_1880.js", export: "loc_1880" },
    "0x18c6": { module: "./optimized/loc_18c6.js", export: "loc_18c6" },
    "0x2880": { module: "./optimized/sub_2880.js", export: "sub_2880" },
    "0x28b0": { module: "./optimized/sub_28b0.js", export: "sub_28b0" },
    "0x28e0": { module: "./optimized/sub_28e0.js", export: "sub_28e0" },
    "0x2901": { module: "./optimized/sub_2901.js", export: "sub_2901" },
    "0x1615": { module: "./optimized/loc_1615.js", export: "loc_1615" },
    "0x1654": { module: "./optimized/sub_1654.js", export: "sub_1654" },
    "0x1670": { module: "./optimized/sub_1670.js", export: "sub_1670" },
    "0x168a": { module: "./optimized/sub_168a.js", export: "sub_168a" },
    "0x1732": { module: "./optimized/sub_1732.js", export: "sub_1732" },
    "0x1757": { module: "./optimized/sub_1757.js", export: "sub_1757" },
    "0x178e": { module: "./optimized/sub_178e.js", export: "sub_178e" },
    "0x16a3": { module: "./optimized/loc_16a3.js", export: "loc_16a3" },
    "0x16bb": { module: "./optimized/loc_16bb.js", export: "loc_16bb" },
    "0x123c": { module: "./optimized/handler_123c.js", export: "handler_123c" },
    "0x1977": { module: "./optimized/handler_1977.js", export: "handler_1977" },
    "0x197a": { module: "./optimized/loc_197a.js", export: "loc_197a" },
    "0x3110": { module: "./optimized/guard_3110.js", export: "guard_3110" },
    "0x311b": { module: "./optimized/guard_311b.js", export: "guard_311b" },
    "0x3126": { module: "./optimized/guard_3126.js", export: "guard_3126" },
    "0x3131": { module: "./optimized/guard_3131.js", export: "guard_3131" },
    "0x3e99": { module: "./optimized/entry_3e99.js", export: "entry_3e99" },
    "0x138f": { module: "./optimized/loc_138f.js", export: "loc_138f" },
    "0x13a1": { module: "./optimized/loc_13a1.js", export: "loc_13a1" },
    "0x13aa": { module: "./optimized/loc_13aa.js", export: "loc_13aa" },
    "0x12f2": { module: "./optimized/loc_12f2.js", export: "loc_12f2" },
    "0x1344": { module: "./optimized/loc_1344.js", export: "loc_1344" },
    "0x13bb": { module: "./optimized/loc_13bb.js", export: "loc_13bb" },
    "0x141e": { module: "./optimized/loc_141e.js", export: "loc_141e" },
    "0x1486": { module: "./optimized/sub_1486.js", export: "sub_1486" },
    "0x196b": { module: "./optimized/loc_196b.js", export: "loc_196b" },
    "0x0008": { module: "./optimized/sub_0008.js", export: "sub_0008" },
    "0x0010": { module: "./optimized/sub_0010.js", export: "sub_0010" },
    "0x0018": { module: "./optimized/sub_0018.js", export: "sub_0018" },
    "0x0020": { module: "./optimized/sub_0020.js", export: "sub_0020" },
    "0x0028": { module: "./optimized/sub_0028.js", export: "sub_0028" },
    "0x0030": { module: "./optimized/sub_0030.js", export: "sub_0030" },
    "0x0038": { module: "./optimized/loc_0038.js", export: "loc_0038" },
    "0x003d": { module: "./optimized/sub_003d.js", export: "sub_003d" },
    "0x004e": { module: "./optimized/sub_004e.js", export: "sub_004e" },
    "0x0057": { module: "./optimized/sub_0057.js", export: "sub_0057" },
    "0x00e0": { module: "./optimized/sub_00e0.js", export: "sub_00e0" },
    "0x011c": { module: "./optimized/sub_011c.js", export: "sub_011c" },
    "0x0141": { module: "./optimized/sub_0141.js", export: "sub_0141" },
    "0x017b": { module: "./optimized/sub_017b.js", export: "sub_017b" },
    "0x0207": { module: "./optimized/sub_0207.js", export: "sub_0207" },
    "0x0315": { module: "./optimized/sub_0315.js", export: "sub_0315" },
    "0x0347": { module: "./optimized/sub_0347.js", export: "sub_0347" },
    "0x0350": { module: "./optimized/sub_0350.js", export: "sub_0350" },
    "0x037f": { module: "./optimized/sub_037f.js", export: "sub_037f" },
    "0x03a2": { module: "./optimized/sub_03a2.js", export: "sub_03a2" },
    "0x03f2": { module: "./optimized/sub_03f2.js", export: "sub_03f2" },
    "0x03fb": { module: "./optimized/entry_03fb.js", export: "entry_03fb" },
    "0x0400": { module: "./optimized/entry_0400.js", export: "entry_0400" },
    "0x0413": { module: "./optimized/loc_0413.js", export: "loc_0413" },
    "0x0426": { module: "./optimized/loc_0426.js", export: "loc_0426" },
    "0x0450": { module: "./optimized/loc_0450.js", export: "loc_0450" },
    "0x0464": { module: "./optimized/loc_0464.js", export: "loc_0464" },
    "0x0478": { module: "./optimized/loc_0478.js", export: "loc_0478" },
    "0x0486": { module: "./optimized/loc_0486.js", export: "loc_0486" },
    "0x04a1": { module: "./optimized/loc_04a1.js", export: "loc_04a1" },
    "0x04a3": { module: "./optimized/loc_04a3.js", export: "loc_04a3" },
    "0x04ac": { module: "./optimized/loc_04ac.js", export: "loc_04ac" },
    "0x04be": { module: "./optimized/loc_04be.js", export: "loc_04be" },
    "0x04e1": { module: "./optimized/loc_04e1.js", export: "loc_04e1" },
    "0x04f1": { module: "./optimized/loc_04f1.js", export: "loc_04f1" },
    "0x04f9": { module: "./optimized/loc_04f9.js", export: "loc_04f9" },
    "0x0509": { module: "./optimized/loc_0509.js", export: "loc_0509" },
    "0x0514": { module: "./optimized/sub_0514.js", export: "sub_0514" },
    "0x055f": { module: "./optimized/sub_055f.js", export: "sub_055f" },
    "0x056b": { module: "./optimized/draw_056b.js", export: "draw_056b" },
    "0x0578": { module: "./optimized/draw_0578.js", export: "draw_0578" },
    "0x057c": { module: "./optimized/sub_057c.js", export: "sub_057c" },
    "0x0583": { module: "./optimized/loop_0583.js", export: "loop_0583" },
    "0x0593": { module: "./optimized/sub_0593.js", export: "sub_0593" },
    "0x05da": { module: "./optimized/tail_05da.js", export: "tail_05da" },
    "0x0616": { module: "./optimized/sub_0616.js", export: "sub_0616" },
    "0x066a": { module: "./optimized/loc_066a.js", export: "loc_066a" },
    "0x0689": { module: "./optimized/loc_0689.js", export: "loc_0689" },
    "0x0691": { module: "./optimized/loc_0691.js", export: "loc_0691" },
    "0x06a8": { module: "./optimized/loc_06a8.js", export: "loc_06a8" },
    "0x07ad": { module: "./optimized/sub_07ad.js", export: "sub_07ad" },
    "0x0852": { module: "./optimized/sub_0852.js", export: "sub_0852" },
    "0x0874": { module: "./optimized/sub_0874.js", export: "sub_0874" },
    "0x08d5": { module: "./optimized/loc_08d5.js", export: "loc_08d5" },
    "0x0965": { module: "./optimized/sub_0965.js", export: "sub_0965" },
    "0x0977": { module: "./optimized/sub_0977.js", export: "sub_0977" },
    "0x09ee": { module: "./optimized/sub_09ee.js", export: "sub_09ee" },
    "0x0a53": { module: "./optimized/sub_0a53.js", export: "sub_0a53" },
    "0x0c92": { module: "./optimized/loc_0c92.js", export: "loc_0c92" },
    "0x0cc6": { module: "./optimized/loc_0cc6.js", export: "loc_0cc6" },
    "0x0cd4": { module: "./optimized/loc_0cd4.js", export: "loc_0cd4" },
    "0x0cdf": { module: "./optimized/loc_0cdf.js", export: "loc_0cdf" },
    "0x0cf2": { module: "./optimized/loc_0cf2.js", export: "loc_0cf2" },
    "0x0d00": { module: "./optimized/sub_0d00.js", export: "sub_0d00" },
    "0x0d27": { module: "./optimized/sub_0d27.js", export: "sub_0d27" },
    "0x0d30": { module: "./optimized/sub_0d30.js", export: "sub_0d30" },
    "0x0d43": { module: "./optimized/sub_0d43.js", export: "sub_0d43" },
    "0x0d4c": { module: "./optimized/sub_0d4c.js", export: "sub_0d4c" },
    "0x0d5f": { module: "./optimized/loc_0d5f.js", export: "loc_0d5f" },
    "0x0da7": { module: "./optimized/sub_0da7.js", export: "sub_0da7" },
    "0x0dd3": { module: "./optimized/loc_0dd3.js", export: "loc_0dd3" },
    "0x0e19": { module: "./optimized/loc_0e19.js", export: "loc_0e19" },
    "0x0e2a": { module: "./optimized/loc_0e2a.js", export: "loc_0e2a" },
    "0x0e4f": { module: "./optimized/loc_0e4f.js", export: "loc_0e4f" },
    "0x0ee8": { module: "./optimized/loc_0ee8.js", export: "loc_0ee8" },
    "0x0f1b": { module: "./optimized/entry_0f1b.js", export: "entry_0f1b" },
    "0x0f56": { module: "./optimized/sub_0f56.js", export: "sub_0f56" },
    "0x0fd7": { module: "./optimized/loc_0fd7.js", export: "loc_0fd7" },
    "0x101f": { module: "./optimized/loc_101f.js", export: "loc_101f" },
    "0x1087": { module: "./optimized/loc_1087.js", export: "loc_1087" },
    "0x1131": { module: "./optimized/loc_1131.js", export: "loc_1131" },
    "0x1186": { module: "./optimized/sub_1186.js", export: "sub_1186" },
    "0x11a6": { module: "./optimized/sub_11a6.js", export: "sub_11a6" },
    "0x11d3": { module: "./optimized/sub_11d3.js", export: "sub_11d3" },
    "0x11ec": { module: "./optimized/sub_11ec.js", export: "sub_11ec" },
    "0x11fa": { module: "./optimized/sub_11fa.js", export: "sub_11fa" },
    "0x122a": { module: "./optimized/sub_122a.js", export: "sub_122a" },
    "0x2441": { module: "./optimized/sub_2441.js", export: "sub_2441" },
  },
};
