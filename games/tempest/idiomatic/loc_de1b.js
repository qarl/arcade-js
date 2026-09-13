// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_bd, loc_be,
  loc_1c6, loc_1c7, loc_1c8, loc_1c9, loc_1ca, loc_1cb, loc_1cc, loc_1cd, loc_1ce, loc_1cf,
  loc_6000, loc_6040, loc_6050,
  loc_dddd, loc_ddde, loc_dde3, loc_dde4,
} from "./names.js";

// EAROM state-machine step. When the mode byte and its target are both live it
// rebuilds a single-bit mask, seeds the row pointer from the packed tables, then
// walks the port block emitting one entry per pass and advancing the cursor,
// re-entering from the top until the pass count comes back nonzero.
// Live-out: the exit X/Y, returned as [x, y] (a caller reads them); X/Y carry
// across the outer passes rather than resetting each one.
export function loc_de1b(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;
  const ind = (yy) => u16(((mem8[loc_be] << 8) | mem8[loc_bd]) + yy);

  outer: for (;;) {
    let a = 0, c = false;

    if (mem8[loc_1ca] === 0 && mem8[loc_1c7] !== 0) {
      // Fresh row: clear the counters and rebuild the walking mask in $1ce.
      mem8[loc_1cb] = 0;
      mem8[loc_1cf] = 0;
      mem8[loc_1ce] = 0;
      x = 0x08;
      a = mem8[loc_1c7];
      c = true; // seed the rotate
      for (;;) {
        mem8[loc_1ce] = ((c ? 0x80 : 0) | (mem8[loc_1ce] >> 1));
        c = (a & 0x80) !== 0;
        a = (a << 1) & 0xff;
        x = u8(x - 1);
        if (!c) continue;
        break;
      }
      y = (mem8[loc_1ce] & mem8[loc_1c8]) !== 0 ? 0x80 : 0x20;
      mem8[loc_1ca] = y;
      mem8[loc_1c7] = mem8[loc_1ce] ^ mem8[loc_1c7];
      x = (x << 1) & 0xff;
      mem8[loc_1cc] = mem8[u16(loc_dddd + x)];
      mem8[loc_1cd] = mem8[u16(loc_ddde + x)];
      mem8[loc_bd] = mem8[u16(loc_dde3 + x)];
      mem8[loc_be] = mem8[u16(loc_dde4 + x)];
    }

    // Common block: clear Y (LDY #0), reset the control port, bail when the mode byte is clear.
    y = 0x00;
    mem8[loc_6040] = y;
    a = mem8[loc_1ca];
    if (a === 0) return [x, y];

    y = mem8[loc_1cb];
    x = mem8[loc_1cc];
    c = (a & 0x80) !== 0;
    a = (a << 1) & 0xff;

    deff: {
      def2: {
        def0: {
          deee: {
            dee6: {
              if (c) {
                mem8[u16(loc_6000 + x)] = a;
                mem8[loc_1ca] = 0x40;
                y = 0x0e;
                break deff;
              }
              if ((a & 0x80) !== 0) {
                mem8[loc_1ca] = 0x80;
                if (mem8[loc_1c6] !== 0) mem8[ind(y)] = 0;
                a = mem8[ind(y)];
                if (x >= mem8[loc_1cd]) {
                  mem8[loc_1ca] = 0;
                  a = mem8[loc_1cf];
                }
                mem8[u16(loc_6000 + x)] = a;
                y = 0x0c;
                break def2;
              }
              // EAROM read handshake for this entry.
              mem8[loc_6040] = 0x08;
              mem8[u16(loc_6000 + x)] = 0x08;
              mem8[loc_6040] = 0x09;
              mem8[loc_6040] = 0x08;
              c = x >= mem8[loc_1cd];
              a = mem8[loc_6050];
              if (!c) break deee;
              a = a ^ mem8[loc_1cf];
              if (a === 0) break dee6;
              y = mem8[loc_1cb];
              for (;;) {
                mem8[ind(y)] = 0;
                y = u8(y - 1);
                if ((y & 0x80) === 0) continue;
                break;
              }
              mem8[loc_1c9] = mem8[loc_1ce] | mem8[loc_1c9];
              break dee6;
            }
            // dee6: retire the mode byte.
            a = 0;
            mem8[loc_1ca] = 0;
            break def0;
          }
          // deee: store the read-back byte through the row pointer.
          mem8[ind(y)] = a;
        }
        // def0
        y = 0;
      }
      // def2: fold the entry into the running total and bump both cursors.
      a = u8(a + mem8[loc_1cf]);
      mem8[loc_1cf] = a;
      mem8[loc_1cb] = u8(mem8[loc_1cb] + 1);
      mem8[loc_1cc] = u8(mem8[loc_1cc] + 1);
    }
    // deff
    mem8[loc_6040] = y;
    if (y !== 0) return [x, y];
    continue outer;
  }
}
