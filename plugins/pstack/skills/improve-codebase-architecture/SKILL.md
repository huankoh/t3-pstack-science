---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. Use for /improve-codebase-architecture.
disable-model-invocation: true
---

# Improve codebase architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones.
The aim is testability and AI-navigability.

This command is informed by the project's domain model and built on a shared design vocabulary:

- Read [codebase-design](../codebase-design/SKILL.md) for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real").
  Use these terms exactly in every suggestion, and don't drift into "component," "service," "API," or "boundary."
- The domain language in `GLOSSARY.md` (or `CONTEXT.md`) gives names to good seams.
  ADRs in `docs/adr/` record decisions this command should not re-litigate.

## Process

### 1. Explore

**Scope before you scan: YAGNI.**
Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed.
Decide where to look before you look:

- If the user named a direction (a module, a subsystem, a pain point), take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots, the files and areas that keep coming up, and let those paths pull your attention first.
  If the changes are scattered with no clear hot spot, widen the net.

Read the project's domain glossary and any ADRs in the area you're touching first.

Then dispatch a fresh delegate through `delegate_task` on the `how explorer` sheet line, inspect only, to walk the codebase.
Brief it with the scope, the absolute path of [codebase-design](../codebase-design/SKILL.md), and the questions below.
Don't give it rigid heuristics; it explores organically and notes where it experiences friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it?
A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo.
Resolve the temp dir from `$TMPDIR`, falling back to /tmp (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file.
On T3, show it in the chat by passing the file's HTML to `html_preview`, then `html_render`.
Elsewhere, open it (`open <path>` on macOS, `xdg-open <path>` on Linux, `start <path>` on Windows).
Either way, give the user the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph, flow, or sequence reliably communicates the structure.
Use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs or SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations).
Each candidate gets a **before/after visualisation**.
Be visual.

For each candidate, render a card with:

- **Files**: which files and modules are involved.
- **Problem**: why the current architecture is causing friction.
- **Solution**: a plain English description of what would change.
- **Benefits**: explained in terms of locality and leverage, and how tests would improve.
- **Before / After diagram**: side by side, custom-drawn, illustrating the shallowness and the deepening.
- **Recommendation strength**: one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge.

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use the glossary's vocabulary for the domain, and the codebase-design vocabulary for the architecture.**
If the glossary defines "Order," talk about "the Order intake module," not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR.
Mark it clearly in the card, as a warning callout such as _"contradicts ADR-0007, but worth reopening because…"_.
Don't list every theoretical refactor an ADR forbids.

See [HTML-REPORT.md](HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do not propose interfaces yet.
After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, follow [grill-me](../grill-me/SKILL.md) to walk the decision tree with them: constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize.
Follow [domain-modeling](../domain-modeling/SKILL.md) to keep the domain model current as you go:

- **Naming a deepened module after a concept not in the glossary?**
  Add the term to the glossary.
  Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?**
  Update the glossary right there.
- **User rejects the candidate with a load-bearing reason?**
  Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_
  Only offer when a future explorer would need the reason to avoid re-suggesting the same thing.
  Skip ephemeral reasons ("not worth it right now") and self-evident ones.
- **Want to explore alternative interfaces for the deepened module?**
  Use the design-it-twice pattern in [DESIGN-IT-TWICE.md](../codebase-design/DESIGN-IT-TWICE.md).
