// SPDX-License-Identifier: GPL-3.0-only
import { loc_d00, loc_e00 } from "./names.js";
import { loc_df53 } from "./loc_df53.js";
import { loc_df6a } from "./loc_df6a.js";
import { loc_dd29 } from "./loc_dd29.js";
import { loc_dd27 } from "./loc_dd27.js";
import { loc_dbe0 } from "./loc_dbe0.js";

// Build the vector list for the spinner/knob readout: emit a fixed header word and a
// zero-tagged word, then two eight-digit runs keyed by the DIP-switch ports loc_d00 and
// loc_e00. The exit A of the loc_e00 run drives the POKEY pot-scan pulse, which returns the
// assembled pot-status byte; that byte (carried through Y) keys the final eight-digit
// run. The final run's exit A propagates out.
export function loc_dd0d(m) {
  const { mem8 } = m;
  loc_df53(m);
  loc_df6a(m, 0x00);
  loc_dd29(m, mem8[loc_d00], 0xe8);
  const a = loc_dd27(m, mem8[loc_e00]);
  const r = loc_dbe0(m, a);
  return loc_dd27(m, r);
}
