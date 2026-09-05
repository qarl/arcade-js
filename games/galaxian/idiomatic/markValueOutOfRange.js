// SPDX-License-Identifier: GPL-3.0-only
// Saturate arm of a value clamp: snap register B to the fixed saturation value.

// The saturation value B snaps to when the clamp input is out of range.
const CLAMP_SATURATION = 128;

export function markValueOutOfRange(m) {
  return (m.regs.b = CLAMP_SATURATION);
}
