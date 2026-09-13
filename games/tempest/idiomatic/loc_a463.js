// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_2e, loc_37, loc_38, loc_a7,
  loc_135, loc_151, loc_202, loc_27f, loc_2ad, loc_2b5, loc_2c0, loc_2c8, loc_2d3, loc_2db, loc_2f2,
} from "./names.js";
import { loc_a36f } from "./loc_a36f.js";
import { loc_a309 } from "./loc_a309.js";
import { loc_a38e } from "./loc_a38e.js";

// Scan slots y = 10..0 of loc_2db against threshold A (kept in loc_2e). For each nonzero entry form
// delta = |entry - threshold|. Near slots (y < 4) with delta below loc_a7 and a matching loc_2b5/loc_2ad
// pair retire via the pair-retire helper. Far slots (y >= 4) fold loc_27f,y to a 3-bit band; when delta is under the
// band threshold loc_151,band a chain of loc_2c8/loc_2b5/loc_2c0/loc_2ad/loc_202 tests dispatches
// the band-4 handler (band 4) or the other-band handler (other bands). After the scan, if slot X of loc_2f2 reads 0xff the slot
// is cleared (loc_2d3,x and loc_2f2,x) and the live count loc_135 drops.
export function loc_a463(m, a = m.regs.a, x = m.regs.x) {
  const { mem8 } = m;

  const threshold = a;
  mem8[loc_2e] = threshold;

  for (let y = 10; y >= 0; y--) {
    const entry = mem8[u16(loc_2db + y)];
    if (entry === 0) continue;
    const delta = entry >= threshold ? entry - threshold : threshold - entry;

    if (y < 4) {
      if (delta >= mem8[loc_a7]) continue;
      if (mem8[u16(loc_2b5 + y)] !== mem8[u16(loc_2ad + x)]) continue;
      loc_a36f(m, x, y);
      continue;
    }

    // Far slot: fold to a 3-bit band and test delta against the band threshold.
    mem8[loc_38] = y;
    const band = mem8[u16(loc_27f + y)] & 0x07;
    if (delta >= mem8[u16(loc_151 + band)]) continue;

    if (band === 4) {
      if (mem8[u16(loc_2db + y)] === mem8[loc_202]) continue;
      if (mem8[u16(loc_2ad + x)] !== mem8[u16(loc_2b5 + y)]) continue;
      if ((mem8[u16(loc_2c8 + y)] & 0x80) === 0) continue;
      loc_a309(m, x, y);
      continue;
    }

    let doCall;
    if ((mem8[u16(loc_2c8 + y)] & 0x80) !== 0) {
      doCall = mem8[u16(loc_2b5 + y)] === mem8[u16(loc_2c0 + x)]
        ? true
        : mem8[u16(loc_2b5 + y)] === mem8[u16(loc_2ad + x)];
    } else if (mem8[u16(loc_2db + y)] === mem8[loc_202]) {
      doCall = false;
    } else {
      doCall = mem8[u16(loc_2b5 + y)] === mem8[u16(loc_2ad + x)];
    }
    if (doCall) {
      mem8[loc_37] = x;
      loc_a38e(m, x, y);
    }
  }

  if (mem8[u16(loc_2f2 + x)] === 0xff) {
    mem8[u16(loc_2d3 + x)] = 0;
    mem8[loc_135] = mem8[loc_135] - 1;
    mem8[u16(loc_2f2 + x)] = 0;
  }
}
