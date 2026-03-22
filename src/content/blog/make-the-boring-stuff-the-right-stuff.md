---
title: "Make the Boring Stuff the Right Stuff"
description: "Encoding the right decisions into abstractions so consistency happens by default, not by intervention."
pubDate: 2026-03-22
tags: [rails, ruby, architecture, patterns]
---

In software it's easy to become victims of our own success. Fixing the same thing twice, editing the same five files for every new feature, being told we've done something the old way. How we respond to that pressure is what separates the gardeners from the firefighters. Gardeners build the paths that make the right thing the easy thing. Firefighters end up fixing the same problem again next sprint, or copy pasting the problem for later.

I've worked in codebases that had the answer to this, and ones that didn't. Joining one without it is painful in a specific way. Not because you're missing something you're used to, but because you feel the absence of a blueprint immediately. Every controller is solving a different domain problem, but they're all writing the same boring bits around the edges too. It's in those boring bits where the inconsistency creeps in the easiest, new ways of doing the same thing take hold and the older parts of the codebase get left behind.

Rails gives you a structure to build on, but it doesn't enforce how you use it. Is a turbo frame update or an HTML redirect the right response? Either works, and either is right. How do you scope the data? How do you filter it? How do you order it? There are a few completely valid answers to each. That's the problem. Once you have half the controllers doing one thing and the other half doing another, your product starts feeling inconsistent. There's no shared abstraction, no consistent structure to reach for. You repeat yourself constantly and the repetition compounds. A new developer can't look at one controller and understand what to expect from the next.

The instinct might be to write the guide, enforce the pattern in review, and hope it sticks. The problem with relying on discipline is that it doesn't scale. Abstractions are how you encode the right decisions and let the consistency happen by default, not by intervention.

The examples here are from my own side project, a wedding RSVP platform. The domain is simple enough to follow without context, but the patterns come from experience in larger organisations[^1] and how I've seen consistency maintained across a sprawling amount of code.

## Start with the data pipeline

Rails CRUD controllers look alike because they are alike. Index, show, create, update, destroy. We're doing the same dance with a different model. That repetition isn't the problem. The problem is that the decisions worth reading (like scoping, filtering, ordering, and pagination) get buried inside it.

Rails gives us the 'resource' and 'collection' terminology and RESTful routing conventions. Latch onto that and pull the data pipeline into a concern and every controller inherits it.

```ruby
module CRUDResource
  module DataAccess
    private

    def collection
      @collection ||= begin
        base = policy_scope(self.class.resource_class)
        scope = resource_config.base_scope
        scope ? instance_exec(base, &scope) : base
      end
    end

    def paginated_collection
      ordered = apply_ordering(apply_filtering(scoped_collection))
      return ordered if resource_config.paginated == false

      ordered.page(params[:page]).per(per_page)
    end

    def resource
      @resource ||= collection.find_by!(id_field => params[:id])
    end

    def before_create(resource) = before_persist(resource)
    def before_update(resource) = before_persist(resource)
    def before_persist(resource) = resource
    def after_create; end
    def after_update; end
  end
end
```

`policy_scope` ensures Pundit scoping is always applied. There's no version of this concern that forgets authorisation. `apply_filtering` runs Ransack[^2]. `apply_ordering` respects the configured sort. These run in a defined order, once, and every controller including this concern gets them.

The lifecycle hooks are where the concern earns its extensibility. `before_create`, `before_update`, and the shared `before_persist` give every controller clean extension points without overriding core methods. Need to stamp an attribute before creation?

```ruby
def before_create(resource)
  resource.event = Current.event
  resource
end
```

That's it. No overriding `create`, no copying the full method body, no leaving the next developer wondering which controller's version to use as their reference. The hook is the documented extension point. Using it correctly is the path of least resistance.

Here's what a complete controller using the module looks like.

