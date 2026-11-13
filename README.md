# Spider-Man: Rebirth

An unofficial, non-commercial fan game. This repository currently holds the **main menu**:
a real-time 3D city at first light, the 3D hero (from the project's own model) following your pointer, and a
full set of working menu screens. The game itself is the next thing to build.

## Play it

Open `index.html` in a browser. No install and no build step.

To serve it instead (handy for testing on a phone):

```bash
python3 -m http.server 8080
```

## Controls

| | Keyboard / mouse | Controller |
|---|---|---|
| Move | Arrow keys or W A S D, or point | D-pad / left stick |
| Select | Enter, Space or click | A |
| Back | Esc | B |
| Switch options tab | Q / E | LB / RB |
| Hide the menu | H | |
| Fire a web line | Click the city | |

## What is in the menu

- **Title and main menu** with a camera move between them
- **New game** with four difficulties, and **Continue** once a save exists
- **Suits**: five suits previewed live on the 3D model (three wearable, two locked)
- **Options**: volume, fullscreen, time of day (dawn, dusk, night, or your own clock),
  film grain, pointer follow, frame-rate counter, text size, high contrast, reduced motion
- **Credits** and a quit prompt
- Settings and the save are remembered in the browser

## How it is put together

| Path | What it is |
|---|---|
| `index.html`, `css/main.css` | Page shell and all menu styling |
| `js/ui.js` | Every screen and what each button does |
| `js/core/content.js` | All text and data: suits, difficulties, headlines, credits |
| `js/core/` | Settings and save storage, sound, input (keyboard, pad, touch), helpers |
| `js/scene/stage.js` | The 3D stage: sky, city, hero, lighting and camera shots |
| `js/scene/heromodel.js` | The hero: a bust baked from the project's 3D model, with its suit masks (generated) |
| `js/scene/heroart.js` | The stitched seam the Rebirth suit wears over one eye |
| `js/scene/web.js`, `js/scene/fx.js` | The corner web, fired web lines, dust and the idle spider |
| `assets/fonts/` | Spinneret, the game's own typeface |
| `tools/build_font.py` | Draws and builds Spinneret from scratch |
| `tools/hero/` | Re-bakes the hero from the source FBX and its textures |
| `vendor/three.min.js` | three.js (MIT), the only dependency |

### Where the game plugs in

Starting or continuing a game ends in `startGame()` in `js/ui.js`, which shows the
`play` screen. That screen is a placeholder: replace it with the first level. The chosen
difficulty and suit are on the save object, and the 3D stage is available as `SMR.stage`.

### Editing the typeface

```bash
pip install fonttools shapely brotli
python3 tools/build_font.py
```

### Re-baking the hero

The menu shows a bust baked from the full 3D model (`SpiderManOfficial.fbx` and its
textures, which are not stored in this repository). The arms are lowered for the portrait,
the body is cropped at the chest, and the painted textures become masks so every suit can
recolour the same model. To bake it again after changing the model:

```bash
cd tools/hero && npm install && npx playwright install chromium && cd ../..
node tools/hero/convert.js path/to/source/SpiderManOfficial.fbx build/hero
python3 tools/hero/tex_prep.py path/to/textures build/hero
python3 tools/hero/pack.py build/hero js/scene/heromodel.js
```

## Credits and legal

Spider-Man was created by Stan Lee and Steve Ditko. Spider-Man and all related characters
are trademarks of Marvel. This project is not affiliated with or endorsed by Marvel or
Sony. The hero's 3D model was supplied for this project; the city, lettering and sound were
made for it too.
