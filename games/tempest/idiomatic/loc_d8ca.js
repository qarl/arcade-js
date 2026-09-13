// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import { loc_79, loc_5000, loc_60c0, loc_60c1, loc_60e0 } from "./names.js";
import { loc_da0a } from "./loc_da0a.js";

// Power-on tone-and-delay. Stores the passed byte at loc_79, then drives POKEY chip-0 through a
// descending run of tone bursts: each pass writes the POKEY control/frequency cells and the output
// latch, then drains a fixed count while kicking the watchdog. The last pass switches to the low tone.
// Then it tail-delegates to the checksum/self-test.
export function loc_d8ca(m, a = m.regs.a) {
  return loc_d8cd(m, a, 0);
}

// Second entry: the byte stored at loc_79 is passed as `count`, and its low nibble nudges the pass
// total that `a` seeds ((a >> 2) << 1, +1 when the nibble is zero).
export function loc_d8cd(m, count = m.regs.y, a = m.regs.a) {
  const { mem8 } = m;
  mem8[loc_79] = count;

  let passes = (a >> 2) << 1;
  if ((count & 0x0f) === 0) passes = passes + 1;

  let remaining = passes;
  do {
    mem8[loc_60c1] = 0xa2;
    const lastPass = remaining === 0;
    const tone = lastPass ? 0x60 : 0xc0;
    const firstBurst = lastPass ? 9 : 1;
    mem8[loc_60c0] = tone;
    mem8[loc_60e0] = 3;

    drain(mem8, firstBurst, tone);
    mem8[loc_60c1] = 0;
    mem8[loc_60e0] = 0;
    drain(mem8, 9, 0);

    remaining = u8(remaining - 1);
  } while ((remaining & 0x80) === 0);

  return loc_da0a(m);
}

// One burst: a 256-tick inner drain repeated `passes` times, kicking the watchdog each tick
// (`value` rides the write but the device ignores it). The per-tick 3kHz clock sync that paces this on
// the machine has no stored effect and is not modelled.
function drain(mem8, passes, value) {
  let outer = passes;
  do {
    let inner = 0;
    do {
      mem8[loc_5000] = value;
      inner = u8(inner - 1);
    } while (inner !== 0);
    outer = u8(outer - 1);
  } while (outer !== 0);
}
