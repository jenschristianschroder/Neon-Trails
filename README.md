# Neon Trails

A single-page, top-down neon trail game for phones, tablets, and desktop browsers.

## Play

- **Solo** — one player against a bot, with Chill, Sharp, and Relentless difficulty.
- **Duel** — two people on the same device, first to three round wins.
- **Co-op** — two people against two bots. At least one teammate must survive.

Drag the circular pad to move. Direction controls your heading, and distance from the center controls speed. Center or release to cruise straight at the minimum speed. Particles never stop during a live round; use Pause for a break. Turns follow a small arc, so plan ahead instead of attempting an instant reverse.

Each player has an edge-to-edge view with a translucent steering circle at the bottom, above the phone's safe area. The thumb marker follows your touch inside the circle, while your glowing particle stays in the clear playing area above the controls. The world scrolls around the particle, even at arena edges, so your finger does not cover it. Releasing centers the thumb marker and keeps the particle cruising. Normal speed ranges from 117 to 180 world units per second. Thick neon trails match their collision width.

Each player's corner minimap shows the entire arena, obstacles, trails, living particles, pickups, the closing boundary, and that player's camera window. The map is larger than the main view in both directions. If a co-op player crashes, their camera follows the surviving teammate.

Trails start with a maximum length of 520 world units. Old sections disappear from both the display and collision detection, reopening routes. All trails, obstacles, riders, and the arena boundary are dangerous. The boundary begins closing after 40 seconds. Simultaneous crashes are draws. Arenas rotate between rounds. A match ends after three wins or nine total rounds, including draws.

Face-to-face mode points the two complete views toward opposite ends of the phone, in portrait or landscape, with each steering circle nearest its player. Turn it off for keyboard play beside each other.

Keyboard controls: P1 uses WASD, P2 uses arrow keys. Either set works in solo. Escape or P pauses. Sound is optional. The game automatically pauses when its page loses focus.

## Pickups

All four pickups affect whoever collects them, including bots:

- **L+** adds 180 trail length, up to 1100.
- **L-** removes 180 trail length, down to 180.
- **S+** boosts speed by 35% for 10 seconds.
- **S-** slows speed by 30% for 10 seconds, without stopping you.

Speed effects replace one another and refresh the timer. Length changes last for the round; extending a trail cannot restore an already erased tail. Eight pickups start on each map, with collected pickups returning to a safe location after five seconds. Trail lengths and effects reset each round.

## Run locally

Open `index.html` in a modern browser. There are no dependencies, accounts, external assets, or build step. Everything runs locally, including bot decisions and audio. Only the sound preference is saved in local storage.

## Verify

Run `node tests/game.cjs` with Node.js. The suite checks collisions, draws, team survival, round progression, full-screen layouts, bottom controls, camera separation from touch input, rotated safe areas, minimaps, continuous movement, finite trails, pickups, multi-touch ownership, missed-release recovery, and interrupted input.

## GitHub Pages

The included workflow runs the tests and deploys the single HTML file on each push to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the source. The workflow can also be run manually.

## Implementation

Canvas 2D, a fixed 120 Hz simulation, cached trail rendering, spatially indexed line collisions, and a small open-space map for bots. Touches are tracked independently from mouse/pen pointers. No inactivity timeout is used for held controls. Release, cancellation, page exit, focus loss, and resizing clear the relevant input.

Browser and simulated touch testing cannot replace testing on physical phones. In particular, verify simultaneous thumbs and browser-edge gestures on the devices used for local multiplayer.
