# CuteFlexi Studio sources

- `template.html` + `engine.js` + `printers.js` -> `python build_page.py <outdir>` writes `cuteflexi_studio.html` (full page) and `cuteflexi_studio_artifact.html` (artifact body). Needs `npm install` here first (manifold-3d 3.4.1 WASM is embedded from node_modules).
- `node test2.mjs engine.js [config ...]` - printability/strength/motion tests; `--fuzz N --seed S [--port]` for random designs (`--port` adds the accessory port + all add-ons).
- `python printer_check.py <workdir> [--addons] "--only=Bambu A1,Snapmaker U1" name='{cfg}' ...` - slices with the Snapmaker Orca CLI on real printer profiles and checks hinge gaps in the G-code. `--addons` slices the add-on pack instead of the pet.
- `node export_addons.mjs engine.js printers.js <printer> <outdir> '{cfg}' [pack.3mf]` - the add-on pack as the page exports it.
- `python slice_real_pack.py <pack.3mf> a1|u1 <outdir>` - slices the page's own multi-object pack 3MF with a real config injected; reports objects and brim in the G-code.
