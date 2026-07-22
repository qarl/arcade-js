// SPDX-License-Identifier: GPL-3.0-only
/**
 * Video ROM decode: tiles, sprites and the colour PROMs.
 *
 * Graphics come from the character/sprite ROMs and the colour PROMs, decoded
 * deterministically. There is no guessing here and no observation of
 * screenshots; the layouts are stated facts from MAME's driver.
 *
 * Region layouts (verified, from the driver):
 *   gfx1  8x8x2 planar tiles, 64 colour codes.
 *         v_5h_b.bin@0x000 + v_3pt.bin@0x800, concatenated -> 4096 bytes.
 *   gfx2  16x16 2bpp sprites, 128 of them, planes at RGN_FRAC(1,2) and
 *         RGN_FRAC(0,2). Four 2KB ROMs -> 8192 bytes.
 *   proms c-2k@0x000 palette LOW nibble (inverted), c-2j@0x100 palette HIGH
 *         nibble (inverted), v-5e@0x200 character colour code PER COLUMN.
 */

export const TILE_COUNT = 256; // 2048 bytes per plane / 8 bytes per tile
export const TILE_W = 8;
export const TILE_H = 8;

/** Tilemap geometry. 32 columns x 32 rows of 8x8, of which 224 rows show. */
export const COLS = 32;
export const ROWS = 32;
export const SCREEN_W = 256;
export const SCREEN_H = 224;

/**
 * Decode gfx1 into per-tile 2-bit pixel indices.
 *
 * `gfx_8x8x2_planar`: two bitplanes, plane 0 at region offset 0 and plane 1
 * at RGN_FRAC(1,2) -- i.e. halfway through the region, 2048 bytes in. Each
 * tile is 8 bytes per plane, one byte per row, MSB = leftmost pixel.
 *
 * PLANE ORDER IS A REAL DECISION, not a formality: MAME lists the planes
 * { RGN_FRAC(1,2), RGN_FRAC(0,2) }, so the FIRST entry -- the second half of
 * the region -- is the HIGH bit. Getting this backwards swaps colour indices
 * 1 and 2, which produces a plausible-looking image with wrong colours.
 *
 * @returns {Uint8Array} TILE_COUNT * 64 entries, each 0-3.
 */
export function decodeTiles(gfx1) {
  const planeSize = gfx1.length / 2; // 2048
  const out = new Uint8Array(TILE_COUNT * TILE_W * TILE_H);
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    for (let y = 0; y < TILE_H; y++) {
      const lo = gfx1[tile * 8 + y];
      const hi = gfx1[planeSize + tile * 8 + y];
      for (let x = 0; x < TILE_W; x++) {
        const bit = 7 - x; // MSB is the leftmost pixel
        const v = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        out[tile * 64 + y * 8 + x] = v;
      }
    }
  }
  return out;
}

export const SPRITE_COUNT = 128; // RGN_FRAC(1,4) of an 8192-byte region
export const SPRITE_W = 16;
export const SPRITE_H = 16;

/**
 * Decode gfx2 into per-sprite 2-bit pixel indices, 16x16.
 *
 * From MAME's `spritelayout` (dkong.cpp:1675), transcribed rather than
 * guessed -- 128 sprites, 2bpp, and TWO independent splits of the 8192-byte
 * region that a naive "16 bytes per sprite" decode gets wrong:
 *
 *   planes  { RGN_FRAC(1,2), RGN_FRAC(0,2) }  -> HIGH bit at byte 4096, LOW at
 *           byte 0. Same MSB-first plane order as the tiles: the FIRST list
 *           entry is the high bit, so reversing it swaps pen indices 1 and 2.
 *   halves  { STEP8(0,1), STEP8(RGN_FRAC(1,4),1) }  -> the LEFT 8 columns and
 *           the RIGHT 8 columns of every sprite live in separate 2048-byte
 *           blocks. Columns 8-15 sit 2048 bytes further in, NOT in the next
 *           byte. This is the split that makes it not a plain 16-wide row.
 *
 * So the region is four 2048-byte quadrants: [low,left] [low,right]
 * [high,left] [high,right]. A row of the left half of sprite `code` is byte
 * `code*16 + y`; the right half is the same byte + 2048; the high plane is
 * +4096 on each. MSB of a byte is the leftmost of its 8 columns.
 *
 * @returns {Uint8Array} SPRITE_COUNT * 256 entries, each 0-3, row-major.
 */
export function decodeSprites(gfx2) {
  const HALF = gfx2.length >> 2; // 2048 -- RGN_FRAC(1,4)
  const PLANE = gfx2.length >> 1; // 4096 -- RGN_FRAC(1,2)
  const out = new Uint8Array(SPRITE_COUNT * SPRITE_W * SPRITE_H);
  for (let code = 0; code < SPRITE_COUNT; code++) {
    for (let y = 0; y < SPRITE_H; y++) {
      // left half is byte code*16+y; right half is that + HALF.
      const loLeft = gfx2[code * 16 + y];
      const loRight = gfx2[code * 16 + y + HALF];
      const hiLeft = gfx2[code * 16 + y + PLANE];
      const hiRight = gfx2[code * 16 + y + PLANE + HALF];
      for (let x = 0; x < SPRITE_W; x++) {
        const half = x < 8 ? 0 : 1; // which 8-column block
        const bit = 7 - (x & 7); // MSB is the leftmost of the 8
        const lo = half === 0 ? loLeft : loRight;
        const hi = half === 0 ? hiLeft : hiRight;
        const v = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        out[code * 256 + y * 16 + x] = v;
      }
    }
  }
  return out;
}

