// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_2f, loc_3, loc_108, loc_109, loc_11c, loc_125, loc_14f, loc_150, loc_203, loc_243, loc_ca38 } from "./names.js";
import { loc_9923 } from "./loc_9923.js";

// Scans the 64-entry slot-timer table loc_243 (slot 63..0), ageing each active slot, and accumulates a
// per-slot bit mask into loc_14f which it copies out to loc_150. loc_2f is a gate byte: 0xff (bit7 set)
// freezes ageing this pass; it is set when the loc_108+loc_109 pair overshoots loc_11c, or loc_125 is set.
// An expired slot (timer reaches 0) fires the expiry handler, which may itself raise the loc_2f gate mid-scan.
export function loc_98a2(m) {
  const { mem8 } = m;

  mem8[loc_14f] = 0;

  const pairedSum = u8(mem8[loc_108] + mem8[loc_109]);
  mem8[loc_2f] = (pairedSum > mem8[loc_11c] || mem8[loc_125] !== 0) ? 0xff : 0x00;

  for (let slot = 0x3f; slot >= 0; slot--) {
    const timer = mem8[u16(loc_243 + slot)];
    if (timer === 0) continue;

    // Age the slot unless the gate is raised.
    if ((mem8[loc_2f] & 0x80) === 0) {
      const aged = timer - 1;
      mem8[u16(loc_243 + slot)] = aged;
      if (aged === 0) {
        loc_9923(m, slot);
      } else if (aged === 0x3f) {
        const bit = mem8[u16(loc_203 + slot)];
        if ((mem8[loc_14f] & mem8[u16(loc_ca38 + bit)]) !== 0) {
          mem8[u16(loc_243 + slot)] = aged + 1;
        }
      }
    }

    // Classify the (possibly re-armed or expired) timer.
    const t = mem8[u16(loc_243 + slot)];
    if (t < 0x40) {
      if (t >= 0x20) {
        const bit = mem8[u16(loc_203 + slot)];
        mem8[loc_14f] = mem8[loc_14f] | mem8[u16(loc_ca38 + bit)];
      }
    } else if ((mem8[loc_3] & 0x01) === 0) {
      mem8[u16(loc_203 + slot)] = (mem8[u16(loc_203 + slot)] + 1) & 0x0f;
    }
  }

  mem8[loc_150] = mem8[loc_14f];
}
