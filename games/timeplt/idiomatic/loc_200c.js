// SPDX-License-Identifier: GPL-3.0-only
/** loc_200c — walk an address forward twice, by a wide step and then a narrow one, and hand back a
 * byte unrelated to either: the count the caller was already carrying, moved into the place a
 * result is read from. No memory is read or written, so the walked address is only an address.
 * LIVE-OUT: the walked address, and the byte handed back. */

import { u16 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";

export function loc_200c(m) {
  const { regs } = m;
  regs.hl = u16(regs.hl + regs.de);
  offsetAddress(m);
  regs.a = regs.b;
  return regs.a;
}
