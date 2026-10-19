// ===== FLEXI ENGINE BEGIN =====
// CSG geometry engine built on manifold-3d. Units: mm, Z up, print bed at z = 0.
// Every body is a closed solid; moving bodies never touch (gap >= clearance), and
// every overhang is 45 deg or steeper so the pet prints in place without supports.
function createFlexiEngine(wasm) {
  const { Manifold, CrossSection } = wasm;

  // --- WASM memory: every Manifold / CrossSection created is tracked and freed by free()
  const arena = new Set();
  const track = r => {
    if (Array.isArray(r)) r.forEach(track);
    else if (r && typeof r === 'object' && typeof r.delete === 'function' && typeof r.isDeleted === 'function') arena.add(r);
    return r;
  };
  if (!Manifold.__flexiTracked) {
    // wrap statics and every prototype a real instance inherits from (embind instances do
    // not always share Manifold.prototype), so no result escapes free()
    const protos = new Set();
    for (const sample of [Manifold.cube(1), CrossSection.circle(1, 8)]) {
      for (let p = Object.getPrototypeOf(sample); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) protos.add(p);
      sample.delete();
    }
    for (const cls of [Manifold, CrossSection]) protos.add(cls.prototype);
    for (const target of [...protos, Manifold, CrossSection]) {
      {
        for (const k of Object.getOwnPropertyNames(target)) {
          if (['constructor', 'delete', 'isDeleted', 'prototype', 'length', 'name', 'arguments', 'caller'].includes(k)) continue;
          const d = Object.getOwnPropertyDescriptor(target, k);
          if (!d || typeof d.value !== 'function') continue;
          const f = d.value;
          if (f.__flexiWrapped) continue;
          const g = function (...a) { return Manifold.__flexiTrack(f.apply(this, a)); };
          g.__flexiWrapped = true;
          try { target[k] = g; } catch (e) { /* read-only */ }
        }
      }
    }
    Manifold.__flexiTracked = true;
  }
  Manifold.__flexiTrack = track;
  const free = () => { for (const o of arena) { try { o.delete(); } catch (e) { /* already gone */ } } arena.clear(); };
  const CS = polys => track(new CrossSection(polys));

  // --- small maths helpers
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
  // column-major Mat4 from axes + origin
  const frame = (x, y, z, o) => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
  // basis with +Z along axis and +Y as close to world-up as possible
  function basis(axis) {
    const z = norm(axis);
    let hint = Math.abs(z[2]) > 0.97 ? [-1, 0, 0] : [0, 0, 1];
    const y = norm(sub(hint, mul(z, dot(hint, z))));
    return { x: cross(y, z), y, z };
  }
  const alignZ = (axis, origin) => { const b = basis(axis); return frame(b.x, b.y, b.z, origin); };
  const rotZ = (th, p) => { const c = Math.cos(th), s = Math.sin(th); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, p[0], p[1], 0, 1]; };

  // --- primitives
  const NEXP = 2.6;          // superellipsoid exponent: rounder-boxy "cute" bodies
  const SEGJ = 96;           // facets on joint circles (keeps faceting error << clearance)
  const REACH = 160;         // radius of the planar regions that split neighbouring bodies
  // link strength floors (mm), applied to every design. At 0.42 mm lines: a 3 mm neck is
  // 7 lines wide, a 2.6 mm ring wall 6 lines, and the lips stay >= 0.9 mm deep.
  const LINK = { rkMin: 3.2, neckMin: 3.0, wall: 2.6, eMin: 0.9, captureMin: 0.7, wb: 1.4 };
  // flap hinge (horizontal axis along the body): body knuckle | wing knuckle | body knuckle,
  // joined by 45 deg cone pins in conical pockets; knuckles are bed-standing teardrops
  const FLAP = { Rk: 4.2, Lb: 2.6, Lw: 5.2, rp: 2.0, tip: 0.4, tw: 2.4 };
  const legSeg = (i, N) => i > 0 && (i === 1 || i === N - 1 || (N >= 6 && i % 2 === 1));
  // which segment carries a hinged (moving) appendage: 'wing' | 'flipper' | null
  function flapKind(P, i, N) {
    const wingsHinged = P.hingedWings && (P.wings === 'bat' || P.wings === 'bee');
    if (wingsHinged && i === 1) return 'wing';
    if (P.hingedFlippers && P.legs === 'flippers' && legSeg(i, N) && !(wingsHinged && i === 1)) return 'flipper';
    return null;
  }
  const upper = m => m.trimByPlane([0, 0, 1], 0);          // everything sits on the bed
  function blob(a, b, h, n = NEXP, segs = 40) {
    return Manifold.sphere(1, segs).warp(v => {
      const s = Math.pow(Math.pow(Math.abs(v[0]), n) + Math.pow(Math.abs(v[1]), n) + Math.pow(Math.abs(v[2]), n), 1 / n);
      v[0] *= a / s; v[1] *= b / s; v[2] *= h / s;
    });
  }
  const dome = (a, b, h, c, n = 2.2) => upper(blob(a, b, h, n, 32).translate(c));
  const cone = (r1, r2, h, segs = 28) => Manifold.cylinder(h, r1, r2, segs);
  function sectorCS(r, a0, a1) {
    const pts = [[0, 0]];
    for (let k = 0; k <= 40; k++) { const a = (a0 + (a1 - a0) * k / 40) * D2R; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    return CS([pts]);
  }
  // ------------------------------ ACCESSORY PORT ------------------------------
  // A standard snap port lets add-ons printed later click onto a finished pet. The port is a
  // blind hole from the top of a body: a mouth, then a wider chamber under a 45 deg ceiling.
  // The add-on's split peg is pushed through the mouth (its barb is wider by the snap
  // interference, the two prongs close up), then the barb opens in the chamber and the
  // add-on swivels. Hole and peg are vertical walls, upward faces and 45 deg cones only.
  // u = distance from the add-on's base face along the peg towards its tip.
  const PEG = { rs: 2.4, fil: 0.5, land: 0.4, tip: 0.6, reach: 4.0, lead: 1.6, slot0: 0.8, wall: 1.2, floor: 2.5, facet: 0.005 };
  // the deck: footprint (port-centred) that a back add-on may use; knuckles of a wing pack
  // reach x = +-5.55 and y = +-12.9
  const DECK = { x: 6.2, y: 13 };
  function portSpec(fit) {
    const i = clamp(0.75 - fit, 0.32, 0.48);                // looser printers print fatter: less nominal snap (kept inside 0.3-0.5)
    const rs = PEG.rs, r0 = rs + fit + PEG.facet, rb = r0 + i, Rg = rb + fit + PEG.facet, rt = rs - PEG.tip;
    const uR = fit + PEG.reach, uB = uR + (rb - rs), uL = uB + PEG.land, uT = uL + (rb - rt) * PEG.lead;
    return { fit, i, rs, r0, rb, Rg, rt, uR, uB, uL, uT, slot: 2 * i + 1.0, depth: uT + fit, ceiling: uR - (Math.SQRT2 - 1) * fit };
  }
  // peg half-section in (r, u); the part above u = 0 overlaps the add-on so they fuse
  const pegProfile = k => CS([[[0, -0.6], [k.rs + PEG.fil, -0.6], [k.rs + PEG.fil, 0], [k.rs, PEG.fil], [k.rs, k.uR], [k.rb, k.uB], [k.rb, k.uL], [k.rt, k.uT], [0, k.uT]]]);
  // split peg standing on an add-on whose base face is at z = Hc (print pose: peg up)
  function pegSolid(k, Hc) {
    const slot = Manifold.cube([12, k.slot, k.uT + 2]).translate([-6, -k.slot / 2, PEG.slot0]);
    return pegProfile(k).revolve(SEGJ).subtract(slot).translate([0, 0, Hc]);
  }
  // hole in port frame (axis = z, add-on base face at z = 0, body below): the peg offset by
  // the fit, plus the chamber under the barb down to the floor
  function portCavity(k) {
    const g = k.fit + PEG.facet;                            // facet allowance: the gap never dips below the fit
    const prof = pegProfile(k).offset(g, 'Round', 2, 24)
      .add(CS([[[0, k.uL], [k.rb + g, k.uL], [k.rb + g, k.depth], [0, k.depth]]]));
    return prof.revolve(SEGJ).mirror([0, 0, 1]);
  }
  // column-major 4x4 helpers for placing add-ons
  const mmul = (a, b) => { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let q = 0; q < 4; q++) for (let k = 0; k < 4; k++) r[c * 4 + q] += a[k * 4 + q] * b[c * 4 + k]; return r; };
  const T3 = v => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
  const flipAt = Hc => [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, Hc, 1];   // print pose -> port frame
  const rigidInv = m => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0,
    -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]), -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]), -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]), 1];

  // point + outward normal on a segment's superellipsoid, along a direction from its centre
  function surf(s, dir) {
    const n = NEXP;
    const k = Math.pow(Math.pow(Math.abs(dir[0] / s.A), n) + Math.pow(Math.abs(dir[1] / s.W), n) + Math.pow(Math.abs(dir[2] / s.Hh), n), -1 / n);
    const q = mul(dir, k);
    const g = [Math.sign(q[0]) * Math.pow(Math.abs(q[0] / s.A), n - 1) / s.A,
               Math.sign(q[1]) * Math.pow(Math.abs(q[1] / s.W), n - 1) / s.W,
               Math.sign(q[2]) * Math.pow(Math.abs(q[2] / s.Hh), n - 1) / s.Hh];
    return { p: [q[0], q[1], q[2] + s.zc], n: norm(g) };
  }

  // =============================== PLAN ===============================
  // Segment sizes, joint sizes and the print pose. No geometry is created here.
  function plan(P) {
    const N = P.segments;
    const segs = [];
    for (let i = 0; i <= N; i++) {
      const head = i === 0;
      const t = head ? 1.18 : Math.max(0.62, 1 - (i / (N + 1.5)) * 0.46);
      const s = { i, t, W: 11.6 * t * P.chubby, Hh: 9.6 * t, A: head ? 12.5 : 9.8 * t, df: 0, dr: 0 };
      s.zc = 0.56 * s.Hh; s.top = 1.56 * s.Hh;
      segs.push(s);
    }
    const S = P.jointType === 'ball' ? 32 : 22;             // free swing each way, degrees
    const wide = P.jointType === 'ball';
    const hinged = segs.map(s => flapKind(P, s.i, N));
    const joints = [];
    for (let i = 0; i < N; i++) {
      const a = segs[i], b = segs[i + 1];
      const c = P.clearance;
      const pitch = 0.80 * (a.A + b.A) * (P.interlock / 1.5);
      const dr = pitch * a.A / (a.A + b.A);
      const rkT = 3.4 * P.jointBeef * (wide ? 1.12 : 1);
      // strength floors hold for every design; then grow the knob until the socket
      // mouth is at least LINK.captureMin narrower than the bulge (it cannot pop out)
      let rk = Math.max(LINK.rkMin, Math.min(rkT, 0.9 * Math.min(a.W, b.W) - c - LINK.wall));
      let e, wn, capture = 0;
      for (let k = 0; k < 60; k++) {
        e = clamp(0.24 * rk, LINK.eMin, 1.2);
        wn = clamp((wide ? 0.68 : 0.78) * rk, LINK.neckMin, 1.7 * (rk - e));
        const half = (S + 1.5) * D2R + Math.asin(Math.min(1, (wn / 2 + c) / (rk + c)));
        capture = 2 * rk - 2 * (rk + c) * Math.sin(Math.min(half, Math.PI / 2));
        if (capture >= LINK.captureMin) break;
        rk += 0.1;
      }
      const zb = 1.5 + c, wb = LINK.wb, gapB = 1.6;
      const zTop = n => zb + n * (2 * e + wb) + (n - 1) * gapB;
      const lowTop = Math.min(a.top, b.top);
      const bulges = P.jointType === 'double' && zTop(2) + c + 2.4 <= lowTop * 0.98 ? 2 : 1;
      // V-notch split: a body that carries a hinged wing/flipper keeps a full-width side
      let betaF = S / 2 + 1.5, betaB = S / 2 + 1.5;
      if (hinged[i + 1] && !hinged[i]) { betaB = 1.5; betaF = S + 1.5; }
      else if (hinged[i] && !hinged[i + 1]) { betaF = 1.5; betaB = S + 1.5; }
      const J = { i, S, betaF, betaB, c, rk, e, wn, zb, wb, gapB, bulges, dr, df: pitch - dr, capture };
      J.Rf = rk + c + LINK.wall;                             // outer radius of the socket ring (front body)
      J.Rb = J.Rf + c;                                       // rear body starts here
      J.zTop = zTop(bulges);
      J.Hc = J.zTop + c + 2.4;                               // collar height: room for the upper lip
      a.dr = dr; b.df = J.df;
      joints.push(J);
    }
    // accessory port on segment 1: the segment grows until a deck for add-ons fits between
    // its joints, clear of the front ring and the rear knob and inside its own V-notches
    const pk = portSpec(P.fit || P.clearance);
    if (P.port && N >= 2) {
      const s = segs[1], Jf = joints[0], Jr = joints[1], m = pk.fit + 0.3;
      const front = Math.max(Jf.Rb, DECK.y * Math.tan(Jf.betaB * D2R)) + m;
      const rear = Math.max(Jr.rk + Jr.c, DECK.y * Math.tan(Jr.betaF * D2R)) + m;
      const need = front + rear + 2 * DECK.x;
      if (s.df + s.dr < need) { const d = (need - s.df - s.dr) / 2; s.df += d; s.dr += d; Jf.df = s.df; Jr.dr = s.dr; }
      s.port = { where: 'back', front, rear };
      s.A = Math.max(s.A, 0.62 * (s.df + s.dr));             // longer body to carry the longer deck
    }
    if (P.headPort && N >= 1) {
      const s = segs[0], J = joints[0];
      s.port = { where: 'head', x: Math.min(0, s.dr - (J.rk + J.c) - PEG.wall - pk.Rg) };
    }
    // a body with two joints must be long enough for its neck to reach its own ring
    // without entering its rear socket; a hinged body needs room for its knuckles
    for (let i = 0; i <= N; i++) {
      const s = segs[i], Jf = joints[i - 1], Jr = joints[i];
      if (Jf && Jr) {
        const need = Jf.Rb + Jr.rk + Jr.c + 2.2;
        if (s.df + s.dr < need) {
          const k = need / (s.df + s.dr);
          s.df *= k; s.dr *= k; Jf.df = s.df; Jr.dr = s.dr;
        }
      }
      s.flapX = 0;
      if (hinged[i]) {
        // knuckle cluster sits toward the rear joint (this body's own side) and the front
        // knuckle must reach solid body outside the front neighbour's ring zone
        const half = FLAP.Lw / 2 + P.clearance + FLAP.Lb;
        if (Jr && s.dr < half + 1.6) { s.dr = half + 1.6; Jr.dr = s.dr; }
        if (Jf && s.df < half + 1.6) { s.df = half + 1.6; Jf.df = s.df; }
        if (Jr) s.flapX = s.dr - 0.6 - half;
        if (Jf) {
          const yBody = s.W * Math.pow(1 - Math.pow(0.56, NEXP), 1 / NEXP) - 1.5, keep = Jf.Rb + 0.8;
          const req = yBody < keep ? half - s.flapX + Math.sqrt(keep * keep - yBody * yBody) : 0;
          if (s.df < req) { s.df = req; Jf.df = req; }
        }
      }
    }
    segs.forEach((s, i) => { s.flap = hinged[i]; });
    // the back port sits in the middle of the free stretch (after any knuckle stretching)
    if (segs[1] && segs[1].port) segs[1].port.x = (-segs[1].df + segs[1].port.front + segs[1].dr - segs[1].port.rear) / 2;
    for (const J of joints) {
      const b = segs[J.i + 1], Jr = joints[J.i + 1];
      J.neckLen = Jr ? Math.max(J.Rb + 1.2, b.df + b.dr - (Jr.rk + Jr.c + 0.9)) : J.Rb + 3.5;
    }
    // print pose: relative yaw at each joint, always inside the free swing
    const delta = joints.map((J, i) => {
      if (P.pose === 'scurve') return 0.72 * J.S * Math.sin(1.25 * i + 0.9);
      if (P.pose === 'spiral') return 0.80 * J.S;
      return 0;
    });
    segs[0].pos = [0, 0]; segs[0].th = 0;
    for (let i = 0; i < N; i++) {
      const a = segs[i], b = segs[i + 1];
      const jw = [a.pos[0] + Math.cos(a.th) * a.dr, a.pos[1] + Math.sin(a.th) * a.dr];
      joints[i].world = jw;
      b.th = a.th + delta[i] * D2R;
      b.pos = [jw[0] + Math.cos(b.th) * b.df, jw[1] + Math.sin(b.th) * b.df];
    }
    return { segs, joints, delta, S };
  }

  // ============================ JOINT PARTS ============================
  // Print-in-place barrel hinge, vertical axis. The rear body owns a knob (radius rk with
  // one or two 45 deg bulges) on a neck; the front body owns the socket ring around it.
  // Socket = knob profile offset by the clearance, so every gap is >= c and every
  // overhang is a 45 deg cone. The bulge is trapped between two lips, so it cannot lift
  // out, and the ring wraps > 180 deg, so it cannot pull out sideways.
  function knobProfile(J) {
    const { rk, e, wb, gapB } = J;
    const pts = [[0, 0], [rk - e - 0.4, 0], [rk - e, 0.4]];
    let z = J.zb;
    for (let b = 0; b < J.bulges; b++) {
      pts.push([rk - e, z], [rk, z + e], [rk, z + e + wb], [rk - e, z + 2 * e + wb]);
      z += 2 * e + wb + gapB;
    }
    pts.push([rk - e, 300], [0, 300]);
    return CS([pts]);
  }
  const knobSolid = J => knobProfile(J).revolve(SEGJ);
  function cavitySolid(J) {
    const r0 = J.rk - J.e + J.c;
    const flare = CS([[[0, -1], [r0 + 0.5, -1], [r0 + 0.5, 0], [r0, 0.5], [0, 0.5]]]);   // first-layer relief
    return knobProfile(J).offset(J.c, 'Round', 2, 24).add(flare).revolve(SEGJ);
  }
  function neckSolid(J) {
    const L = J.neckLen;
    const bot = Manifold.cube([L, J.wn - 0.8, 0.01]).translate([0, -(J.wn - 0.8) / 2, 0]);
    const top = Manifold.cube([L, J.wn, 300]).translate([0, -J.wn / 2, 0.4]);
    return Manifold.hull([bot, top]);                         // 45 deg foot: no elephant-foot weld
  }
  function slotCS(J, extra) {
    const hw = J.wn / 2 + J.c + extra, len = J.Rf + 6, a = J.S + 1.5;
    const rects = [];
    for (let k = -3; k <= 3; k++) rects.push(CrossSection.square([len, 2 * hw]).translate([0, -hw]).rotate(a * k / 3));
    return CrossSection.hull(rects);
  }
  function slotSolid(J) {
    const main = slotCS(J, 0).extrude(302).translate([0, 0, -1]);
    const foot = Manifold.hull([slotCS(J, 0.45).extrude(1).translate([0, 0, -1]), slotCS(J, 0).extrude(0.01).translate([0, 0, 0.45])]);
    return main.add(foot);
  }
  // keeps the neck full collar height even where the body envelope dips between segments
  const neckCap = J => Manifold.cube([J.neckLen, J.wn + 2, J.Hc]).translate([0, -(J.wn + 2) / 2, 0]);

  // ------------------------------ FLAP HINGE ------------------------------
  // Built in segment-local coordinates for one side (sd = +1 left / -1 right). Returns the
  // body-side parts to add (knuckles, webs, cone pins), the clearance to cut from the body,
  // the moving appendage (knuckle + flat plate on the bed) and its hinge axis.
  function flapHinge(P, s, sd, kind) {
    const c = P.clearance, R = FLAP.Rk, za = R, Lw = FLAP.Lw, Lb = FLAP.Lb;
    const halfBed = s.W * Math.pow(1 - Math.pow(0.56, NEXP), 1 / NEXP);
    const ya = sd * (halfBed + R - 1.0);
    // bed-standing teardrop: round top, 45 deg flanks, flat foot -> no overhang past 45 deg
    const prof = CrossSection.hull([CrossSection.circle(R, 48).translate([0, za]), CrossSection.square([0.828 * R, 0.01]).translate([-0.414 * R, 0])]);
    const alongX = (cs, x0, x1) => cs.extrude(x1 - x0).transform(frame([0, 1, 0], [0, 0, 1], [1, 0, 0], [x0, ya, 0]));
    // 45 deg relief on knuckle ends at the bed so the first layer cannot weld across the gap
    const wedge0 = CS([[[-0.01, -1], [1.5, -1], [0.5, 0], [0, 0.5], [-0.01, 0.5]]]).extrude(60).transform(frame([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, ya + 30, 0]));
    const wedge = (xe, dir) => (dir > 0 ? wedge0 : wedge0.mirror([1, 0, 0])).translate([xe, 0, 0]);
    const xw0 = -Lw / 2, xw1 = Lw / 2, xb0 = xw0 - c, xb1 = xw1 + c;
    // body knuckles with webs into the body side
    const webU = sd > 0 ? [-(R + 3.5), 0] : [0, R + 3.5];
    const web = CrossSection.square([R + 3.5, za + 0.5 * R]).translate([webU[0], 0]);
    const bk = prof.add(web);
    let bodyAdd = Manifold.union([alongX(bk, xb0 - Lb, xb0), alongX(bk, xb1, xb1 + Lb)]);
    bodyAdd = bodyAdd.subtract(Manifold.union([wedge(xb0, -1), wedge(xb1, 1)]));
    const coneZ = Manifold.cylinder(0.6, FLAP.rp, FLAP.rp, 40).translate([0, 0, -0.6]).add(Manifold.cylinder(FLAP.rp - FLAP.tip, FLAP.rp, FLAP.tip, 40));
    const pocketZ = CS([[[0, -1.2], [FLAP.rp, -1.2], [FLAP.rp, 0], [FLAP.tip, FLAP.rp - FLAP.tip], [0, FLAP.rp - FLAP.tip]]]).offset(c, 'Round', 2, 24).revolve(40);
    const atL = m => m.transform(frame([0, 1, 0], [0, 0, 1], [1, 0, 0], [xb0, ya, za]));
    const atR = m => m.transform(frame([0, -1, 0], [0, 0, 1], [-1, 0, 0], [xb1, ya, za]));
    bodyAdd = bodyAdd.add(atL(coneZ)).add(atR(coneZ));
    // the moving knuckle and its flat plate
    const knuckle = alongX(prof, xw0, xw1);
    const sweepR = 1.082 * R + c;                                   // radius the moving knuckle sweeps
    const uMin = Math.sqrt(Math.pow(sweepR + 0.3, 2) - Math.pow(za - FLAP.tw, 2));
    let shape;
    if (kind === 'wing' && P.wings === 'bat') {
      shape = CS([[[-7, 0], [7, 0], [9, 8], [10, 17], [6.5, 13.5], [3, 19], [0, 14.5], [-3, 19], [-6.5, 13.5], [-10, 17], [-9, 8]]]);
    } else if (kind === 'wing') {
      const lobe = k => CrossSection.hull([CrossSection.circle(1, 40).scale([5.5, 8.5]).rotate(k * 20).translate([k * 3.6, 11]), CrossSection.square([6, 1]).translate([-3, 2])]);
      shape = lobe(-1).add(lobe(1));
    } else {
      shape = CrossSection.hull([CrossSection.circle(1, 40).scale([4.2, 6.5]).translate([0, 10]), CrossSection.square([5, 1]).translate([-2.5, 2])]);
    }
    const plate2 = shape.intersect(CrossSection.square([60, 60]).translate([-30, uMin]))
      .add(CrossSection.square([Lw, uMin + 1.0]).translate([-Lw / 2, 0]));
    const plate = plate2.extrude(FLAP.tw).transform(frame([1, 0, 0], [0, sd, 0], [0, 0, sd], [0, ya, sd > 0 ? 0 : FLAP.tw]));
    // pockets and first-layer chamfers are cut last so the plate cannot refill them
    const part = knuckle.add(plate).subtract(Manifold.union([wedge(xw0, 1), wedge(xw1, -1), atL(pocketZ), atR(pocketZ)]));
    const clearance = Manifold.cylinder(xb1 - xb0, sweepR, sweepR, 64).transform(frame([0, 1, 0], [0, 0, 1], [1, 0, 0], [xb0, ya, za]));
    const xc = s.flapX || 0;
    return { bodyAdd: bodyAdd.translate([xc, 0, 0]), clearance: clearance.translate([xc, 0, 0]), part: part.translate([xc, 0, 0]), axisP: [xc, ya, za], axisD: [1, 0, 0], side: sd };
  }

  function collarSolid(J) {
    const r = 1.6, pts = [[0, 0], [J.Rf, 0], [J.Rf, J.Hc - r]];
    for (let k = 1; k <= 6; k++) { const a = k / 6 * Math.PI / 2; pts.push([J.Rf - r + r * Math.cos(a), J.Hc - r + r * Math.sin(a)]); }
    pts.push([0, J.Hc]);
    return CS([pts]).revolve(SEGJ);
  }
  // planar territory of the front (F) and rear (B) body around a joint, in joint frame (+x = rearward)
  const regionF = J => CrossSection.circle(J.Rf, SEGJ).add(sectorCS(REACH, 90 + J.betaF, 270 - J.betaF));
  const regionB = J => sectorCS(REACH, -(90 - J.betaB), 90 - J.betaB).subtract(CrossSection.circle(J.Rb, SEGJ));

  // ============================== FEATURES ==============================
  // Head / limb / tail ornaments in segment-local coordinates (+x = towards tail).
  // Slots: 1 body, 2 accents, 3 eyes, 4 joints & hardware.
  function features(P, s, N, f, holes, kit) {
    const i = s.i, head = i === 0, last = i === N;
    const kitMode = P.colorMode === 'kit', single = P.colorMode === 'single';
    const atSurf = (dir, sink, axis) => { const r = surf(s, dir); return { p: r.p, n: r.n, base: sub(r.p, mul(axis || r.n, sink)) }; };

    if (head) {
      let noseX = -0.99 * s.A;
      const snout = P.head === 'dragon' || P.head === 'trex';
      if (snout) {
        const sa = 8.5, sw = 0.70 * s.W, sh = 0.62 * s.Hh, cx = -0.78 * s.A;
        f[1].push(dome(sa, sw, sh, [cx, 0, 0.35 * sh], 2.4));
        noseX = Math.min(noseX, cx - sa);
      }
      // ---- head ornaments
      for (const sd of [-1, 1]) {
        if (P.head === 'dragon') {
          const axis = norm([0.38, 0.22 * sd, 0.9]);
          const { base } = atSurf([0.15 * s.A, 0.5 * s.W * sd, 0.85 * s.Hh], 3, axis);
          if (kitMode) { f[1].push(Manifold.cylinder(6.6, 1.4, 1.4, 24).transform(alignZ(axis, base))); if (sd > 0) kit.push({ type: 'horn', count: 2 }); }
          else f[2].push(cone(2.8, 0.7, 14).transform(alignZ(axis, base)));
        } else if (P.head === 'cat') {
          const axis = norm([0.1, 0.25 * sd, 0.96]);
          const { base } = atSurf([0.05 * s.A, 0.55 * s.W * sd, 0.83 * s.Hh], 2.5, axis);
          f[2].push(Manifold.cylinder(12, 4.6, 0.6, 4).rotate([0, 0, 45]).transform(alignZ(axis, base)));
        } else if (P.head === 'bunny') {
          const axis = norm([0.42, 0.18 * sd, 0.89]);
          const { base } = atSurf([0.25 * s.A, 0.4 * s.W * sd, 0.88 * s.Hh], 2.0, axis);
          f[2].push(Manifold.hull([Manifold.sphere(2.5, 24), Manifold.sphere(2.2, 24).translate([0, 0, 13])]).transform(alignZ(axis, base)));
        } else if (P.head === 'bee') {
          const axis = norm([0.1, 0.36 * sd, 0.93]);
          const { base } = atSurf([-0.1 * s.A, 0.35 * s.W * sd, 0.93 * s.Hh], 1.5, axis);
          f[3].push(Manifold.cylinder(9.5, 0.95, 0.95, 16).transform(alignZ(axis, base)));
          const T = add(base, mul(axis, 10.5));
          f[2].push(Manifold.hull([Manifold.sphere(2.0, 24).translate(T), Manifold.sphere(0.9, 16).translate(sub(T, [0, 0, 1.556]))]));
        } else if (P.head === 'axolotl') {
          [14, 28, 41].forEach((tilt, k) => {
            const axis = norm([0.12, Math.sin(tilt * D2R) * sd, Math.cos(tilt * D2R)]);
            const { base } = atSurf([0.15 * s.A, 0.78 * s.W * sd, (0.35 + 0.2 * k) * s.Hh], 1.6, axis);
            f[2].push(Manifold.hull([Manifold.sphere(1.45, 16), Manifold.sphere(1.15, 16).translate([0, 0, 6.8])]).transform(alignZ(axis, base)));
          });
        }
      }
      if (P.head === 'narwhal') {
        const axis = norm([-0.57, 0, 0.82]);
        const { base } = atSurf([-0.6 * s.A, 0, 0.8 * s.Hh], 3, axis);
        if (kitMode) { f[1].push(Manifold.cylinder(6.6, 1.4, 1.4, 24).transform(alignZ(axis, base))); kit.push({ type: 'tusk', count: 1 }); }
        else f[2].push(cone(2.3, 0.4, 19).transform(alignZ(axis, base)));
      } else if (P.head === 'trex' && !s.port) {             // the crest gives way to a head port
        for (const k of [-0.35, 0, 0.35]) {
          const { p } = surf(s, [k * s.A, 0, s.Hh]);
          f[2].push(cone(2.3, 0.4, 7).translate(sub(p, [0, 0, 1.5])));
        }
      }

      // ---- eyes
      const eyeDirs = P.eyes === 'cyclops' ? [[0, snout ? 20 : 12]] : [[-30, snout ? 22 : 12], [30, snout ? 22 : 12]];
      for (const [az, el] of eyeDirs) {
        const sd = Math.sign(az) || 1;
        const dir = [-Math.cos(el * D2R) * Math.cos(az * D2R) * s.A, Math.cos(el * D2R) * Math.sin(az * D2R) * s.W, Math.sin(el * D2R) * s.Hh];
        const { p, n } = surf(s, dir);
        const B = basis(n);
        const inEye = (m, x, y, z) => m.translate([x, y, z]).transform(frame(B.x, B.y, B.z, p));
        const big = P.eyes === 'cyclops';
        const domeEye = big || P.eyes === 'kawaii' || P.eyes === 'angry';
        if (kitMode && domeEye) {
          const peg = CrossSection.hull([CrossSection.circle(1.25, 24), CrossSection.circle(0.05, 4).translate([0, -1.25 * Math.SQRT2])]);
          f[1].push(peg.extrude(3.6).translate([0, 0, -1.2]).transform(frame(B.x, B.y, B.z, p)));
          kit.push({ type: big ? 'eyeBig' : 'eye', count: 1 });
          continue;
        }
        const ring = (R, slot) => f[slot].push(inEye(CrossSection.circle(0.6, 16).translate([R, 0]).revolve(48), 0, 0, -0.15));
        if (P.eyes === 'kawaii' || big) {
          const r = big ? 4.6 : 3.4, pr = big ? 1.7 : 1.3;
          const C = sub(p, mul(n, r - pr));
          f[big ? 2 : 3].push(Manifold.sphere(r, 40).translate(C));
          if (big) f[3].push(Manifold.sphere(2.5, 32).translate(add(C, mul(n, r - 2.5 + 0.7))));
          else if (!single) f[2].push(Manifold.sphere(0.95, 16).translate(add(C, mul(norm(add(add(n, mul(B.y, 0.5)), mul(B.x, 0.3 * sd))), r - 0.3))));
          if (single) ring(Math.sqrt(r * r - (r - pr) * (r - pr)) + 0.45, 1);
        } else if (P.eyes === 'happy') {
          f[3].push(inEye(CrossSection.circle(0.75, 16).translate([2.3, 0]).revolve(40, 180), 0, 0, 0.05));
        } else if (P.eyes === 'angry') {
          f[3].push(Manifold.sphere(3.0, 32).translate(sub(p, mul(n, 3.0 - 1.1))));
          f[2].push(inEye(Manifold.cube([6.6, 1.5, 3.2], true).rotate([0, 0, -sd * 22]), sd * 0.4, 3.5, -0.5));
        } else if (P.eyes === 'sleepy') {
          f[3].push(inEye(Manifold.cube([6.4, 1.4, 3.0], true), 0, 0.3, -0.5));
        }
      }

      // ---- keychain loop: flat ring on the bed in front of the nose
      if (P.keychain) {
        const cx = noseX - 4.8 + 2.0;
        f[4].push(CrossSection.circle(4.8, 48).subtract(CrossSection.circle(2.25, 40)).extrude(3.2).translate([cx, 0, 0]));
        holes.push(Manifold.cylinder(6, 2.25, 2.25, 40).translate([cx, 0, -1]));
      }
    }

    // ---- legs
    if (!head && P.legs !== 'none' && legSeg(i, N) && !s.flap) {
      for (const sd of [-1, 1]) {
        const y = sd * 0.8 * s.W;
        if (P.legs === 'claws') {
          f[2].push(dome(5.6, 4.6, 5.0, [0, y, 0]));
          for (const k of [-1, 0, 1]) f[2].push(dome(2.0, 1.4, 2.2, [-5.0, y + k * 1.9, 0]));
        } else if (P.legs === 'paws') {
          f[2].push(dome(5.0, 5.0, 4.2, [0, y, 0]));
          for (const k of [-1, 0, 1]) f[2].push(dome(1.5, 1.5, 1.4, [-4.6, y + k * 2.0, 0]));
        } else if (P.legs === 'flippers') {
          f[2].push(upper(blob(8.6, 4.4, 2.8, 2.2, 32).rotate([0, 0, sd * 25]).translate([1, sd * 0.9 * s.W, 0])));
        }
      }
    }

    // ---- wings / spikes (plates lean <= 40 deg from vertical, edges face up or sideways)
    // a back port takes segment 1's top: its spike is left off, fixed wings move to segment 2
    const wingSeg = P.port && N >= 2 ? 2 : 1, wingsHinged = P.hingedWings && (P.wings === 'bat' || P.wings === 'bee');
    if (!head && P.wings === 'spikes' && !(s.port && s.port.where === 'back')) {
      const { p } = surf(s, [0, 0, s.Hh]);
      f[2].push(cone(2.6 * s.t, 0.5, 6.5 * s.t + 1.5).translate(sub(p, [0, 0, 1.5])));
    } else if (i === wingSeg && (P.wings === 'bat' || P.wings === 'bee') && !wingsHinged) {
      for (const sd of [-1, 1]) {
        const lean = (P.wings === 'bat' ? 35 : 40) * D2R;
        const w = [0, sd * Math.sin(lean), Math.cos(lean)], x = [1, 0, 0], nrm = cross(x, w);
        const root = sub(surf(s, [0, sd * 0.55 * s.W, 0.85 * s.Hh]).p, mul(w, 3.5));
        let shape, th;
        if (P.wings === 'bat') {
          shape = CS([[[-6.5, 0], [6.5, 0], [8.5, 9], [9.5, 15], [6.5, 12.5], [3.5, 16], [1, 13], [-2, 16.5], [-4.5, 12.5], [-7.5, 14], [-7.5, 7]]]);
          th = 2.2;
        } else {
          const lobe = k => CrossSection.hull([CrossSection.circle(1, 32).scale([6.0, 8.5]).rotate(k * 18).translate([k * 3.2, 9]), CrossSection.square([7, 0.5]).translate([-3.5, 0])]);
          shape = lobe(-1).add(lobe(1));
          th = 1.8;
        }
        f[2].push(shape.extrude(th).translate([0, 0, -th / 2]).transform(frame(x, w, nrm, root)));
      }
    }

    // ---- tail (lies on the bed: domes, half-cones and flat plates only)
    if (last) {
      const x0 = 0.45 * s.A, xr = 0.9 * s.A;
      const halfCone = (len, r1, r2) => upper(cone(r1, r2, len, 32).rotate([0, 90, 0]).translate([x0, 0, 0]));
      if (P.tail === 'spade') {
        f[2].push(halfCone(13, 4.0, 1.6));
        f[2].push(CrossSection.hull([CrossSection.circle(3.3, 32).translate([2.6, 3.0]), CrossSection.circle(3.3, 32).translate([2.6, -3.0]), CrossSection.circle(0.7, 12).translate([11, 0])]).extrude(3.0).translate([x0 + 10.5, 0, 0]));
      } else if (P.tail === 'cat') {
        const r0 = 7.3, w = 2.1, a0 = -95, a1 = 175;
        let curl = CrossSection.circle(r0 + w, 64).subtract(CrossSection.circle(r0 - w, 64)).intersect(sectorCS(r0 + w + 1, a0, a1));
        for (const a of [a0, a1]) curl = curl.add(CrossSection.circle(w, 24).translate([r0 * Math.cos(a * D2R), r0 * Math.sin(a * D2R)]));
        // start of the curl sits 2 mm inside the body's rounded end so it always fuses on
        f[2].push(curl.translate([xr - 2.0, 7.0]).extrude(4.8));
      } else if (P.tail === 'puff') {
        f[2].push(upper(Manifold.sphere(5.4, 40).translate([xr + 2.2, 0, 3.0])));
      } else if (P.tail === 'fluke') {
        f[2].push(halfCone(9, 3.4, 1.8));
        const lobe = sd => CrossSection.circle(1, 32).scale([5.6, 3.0]).rotate(sd * 35).translate([x0 + 12.2, sd * 3.4]);
        f[2].push(lobe(-1).add(lobe(1)).extrude(2.6));
      } else if (P.tail === 'stinger') {
        f[3].push(halfCone(10.5, 3.0, 0.25));
      }
    }

    // ---- 6x2 mm magnet wells: real blind holes from the bed (6.2 mm, 2.2 deep; roof bridges)
    if (P.magnets && (head || last || i === Math.floor((N + 1) / 2))) {
      holes.push(Manifold.cylinder(3.2, 3.1, 3.1, 48).translate([0, 0, -1]));
    }
  }

  // separate press-fit pieces for the no-AMS kit (flat base on the bed, blind hole from below)
  function kitPiece(type) {
    const fit = 0.15;
    if (type === 'eye' || type === 'eyeBig') {
      const r = type === 'eyeBig' ? 4.6 : 3.4;
      const body = Manifold.cylinder(1.0, r, r, 48).add(dome(r, r, 2.6, [0, 0, 1.0], 2));
      const tear = CrossSection.hull([CrossSection.circle(1.25, 24), CrossSection.circle(0.05, 4).translate([0, -1.25 * Math.SQRT2])]).offset(fit, 'Round', 2, 16);
      return { slot: 3, m: body.subtract(tear.extrude(3.6).translate([0, 0, -1])) };
    }
    const r = 1.4 + fit, d = 3.9;
    const hole = Manifold.cylinder(d + 1, r, r, 32).translate([0, 0, -1]).add(cone(r, 0.01, r, 32).translate([0, 0, d]));
    const body = type === 'horn' ? cone(2.8, 0.7, 10.5) : cone(3.0, 0.4, 15);
    return { slot: 2, m: body.subtract(hole) };
  }

  // ============================ PORTS & ADD-ONS ============================
  const roundRect = (w, h, r) => CrossSection.square([w - 2 * r, h - 2 * r], true).offset(r, 'Round', 2, 16);
  // Where the port goes on one finished body (segment-local, before the cuts): base face
  // height, the deck add-ons may cover, room for a round add-on, body width under a saddle.
  function portSite(P, s, reg, rear, solids) {
    const k = portSpec(P.fit || P.clearance), m = k.fit + 0.3, px = s.port.x, back = s.port.where === 'back';
    const all = Manifold.union(solids.filter(Boolean)).transform(rigidInv(rotZ(s.th, s.pos)));
    // deck: own territory less the neighbour's knob column, shrunk by fit + margin
    let deck0 = reg.translate([-px, 0]);
    if (back && rear) deck0 = deck0.subtract(CrossSection.circle(rear.rk + rear.c, SEGJ).translate([s.dr - px, 0]));
    deck0 = deck0.offset(-m, 'Round', 2, 16);
    // base face sits one fit above the highest point under it (the deck on the back, the
    // crown round the axis on the head, whose ears and horns then limit the hat instead)
    const probe = back ? deck0.extrude(400).translate([px, 0, -100]) : Manifold.cylinder(400, 5, 5, 48).translate([px, 0, -100]);
    const near = all.intersect(probe);
    const zTop = near.isEmpty() ? s.top : near.boundingBox().max[2], zB = zTop + k.fit;
    let deck = deck0;
    const above = all.trimByPlane([0, 0, 1], zTop + 0.02);
    if (!above.isEmpty()) deck = deck.subtract(above.translate([-px, 0, 0]).project().offset(m, 'Round', 2, 16));
    let lo = 0, hi = 30;                                    // largest port-centred disc on the deck
    for (let it = 0; it < 14; it++) { const r = (lo + hi) / 2; if (CrossSection.circle(r, 48).subtract(deck).area() < 1e-3) lo = r; else hi = r; }
    // widest the body gets in the band a saddle's side flaps hang over
    const band = all.translate([-px, 0, -zB]).intersect(Manifold.cube([2 * SADDLE.L + 2, 200, SADDLE.hang + 0.5]).translate([-SADDLE.L - 1, -100, -(k.fit + SADDLE.hang + 0.5)]));
    const bb = band.isEmpty() ? null : band.boundingBox();
    const sideY = bb ? Math.max(-bb.min[1], bb.max[1]) : s.W;
    // the hole keeps a wall all round inside this body's own territory and a floor above the bed
    const hole = CrossSection.circle(k.Rg + PEG.wall, 48).translate([px, 0]);
    const inside = hole.subtract(reg).area() < 1e-3 && !(back && rear && Math.hypot(s.dr - px, 0) < rear.rk + rear.c + k.Rg + PEG.wall);
    const why = !inside ? 'no room between the joints' : zB - k.depth < PEG.floor ? 'body too low' : lo < k.rs + PEG.fil + 1.6 ? 'ornaments in the way' : '';
    return { ok: !why, why, where: s.port.where, k, px, zB, zTop, deck, freeR: lo, sideY, cavity: portCavity(k).translate([px, 0, zB]) };
  }

  const HUB = { hw: 5.5, Lh: 6.2, r: 2.0, ch: 1.6 };
  const SADDLE = { L: 7.5, tp: 2.4, hang: 4.0, tf: 1.8 };
  // One snap-on add-on in its print pose: flat face on the bed, peg standing up from the
  // face that will rest on the pet (z = Hc). attach maps it onto its port on the pet.
  function makeAddon(P, key, site) {
    if (!site) return null;
    const k = site.k, parts = {}, flaps = [];
    let Hc, name;
    if (key === 'hat') {
      // top hat: crown on the bed, brim with a 45 deg underside, as wide as the head allows
      const rB = Math.min(7.5, site.freeR), rc = Math.max(k.rs + PEG.fil + 1.0, rB - 2.4), tb = 1.0;
      Hc = 8 + tb;
      const prof = CS([[[0, 0], [rc, 0], [rc, Hc - tb - (rB - rc)], [rB, Hc - tb], [rB, Hc], [0, Hc]]]);
      parts[2] = prof.revolve(SEGJ).add(pegSolid(k, Hc));
      name = 'Top hat';
    } else if (key === 'wings' || key === 'fins') {
      // hub with the same print-in-place cone-pin hinges as the hinged wings; flipped onto
      // the pet the plates lie level and fold down along its sides
      Hc = 2 * FLAP.Rk + 0.4;
      const kb = Math.pow(1 - Math.pow(0.56, NEXP), 1 / NEXP);
      const fs = { W: HUB.hw / kb, flapX: 0 }, fp = { clearance: k.fit, wings: P.wings === 'bee' ? 'bee' : 'bat' };
      // 45 deg roof on the long top edges: the knuckle sweep would otherwise undercut them
      const hw = HUB.hw, ch = HUB.ch, y1 = hw + 1;
      const roof = CS([[[-y1, -1], [y1, -1], [y1, Hc - ch - 1], [hw - ch, Hc], [-(hw - ch), Hc], [-y1, Hc - ch - 1]]])
        .extrude(40).transform(frame([0, 1, 0], [0, 0, 1], [1, 0, 0], [-20, 0, 0]));
      let hub = roundRect(2 * HUB.Lh, 2 * hw, HUB.r).intersect(site.deck).extrude(Hc).intersect(roof);
      for (const sd of [1, -1]) {
        const h = flapHinge(fp, fs, sd, key === 'wings' ? 'wing' : 'flipper');
        hub = hub.subtract(h.clearance).add(h.bodyAdd);
        flaps.push({ side: sd, axisP: h.axisP, axisD: h.axisD, parts: { 2: h.part } });
      }
      parts[1] = hub.add(pegSolid(k, Hc));
      name = key === 'wings' ? (fp.wings === 'bee' ? 'Fairy wings' : 'Dragon wings') : 'Fins';
    } else if (key === 'saddle') {
      // flat seat with side flaps that hang one fit clear of the body
      Hc = SADDLE.tp;
      const yf = site.sideY + k.fit + 0.3, w = yf + SADDLE.tf;
      const outline = roundRect(2 * SADDLE.L, 2 * w, 3).intersect(site.deck);
      const bands = CrossSection.square([60, SADDLE.tf]).translate([-30, yf]).add(CrossSection.square([60, SADDLE.tf]).translate([-30, -w]));
      parts[2] = outline.extrude(Hc).add(outline.intersect(bands).extrude(Hc + SADDLE.hang)).add(pegSolid(k, Hc));
      name = 'Saddle';
    } else return null;
    for (const s of Object.keys(parts)) parts[s] = clean(parts[s]);
    return { key, name, where: site.where, seg: site.seg, Hc, parts, flaps, k, attach: mmul(site.toPet, flipAt(Hc)) };
  }
  // add-on pack: print poses side by side along x, centred on the origin
  function layoutPack(addons) {
    if (!addons.length) return null;
    let x = 0;
    for (const a of addons) {
      const bb = bounds([...Object.values(a.parts), ...a.flaps.flatMap(f => Object.values(f.parts))]);
      a.packOffset = [x - bb.min[0], -(bb.min[1] + bb.max[1]) / 2];
      x += bb.max[0] - bb.min[0] + 6;
    }
    for (const a of addons) a.packOffset[0] -= (x - 6) / 2;
    const all = addons.flatMap(a => [...Object.values(a.parts), ...a.flaps.flatMap(f => Object.values(f.parts))].map(m => m.translate([a.packOffset[0], a.packOffset[1], 0])));
    const ps = Manifold.hull(all);
    const b = ps.boundingBox();
    return { footprint: ps.project().toPolygons()[0] || [], size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2]] };
  }

  // =============================== BUILD ===============================
  function build(P) {
    const pl = plan(P);
    const { segs, joints } = pl;
    const N = segs.length - 1;
    const toW = (m, s) => m.transform(rotZ(s.th, s.pos));

    const E = segs.map(s => toW(upper(blob(s.A, s.W, s.Hh).translate([0, 0, s.zc])), s));
    const collar = joints.map(J => toW(collarSolid(J).translate([J.dr, 0, 0]), segs[J.i]));
    const kitReq = [];
    const out = [];

    for (const s of segs) {
      const i = s.i, front = joints[i - 1], rear = joints[i];
      // territory of this body: never overlaps a neighbour at any angle inside the swing
      let reg = null;
      if (front) reg = regionB(front).translate([-s.df, 0]);
      if (rear) { const r = regionF(rear).translate([s.dr, 0]); reg = reg ? reg.intersect(r) : r; }
      const region = toW(reg.extrude(320).translate([0, 0, -10]), s);
      const env = Manifold.union([E[i - 1], E[i], E[i + 1], collar[i - 1], collar[i]].filter(Boolean));

      const f = { 1: [], 2: [], 3: [], 4: [] }, holes = [];
      features(P, s, N, f, holes, kitReq);
      const W = list => list.length ? toW(Manifold.union(list), s) : null;

      // stripes: a full-depth colour band (AMS) or a raised band (single spool)
      const striped = (P.head === 'bee' || P.segments >= 7) && i > 0 && i % 2 === 1;
      let stripe = null;
      if (striped) {
        const slab = Manifold.cube([0.9 * s.A, 200, 300], true).translate([0, 0, 140]);
        if (P.colorMode === 'single') f[1].push(upper(blob(s.A, s.W * 1.06 + 0.4, s.Hh * 1.06).translate([0, 0, s.zc])).intersect(slab));
        else stripe = toW(upper(blob(s.A, s.W, s.Hh).translate([0, 0, s.zc])).intersect(slab), s);
      }

      let body = Manifold.union([env, W(f[1])].filter(Boolean)).intersect(region);
      let acc = [W(f[2]), stripe].filter(Boolean);
      acc = acc.length ? Manifold.union(acc).intersect(region) : null;
      let eyes = W(f[3]); if (eyes) eyes = eyes.intersect(region);
      let hw = W(f[4]); if (hw) hw = hw.intersect(region);

      let link = null;
      if (front) {
        const k = toW(knobSolid(front).add(neckSolid(front)).translate([-s.df, 0, 0]), s);
        link = k.intersect(env.add(toW(neckCap(front).translate([-s.df, 0, 0]), s)));
      }
      // hinged wings / flippers: knuckles join the body, the moving plate is its own body
      const flaps = [];
      if (s.flap) {
        for (const sd of [1, -1]) {
          const h = flapHinge(P, s, sd, s.flap);
          const clr = toW(h.clearance, s);
          body = body.subtract(clr);
          if (acc) acc = acc.subtract(clr);
          if (eyes) eyes = eyes.subtract(clr);
          if (hw) hw = hw.subtract(clr);
          body = body.add(toW(h.bodyAdd, s).intersect(region));
          const c0 = Math.cos(s.th), s0 = Math.sin(s.th);
          flaps.push({
            parent: i, side: sd, m: toW(h.part, s).intersect(region),
            axisP: [s.pos[0] + c0 * h.axisP[0] - s0 * h.axisP[1], s.pos[1] + s0 * h.axisP[0] + c0 * h.axisP[1], h.axisP[2]],
            axisD: [c0, s0, 0],
          });
        }
      }
      const cuts = [];
      if (rear) cuts.push(toW(cavitySolid(rear).add(slotSolid(rear)).translate([s.dr, 0, 0]), s));
      // accessory port: measured on the finished body, then cut with everything else
      let port = null;
      if (s.port) {
        port = portSite(P, s, reg, rear, [body, acc, eyes, hw, link]);
        port.seg = i;
        if (port.ok) { port.plug = toW(port.cavity, s); cuts.push(port.plug); }
      }
      for (const h of holes) cuts.push(toW(h, s));
      if (cuts.length) {
        const cu = Manifold.union(cuts);
        body = body.subtract(cu);
        if (acc) acc = acc.subtract(cu);
        if (eyes) eyes = eyes.subtract(cu);
        if (hw) hw = hw.subtract(cu);
        if (link) link = link.subtract(cu);
      }
      let joint = [link, hw].filter(Boolean);
      joint = joint.length ? Manifold.union(joint) : null;

      // make colour parts disjoint: eyes > accents > joint hardware > body
      if (acc && eyes) acc = acc.subtract(eyes);
      if (joint) { if (eyes) joint = joint.subtract(eyes); if (acc) joint = joint.subtract(acc); }
      for (const o of [eyes, acc, joint]) if (o) body = body.subtract(o);
      let parts = { 1: body, 2: acc, 3: eyes, 4: joint };
      if (P.colorMode === 'single' || P.colorMode === 'layer') parts = { 1: Manifold.union(Object.values(parts).filter(Boolean)) };
      for (const k of Object.keys(parts)) {
        if (parts[k]) parts[k] = clean(parts[k]);
        if (!parts[k] || parts[k].isEmpty()) delete parts[k];
      }
      const flapSlot = P.colorMode === 'ams' ? 2 : 1;
      out.push({
        index: i, th: s.th, pos: s.pos.slice(), parts, port,
        flaps: flaps.map(fl => ({ ...fl, kind: s.flap, parts: { [flapSlot]: clean(fl.m) } })),
      });
    }

    // each body is one connected solid: drop fragments a curled pose can leave behind
    for (const o of out) {
      const pcs = Manifold.union(Object.values(o.parts)).decompose();
      if (pcs.length > 1) {
        const total = pcs.reduce((n, p) => n + Math.abs(p.volume()), 0);
        // real fragments only: zero-volume slivers from touching colour parts would each get a
        // box cut, and a hundred of those riddle the body with tunnels
        const junk = pcs.filter(p => Math.abs(p.volume()) > 1e-3 && Math.abs(p.volume()) < 0.02 * total);
        if (junk.length) {
          const cut = Manifold.union(junk.map(p => p.boundingBox()).map(b => Manifold.cube([b.max[0] - b.min[0] + 0.02, b.max[1] - b.min[1] + 0.02, b.max[2] - b.min[2] + 0.02]).translate([b.min[0] - 0.01, b.min[1] - 0.01, b.min[2] - 0.01])));
          const main = pcs.filter(p => !junk.includes(p));
          for (const k of Object.keys(o.parts)) {
            const keep = o.parts[k].subtract(cut).add(o.parts[k].intersect(cut).intersect(Manifold.union(main)));
            o.parts[k] = clean(keep);
            if (!o.parts[k] || o.parts[k].isEmpty()) delete o.parts[k];
          }
        }
      }
    }
    // hinged plates lie flat at print time: trim each one (in plan) so it keeps the air gap
    // to every body except its own parent, then keep only the piece that holds the knuckle
    const allFlaps = out.flatMap(o => o.flaps);
    for (const fl of allFlaps) {
      const fb = bounds(Object.values(fl.parts)), pad = P.clearance + 1;
      const near = m => { const b = m.boundingBox(); return b.min[0] < fb.max[0] + pad && b.max[0] > fb.min[0] - pad && b.min[1] < fb.max[1] + pad && b.max[1] > fb.min[1] - pad; };
      const others = [];
      for (const o of out) {
        // a port's own cavity solid fills the hole for projecting: same outline, and project()
        // on the hole's many steep facets can take minutes
        if (o.index !== fl.parent) others.push(...Object.values(o.parts).filter(near), ...(o.port && o.port.plug ? [o.port.plug] : []));
        for (const g of o.flaps) if (g !== fl && g.trimmed) others.push(...Object.values(g.parts).filter(near));
      }
      if (others.length) {
        const keepOut = Manifold.union(others).project().offset(P.clearance + 0.25, 'Round', 2, 16).extrude(320).translate([0, 0, -10]);
        for (const k of Object.keys(fl.parts)) {
          const pcs = fl.parts[k].subtract(keepOut).decompose();
          pcs.sort((a, b) => b.volume() - a.volume());
          fl.parts[k] = pcs[0];
        }
      }
      fl.trimmed = true;
    }

    // kit tray beside the pet
    const kit = [];
    const petParts = () => out.flatMap(o => [...Object.values(o.parts), ...o.flaps.flatMap(fl => Object.values(fl.parts))]);
    let bb = bounds(petParts());
    let ky = bb.min[1] + 4, kx = bb.max[0] + 10;
    for (const req of kitReq) {
      for (let c = 0; c < req.count; c++) {
        const pc = kitPiece(req.type);
        const pb = pc.m.boundingBox();
        const w = pb.max[1] - pb.min[1];
        kit.push({ name: req.type, slot: pc.slot, m: pc.m.translate([kx - pb.min[0], ky - pb.min[1], 0]) });
        ky += w + 4;
        if (ky > bb.max[1]) { ky = bb.min[1] + 4; kx += 14; }
      }
    }

    // centre everything on the origin
    bb = bounds([...petParts(), ...kit.map(k => k.m)]);
    const shift = [-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, 0];
    for (const o of out) {
      for (const k of Object.keys(o.parts)) o.parts[k] = o.parts[k].translate(shift);
      o.pos = [o.pos[0] + shift[0], o.pos[1] + shift[1]];
      for (const fl of o.flaps) {
        for (const k of Object.keys(fl.parts)) fl.parts[k] = fl.parts[k].translate(shift);
        fl.axisP = [fl.axisP[0] + shift[0], fl.axisP[1] + shift[1], fl.axisP[2]];
        delete fl.m;
      }
    }
    for (const k of kit) k.m = k.m.translate(shift);
    // ports: port frame (axis = z, add-on base face at z = 0) -> pet coordinates
    const ports = {};
    for (const o of out) {
      if (!o.port) continue;
      const s = segs[o.index];
      o.port.toPet = mmul(T3(shift), mmul(rotZ(s.th, s.pos), T3([o.port.px, 0, o.port.zB])));
      if (o.port.ok) ports[o.port.where] = o.port;
    }
    const addons = [];
    for (const key of P.addons || []) {
      const a = makeAddon(P, key, key === 'hat' ? (ports.head || ports.back) : ports.back);
      if (a) addons.push(a);
    }
    const pack = layoutPack(addons.filter(a => (P.pack || P.addons).includes(a.key)));
    const everything = [...petParts(), ...kit.map(k => k.m)];
    bb = bounds(everything);
    // plan-view outline (convex hull) for fitting the print onto each printer's plate
    // hull of every part's points: same outline as projecting the union, without the boolean
    // union (tens of seconds on some curled poses)
    const footprint = Manifold.hull(everything).project().toPolygons()[0] || [];

    const maxTop = Math.max(...out.map(o => o.parts[1].boundingBox().max[2]));
    const minNeck = Math.min(...joints.map(J => J.wn * J.Hc));
    return {
      bodies: out, kit, joints, plan: pl, bounds: bb, footprint, shift, ports, addons, pack,
      size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]],
      layerChangeZ: Math.max(0.4, Math.round(maxTop * 0.58 / 0.2) * 0.2),
      neckArea: minNeck, swing: pl.S, minCapture: Math.min(...joints.map(J => J.capture)),
    };
  }

  // drop zero-volume slivers left by coplanar cuts
  function clean(m) {
    const pcs = m.decompose();
    if (pcs.length <= 1) return m;
    const keep = pcs.filter(p => Math.abs(p.volume()) > 0.5);
    return keep.length ? Manifold.compose(keep) : null;
  }

  function bounds(ms) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const m of ms) {
      const b = m.boundingBox();
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
    }
    return { min, max };
  }

  // segment-local -> world transform for any set of joint angles (used by the wiggle preview)
  function poseTransforms(pl, delta) {
    const { segs } = pl;
    const res = [{ th: 0, pos: [0, 0] }];
    for (let i = 0; i < segs.length - 1; i++) {
      const a = res[i], sa = segs[i], sb = segs[i + 1];
      const jw = [a.pos[0] + Math.cos(a.th) * sa.dr, a.pos[1] + Math.sin(a.th) * sa.dr];
      const th = a.th + delta[i] * D2R;
      res.push({ th, pos: [jw[0] + Math.cos(th) * sb.df, jw[1] + Math.sin(th) * sb.df] });
    }
    return res;
  }

  function toMesh(m) {
    const g = m.getMesh();
    const np = g.numProp, vp = g.vertProperties, n = vp.length / np;
    const pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { pos[3 * k] = vp[np * k]; pos[3 * k + 1] = vp[np * k + 1]; pos[3 * k + 2] = vp[np * k + 2]; }
    return { positions: pos, indices: new Uint32Array(g.triVerts) };
  }

  return { build, plan, poseTransforms, toMesh, free, wasm };
}
// ===== FLEXI ENGINE END =====

