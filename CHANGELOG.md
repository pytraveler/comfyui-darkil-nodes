# Changelog

[Русская версия](CHANGELOG_RU.md)

The version in `pyproject.toml`, the git tag and the release on GitHub always say
the same thing: the release workflow refuses a tag that disagrees with
`pyproject.toml`, and it refuses a tag that neither changelog has a section for.
The release notes are exactly those two sections, English first.

A release therefore takes three steps: bump `version` in `pyproject.toml`, add a
`## X.Y.Z - YYYY-MM-DD` section to both changelogs, then push the tag `vX.Y.Z`.
Pushing `pyproject.toml` to `main` also publishes the pack to the ComfyUI
registry, which is a separate workflow and does not need a tag.

Dates are the dates the version was published. Newest first.

## 0.2.4 - 2026-08-15

### Added

- **Show Any keeps the last 20 values, and a bar to walk back through them.** A
  preview that only ever holds the current run makes comparing two runs
  impossible: the previous value is gone the moment the next one arrives. The
  bar above the panel steps one value at a time, jumps to the newest and drops
  everything except what is on screen, with the position and the time of the run
  in the middle. It works for every type the node renders, because what is kept
  is the value rather than the drawing. A value arriving while an older one is on
  screen does not steal the view - that moment is exactly when someone is
  comparing two of them - the counter turns orange instead, and the jump button
  goes back to the newest.

- **The value kept in the workflow can be dropped, and can be turned off
  outright.** What the node writes down for the next reload is also what leaves
  with the workflow when the file is handed to someone else, and the last thing
  a node happened to show is not always something to send along. `x` in the bar
  now forgets both copies - the older entries in this tab and the one in the
  file - and leaves the value on screen alone, because that copy goes nowhere.
  The right-click menu does the same for every Show Any node in the graph at
  once, and carries a switch that stops the node writing anything down from then
  on; a node set that way says `not saved` in its bar rather than leaving you to
  guess. The switch is the node property `showany_keep`, so it can also be
  flipped in the properties panel, and it travels with the node.

### Fixed

- **Show Any went blank whenever the frontend rebuilt the graph.** Coming back to
  the browser tab, switching between workflows and undoing a load all throw every
  node object away and build new ones, and the value lived on the node object, so
  there was nothing left to draw and no execution on the way to redraw it. The
  history now lives outside the nodes, under an id that travels with the node in
  the workflow, so a rebuild costs nothing. The last value is written into the
  node as well, which is what brings it back after a page reload; it is labeled
  `restored` until the node runs again, because a preview showing something that
  no longer belongs to the graph should say so rather than pass it off as this
  run's output. Text is cut to 8 KB on the way into the workflow file, and a
  pasted copy of the node starts a history of its own instead of writing into the
  history of the node it was copied from.

- **Show Any took its own properties panel down with it.** Setting any property
  on a node makes LiteGraph walk its widgets reading `options.property` off each
  one, and the widgets this node draws by hand - the boolean, the equalizer, the
  stacked chart - carried no `options` at all, so the read threw and nothing that
  sets a property on this node could finish. It went unnoticed while it only
  happened for three of the value types; the history bar is on the node whatever
  it shows, which made it every time. Every hand-drawn widget now carries the
  object LiteGraph expects to find.

- **Restoring a value is no longer treated as an edit.** The node resized itself
  to fit whatever came back, which is right after a run and wrong on load: the
  size is already in the workflow, and changing it left ComfyUI reporting unsaved
  changes on a workflow whose owner had touched nothing. The saved size now
  stands, and a run resizes as before.

## 0.2.3 - 2026-07-25

### Added

- **Any Switch [darkilNodes]** - passes through the first input that is both
  connected and enabled. The `any_*` slots grow as they are filled, so the node
  is never wider than the wiring needs, and each slot carries a checkbox in the
  right column: unchecking one skips that input without pulling the wire out,
  which is the whole point of having the node instead of rewiring by hand.
  Inputs are read top to bottom, values that are falsy but valid (`0`, an empty
  string) still count as connected, and when nothing qualifies the node returns
  `None` instead of failing the run.
- **Show Any [darkilNodes]** - one preview node for whatever is wired into it,
  rendered by the value's runtime type: text and numbers as copyable text, a
  dict or a JSON string as a collapsible tree with a Tree/Raw toggle, booleans as
  a check or a cross, a numeric list as an equalizer chart, a list of lists as
  stacked mini-equalizers with pagination, images and masks as inline previews,
  audio and video as players, and markdown rendered on request. The value goes
  out unchanged on `value`, so the node can sit in the middle of a chain rather
  than at the end of a branch. Panels fill the node as it is resized.

### Fixed

- **Strings Joiner turned some escapes into the wrong character.** The sequences
  were substituted one rule after another, so text that already contained a
  backslash was rewritten twice and `\\n` became a newline instead of a backslash
  followed by `n`. Each escape is now rewritten once in a single pass, and a
  sequence that is not in the table is left exactly as it was written.
- **Wan22 LoRA list builder picked the wrong file for a short name.** A name was
  matched by substring, so the first LoRA whose path merely contained it won. The
  candidates are now tried in order: the exact file name, then a file whose name
  without the extension matches, and only then a substring match.
- **Constant Setter returned the wrong value with the input off.** The constant
  was read from a node property that was never written to, with the widget value
  only as a fallback; the widget value is now what the node converts and returns.
- **Diffusion Model Load Later logged the wrong thing.** The message printed the
  literal `unet_name` rather than the model being loaded, and it was written at
  warning level for an ordinary load. It now names the model and logs at info.