/**
 * The three PROMs, split out of the concatenated 768-byte region.
 *
 * v-5e is indexed PER COLUMN, not per tile: it supplies the colour code for
 * a screen column, which is why a screen of identical tiles still shows
 * vertical stripes. That is the independent corroboration to aim at -- MAME's
 * frame 0 is cyan/green stripes out of zeroed VRAM, and a UNIFORM frame 0
 * means this lookup is wrong.
 */
export function splitProms(proms) {
  return {
    paletteLow: proms.subarray(0x000, 0x100), // c-2k, INVERTED
    paletteHigh: proms.subarray(0x100, 0x200), // c-2j, INVERTED
    charColour: proms.subarray(0x200, 0x300), // v-5e, per column
  };
}

/**
 * Palette PROM bit extraction, from MAME's `dkong_decode_info`:
 *
 *     offsets { 256, 256,   0,   0,   0,   0 }   R G B R G B
 *     shifts  {   1,  -2,   0,   0,   2,   0 }
 *     masks   {0x07,0x04,0x03,0x00,0x03,0x00}
 *
 * Offset 0 is c-2k (region base) and offset 256 is c-2j, per the ROM layout.
 * A NEGATIVE shift means shift LEFT. Entries 3 and 5 have mask 0x00 and are
 * unused, so:
 *
 *     R = (c2j >> 1) & 0x07                                 3 bits
 *     G = ((c2j << 2) & 0x04) | ((c2k >> 2) & 0x03)         3 bits, TWO PROMs
 *     B =  (c2k >> 0) & 0x03                                2 bits
 *
 * G IS ASSEMBLED FROM BOTH PROMS, which is the part that would be easy to
 * miss: it is not "c-2j is the high nibble of everything". Each channel takes
 * its bits from wherever the board wired them.
 *
 * CROSS-CHECK, and this is why the widths are trustworthy: the resistor
 * network lists 3 resistors for R {1000,470,220}, 3 for G {1000,470,220} and
 * 2 for B {470,220}. Bit widths derived from the decode info and resistor
 * counts derived from the net info agree independently -- 3/3/2 both ways.
 *
 * @returns {{r:Uint8Array,g:Uint8Array,b:Uint8Array}} per-pen network indices
 */
export function extractPaletteBits(proms) {
  const { paletteLow: c2k, paletteHigh: c2j } = splitProms(proms);
  const n = 256;
  const r = new Uint8Array(n);
  const g = new Uint8Array(n);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = (c2j[i] >> 1) & 0x07;
    g[i] = ((c2j[i] << 2) & 0x04) | ((c2k[i] >> 2) & 0x03);
    b[i] = c2k[i] & 0x03;
  }
  return { r, g, b };
}

/**
 * Pens that MAME overwrites with a separately-computed black.
 *
 *     if ((i & 0x03) == 0x00)   // NOR => CS=1 => Tristate => real black
 *
 * 64 of the 256 pens. Their colour does NOT come from the resistor network
 * applied to the PROM bits -- it comes from `dkong_net_bck_info`, which has
 * zero resistors on every channel. Applying the normal path to these gives
 * 64 subtly wrong pens.
 */
export function isTristateBlack(pen) {
  return (pen & 0x03) === 0x00;
}

/** Supply voltage. RES_NET_VCC_5V in the driver's option flags. */
export const VCC = 5.0;

/**
 * The monitor output stage, verbatim from MAME's `compute_res_net`
 * (src/emu/video/resnet.cpp), for `RES_NET_MONITOR_SANYO_EZV20`:
 *
 *     v = vcc - v;
 *     v = std::max(double(0), v-0.7);
 *     v = std::min(v, vcc - 2 * 0.7);
 *     v = v / (vcc-1.4);
 *     v = v * vcc;
 *     ...
 *     return int(v * 255 / vcc + 0.4);
 *
 * THIS IS WHERE THE PROM INVERSION LIVES, and both halves of that are
 * counter-intuitive:
 *
 *  - The inversion is `vcc - v` applied to the computed VOLTAGE, AFTER the
 *    resistor network -- not a complement of the PROM byte before lookup.
 *    Those give different colours and both look plausible.
 *  - It is NOT a bare inversion. SANYO_EZV20 adds a 0.7 V diode drop, a
 *    clamp at vcc - 1.4, and a renormalisation back over vcc. Implementing
 *    `RES_NET_MONITOR_INVERT` (which IS the bare `vcc - v`) would give
 *    plausible, wrong colours.
 *  - The final rounding is `+ 0.4`, not `+ 0.5`. Byte-for-byte, that differs.
 *
 * `RES_NET_VIN_MB7052` does NOT carry the inversion -- resnet.h aliases it
 * to RES_NET_VIN_TTL_OUT; it only describes the PROM's output levels.
 */
export function monitorSanyoEzv20(v, vcc = VCC) {
  // GUARD, because this bit me immediately: `[...].map(monitorSanyoEzv20)`
  // passes the ARRAY INDEX as the second argument, so vcc silently becomes
  // 0, 1, 2... and the function returns NaN or garbage that looks like data.
  // A default parameter on a function anyone might use as a map callback is
  // a trap; rejecting implausible supply voltages closes it.
  if (!(vcc > 1.4)) {
    throw new Error(
      `monitorSanyoEzv20: vcc=${vcc} is not a supply voltage. If this came ` +
        "from Array.map, note it passes (value, index, array) -- wrap the call.",
    );
  }
  v = vcc - v;
  v = Math.max(0, v - 0.7);
  v = Math.min(v, vcc - 2 * 0.7);
  v = v / (vcc - 1.4);
  v = v * vcc;
  return Math.trunc((v * 255) / vcc + 0.4);
}

