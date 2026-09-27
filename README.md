# The Wilds: Echoes of the First Light

A third-person 3D browser adventure. Explore a low-poly wilderness, orbit the camera around the wanderer, manage stamina, face creatures guarding three lost lights, and return them to the sleeping shrine.

## Play

Serve this directory with a static file server:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> and choose **Begin the journey**. The game uses Three.js 0.186.0 through a version-pinned CDN import map, so an internet connection is required to load the 3D engine and web fonts. It does not need a build step or package installation.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `W A S D` or arrow keys | Direction pad |
| Run | Hold `Shift` (uses stamina) | Hold `RUN` (uses stamina) |
| Look around | Drag the scene; scroll to zoom | Drag the scene |
| Strike | `Space` or click | Sword button |
| Gather / enter | `E` | Walk close, then tap `E` |
| Field map | `M` | Hidden on small screens |
| Pause | `Esc` | — |

Find three lost lights, then return to the shrine on the old road. Nearby wanderers can be defeated with a forward strike. If you fall in battle, you wake back in the meadow with your gathered lights intact.

## Project files

- `index.html` — game shell, HUD, intro, import map, and ending screens
- `style.css` — responsive interface and overlays
- `game.js` — 3D terrain, scenery, player/enemy models, camera, movement, combat, audio, and game state
