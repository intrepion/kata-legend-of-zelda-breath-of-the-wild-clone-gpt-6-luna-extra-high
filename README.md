# The Wilds: Echoes of the First Light

A small, self-contained open-world adventure for the browser. Explore a hand-drawn wilderness, keep an eye on your stamina, face the creatures that guard its lost lights, and bring them back to the sleeping shrine.

## Play

No build step or package install is needed. Serve this directory with any static file server, then open its local URL. For example:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> and choose **Begin the journey**. The game uses Canvas and the Web Audio API; the typefaces load from Google Fonts when online and fall back to system fonts otherwise.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `W A S D` or arrow keys | Direction pad |
| Run | Hold `Shift` (uses stamina) | Hold `RUN` (uses stamina) |
| Strike | `Space` or click toward a target | Sword button |
| Gather / enter | `E` | Walk close, then tap `E` |
| Field map | `M` | Minimap hidden on small screens |
| Pause | `Esc` | — |

Find three lost lights, then return to the shrine at the end of the old road. Nearby wanderers can be defeated with a forward strike. If you fall in battle, you wake back in the meadow with your gathered lights intact.

## Project files

- `index.html` — game shell, HUD, intro, and ending screens
- `style.css` — responsive interface and overlays
- `game.js` — world generation, rendering, movement, combat, audio, and game state
