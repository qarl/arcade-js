/**
 * Donkey Kong board-hardware tests.
 *
 * These test boards/dkong/{memory,io,video}.js as the thing under test: the
 * memory map / work-RAM extent / unmapped-access / STATE_DUMP layout, the io
 * device split and watchdog kick, and the video decode/render pipeline
 * (decodeTiles/decodeSprites/splitProms/buildPalette/normalizeRange/render*).
 * No DK boot or translated routine is the subject. Moved verbatim from
 * games/dkong/test/boot.test.js.
 * Run: node --test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AddressSpace, STATE_DUMP_SIZE, UnmappedAccess } from "../memory.js";
import { IO } from "../io.js";
import {
  buildPalette, decodeSprites, decodeTiles, drawSprites, normalizeRange,
  renderFrameRGB, renderRowRGB, renderTilemapPens, splitProms, SPRITE_COUNT,
} from "../video.js";
import { Machine } from "../../../games/dkong/machine.js";

const ROM = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/maincpu.bin", import.meta.url)));

test("state dump is 5120 bytes: work 3072 + sprite 1024 + video 1024", () => {
  assert.equal(STATE_DUMP_SIZE, 5120);
  assert.equal(new Machine(ROM).dumpState().length, 5120);
});

test("reading 0x7D00 kicks the watchdog (the read IS the kick)", () => {
  // GATE-RULES §10. Modelling this as a pure value read silently drops the
  // kick and MAME watchdog-resets while we sail on.
  const io = new IO({});
  const mem = new AddressSpace(ROM, io);
  io.watchdog.framesSinceKick = 5;
  mem.read8(0x7d00);
  assert.equal(io.watchdog.framesSinceKick, 0);
});

test("read and write at 0x7C00 hit different devices", () => {
  // Reads IN0; writes the ls175.3d sound latch. A single backing array here
  // would be silently wrong.
  const io = new IO({});
  const mem = new AddressSpace(ROM, io);
  mem.write8(0x7c00, 0x5a);
  assert.equal(io.soundLatch3d, 0x5a);
  assert.equal(mem.read8(0x7c00), 0x00, "read returns IN0, not the latch");
});

test("unmapped access throws rather than silently succeeding", () => {
  const mem = new AddressSpace(ROM, new IO({}));
  assert.throws(() => mem.read8(0x6c00), UnmappedAccess, "0x6C00 is not RAM");
  assert.throws(() => mem.read8(0x5000), UnmappedAccess);
  assert.throws(() => mem.write8(0x0100, 0), UnmappedAccess, "write to ROM");
});

test("work RAM ends at 0x6BFF", () => {
  const mem = new AddressSpace(ROM, new IO({}));
  mem.write8(0x6bff, 0x99);
  assert.equal(mem.read8(0x6bff), 0x99);
  assert.throws(() => mem.read8(0x6c00), UnmappedAccess);
});

test("normalizeRange uses C++ truncation toward zero, not Math.floor", () => {
  // Pen 3 pre-normalize is (225,0,0). Golden MAME frame 0 renders it
  // (232,7,10). Working the source arithmetic by hand:
  //   y = 299*225 = 67275,  y/1000 = 67
  //   u = ((0-67)*492)/1000 = -32964/1000
  //   v = ((225-67)*877)/1000 = 138566/1000 = 138
  // TRUNCATION gives u = -32; FLOOR would give -33. That choice reaches the
  // output through two separate negative divisions:
  //   g = target - 395*u/1000 - 581*v/1000
  //   b = target + 2032*u/1000
  // With target 75:
  //   trunc (u=-32): g = 75 + 12 - 80 =  7,  b = 75 - 65 = 10   <- golden
  //   floor (u=-33): g = 75 + 14 - 80 =  9,  b = 75 - 68 =  7
  // Floor misses golden on BOTH channels, in OPPOSITE directions, which is
  // why the golden pixel can discriminate the rounding mode at all.
  //
  // (An earlier version of this comment said floor gives g=8,b=9. That was
  // derived from a MIXED model -- floor on the outer divisions but the
  // truncated u=-32 carried in from the other model. Applied consistently,
  // floor gives 9 and 7. The conclusion was unaffected but the numbers were
  // not reproducible, which is worse than being wrong loudly.)
  //
  // So GOLDEN ITSELF discriminates the rounding mode, on two channels
  // independently. This test exists because `Math.floor` is the reflexive JS
  // choice for integer division and would be wrong by one here -- an error
  // far too small to look like a bug and far too large to be right.
  const pal = new Uint8Array(256 * 3);
  pal[9] = 225; // pen 3 = (225,0,0)
  // A white-ish entry to set ymax where the real palette sets it.
  pal[3] = 225; pal[4] = 225; pal[5] = 255;
  const out = normalizeRange(pal, 0, 255);
  assert.deepEqual([out[9], out[10], out[11]], [232, 7, 10]);
});

test("normalizeRange preserves chroma rather than stretching channels", () => {
  // The name invites the reading "scale each channel to full range". It is a
  // LUMINANCE rescale in YUV. The distinguishing prediction: a pen whose red
  // maxes at 225 does NOT come back as 255.
  const proms = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/proms.bin", import.meta.url)));
  const pal = buildPalette(proms);
  assert.notEqual(pal[9], 255, "pen 3 red should not be stretched to full scale");
  assert.deepEqual([pal[9], pal[10], pal[11]], [232, 7, 10]);
});

test("normalizeRange refuses a degenerate palette instead of dividing by zero", () => {
  // MAME divides by (ymax - ymin) unguarded. An all-one-luminance palette
  // means something upstream is broken; NaN would render as plausible
  // garbage, which is the failure mode hardest to notice.
  assert.throws(() => normalizeRange(new Uint8Array(256 * 3), 0, 255), /no luminance range/);
});

test("normalizeRange rejects an inverted range instead of silently doing nothing", () => {
  // start > end leaves ymin/ymax at their sentinels, so an `ymin === ymax`
  // guard sails past and returns an UN-normalized copy with no error.
  const pal = new Uint8Array(256 * 3);
  pal[9] = 225;
  assert.throws(() => normalizeRange(pal, 10, 5), /no luminance range/);
});

test("screen flip is exactly a 180-degree rotation of the unflipped image", () => {
  // THE PROPERTY THAT DEFINES A COCKTAIL FLIP.
  //
  // HONEST SCOPE, because the first version of this comment overclaimed: at
  // VISIBLE_Y0 = 16 this test does NOT discriminate the reflection axis. The
  // window-mirror and extent-mirror forms are identical when
  // 2*VISIBLE_Y0 == 255 - (SCREEN_H-1), which holds at exactly 16. It caught
  // the axis bug while V0 was 32 and would catch it again if V0 moved; today
  // it pins the 180-degree property itself, which is still worth pinning and
  // is still not pinned by any golden frame.
  //
  // MAME's flip path uses `yextent = visarea.bottom() + visarea.top() + 1`,
  // placing the reflection axis mid-window so the visible band maps onto
  // itself. That is equivalent to saying: rotating the OUTPUT by 180 degrees
  // gives the same thing as rendering with flip set.
  const gfx1 = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/proms.bin", import.meta.url)));
  const tiles = decodeTiles(gfx1);
  const { charColour } = splitProms(proms);

  // A VRAM with structure: uniform content cannot distinguish orientations.
  const vram = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) vram[i] = (i * 7 + (i >> 5)) & 0xff;

  const plain = renderTilemapPens(vram, tiles, charColour, { flip: 0 });
  const flipped = renderTilemapPens(vram, tiles, charColour, { flip: 1 });

  const W = 256, H = 224;
  let bad = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (flipped[y * W + x] !== plain[(H - 1 - y) * W + (W - 1 - x)]) bad++;
    }
  }
  assert.equal(bad, 0, `${bad} pixels are not the 180-degree rotation`);

  // And it must be a real permutation, not a degenerate all-same image --
  // otherwise the assertion above passes vacuously.
  assert.ok(new Set(plain).size > 1, "test VRAM must produce a non-uniform image");
  assert.notDeepEqual(Array.from(plain), Array.from(flipped), "flip must change something");
});

test("the undisplayed tilemap margin is two rows at EACH end, in both orientations", () => {
  // Corollary of the axis being mid-window, and it contradicts what the
  // first implementation's comment claimed. Tile rows 0..3 -- the 128 VRAM
  // slots QA measured invisible -- must stay invisible in BOTH orientations.
  const gfx1 = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/proms.bin", import.meta.url)));
  const tiles = decodeTiles(gfx1);
  const { charColour } = splitProms(proms);

  // Rows 0..1 (offsets 0..63) and rows 30..31 (offsets 960..1023). NOT 128
  // contiguous at the start -- that reading made frame 3 appear to match by
  // hiding the rows the boot clear was actively rewriting.
  const base = new Uint8Array(1024).fill(0x10);
  const marked = Uint8Array.from(base);
  for (let i = 0; i < 64; i++) marked[i] = 0x00;
  for (let i = 960; i < 1024; i++) marked[i] = 0x00;

  for (const flip of [0, 1]) {
    const a = renderTilemapPens(base, tiles, charColour, { flip });
    const b = renderTilemapPens(marked, tiles, charColour, { flip });
    assert.deepEqual(
      Array.from(a), Array.from(b),
      `flip=${flip}: changing VRAM rows 0..1 and 30..31 must not change any pixel`,
    );
  }
});

test("renderRowRGB paints each row in the orientation it is given", () => {
  // The compositing property itself, isolated from the machine so it can be
  // asserted exactly. Rows painted with flip=0 must match an all-unflipped
  // render, and rows painted with flip=1 an all-flipped one -- which is what
  // makes a mid-frame flip come out as a seam rather than as one orientation
  // winning. Mutation-checked: a renderRowRGB that ignores `flip` fails here.
  const gfx1 = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/proms.bin", import.meta.url)));
  const tiles = decodeTiles(gfx1);
  const { charColour } = splitProms(proms);
  const palette = buildPalette(proms);

  const vram = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) vram[i] = (i * 7 + (i >> 5)) & 0xff;

  const W = 256, H = 224, SEAM = 112;
  const plain = Buffer.from(renderFrameRGB(vram, tiles, charColour, palette, { flip: 0 }));
  const flipped = Buffer.from(renderFrameRGB(vram, tiles, charColour, palette, { flip: 1 }));
  assert.notDeepEqual(Array.from(plain), Array.from(flipped), "orientations must differ");

  const composite = new Uint8Array(W * H * 3);
  for (let sy = 0; sy < H; sy++) {
    renderRowRGB(composite, sy, vram, tiles, charColour, palette, {
      flip: sy < SEAM ? 0 : 1,
    });
  }
  const c = Buffer.from(composite);
  assert.deepEqual(
    Array.from(c.subarray(0, SEAM * W * 3)),
    Array.from(plain.subarray(0, SEAM * W * 3)),
    "rows above the seam must match the unflipped render",
  );
  assert.deepEqual(
    Array.from(c.subarray(SEAM * W * 3)),
    Array.from(flipped.subarray(SEAM * W * 3)),
    "rows below the seam must match the flipped render",
  );
});

test("a mid-frame palette-bank change renders as a seam, like the flip does", () => {
  // PRE-EMPTIVE GATE. Every one of the 517 byte-exact frames ran with
  // paletteBank = 0 -- the bank becomes 2 in image 517, the first image the
  // translation does not yet reach. So this path has NEVER executed under a
  // non-zero bank, and it un-confounds itself on the exact next frame.
  //
  // Written before that frame is reachable so a red there is attributable:
  // a palette-bank bug puts the seam at the row where the latch was written;
  // a translation bug does not.
  const gfx1 = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/proms.bin", import.meta.url)));
  const tiles = decodeTiles(gfx1);
  const { charColour } = splitProms(proms);
  const palette = buildPalette(proms);

  const vram = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) vram[i] = (i * 7 + (i >> 5)) & 0xff;

  const W = 256, H = 224, SEAM = 169; // the visible row golden writes 7D87 on
  const bank0 = Buffer.from(renderFrameRGB(vram, tiles, charColour, palette, { paletteBank: 0 }));
  const bank2 = Buffer.from(renderFrameRGB(vram, tiles, charColour, palette, { paletteBank: 2 }));
  assert.notDeepEqual(
    Array.from(bank0), Array.from(bank2),
    "bank 2 must render differently from bank 0, or this test is vacuous",
  );

  const composite = new Uint8Array(W * H * 3);
  for (let sy = 0; sy < H; sy++) {
    renderRowRGB(composite, sy, vram, tiles, charColour, palette, {
      paletteBank: sy < SEAM ? 0 : 2,
    });
  }
  const c = Buffer.from(composite);
  assert.deepEqual(
    Array.from(c.subarray(0, SEAM * W * 3)), Array.from(bank0.subarray(0, SEAM * W * 3)),
    "rows above the seam must match a whole-frame bank-0 render",
  );
  assert.deepEqual(
    Array.from(c.subarray(SEAM * W * 3)), Array.from(bank2.subarray(SEAM * W * 3)),
    "rows below the seam must match a whole-frame bank-2 render",
  );
});

test("the palette bank cannot make a black pixel lit, or the reverse", () => {
  // `pen = color*4 + pixel` and the tri-state black rule is `(pen & 3) == 0`,
  // which depends ONLY on the pixel value -- so changing the bank shifts
  // colours and can never change WHICH pixels are lit. Worth pinning because
  // it is the discriminator: if image 517 comes back with a different lit
  // COUNT, the cause is not the palette bank.
  const gfx1 = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/proms.bin", import.meta.url)));
  const tiles = decodeTiles(gfx1);
  const { charColour } = splitProms(proms);

  const vram = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) vram[i] = (i * 13 + 5) & 0xff;

  const pens0 = renderTilemapPens(vram, tiles, charColour, { paletteBank: 0 });
  for (const bank of [1, 2, 3]) {
    const pens = renderTilemapPens(vram, tiles, charColour, { paletteBank: bank });
    for (let i = 0; i < pens.length; i++) {
      assert.equal(
        (pens[i] & 3) === 0, (pens0[i] & 3) === 0,
        `bank ${bank} changed whether pixel ${i} is tri-state black`,
      );
    }
  }
});

test("decodeSprites maps the four gfx2 quadrants per MAME's spritelayout", () => {
  // §21: expected positions come from MAME's spritelayout (dkong.cpp:1675),
  // NOT from decodeSprites. The layout has two independent region splits --
  // plane at RGN_FRAC(1,2)=4096, sprite-half at RGN_FRAC(1,4)=2048 -- so a
  // single set bit in each quadrant must land at a SPECIFIC (code,x,y,plane).
  // A decode that confused the two splits (the natural error) would place them
  // wrong, so this pins the addressing structurally with no ROM needed.
  const mk = (byteIndex, bitFromMsb) => {
    const g = new Uint8Array(8192);
    g[byteIndex] = 1 << (7 - bitFromMsb);
    return g;
  };

  // sprite 0, row 0: left-half byte is 0, right-half +2048, high plane +4096.
  // low plane, left half, column 3 -> pen bit 0 set => pen 1
  let s = decodeSprites(mk(0, 3));
  assert.equal(s[0 * 256 + 0 * 16 + 3], 1, "low/left col3 -> pen 1");
  // low plane, RIGHT half (byte 2048), column 8+5=13 -> pen 1
  s = decodeSprites(mk(2048, 5));
  assert.equal(s[0 * 256 + 0 * 16 + (8 + 5)], 1, "low/right col13 -> pen 1");
  // HIGH plane (byte 4096), left half, column 2 -> pen bit 1 set => pen 2
  s = decodeSprites(mk(4096, 2));
  assert.equal(s[0 * 256 + 0 * 16 + 2], 2, "high/left col2 -> pen 2");
  // high plane, right half (byte 4096+2048), column 8 -> pen 2
  s = decodeSprites(mk(4096 + 2048, 0));
  assert.equal(s[0 * 256 + 0 * 16 + 8], 2, "high/right col8 -> pen 2");

  // y stride: sprite 0 row 5 left half is byte 5.
  s = decodeSprites(mk(5, 0));
  assert.equal(s[0 * 256 + 5 * 16 + 0], 1, "row 5 lives at byte 5");
  // sprite stride: sprite 1 row 0 left half is byte 16.
  s = decodeSprites(mk(16, 7));
  assert.equal(s[1 * 256 + 0 * 16 + 7], 1, "sprite 1 starts at byte 16");

  // plane ORDER: a bit in the HIGH plane must give pen 2, never pen 1 --
  // reversing the plane list (the pen-1-vs-2 swap) would fail this.
  s = decodeSprites(mk(4096, 0));
  assert.equal(s[0], 2, "high plane is the pen bit worth 2, not 1");

  // real ROM: dimensions and value range.
  const gfx2 = new Uint8Array(readFileSync(new URL("../../../games/dkong/rom/gfx2.bin", import.meta.url)));
  const dec = decodeSprites(gfx2);
  assert.equal(dec.length, 128 * 256, "128 sprites x 256 px");
  assert.ok(dec.every((v) => v >= 0 && v <= 3), "every pixel is a 2-bit pen");
  assert.ok(dec.some((v) => v !== 0), "not an all-zero decode");
});

test("drawSprites places a sprite by the dkong formula, and the placement has teeth", () => {
  // A STANDING version of the mutation check QA and I ran through rasterconf:
  // color=0, code+1, x+1 and dropped-transpen each dropped the gate 727->520.
  // Here the same four are caught by explicit pixel assertions, so the teeth
  // are checked on every run, not remembered (QA's request; §48 -- a green gate
  // is worth nothing until a wrong renderer proves it goes red).
  //
  // Expected pixel positions are computed from MAME's draw_sprites formula
  // (dkong_v.cpp, no-flip: add_y=0xF9, add_x=0xF7; output row sy -> raster
  // sy+16), NOT read back from drawSprites (§21). A gray palette makes the
  // output byte equal the pen, and a 99 background sentinel makes transparency
  // observable.
  const sprites = new Uint8Array(SPRITE_COUNT * 256);
  sprites[5 * 256 + 0 * 16 + 0] = 1; // sprite 5, row 0 col 0
  sprites[5 * 256 + 0 * 16 + 1] = 2; // row 0 col 1
  sprites[5 * 256 + 1 * 16 + 0] = 3; // row 1 col 0
  const palette = new Uint8Array(256 * 3);
  for (let p = 0; p < 256; p++) palette[p * 3] = palette[p * 3 + 1] = palette[p * 3 + 2] = p;

  const W = 256, H = 224;
  const rgb = new Uint8Array(W * H * 3).fill(99);
  const ram = new Uint8Array(1024);
  // y=0xE7 draws the sprite at output rows 0..15; xb=0x10 -> screen x 8.
  ram[0] = 0xe7; ram[1] = 0x05; ram[2] = 0x03; ram[3] = 0x10; // code 5, color 3
  drawSprites(rgb, ram, sprites, palette, { flip: 0, paletteBank: 0, spriteBank: 0 });
  const at = (x, y) => rgb[(y * W + x) * 3];

  // pen = color*4 + pixel = 12 + pixel. These three catch color=0 (pen would
  // be 0..3, not 13..15), code+1 (sprite 6 is blank -> nothing drawn), and x+1
  // (the sprite would land one column right, so (8,0) would be background).
  assert.equal(at(8, 0), 13, "sprite 5 row0 col0: pen 12+1");
  assert.equal(at(9, 0), 14, "row0 col1: pen 12+2");
  assert.equal(at(8, 1), 15, "row1 col0: pen 12+3");

  // TRANSPARENCY: col 2 of the sprite is pixel 0 -> the background sentinel
  // must survive. drop-transpen would paint pen 12 (palette[12]=12) here.
  assert.equal(at(10, 0), 99, "pixel 0 is transparent, background survives");
  // and nothing spills left of the sprite.
  assert.equal(at(7, 0), 99, "no pixel left of the sprite's x");
});
