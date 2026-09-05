// SPDX-License-Identifier: GPL-3.0-only
// Stamp the "armed" marker (3) into a field of the refilled block, so the
// sub-state handler that tests the field stays on its main path.
import { loc_4195 } from "./names.js";

// The "armed" marker; the sub-state handler tests it as nonzero.
const ARMED = 3;

export function armSubstateAdvanceGate(m) {
  const { mem8 } = m;
  mem8[loc_4195] = ARMED;
}
