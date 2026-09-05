// SPDX-License-Identifier: GPL-3.0-only
// Seed the strided work-RAM table from its fixed source data: point the strided copier at the source
// table and run it, laying 32 bytes into every other destination cell.
import { seedObjectRamShadowField as loc_0598 } from "./seedObjectRamShadowField.js";
import { STRIDED_TABLE_SRC } from "./names.js";

export function loc_0595(m) {
  loc_0598(m, STRIDED_TABLE_SRC);
}
