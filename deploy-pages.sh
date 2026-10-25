#!/bin/sh
# Publishes the built site (docs/) into the minyan/ folder of the gh-pages branch, which GitHub Pages serves.
set -e
cd "$(dirname "$0")"
node build.js
git fetch -q origin gh-pages
WT="$(mktemp -d)"
git worktree add -q "$WT" origin/gh-pages
rm -rf "$WT/minyan" && mkdir -p "$WT/minyan" && cp -R docs/. "$WT/minyan/"
cd "$WT" && git add -A && (git -c user.name='Minyan Board' -c user.email='minyan@example.invalid' commit -q -m "Update minyan board site" || true) && git push -q origin HEAD:gh-pages
cd - >/dev/null && git worktree remove --force "$WT"
echo "published to https://naftule11249-cyber.github.io/shuldesk/minyan/"
