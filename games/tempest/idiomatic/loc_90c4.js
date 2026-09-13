// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { bcdSubByte } from "../../../core/bcd.js";
import {
  loc_00, loc_1, loc_4, loc_5, loc_9, loc_29, loc_3d, loc_3f, loc_46, loc_48,
  loc_4e, loc_51, loc_5b, loc_7b, loc_7c, loc_9f,
  loc_102, loc_111, loc_126, loc_127, loc_16a, loc_200, loc_605, loc_71d, loc_60ca, loc_91fe,
} from "./names.js";
import { loc_92b2 } from "./loc_92b2.js";
import { loc_92ad } from "./loc_92ad.js";
import { loc_92c5 } from "./loc_92c5.js";
import { loc_9234 } from "./loc_9234.js";
import { loc_c196 } from "./loc_c196.js";
import { loc_ccfe } from "./loc_ccfe.js";
import { loc_b0ab } from "./loc_b0ab.js";
import { loc_a831 } from "./loc_a831.js";

// Pick a start slot by scanning the threshold table downward for the highest slot at or below the
// seed, clamp it up against a floor derived from the wave state, publish the start index, then fall
// through into the wave-reseed body below. LIVE-OUT: memory only.
export function loc_90c4(m) {
  const { mem8 } = m;

  const seed = mem8[loc_126];
  let idx = 28;
  do { idx = u8(idx - 1); } while (seed < mem8[u16(loc_91fe + idx)]);

  let floor = 4;
  if ((mem8[loc_16a] & 0x04) !== 0) {
    const wave = mem8[loc_71d];
    if (wave >= 48) floor++;
    if (wave >= 80) floor++;
    if (wave >= 112) floor++;
  }
  if ((mem8[loc_9] & 0x43) === 64) floor = 27;

  mem8[loc_29] = floor;
  if (idx < floor) idx = floor;
  mem8[loc_127] = idx;

  if ((mem8[loc_5] & 0x80) !== 0) mem8[loc_126] = 0;
  return loc_9108(m);
}

// Mid-entry: reseed the wave working set (optionally swapping the parallel slot tables first), and on
// the sign flag prime the extra intro cells, then fall through into the per-frame tick below.
export function loc_9108(m) {
  const { mem8 } = m;

  const seat = mem8[loc_3f];
  mem8[loc_3d] = seat;
  if (seat !== 0) loc_92b2(m);

  mem8[loc_7c] = 4;
  mem8[loc_5b] = 0xff;
  mem8[loc_200] = 0;
  mem8[loc_51] = 0;
  mem8[loc_7b] = 0;
  mem8[loc_605] = 0;

  let count = 0;
  if ((mem8[loc_5] & 0x80) !== 0) {
    mem8[loc_605] = 20;
    mem8[loc_111] = 0xff;
    mem8[loc_00] = 22;
    mem8[loc_1] = 8;
    mem8[loc_9f] = 0;
    loc_c196(m);
    count = 0x10;
  }
  mem8[loc_4] = count;

  loc_92ad(m);
  return loc_9149(m);
}

// Mid-entry: tick the frame counter; on underflow decimal-count-down the phase and reload. Then, when
// the phase gate passes, retire one entry (indexing the threshold table, seeding the emit cells) and
// run the spawn/emit chain. Finally trim the flag cell. LIVE-OUT: memory only.
export function loc_9149(m) {
  const { mem8 } = m;

  const ticked = u8(mem8[loc_605] - 1);
  mem8[loc_605] = ticked;
  if ((ticked & 0x80) !== 0) {
    const prev = mem8[loc_4];
    const phase = bcdSubByte(prev, 1).value;
    mem8[loc_4] = phase;
    if ((u8(prev - 1) & 0x80) !== 0) mem8[loc_4e] = 0x10;
    if (phase === 3) loc_ccfe(m);
    mem8[loc_605] = 20;
  }

  loc_b0ab(m);

  const mask = mem8[loc_4] >= 8 ? 0x18 : 0x78;
  if ((mask & mem8[loc_4e]) !== 0) {
    mem8[loc_4e] = 0;
    const value = mem8[loc_200];
    const slot = mem8[loc_3d];
    mem8[u16(loc_102 + slot)] = value;
    let entry = mem8[u16(loc_91fe + value)];
    if ((mem8[loc_5] & 0x80) === 0) {
      mem8[loc_48] = 1;
      entry = mem8[loc_60ca] & 0x07;
    }
    mem8[(loc_46 + slot) & 0xff] = entry;
    mem8[loc_9f] = entry;
    loc_c196(m);
    loc_92c5(m);
    loc_9234(m);
    loc_a831(m);
    mem8[loc_00] = 2;
    loc_92ad(m);
  }

  mem8[loc_4e] = mem8[loc_4e] & 0x07;
}
