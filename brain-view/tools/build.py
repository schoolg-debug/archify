#!/usr/bin/env python3
"""Inline src/* + a dataset into one self-contained HTML file.
usage: build.py <data.json> <out.html>"""
import base64, json, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
data_path, out_path = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
font = base64.b64encode((root / 'assets' / 'inter-latin-wght-normal.woff2').read_bytes()).decode()
css = (src / 'style.css').read_text().replace('__FONT__', 'data:font/woff2;base64,' + font)
js = '\n'.join((src / f).read_text() for f in ('anatomy.js', 'engine.js', 'app.js'))
data = json.loads(data_path.read_text())
blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/').replace('<!--', '<\\!--')
html = (src / 'index.html').read_text()
html = html.replace('/*__CSS__*/', css).replace('/*__JS__*/', js.replace('</script', '<\\/script')).replace('__DATA__', blob)
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(html)
print(f'wrote {out_path} ({len(html)/1024:.0f} KB, {len(data["notes"])} notes)')