```ruby
class GuestsController < ApplicationController
  include CRUDResource

  actions :all # [index, show, create, update, destroy, new, edit]

  configure_resource model: Participant,
                     id_field: :uuid,
                     order_by: :name

  # Used for index pages
  configure_scopes(
    confirmed: -> (collection) { collection.attending_event(event) },
    declined: -> (collection) { collection.declined_event(event) },
    not_responded: -> (collection) { collection.pending_event(event) }
  )

  # These could also easily be inferred by naming conventions
  configure_views(
    index_component: -> { Guest::IndexComponent.new(collection) },
    show_component: -> { Guest::ShowComponent.new(resource) },
    form_component: -> { Guest::FormComponent.new(resource) }
  )

  private

  def before_create(resource)
    resource.event = event
    resource
  end
end
```

That's a full CRUD resource. Scoping, filtering, ordering, authorisation, and lifecycle hooks are all handled. The only code specific to guests is the configuration at the top and the one hook that stamps the event on creation. Everything else is inherited.

## Bridge the gap between data and design system

With the data pipeline extracted, the next pain point is the view layer. Most index pages are a table. Most show pages are a panel with fields. The instinct is to share partials, but partials compound into their own mess.

I've seen what partial hell actually looks like. Locals that aren't obvious at the call site, conditionals that grow to handle every slight variation between resources, implicit dependencies on instance variables that were set three layers up. A partial that started as a clean extraction becomes fragile in ways that are hard to trace. You fix a rendering issue for one resource and break three others. You add a new resource and spend twenty minutes working out which partial to copy and which conditionals to add.

LLMs can generate partials fast, but each generation is slightly different. The variance compounds and you end up back where you started.

The better solution is resource components that compose design system building blocks. I've used this approach with JSX in a previous role and the clarity it brings is real. ViewComponent (or Phlex) brings the same structure to Rails.

A `GuestIndexComponent` composes a generic `IndexComponent`, wiring the guest specific columns into a shared table structure.

```erb
<%= render(IndexComponent.new(
  title: "Guests",
  icon: :users,
  empty_state: { title: "No guests yet" }
)) do |index| %>
  <% index.with_action(label: "New Guest", url: new_app_guest_path) %>

  <% index.with_table(sortable: true) do |table| %>
    <% table.with_header("Name", sortable: true) %>
    <% table.with_header("Email", sortable: true) %>
    <% table.with_header("RSVP Status") %>

    <% @guests.each do |guest| %>
      <% table.add_row(url: app_guest_path(guest)) do |row| %>
        <% row.add_cell { |cell| cell.with_content(guest.name) } %>
        <% row.add_cell { |cell| cell.with_content(guest.email) } %>
        <% row.add_cell { |cell| cell.with_content(render_badge(guest.rsvp_status)) } %>
      <% end %>
    <% end %>
  <% end %>
<% end %>
```

The base `IndexComponent` doesn't know what a guest or a vendor is. It knows actions, columns, rows, and how to render cell content based on type (`:string`, `:currency`, `:boolean`). Those decisions are made once and every resource inherits them. Similar components handle show and form pages the same way.

The boundary is explicit and the dependency is declared at the call site. There's no hunting for which instance variable a partial expects, no conditional that quietly handles a resource this partial wasn't originally written for. The component is self-contained and the composition is obvious.

More signal, less noise. Faster to code, faster to review, and best of all clearer in intent.

## Unify how controllers respond

The data flows through the concern and views are composed from shared components. What's left is how controllers respond after a save.

Without a shared handler, this is where consistency quietly falls apart. A junior shows a flash message on validation failure instead of re-rendering the form with errors in place. Another controller redirects on success instead of replacing a turbo frame. None of these are wrong enough to catch in review. They're just different, and the differences compound.

A single response handler prevents all of it.

```ruby
def render_for(object, component:, path:, message: nil, replace_target: nil)
  respond_to do |format|
    format.turbo_stream do
      streams = []
      streams << turbo_stream.replace(replace_target, component) if replace_target
      streams << flash_stream(message) if message
      render turbo_stream: streams
    end
    format.html { render component }
    format.json { render json: object }
  end
end
```

