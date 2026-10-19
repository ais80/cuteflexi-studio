// node export_addons.mjs <engine.js> <printers.js> <printerKey> <outDir> '<cfg json>' [pack.3mf]
// The add-on pack exactly as the page exports it: mesh.bin (float32 xyz triangles placed on the
// plate) + design.json (hinge axes for the G-code gap check) and, if asked, the real pack 3MF
// written by the page's own build3MF (one object per add-on, no_brim per object).
import Module from 'manifold-3d';
import fs from 'fs';
import path from 'path';

const [, , enginePath, printersPath, printerKey, outDir, cfgJson, packPath] = process.argv;
const src = fs.readFileSync(enginePath, 'utf8');
const pick = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b) + b.length);
const { createFlexiEngine, build3MF } = new Function(pick(src, '// ===== FLEXI ENGINE BEGIN', '// ===== FLEXI ENGINE END =====') +
  pick(src, '// ===== 3MF WRITER BEGIN', '// ===== 3MF WRITER END =====') + '\nreturn { createFlexiEngine, build3MF };')();
const psrc = fs.readFileSync(printersPath, 'utf8');
const { PRINTER_SPECS, placeOnPlate } = new Function(pick(psrc, '// ===== PRINTERS BEGIN', '// ===== PRINTERS END =====') + '\nreturn { PRINTER_SPECS, placeOnPlate };')();

const wasm = await Module(); wasm.setup();
const eng = createFlexiEngine(wasm);
const BASE = { segments: 5, chubby: 1.05, interlock: 1.5, jointBeef: 1.35, jointType: 'chain',
  head: 'dragon', eyes: 'angry', legs: 'claws', wings: 'bat', tail: 'spade', pose: 'straight',
  colorMode: 'ams', keychain: false, magnets: true, hingedWings: false, hingedFlippers: false,
  port: true, headPort: false, addons: ['wings', 'fins', 'hat', 'saddle'] };
const spec = PRINTER_SPECS[printerKey];
const P = { ...BASE, clearance: spec.clearance, fit: spec.clearance, ...JSON.parse(cfgJson) };
const res = eng.build(P);
const pack = res.addons.filter(a => a.packOffset);
const pl = placeOnPlate(res.pack.footprint, spec, P.colorMode === 'ams');
fs.mkdirSync(outDir, { recursive: true });
if (!pl.fits) { fs.writeFileSync(path.join(outDir, 'design.json'), JSON.stringify({ fits: false, size: res.pack.size })); console.log('DOES NOT FIT', res.pack.size); process.exit(0); }
const ca = Math.cos(pl.angle * Math.PI / 180), sa = Math.sin(pl.angle * Math.PI / 180);
const place = ([x, y, z]) => [ca * x - sa * y + pl.tx, sa * x + ca * y + pl.ty, z];
const dirPlace = ([x, y]) => [ca * x - sa * y, sa * x + ca * y];
const tris = [];
for (const a of pack) {
  for (const m of [...Object.values(a.parts), ...a.flaps.flatMap(f => Object.values(f.parts))]) {
    const g = m.getMesh(), v = g.vertProperties, t = g.triVerts, np = g.numProp;
    for (let k = 0; k < t.length; k++) { const q = place([v[t[k] * np] + a.packOffset[0], v[t[k] * np + 1] + a.packOffset[1], v[t[k] * np + 2]]); tris.push(q[0], q[1], q[2]); }
  }
}
const packParts = pack.flatMap(a => [...Object.values(a.parts), ...a.flaps.flatMap(f => Object.values(f.parts))].map(m => m.translate([a.packOffset[0], a.packOffset[1], 0])));
// exact first-layer outline for the slicer registration check (sectioning the raw triangle soup
// of touching colour parts is unreliable)
fs.writeFileSync(path.join(outDir, 'layer1.json'), JSON.stringify(packParts.flatMap(m => m.slice(0.1).toPolygons()).map(poly => poly.map(([x, y]) => place([x, y, 0]).slice(0, 2)))));
fs.writeFileSync(path.join(outDir, 'mesh.bin'), Buffer.from(new Float32Array(tris).buffer));
const flaps = pack.flatMap(a => a.flaps.map(fl => ({ parent: a.key, side: fl.side, p: place([fl.axisP[0] + a.packOffset[0], fl.axisP[1] + a.packOffset[1], fl.axisP[2]]), d: dirPlace(fl.axisD) })));
fs.writeFileSync(path.join(outDir, 'design.json'), JSON.stringify({
  fits: true, printer: printerKey, placement: { angle: pl.angle, tx: pl.tx, ty: pl.ty, cx: pl.cx, cy: pl.cy, w: pl.w, h: pl.h }, keep: pl.keep,
  size: res.pack.size, clearance: P.fit, joints: [], flaps, flap: { Lw: 5.2, Lb: 2.6, Rk: 4.2 }, addons: pack.map(a => a.key), cfg: P,
}, null, 1));
if (packPath) {
  // the page's export: one object per add-on, parts per colour slot
  const ext = s => P.colorMode === 'ams' ? +s : 1;
  const objects = pack.map(a => {
    const sh = m => { const r = eng.toMesh(m); for (let k = 0; k < r.positions.length; k += 3) { r.positions[k] += a.packOffset[0]; r.positions[k + 1] += a.packOffset[1]; } return r; };
    const parts = [];
    for (const [s, m] of Object.entries(a.parts)) parts.push({ name: `${a.name} · ${a.flaps.length ? 'hub and peg' : 'body and peg'}`, extruder: ext(s), ...sh(m) });
    a.flaps.forEach((fl, j) => { for (const [s, m] of Object.entries(fl.parts)) parts.push({ name: `${a.name} · plate ${j + 1}`, extruder: ext(s), ...sh(m) }); });
    return { name: `CuteFlexi add-on: ${a.name}`, position: [0, 0], parts };
  });
  const bytes = await build3MF({ title: 'CuteFlexi add-on pack', objects, bedCenter: [spec.bed[0] / 2, spec.bed[1] / 2], placement: pl,
    objectSettings: { brim_type: 'no_brim', enable_support: '0' } });
  fs.writeFileSync(packPath, bytes);
}
console.log('ok', printerKey, pack.map(a => a.key).join('+'), 'angle', pl.angle, 'at', pl.cx.toFixed(0), pl.cy.toFixed(0), 'size', res.pack.size.map(v => v.toFixed(0)).join('x'));
eng.free();
