# games/dkong/rom/ — you supply this

The Donkey Kong ROM data is **copyrighted by Nintendo** and is **never committed** to this
repo (the `.bin` files here are gitignored). Committing them would be distribution.

You supply your own ROM. From `games/dkong/`:

```sh
make rom
```

`make rom` unzips + concatenates your local `dkong.zip` into the images this engine loads,
and **verifies them against a known sha256** — so a wrong or different romset fails loudly
rather than silently producing a wrong translation.

| file | what | size |
|---|---|---|
| `maincpu.bin` | flat Z80 program image | 16 KB |
| `gfx1.bin` | character/tile graphics | 4 KB |
| `gfx2.bin` | sprite graphics | 8 KB |
| `proms.bin` | color PROMs + decode | 768 B |

The exact source filenames, concatenation order, and sha256 checksums are declared in
`games/dkong/manifest.js`. Point `make rom` at wherever your `dkong.zip` lives (default:
`~/Downloads`).