`save_and_respond` wraps the save attempt. On success it delegates to the response handler. On failure it re-renders the form component with errors in place — `form_component` is resolved from `configure_views`, the same configuration that declares index and show components. The controller never makes that decision itself, which is the point. The right behaviour on failure is encoded once and inherited everywhere.

```ruby
def save_and_respond(object, component:, path:, message: nil, replace_target: nil)
  if object.save
    yield if block_given?
    handle_successful_save(
      object, component: component, path: path,
      replace_target: replace_target, message: message
    )
  else
    handle_failed_save(
      object, error_component: form_component,
      replace_target: replace_target
    )
  end
end
```

With the response handling in place, the CRUD actions collapse.

```ruby
def create
  @resource = before_create(build_resource)
  @success_message ||= "#{resource_class.model_name.human} has been added."

  save_and_respond(@resource, component: show_component, ...) { after_create }
end

def update
  @resource = before_update(update_resource)
  @success_message ||= "#{resource_class.model_name.human} has been updated."

  save_and_respond(@resource, component: show_component, ...) { after_update }
end
```

The hook points are clear and the defaults are sensible. The `||=` lets a `before_action` or hook override the message earlier in the flow without touching the action itself.

## When the pattern gets pressure-tested

The guests controller fits the concern cleanly but not every resource will. The messages controller shows how you can use what works and override only what doesn't.

```ruby
class MessagesController < BaseController
  include CRUDResource

  actions :all

  configure_resource model: MassCommunication
  configure_views(
    index_component: -> {
      App::Message::IndexComponent.new(
        collection,
        message_flow: message_flow
      )
    },
    show_component: -> { App::Message::ShowComponent.new(resource) },
    form_component: -> {
      App::Message::FormComponent.new(
        resource,
        message_flow: message_flow,
        step_key: params[:step]
      )
    }
  )

  def resend
    resource.send!
    render_for(
      resource, component: show_component, path: resource_path,
      message: "Message resent to #{resource.recipient_count} guests"
    )
  end

  private

  def build_resource
    step = message_flow.resolve_step(params[:step])
    message_flow.build_mass_communication_for_step(step)
  end

  def after_create
    resource.send!
    super
  end

  def message_flow
    @message_flow ||= MessageFlow.new(event)
  end
end
```

This controller needs custom view components that take a `message_flow` the base concern knows nothing about. It overrides `build_resource` because messages are constructed through a step-based flow, not a simple `new`. `after_create` triggers a side effect of sending the message. The `resend` action is fully custom but still uses `render_for` from the response handler — it gets the same turbo stream, HTML, and JSON rendering for free without reimplementing any of it.

None of that required rewriting the pipeline. `configure_views` declares custom components at the call site. `build_resource` and `after_create` are the same hooks available to every controller, used here for heavier lifting. Custom actions like `resend` reach into the shared toolbox without reimplementing anything. The concern absorbs the complexity without the controller having to reimplement the parts that still apply: scoping, authorisation, response handling, error rendering.

That's the test of a good abstraction, it shouldn't only work for the easy cases but make the hard cases manageable without asking you to opt out of everything to handle a few differences.

## A reasonable place to stop

These three pieces work together. A controller concern handling data, resource components composing a design system, and a response handler unifying rendering.

A new resource has a clear pattern. Create a controller, include the concern, build its components, wire them in. A change to how tables render benefits every resource at once. A new developer opens a controller and knows what to expect before they've read a line.

That last part is the thing that's hard to articulate until you've felt the alternative. When the blueprint is there and working, it feels familiar. You can instantly get to the substance once you know the pattern. You're not fighting the noise. It's all signal.

You could stay here for a long time and the garden would stay tidy.

In part two, we'll take this further with a DSL and adapter layer that turns the component files into pure configuration.

[^1]: I owe a debt to Paul Jones who thought deeply about resource abstraction, and to [ActiveAdmin's resource controller](https://github.com/activeadmin/activeadmin/blob/master/app/controllers/active_admin/resource_controller.rb#L7) which follows much of this approach.
[^2]: [Ransack, Getting Started](https://activerecord-hackery.github.io/ransack/getting-started/simple-mode/)
