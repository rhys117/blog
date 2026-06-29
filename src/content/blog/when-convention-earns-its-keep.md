---
title: "The Shape of the Thing: When Convention Earns Its Keep"
description: "A DSL and adapter layer that lives inside your Rails app, not alongside it."
draft: true
pubDate: 2026-05-27
tags: [rails, ruby, architecture, patterns]
---

The three concerns from the [previous piece](/blog/rails-on-rails) hold for a long time. The data pipeline, the component layer, the response handler. A new resource is a controller, a concern, and a handful of components. Consistent, clear, and it still feels railsey to a vanilla Rails dev.

This piece goes a step further. It irons out a few of my own gripes with the view layer, so that as a project grows it stays nimble and covers a lot of surface with very little code.

Because by the time you're writing your tenth set of components for a resource (`Vendor::IndexComponent`, `Vendor::ShowComponent`, `Vendor::FormComponent`), each one is much the same as the last. The same generic building blocks composed again, with different columns, different fields, different labels.

```ruby
# app/components/vendor/index_component.rb
class Vendor::IndexComponent < ViewComponent::Base
  def initialize(collection:)
    @vendors = collection
  end

  # renders IndexComponent with columns: name, email, total_amount
  # row URL: app_vendor_path(vendor)
  # empty state: "No vendors yet"
end

# app/components/guest/index_component.rb
class Guest::IndexComponent < ViewComponent::Base
  def initialize(collection:)
    @guests = collection
  end

  # renders IndexComponent with columns: name, email, rsvp_status
  # row URL: app_guest_path(guest)
  # empty state: "No guests yet"
end
```

Multiply that across index, show, and form for every resource and you're maintaining a pile of files that are really just configuration wearing a component's clothes.

So the question became whether the generic components could configure themselves. Instead of building a `Vendor::IndexComponent` that tells `IndexComponent` which columns to render, declare the columns once and let the generic component read them directly.

## The adapter

```ruby
class VendorAdapter < ResourceAdapter
  permit :name, :email, :phone, :total_amount, :budget_category_id, :description,
         address_attributes: [:id, :_destroy, :line_1, :line_2, :city, :state, :postcode, :country]
  coerce_blank_to_destroy :address_attributes

  show do
    title(&:name)
    icon :building

    actions do
      edit_action data: {turbo: false}
      delete_action
    end

    field(:budget_category, label: 'Category') { |vendor| vendor.budget_category&.name }
    fields :email, :phone
    field :total_amount, label: 'Total Amount', render: :currency
    field :total_paid,   label: 'Amount Paid',  render: :currency
    field :balance_due,  label: 'Balance Due',  render: :currency

    embed :payments do |vendor|
      embedded_table_frame 'vendor_payments_table', src: app_vendor_payments_path(vendor)
    end
  end

  index do
    title 'Vendors'
    icon :building
    frame_id 'vendors_table'
    row_url { |vendor| app_vendor_path(vendor) }
    empty_state title: 'No vendors yet',
      description: 'When you add vendors they will appear here.', icon: :building

    column :name,         header: 'Name', sortable: true, type: :header
    column :email,        sortable: true
    column :total_amount, header: 'Total Amount', sortable: true, render: :currency

    filters { auto }
    actions { new_action label: 'New Vendor', data: {turbo_frame: 'vendors_table'} }
  end

  form do
    inputs 'Vendor Information' do
      input :name
      input :email
      input :phone
      input :total_amount
      address :address
    end
  end
end
```

One file. Show page, index table, form, and strong params, all declared in the one place. The controller reflects that.

```ruby
class App::VendorsController < App::BaseController
  include CRUDResource

  actions except: [:index, :new, :create]
  configure_resource model: Vendor
end
```

That's the controller. The model is set by `configure_resource`, and the adapter is inferred from the name. Vendors are created and listed from within their budget category, so this controller only needs show, edit, update, and destroy. The generic `IndexComponent` reads the adapter's column definitions. The `ShowComponent` reads the field definitions. The `FormComponent` reads the input definitions. No resource-specific component files at all.

