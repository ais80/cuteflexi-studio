"""Slice every design on every printer's real profile and check the G-code.

For each printer: build a stripped 3MF (placed geometry + that printer's full project config),
slice it with the Snapmaker Orca CLI, then read the G-code back and check that no extrusion
line runs inside any hinge air gap (knob/socket bands per layer, flap knuckle gaps), that it
sliced inside the plate, and record time and filament.
Usage: python printer_check.py <workdir> [--addons] [--only=Bambu A1,Snapmaker U1] <design-name>=<cfg-json> ...
  --addons  slice the snap-on add-on pack of each design (export_addons.mjs) instead of the pet
"""
import json, math, os, re, subprocess, sys, zipfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.expanduser(r'~\Downloads')
ORCA = r'C:\Program Files\Snapmaker_Orca\snapmaker-orca.exe'
DATADIR = os.path.expandvars(r'%APPDATA%\Snapmaker_Orca')
PROFILES = r'C:\Program Files\Snapmaker_Orca\resources\profiles'
U1_TEMPLATE = os.path.join(DL, r'asif-brick-system\out\arsenal_home\3mf\arsenal_home_Snapmaker_U1.3mf')

PRINTERS = {   # name -> (spec key in printers.js, config source)
    'Bambu A1':      ('x1c', ('bambu', os.path.join(DL, 'lithophane.3mf'))),
    'Bambu P1P/X1':  ('x1c', ('bambu', os.path.join(DL, 'lithophane (1).3mf'))),
    'Bambu A1 mini': ('a1mini', ('bambu', os.path.join(DL, 'spinning_top_ground_v04_all_on+one+plate_color.3mf'))),
    'Snapmaker U1':  ('u1', ('u1', U1_TEMPLATE)),
    'Ender-3 V3':    ('generic', ('creality', 'Creality Ender-3 V3 0.4 nozzle|0.20mm Standard @Creality Ender3V3 0.4 nozzle|Creality Generic PLA @Ender-3V3-all')),
}


def bambu_config(path):
    """Bambu Studio 2.x project config made acceptable to the 1.10-engine CLI (recipe from
    hollow-lantern/check/strip_slice_bambu.py): restamp version, replace 'auto' values,
    blank the Bambu G-code templates the old engine cannot parse."""
    cfg = json.loads(zipfile.ZipFile(path).read('Metadata/project_settings.config'))
    cfg['version'] = '01.10.01.50'
    for k, v in {'raft_first_layer_expansion': '2', 'solid_infill_filament': '1', 'sparse_infill_filament': '1',
                 'tree_support_wall_count': '0', 'wall_filament': '1'}.items():
        if k in cfg:
            cfg[k] = v if not isinstance(cfg[k], list) else [v] * len(cfg[k])
    for k in list(cfg):
        if k.endswith('_gcode') and isinstance(cfg[k], str):
            cfg[k] = ''
    cfg['machine_start_gcode'] = 'G28\nM83\nG92 E0'
    cfg['layer_change_gcode'] = 'G92 E0'
    cfg['enable_support'] = '0'
    return cfg


def preset(vendor, kind, name):
    p = os.path.join(PROFILES, vendor, kind, name + '.json')
    if not os.path.isfile(p):
        return {}
    d = json.load(open(p, encoding='utf-8'))
    base = preset(vendor, kind, d['inherits']) if d.get('inherits') else {}
    base.update(d)
    return base


def creality_config(spec):
    """A complete single-extruder config: the U1 project config as the key skeleton, every
    machine/process/filament value replaced from the flattened Creality presets, and every
    per-extruder / per-filament list cut to one entry."""
    m, pr, fi = spec.split('|')
    base = json.loads(zipfile.ZipFile(U1_TEMPLATE).read('Metadata/project_settings.config'))
    over = {}
    for kind, name in (('machine', m), ('process', pr), ('filament', fi)):
        over.update({k: v for k, v in preset('Creality', kind, name).items() if k not in ('inherits', 'name', 'from', 'instantiation', 'setting_id', 'type')})
    cfg = dict(base)
    for k, v in cfg.items():
        if isinstance(v, list) and len(v) == 4:
            cfg[k] = v[:1]
    cfg.update(over)
    for k in list(cfg):
        if k.endswith('_gcode') and isinstance(cfg[k], str):
            cfg[k] = ''
    cfg.update({'machine_start_gcode': 'G28\nM83\nG92 E0', 'layer_change_gcode': 'G92 E0', 'enable_prime_tower': '0',
                'printer_settings_id': m, 'print_settings_id': pr, 'filament_settings_id': [fi], 'filament_colour': ['#FFFFFF'],
                'enable_support': '0', 'printer_model': 'Creality Ender-3 V3', 'single_extruder_multi_material': '1'})
    return cfg


