// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_0, loc_5c, loc_5f, loc_5b, loc_9f, loc_104, loc_105, loc_106,
  loc_107, loc_114, loc_115, loc_200, loc_201, loc_202, loc_3ac,
} from "./names.js";
import { loc_ccee } from "./loc_ccee.js";
import { loc_ccf2 } from "./loc_ccf2.js";
import { loc_a7bd } from "./loc_a7bd.js";
import { loc_cd06 } from "./loc_cd06.js";
import { loc_a347 } from "./loc_a343.js";
import { loc_928f } from "./loc_928f.js";

// Per-frame step of the moving spike. Runs only while the primary flag is low and the arm
// flag is negative. Seeds a start sound at the trigger height; advances a 16-bit height,
// on overflow past the ceiling parks it and cues an end sound; past the reset height it
// rebuilds a table. Steps a second accumulator (paging its high byte and bumping a change
// counter), then rederives the per-frame delta from a scaled, clamped source. Finally,
// when below the ceiling, scans the slot row for a matching entry the spike has passed and
// registers the collision.
export function loc_97f8(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;
  if (mem8[loc_201] & 0x80) return;
  if (!(mem8[loc_106] & 0x80)) return;

  if (mem8[loc_202] === 0x10) loc_ccee(m, x, y);

  const lo = mem8[loc_107] + mem8[loc_104];
  mem8[loc_107] = lo;
  const hi = mem8[loc_202] + mem8[loc_105] + (lo > 0xff ? 1 : 0);
  mem8[loc_202] = hi;
  if (hi > 0xff || mem8[loc_202] >= 0xf0) {
    mem8[loc_0] = 0x0e;
    loc_ccf2(m, x, y);
    mem8[loc_202] = 0xff;
  }

  if (mem8[loc_202] >= 0x50 && mem8[loc_115] === 0) loc_a7bd(m);

  const acc = mem8[loc_5c] + mem8[loc_104];
  mem8[loc_5c] = acc;
  const accHi = mem8[loc_5f] + mem8[loc_105] + (acc > 0xff ? 1 : 0);
  const newHi = accHi & 0xff;
  if (accHi > 0xff) mem8[loc_5b] = mem8[loc_5b] + 1;
  if (newHi !== mem8[loc_5f]) mem8[loc_114] = mem8[loc_114] + 1;
  mem8[loc_5f] = newHi;

  let delta = (mem8[loc_9f] << 2) & 0xff;
  if (delta >= 0x30) delta = 0x30;
  delta = (delta + 0x20) & 0xff;
  const sum = delta + mem8[loc_104];
  mem8[loc_104] = sum;
  mem8[loc_105] = mem8[loc_105] + (sum > 0xff ? 1 : 0);

  if (mem8[loc_202] >= 0xf0) return;
  for (let xi = 0x0f; xi >= 0; xi--) {
    const val = mem8[u16(loc_3ac + xi)];
    if (val === 0) continue;
    if (xi !== mem8[loc_200]) continue;
    if (val >= mem8[loc_202]) continue;
    loc_cd06(m, xi, y); // the sound cue reads its two params from xi and y
    loc_a347(m, xi, y);
    mem8[loc_115] = 0x00;
    loc_928f(m);
  }
}