/**
 * Resistor values per channel, from `dkong_net_info`:
 *
 *     R: RES_NET_AMP_DARLINGTON, rBias 470, rGnd 0, 3 resistors {1000,470,220}
 *     G: RES_NET_AMP_DARLINGTON, rBias 470, rGnd 0, 3 resistors {1000,470,220}
 *     B: RES_NET_AMP_EMITTER,    rBias 680, rGnd 0, 2 resistors { 470,220}
 *
 * R and G are Darlington amplifiers; B is an emitter follower with a
 * different bias resistor. They are NOT symmetric, so a single shared
 * channel model would be wrong for B.
 *
 * NOT YET SUFFICIENT TO COMPUTE COLOURS: the network stage that turns these
 * into a voltage (`compute_res_net`'s body, and the AMP_DARLINGTON /
 * AMP_EMITTER models) has not been read. Only the OUTPUT stage above is
 * implemented. Deliberately not guessing the network maths -- that is the
 * half where a plausible-but-wrong model is invisible until a pixel diff.
 */
export const DKONG_NET_INFO = {
  vcc: VCC,
  r: { amp: "DARLINGTON", rBias: 470, rGnd: 0, resistors: [1000, 470, 220] },
  g: { amp: "DARLINGTON", rBias: 470, rGnd: 0, resistors: [1000, 470, 220] },
  b: { amp: "EMITTER", rBias: 680, rGnd: 0, resistors: [470, 220] },
};

/**
 * The tri-state black network, `dkong_net_bck_info` -- same amps and bias
 * resistors, but ZERO signal resistors on every channel. Applied to the 64
 * pens where `(pen & 0x03) == 0`, overwriting whatever the normal path
 * produced.
 */
export const DKONG_NET_BCK_INFO = {
  vcc: VCC,
  r: { amp: "DARLINGTON", rBias: 470, rGnd: 0, resistors: [] },
  g: { amp: "DARLINGTON", rBias: 470, rGnd: 0, resistors: [] },
  b: { amp: "EMITTER", rBias: 680, rGnd: 0, resistors: [] },
};

/**
 * First displayed tilemap pixel row: 16, i.e. TWO tile rows are hidden at
 * EACH END -- rows 0..1 and 30..31. Displayed rows are 2..29.
 *
 * THIS VALUE HAS BEEN WRONG IN BOTH DIRECTIONS AND THE HISTORY IS THE POINT.
 *
 * It began at 16 derived from the wrong coordinate system (vbend numbers
 * RASTER lines, and the raster origin is not the tilemap origin) -- a correct
 * number with a bogus provenance. It was then changed to 32 on a derivation
 * that was arithmetically sound and factually wrong: 1024 slots - 896 visible
 * = 128 undisplayed, plus a measurement that offsets 0..112 were invisible,
 * concluding 128 CONTIGUOUS at the start. The count is right; the contiguity
 * is not. The margin is 64 bytes at each end, not 128 at one.
 *
 * AND THE SUPPORTING MEASUREMENT WAS CONFOUNDED, not just misread. Offsets
 * 64..112 lie in rows 2..3, which ARE displayed -- so "clearing 0..112
 * changed no pixel" is incompatible with the true mapping unless those slots
 * already held what they were cleared to. They did. A no-op write reads
 * exactly like an invisible one, and nothing in the output distinguishes
 * them. Any future "is this slot displayed" probe has to write a value known
 * to DIFFER from what is already there.
 *
 * WHAT MADE 32 LOOK CONFIRMED. Under it, tile rows 2..3 fall in the margin --
 * and rows 2..3 are exactly where the boot clear was working during frame 3.
 * Hiding them turned a torn, mid-clear frame into a uniform one that matched
 * golden byte-for-byte. THE WRONG CONSTANT PRODUCED A PERFECT MATCH BY
 * CONCEALING THE PIXELS THAT WOULD HAVE FALSIFIED IT.
 *
 * The value is now pinned by a block-level mapping, derived from golden
 * artifacts alone and validated on five STATIC frames (8, 20, 60, 150, 300)
 * with zero mismatched blocks, against 200 for the alternative:
 *
 *     addr = (29 - blockRow) * 32 + (31 - blockCol)
 *
 * which is precisely this file's flip path with VISIBLE_Y0 = 16:
 * `ty = 16 + 224 - 1 - sy` spans rows 29..2, and `tx = 255 - sx` spans
 * columns 31..0. Two independent derivations meeting on the same mapping:
 * the block mapping over five static frames, and the flip transform in
 * renderTilemapPens.
 */
export const VISIBLE_Y0 = 16;