When a controller needs to reach into the lifecycle, the template method hooks from part one are still there. `App::GuestsController` stamps the event on creation before the record saves.

```ruby
private

def before_create(resource)
  resource.event = event
  resource
end
```

The three concerns from article one are still doing the work. The adapter just removed the wiring between them. Data still flows through `DataAccess`. Responses still go through `render_for`. The components are the same design system building blocks. The adapter is the configuration layer that replaced the per-resource component files.

## Not ActiveAdmin

You've just seen the adapter. `column :name, sortable: true` is a good sentence in any DSL, and I didn't invent the idea that a resource's UI can be declared rather than assembled. I took that from ActiveAdmin.

If you've worked with Rails long enough, you've probably reached for it. The popular gem solves the same problem with a DSL that declares resources, columns, filters, and forms. It works well until it doesn't, and where it doesn't is usually the moment you want to customise something deeply.

The core issue is that ActiveAdmin gives you an application. Its own controllers, its own views, its own layout, its own CSS, its own asset pipeline. It doesn't take the standard way and build on top. It feels like it ejects entirely.

You're building inside ActiveAdmin's world, and the moment you need something it didn't anticipate you're fighting its rendering pipeline to break back out. Custom pages mean learning ActiveAdmin's page DSL. Custom actions mean hooking into its controller lifecycle. Custom styling means overriding its theme. The escape hatches aren't as intuitive as you'd hope. Which is a shame, because before I rag on it (the way a lot of the community does now) I want to be fair. For what it does, it does incredibly well. You just have to know upfront that it isn't friendly the moment you work outside its usual parameters.

Avo and Administrate came along to fill some of those gaps. Whilst I liked a lot of what they offered, to my eye they all stopped just short of being as beautiful as the declarative layer ActiveAdmin nails.

So as plain experimentation, I set out to see whether I could build that declarative layer on top of ordinary Rails controllers, and whether it was worth the effort. The conclusion was a resounding yes. I'll grant I might be looking at it through rose-coloured glasses, given I'm the one who wrote it.

What I took was the declaration. What I didn't want was the rest. The parallel universe. The separate admin app that happens to live in the same repository. The adapter feeds ViewComponents, rendered in my layout, styled by my design system. When you override the show page, you're writing a normal ViewComponent. When you drop the adapter entirely, you still have a normal Rails controller. Opting out isn't climbing through a window. It's walking through the front door.

## Convention before configuration

The `VendorAdapter` above is the refined version. You don't have to start there.

`ResourceAdapter` ships a `default_for_model` that reflects the model's columns, infers a title method, strips system and foreign key columns, and auto-configures show, index, form, CSV, and JSON.

```ruby
class ResourceAdapter
  SYSTEM_COLUMNS = %w[id created_at updated_at].freeze
  TITLE_METHODS  = %i[name title full_name].freeze

  def self.default_for_model(model_class)
    meta = default_model_metadata(model_class)

    klass = Class.new(self) do
      param_key model_class.model_name.param_key.to_sym
      permit(*meta[:display_columns])
      default_show_definition(meta)
      default_index_definition(meta)
      default_form_definition(meta)
      csv  { columns(*meta[:all_columns]) }
      json { attributes(*meta[:all_columns]) }
    end

    name = "#{model_class.name}DefaultAdapter"
    const_set(name, klass) unless const_defined?(name)
    klass
  end
end
```

A resource with no adapter at all gets a reasonable default for free. A controller resolves to its model, and if there's no hand-written adapter it falls back to `default_for_model`. Each display column becomes a sortable column. Booleans render with `:boolean` and text columns are skipped. The anonymous subclass is const-set with a readable name so backtraces stay legible. No filters until you ask for them, which you do with a `filters do auto end` block on the real adapter. The hand-crafted adapter is the override path, not the starting point.

This matters for pace. A new resource can be scaffolded and working in minutes. The adapter comes later, when you know what the page actually needs. Convention first, configuration when it earns its keep.

## Where composition gets interesting

This pattern could work in any MVC framework. What makes it sing in Rails is Turbo Frames.

