---
title: "Nudging LLMs Just In Time: Fighting Context Rot"
description: "Stop front-loading rules into CLAUDE.md and provide the agent each convention at the moment it needs it."
pubDate: 2026-06-27
tags: [ai, claude-code, context-engineering, hooks]
---

> Whilst this article is written in the context of a Claude Code harness within a Rails application, 
> the same strategies could easily be adapted for other harnesses that might utilise AGENTS.md and frameworks.

There comes a time when the CLAUDE.md file has grown too much, and because of the amount of context in it, often not all of it is used.

Claude starts exploring, the context window grows with files being read, and decisions provided in CLAUDE.md start being missed.
We all know this as context rot, and there are many great articles about it.
Model recall degrades as the window fills, so the more you front-load, the more likely it is that the model will wander as the session grows.

I found this particularly the case when you have legacy parts of the code and the files read might conflict with the instructions provided earlier.

> CLAUDE.md is, in Anthropic's own words, ["naively dropped into context up front."](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

## Deliver the rule at the point of action

The answer is shrinking the CLAUDE.md file and moving from front-loading to providing the context just in time when the model tries to read or write
to specific files or folders.

Using the Claude Code hooks, you can easily wire scripts for PreToolUse which can fire before writes (Edit, Write, and MultiEdit), and reads (Read|Bash|Grep|Glob). 
The hook sees the file path and the content about to be read or written. Scripting then chooses to block the write or let it through. 
I drive mine from small `read.yml` and `write.yml` files, one entry per rule.

```yaml
boolean_column:
  type: warn
  files: ["db/migrate/**/*.rb"]
  pattern: '\bboolean\b'
  context: "A boolean only holds two states. Prefer a status enum or a timestamp like archived_at unless you are sure a third state will never exist."

service_object:
  type: warn
  files: ["app/services/**/*.rb"]
  pattern: 'def call'
  context: "Before adding a service object, ask whether it coordinates work across more than one model. If it just wraps save or update on a single record, that logic belongs on the model."
```

Neither of these is a lint. RuboCop will happily pass a boolean column or a one-line service object. What the rule carries is a 
judgment about what the code should be, and it only surfaces the instant Claude reaches for the relevant files. 
This is the way I encode my taste and code preferences so that the LLM is more likely to pay attention to the rules I like.

In fact it's important to name what these aren't, rules that could otherwise be easily captured in lint rules. Those should
be their own steering layer that the LLM has to pass and know to correct (whilst creating a barrier for 
handwritten code at the same time).

## Logic, not just a pattern

I found regex too limiting depending on the task. One of its biggest limitations is not verifying what's already in a file. 
Plenty of mistakes are only visible when you union the incoming edit with the current code.

The clearest case for me is a controller that grows a CRUD action without the concern that's meant to back it. 
In my apps a controller with `create`, `update` or `destroy` should `include CRUDResource`, which carries the scoping, 
authorisation and response lifecycle I wrote about in [Rails on Rails](/blog/rails-on-rails). 
Add one of those actions by hand and skip the include, and you might have quietly forked off the convention.

```ruby
module Detectors
  module CrudResourceMissing
    CRUD_ACTION = /^\s*def\s+(create|update|destroy)\b/
    INCLUDES_CRUD = /include\s+CRUDResource\b/

    def self.call(file_path:, new_content:, **)
      existing = File.exist?(file_path) ? File.read(file_path) : ""
      content = "#{existing}\n#{new_content}"

      return false unless CRUD_ACTION.match?(content)
      return false if INCLUDES_CRUD.match?(content)

      { context: "This controller has a CRUD action but doesn't `include CRUDResource`, " \
                 "the concern that carries scoping, authorisation and the response lifecycle. " \
                 "Add it, or opt out on purpose if this one really is a special case." }
    end
  end
end
```

The `CrudResourceMissing` detector reacts only when it needs to, because it can read the current state of the code and weigh the edit on top of it.

## Block, nudge, and the escape hatch

I set up three ways of injecting context based on the rule. A hard block that can never be overridden, a soft block that forces another turn from the agent, 
and a warning that adds the context whilst still allowing the edit without the LLM re-requesting it (block, block_once, warn).

The `block_once` rule, I find is the one that is most useful.

```yaml
wildcard_route:
  type: block_once
  files: ["config/routes.rb"]
  pattern: '^\s*match\s'
  context: "A match route answers every HTTP verb, which is rarely intended and a common source of routing and security bugs. Use an explicit get or post for the verbs you need, or resources for a RESTful set."
```

Using block_once, the context is injected before the edit alongside a further line letting the agent know it can re-run the same edit to push it through. 
It means the LLM can decide if it's relevant, and either adjust or re-run the edit unchanged.

I've also set this to only fire once per session. It blocks the first time, then stays out of the way so it doesn't become noise or too invasive. 
It works through sentinel files that reset each session, and each working session gets their own set of sentinel files.