def make_3mf(out, tris, cfg):
    v = tris.reshape(-1, 3)
    uniq, inv = np.unique(np.round(v, 5), axis=0, return_inverse=True)
    t = inv.reshape(-1, 3)
    vs = ''.join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in uniq)
    ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in t)
    model = ('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
             '<resources>\n<object id="1" type="model"><mesh><vertices>' + vs + '</vertices><triangles>' + ts + '</triangles></mesh></object>\n'
             '</resources>\n<build>\n<item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n</build>\n</model>\n')
    ct = ('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
          ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
          ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels); z.writestr('3D/3dmodel.model', model)
        z.writestr('Metadata/project_settings.config', json.dumps(cfg, indent=1))


def slice_file(path, outdir):
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run([ORCA, '--datadir', DATADIR, '--arrange', '0', '--outputdir', outdir, '--slice', '0', path], capture_output=True, text=True, errors='replace', timeout=1200)
    g = [os.path.join(outdir, f) for f in os.listdir(outdir) if f.endswith('.gcode')]
    return r.returncode, (r.stdout + r.stderr)[-1500:], (g[0] if g else None)


def extrusions(gcode):
    """Yield (z, x0, y0, x1, y1) for every extruding move, arcs split into short chords."""
    z, x, y, e_abs, relative, last_e = 0.0, 0.0, 0.0, False, True, 0.0
    num = re.compile(r'([XYZEIJ])(-?\d*\.?\d+)')
    with open(gcode, encoding='utf-8', errors='replace') as f:
        for line in f:
            if line.startswith(';Z:'):
                z = float(line[3:]); continue
            if line.startswith('; Z_HEIGHT:'):
                z = float(line.split(':')[1]); continue
            if line.startswith('M82'): relative = False; continue
            if line.startswith('M83'): relative = True; continue
            if line.startswith('G92'):
                last_e = 0.0; continue
            if not (line.startswith('G1') or line.startswith('G0') or line.startswith('G2') or line.startswith('G3')):
                continue
            code = line.split(';')[0]
            p = dict((k, float(v)) for k, v in num.findall(code))
            nx, ny = p.get('X', x), p.get('Y', y)
            ext = False
            if 'E' in p:
                ext = p['E'] > 1e-6 if relative else p['E'] - last_e > 1e-6
                if not relative: last_e = p['E']
            if ext and (nx != x or ny != y):
                if line.startswith('G2') or line.startswith('G3'):
                    cx, cy = x + p.get('I', 0), y + p.get('J', 0)
                    a0, a1 = math.atan2(y - cy, x - cx), math.atan2(ny - cy, nx - cx)
                    cw = line.startswith('G2')
                    if cw and a1 >= a0: a1 -= 2 * math.pi
                    if not cw and a1 <= a0: a1 += 2 * math.pi
                    r = math.hypot(x - cx, y - cy); n = max(2, int(abs(a1 - a0) * r / 0.2))
                    px, py = x, y
                    for k in range(1, n + 1):
                        a = a0 + (a1 - a0) * k / n
                        qx, qy = cx + r * math.cos(a), cy + r * math.sin(a)
                        yield z, px, py, qx, qy; px, py = qx, qy
                else:
                    yield z, x, y, nx, ny
            x, y = nx, ny


