// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_0, loc_3, loc_4c, loc_4e, loc_50, loc_52, loc_74, loc_75, loc_7c,
  loc_1c9, loc_800, loc_c00, loc_daf9,
  loc_4000, loc_4800, loc_5000, loc_5800, loc_60c8, loc_60cb, loc_60e0,
} from "./names.js";
import { loc_de11 } from "./loc_de11.js";
import { loc_ddf1 } from "./loc_ddf1.js";
import { loc_db0f } from "./loc_db0f.js";
import { loc_df0d } from "./loc_df0d.js";
import { loc_de1b } from "./loc_de1b.js";

// The self-test session loop. A one-time preamble seeds the state machine, forwards a pending request
// byte, copies the 8-byte colour table into colour RAM, and idles the coin/flip control; then each pass
// builds and shows one self-test frame, sampling the option switches and the diagnostic inputs, until
// the self-test switch is released. The video-sync drain touches no work RAM, so it is modelled as the
// watchdog + display-reset strobes it performs rather than as a busy-wait.
export function loc_da62(m) {
  const { mem8 } = m;

  // ---- one-time preamble ----
  loc_de11(m);
  const pending = mem8[loc_1c9];
  if (pending === 0) {
    mem8[loc_0] = 2;
  } else {
    mem8[loc_7c] = pending;
    loc_ddf1(m);
    mem8[loc_1c9] = 0;
    mem8[loc_0] = 0;
  }
  for (let i = 7; i >= 0; i--) mem8[loc_800 + i] = mem8[u16(loc_daf9 + i)];
  mem8[loc_60e0] = 0;
  mem8[loc_4000] = 0x10;

  // ---- per-frame self-test loop ----
  for (;;) {
    mem8[loc_5000] = 0; // watchdog clear (value-ignoring strobe)
    mem8[loc_5800] = 0; // display reset (value-ignoring strobe)

    mem8[loc_74] = 0;
    mem8[loc_75] = 0x20;
    mem8[loc_60cb] = 0x20;
    const options = mem8[loc_60c8];
    mem8[loc_52] = options;
    mem8[loc_50] = options & 0x0f;

    const active = (mem8[loc_c00] ^ 0xff) & 0x2f;
    mem8[loc_4e] = active;
    if ((active & 0x28) === 0) {
      mem8[loc_4c] = 0x20;
    } else {
      const packed = mem8[loc_4c];
      mem8[loc_4c] = packed << 1;
      if ((packed & 0x80) !== 0) mem8[loc_0] = mem8[loc_0] + 2; // top bit shifted out -> double-bump
    }

    loc_db0f(m);
    mem8[loc_4800] = loc_df0d(m); // build the frame, then strobe display go

    mem8[loc_3] = mem8[loc_3] + 1;
    if ((mem8[loc_3] & 0x03) === 0) loc_de1b(m); // every fourth frame

    if ((mem8[loc_c00] & 0x10) !== 0) return; // self-test switch released -> leave
  }
}
