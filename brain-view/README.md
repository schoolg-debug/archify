# Brain View

A single-page WebGL2 view of a notes collection drawn as a particle brain and nervous system.
Every speck belongs to a note: areas of life map to regions of the brain, and the spine is a
timeline (top = newest). The **Galaxy** button (or Space) morphs the same particles into one
spiral galaxy per group, with a glowing star for every note and lines for its links.
No dependencies and no network requests at runtime.

## Build

```bash
python3 tools/sample_data.py /tmp/sample.json      # fictional demo dataset
python3 tools/build.py /tmp/sample.json dist/brain-view.html
```

`build.py` inlines `src/` and the dataset into one self-contained HTML file. `dist/` is ignored
by git so a personal dataset never lands in the repository.

## Data format

```json
{
  "areas":   [{ "name": "Body & Health", "color": "#FD4340", "region": "cerebellum" }],
  "folders": [{ "name": "Training", "area": 0 }],
  "notes":   [{ "t": "Title", "f": 0, "d": "2026-08-22", "s": "Summary", "src": "notion", "l": [3, 9] }],
  "sources": { "notion": "Notion" }
}
```

`f` is a folder index, `l` lists linked note indices, and `region` (optional) pins an area to
the `cerebellum` or the brain `stem`.

## Capture

`node tools/shot.js dist/brain-view.html out/ main` renders frames at exact animation times in
headless Chromium (needs Playwright).

The Inter typeface in `assets/` is licensed under the SIL Open Font License.
