"""Slice the page's own add-on pack 3MF (several objects, per-object no_brim) with a real printer
config added, and report what reached the G-code: objects, brim, first-layer extent.
Usage: python slice_real_pack.py <pack.3mf> <printer: a1|u1> <outdir>"""
import json, os, re, sys, zipfile
import printer_check as pc

src, printer, out = sys.argv[1:4]
cfg = pc.bambu_config(os.path.join(pc.DL, 'lithophane.3mf')) if printer == 'a1' else json.loads(zipfile.ZipFile(pc.U1_TEMPLATE).read('Metadata/project_settings.config'))
os.makedirs(out, exist_ok=True)
dst = os.path.join(out, f'pack_{printer}.3mf')
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zo:
    for n in zi.namelist():
        zo.writestr(n, zi.read(n))
    zo.writestr('Metadata/project_settings.config', json.dumps(cfg, indent=1))   # brim left at the profile's own setting
code, log, g = pc.slice_file(dst, os.path.join(out, f'gcode_{printer}'))
if not g:
    print('SLICE FAILED', code, log[-600:]); sys.exit(1)
text = open(g, encoding='utf-8', errors='replace').read()
objs = sorted(set(re.findall(r'EXCLUDE_OBJECT_DEFINE NAME=(\S+)', text)) | set(re.findall(r'; printing object (.+)', text)))
brim = len(re.findall(r'^;\s*FEATURE:\s*Brim', text, re.M)) + len(re.findall(r'^;TYPE:Brim', text, re.M))
xs, ys = [], []
for z, x0, y0, x1, y1 in pc.extrusions(g):
    if z > 0.25: break
    xs += [x0, x1]; ys += [y0, y1]
print('profile brim_type:', cfg.get('brim_type'), '| objects in G-code:', len(objs), objs)
print('brim sections:', brim, '| first layer x %.1f-%.1f y %.1f-%.1f' % (min(xs), max(xs), min(ys), max(ys)), '|', pc.stats(g))