/**
 * Render the tilemap to PEN INDICES (not RGB).
 *
 * Pens are separated from colour deliberately: this half is fully specified
 * by the driver and independently checkable, while the resistor-network maths
 * that turns a pen into RGB is not yet read. Producing pens first means a
 * pixel-diff failure can be attributed to one half or the other.
 *
 * From `dkong_bg_tile_info`:
 *
 *     code  = video_ram[tile] + 256 * gfx_bank
 *     color = (color_codes[tile % 32 + 32 * (tile / 32 / 4)] & 0x0f)
 *             + 0x10 * palette_bank
 *
 * THE COLOUR INDEX IS PER COLUMN **AND PER FOUR-ROW BAND** -- `col + 32 *
 * (row >> 2)`. Corroborated exactly by size: 32 columns x (32 rows / 4) = 256
 * entries, and v-5e.bpr is exactly 256 bytes. A purely per-column lookup
 * would need only 32.
 *
 * Pen arithmetic: gfx1 is 2bpp with 64 colour codes, so MAME's granularity is
 * 4 and `pen = color * 4 + pixel`. 64 x 4 = 256, matching the palette size.
 *
 * CONSEQUENCE WORTH KNOWING: since pen = color*4 + pixel, `pen & 0x03` IS the
 * pixel value -- so the tri-state-black rule `(pen & 0x03) == 0` means EVERY
 * pixel of value 0 is structurally black, in every tile, under every palette
 * bank. Not "a palette entry that happens to be dark".
 *
 * @returns {Uint8Array} SCREEN_W * SCREEN_H pen indices
 */
export function renderTilemapPens(videoRam, tiles, charColour, opts = {}) {
  const { gfxBank = 0, paletteBank = 0, flip = 0 } = opts;
  // Checked ONCE here rather than per pixel. Removing the old `& 0xff` fixed a
  // silently-swallowed gfxBank, but on its own it traded silence for a worse
  // silence: an out-of-range index yields undefined, `color*4 + undefined` is
  // NaN, and `NaN & 0xff` is 0 -- an entirely BLACK frame with no error. That
  // is precisely the plausible-but-wrong failure this file exists to avoid.
  if ((gfxBank + 1) * TILE_COUNT * 64 > tiles.length) {
    throw new Error(
      `renderTilemapPens: gfxBank ${gfxBank} needs tiles beyond the ` +
        `${tiles.length / 64} decoded (dkong's gfx1 holds only ${TILE_COUNT})`,
    );
  }
  const out = new Uint8Array(SCREEN_W * SCREEN_H);

  for (let sy = 0; sy < SCREEN_H; sy++) {
    // FLIP, from dkong_v.cpp: `set_flip_all(m_flip ? TILEMAP_FLIPX |
    // TILEMAP_FLIPY : 0)` on a TILEMAP_SCAN_ROWS 8x8x32x32 tilemap, drawn
    // with NO scroll arguments. A 180-degree turn of the DISPLAYED IMAGE.
    //
    // THE REFLECTION AXIS IS THE CENTRE OF THE VISIBLE AREA, NOT OF THE
    // TILEMAP. MAME's flip path computes the effective scroll as
    // `yextent = visarea.bottom() + visarea.top() + 1` -- note PLUS top --
    // which places the axis mid-window, so the visible band maps onto
    // ITSELF: top<->bottom. Hence `VISIBLE_Y0 + SCREEN_H - 1 - sy`.
    //
    // A first version wrote `255 - (sy + VISIBLE_Y0)`, mirroring about the
    // tilemap's extent rather than the window. The two forms coincide exactly
    // when 2*VISIBLE_Y0 == 255 - (SCREEN_H-1), i.e. when VISIBLE_Y0 == 16 --
    // which is the value now in force, so THAT BUG IS CURRENTLY UNREACHABLE
    // and the rotation test cannot pin the axis choice while V0 is 16. The
    // window form is kept because it is what MAME computes; if VISIBLE_Y0
    // ever moves, the distinction becomes live again and the test regains
    // its teeth. Recorded so a future reader does not "simplify" it back.
    //
    // CONSEQUENCE: the undisplayed margin does not move. Tile rows 0..1 and
    // 30..31 are hidden in BOTH orientations -- which is what makes the
    // margin a mirror-symmetric 2-and-2 rather than 4 at one end.
    const ty = flip ? VISIBLE_Y0 + SCREEN_H - 1 - sy : sy + VISIBLE_Y0;
    const row = (ty >> 3) & 31;
    const yInTile = ty & 7;
    for (let sx = 0; sx < SCREEN_W; sx++) {
      const tx = flip ? 255 - sx : sx;
      const col = (tx >> 3) & 31;
      const xInTile = tx & 7;

      const tileIndex = row * COLS + col;
      // MAME: `code = m_video_ram[tile_index] + 256 * m_gfx_bank`. This was
      // written `(... + 256 * gfxBank) & 0xff`, which makes gfxBank a
      // GUARANTEED no-op -- 256*bank & 0xff is always 0 -- so a nonzero bank
      // would have been swallowed in silence rather than going wrong loudly.
      const code = videoRam[tileIndex] + 256 * gfxBank;
      const colourIdx = col + 32 * (row >> 2); // per column AND 4-row band
      const color = (charColour[colourIdx] & 0x0f) + 0x10 * paletteBank;

      const pixel = tiles[code * 64 + yInTile * 8 + xInTile];
      out[sy * SCREEN_W + sx] = (color * 4 + pixel) & 0xff;
    }
  }
  return out;
}

// TTL output levels, from resnet.cpp.
const TTL_VOL = 0.05;
const TTL_VOH = 4.0;
/** "rough estimation from 82s129 (7052) datasheet ... 1.4k / 30" */
const TTL_H_RES = 50;

