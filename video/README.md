# Orca film

A 58-second film about orca, drawn in HTML and JavaScript. Every frame is a function of time, so the page plays live and renders to video the same way. The score is synthesized with Web Audio from the same timeline, so each click, key and page flick lands on its frame.

## Files

- `index.html` plays the film in a browser, with sound. Space pauses, the arrow keys skip two seconds.
- `js/world.js` holds the shared layers: the sea, the surface, the cursor, grain and the scene timing.
- `js/scenes/` holds one file per scene.
- `js/audio.js` holds the score and the sound effects.
- `render.mjs` writes `orca.mp4`, at 1920 × 1080 and 60 fps with two sub-frames of motion blur per frame.
- `stills.mjs` writes single frames to `build/stills/` for review.
- `fonts/` and `assets/` are copies of the site's faces and of the pages the engine set for the sample book.
- `ref/` holds the screenshots of the site that set the look.

## Render

The render needs Node, ffmpeg and the Playwright browsers that the plugin already installs.

```sh
cd video
node render.mjs                      # the whole film to orca.mp4
node render.mjs --from 22 --to 30    # one section
node stills.mjs 4 13.5 26.9          # frames at those times
```
