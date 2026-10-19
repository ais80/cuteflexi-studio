// node export_design.mjs <engine.js> <printers.js> <printerKey> <outDir> '<cfg json>'
// Writes mesh.bin (float32 xyz triangles, already placed on the plate) + design.json
import Module from 'manifold-3d';
import fs from 'fs';
import path from 'path';

const [, , enginePath, printersPath, printerKey, outDir, cfgJson] = process.argv;
const src = fs.readFileSync(enginePath, 'utf8');
const pick = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b) + b.length);
const { createFlexiEngine } = new Function(pick(src, '// ===== FLEXI ENGINE BEGIN', '// ===== FLEXI ENGINE END =====') + '\nreturn { createFlexiEngine };')();
const psrc = fs.readFileSync(printersPath, 'utf8');
const { PRINTER_SPECS, placeOnPlate } = new Function(pick(psrc, '// ===== PRINTERS BEGIN', '// ===== PRINTERS END =====') + '\nreturn { PRINTER_SPECS, placeOnPlate };')();

const wasm = await Module(); wasm.setup();
const eng = createFlexiEngine(wasm);
const BASE = { segments: 5, chubby: 1.05, interlock: 1.5, jointBeef: 1.35, jointType: 'chain',
  head: 'dragon', eyes: 'angry', legs: 'claws', wings: 'bat', tail: 'spade', pose: 'straight',
  colorMode: 'ams', keychain: false, magnets: true, hingedWings: false, hingedFlippers: false };
const spec = PRINTER_SPECS[printerKey];
const P = { ...BASE, clearance: spec.clearance, ...JSON.parse(cfgJson) };
const res = eng.build(P);
const multi = P.colorMode === 'ams';
const pl = placeOnPlate(res.footprint, spec, multi);
fs.mkdirSync(outDir, { recursive: true });
if (!pl.fits) { fs.writeFileSync(path.join(outDir, 'design.json'), JSON.stringify({ fits: false, size: res.size })); console.log('DOES NOT FIT', res.size); process.exit(0); }
const ca = Math.cos(pl.angle * Math.PI / 180), sa = Math.sin(pl.angle * Math.PI / 180);
const place = ([x, y, z]) => [ca * x - sa * y + pl.tx, sa * x + ca * y + pl.ty, z];
const dirPlace = ([x, y]) => [ca * x - sa * y, sa * x + ca * y];

const all = [];
for (const b of res.bodies) { all.push(...Object.values(b.parts)); for (const fl of b.flaps) all.push(...Object.values(fl.parts)); }
for (const k of res.kit) all.push(k.m);
const tris = [];
for (const m of all) {
  const g = m.getMesh(), v = g.vertProperties, t = g.triVerts, np = g.numProp;
  for (let k = 0; k < t.length; k++) { const q = place([v[t[k] * np], v[t[k] * np + 1], v[t[k] * np + 2]]); tris.push(q[0], q[1], q[2]); }
}
// exact first-layer outline for the slicer registration check (sectioning the raw triangle soup
// of touching colour parts is unreliable)
fs.writeFileSync(path.join(outDir, 'layer1.json'), JSON.stringify(all.flatMap(m => m.slice(0.1).toPolygons()).map(poly => poly.map(([x, y]) => place([x, y, 0]).slice(0, 2)))));
fs.writeFileSync(path.join(outDir, 'mesh.bin'), Buffer.from(new Float32Array(tris).buffer));
const shift = res.shift;
const joints = res.joints.map(J => {
  const th = res.plan.segs[J.i + 1].th;
  return { i: J.i, p: place([J.world[0] + shift[0], J.world[1] + shift[1], 0]).slice(0, 2), dirB: dirPlace([Math.cos(th), Math.sin(th)]),
    rk: J.rk, e: J.e, c: J.c, zb: J.zb, wb: J.wb, gapB: J.gapB, bulges: J.bulges, wn: J.wn, Rf: J.Rf, Hc: J.Hc };
});
const flaps = res.bodies.flatMap(b => b.flaps.map(fl => ({ parent: b.index, side: fl.side, p: place(fl.axisP), d: dirPlace(fl.axisD) })));
fs.writeFileSync(path.join(outDir, 'design.json'), JSON.stringify({
  fits: true, printer: printerKey, placement: { angle: pl.angle, tx: pl.tx, ty: pl.ty, cx: pl.cx, cy: pl.cy, w: pl.w, h: pl.h }, keep: pl.keep,
  size: res.size, clearance: P.clearance, joints, flaps, flap: { Lw: 5.2, Lb: 2.6, Rk: 4.2 }, cfg: P,
}, null, 1));
console.log('ok', printerKey, 'angle', pl.angle, 'at', pl.cx.toFixed(0), pl.cy.toFixed(0), 'size', res.size.map(v => v.toFixed(0)).join('x'));
eng.free();
