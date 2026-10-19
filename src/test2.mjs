// Printability + strength + motion tests. Usage:
//   node test2.mjs <engine-or-html> [configName ...]
//   node test2.mjs <engine-or-html> --fuzz <count> [--seed n]
import Module from 'manifold-3d';
import fs from 'fs';

const src = fs.readFileSync(process.argv[2], 'utf8');
const pick = (a, b) => src.slice(src.indexOf(a), src.indexOf(b) + b.length);
const code = pick('// ===== FLEXI ENGINE BEGIN', '// ===== FLEXI ENGINE END =====') + '\n' +
  pick('// ===== 3MF WRITER BEGIN', '// ===== 3MF WRITER END =====') + '\nreturn { createFlexiEngine, build3MF };';
const { createFlexiEngine } = new Function(code)();
const wasm = await Module(); wasm.setup();
const eng = createFlexiEngine(wasm);
const { Manifold } = wasm;

const BASE = { segments: 5, chubby: 1.05, interlock: 1.5, clearance: 0.35, jointBeef: 1.35, jointType: 'chain',
  head: 'dragon', eyes: 'angry', legs: 'claws', wings: 'bat', tail: 'spade', pose: 'straight',
  colorMode: 'ams', keychain: false, magnets: true, hingedWings: false, hingedFlippers: false,
  port: false, headPort: false, addons: [] };
const ALL = ['wings', 'fins', 'hat', 'saddle'];
const PRESETS = {
  dragon: { head: 'dragon', eyes: 'angry', segments: 5, chubby: 1.05, legs: 'claws', wings: 'bat', tail: 'spade' },
  cat: { head: 'cat', eyes: 'happy', segments: 4, chubby: 1.05, legs: 'paws', wings: 'none', tail: 'cat' },
  bunny: { head: 'bunny', eyes: 'kawaii', segments: 3, chubby: 1.20, legs: 'paws', wings: 'none', tail: 'puff' },
  trex: { head: 'trex', eyes: 'angry', segments: 4, chubby: 1.15, legs: 'claws', wings: 'spikes', tail: 'spade' },
  narwhal: { head: 'narwhal', eyes: 'sleepy', segments: 5, chubby: 1.10, legs: 'flippers', wings: 'none', tail: 'fluke' },
  bee: { head: 'bee', eyes: 'kawaii', segments: 3, chubby: 1.25, legs: 'paws', wings: 'bee', tail: 'stinger' },
  axolotl: { head: 'axolotl', eyes: 'kawaii', segments: 5, chubby: 1.00, legs: 'paws', wings: 'spikes', tail: 'fluke' },
  caterpillar: { head: 'bee', eyes: 'cyclops', segments: 8, chubby: 0.95, legs: 'paws', wings: 'none', tail: 'puff' },
};
const CONFIGS = {
  ...PRESETS,
  twin: { jointType: 'double' },
  wide: { jointType: 'ball' },
  tight: { clearance: 0.2, interlock: 1.35, jointBeef: 1.0, chubby: 0.75 },
  loose: { clearance: 0.55, interlock: 1.8, jointBeef: 1.7, chubby: 1.45 },
  scurve: { pose: 'scurve', segments: 8 },
  spiral: { pose: 'spiral', segments: 10 },
  kit: { colorMode: 'kit', eyes: 'kawaii', keychain: true },
  single: { colorMode: 'single', eyes: 'kawaii', segments: 7, head: 'bee', keychain: true },
  layer: { colorMode: 'layer' },
  min2: { segments: 2, chubby: 0.75, legs: 'flippers', tail: 'cat', wings: 'bee', head: 'axolotl' },
  max10: { segments: 10, chubby: 1.45, jointType: 'double' },
  flapDragon: { hingedWings: true },
  flapBee: { ...PRESETS.bee, hingedWings: true },
  flapNarwhal: { ...PRESETS.narwhal, hingedFlippers: true },
  flapBoth: { wings: 'bat', legs: 'flippers', hingedWings: true, hingedFlippers: true, segments: 7 },
  flapTight: { hingedWings: true, hingedFlippers: true, legs: 'flippers', chubby: 0.75, clearance: 0.2, interlock: 1.35, jointBeef: 1.0, segments: 3 },
  flapSpiral: { hingedWings: true, hingedFlippers: true, legs: 'flippers', pose: 'spiral', segments: 8, jointType: 'ball' },
  flapMin2: { hingedWings: true, hingedFlippers: true, legs: 'flippers', segments: 2, wings: 'bee' },
  // snap-on accessory port + add-on pack (fit = the printer table's clearance: 0.35 Bambu/U1, 0.45 other)
  port: { port: true, addons: ALL },
  portHead: { port: true, headPort: true, addons: ALL },
  portBunny: { ...PRESETS.bunny, port: true, headPort: true, addons: ALL },
  portCat: { ...PRESETS.cat, port: true, headPort: true, addons: ALL },
  portTrex: { ...PRESETS.trex, port: true, headPort: true, addons: ALL },
  portBee: { ...PRESETS.bee, port: true, headPort: true, addons: ALL },
  portNarwhal: { ...PRESETS.narwhal, port: true, headPort: true, addons: ALL, hingedFlippers: true },
  portAxolotl: { ...PRESETS.axolotl, port: true, headPort: true, addons: ALL },
  portGeneric: { port: true, headPort: true, fit: 0.45, clearance: 0.45, addons: ALL },
  portTight: { port: true, clearance: 0.2, interlock: 1.35, jointBeef: 1.0, chubby: 0.75, addons: ALL },
  portLoose: { port: true, fit: 0.45, clearance: 0.55, interlock: 1.8, jointBeef: 1.7, chubby: 1.45, addons: ALL },
  portHinged: { port: true, hingedWings: true, hingedFlippers: true, legs: 'flippers', addons: ALL },
  portBall: { port: true, jointType: 'ball', addons: ALL },
  portTwin: { port: true, jointType: 'double', addons: ALL },
  portSpiral: { port: true, pose: 'spiral', segments: 8, addons: ALL },
  portScurve: { port: true, pose: 'scurve', segments: 8, addons: ALL },
  portKit: { port: true, headPort: true, colorMode: 'kit', eyes: 'kawaii', keychain: true, addons: ALL },
  portSingle: { port: true, colorMode: 'single', eyes: 'kawaii', segments: 7, head: 'bee', keychain: true, addons: ALL },
  portMin2: { port: true, segments: 2, chubby: 0.75, legs: 'flippers', tail: 'cat', wings: 'bee', head: 'axolotl', addons: ALL },
  portMax10: { port: true, segments: 10, chubby: 1.45, jointType: 'double', addons: ALL },
};