A vendor's show page has fields, payments, and notes. Payments and notes are their own resources with their own CRUD lifecycle. The traditional options aren't great. Either a monolithic controller that manages all three, or scattered controllers stitched together with redirect logic. Neither scales, and both make the code harder to follow.

Turbo Frames let us decompose the page cleanly. The vendor adapter declares where embedded resources appear, and the `embedded_table_frame` helper expands to a lazy-loaded frame that morphs on refresh.

```ruby
show do
  # ... fields and actions ...

  embed :payments do |vendor|
    embedded_table_frame 'vendor_payments_table', src: app_vendor_payments_path(vendor)
  end
end
```

The payments controller is its own standard CRUD controller, with its own adapter and authorisation.

```ruby
class App::Vendor::PaymentsController < App::BaseController
  include CRUDResource
  include VendorScoped

  actions except: :show
  configure_resource model: VendorPayment, adapter: VendorPaymentAdapter,
    order: {payment_date: :desc}

  embedded_in(
    section_title: 'Payment',
    path: -> { app_vendor_path(vendor, anchor: 'vendor_payments_table') },
    after_save_streams: -> {
      vendor.reload
      [turbo_stream.replace(
        helpers.dom_id(vendor, :show_fields),
        UI.resource_show_fields(adapter: VendorAdapter.new(vendor))
      )]
    }
  )
end
```

`embedded_in` just stores the configuration on `resource_config`. It doesn't register a `before_action`, and it doesn't take the frame to replace as an argument. All of that is read back later. The route methods swap the embedded `path` in for every resolved route, and `save_and_render` picks up the after-save streams.

The frame to replace isn't derived from the path. It's the id of the Turbo Frame that submitted the request, falling back to the record's form `dom_id`. `render_for` receives that as `replace_target`. The `path` anchor (`vendor_payments_table`) only drives the history entry and the scroll position. The two line up because the form submits from inside the `vendor_payments_table` frame.

`after_save_streams` is the other half. It lets the child push updates to sibling frames on the parent page. So when a payment is saved, the response replaces the payments table and re-renders the vendor's summary fields. Balance due updates without a full page reload.

That's the multiplier. Every embedded controller gets the full CRUD lifecycle for free. The composition happens through Turbo Frames, not through a god controller. Each resource keeps its own authorisation, its own adapter, its own tests. The page is assembled from independent pieces that don't know about each other.

And this only works because the pattern lives inside the application. ActiveAdmin can't do this, because its controllers live in a separate namespace with separate routing. Turbo Frames need real controllers serving real responses. The adapter composes naturally because it never left Rails.

## The gradient

Most abstractions work on the happy path then force you to eject entirely when you need something non-standard. The goal here is the opposite. Use as much or as little as the problem demands.

At full convention, a resource is one adapter file and a short controller. The `App::VendorsController` above. No components, no templates, no view wiring.

One rung down, override just the message. The CRUD concern uses `||=` for its defaults, so setting `@success_message` before calling `super` is all it takes. `App::GuestSharesController` casts the incoming flag, sets the message and the frame to replace, then lets the rest of the update flow run unchanged.

```ruby
def update
  new_enabled_state = ActiveModel::Type::Boolean.new.cast(resource_params[:enabled])

  @success_message = "Photo sharing has been #{new_enabled_state ? 'enabled' : 'disabled'}"
  @replace_target  = 'photo_sharing_container'
  super
end
```

Further down, override the views that need it and keep the rest adapter-driven. `App::BudgetCategoriesController` swaps in its own show and form components whilst the index stays adapter-driven. Categories are managed from the Budget page, so there's no navigable index. The point here is just that the index is left to the adapter.

```ruby
class App::BudgetCategoriesController < App::BaseController
  include CRUDResource

  actions :all
  configure_resource model: BudgetCategory

  configure_views(
    show_component: -> {
      UI.resource_show(
        adapter: BudgetCategoryAdapter.new(resource),
        turbo_frame_id: helpers.dom_id(resource, 'form')
      )
    }
    # form_component is overridden too; index_component is left unset, so the index stays adapter-driven
  )
end
```

