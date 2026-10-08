# Blalien Projections

Projection mapping in the browser, inspired by [Lazy Lighting](https://apps.apple.com/app/id6751762579). Warp visuals, photos, videos, drawings and text onto real objects, then control the show from any phone or laptop on your Wi-Fi.

**Live demo:** https://zdstudios.github.io/blalien-projections/

## Quick start

### Option 1: Run it on your computer (recommended)
This lets every device on your network control the show and share uploads.

1. Install [Node.js](https://nodejs.org) (LTS). No other dependencies are needed.
2. Double-click `start-windows.bat`. On Mac or Linux, run `./start-mac-linux.sh`. You can also run it from a terminal:
   ```bash
   node server.js
   ```
3. The terminal prints a link such as `http://192.168.1.20:8080/`. Open it on your phone or laptop to control the show.
4. On the computer connected to the projector, open the same link with `?output` on the end. Click the page to make it fullscreen.

If Windows asks about the firewall, allow Node.js. Otherwise other devices can't connect.

### Option 2: GitHub Pages / no install
Open the live demo link. Click **Output ↗**, drag that window onto the projector and click it to make it fullscreen. In this mode the windows sync only inside the same browser, and uploaded media stays in that browser.

## How to map
1. Add a shape (Quad, Circle, Box, Text, Silhouette, Freehand and more).
2. Drag the round corners onto your real object. Drag the diamond handles to bend an edge around a curve. Press **P** to show the outlines on the projector while you work.
3. Under **Content**, choose what plays: built-in visuals, your media, the camera, a drawing, text, a custom GLSL shader, or black to block light.
4. Map right on the projector if you like: click the output window and press **P**. You can then drag corners directly on the wall with the mouse, and the editor updates live.
5. Add **Effects**, turn on **Audio** so the visuals react to music, and save **Scenes**.

## Editor and projector always match
The output window reports its real resolution. The editor stage then takes the same shape automatically (for example 16:9 or 4:3), so a shape that lines up in the editor lines up on the projector. Positions are stored relative to the screen, so they don't depend on resolution. To set the shape by hand, use **Settings → Output shape**; this turns off the automatic matching.

## Features
- Corner-pin perspective warping, edge bending, and linked corners that stay together (for example on a box)
- Masks: rectangle, circle, triangle, polygon, star, heart, text, image silhouette, freehand outline, invert and feather
- 24 animated visuals, two channels per surface (A/B) and a crossfader
- Effects: kaleidoscope, tile, slide, spin, zoom, blur, hue cycle, mono, invert, strobe, BPM pulse and neon outline glow
- Audio reactivity from the microphone, tap tempo, MIDI control (CC1 = crossfader, CC7 = master, notes from 36 = scenes)
- Scenes with fades, blackout, test grid, recording to WebM, undo/redo, save and open shows as JSON

## Keyboard shortcuts
| Key | Action |
|---|---|
| V / D / M | Map, Draw and Outline tools |
| H | Present on this screen |
| F | Fullscreen |
| P | Show outlines on the projector |
| T | Test grid |
| B | Blackout |
| 1–9 | Go to a scene |
| Space | Tap tempo |
| Arrows | Nudge a corner or the whole surface (Shift = 10×) |
| Ctrl+Z / Ctrl+Y | Undo / redo |

## Notes
- The camera and microphone only work on `localhost` or `https`. Open the output on the projector computer at `http://localhost:8080/?output` to use them.
- Uploads are saved in `media/` and the show in `data/state.json`. Git ignores both.
- Use a recent Chrome, Edge, Firefox or Safari. The app needs WebGL2.

## Files
`index.html` · `css/style.css` · `js/core.js` (state, sync, geometry) · `js/render.js` (WebGL renderer) · `js/editor.js` (UI) · `server.js` (LAN server)

MIT License
