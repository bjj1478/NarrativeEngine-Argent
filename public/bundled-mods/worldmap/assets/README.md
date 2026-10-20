# Overworld artwork v1

`overworld-sprites-v1.png` is an original 4 by 4 transparent sprite atlas,
generated with the built-in image-generation tool on 2026-09-10. No external
asset service or API key was used. It is inspired by handheld RPG pixel art;
it does not contain extracted Pokemon assets.

The renderer derives slot width/height from the image itself (the delivered
image is 1280 by 1280). It draws with image smoothing disabled. Slot order:

| Row | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 1 | Broadleaf | Evergreen | Palm | Mountain |
| 2 | Cottage | Camp | Ruin | Shrine |
| 3 | Rocks | Grass | Snow tree | Marsh tree |
| 4 | Traveller | Village | Standing stone | Bridge |

Ground tiles and connected shoreline strips are painted by `pixelArt.js`.
Forest objects overscan cached tiles by one cell to avoid canopy seams.
The generated concept image is a style reference, not a map background.
Terrain, trails, anchors, discoveries and party coordinates remain authoritative.
Bridge art represents crossing discoveries; no water crossings or connections
are added to the simulation by the art layer. Settlements are world-map icons,
not new walkable town interiors. Existing explicit layer settings are preserved;
new/default maps start with the grid off. Labels and grid remain toggleable.

## Generation prompt

Create a production sprite atlas for an original Pokemon Emerald / Game Boy Advance inspired fantasy overworld. PNG with TRUE TRANSPARENT BACKGROUND. Square 1024x1024 canvas divided into EXACTLY FOUR EQUAL COLUMNS and FOUR EQUAL ROWS, each slot 256x256 pixels. No drawn grid, no labels, no words, no border. Each isolated sprite fits entirely within its own 256x256 slot with at least 24 pixels transparent padding on every side. Center each sprite in its slot. Consistent chunky pixel art, same apparent 32x32 source-pixel resolution enlarged 6x; hard square pixels, nearest-neighbor look, no antialiasing, no smooth gradients, no painterly marks. Light from upper left, dark green/blue outlines, warm green GBA palette, readable simple clusters. Top-down handheld RPG perspective with visible short front faces, NOT isometric. Row1 left to right: rounded lush broadleaf tree; tall dark evergreen tree; tropical palm with broad canopy; rocky mountain peak with pale stone summit. Row2 left to right: small cream cottage with terracotta roof and blue window; beige triangular campsite tent with small stone fire ring; small mossy broken stone ruin arch; small wayside shrine with blue roof and stone base. Row3 left to right: low gray rock cluster; small golden-green grass tuft; snowy evergreen tree; dead marsh tree with sparse green foliage. Row4 left to right: original blue-cloaked backpack-wearing adventurer seen from above and behind facing up (whole body); tiny fortified village icon with three terracotta roofs grouped together; tall standing stone landmark; horizontal wood plank bridge segment with railings. Exactly these 16 individual sprites in exactly this order. No ground platforms, no landscapes, no background fill or checkerboard, no shadows extending outside each sprite slot. Original assets with the warm charming look of a 2004 handheld RPG; no Pokemon creatures or logos.

## Terrain variants A-D

Ground sprites are authored as 16x16 pixel motifs in `pixelArt.js`, with four
distinct patterns per biome. Grass has short tufts (A), dense tufts (B),
flowers (C), and pebbles (D). Other families use waves, sand ripples, reeds,
ice, crop rows, and rocky cracks. All retain their base colour at tile edges.
A coordinate hash chooses the same variant across pan, zoom, and cache rebuilds.
Shoreline strips are applied after the ground sprite.

Open `terrain-variants.html` through the app's asset server to review every
A-D sprite and a mixed patch. These are canvas pixel assets; no generated
image or extra image load is required.

## Softer map boundaries

The terrain painter blends observed neighbouring biome colours along edges
and diagonal corners. Unobserved terrain is never sampled. Unexplored fog
stays opaque; its fringe fades inward over generated terrain. Farmland uses
a shared A-D orientation within six-cell fields, and ordinary ground leaves
some cells undecorated to reduce repetition. The optional grid is subtler;
existing grid preferences are preserved.

`terrain-smoothing.html` shows a synthetic before-and-after scene using the
real terrain, sprite, and fog painters.

## Elevation lighting and shadows

Stored elevations now drive terrain lighting before objects are drawn.
Shared corner normals interpolate illumination across each tile, avoiding
per-cell light bands. Flat ground retains its original colour and ocean
is unshaded. Missing or unobserved heights fall back to the current cell.
Lighting uses the existing render lightAzimuth and shadeStrength settings;
the default sun is north-west. Small zoom levels use fewer shading samples.

Steep observed downhill edges get broken ledge accents at detailed zoom.
These are visual cues and do not change elevation, pathfinding or travel.
Terrain objects and site sprites receive layered contact shadows toward the
lower right. Grass tufts remain unshadowed. All sprite drawing stays crisp.

`terrain-elevation.html` compares an unlit synthetic scene with the real
lighting and shadow painters applied to identical terrain and objects.
