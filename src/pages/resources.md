---
layout: ../layouts/BaseLayout.astro
title: Resources — Rhys Murray
description: Books, talks, blogs, podcasts and tools that have shaped how I think about software.
---

# Resources

A personal thanks in my software  journey and team mentality goes to:

- Paul Jones
- Samual Horne

I wrote this after a conversation about what resources might be appropriate for 'levelling up'. These are the resources that have shaped how I think about software, and I hope they can do the same for you. This is by no means an exhaustive list, but it might be a place to start.

---

## Dev Readings

| Title | Author | Rating | Notes |
| --- | --- | --- | --- |
| The Pragmatic Programmer | David Thomas / Andrew Hunt | A | One I go back to |
| Tidy First | Kent Beck | A | Might be basic for seniors, could be a good place to start for juniors. Economics of software development chapter is worth this book alone. |
| Refactoring (Ruby edition) | Jay Fields / Fowler / Beck | A | |
| Design Patterns | Gang of Four | A | The Blueprints, but I'd probably recommend saving this one for last. |
| Domain Specific Languages | Martin Fowler | C | Good reference for vocabulary — but these feel natural in Ruby. There's better Ruby-specific resources online. |
| Domain-Driven Design | Eric Evans | B | This thing is dry. But it inspired a lot of Rails. Which is funny, because now purists suggest Rails doesn't take this far enough — Shopify take this to an nth degree. |
| Patterns of Enterprise Application Architecture | Martin Fowler | A | "Enterprise" gets a bad wrap. The philosophies here are true for any large app. |
| POODR / 99 Bottles of OOP | Sandi Metz | A | Pick one, not both. One's a reference, one's more a guide. Recommend prioritising this one. |
| Patterns of Application Development Using AI | Obie Fernandez | C | Has some decent ideas but most of this has already become common talk online. |
| The Phoenix Project | Gene Kim, Kevin Behr, George Spafford | B | DevOps focused. Draws an interesting comparison with the factory line. |

## Talks

| Talk | Speaker | Notes                                                                       |
| --- | --- |-----------------------------------------------------------------------------|
| [Solid OOP](https://www.youtube.com/watch?v=v-2yFMzxqwU&list=PLXXnezSEtvNMwlVo1fx3OZ-UUF_1G4oQi) | Sandi Metz | The config example in this talk alone is brilliant.                         |
| [Polly wants a Message](https://www.youtube.com/watch?v=XXi_FBrZQiU) | Sandi Metz |                                                                             |
| [Magic Tricks of Testing](https://www.youtube.com/watch?v=URSWYvyc42M) | Sandi Metz |                                                                             |
| [Railway Oriented Programming](https://www.youtube.com/watch?v=94ELQLqWjxM&t=424s) | Ryan Biggs |                                                                             |
| [Hammock Driven Development](https://www.youtube.com/watch?v=f84n5oFoZBc) | Rich Hickey |                                                                             |
| [Nothing is Something](https://www.youtube.com/watch?v=OMPfEXIlTVE) | Sandi Metz | Null objects.                                                               |
| [All the Little Things](https://www.youtube.com/watch?v=8bZh5LMaSmE) | Sandi Metz | Probably her most famous talk. A good start if you haven't seen her before. |

## Team Readings

| Title | Author | Rating | Notes                                                   |
| --- | --- | --- |---------------------------------------------------------|
| Multipliers | Liz Wiseman | A |                                                         |
| The Five Dysfunctions of a Team | Patrick Lencioni | A |                                                         |
| The Advantage | Patrick Lencioni | B |                                                         |
| Silos, Politics and Turf Wars | Patrick Lencioni | B | More important depending on the org you're in.          |
| The Four Obsessions of an Extraordinary Executive | Patrick Lencioni | B | Even if junior, understand how the C suite might think. |
| Extreme Ownership | Jocko Willink / Leif Babin | B |                                                         |
| Diary of a CEO | Steven Bartlett | C | The book. Not the podcast.                              |

## Blogs

- [Martin Fowler](https://martinfowler.com/). A lot more than just his blog now.
- [Kent Beck](https://tidyfirst.substack.com/). Don't need the paid version, just sign up for the freebie.
- [ThoughtBot](https://thoughtbot.com/blog)
- [Shopify Engineering](https://shopify.engineering/authors/shopify-engineering)

## Podcasts

| Title | Rating | Notes |
| --- | --- | --- |
| Ruby on Rails Podcast | B | |
| Ruby Rogues | C | |
| The Pragmatic Engineer | A | This has a blog/newsletter which is arguably more popular. |
| GoTo Podcast | A | Usually conference talks. |

## Libraries & Tools

**Rails**  

Read the internals.

**ActiveAdmin / Avo / RailsAdmin / Administrate** 

Pick one. Learn abstract resource management.

**Sorbet (runtime library only)**

Has some impressive meta programming tactics. Annotation programming isn't common in Ruby, so it's interesting to see an implementation.

**Dry Rb**

Monads is the key part — they make railway programming a breeze. The recent additions for the railtie and allowing a better schema for params looks really interesting though.

**Flog / Flay / Reek** 

Understand ABC metrics, similar code structure and code smells. The easiest way to start improving code quality in a way that's measurable. RubyCritic wraps this all up for you.

**View Components / Phlex**

Subjective, but the view layer in Rails is one of its weakest links. These are a step in the right direction.

---

## Wild Thoughts

I love Rails, and DHH, 37s and the community have built an insanely awesome framework. In the same breath, I am personally not amazed by their products (basecamp/hey). I say that as a hey user.
