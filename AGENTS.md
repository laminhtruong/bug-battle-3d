# Agent rules

## Commit and push when a task is done

Every finished task ends with a commit and a push:

1. Run the checks first: `npm run check` for code changes; for a tiny change at
   least `npm run typecheck` and the touched test file. Never commit a failing
   check.
2. Stage only the files the task touched. Leave unrelated work in progress
   alone.
3. Use a Conventional Commit message, like `feat(sim): drop each dead bug part
   at 50%` (see CONTRIBUTING.md).
4. Push the current branch to `origin`. If the push fails, keep the commit
   local and report the error.

Skip the commit and push for read-only work (questions, reviews, investigations)
or when the user asks not to.