// ---- seeded random designs
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function fuzzConfigs(n, seed, portFuzz) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)], step = (lo, hi, st) => +(lo + st * Math.floor(r() * ((hi - lo) / st + 1))).toFixed(2);
  const out = {};
  for (let k = 0; k < n; k++) {
    out[`fuzz${seed}-${k}`] = {
      segments: 2 + Math.floor(r() * 9), chubby: step(0.75, 1.45, 0.05), interlock: step(1.35, 1.8, 0.05),
      clearance: step(0.2, 0.55, 0.05), jointBeef: step(1.0, 1.7, 0.05), jointType: pick(['chain', 'double', 'ball']),
      head: pick(['dragon', 'cat', 'bunny', 'trex', 'narwhal', 'bee', 'axolotl']), eyes: pick(['kawaii', 'happy', 'angry', 'sleepy', 'cyclops']),
      legs: pick(['claws', 'paws', 'flippers', 'none']), wings: pick(['bat', 'bee', 'spikes', 'none']),
      tail: pick(['spade', 'cat', 'puff', 'fluke', 'stinger']), pose: pick(['straight', 'scurve', 'spiral']),
      colorMode: pick(['ams', 'kit', 'single', 'layer']), keychain: r() < 0.4, magnets: r() < 0.7,
      hingedWings: r() < 0.5, hingedFlippers: r() < 0.5,
    };
    // port fields from their own stream so the older fuzz designs stay the same
    if (portFuzz) {
      const q = rng(seed * 7919 + k);
      Object.assign(out[`fuzz${seed}-${k}`], { port: true, headPort: q() < 0.5, fit: q() < 0.7 ? 0.35 : 0.45, addons: ALL });
    }
  }
  return out;
}

