// SPDX-License-Identifier: GPL-3.0-only
/** loc_2251 — the tamper-trap landing: a stretch of table bytes the tile-image check jumps into as
 * code only when the readback FAILS. It is a self-checksum's dead failure arm aimed at data — on a
 * good image the readback always passes, so the caller never reaches here. Decoded as code the bytes
 * churn registers then fault storing through BC into non-writable space. Unreachable on a good image,
 * so it is modeled as a throw rather than reproducing the churn.
 * LIVE-OUT: none — control never returns; entry is the trap.
 * ROM 0x2251-0x22B8. Grounding: [code] (names.js ROUTINES 0x2251). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function loc_2251() {
  throw new NotImplemented(
    "loc_2251: tamper-trap table-as-code reached — the tile-image readback failed, so the ROM is bad",
  );
}
