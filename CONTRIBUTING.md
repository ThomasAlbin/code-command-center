# Contributing

Bug reports, ideas and pull requests are welcome.

## Before you open a pull request

- `npm test` and `npm run typecheck` pass.
- The safety model in the [README](README.md#safety) still holds. If your change starts another program, reads another file or adds to what the mod does, say so in the pull request; the README has to change with it.
- A change to the mod in `mod/deck-bridge/` needs particular care, because the mod runs inside Claude Code. The test `test/mod.test.js` reads the mod as text and fails when a hook or a call is added, on purpose. It catches a change made in the open, not one written to get past it, so a change to the mod is also read line by line.

## The license of what you contribute

This project is offered under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), and its author also offers [commercial licenses](COMMERCIAL.md). That only works if the author may license all of the code. So by submitting a contribution, such as a pull request or a patch, you agree that:

1. you wrote it yourself, or otherwise have the right to submit it
2. it is licensed to everyone under the project's license, the PolyForm Noncommercial License 1.0.0
3. you grant Thomas Albin a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, copy, change and distribute your contribution, and to license it to others under any terms, including commercial ones

You keep the copyright in your contribution.

If you cannot agree to this, open an issue instead of a pull request.