const rotZabout = (m, deg, p) => {
  const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  return m.translate([-p[0], -p[1], 0]).transform([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).translate([p[0], p[1], 0]);
};
const rotAxis = (m, deg, p, d) => { // Rodrigues about axis d through p
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = d;
  const R = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
  return m.translate([-p[0], -p[1], -p[2]]).transform(R).translate(p);
};
// A body's colour parts share faces by design, and a boolean union of face-sharing solids can
// grow phantom slivers (seen: +2.4 mm3 that 'touches' a hinged wing 0.4 mm away). Collision
// checks therefore keep each body as its colour parts (PS: slot -> Manifold) and measure part
// by part; sets of bodies are unioned per slot only (one slot's parts in different bodies
// never share faces). UM unions into one Manifold, for single-solid checks.
class PS {
  constructor(p) { this.p = p; }
  map(f) { return new PS(Object.fromEntries(Object.entries(this.p).map(([k, m]) => [k, f(m)]))); }
  get list() { return Object.values(this.p); }
  translate(v) { return this.map(m => m.translate(v)); }
  transform(M) { return this.map(m => m.transform(M)); }
}
const toPS = x => x instanceof PS ? x : new PS({ x });
const UM = ms => ms.length === 1 ? ms[0] : Manifold.union(ms);
const U = ms => {
  const by = {};
  for (const x of ms.map(toPS)) for (const [k, m] of Object.entries(x.p)) (by[k] = by[k] || []).push(m);
  return new PS(Object.fromEntries(Object.entries(by).map(([k, l]) => [k, UM(l)])));
};
const hits = (a, b) => { let v = 0; for (const x of toPS(a).list) for (const y of toPS(b).list) v += x.intersect(y).volume(); return v; };
const gapOf = (a, b, d) => { let g = Infinity; for (const x of toPS(a).list) for (const y of toPS(b).list) g = Math.min(g, x.minGap(y, d)); return g; };

function overhangArea(m, zMin = 0.25) {
  let area = 0;
  const g = m.getMesh(), v = g.vertProperties, t = g.triVerts, np = g.numProp;
  for (let k = 0; k < t.length; k += 3) {
    const P = j => [v[t[k + j] * np], v[t[k + j] * np + 1], v[t[k + j] * np + 2]];
    const a = P(0), b = P(1), c = P(2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const A = Math.hypot(...n) / 2; if (A < 1e-9) continue;
    if (n[2] / (2 * A) < -0.72 && (a[2] + b[2] + c[2]) / 3 > zMin) area += A;
  }
  return area;
}

export function runConfig(name, cfg, { quiet = false } = {}) {
  const P = { ...BASE, ...cfg };
  const t0 = Date.now();
  const res = eng.build(P);
  const ms = Date.now() - t0;
  const errs = [];
  const shift = [res.bodies[0].pos[0] - res.plan.segs[0].pos[0], res.bodies[0].pos[1] - res.plan.segs[0].pos[1]];
  // every moving body: segments, flaps, kit pieces
  const movers = [];
  for (const b of res.bodies) {
    movers.push({ name: `seg${b.index}`, seg: b.index, m: new PS({ ...b.parts }), whole: UM(Object.values(b.parts)) });
    for (const fl of b.flaps) movers.push({ name: `flap${b.index}${fl.side > 0 ? 'L' : 'R'}`, seg: b.index, flap: fl, m: new PS({ ...fl.parts }), whole: UM(Object.values(fl.parts)) });
  }
  for (const k of res.kit) movers.push({ name: `kit-${k.name}`, seg: -1, m: new PS({ [k.slot]: k.m }), whole: k.m });
  // 1. solid, one piece, on the bed, decent first layer
  for (const o of movers) {
    if (o.whole.status() !== 'NoError') errs.push(`${o.name} status ${o.whole.status()}`);
    const n = o.whole.decompose().filter(q => Math.abs(q.volume()) > 0.5).length;
    if (n !== 1) errs.push(`${o.name} has ${n} islands`);
    const bb = o.whole.boundingBox(); if (Math.abs(bb.min[2]) > 1e-4) errs.push(`${o.name} min z ${bb.min[2].toFixed(3)}`);
    const a1 = o.whole.slice(0.1).area(); if (a1 < 15) errs.push(`${o.name} first layer ${a1.toFixed(1)} mm2`);
  }
  // 2. colour parts inside a body don't overlap
  for (const b of res.bodies) {
    const ps = Object.values(b.parts);
    for (let x = 0; x < ps.length; x++) for (let y = x + 1; y < ps.length; y++) {
      // colour parts share faces by design; intersect() of face-sharing solids can report phantom
      // volume, so confirm by inclusion-exclusion before calling it an overlap
      let v = hits(ps[x], ps[y]);
      if (v > 0.5) v = ps[x].volume() + ps[y].volume() - ps[x].add(ps[y]).volume();
      if (v > 0.5) errs.push(`seg${b.index} colour overlap ${v.toFixed(2)} mm3`);
    }
  }
  // 3. no two bodies touch; all keep >= clearance
  let minGap = Infinity;
  for (let x = 0; x < movers.length; x++) for (let y = x + 1; y < movers.length; y++) {
    const A = movers[x].m, B = movers[y].m;
    const v = hits(A, B); if (v > 1e-3) errs.push(`${movers[x].name}&${movers[y].name} overlap ${v.toFixed(2)} mm3`);
    const g = gapOf(A, B, 3); if (g < minGap) minGap = g;
    if (g < P.clearance * 0.9) errs.push(`${movers[x].name}&${movers[y].name} gap ${g.toFixed(3)}`);
  }
  // 4. every hinge swings its full range with everything downstream attached
  let swingOK = 0, captive = 0, minNeck = Infinity; const flapLimited = new Set(), selfContact = new Set();
  for (const J of res.joints) {
    const jw = [J.world[0] + shift[0], J.world[1] + shift[1]];
    // bodies alone must swing the full range; a flat flap that meets another part during a
    // full bend just lifts on its hinge, so that is reported as a limit, not a failure
    const segFixed = U(movers.filter(o => !o.flap && o.seg >= 0 && o.seg <= J.i).map(o => o.m));
    const segMoving = movers.filter(o => !o.flap && o.seg > J.i).map(o => o.m);
    const allFixed = U(movers.filter(o => o.seg >= 0 && o.seg <= J.i).map(o => o.m));
    const allMoving = movers.filter(o => o.seg > J.i).map(o => o.m);
    const dp = res.plan.delta[J.i];
    let ok = true;
    for (const tgt of [-J.S, J.S]) {
      const v = hits(U(segMoving.map(m => rotZabout(m, tgt - dp, jw))), segFixed);
      if (v > 1e-3) {
        // a neighbour pair touching = the hinge binds (defect); bodies further apart touching =
        // the curled pet meeting itself at full bend (a pose limit any real toy has)
        const fx = movers.filter(o => !o.flap && o.seg >= 0 && o.seg <= J.i), mvB = movers.filter(o => !o.flap && o.seg > J.i);
        let pairs = [];
        for (const a of fx) for (const b of mvB) { const w = hits(rotZabout(b.m, tgt - dp, jw), a.m); if (w > 1e-3) pairs.push([a.seg, b.seg, w]); }
        if (pairs.some(([a, b]) => b - a === 1)) { ok = false; errs.push(`joint${J.i} binds at ${tgt}deg (${v.toFixed(2)} mm3)`); }
        else selfContact.add(`j${J.i}@${tgt}: ` + pairs.map(([a, b]) => `${a}-${b}`).join(','));
      }
      else if (allMoving.length !== segMoving.length || movers.some(o => o.flap && o.seg <= J.i)) {
        if (hits(U(allMoving.map(m => rotZabout(m, tgt - dp, jw))), allFixed) > 1e-3) flapLimited.add(`j${J.i}@${tgt}`);
      }
    }
    if (ok) swingOK++;
    const F = movers.find(o => o.name === `seg${J.i}`).m, B = movers.find(o => o.name === `seg${J.i + 1}`).m;
    const th = res.plan.segs[J.i + 1].th, dir = [Math.cos(th), Math.sin(th)];
    let pull = 0; for (const d of [0.4, 0.8, 1.2, 1.6, 2.4, 3.2, 4.5, 6]) pull = Math.max(pull, hits(B.translate([dir[0] * d, dir[1] * d, 0]), F));
    const lift = hits(B.translate([0, 0, 1.2]), F), drop = hits(B.translate([0, 0, -1.2]), F);
    if (pull > 0.3 && lift > 0.3 && drop > 0.3) captive++; else errs.push(`joint${J.i} not captive (pull ${pull.toFixed(1)} lift ${lift.toFixed(1)} drop ${drop.toFixed(1)})`);
    // neck section: cut across the neck inside the air gap
    const x = J.Rf + J.c / 2, cx = jw[0] + dir[0] * x, cy = jw[1] + dir[1] * x;
    const box = Manifold.cube([0.2, J.wn + 0.4, 60], true).translate([0, 0, 30]).transform([dir[0], dir[1], 0, 0, -dir[1], dir[0], 0, 0, 0, 0, 1, 0, cx, cy, 0, 1]);
    const sec = hits(B, box) / 0.2;
    minNeck = Math.min(minNeck, sec);
    if (sec < 18) errs.push(`joint${J.i} neck section ${sec.toFixed(1)} mm2 < 18`);
  }
  // 5. hinged flaps: free lift range, captive
  const flapInfo = [];
  for (const o of movers.filter(q => q.flap)) {
    const fl = o.flap, others = U(movers.filter(q => q !== o).map(q => q.m));
    let maxA = 0;
    for (let a = 10; a <= 140; a += 10) {
      const dirSign = fl.side;                                // lift the plate upward on either side
      const mv = rotAxis(o.m, dirSign * a, fl.axisP, fl.axisD);
      if (hits(mv, others) > 1e-3) break;
      maxA = a;
    }
    flapInfo.push(maxA);
    if (maxA < 80) errs.push(`${o.name} lifts only ${maxA}deg`);
    const parent = movers.find(q => q.name === `seg${o.seg}`).m;
    const out = [-fl.axisD[1] * fl.side, fl.axisD[0] * fl.side];
    const tries = { out: [out[0] * 2, out[1] * 2, 0], ax1: fl.axisD.map(v => v * 1.6), ax2: fl.axisD.map(v => -v * 1.6), up: [0, 0, 1.6] };
    for (const [k, t] of Object.entries(tries)) { const v = hits(o.m.translate(t), parent); if (v < 0.3) errs.push(`${o.name} not captive when moved ${k} (${v.toFixed(2)})`); }
  }
  // 6. weakest section along each straight segment body (between its own joint zones)
  let weakest = Infinity;
  if (P.pose === 'straight') {
    for (const b of res.bodies) {
      const Jf = res.joints[b.index - 1], Jr = res.joints[b.index];
      const m = movers.find(q => q.name === `seg${b.index}`).m;
      const s = res.plan.segs[b.index];
      const x0 = Jf ? -s.df + Jf.Rb + 0.8 : -s.A * 0.6, x1 = Jr ? s.dr - Jr.Rf - 0.4 : s.A * 0.6;
      for (let x = x0; x <= x1; x += 1) {
        const slab = Manifold.cube([0.2, 120, 80], true).translate([b.pos[0] + x, b.pos[1], 40]);
        const a = hits(m, slab) / 0.2;
        if (a > 0) weakest = Math.min(weakest, a);
      }
    }
    if (weakest < minNeck) errs.push(`a body section (${weakest.toFixed(0)} mm2) is weaker than the neck (${minNeck.toFixed(0)} mm2)`);
  }

  // 7. accessory port and snap-on add-ons
  const addonInfo = [];
  const rigidInv = m => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0,
    -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]), -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]), -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]), 1];
  const ringR = (m, z, rMax, f) => {           // min/max radius of section vertices near the axis
    let v = f === 'min' ? Infinity : -Infinity;
    for (const poly of m.slice(z).toPolygons()) for (const [x, y] of poly) { const r = Math.hypot(x, y); if (r < rMax) v = f === 'min' ? Math.min(v, r) : Math.max(v, r); }
    return v;
  };
  const sites = {};
  for (const b of res.bodies) {
    if (!b.port) continue;
    const pt = b.port, k = pt.k;
    if (!pt.ok) {
      addonInfo.push(`${pt.where} port skipped (${pt.why})`);
      if (pt.where === 'back') errs.push(`back port skipped: ${pt.why}`);
      continue;
    }
    sites[pt.where] = pt;
    const pm = movers.find(q => q.name === `seg${b.index}`), parent = pm.m;
    const local = pm.whole.transform(rigidInv(pt.toPet));                  // port frame, body below z = 0
    // support-free: nothing in the port faces down steeper than 45 deg (the cylinder's own
    // bottom cut is excluded)
    const zone = local.intersect(Manifold.cylinder(k.depth + 3 - k.fit - 0.05, k.Rg + 0.8, k.Rg + 0.8, 96).translate([0, 0, -k.depth - 3]));
    const ohP = overhangArea(zone, -k.depth - 2.9);
    if (ohP > 0.5) errs.push(`${pt.where} port has ${ohP.toFixed(1)} mm2 of >46deg overhang`);
    // nothing inside the hole: the mouth and chamber are empty right down to the floor
    const plug = local.intersect(Manifold.cylinder(k.depth - 0.1, k.r0 - 0.05, k.r0 - 0.05, 96).translate([0, 0, -k.depth + 0.05]));
    if (plug.volume() > 1e-3) errs.push(`${pt.where} port hole is not clear (${plug.volume().toFixed(2)} mm3)`);
    // straight mouth length between the surface and the 45 deg ceiling
    const surf = local.intersect(Manifold.cylinder(30, k.r0 + 1.5, k.r0 + 1.5, 96).translate([0, 0, -30])).boundingBox().max[2];
    const mouthLen = k.ceiling + surf;
    if (mouthLen < 2.5) errs.push(`${pt.where} port mouth only ${mouthLen.toFixed(2)} mm long`);
    const mouthR = ringR(local, (surf - k.ceiling) / 2, 6, 'min');
    pt.test = { mouthR, mouthLen, ohP, parent };
    addonInfo.push(`${pt.where} port: mouth r${mouthR.toFixed(2)} x ${mouthLen.toFixed(1)} mm, floor at z ${(pt.zB - k.depth).toFixed(1)}`);
  }
  for (const a of res.addons || []) {
    const pt = sites[a.where], k = a.k, fit = k.fit;
    const rigid = UM(Object.values(a.parts)), flapMs = a.flaps.map(f => UM(Object.values(f.parts)));
    // print pose: single solids, flat on the bed, real first layer, support-free
    for (const [nm, m] of [[a.key, rigid], ...flapMs.map((m, j) => [`${a.key}-flap${j}`, m])]) {
      if (m.status() !== 'NoError') errs.push(`${nm} status ${m.status()}`);
      const n = m.decompose().filter(q => Math.abs(q.volume()) > 0.5).length;
      if (n !== 1) errs.push(`${nm} has ${n} islands`);
      const bb = m.boundingBox(); if (Math.abs(bb.min[2]) > 1e-4) errs.push(`${nm} min z ${bb.min[2].toFixed(3)}`);
      const a1 = m.slice(0.1).area(); if (a1 < 15) errs.push(`${nm} first layer ${a1.toFixed(1)} mm2`);
      const oh = overhangArea(m); if (oh > 0.5) errs.push(`${nm} has ${oh.toFixed(1)} mm2 of >46deg overhang`);
    }
    for (let x = 0; x < flapMs.length; x++) for (let y = x + 1; y < flapMs.length; y++) if (flapMs[x].minGap(flapMs[y], 2) < fit * 0.9) errs.push(`${a.key} flaps touch`);
    // print-in-place hinges on the hub: gap, lift, captive
    const lift = [];
    a.flaps.forEach((fl, j) => {
      const g = flapMs[j].minGap(rigid, 2); if (g < fit * 0.9) errs.push(`${a.key} flap${j} gap ${g.toFixed(3)} to hub`);
      if (hits(flapMs[j], rigid) > 1e-3) errs.push(`${a.key} flap${j} overlaps hub`);
      let maxA = 0;
      for (let d = 10; d <= 140; d += 10) { if (hits(rotAxis(flapMs[j], fl.side * d, fl.axisP, fl.axisD), rigid) > 1e-3) break; maxA = d; }
      if (maxA < 80) errs.push(`${a.key} flap${j} lifts only ${maxA}deg`);
      const out = [-fl.axisD[1] * fl.side, fl.axisD[0] * fl.side];
      for (const [kk, t] of Object.entries({ out: [out[0] * 2, out[1] * 2, 0], ax1: fl.axisD.map(v => v * 1.6), ax2: fl.axisD.map(v => -v * 1.6), up: [0, 0, 1.6] })) {
        const v = hits(flapMs[j].translate(t), rigid); if (v < 0.3) errs.push(`${a.key} flap${j} not captive when moved ${kk}`);
      }
      lift.push(maxA);
    });
    if (!pt) { errs.push(`${a.key} has no port`); continue; }
    // snap: barb wider than the mouth by 0.3-0.5 mm, and the slot lets the prongs close that far
    const barbR = ringR(rigid, a.Hc + (k.uB + k.uL) / 2, 6, 'max');
    const interf = barbR - pt.test.mouthR;
    if (!(interf >= 0.3 - 1e-3 && interf <= 0.5 + 1e-3)) errs.push(`${a.key} snap interference ${interf.toFixed(3)} outside 0.3-0.5`);
    if (k.slot < 2 * interf + 0.5) errs.push(`${a.key} peg slot ${k.slot} too narrow to close ${interf.toFixed(2)}`);
    // attached: peg vs port >= fit; everything clear of every other body
    const att = rigid.transform(a.attach), attFl = flapMs.map(m => m.transform(a.attach));
    const parent = pt.test.parent;
    const gp = gapOf(att, parent, 2);
    if (hits(att, parent) > 1e-3 || gp < fit - 1e-3) errs.push(`${a.key} peg/port gap ${gp.toFixed(3)} < fit ${fit}`);
    // rigid parts never touch another body; a hinged plate that meets one in a curled print
    // pose just lifts on its hinge (a pose limit, as for the pet's own flaps)
    const meets = new Set();
    for (const o of movers) {
      if (o.m === parent) continue;
      for (const [nm, m, isFlap] of [[a.key, att, false], ...attFl.map((m, j) => [`${a.key}-flap${j}`, m, true])]) {
        const v = hits(m, o.m), g = gapOf(m, o.m, 2);
        if (v > 1e-3 || g < P.clearance * 0.9) {
          if (isFlap && P.pose !== 'straight') meets.add(o.name);
          else errs.push(`${nm} attached hits ${o.name} (gap ${g.toFixed(3)})`);
        }
      }
    }
    attFl.forEach((m, j) => { const g = gapOf(m, parent, 2); if (g < fit * 0.9) errs.push(`${a.key}-flap${j} attached gap ${g.toFixed(3)} to its body`); });
    // captive: pulled straight up (rigid peg) the barb meets the 45 deg ceiling; pushed
    // sideways the peg meets the mouth
    let pull = 0; for (const d of [0.8, 1.2, 2, 3]) pull = Math.max(pull, hits(att.translate([0, 0, d]), parent));
    const sideHit = hits(att.translate([1.0, 0, 0]), parent);
    if (pull < 0.3 || sideHit < 0.3) errs.push(`${a.key} not captive (pull ${pull.toFixed(2)} side ${sideHit.toFixed(2)})`);
    // swivel on the peg: the hat turns all the way round; wider add-ons report how far
    const ax = [a.attach[12], a.attach[13]], others = U(movers.filter(o => o.m !== parent).map(o => o.m));
    let swivel = 0;
    for (let d = 15; d <= 360; d += 15) { const r = rotZabout(att, d, ax); if (hits(r, parent) > 1e-3 || hits(r, others) > 1e-3) break; swivel = d; }
    if (a.key === 'hat' && swivel < 360) errs.push(`hat swivels only ${swivel}deg`);
    // the pet still bends fully with the add-on on: neighbours swing +-S past it
    const segIdx = res.bodies.find(b => b.port === pt).index;
    for (const J of res.joints.filter(J => J.i === segIdx - 1 || J.i === segIdx)) {
      const jw = [J.world[0] + shift[0], J.world[1] + shift[1]], dp = res.plan.delta[J.i];
      const addonMoves = segIdx > J.i;
      const otherSide = U(movers.filter(o => !o.flap && o.seg >= 0 && (addonMoves ? o.seg <= J.i : o.seg > J.i)).map(o => o.m));
      for (const tgt of [-J.S, J.S]) {
        const v = addonMoves ? hits(rotZabout(att, tgt - dp, jw), otherSide) : hits(att, rotZabout(otherSide, tgt - dp, jw));
        if (v > 1e-3) errs.push(`${a.key} blocks joint${J.i} at ${tgt}deg (${v.toFixed(2)} mm3)`);
      }
    }
    // hinged plates on the pet: from level they fold down along its sides this far
    const fold = [];
    a.flaps.forEach((fl, j) => {
      let maxA = 0;
      for (let d = 10; d <= 140; d += 10) { const m = rotAxis(flapMs[j], fl.side * d, fl.axisP, fl.axisD).transform(a.attach); if (hits(m, parent) > 1e-3 || hits(m, att) > 1e-3) break; maxA = d; }
      fold.push(maxA);
    });
    addonInfo.push(`${a.key}@${a.where}: snap ${interf.toFixed(2)} gap ${gp.toFixed(3)} swivel ${swivel}${lift.length ? ' lift ' + lift.join('/') + ' fold ' + fold.join('/') : ''}${meets.size ? ' (plates lift off ' + [...meets].join(',') + ' in this pose)' : ''}`);
  }
  const oh = movers.reduce((n, o) => n + overhangArea(o.whole), 0);
  const line = `${errs.length ? 'FAIL' : 'ok  '} ${name.padEnd(14)} ${String(ms).padStart(5)}ms bodies ${movers.length} size ${res.size.map(v => v.toFixed(0)).join('x')} gap ${minGap.toFixed(3)} swing ${swingOK}/${res.joints.length} captive ${captive}/${res.joints.length} neck>=${minNeck.toFixed(0)} weakest ${Number.isFinite(weakest) ? weakest.toFixed(0) : '-'} mouth ${res.minCapture.toFixed(2)} flaps ${flapInfo.join('/') || '-'}${flapLimited.size ? ' (flap lifts at ' + flapLimited.size + ' full bends)' : ''}${selfContact.size ? ' (curl meets itself: ' + [...selfContact].join('; ') + ')' : ''} overhang ${oh.toFixed(0)}${addonInfo.length ? '\n        ' + addonInfo.join('\n        ') : ''}`;
  if (!quiet || errs.length) console.log(line);
  for (const e of [...new Set(errs)].slice(0, 10)) console.log('      -', e);
  eng.free();
  return errs.length === 0;
}

const args = process.argv.slice(3);
let configs;
if (args[0] === '--fuzz') {
  const n = +args[1] || 20, seed = args[2] === '--seed' ? +args[3] : 1;
  configs = fuzzConfigs(n, seed, args.includes('--port'));
  const only = args.indexOf('--only');
  if (only >= 0) { const keep = args[only + 1].split(',').map(k => `fuzz${seed}-${k}`); configs = Object.fromEntries(Object.entries(configs).filter(([k]) => keep.includes(k))); }
  for (const [k, v] of Object.entries(configs)) if (only >= 0) console.log(k, JSON.stringify(v));
} else {
  if (args[0] === '--json') configs = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  else configs = args.length ? Object.fromEntries(args.map(a => [a, CONFIGS[a]])) : CONFIGS;
}
let fails = 0;
for (const [name, cfg] of Object.entries(configs)) {
  try { if (!runConfig(name, cfg)) fails++; }
  catch (e) { fails++; console.log('CRASH', name, e.message, JSON.stringify(cfg)); if (process.env.STACK) console.log(e.stack); eng.free(); }
}
console.log(fails ? `${fails} config(s) failed` : `all ${Object.keys(configs).length} configs pass`);
