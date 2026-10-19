# CuteFlexi Studio

A browser tool that builds **print-in-place flexi pets** (dragon, cat, bunny, T-Rex, narwhal, bee, axolotl, caterpillar and mixes) and exports a **3MF** for Bambu Studio, OrcaSlicer and Snapmaker Orca.

Live page: **https://ais80.github.io/cuteflexi-studio/**

Inspired by the principles of [CuteFlexiMaker](https://makerworld.com/en/crowdfunding/202-cutefleximaker-build-your-3d-pet) (print-in-place, support-free, multi-colour 3MF). This is an independent project and does not use its code or assets.

## What it does

- **Real solids.** Every segment is its own closed manifold built with [manifold-3d](https://github.com/elalish/manifold) CSG, so each body is one connected solid that sits flat on the bed.
- **Print-in-place hinges.** A knob on the rear segment sits in a socket ring on the front one. The air gap is the same all round, and 45° lips above and below stop it lifting or pulling out. No surface is steeper than 45°, so no supports.
- **Strength floors on every design.** Neck at least 3 mm wide, socket wall 2.6 mm, lips at least 0.9 mm, and a socket mouth at least 0.7 mm narrower than the knob.
- **Moving parts.** Optional hinged wings and flippers on horizontal cone-pin hinges, plus snap-on add-ons (wings, fins, hat, saddle) for pets you have already printed, exported as a separate add-on pack.
- **Printer-aware export.** Plate size, keep-out zones, prime tower and a recommended air gap for Bambu A1 / A1 mini / P1 / X1, Snapmaker U1 and a generic 220 mm printer. The pet is rotated and placed to fit, and the 3MF turns brim and supports off for it.
- **Colour workflows.** AMS / U1 four-slot, press-fit kit (separate eyes and horns), one spool with raised relief, and a single-extruder colour change at a set height.

## How it was checked

Run by `src/test2.mjs` and `src/printer_check.py`:

- 26 named designs and 120 random designs: one solid per body, no body closer than the air gap, every hinge swings its full range and cannot be pulled or lifted out, and every neck and body section meets the strength floor.
- 25 real slices with the Snapmaker Orca command-line slicer on Bambu A1, P1P/X1, A1 mini, Snapmaker U1 and Creality Ender-3 V3 profiles. The G-code was read back and no extrusion runs inside any hinge air gap.
- Files load in Snapmaker Orca and report as manifold.

**Not verified:** nothing has been printed yet, and the files have not been opened in the Bambu Studio app (only checked with Orca and Bambu's printer settings). Treat the first print as a test: start with one small pet at the recommended air gap.

## Using it

Open the page, pick a printer, design the pet, and choose **Export 3MF**. In the slicer, pick your printer, filament and a 0.2 mm profile. Print the first layer slowly.

## Building from source

```bash
cd src
npm install
python build_page.py ..          # writes index.html (and the artifact body) one level up
node test2.mjs engine.js         # printability, strength and motion tests
node test2.mjs engine.js --fuzz 60 --seed 7
```

`printer_check.py` slices with the Snapmaker Orca CLI on real profiles and needs Snapmaker Orca installed, plus a saved project 3MF per printer to take its full settings from (the paths are at the top of the script). See `src/README.md` for the other scripts.

## Layout

| Path | What |
|---|---|
| `index.html` | The built page (the engine and manifold WASM are embedded) |
| `src/` | Template, engine, printer table, export and test scripts |
| `addon-pack-samples/` | Example add-on pack 3MFs for the U1 and the X1/P1/A1 plates |

## Licence

No licence has been chosen yet, so all rights are reserved by default.