/**
 * Per-channel amplifier characteristics.
 *
 * THERE ARE TWO `RES_NET_AMP_MASK` SWITCHES IN resnet.cpp AND THEY SET
 * DIFFERENT VALUES FOR THE SAME ENUM. The global one uses minout=0.9 for
 * DARLINGTON; the per-channel one uses minout=0.7. DK sets its amps
 * PER-CHANNEL -- the global `options` field carries only
 * VCC_5V|VBIAS_5V|VIN_MB7052|MONITOR_SANYO_EZV20 with no AMP flag, so the
 * global switch falls through to "ignore" and the per-channel values win.
 *
 * Reading the wrong block gives 0.9 instead of 0.7 and produces plausible,
 * slightly-wrong colours across the ENTIRE palette.
 */
const AMPS = {
  DARLINGTON: { minout: 0.7, cut: 0.0 },
  EMITTER: { minout: 0.0, cut: 0.7 },
};

/**
 * One channel of `compute_res_net`, from resnet.cpp.
 *
 * Two passes with an open-collector promotion between them: low inputs are
 * summed first, then rBias and rGnd mixed in, and if the resulting voltage
 * already exceeds vOH the high inputs are treated as high-impedance and
 * contribute nothing.
 *
 * THE PROMOTION IS TESTED ON `v / rTotal` BEFORE rTotal IS INVERTED -- at
 * that point rTotal is a sum of conductances and v a sum of V/R, so the
 * quotient is the weighted-average voltage. Inverting early changes the
 * OpenCol decision on edge cases.
 *
 * `ttlHRes` is added to the HIGH-side resistors only, and `rBias` is the
 * 470/470/680 from dkong_net_info -- a separate field, not a member of R[].
 */
function computeResNetChannel(inputs, ch, vcc = VCC, vBias = 5.0) {
  const { minout, cut } = AMPS[ch.amp];
  const R = ch.resistors;
  let rTotal = 0;
  let v = 0;

  // Pass A -- low inputs.
  for (let i = 0; i < R.length; i++) {
    const level = (inputs >> i) & 1;
    if (R[i] !== 0 && !level) {
      rTotal += 1.0 / R[i];
      v += TTL_VOL / R[i];
    }
  }

  if (ch.rBias !== 0) {
    rTotal += 1.0 / ch.rBias;
    v += vBias / ch.rBias;
  }
  if (ch.rGnd !== 0) rTotal += 1.0 / ch.rGnd;

  // Open-collector promotion, on the pre-inversion quotient.
  let openCol = 0;
  if (v / rTotal > TTL_VOH) openCol = 1;

  // Pass B -- high inputs.
  for (let i = 0; i < R.length; i++) {
    const level = (inputs >> i) & 1;
    if (R[i] !== 0 && level && !openCol) {
      rTotal += 1.0 / (R[i] + TTL_H_RES);
      v += TTL_VOH / (R[i] + TTL_H_RES);
    }
  }

  rTotal = 1.0 / rTotal;
  v *= rTotal;
  v = Math.max(minout, v - cut);
  return monitorSanyoEzv20(v, vcc);
}

/**
 * Build the 256-entry palette as RGB triples, reproducing
 * `dkong2b_palette()`.
 *
 * The tri-state black is applied AFTER the resistor net, overwriting the 64
 * pens where `(pen & 0x03) == 0` with a separately computed black from
 * `dkong_net_bck_info` -- which has zero signal resistors on every channel.
 *
 * Final stage is `normalize_range(0, 255)` -- see `normalizeRange` below.
 * This was flagged-and-skipped in the first renderer draft on the guess that
 * it was a no-op scale; the first pixel diff proved otherwise, and the guess
 * was wrong about WHAT it does, not just whether it mattered.
 *
 * @returns {Uint8Array} 256*3 bytes, R,G,B per pen
 */
export function buildPalette(proms) {
  const { r, g, b } = extractPaletteBits(proms);
  const out = new Uint8Array(256 * 3);
  const N = DKONG_NET_INFO;
  const BCK = DKONG_NET_BCK_INFO;

  for (let pen = 0; pen < 256; pen++) {
    const src = isTristateBlack(pen) ? BCK : N;
    const idx = isTristateBlack(pen) ? [0, 0, 0] : [r[pen], g[pen], b[pen]];
    out[pen * 3 + 0] = computeResNetChannel(idx[0], src.r);
    out[pen * 3 + 1] = computeResNetChannel(idx[1], src.g);
    out[pen * 3 + 2] = computeResNetChannel(idx[2], src.b);
  }
  return normalizeRange(out, 0, 255);
}

/**
 * C++ integer division: truncates TOWARD ZERO, unlike JS `Math.floor` which
 * rounds toward negative infinity. The two agree on positives and differ by
 * one on every negative that does not divide exactly.
 *
 * This is load-bearing, not pedantry. `u` and `v` below are signed and are
 * negative for any colour less blue / less red than its own luminance, which
 * is most of them. Using `Math.floor` shifts those channels by one -- see
 * the truncation test, which pins it against a golden pixel.
 */
const idiv = (a, b) => Math.trunc(a / b);

const clamp8 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);

