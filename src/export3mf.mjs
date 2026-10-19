// node export3mf.mjs <out.3mf> <printerKey> '<cfg>' '<objectSettings json>'
import Module from 'manifold-3d';
import fs from 'fs';
const src = fs.readFileSync('engine.js', 'utf8'), psrc = fs.readFileSync('printers.js', 'utf8');
const pick = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b) + b.length);
const { createFlexiEngine, build3MF } = new Function(pick(src, '// ===== FLEXI ENGINE BEGIN', '// ===== FLEXI ENGINE END =====') + pick(src, '// ===== 3MF WRITER BEGIN', '// ===== 3MF WRITER END =====') + '\nreturn { createFlexiEngine, build3MF };')();
const { PRINTER_SPECS, placeOnPlate } = new Function(pick(psrc, '// ===== PRINTERS BEGIN', '// ===== PRINTERS END =====') + '\nreturn { PRINTER_SPECS, placeOnPlate };')();
const [, , out, key, cfgJ, setJ] = process.argv;
const wasm = await Module(); wasm.setup(); const eng = createFlexiEngine(wasm);
const spec = PRINTER_SPECS[key];
const P = { segments: 5, chubby: 1.05, interlock: 1.5, jointBeef: 1.35, jointType: 'chain', head: 'dragon', eyes: 'angry', legs: 'claws', wings: 'bat', tail: 'spade', pose: 'straight', colorMode: 'ams', keychain: false, magnets: true, hingedWings: false, hingedFlippers: false, clearance: spec.clearance, ...JSON.parse(cfgJ) };
const res = eng.build(P);
const pl = placeOnPlate(res.footprint, spec, P.colorMode === 'ams');
const ext = s => P.colorMode === 'ams' ? +s : 1;
const pet = { name: 'pet', position: [0, 0], parts: [] };
for (const b of res.bodies) {
  for (const [s, m] of Object.entries(b.parts)) pet.parts.push({ name: `seg${b.index}-${s}`, extruder: ext(s), ...eng.toMesh(m) });
  for (const fl of b.flaps) for (const [s, m] of Object.entries(fl.parts)) pet.parts.push({ name: `flap${b.index}${fl.side}`, extruder: ext(s), ...eng.toMesh(m) });
}
const objs = [pet, ...res.kit.map(k => ({ name: 'kit ' + k.name, position: [0, 0], parts: [{ name: k.name, extruder: 1, ...eng.toMesh(k.m) }] }))];
const bytes = await build3MF({ title: 'test', objects: objs, bedCenter: [spec.bed[0] / 2, spec.bed[1] / 2], placement: pl, objectSettings: JSON.parse(setJ || '{}'),
  layerChange: P.colorMode === 'layer' ? { z: res.layerChangeZ, color: '#ff8800' } : null });
fs.writeFileSync(out, bytes);
console.log('wrote', out, 'angle', pl.angle, 'at', pl.cx, pl.cy);