// ===== 3MF WRITER BEGIN =====
// Core-spec 3MF (meshes inline, one object per printable thing, parts as components)
// plus Metadata/model_settings.config mapping each part to a filament slot. Opens in
// Bambu Studio, OrcaSlicer and Snapmaker Orca; no printer settings are embedded, so the
// slicer keeps your own printer, filament and process presets.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function deflateRaw(data) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate-raw');
  const out = new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(await out);
}
async function zipFiles(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw);
    const z = await deflateRaw(raw);
    const method = z && z.length < raw.length ? 8 : 0;
    const body = method ? z : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((n, c) => n + c.length, 0);
  const res = new Uint8Array(total);
  let p = 0;
  for (const c of all) { res.set(c, p); p += c.length; }
  return res;
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNum = v => { const s = v.toFixed(4); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

// objects: [{ name, position:[x,y], parts:[{ name, extruder, positions:Float32Array, indices:Uint32Array }] }]
// placement: { angle (deg about Z), tx, ty } maps the pet's own coordinates onto the plate;
// without it everything is centred on bedCenter.
// objectSettings: per-object slicer overrides written into model_settings.config (Bambu Studio
// and Orca read them), e.g. { brim_type: 'no_brim', enable_support: '0' }.
async function build3MF({ title, objects, bedCenter, layerChange, placement, objectSettings }) {
  const objCfg = Object.entries(objectSettings || {}).map(([k, v]) => `    <metadata key="${xmlEsc(k)}" value="${xmlEsc(v)}"/>\n`).join('');
  const pl = placement || { angle: 0, tx: bedCenter[0], ty: bedCenter[1] };
  const ca = Math.cos(pl.angle * Math.PI / 180), sa = Math.sin(pl.angle * Math.PI / 180);
  let nextId = 1;
  const meshXml = [], compXml = [], items = [], settings = [];
  for (const obj of objects) {
    const comps = [], partCfg = [];
    for (const part of obj.parts) {
      const id = nextId++;
      const v = part.positions, t = part.indices;
      const s = [` <object id="${id}" type="model">\n  <mesh>\n   <vertices>\n`];
      for (let k = 0; k < v.length; k += 3) s.push(`    <vertex x="${fmtNum(v[k])}" y="${fmtNum(v[k + 1])}" z="${fmtNum(v[k + 2])}"/>\n`);
      s.push('   </vertices>\n   <triangles>\n');
      for (let k = 0; k < t.length; k += 3) s.push(`    <triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>\n`);
      s.push('   </triangles>\n  </mesh>\n </object>\n');
      meshXml.push(s.join(''));
      comps.push(`   <component objectid="${id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n`);
      partCfg.push(`    <part id="${id}" subtype="normal_part">\n      <metadata key="name" value="${xmlEsc(part.name)}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="extruder" value="${part.extruder}"/>\n    </part>\n`);
    }
    obj.id = 10000 + nextId++;
    compXml.push(` <object id="${obj.id}" type="model">\n  <components>\n${comps.join('')}  </components>\n </object>\n`);
    const x = pl.tx + ca * obj.position[0] - sa * obj.position[1], y = pl.ty + sa * obj.position[0] + ca * obj.position[1];
    items.push(`  <item objectid="${obj.id}" transform="${fmtNum(ca)} ${fmtNum(sa)} 0 ${fmtNum(-sa)} ${fmtNum(ca)} 0 0 0 1 ${fmtNum(x)} ${fmtNum(y)} 0" printable="1"/>\n`);
    settings.push(`  <object id="${obj.id}">\n    <metadata key="name" value="${xmlEsc(obj.name)}"/>\n    <metadata key="extruder" value="${obj.parts[0].extruder}"/>\n${objCfg}${partCfg.join('')}  </object>\n`);
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <metadata name="Title">${xmlEsc(title)}</metadata>\n <metadata name="Application">CuteFlexi Studio</metadata>\n <resources>\n${meshXml.join('')}${compXml.join('')} </resources>\n <build>\n${items.join('')} </build>\n</model>\n`;
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n' },
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/model_settings.config', data: `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${settings.join('')}</config>\n` },
  ];
  if (layerChange) {
    files.push({ name: 'Metadata/custom_gcode_per_layer.xml', data: `<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer>\n<plate>\n<plate_info id="1"/>\n<layer top_z="${fmtNum(layerChange.z)}" type="0" extruder="1" color="${xmlEsc(layerChange.color)}" extra="" gcode="M600"/>\n<mode value="SingleExtruder"/>\n</plate>\n</custom_gcodes_per_layer>\n` });
  }
  return zipFiles(files);
}
// ===== 3MF WRITER END =====
