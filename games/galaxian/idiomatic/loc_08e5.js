// SPDX-License-Identifier: GPL-3.0-only
// If bit 0 of the request flag is set, clear both the flag and the state
// byte it governs; otherwise do nothing.
import { loc_420b, loc_4208 } from "./names.js";

export function loc_08e5(m) {
  const { mem8 } = m;

  // Nothing to do unless the request flag's bit 0 is set.
  if ((mem8[loc_420b] & 1) === 0) return;

  // Consume the request and reset the state byte it governs.
  mem8[loc_420b] = 0;
  mem8[loc_4208] = 0;
}
