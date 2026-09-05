// SPDX-License-Identifier: GPL-3.0-only

// loc_1146  (ROM 0x1146) — no-op handler: a lone `ret` (a null entry in the dispatch table above).
export function loc_1146(m) {
  m.ret();
}
