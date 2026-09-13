// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_2e, loc_2f, loc_35, loc_37, loc_38, loc_4d, loc_4e, loc_50, loc_52,
  loc_73, loc_78, loc_7d, loc_4000, loc_31e4, loc_31e5,
  loc_608d, loc_6095, loc_6096, loc_60c0, loc_60c1, loc_60c2, loc_60c3,
  loc_60d8, loc_60db, loc_60e0, loc_dce1, loc_dfe4, loc_dfe8,
} from "./names.js";
import { loc_dce6 } from "./loc_dce6.js";
import { loc_dd0d } from "./loc_dd0d.js";
import { loc_dd2b } from "./loc_dd2b.js";
import { loc_dd27 } from "./loc_dd27.js";
import { loc_df39 } from "./loc_df39.js";
import { loc_df1f } from "./loc_df1f.js";
import { loc_d8a9 } from "./loc_d8a9.js";
import { loc_df75 } from "./loc_df75.js";
import { loc_df53, loc_df57 } from "./loc_df53.js";
import { loc_df73 } from "./loc_df73.js";

// Per-frame vector-list emit. When the 16-bit counter loc_2e/loc_2f is nonzero it seeds the POKEY
// operand cells, runs the math-coprocessor scan, and from its result (A/X/Y) decides whether to set
// loc_78 = 0xff (and what byte lands in the POKEY status cell). Then it advances the 15-bit counter
// (inc loc_2e; on wrap inc loc_2f, resetting loc_2f to 0 once bit7 sets), builds the POKEY work word
// from loc_4d (= a status byte masked to bits 3..6) and loc_4e, fires the readout draws, conditionally
// emits the loc_52-bit marker with a POKEY mode byte plus a latch write, walks loc_7d,x for x=11..0
// (emit per nonzero entry) and loc_78,x for x=4..0 (each nonzero slot indexed into a coordinate word
// table), then tail-delegates to the colour-pair emitter with the loc_50-indexed pair and Y = 0xc0.
export function loc_dbf7(m) {
  const { mem8 } = m;

  // Byte written to the POKEY status cell at the join below: 0 when the counter low byte is zero,
  // else 0xff when the scan says "set" or the scan's exit X when it says "clear".
  let a60db = 0x00;

  const a0 = mem8[loc_2e];
  if (a0 !== 0) {
    mem8[loc_6095] = a0;
    mem8[loc_608d] = a0;
    const a2f = mem8[loc_2f];
    mem8[loc_6096] = a2f;
    // math-coprocessor scan(m, a=loc_2f, x=0x00) -> [A, X, Y]
    const [ra, rx, ry] = loc_dce6(m, a2f, 0x00);
    let setFF;
    if (ra !== 0x01) setFF = true;          // A != 1
    else if (ry !== 0) setFF = true;        // A == 1, Y != 0
    else if ((rx & 0x80) === 0) setFF = false; // A == 1, Y == 0, X positive
    else setFF = true;                      // A == 1, Y == 0, X negative
    if (setFF) { a60db = 0xff; mem8[loc_78] = 0xff; }
    else { a60db = rx & 0xff; }
  }

  // clear loc_73, advance the 15-bit counter loc_2e/loc_2f.
  mem8[loc_73] = 0x00;
  mem8[loc_2e] = mem8[loc_2e] + 1;
  if (mem8[loc_2e] === 0) {
    mem8[loc_2f] = mem8[loc_2f] + 1;
    if (mem8[loc_2f] & 0x80) mem8[loc_2f] = 0x00;
  }

  // POKEY status write, then build the work word.
  mem8[loc_60db] = a60db;
  const a4d = mem8[loc_60d8] & 0x78;
  mem8[loc_4d] = a4d;
  let x60c1 = 0x00;
  if (a4d !== 0) { mem8[loc_60c0] = a4d; x60c1 = 0xa4; }
  mem8[loc_60c1] = x60c1;

  const a4e = mem8[loc_4e];
  let x60c3 = 0x00;
  if (a4e !== 0) { mem8[loc_60c2] = a4e << 1; x60c3 = 0xa4; }
  mem8[loc_60c3] = x60c3;

  // Draw the spinner/knob readout and the two coordinate marks.
  loc_dd0d(m);
  loc_dd2b(m, mem8[loc_4d], 0xd0, 0xf0); // (m, y=loc_4d, a=0xd0, x=0xf0)
  loc_dd27(m, mem8[loc_4e]);             // (m, y=loc_4e)

  // Optional loc_52-bit marker (POKEY mode byte + a latch write).
  if ((mem8[loc_52] & 0x10) !== 0) {
    loc_df39(m, 0x34, 0x82);
    let yLatch = 0x10;
    const g = mem8[loc_4d] & 0x60;
    if (g !== 0) {
      let aMode = g ^ 0x20;
      if (aMode !== 0) { aMode = 0x04; yLatch = 0x08; }
      mem8[loc_60e0] = aMode;
      mem8[loc_4000] = yLatch;
    }
  }

  loc_df39(m, 0x34, 0x92);

  // Table walk loc_7d,x for x = 11..0: emit each nonzero entry.
  for (let x = 0x0b; x >= 0; x--) {
    const a = mem8[(loc_7d + x) & 0xff];
    if (a !== 0) {
      mem8[loc_35] = a;
      mem8[loc_38] = x;
      loc_df1f(m, x);                        // (m, a=x)
      loc_d8a9(m, mem8[loc_35], 0xf4, 0xf4); // (m, a=loc_35, y=0xf4, x=0xf4)
      loc_df75(m, 0x0c, 0x0c);               // (m, a=0x0c, x=0x0c)
    }
  }

  loc_df53(m);
  loc_df75(m, 0x00, 0x16); // (m, a=0x00, x=0x16)

  // Table walk loc_78,x for x = loc_37 = 4..0: each nonzero slot indexed into the coordinate word table.
  mem8[loc_37] = 0x04;
  do {
    const i = mem8[loc_37];
    let y = 0x00;
    if (mem8[(loc_78 + i) & 0xff] !== 0) y = mem8[u16(loc_dce1 + i)];
    const a = mem8[u16(loc_31e4 + y)];
    const x = mem8[u16(loc_31e5 + y)];
    loc_df57(m, a, x); // (m, a, x)
    mem8[loc_37] = mem8[loc_37] - 1;
  } while ((mem8[loc_37] & 0x80) === 0);

  // final mark, then tail-delegate to the colour-pair emitter with the loc_50-indexed pair.
  loc_df75(m, 0x30, 0xac); // (m, a=0x30, x=0xac)
  const y50 = mem8[loc_50];
  const aFin = mem8[u16(loc_dfe8 + y50)];
  const xFin = mem8[u16(loc_dfe4 + y50)];
  return loc_df73(m, 0xc0, aFin, xFin); // (m, y=0xc0, a=colour_hi[loc_50], x=colour_lo[loc_50])
}
