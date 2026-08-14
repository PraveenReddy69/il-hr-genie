#!/usr/bin/env bash
#
# Publishes the bot service to Bitbucket.
#
# The company repository holds the service alone — no docs, no README, no history
# from this repository. So this builds a clean tree from whatever is committed here,
# commits it as one commit, and replaces the remote branch with it.
#
#   ./scripts/publish-bot.sh
#
# Force-pushing is deliberate: the remote is a mirror of `teams/`, not somewhere
# anyone commits. Nothing there is ever lost that is not already here.

set -euo pipefail

REMOTE=https://Praveen_Reddy129@bitbucket.org/CodeRepoInfinitylearn/hrgenie-bot-service.git
BRANCH=main
STAGING=$(mktemp -d)

cd "$(dirname "$0")/.."

# Refuse to publish what has not been committed: the export below reads HEAD, so
# uncommitted work would be silently left behind.
if ! git diff --quiet HEAD -- teams; then
  echo "teams/ has uncommitted changes. Commit them first:"
  echo
  echo "  git add -A teams"
  echo "  git commit -m \"...\""
  exit 1
fi

echo "Running the tests before anything leaves the machine..."
(cd teams && npm test >/dev/null)

git archive "HEAD:teams" | tar -x -C "$STAGING"
rm -rf "$STAGING/docs" "$STAGING/README.md"

cd "$STAGING"
git init -q -b "$BRANCH"
git add -A
git -c user.name="Praveen" -c user.email="praveen99665522@gmail.com" \
  commit -q -m "HR Genie Teams bot service"
git remote add bitbucket "$REMOTE"
git push --force bitbucket "$BRANCH:$BRANCH"

echo
echo "Published $(git ls-files | wc -l) files to $BRANCH."
echo "Now trigger the pipeline."