def check_gcode(gcode, design, sx=0.0, sy=0.0):
    """Count extrusion centre-lines that run inside a hinge air gap."""
    bad, worst, layers = [], 0, set()
    J = design['joints']; F = design['flaps']; fl = design['flap']; c = design['clearance']
    for z, x0, y0, x1, y1 in extrusions(gcode):
        x0, y0, x1, y1 = x0 + sx, y0 + sy, x1 + sx, y1 + sy
        layers.add(round(z, 2))
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / 0.1))
        for j in J:
            # radial band where only air may be at this height
            zb, e, rk, wb = j['zb'], j['e'], j['rk'], j['wb']
            band = None
            if z <= 0.25:
                band = (rk - e - 0.3 + 0.03, rk - e + c + 0.35 - 0.03)
            elif 0.6 < z < zb - 0.1:
                band = (rk - e + 0.03, rk - e + c - 0.03)
            else:
                for b in range(j['bulges']):
                    z0 = zb + b * (2 * e + wb + j['gapB'])
                    if z0 + e + 0.1 < z < z0 + e + wb - 0.1:
                        band = (rk + 0.03, rk + c - 0.03)
            if not band:
                continue
            jx, jy = j['p']; dx, dy = j['dirB']
            if min(math.hypot(x0 - jx, y0 - jy), math.hypot(x1 - jx, y1 - jy)) > j['Rf'] + L + 1:
                continue
            for k in range(n + 1):
                px, py = x0 + (x1 - x0) * k / n - jx, y0 + (y1 - y0) * k / n - jy
                r = math.hypot(px, py)
                if band[0] < r < band[1]:
                    along, across = px * dx + py * dy, abs(-px * dy + py * dx)
                    if along > 0 and across < j['wn'] / 2 + c + 0.3:
                        continue                                   # the neck crosses the gap here by design
                    bad.append(('joint', j['i'], round(z, 2), round(r, 3))); break
        for f in F:
            if z > 2 * fl['Rk']:
                continue
            ax, ay, _ = f['p']; dx, dy = f['d']
            for k in range(n + 1):
                px, py = x0 + (x1 - x0) * k / n - ax, y0 + (y1 - y0) * k / n - ay
                a, u = px * dx + py * dy, abs(-px * dy + py * dx)
                # only inside the knuckles' own cross-section at this height (teardrop: 45 deg
                # flanks from a 0.83R foot), where nothing but the two knuckles and air may be
                R = fl['Rk']
                half = (min(R, 0.414 * R + z) if z <= R else math.sqrt(max(0.0, R * R - (z - R) ** 2))) - 0.1
                in_pin = math.hypot(u, z - fl['Rk']) < 2.0 + 0.15      # the 45 deg cone pin crosses this gap by design
                if u < half and not in_pin and fl['Lw'] / 2 + 0.03 < abs(a) < fl['Lw'] / 2 + c - 0.03:
                    bad.append(('flap', f['parent'], round(z, 2), round(a, 3))); break
    return bad, len(layers)