/**
 * MAME `palette_t::normalize_range` -- `src/lib/util/palette.cpp`.
 * [lead-verified against source]
 *
 *   // pass 1, over [start,end]:
 *   int32_t ymin = 1000 * 255, ymax = 0;
 *   uint32_t y = 299 * rgb.r() + 587 * rgb.g() + 114 * rgb.b();   // UNSIGNED here
 *   int32_t tmin = (lum_min < 0) ? ((ymin + 500) / 1000) : lum_min;
 *   int32_t tmax = (lum_max < 0) ? ((ymax + 500) / 1000) : lum_max;
 *   // pass 2, a SEPARATE loop with its own y -- and this one is SIGNED:
 *   int32_t y = 299 * rgb.r() + 587 * rgb.g() + 114 * rgb.b();
 *   int32_t u = ((int32_t)rgb.b()-y /1000)*492 / 1000;
 *   int32_t v = ((int32_t)rgb.r()-y / 1000)*877 / 1000;
 *   int32_t target = tmin + ((y - ymin) * (tmax - tmin + 1)) / (ymax - ymin);
 *   uint8_t r = rgb_t::clamp(target + 1140 * v / 1000);
 *   uint8_t g = rgb_t::clamp(target -  395 * u / 1000 - 581 * v / 1000);
 *   uint8_t b = rgb_t::clamp(target + 2032 * u / 1000);
 *
 * DESPITE THE NAME THIS IS NOT A PER-CHANNEL STRETCH. It converts to YUV,
 * rescales the LUMINANCE to span [tmin,tmax], and reconstitutes RGB with the
 * ORIGINAL CHROMA. So a channel maxing at 225 does not become 255: the
 * chroma terms pull it wherever the hue requires. That is exactly why the
 * first bad pixel read golden=(232,7,10) rather than a clean 255 -- and why
 * a channels-max-to-255 "fix" would have moved the diff without being right.
 *
 * THE DEFAULTS DECIDE THE REST. `palette.h` declares
 * `normalize_range(start, end, lum_min = 0, lum_max = 255)` and
 * `dkong2b_palette` passes TWO arguments, so both are non-negative and
 * `tmin`/`tmax` are 0/255 DIRECTLY. The `ymin`/`ymax`-derived branch never
 * runs for DK. It is transcribed anyway for fidelity, but note it is
 * therefore NOT exercised by the pixel gate -- unverified code, flagged as
 * such rather than left to look verified by association.
 *
 * `ymin`/`ymax` are still computed from the palette regardless: they set the
 * INPUT span of the luminance remap even when the output span is fixed.
 *
 * The two `y` declarations above are in DIFFERENT loops and have DIFFERENT
 * signedness, and the second one being signed is load-bearing: if `y` were
 * unsigned in pass 2, `(int32_t)rgb.b() - y/1000` would promote to unsigned
 * and yield a huge positive value instead of -67. Condensing the two loops
 * into one quote is what makes that easy to misread, so both are shown.
 *
 * Integer division at every step is part of the answer, not incidental --
 * including the `+ 1` in `(tmax - tmin + 1)`.
 *
 * @param {Uint8Array} palette 3 bytes per entry, modified into a copy
 * @returns {Uint8Array} a new palette; the input is not mutated
 */
export function normalizeRange(palette, start = 0, end = 255, lumMin = 0, lumMax = 255) {
  const numColors = palette.length / 3;
  end = Math.min(end, numColors - 1); // MAME clamps `end` the same way

  let ymin = 1000 * 255;
  let ymax = 0;
  for (let i = start; i <= end; i++) {
    const y = 299 * palette[i * 3] + 587 * palette[i * 3 + 1] + 114 * palette[i * 3 + 2];
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }

  // MAME would divide by zero here; a palette with no luminance range means
  // something upstream produced a degenerate palette, so say so rather than
  // emitting NaN that renders as plausible garbage.
  // `<=` not `===`: an inverted range (start > end) leaves the scan bounds at
  // their sentinels, ymin=255000 > ymax=0, which `===` sails straight past --
  // returning an un-normalized copy with no error. Unreachable from the only
  // caller today, which is exactly why it would go unnoticed later.
  if (ymax <= ymin) {
    throw new Error(
      `normalizeRange: no luminance range over [${start},${end}] (ymin=${ymin} ymax=${ymax})`,
    );
  }

  const tmin = lumMin < 0 ? idiv(ymin + 500, 1000) : lumMin;
  const tmax = lumMax < 0 ? idiv(ymax + 500, 1000) : lumMax;

  const out = Uint8Array.from(palette);
  for (let i = start; i <= end; i++) {
    const R = palette[i * 3];
    const G = palette[i * 3 + 1];
    const B = palette[i * 3 + 2];
    const y = 299 * R + 587 * G + 114 * B;
    const u = idiv((B - idiv(y, 1000)) * 492, 1000);
    const v = idiv((R - idiv(y, 1000)) * 877, 1000);
    const target = tmin + idiv((y - ymin) * (tmax - tmin + 1), ymax - ymin);
    out[i * 3 + 0] = clamp8(target + idiv(1140 * v, 1000));
    out[i * 3 + 1] = clamp8(target - idiv(395 * u, 1000) - idiv(581 * v, 1000));
    out[i * 3 + 2] = clamp8(target + idiv(2032 * u, 1000));
  }
  return out;
}

/**
 * Render one frame to the RGB888 buffer the frame contract specifies:
 * 256x224, row-major, top-left origin, R,G,B per pixel, no padding,
 * NATIVE ORIENTATION UNROTATED.
 *
 * Unrotated is not merely convenient. `handler_05e9` draws strings
 * vertically in tilemap space, which is horizontal on a screen the hardware
 * rotates 270 degrees -- the ROM computes in native tilemap coordinates, so
 * this renders in the space the ROM actually works in.
 *
 * Sprites are NOT drawn yet: the gfx2 layout offsets are unread, and
 * guessing them yields a recognisable-but-mangled image, which is the
 * failure hardest to distrust because it looks nearly right.
 */
