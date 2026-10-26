// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  WORK_PTR_LO, WORK_PTR_HI, POINTER_PARITY,
  DRAW_BASE_PTR_LO, DRAW_BASE_PTR_HI, DRAW_PTR_EVEN_LO, DRAW_PTR_EVEN_HI, DRAW_PTR_ODD_LO, DRAW_PTR_ODD_HI,
} from "./names.js";
import { emitRecordBodyC0 } from "./emitRecordBodyC0.js";

/**
 * closeLayerPointer — close one draw layer: emit its header record, then patch the layer's base pointer to
 * whichever of two alternating buffers the toggled parity selects. ROM 0xb2fe.
 *
 * Role in the machine: Tempest renders the tube as vector display lists, one per layer/slot. Each layer is
 * double-buffered — it keeps an "even" and an "odd" draw buffer and alternates between them frame to frame
 * so the display can read one while the other is rebuilt. Closing a layer finalizes the record just built
 * (emitRecordBodyC0) and then repoints the layer's list target at the freshly toggled buffer, so the next
 * pass draws into the correct half.
 *
 * Behavior: takes the slot in the accumulator (a). It emits the header body, then forms idx = 2*slot (a<<1,
 * masked to a byte) to index the stride-2 pointer tables. It seats the working pointer loc_3b/loc_3c
 * (the ($3b) indirect) from the base-pointer table 0xce8c/0xce8d at idx. It toggles this slot's parity flag
 * at 0x415+slot (XOR 1) and stores it back. On parity set it selects the odd buffer word 0xceb0/0xceb1,
 * otherwise the even buffer word 0xce9e/0xce9f, both at idx. Finally it reads the seated ($3b) target as a
 * word (dst) and writes the chosen lo/hi pair into dst and dst+1.
 *
 * Live-out: loc_3b/loc_3c hold the base-pointer word for this slot; the parity flag 0x415+slot is toggled;
 * and the two bytes at the ($3b) target are overwritten with the selected buffer pointer.
 *
 * Returns the exit [X, Y] the ROM leaves: X = the selected buffer word's high byte (it is stored through A
 * from X) and Y = 1 (the two stores index Y = 0, then 1). Grounding: [seen].
 */
export function closeLayerPointer(m, a = m.regs.a) {
  const { mem8, mem16 } = m;
  // Finalize the header record for this layer.
  emitRecordBodyC0(m);
  const slot = a;
  // Stride-2 index into the pointer tables (2*slot, byte-masked).
  const idx = (a << 1) & 0xff;
  // Seat the ($3b) working pointer from the base-pointer table 0xce8c/0xce8d at idx.
  mem8[WORK_PTR_LO] = mem8[u16(DRAW_BASE_PTR_LO + idx)];
  mem8[WORK_PTR_HI] = mem8[u16(DRAW_BASE_PTR_HI + idx)];
  // Toggle this slot's double-buffer parity flag (0x415+slot) and store it back.
  const parity = mem8[u16(POINTER_PARITY + slot)] ^ 0x01;
  mem8[u16(POINTER_PARITY + slot)] = parity;
  let lo, hi;
  if (parity !== 0) {
    // Odd buffer selected: word 0xceb0/0xceb1 at idx.
    lo = mem8[u16(DRAW_PTR_ODD_LO + idx)];
    hi = mem8[u16(DRAW_PTR_ODD_HI + idx)];
  } else {
    // Even buffer selected: word 0xce9e/0xce9f at idx.
    lo = mem8[u16(DRAW_PTR_EVEN_LO + idx)];
    hi = mem8[u16(DRAW_PTR_EVEN_HI + idx)];
  }
  // Follow the seated ($3b) pointer and write the chosen buffer word into its target.
  const dst = mem16[WORK_PTR_LO];
  mem8[u16(dst)] = lo;
  mem8[u16(dst + 1)] = hi;
  return [hi, 0x01];
}
