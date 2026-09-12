// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_5, loc_b6, loc_b7, loc_114, loc_11b, loc_cec2, loc_cec3, loc_2000, loc_2001 } from "./names.js";
import { loc_b2be } from "./loc_b2be.js";
import { loc_b2fe } from "./loc_b2fe.js";
import { loc_b586 } from "./loc_b586.js";
import { loc_b75b } from "./loc_b75b.js";
import { loc_b5ad } from "./loc_b5ad.js";
import { loc_b79a } from "./loc_b79a.js";
import { loc_b498 } from "./loc_b498.js";
import { loc_a8b4 } from "./loc_a8b4.js";
import { loc_b367 } from "./loc_b367.js";
import { loc_c5c2 } from "./loc_c5c2.js";
import { loc_c54d } from "./loc_c54d.js";

// Draw one frame: each subsystem runs bracketed by a setup/teardown pair keyed to its
// layer id. Between the player layer's brackets, when the sign flag is clear, sum a
// 40-byte source block (carry-chained) into a status cell. Clear the change counter, then
// latch two constants into the first two display words.
export function loc_b230(m) {
  const { mem8 } = m;
  loc_b2be(m, 0x07);
  loc_b586(m);
  loc_b2fe(m, 0x07);

  loc_b2be(m, 0x04);
  loc_b75b(m);
  loc_b2fe(m, 0x04);

  loc_b2be(m, 0x03);
  loc_b5ad(m);
  loc_b2fe(m, 0x03);

  loc_b2be(m, 0x06);
  loc_b79a(m);
  loc_b2fe(m, 0x06);

  loc_b2be(m, 0x05);
  loc_b498(m);
  loc_b2fe(m, 0x05);

  loc_b2be(m, 0x00);
  loc_a8b4(m);
  if (!(mem8[loc_5] & 0x80)) {
    const ptr = mem8[loc_b6] | (mem8[loc_b7] << 8);
    let a = 0xf2;
    let carry = 0;
    for (let y = 0x27; y >= 0; y--) {
      const s = a + mem8[u16(ptr + y)] + carry;
      a = s & 0xff;
      carry = s > 0xff ? 1 : 0;
    }
    mem8[loc_11b] = a;
  }
  loc_b2fe(m, 0x00);
  loc_b367(m);

  loc_b2be(m, 0x01);
  loc_c5c2(m);
  loc_b2fe(m, 0x01);

  loc_b2be(m, 0x08);
  loc_c54d(m);
  loc_b2fe(m, 0x08);

  mem8[loc_114] = 0x00;
  mem8[loc_2000] = mem8[loc_cec2];
  mem8[loc_2001] = mem8[loc_cec3];
}