export function renderFrameRGB(videoRam, tiles, charColour, palette, opts = {}) {
  const pens = renderTilemapPens(videoRam, tiles, charColour, opts);
  const out = new Uint8Array(SCREEN_W * SCREEN_H * 3);
  for (let i = 0; i < pens.length; i++) {
    const p = pens[i];
    out[i * 3 + 0] = palette[p * 3 + 0];
    out[i * 3 + 1] = palette[p * 3 + 1];
    out[i * 3 + 2] = palette[p * 3 + 2];
  }
  return out;
}

/**
 * Draw the sprite layer ON TOP of an already-painted tilemap frame buffer.
 *
 * A FRAME-LEVEL POST-PASS with SCANLINE-FAITHFUL selection inside. Frame-level
 * because the trace showed sprite RAM is written only in vblank on all 207
 * sprite-bearing frames, so it is static across the visible frame;
 * scanline-faithful because dkong's hardware buffers one scanline of sprites
 * at a time with a 16-per-line limit, and MAME's draw_sprites reproduces that
 * per scanline.
 *
 * TRANSCRIBED FROM MAME 0.288 dkong_v.cpp draw_sprites (the version called by
 * screen_update_dkong with mask_bank=0x40, shift_bits=1 -- NOT the 0x10,3 of
 * screen_update_spclforc, which is a different game). 4 bytes per sprite:
 *   offs+0  y
 *   offs+1  bit7 flipy, bits0-6 code low 7
 *   offs+2  bit7 flipx, bit6 (<<1) code bit 7, bits0-3 colour
 *   offs+3  x
 * A sprite draws on a scanline when ((y + add_y + 1 + scanline_vf) & 0xF0) ==
 * 0xF0; the row within the sprite is the low nibble of the same sum. Sprite
 * pens use the SAME 256-entry palette as tiles: pen = colour*4 + pixel, and
 * pixel 0 is transparent (transpen 0).
 *
 * BANK 1 IS UNGATED: 7D83 sprite_bank is 0 in every capture, so opts.spriteBank
 * is read but only bank 0 is exercised by any tape.
 *
 * The geometry maps our output row `sy` (0..223, top origin) to MAME's raster
 * `scanline = sy + VBEND` (VBEND = 16, the first visible line). Validated
 * against golden frame-by-frame, not derived on paper alone.
 */
export function drawSprites(rgb, spriteRam, sprites, palette, opts = {}) {
  const { flip = 0, paletteBank = 0, spriteBank = 0 } = opts;
  const MASK_BANK = 0x40; // dkong: sprite tile-bank bit
  const SHIFT_BITS = 1;
  const base = spriteBank << 9; // 0x200 bytes per bank

  for (let sy = 0; sy < SCREEN_H; sy++) {
    const raster = (sy + VBEND) & 0xff;
    let scanlineVf = (raster - 1) & 0xff;
    let scanlineVfc = (raster - 1) & 0xff;
    let addY;
    let addX;
    if (flip) {
      scanlineVf ^= 0xff;
      scanlineVfc ^= 0xff;
      addY = 0xf7;
      addX = 0xf7;
    } else {
      addY = 0xf9;
      addX = 0xf7;
    }

    let numSprt = 0;
    for (let offs = base; numSprt < 16 && offs < base + 0x200; offs += 4) {
      const yb = spriteRam[offs];
      if (((yb + addY + 1 + scanlineVf) & 0xf0) !== 0xf0) continue;

      // 128 sprites decoded; MAME's gfx wraps the code to the element count.
      const code =
        ((spriteRam[offs + 1] & 0x7f) +
          ((spriteRam[offs + 2] & MASK_BANK) << SHIFT_BITS)) %
        SPRITE_COUNT;
      const color = (spriteRam[offs + 2] & 0x0f) + 16 * paletteBank;
      let flipx = (spriteRam[offs + 2] & 0x80) !== 0;
      const flipy = (spriteRam[offs + 1] & 0x80) !== 0;

      let x = (spriteRam[offs + 3] + addX + 1) & 0xff;
      if (flip) {
        x = ((x ^ 0xff) - 15) & 0x1ff;
        flipx = !flipx;
      }

      const rowInSprite = (yb + addY + 1 + scanlineVfc) & 0x0f;
      const srow = flipy ? 15 - rowInSprite : rowInSprite;

      for (let cx = 0; cx < 16; cx++) {
        const scol = flipx ? 15 - cx : cx;
        const pix = sprites[code * 256 + srow * 16 + scol];
        if (pix === 0) continue; // transpen 0
        const px = (x + cx) & 0xff; // wraparound within the 256-wide line
        const pen = (color * 4 + pix) & 0xff;
        const o = (sy * SCREEN_W + px) * 3;
        rgb[o + 0] = palette[pen * 3 + 0];
        rgb[o + 1] = palette[pen * 3 + 1];
        rgb[o + 2] = palette[pen * 3 + 2];
      }
      numSprt++;
    }
  }
  return rgb;
}

/**
 * Scanline geometry. 264 lines per frame, 192 CPU cycles each
 * (264 * 192 = 50688 = CYCLES_PER_FRAME exactly), of which lines
 * VBEND..VBEND+223 are displayed.
 */