Further still, drop the adapter entirely. `App::Guest::CommunicationsController` uses `actions :none`, supplies its own component, and adds custom actions. It still gets Pundit scoping, the data pipeline, route resolution, and the response handler. Take what you need, leave the rest.

```ruby
class App::Guest::CommunicationsController < App::BaseController
  include CRUDResource

  actions :none
  configure_resource model: Communication
  configure_views(
    show_component: -> { App::Guest::CommunicationsComponent.new(participant: participant) }
  )

  def send_rsvp_email
    resource.save_and_send!

    render_for(
      resource,
      component: show_component,
      path: resource_path,
      replace_target: 'guest_communications',
      message: 'Communication sent.'
    )
  end
end
```

And at the far end, `App::SeatingChart::AssignmentsController` doesn't include `CRUDResource` at all. It's a normal Rails controller with custom `assign`, `unassign`, and `rename` actions rendering turbo streams directly. No adapter, no concern, no convention. That's fine. The pattern earns trust precisely because opting out entirely is a legitimate choice, not a failure.

Every point on this gradient is a real controller in production. None of them is an escape hatch. They're all just Rails, with varying amounts of convention applied.

> **TODO:** The NotificationAdapter story. You built a `NotificationAdapter` and it was wrong. What happened? Did the resource not fit the CRUD shape, or did the adapter make a simple thing complicated? Write the failure honestly. This is what makes the gradient argument credible. Without it the whole section reads as a sales pitch.

## Testing the contract, not the configuration

When the mechanics are shared, the testing strategy inverts. Instead of testing every resource's index, show, and form, you cover the layers once.

The generic `IndexComponent` gets a thorough spec. Does it render columns, handle sorting, apply filters, show empty states? The response handler gets its own, covering format negotiation, turbo frame replacement, and flash messages. The DSL gets one too. Does `column :name, sortable: true` produce the right `Column` object with the right attributes?

Once those layers are covered, a simple adapter like `VendorAdapter` has very little left that's interesting to test. The columns it declares are just configuration. The interesting decisions (how columns render, how sorting works, how frames compose) are already covered.

A meta-spec that discovers and validates every adapter in the system closes the last gap. It iterates the adapters and checks that every declared field corresponds to a real model attribute or carries a block. Convention enforcement stops being a habit. Add an adapter with a field the model doesn't respond to and the build fails.

```ruby
ResourceAdapter.descendants.each do |adapter_class|
  describe adapter_class do
    it 'declares valid fields' do
      adapter_class.show_definition.resolved_show_fields.each do |field|
        expect(field.name).to be_a(Symbol)
        next if field.block

        expect(model_class.method_defined?(field.name)).to be(true),
          "#{adapter_class}#show declares :#{field.name} but #{model_class} doesn't respond to it"
      end
    end
  end
end
```

The payoff is that simple adapters can skip tests entirely, which keeps the suite fast and focused on what's genuinely unique to each resource. A field that wraps a block doing real work? Test that. The fact that an adapter declares a `:name` column? Already covered.

## When the shortcut becomes a detour

> **TODO:** This section needs the NotificationAdapter story. What happened when you reached for the pattern and it made things worse? The sign that you've reached for it too early, or that the resource doesn't fit the CRUD shape. One concrete story, then the general lesson.

The pattern is a shortcut through Rails, not a detour around it. When it works, a new resource with a table, show page, form, CSV export, and JSON API is one adapter file and a short controller. When it partially works, you override the piece that doesn't fit and keep the rest. When it doesn't work at all, you write a normal Rails controller and nothing breaks.

That gradient is the thing that matters. Not the DSL, not the adapter, not the convention. The gradient. The ability to start at full convention and peel it back, rung by rung, until you're writing plain Rails again. Every point along the way is a reasonable place to stand.

> **TODO:** Closing paragraph. Land the whole two-part argument. Article 1 ended on signal vs noise, on the garden staying tidy. What's the version of that for someone who's built the full system? The feeling of working in a codebase where the pattern handles the routine so you can focus on the parts that are actually interesting.
