// SPDX-License-Identifier: GPL-3.0-only
// Stamp the "armed" marker (3) into a field of the refilled block, so the state
// handlers that test the field read it as nonzero.
import { loc_41b5 } from "./names.js";

// The "armed" marker; the state handlers test it as nonzero.
const ARMED = 3;

export function loc_050f(m) {
  const { mem8 } = m;
  mem8[loc_41b5] = ARMED;
}
