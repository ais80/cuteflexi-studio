// ===== PRINTERS BEGIN =====
// Plate data read from each printer's own slicer profile (Bambu Studio / Snapmaker Orca):
// printable area, max height, prime-tower position, keep-out zones, elephant-foot setting.
const PRINTER_SPECS = {
  a1mini: {
    name: 'Bambu A1 mini', bed: [180, 180], height: 180, keepOut: [],
    tower: { x: 15, y: 141, w: 35 }, clearance: 0.35, elephantFoot: 0,
    note: 'AMS lite purges at every colour change: keep slot 4 = body colour to save filament.',
  },
  x1c: {
    name: 'Bambu X1 / P1 / A1', bed: [256, 256], height: 250, keepOut: [[0, 0, 18, 28]],
    tower: { x: 15, y: 206, w: 35 }, clearance: 0.35, elephantFoot: 0.15,
    note: 'P1/X1 cannot print in the 18 × 28 mm front-left corner; the layout avoids it on every model.',
  },
  u1: {
    name: 'Snapmaker U1', bed: [270, 270], height: 270, keepOut: [],
    tower: { x: 13, y: 214.5, w: 20 }, clearance: 0.35, elephantFoot: 0.15,
    note: 'Four toolheads: colour costs one tool change per colour per layer, no purge waste.',
  },
  generic: {
    name: 'Other printer', bed: [220, 220], height: 250, keepOut: [],
    tower: null, clearance: 0.45, elephantFoot: 0.1,
    note: 'Bowden and older printers: 0.45 mm air gap, and turn on elephant-foot compensation (0.1–0.2 mm).',
  },
};

// Fit the plan-view hull onto the plate: try rotations in 5 deg steps and positions on a
// 2 mm grid, stay 3 mm inside the edges, avoid keep-out zones and (for multi-colour
// prints) the prime tower. Prefers no rotation and the plate centre.
function placeOnPlate(hull, spec, multiColour) {
  const [W, H] = spec.bed, m = 3;
  const keep = spec.keepOut.map(r => r.slice());
  if (multiColour && spec.tower) {
    const t = spec.tower;
    keep.push([t.x - 5, t.y - 5, t.x + t.w + 5, Math.min(H, t.y + t.w * 1.4 + 5)]);
  }
  let best = null;
  for (let a = 0; a < 180; a += 5) {
    const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of hull) {
      const x = c * px - s * py, y = s * px + c * py;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const w = x1 - x0, h = y1 - y0;
    if (w > W - 2 * m || h > H - 2 * m) continue;
    for (let cx = m + w / 2; cx <= W - m - w / 2 + 1e-9; cx += 2) {
      for (let cy = m + h / 2; cy <= H - m - h / 2 + 1e-9; cy += 2) {
        const r = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
        if (keep.some(k => r[0] < k[2] && r[2] > k[0] && r[1] < k[3] && r[3] > k[1])) continue;
        const score = (cx - W / 2) ** 2 + (cy - H / 2) ** 2 + a * 4;
        if (!best || score < best.score) best = { score, angle: a, cx, cy, w, h, tx: cx - (x0 + x1) / 2, ty: cy - (y0 + y1) / 2 };
      }
    }
  }
  return best ? { fits: true, ...best, keep } : { fits: false, keep };
}
// ===== PRINTERS END =====
