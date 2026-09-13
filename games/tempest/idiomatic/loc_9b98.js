// SPDX-License-Identifier: GPL-3.0-only
import { loc_9bca } from "./loc_9bca.js";
import { loc_9bd0 } from "./loc_9bd0.js";
import { loc_9bee } from "./loc_9bee.js";
import { loc_9c17 } from "./loc_9c17.js";
import { loc_9c0c } from "./loc_9c0c.js";
import { loc_9bcf } from "./loc_9bcf.js";
import { loc_9c58 } from "./loc_9c58.js";
import { loc_9fc4 } from "./loc_9fc4.js";
import { loc_9bdd } from "./loc_9bdd.js";
import { loc_9e5c } from "./loc_9e5c.js";
import { loc_9d82 } from "./loc_9d82.js";
import { loc_9c4f } from "./loc_9c4f.js";
import { loc_9e2f } from "./loc_9e2f.js";
import { loc_9bfa } from "./loc_9bfa.js";
import { loc_9c21 } from "./loc_9c21.js";
import { loc_9ef1 } from "./loc_9ef1.js";
import { loc_9e48 } from "./loc_9e48.js";
import { loc_9cb6 } from "./loc_9cb6.js";
import { loc_9d67 } from "./loc_9d67.js";
import { loc_9c3b } from "./loc_9c3b.js";

// Computed jump: the incoming value is a pre-doubled index (the caller left the 2-byte table offset in it)
// that selects one of twenty motion/steering/coordinate handlers and runs it.
const TABLE = [
  loc_9bca, loc_9bd0, loc_9bee, loc_9c17, loc_9c0c, loc_9bcf, loc_9c58, loc_9fc4, loc_9bdd, loc_9e5c,
  loc_9d82, loc_9c4f, loc_9e2f, loc_9bfa, loc_9c21, loc_9ef1, loc_9e48, loc_9cb6, loc_9d67, loc_9c3b,
];
export function loc_9b98(m, a = m.regs.a) {
  m.regs.y = a; // the index also rides Y into the handlers' deeper callees (the object-insert tail)
  return TABLE[a >> 1](m);
}
