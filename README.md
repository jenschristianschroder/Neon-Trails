# Neon Trails

A single-page, top-down neon trail game for phones, tablets, and desktop browsers.

## Play

- **Solo** — one player against a bot, with Chill, Sharp, and Relentless difficulty.
- **Duel** — two people on the same device, first to three round wins.
- **Co-op** — two people against two bots. At least one teammate must survive.

Drag the circular pad to move. Direction controls your heading, and distance from the center controls speed. Rest in the center or lift your finger to stop. Turns follow a small arc, so plan ahead instead of attempting an instant reverse.

Your trail stays solid for the round. All trails, obstacles, riders, and the arena boundary are dangerous. The boundary begins closing after 12 seconds. Simultaneous crashes are draws. Arenas rotate between rounds. A match ends after three wins or nine total rounds, including draws.

Face-to-face mode points the two complete views toward opposite ends of the phone, in portrait or landscape. Turn it off for keyboard play beside each other.

Keyboard controls: P1 uses WASD, P2 uses arrow keys. Either set works in solo. Escape or P pauses. Sound is optional. The game automatically pauses when its page loses focus.

## Run locally

Open `index.html` in a modern browser. There are no dependencies, accounts, external assets, or build step. Everything runs locally, including bot decisions and audio. Only the sound preference is saved in local storage.

## Verify

Run `node tests/game.cjs` with Node.js. The suite checks collisions, draws, team survival, round progression, layout orientation, stopping, multi-touch ownership, missed-release recovery, and interrupted input.

## GitHub Pages

The included workflow runs the tests and deploys the single HTML file on each push to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the source. The workflow can also be run manually.

## Implementation

Canvas 2D, a fixed 120 Hz simulation, cached trail rendering, spatially indexed line collisions, and a small open-space map for bots. Touches are tracked independently from mouse/pen pointers. No inactivity timeout is used for held controls. Release, cancellation, page exit, focus loss, and resizing clear the relevant input.

Browser and simulated touch testing cannot replace testing on physical phones. In particular, verify simultaneous thumbs and browser-edge gestures on the devices used for local multiplayer.
