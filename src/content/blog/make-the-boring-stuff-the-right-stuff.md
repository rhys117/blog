---
title: "Rails on Rails"
description: "Encoding the right decisions into abstractions so consistency happens by default, not by intervention."
pubDate: 2026-03-22
tags: [rails, ruby, architecture, patterns]
---

Rails gives you a structure to build on, but it doesn't enforce how you use it. Is a turbo frame update or an HTML redirect the right response? Either works. How do you scope the data? How do you filter it? There are a few completely valid answers to each. That's the problem. Once you have half the controllers doing one thing and the other half doing another, your product starts feeling inconsistent. Without shared abstractions there isn't a consistent structure to reach for. By looking at one example, you wouldn't know what to expect from the next.

If you've worked with a blueprint that tackles the boring pieces for you before, the absence of one is immediately noticeable. It's in the boring bits where inconsistency creeps in the easiest. The instinct is to write a guide and enforce patterns in review whilst hoping that's enough. The problem with relying on discipline is that it doesn't scale. Abstractions are how you encode the right decisions and let the consistency happen by default, not by intervention.

Three layers carry most of that weight, how data flows in (scoping, filtering, ordering), how views compose against a design system, and how controllers respond after a save. Each is a place where small inconsistencies compound, and they're the examples we'll look at here.

## The shape of the thing

Before drilling into the pieces, here's the full concern at the top level[^1].

```ruby
module CRUDResource
  extend ActiveSupport::Concern

  include Configuration
  include DataAccess
  include Authorization
  include Actions
  include Routes
  include CRUD
  include ::ResponseHandling
end
```

Think of this as a map, or contents, rather than a definition. This article covers `DataAccess` and
`ResponseHandling`, the data pipeline and the response layer. The configuration DSL and
action generation that sit between them are for part two.

`ResponseHandling` sits outside the `CRUDResource` namespace deliberately. It's useful
enough on its own that controllers outside this pattern reach for it too.

## Start with the data pipeline

Rails CRUD controllers look alike because they are alike. Index, show, create, update,
destroy. We're doing the same dance with a different model. That repetition isn't the
problem. The problem is that the decisions worth reading (scoping, filtering, ordering,
and pagination) get buried inside it.

Rails gives us the 'resource' and 'collection' terminology and RESTful routing conventions.
Latch onto that and pull the data pipeline into a concern and every controller inherits it.

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

    def before_create(resource) = before_save(resource)
    def before_update(resource) = before_save(resource)
    def before_save(resource) = resource
    def after_create; end
    def after_update; end
  end
end
```

`policy_scope` ensures Pundit scoping is always applied. There's no version of this concern
that forgets authorisation. `apply_filtering` runs Ransack[^2]. `apply_ordering` respects
the configured sort. These run in a defined order, once, and every controller including
this concern gets them.

The lifecycle hooks are what make the concern extensible. `before_create`,
`before_update`, and the shared `before_save` give every controller clean extension
points without overriding core methods. Need to set an attribute before creation?

```ruby
def before_create(resource)
  resource.event = Current.event
  resource
end
```

That's it. No overriding `create`, no copying the full method body, no leaving the next developer wondering which controller's version to use as their reference. This is the template method pattern[^3], the concern defines the algorithm, the hooks are the extension points. Using it correctly is the path of least resistance.

Here's what a complete controller using the module looks like.

```ruby
class GuestsController < ApplicationController
  include CRUDResource

  actions :all # [index, show, create, update, destroy, new, edit]

  configure_resource model: Participant,
                     id_field: :uuid,
                     order_by: :name

  # Named scopes become tab-like filters on the index page,
  # driven by a query param and applied to the collection automatically.
  configure_scopes(
    confirmed: -> (collection) { collection.attending_event(Current.event) },
    declined: -> (collection) { collection.declined_event(Current.event) },
    not_responded: -> (collection) { collection.pending_event(Current.event) }
  )

  # These could also easily be inferred by naming conventions
  configure_views(
    index_component: -> { Guest::IndexComponent.new(collection) },
    show_component: -> { Guest::ShowComponent.new(resource) },
    form_component: -> { Guest::FormComponent.new(resource) }
  )

  private

  def before_create(resource)
    resource.event = Current.event
    resource
  end
  
  def permitted_params
    params.require(:event).permit(
      :first_name, :last_name, :email, :mobile, :allowed_plus_ones, #...
    )
  end
