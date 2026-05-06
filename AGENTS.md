# Repository Guidelines

## Project Structure & Module Organization
This repository is a small static web app for a Three.js flag-mode experiment. Keep the entry document in `index.html`, and place runtime logic in `src/main.js`. Environment and workflow setup live in `flake.nix` and `Justfile`. The `guidelines` file contains product and interaction notes that should be preserved when changing the UI or simulation behavior.

## Build, Test, and Development Commands
Use Nix and `just` for the standard workflow:

- `nix develop`: enter the dev shell with `live-server` and `just` installed.
- `just dev`: start the local server on port `8080` and serve the app root.
- `just refresh`: touch `index.html` to force a live reload if the watcher misses a change.
- `just check`: print local tool versions for a quick environment sanity check.

There is no bundled production build step yet; the app is served directly as static files.

## Coding Style & Naming Conventions
Use 2-space indentation in HTML, CSS, and JavaScript to match the existing files. Prefer `const` by default, use `let` only for reassignment, and keep helper names descriptive, such as `createRestPosition` or `buildNodeLabels`. Use camelCase for variables and functions, and UPPER_SNAKE_CASE for simulation constants like `NODE_COUNT`. Keep CSS custom properties in `:root` and reuse the established Nord color tokens instead of introducing ad hoc values.

## Testing Guidelines
There is no automated test suite configured yet. Before opening a PR, run `just dev` and manually verify core interactions: scene load, GUI controls, modal open/close behavior, and responsive layout at narrow widths. If you add nontrivial logic, prefer extracting small pure functions in `src/main.js` so they are easy to test when a test runner is introduced.

## Commit & Pull Request Guidelines
Follow the commit style already used in history: short, imperative messages with a prefix such as `feat:`, `ui:`, or `chore:`. Keep PRs focused, describe the user-visible change, and include screenshots or a short screen recording for UI updates. Link the relevant issue or task when one exists, and note any manual verification steps you performed.
