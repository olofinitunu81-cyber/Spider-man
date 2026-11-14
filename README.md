# Spider-Man: Rebirth

An unofficial, non-commercial fan game: a full main menu and **Chapter one, "Stitches"**, a
playable swing through Midtown at dawn. Swing through the rings to get your swing back, catch
three of the Daily Bugle's runaway camera drones, then land on the Bugle's roof.

## Play it

Open `index.html` in a browser. No install and no build step.

To serve it instead (handy for testing on a phone):

```bash
python3 -m http.server 8080
```

## Controls

In chapter one (click the game once so the mouse steers the camera). The layout follows the
usual PC controls for this kind of game:

| | Keyboard / mouse | Controller |
|---|---|---|
| Move / look | W A S D / mouse | Left stick / right stick |
| Walk | Hold Left Alt | Hold L3 |
| Swing (in the air) / sprint | Hold Left Shift | Hold RT |
| Jump (hold for higher, tap again on the way up to flip higher still); in the air, web-zip | Space | A |
| Zip to the point you aim at | C | RB |
| Perch on that point, or dive | X | LB |
| Air trick | T | R3 |
| Melee | Left click | X |
| Web-strike (zip in and catch a drone) | F | Y |
| Dodge | Left Ctrl or mouse button 4 | B |
| Aim / yank | Hold right mouse / Q | Hold LT / RB |
| Heal (uses Focus) / finisher (full Focus) | 1 / 2 | D-pad up / down |
| Gadget (web bomb) | E | D-pad left |
| Map / scan | Tab / V | View / D-pad right |
| Pause / photo mode / high contrast | Esc / P / G | Start |

Run into a wall to cling to it, then crawl any way you push (toward the wall is up, away is
down); hold Left Shift to run up the wall, or along it. Space jumps off. Jump up under a roof or
the bridge deck and he sticks to the underside to crawl along it; Space drops. Melee strings a
five-hit combo (jab, cross, front kick, uppercut, spinning kick) if you keep clicking.
Ctrl+W is the browser's close-tab shortcut, so tap Left Ctrl to dodge rather than holding it
(in fullscreen the game keeps it).

In the menu:

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
| `tools/anim/` | Previews the hero's animations and exports them (glTF and three.js JSON) |
| `assets/anim/` | The exported animations: `hero_animations.glb` and `hero_animations.json` |
| `vendor/three.min.js` | three.js (MIT), the only dependency |

### The game

New game or Continue starts chapter one (`js/game/`). It draws every frame the screen allows
and adjusts its own render resolution to hold 100 fps (or the screen's rate, if that is lower);
turn on Options → Display → Frame rate counter to watch it.

| Path | What it is |
|---|---|
| `js/game/game.js` | Renderer, frame loop, input, camera, HUD, pause and results |
| `js/game/world.js` | The city: buildings (with rooms behind the windows), streets, trees, parks, the river and bridge, collisions, where webs can stick |
| `js/game/life.js` | The city's life: traffic, people who cheer, pigeons, steam, clouds, the news chopper |
| `js/game/player.js` | The physics of moving: running, jumping, swinging, web-zips, wall and ceiling crawling |
| `js/game/anims.js` | The hero's animation clips, authored on his skeleton and baked to bone tracks |
| `js/game/hero.js` | The playable hero: the full model, skinned, and the animation system that plays the clips |
| `js/game/chapter1.js` | Chapter one: the rings, the drones and the finish |
| `js/game/herorig.js` | The hero's body and skeleton (generated by `tools/hero`, `rig` mode) |

### The animations

Every move is a separate clip on the hero's own skeleton (standard Mixamo bone names), written
in `js/game/anims.js` and baked at load to rotation tracks for every bone, 30 keys a second.
Planted feet and hands are placed with two-bone IK, so they stay put while the body moves over
them; walks and runs are built step by step so a foot on the ground never slides.

| Group | Clips (↻ loops) |
|---|---|
| Standing and moving | `idle` ↻, `idle_ready` ↻ (fighting stance), `walk` ↻, `run` ↻, `sprint` ↻, `perch` ↻ |
| Jumping and landing | `jump`, `double_jump`, `fall` ↻, `dive` ↻, `land_soft`, `land_roll`, `land_hero` |
| Webs | `web_shoot_l`, `web_shoot_r`, `web_shoot_both`, `web_attach_l/_r`, `web_release`, `launch`, `web_zip` ↻ |
| Swinging | `swing_back_l/_r` ↻, `swing_bottom_l/_r` ↻, `swing_front_l/_r` ↻ (the arc poses), `swing_forward`, `swing_backward` |
| Walls and ceilings | `wall_crawl_up/_down/_left/_right` ↻, `wall_idle` ↻, `ceiling_crawl` ↻, `ceiling_idle` ↻, `wall_run_up` ↻, `wall_run_side_l/_r` ↻, `wall_jump` |
| Tricks | `front_flip`, `back_flip`, `aerial_spin`, `barrel_roll`, `twister` |
| Fighting | `punch_l`, `punch_r`, `uppercut`, `kick_front`, `kick_spin`, `combo`, `dodge_left`, `dodge_right`, `dodge_back` |
| Web attacks and finishing | `web_strike`, `web_yank`, `takedown`, `victory` |

In the game (`js/game/hero.js`) they are played the way an engine plays them:

- **A base layer picked by the physics.** Idle, walk, run and sprint blend by speed, sharing one
  step phase so the feet stay in step. The crawls blend by which way he is climbing.
- **Crossfades between states.**
- **One-shot moves on top.** Punches, shots and landings use the upper body only while he runs.
- **A physics layer last.** The arm holding the web points at where the web really is, both
  arms aim at a zip point or a target, the head turns toward the camera, and he leans into
  turns and into speeding up.

Swinging is never a canned animation. The pendulum decides where he goes, its arc decides the
mix of the three swing poses (legs trailing as he drops in, swinging through at the bottom,
kicking up as he rises), and the rope decides which way his body and web arm point. Root motion
is exported for the moves that cover ground (rolls, dodges, jumps, the strike); in the game the
physics moves him instead.

`tools/anim/preview.html` plays every clip on a plain mannequin. Open it in a browser and pick
a clip; add `?sheet=all` for a contact sheet. To export the clips:

```bash
cd tools/anim && npm install && node export.mjs
```

This writes two files to `assets/anim/`:

- `hero_animations.glb`: the skeleton, with a `Root` bone under the hips carrying the root
  motion, a neutral mannequin skinned to it, and all the clips. It opens in Blender, Unity,
  Unreal or Godot. The bone names match the hero model, so the clips play on it directly.
- `hero_animations.json`: the same clips as three.js `AnimationClip` JSON, with the skeleton
  and, for each clip, whether it loops, whether it is upper-body only, and the speed and stride
  of the walk and run cycles.

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
node tools/hero/convert.js path/to/source/SpiderManOfficial.fbx build/hero rig
python3 tools/hero/tex_prep.py path/to/textures build/hero
python3 tools/hero/pack.py build/hero js/scene/heromodel.js
python3 tools/hero/pack.py build/hero js/game/herorig.js rig
```

## Credits and legal

Spider-Man was created by Stan Lee and Steve Ditko. Spider-Man and all related characters
are trademarks of Marvel. This project is not affiliated with or endorsed by Marvel or
Sony. The hero's 3D model was supplied for this project; the city, lettering and sound were
made for it too.