end
```

That's a full CRUD resource. Scoping, filtering, ordering, authorisation, and lifecycle hooks are all handled. The only code specific to guests is the configuration at the top, the one hook that stamps the event on creation and the permitted params for the resource. Everything else is inherited.

It's worth noting that `configure_views` is only necessary because we're using ViewComponents. With standard partials, Rails' conventional view lookup would resolve `guests/index`, `guests/show`, and `guests/_form` automatically and this configuration wouldn't be needed at all.

## Bridge the gap between data and design system

With the data pipeline extracted, the next pain point is the view layer. Most index pages are a table and most show pages are a panel with fields. The instinct is to share partials, but anyone who's maintained a mature Rails app knows where that leads.

LLMs make this worse, not better. They can generate partials fast, but each generation is slightly different. Without a shared structure to compose against, the variance compounds faster than it would by hand.

The better solution is resource components that compose design system building blocks. I've used this approach with JSX in a previous role and the clarity it brings is real. ViewComponent (or Phlex) brings the same structure to Rails.

Here's the template for `GuestIndexComponent`, a resource-specific ViewComponent whose job is to compose the generic `IndexComponent` with guest-specific columns.

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

    <% @collection.each do |guest| %>
      <% table.add_row(url: app_guest_path(guest)) do |row| %>
        <% row.add_cell { |cell| cell.with_content(guest.name) } %>
        <% row.add_cell { |cell| cell.with_content(guest.email) } %>
        <% row.add_cell { |cell| cell.with_content(render_badge(guest.rsvp_status)) } %>
      <% end %>
    <% end %>
  <% end %>
<% end %>
```

The base `IndexComponent` doesn't know what a guest or a vendor is. It knows actions, columns, rows, and how to render cell content based on type (`:string`, `:currency`,`:boolean`). Those decisions are made once and every resource inherits them. Similar components handle show and form pages the same way.

The boundary is explicit and the dependency is declared at the call site. There's no hunting for which instance variable a partial expects, no conditional that quietly handles a resource this partial wasn't originally written for. The component is self-contained and the composition is obvious.

More signal, less noise. Faster to code, faster to review, and clearer in intent.

## Unify how controllers respond

The data flows through the concern and views are composed from shared components. What's left is how controllers respond after a save.

Without a shared handler, this is where consistency quietly falls apart. A junior shows a flash message on validation failure instead of re-rendering the form with errors in place. Another controller redirects on success instead of replacing a turbo frame. None of these are wrong enough to catch in review. They're just different, and the differences compound.

Abstracting the response handling prevents the drift in styles. `save_and_respond` wraps the save attempt, when it's a success, it always responds in a consistent manner. On failure it re-renders the form component with errors in place, `form_component` is resolved from `configure_views`, the same configuration that declares index and show components. The controller never makes that decision itself, which is the point. The right behaviour for both success and failures is encoded once and inherited everywhere.

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

Both paths eventually call `render_for`, which handles format negotiation once for every controller.

```ruby
def render_for(object, component:, message: nil, replace_target: nil)
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

The hook points are clear and the defaults are sensible. `||=` lets a `before_action` or hook override the message earlier in the flow without touching the action itself, so that overriding these and calling `super` is always an option.

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
  end

  def message_flow
    @message_flow ||= MessageFlow.new(Current.event)
  end
  
  def resource_params  
    params.require(:mass_communication).permit(  
      :owner_id, :owner_type, :dynamic_group, :kind, :body, :subject, :template
    )
  end
end
```

