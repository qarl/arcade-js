// SPDX-License-Identifier: GPL-3.0-only
import { loc_00, loc_4e, loc_d00 } from "./names.js";
import { loc_a7d2 } from "./loc_a7d2.js";
import { loc_c90c } from "./loc_c90c.js";
import { loc_c940 } from "./loc_c940.js";
import { loc_970b } from "./loc_970b.js";
import { loc_c9af } from "./loc_c9af.js";
import { loc_c9f1 } from "./loc_c9f1.js";
import { loc_c800 } from "./loc_c800.js";
import { loc_c98c } from "./loc_c98c.js";
import { loc_ac3f } from "./loc_ac3f.js";
import { loc_ad6e } from "./loc_ad6e.js";
import { loc_ca18 } from "./loc_ca18.js";
import { loc_9149, loc_9108 } from "./loc_90c4.js";
import { loc_904b } from "./loc_904b.js";
import { loc_b0e7 } from "./loc_b0e7.js";
import { loc_c97b } from "./loc_c97b.js";
import { loc_9729 } from "./loc_9729.js";
import { loc_d7e1 } from "./loc_d7e1.js";
import { loc_a618 } from "./loc_a618.js";

// DSW-gated per-frame handler dispatch: skip entirely when (loc_d00 & 0x83) == 0x82; otherwise run a
// pre-pass, set bit7 of loc_4e, and select one of the handlers by the byte offset in loc_00. Index 6 is
// an unused table slot (its word is zero); the caller never selects it.
const TABLE = [
  loc_c90c, loc_c940, loc_970b, loc_c9af, loc_c9f1, loc_c800, null, loc_c98c, loc_ac3f, loc_ad6e,
  loc_ca18, loc_9149, loc_904b, loc_b0e7, loc_9108, loc_c97b, loc_9729, loc_d7e1, loc_a618,
];

export function loc_c7bd(m) {
  const { mem8 } = m;
  if ((mem8[loc_d00] & 0x83) === 0x82) return;
  loc_a7d2(m);
  const i = mem8[loc_00];
  mem8[loc_4e] = mem8[loc_4e] | 0x80;
  return TABLE[i >> 1](m);
}
