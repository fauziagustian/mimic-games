# Asset credits and integration decisions

## Included in the published game

- **Kenney — Mini Characters 1.0**, user-provided ZIP. 12 GLB characters, their PNG previews and shared color-map texture. The archive's `License.txt` explicitly permits personal, educational and commercial use under **CC0**. Original license is preserved at `public/models/kenney/License.txt`. Creator: https://kenney.nl.
- Three.js **0.186.1**, MIT. The generated browser bundle retains its license notice. Source: https://github.com/mrdoob/three.js.
- Room, microphone, speakers, floor, plants, rug and waveform sign are original primitive geometry in `client/stage-scene.js`, not copies of the supplied props or Mimic Party assets.
- Existing synthetic audio examples are unchanged.

Kenney models have 32 body-animation clips each, including idle, walk, sprint, jump, emote-yes/no, and interactions. They have no mouth blend shapes or facial rig. This release does not claim lip-sync. Geometry and animation were parsed using Three.js; the shared external texture path must stay intact.

## Inspected, not published

These user-supplied GLBs were technically inspected and rendered offline. None contains embedded copyright/license metadata. A filename containing `cc0` alone is not the license record. Await source-page/license confirmation before including them in a public build. Sizes below are approximate raw file sizes; triangle counts are mesh-definition counts, not necessarily total draw cost after instancing.

| Asset filename (without .glb) | KB | Triangles | Assessment |
| --- | ---: | ---: | --- |
| tokoaset-chair-3692 | 35 | 1,036 | Suitable after license confirmation |
| quaternius_cc0-wood-floor-1013 | 21 | 274 | Suitable after confirmation |
| quaternius_cc0-plant-1246 | 17 | 296 | Suitable after confirmation |
| quaternius_cc0-light-decoration-896 | 21 | 304 | Suitable after confirmation |
| quaternius_cc0-kitchen-floor-1009 | 11 | 144 | Suitable after confirmation |
| quaternius_cc0-houseplant-1086 | 9 | 245 | Suitable after confirmation |
| quaternius_cc0-decorative-plant-900 | 34 | 994 | Suitable after confirmation |
| quaternius_cc0-carpet-791 | 5 | 108 | Suitable after confirmation |
| plaggy_cc0-table-610 | 14,300 | 4,160 | Large texture payload; resize/compress first |
| plaggy_cc0-shelf-593 | 10,592 | 384 | Large texture payload; resize/compress first |
| plaggy_cc0-lamp-547 | 4,636 | 1,894 | Large texture payload; resize/compress first |
| pixellabs-treasure-chest-3502 | 2,210 | 50,000 | Reduce geometry; reserve for occasional rewards |
| gino_48-sweet-3255 | 404 | 2,444 | Optional decor after confirmation |
| gal-b-shelf-5644 | 138 | 3,892 | Suitable after confirmation |
| gal-b-eternal-flame-lamp-4113 | 504 | 2,856 | Optional decor after confirmation |
| febrianes86-podium-4305 | 2,818 | 158,208 | Too dense for small prop; simplify before use |
| febrianes86-microphone-4279 | 941 | 41,244 | Simplify before use |
| automatron-latern-3680 | 1,083 | 44,237 | Simplify before use |

Original user files were not modified. UGC in the current game remains **moderated sound submissions**, not arbitrary community 3D model uploads. Any future avatar UGC needs separate file validation, licensing, polygon/texture limits and moderation.
