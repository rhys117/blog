---
title: "Tidying the Slop: Fighting it Early"
description: "Claude left unchecked accumulates technical debt fast. Fight it early with its own self pass using hooks and deterministic tooling."
pubDate: 2026-08-09
tags: [ai, claude-code, hooks, refactoring]
---

> Whilst this article is written in the context of a Claude Code harness within a Rails application,
> the pattern carries to any harness that can react to the moment a commit lands.

Kent Beck has described a coding rhythm of inhaling and exhaling. Inhale to add features, exhale to create options. It's the classic build then refactor. Without the second step, it's easy and fast to accumulate technical debt.

Agents seem to be very good at the first. Inhaling, building, adding. What the agent doesn't do so well, by default, is the simplification step. All those little rules, the reflexes, the muscle of knowing where things go, tidying along the way, are easily lost. 

Building an exhale into the harness starts incorporating some of the lessons we're at risk of forgetting. Without it, the design degrades one commit at a time.  

To those that might think in the age of LLMs that quality matters less, I'd encourage you to consider that your code is also part of your harness. It must remain of quality or risk feeding poor results in the future.

I've combated that with a Claude plugin I'm calling [exhalekit](https://github.com/rhys117/claude-rulekit/tree/main/plugins/exhalekit). At a glance, after each commit lands, a hook will:
1. Encourage the agent to consider Beck's [four rules of simple design](https://martinfowler.com/bliki/BeckDesignRules.html) against the changes.
2. Run [Rubycritic](https://github.com/whitesmith/rubycritic) (flog/flay/reek) against the file diff to add deterministic code smells and complex code warnings.
3. Require the agent to make a pass, decide what's worth acting on immediately, and commit a refactor before continuing to its next task.

This is the breath out, or 'exhale', to the 'inhale' of the initial build.

## Instructions were not enough

My first attempt at this was instructions in the project's CLAUDE.md. Even though it was instructed to not be optional, it only worked sometimes. Often it was skipped, especially as the session and context grew larger. Which is the same failure I wrote about in [Nudging LLMs Just In Time](/blog/just-in-time-not-just-in-case). A rule delivered up front is a rule the model has half forgotten by the time it should apply it.

So the fix is the same shape, don't front load the rule and deliver it at the point of action. The only difference is the trigger. The rulekit nudges fire when the agent reaches for a file. The exhale nudge fires when a commit lands.

## A hook on the commit

exhalekit looks for a git commit that actually succeeds, and is smart enough to know when to skip (using conventional commit patterns).

```bash
# Already an exhale. Don't ask for an exhale on an exhale.
printf '%s' "$COMMAND" | grep -qiE '(refactor|simplify|exhale)' && exit 0
```

When it does fire, it injects one paragraph into the context, right after the commit confirmation:

> Exhale. You just committed a feature/fix. Review the changes for simplicity, duplication, and design quality against the four rules of simple design. Run `bin/diff-quality --last-commit --no-browser` to check for rubycritic regressions and run related specs against the commit you just made. Do not skip this step.

The same instruction that got skipped in CLAUDE.md gets acted on here. Not because the wording improved, but because it lands at the moment the agent is deciding what to do next.

## What the diff quality script does

`bin/diff-quality` (installed by `/exhale-init`) runs RubyCritic over just the files the last commit touched. It only takes a few seconds to generate a targeted report. 

Some of the results will be noise and you probably wouldn't want to act on all of them, combined with Beck's rules I've found Anthropic's models reliably determine what I would consider to be worthwhile changes, and what not to be. Other models may require further instructional tweaking. 

The trap I'd warn against here is that refactoring against your own judgment to satisfy a metric makes the code worse. The times I've disagreed with the refactoring, it's easy to unwind the commit, add to the relevant reek, flay or flog ignore lists and have it run again. 

## Some examples

One of the smallest ones first. A commit gave a sample wedding a ceremony end time, because the calendar links need one.

```ruby
starts_at: anchor_date + 16.weeks + 15.hours,
ends_at: anchor_date + 16.weeks + 22.hours,
```

Reek flagged the duplicated `anchor_date + 16.weeks`. A minute later the end time read `starts_at + 7.hours`. On its own I'd let that pass. It's the kind of minor change that, stacked with another ten, makes the entire file that much easier to read. Small tidyings pay off.

The next one up was a device preview, the phone frame each invitation theme renders inside. The inhale had left two near copies of it, one in the theme card and one on the theme's detail page, both carrying the bezel, the scaled iframe and the Stimulus wiring. Worse they'd already started to drift. The exhale pulled them into a single `UI.device_preview` component.

Because of that, my next prompt of requests only had one file to change instead of two.
1. Icons instead of text on the device toggle. One template.
2. Default the preview to mobile. Reordering a hash.
3. A review comment saying the viewport dimensions shouldn't sit in a controller. They became a default on the component.

Smaller again, same branch. The Desktop/Mobile toggle started as two hand rolled button tags, and an exhale moved them onto `UI.button` as a `pill_toggle` variant. Nothing about that feels urgent. It's the sort of thing that often would pass in review, but risks more drift building over time. More copy/pasta, instead of building and using the design system. It's also why the icons request above was a one line change, `UI.button` already had an icon slot.

Small things that compound. Instead of quality degrading over time, you get a better baseline to work with immediately from the agent.

## Other notes

This works best with smaller, focused commits, and a 'commit often' workflow.

Beck's four rules are loaded at the start of my agent's context, in my CLAUDE.md file I have
```
Design Philosophy: Beck's Four Rules of Simple Design
All design decisions should be evaluated against these rules, in priority order:

Passes the tests — correctness is non-negotiable
Reveals intention — code should communicate its purpose to readers
No duplication — state everything once and only once (DRY). Eliminating duplication is a powerful way to drive out good design
Fewest elements — remove anything that doesn't serve the first three rules. No speculative abstractions
Rules 2 and 3 can tension each other — making something DRY can obscure intent. Resolve through refactoring, not by abandoning either rule.
```

## Credit where it's due

The inhale and exhale framing comes straight from [Beck's writing on augmented coding](https://tidyfirst.substack.com/). All I've added is the plumbing to make it happen automatically.

exhalekit lives alongside rulekit as a plugin. `/exhale-init` installs the diff-quality script into a Ruby project, and the hook does the rest. If you're interested, I suggest taking a look at the [source](https://github.com/rhys117/claude-rulekit)