## Point it upstream, at reads

Guarding writes is the obvious move. The other interesting target is reads, because that's where the context rot actually starts.

When Claude greps for a symbol across the whole repo it can pull in hundreds of matched lines into the context, 
and depending on the task, most of them are going to be irrelevant. 
Thinking about how to be targeted helps keep the model focused. By adding a nudge on Bash, Grep and Glob, 
we can suggest better pathways based on our type of application.

```yaml
# read.yml, fires on Bash, Grep, and Glob
broad_search_advisory:
  type: warn
  once_per_session: true
  context: "Before a broad search, narrow your target. Check db/schema.rb for the exact name, or scope the search to a subdirectory like app/models."
```

A detector decides what counts as broad. A recursive grep, or a Grep with no path, trips it. 
Because it's a warn it never blocks, it just adds the nudge the moment Claude reaches for the search.

But telling the agent to narrow the search is only worth anything if there's somewhere better to send it. 
The half that pays off is what the nudge points at.

In my own Rails projects that's a few query scripts over the domain model and its classes. 
A rake task runs rails-erd and railroady over the app and writes the model graph, the controllers and the routes out to dot and JSON, whilst a
script reads them, so instead of grepping the agent asks a more precise question, about the relations and models that are available and how they connect.

```
$ bin/domain-query neighbors Event
Organisation -> Event [direct]
Event -> Participant [direct]
Event -> Activity [direct]
```

It means only a handful of edges and the context for `Event` are passed back to the LLM, 
rather than the hundreds of lines a `grep -r Event app/` could add to the context rot. 
To achieve this I add a line to the advisory context pointing the agent at a `/domain-map` skill, 
which queries the map first, and the LLM usually does much more targeted reading afterward.

Best yet, because it's deterministic, it's easy to regenerate the dot and JSON files, which the LLM is usually smart 
enough to do itself if it deems they're out of date.

The map reaches past what the usual gems capture, too. A lot of the behaviour lives in POROs and concerns namespaced 
under a model, and the same query fans out to the siblings sitting under a root model.

```
$ bin/domain-query wrappers Participant
Participant::Answers
Participant::CommunicationHistory
Participant::ContactCapabilities
Participant::DeletionSafety
Participant::Mailers
Participant::Presenter
Participant::RsvpStatusCalculator
Participant::SelfSignup
```

So before the agent reaches for the root `Participant` model and starts piling on methods, the map has already shown it where the existing behaviour lives.

It's the same idea as the write side, only pointed the other way. The combination means instead of cleaning up a bad 
edit after the fact, I've kept the junk out of the context window and course corrected before the edit's even written.

Note that if you're looking at the plugin this rule is outside of what I've included, but I do intend to provide it as its own shortly. 
In the meantime it should give you an idea of how these skills and hooks can be built on top of each other.

## Hand off to a skill

That's also one of the powerful moves that is in that `/domain-map` context line. The nudge didn't carry the whole playbook for querying the graph, it pointed at a skill that provides the details.
It defers the detail to the moment it's relevant, rather than dumping it all in the window up front.

The write side has the same trick, and unlike the domain map there's one included that lets you see the pattern. 
In the Sorbet setup I use, a rule fires when I add a Ruby method without an inline type signature. 
Instead of pulling the conventions into my session to fix it, it tells the agent to hand the job to a subagent that reads the `/rulekit:sorbet-inline-rbs` skill and signs the methods, runs `srb tc` until it's green, and reports back a line. 
The full playbook, every pattern and gotcha, never enters the main context.

## This is a pattern, not an invention

Whilst I built this in isolation since hooks came out and have been tweaking it, it's important to note that this idea came out of talks conveying the same message of course correcting the LLM using the harness.

Anthropic calls it just-in-time context, and they have their own work on skills that they call progressive disclosure. 
Late last year, they shipped the declarative layer (the regex) of the above as Hookify.

Which is great. It shows the idea has merit, the big players are already shipping native ways to do it. 
This plugin takes it a little further and adds my own flavour. And if I were a betting man, as their plugins and skills continue to grow, 
I'd be surprised if more complex patterns like the detectors weren't added to their resources. 

Detectors that read the project state, union it with the incoming edit, and name a real finding back. 
The per-session escape hatches, so a block can teach without turning into a wall. 
And the read-side guardrails, so the same idea fights context rot before it starts. 

If you're interested in digging deeper, I've packaged the lot as a Claude Code plugin called [rulekit](https://github.com/rhys117/claude-rulekit). 
It ships with a Rails preset, the write rules, detectors and read-side nudges from this post, set up for the way I like to code in a standard Rails app.

```
/plugin marketplace add https://github.com/rhys117/claude-rulekit
/plugin install rulekit@rulekit
/rules-init rails
```

> The examples and lessons learned from this article come from developing my side project, theysaidyes.rsvp. 
> We've also implemented the same strategy at Tanda, albeit with fewer rules, and are seeing its success there as well.