def registration(gcode, tris, pl):
    """Find the (dx, dy) that best lays the first-layer G-code onto the model's own first-layer
    outline (searching +-3 mm), and the share of extrusion that then lands on the model.
    Proves the slicer printed the pet where the 3MF placed it, unrotated; the shift itself
    is printer-specific (e.g. the P1P profile's 2 mm extruder offset)."""
    import trimesh
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from shapely import contains_xy
    if isinstance(tris, list):   # exact outline polygons from the exporter (layer1.json)
        area = unary_union([Polygon(p).buffer(0) for p in tris if len(p) > 2]).buffer(0.05)
    else:
        m = trimesh.Trimesh(tris.reshape(-1, 3), np.arange(len(tris) // 3).reshape(-1, 3), process=True)
        sec = m.section(plane_origin=[0, 0, 0.1], plane_normal=[0, 0, 1])
        area = unary_union([Polygon(e[:, :2]).buffer(0) for e in sec.discrete if len(e) > 3]).buffer(0.05)
    x0, y0 = pl['cx'] - pl['w'] / 2 - 6, pl['cy'] - pl['h'] / 2 - 6
    x1, y1 = pl['cx'] + pl['w'] / 2 + 6, pl['cy'] + pl['h'] / 2 + 6
    pts = []
    for z, a, b, c, d in extrusions(gcode):
        if z > 0.25: break
        L = math.hypot(c - a, d - b); n = max(1, int(L / 0.5))
        for k in range(n + 1):
            px, py = a + (c - a) * k / n, b + (d - b) * k / n
            if x0 < px < x1 and y0 < py < y1: pts.append((px, py))
    P = np.array(pts)
    best = (0, 0, 0)
    for dx in np.arange(-3, 3.01, 0.25):
        for dy in np.arange(-3, 3.01, 0.25):
            r = contains_xy(area, P[:, 0] + dx, P[:, 1] + dy).mean() - 1e-4 * math.hypot(dx, dy)
            if r > best[0]: best = (r, dx, dy)
    return best


def stats(gcode):
    out = {}
    with open(gcode, encoding='utf-8', errors='replace') as f:
        for line in f:
            if 'estimated printing time (normal mode)' in line or 'model printing time' in line:
                out['time'] = line.split('=')[-1].strip().split(';')[0]
            if line.startswith('; filament used [g]'):
                out['grams'] = line.split('=')[-1].strip()
    return out


def recheck(work):
    """Re-run the G-code checks on an existing run directory without re-slicing."""
    for d in sorted(os.listdir(work)):
        dd = os.path.join(work, d)
        if not os.path.isfile(os.path.join(dd, 'design.json')): continue
        design = json.load(open(os.path.join(dd, 'design.json')))
        if not design.get('fits'): print(d, 'does not fit'); continue
        g = [os.path.join(dd, 'out', f) for f in os.listdir(os.path.join(dd, 'out'))] if os.path.isdir(os.path.join(dd, 'out')) else []
        g = [x for x in g if x.endswith('.gcode')]
        if not g: print(d, 'no gcode'); continue
        sy = 2.0 if d.endswith('P1PX1') else 0.0
        bad, nl = check_gcode(g[0], design, 0.0, sy)
        print(f'{d:28s} gap violations {len(bad)}', bad[:3] if bad else '', f'layers {nl}', stats(g[0]))


def main():
    if sys.argv[1] == '--recheck':
        return recheck(sys.argv[2])
    work = sys.argv[1]
    flags = [a for a in sys.argv[2:] if a.startswith('--')]
    addons = '--addons' in flags
    only = next((f.split('=', 1)[1].split(',') for f in flags if f.startswith('--only=')), None)
    designs = dict(a.split('=', 1) for a in sys.argv[2:] if not a.startswith('--'))
    exporter = 'export_addons.mjs' if addons else 'export_design.mjs'
    printers = {k: v for k, v in PRINTERS.items() if not only or k in only}
    cfgs = {}
    for pname, (key, (kind, src)) in printers.items():
        cfgs[pname] = bambu_config(src) if kind == 'bambu' else creality_config(src) if kind == 'creality' else json.loads(zipfile.ZipFile(src).read('Metadata/project_settings.config'))
    rows = []
    for pname, (key, _) in printers.items():
        for dname, cfg in designs.items():
            d = os.path.join(work, f'{key}_{dname}_{pname.split()[-1].replace("/", "")}')
            cmd = ['node', os.path.join(HERE, exporter), os.path.join(HERE, 'engine.js'), os.path.join(HERE, 'printers.js'), key, d, cfg]
            if addons:
                cmd.append(os.path.join(d, 'pack.3mf'))   # the page's own export, for slicer load checks
            r = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE)
            if r.returncode:
                print(r.stdout, r.stderr); raise SystemExit(f'{exporter} failed for {dname}')
            design = json.load(open(os.path.join(d, 'design.json')))
            if not design['fits']:
                rows.append((pname, dname, 'does not fit', '', '', '', '')); continue
            tris = np.fromfile(os.path.join(d, 'mesh.bin'), dtype=np.float32)
            # the exported 3MF sets brim off per object (verified honoured by the slicer); these
            # stripped test copies carry no per-object settings, so set it on the project
            pc = dict(cfgs[pname]); pc['brim_type'] = 'no_brim'
            f3 = os.path.join(d, 'check.3mf'); make_3mf(f3, tris, pc)
            code, log, g = slice_file(f3, os.path.join(d, 'out'))
            if not g:
                rows.append((pname, dname, f'SLICE FAILED ({code})', log.strip().splitlines()[-1] if log.strip() else '', '', '', '')); continue
            # the G-code must sit where the placement put the pet (no recentring by the slicer)
            pl = design['placement']
            l1 = os.path.join(d, 'layer1.json')
            reg, rx, ry = registration(g, json.load(open(l1)) if os.path.isfile(l1) else tris, pl)
            # G-code -> plate: undo the profile's own nozzle offset (P1P: 2 mm in Y)
            ox, oy = (float(v) for v in str(cfgs[pname].get('extruder_offset', ['0x0'])[0]).split('x'))
            sx, sy = ox, oy
            bad, nl = check_gcode(g, design, sx, sy)
            st = stats(g)
            rows.append((pname, dname, 'ok' if not bad and reg > 0.95 else 'CHECK', f"angle {pl['angle']} at ({pl['cx']:.0f},{pl['cy']:.0f})",
                         f'gap violations {len(bad)}' + (f' e.g. {bad[:3]}' if bad else ''), f"layers {nl}  {st.get('grams', '?')} g  {st.get('time', '?')}", f'on-model {reg*100:.1f}% (best fit {rx:+.2f},{ry:+.2f}; nozzle offset {sx:+.1f},{sy:+.1f})'))
            print(' | '.join(rows[-1]), flush=True)
    print('\nSUMMARY')
    for r in rows:
        print(' | '.join(r))


if __name__ == '__main__':
    main()
