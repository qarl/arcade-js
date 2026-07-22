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
  // but only once it passes the equivalence gates. Empty now — room for later.
  optimized: {},
};