This controller needs more complex components that take a `message_flow`. It overrides `build_resource` because messages are constructed through a step-based flow, not a simple `new` call. `after_create` triggers a side effect of sending the message. The `resend` action is fully custom but still uses `render_for` from the response handler, it gets the same turbo stream, HTML, and JSON rendering for free without reimplementing any of it.

None of that required rewriting the pipeline. `build_resource` and `after_create` are the same hooks available to every controller, used here for heavier lifting. Custom actions like `resend` reach into the shared toolbox without reimplementing anything. The concern absorbs the complexity without the controller having to reimplement the parts that still apply: scoping, authorisation, response handling, error rendering.

That's the test of a good abstraction. It shouldn't only work for the easy cases but make the hard cases manageable without asking you to opt out of everything to handle a few differences.

## The costs

The concern earns its keep when the work it absorbs outweighs what it adds in indirection. Indirection is a real cost. A developer debugging a scoping issue has to understand `DataAccess`  before they can find where to look. A new team member has to learn the abstraction before they can contribute comfortably. Neither of those is free.

There's also a threshold worth naming. The MessagesController overrides two hooks and one method, the concern still does most of the work. If a controller is overriding five things and the shared behaviour is down to response handling, you're probably better served writing it plainly and only using the `ResponseHandler`. Once you start fighting the abstraction, bail on it, fall back to writing a controller from scratch and include what makes sense if anything at all. You don't need to shoehorn everything into this one pattern. It's a default, not an absolute.

Build this when you have more than a handful of CRUD resources and a design system to compose against. Don't leave it to a massive refactor on a mature product.

It's worth noting that some of the cost is mitigated by naming conventions that fit the Rails framework, the hooks should still feel natural to a Rails developer thanks to the conventions you get for free with Rails.

## A reasonable place to stop

These three pieces work together. A controller concern handling data, resource components composing a design system, and a response handler unifying rendering.

A new resource has a clear pattern. Create a controller, include the concern, build its components, wire them in. A change to how tables render benefits every resource at once. A new developer opens a controller and knows what to expect before they've read a line.

The discipline from here is resisting the urge to keep growing the base. Every edge case that gets folded into the concern makes it harder to understand for everyone else. The hooks exist so that individual controllers can handle their own complexity. If a new requirement doesn't clearly belong in the shared layer, it belongs in the controller. Be deliberate about what earns a place in the abstraction and let the hooks absorb the rest.

That last part is the thing that's hard to articulate until you've felt the alternative. When the blueprint is there and working, it feels familiar. You can get straight to the substance once you know the pattern. You're not fighting the noise. It's all signal.

--- 

## A next step

In a follow up part two, the `configure_views` lambdas, permitted params, and component wiring collapse into a single declarative adapter class. It delivers the power of frameworks like ActiveAdmin without sacrificing the ability to customise. That's all for next time, but here's what a `GuestAdapter` looks like in practice:

```ruby
class GuestAdapter < ResourceAdapter
  param_key :participant
  permit :first_name, :last_name, :email, :mobile, :allowed_plus_ones

  index do
    title 'Guests'
    icon :users
    row_url { |guest| app_guest_path(guest.uuid) }

    column :full_name, header: 'Name', sortable: true, type: :header
    column :email, sortable: true
  end

  show do
    title(&:full_name)

    field :email, icon: :email
    field :mobile, icon: :phone
    field(:tags, render: :badges) { |guest| guest.groups.map(&:name) }
  end

  form do
    inputs 'Personal Information' do
      input :first_name
      input :last_name
      input :email
      input :mobile
    end
  end
end
```


[^1]: The examples here are from a side project but the patterns come from experience in larger organisations. I owe a debt to Paul Jones who thought deeply about resource abstraction, and to
[ActiveAdmin's resource controller](https://github.com/activeadmin/activeadmin/blob/master/app/controllers/active_admin/resource_controller.rb#L7) which follows much of this approach.

[^2]: [Ransack, Getting Started](https://activerecord-hackery.github.io/ransack/getting-started/simple-mode/)

[^3]: [GoF Template Method](https://refactoring.guru/design-patterns/template-method)
