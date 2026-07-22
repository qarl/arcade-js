# games/dkong/rom/ — you supply this

The Donkey Kong ROM data is **copyrighted by Nintendo** and is **never committed** to this
repo (the `.bin` files here are gitignored). Committing them would be distribution.

You supply your own ROM. Two ways, and they produce byte-identical images:

**In the browser** — open the player and drag your `dkong.zip` onto the page. It is unzipped,
assembled and sha256-verified entirely client-side, then cached in your browser. Nothing is
uploaded; the zip never leaves your machine. (`web/test/romzip.test.js` pins that this path
reproduces `make rom`'s output byte-for-byte.)

**From the CLI** — from `games/dkong/`:

```sh
make rom
```

`make rom` unzips + concatenates your local `dkong.zip` into the images this engine loads,
and **verifies them against a known sha256** — so a wrong or different romset fails loudly
rather than silently producing a wrong translation.

## The exact romset

The pinned set is MAME's **`dkong`** (Donkey Kong, US set 1) — `dkong.zip`. The engine was
validated pixel-exact against this set only; a different revision will not match these
hashes. The assembled images must be:

| file | what | size | sha256 |
|---|---|---|---|
| `maincpu.bin` | flat Z80 program image | 16384 B | `b24ea34a6554489184374635e5646f5e0dd4fccaec4c78c84fbfb9a6ea328c5d` |
| `gfx1.bin` | character/tile graphics | 4096 B | `fff4f3dfb860834d9a3d57bc794a7d0a84d3da19d86dd051bbd9ebba8501f581` |
| `gfx2.bin` | sprite graphics | 8192 B | `db4f7a4433febed7e609bd2705ad22b2ac4610299f61c37877116f646a457873` |
| `proms.bin` | color PROMs + decode | 768 B | `740d05416129bf52126396d814c39a517134132e18b202e8058ecdbde453b278` |

Check your own build with `shasum -a 256 games/dkong/rom/*.bin`.

Each image is a concatenation, in this exact order, of these parts from the zip:

| image | parts, in address order |
|---|---|
| `maincpu.bin` | `c_5et_g.bin`, `c_5ct_g.bin`, `c_5bt_g.bin`, `c_5at_g.bin` |
| `gfx1.bin` | `v_5h_b.bin`, `v_3pt.bin` |
| `gfx2.bin` | `l_4m_b.bin`, `l_4n_b.bin`, `l_4r_b.bin`, `l_4s_b.bin` |
| `proms.bin` | `c-2k.bpr`, `c-2j.bpr`, `v-5e.bpr` |

`games/dkong/manifest.js` is the single source of truth for all of the above — the table here
is a copy for discoverability, and both loaders read the manifest. Point `make rom` at wherever
your `dkong.zip` lives (default: `~/Downloads`, override with `ROMZIP=/path/to/dkong.zip`).