export const CYCLES_PER_LINE = 192;
// Exported for documentation of the geometry: 264 * 192 == CYCLES_PER_FRAME
// is the identity that makes CYCLES_PER_LINE exact rather than rounded.
export const LINES_PER_FRAME = 264;
/**
 * First displayed RASTER LINE, in the video chip's own line numbering.
 * Exported for documentation of the geometry only -- NOTHING READS IT.
 *
 * NOT an offset from the frame origin: that is VBLANK_LINES, and it is 40.
 * Confusing the two put every scanline 4608 cycles early, and it is an easy
 * confusion because both are "where the visible part starts" in English.
 */
export const VBEND = 16;

/**
 * Lines of vertical blanking BEFORE the first displayed line, measured from
 * the FRAME ORIGIN -- which for this driver is the vblank point, not the top
 * of the visible display. The evidence is the measured MAME NMI entries --
 * 202771 and onward, every one at frame N.000x. The raw screen params state
 * vbend/vbstart but do not, on their own, fix where the frame origin sits.
 *
 * The frame runs vbstart(240) .. 263, then 0 .. 239, so the first displayed
 * line (16) sits 24 + 16 = 40 lines into the frame, not 16. Using 16 put
 * every scanline 4608 cycles early.
 */
export const VBLANK_LINES = 40;

/**
 * Render ONE scanline into an RGB888 frame buffer, from video RAM as it
 * stands RIGHT NOW.
 *
 * WHY THE RENDERER IS RASTER-TIMED AND NOT A SNAPSHOT. A frame is not an
 * image of VRAM at any single instant -- it is 224 scanlines, each showing
 * whatever VRAM and whatever orientation were in force when the beam reached
 * that line. Rendering from one snapshot is right only when nothing that
 * matters changes mid-frame.
 *
 * Boot frame 3 is where that stopped being true, and the cause was NOT the
 * one that looked obvious. Frame 3 has 1089 mid-frame VRAM writes and
 * rendered 20380 pixels wrong; frame 4 has 949 -- a comparable number -- and
 * rendered BYTE-EXACT from a snapshot. So "the CPU rewrites the screen while
 * it is scanned out" cannot be the explanation: it predicts frame 4 failing
 * too, and frame 4 succeeds.
 *
 * The actual cause is the FLIP: `7D82 <- 01` lands at cycle 180326, which is
 * 28262 cycles into frame 3 -- VISIBLE ROW 107 of its 224, once the 40 lines
 * of leading vblank are taken off. So frame 3's image is its top 107 rows
 * UNFLIPPED and the rest FLIPPED, composited. No single-orientation render
 * can produce that at any offset. Frame 4 is entirely flipped, which is why
 * a snapshot happened to work there.
 *
 * THREE ZEROS EXIST HERE AND THEY ARE 24 AND 40 APART. For the flip write:
 *   147 = line from the FRAME ORIGIN (vblank start)  <- what "147" meant
 *   123 = ABSOLUTE RASTER LINE (147 - 24)
 *   107 = VISIBLE ROW (147 - 40)                     <- what it was called
 * An earlier note quoted 147 while calling it a visible row, and a later
 * correction called it the absolute raster line, which is also wrong. Say
 * WHICH ZERO, every time -- this ambiguity has now produced three separate
 * mislabels and one real 4608-cycle bug.
 *
 * Measured: frame 3 goes 20380 -> 0 differing pixels, and frames 2 and 4
 * stay at 0. A mechanism that fixed the failure while breaking the success
 * next to it would have been the wrong mechanism.
 */
export function renderRowRGB(out, sy, videoRam, tiles, charColour, palette, opts = {}) {
  const { gfxBank = 0, paletteBank = 0, flip = 0 } = opts;
  // Same guard as renderTilemapPens, and it belongs on BOTH paths: without
  // it an out-of-range bank indexes past `tiles`, giving undefined -> NaN ->
  // `& 0xff` -> 0, i.e. a silently ALL-BLACK frame. Having the guard on only
  // one of two otherwise-identical renderers is worse than having it on
  // neither, because it makes the unguarded one look covered.
  if ((gfxBank + 1) * TILE_COUNT * 64 > tiles.length) {
    throw new Error(
      `renderRowRGB: gfxBank ${gfxBank} needs tiles beyond the ` +
        `${tiles.length / 64} decoded (dkong's gfx1 holds only ${TILE_COUNT})`,
    );
  }
  const ty = flip ? VISIBLE_Y0 + SCREEN_H - 1 - sy : sy + VISIBLE_Y0;
  const row = (ty >> 3) & 31;
  const yInTile = ty & 7;
  for (let sx = 0; sx < SCREEN_W; sx++) {
    const tx = flip ? SCREEN_W - 1 - sx : sx;
    const col = (tx >> 3) & 31;
    const code = videoRam[row * COLS + col] + 256 * gfxBank;
    const color = (charColour[col + 32 * (row >> 2)] & 0x0f) + 0x10 * paletteBank;
    const pen = (color * 4 + tiles[code * 64 + yInTile * 8 + (tx & 7)]) & 0xff;
    const o = (sy * SCREEN_W + sx) * 3;
    out[o + 0] = palette[pen * 3 + 0];
    out[o + 1] = palette[pen * 3 + 1];
    out[o + 2] = palette[pen * 3 + 2];
  }
}
