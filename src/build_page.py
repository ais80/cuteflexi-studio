import base64, pathlib, sys
root = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
tpl = (root / 'template.html').read_text(encoding='utf-8')
eng = (root / 'engine.js').read_text(encoding='utf-8')
wasm = base64.b64encode((root / 'node_modules/manifold-3d/manifold.wasm').read_bytes()).decode()
prn = (root / 'printers.js').read_text(encoding='utf-8')
body = tpl.replace('/*__ENGINE__*/', eng).replace('/*__PRINTERS__*/', prn).replace('__WASM_BASE64__', wasm)
(out / 'cuteflexi_studio_artifact.html').write_text(body, encoding='utf-8')
full = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')
(out / 'cuteflexi_studio.html').write_text(full, encoding='utf-8')
(out / 'index.html').write_text(full, encoding='utf-8')   # GitHub Pages entry point
print('written', len(body)//1024, 'KB')
