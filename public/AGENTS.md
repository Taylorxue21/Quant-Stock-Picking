# AGENTS.md

## Purpose
This file gives AI coding agents fast, actionable guidance for the `~/Desktop/public` static web app.

## Project overview
- Simple static website with:
  - `index.html` — main page markup
  - `style.css` — appearance and layout
  - `app.js` — application behavior and interaction logic
- No package manager, build, or test configuration present in this repository.

## Agent guidance
- Treat this repo as a small vanilla HTML/CSS/JavaScript project.
- Prefer minimal, targeted edits. Do not refactor the whole app unless the user explicitly requests it.
- Keep changes compatible with direct browser usage.
- Verify code changes by ensuring there are no syntax errors and that the app still loads correctly in a browser.

## Commit and push workflow
After making a code change and verifying it:
1. Stage only your own changes if possible.
2. Commit with a concise message following the pattern:
   `feat/fix: [由 CLine 自动生成的简短修改说明]`
3. Push to `origin main`.

Example sequence:
```bash
git add -A
git commit -m "feat/fix: [由 CLine 自动生成的简短修改说明]"
git push origin main
```

> Note: If unrelated local modifications already exist, do not bundle them into the same commit unless the user explicitly approves it.

## Verification
- The project can be validated by opening `index.html` in a browser and checking for console errors.
- For JavaScript changes, confirm there are no syntax errors in `app.js`.
