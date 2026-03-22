---
title: "When Convention Earns Its Keep"
description: "A DSL and adapter layer that lives inside your Rails app, not alongside it."
draft: true
pubDate: 2026-03-22
tags: [rails, ruby, architecture, patterns]
---

The three concerns from the [previous piece](/blog/make-the-boring-stuff-the-right-stuff) hold for a long time. The data pipeline, the component layer, the response handler. A new resource is a controller, a concern, a handful of components. Consistent, clear, reviewable.

What pushed me further was something specific. I was reviewing a PR that added a new resource — a `VendorIndexComponent`, a `VendorShowComponent`, a `VendorFormComponent`. Each one composed the same generic building blocks with different columns, different fields, different labels. I looked at it next to the guest components from the week before and they were almost identical.

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

Same structure. Different columns, different row links, different empty state text. That's it. Multiply this across index, show, and form for every resource and you're maintaining a lot of files that are really just configuration wearing a component's clothes.

The question became whether the generic components could configure themselves. Instead of building a `VendorIndexComponent` that tells `IndexComponent` which columns to render, declare the columns once and let the generic component read them directly.

## Not ActiveAdmin

If you've done Rails long enough, you've seen this before. ActiveAdmin solves the same problem with a DSL that declares resources, columns, filters, and forms. It works well until it doesn't, and when it doesn't, it fails badly.

The core issue is that ActiveAdmin gives you an application. It has its own controllers, its own views, its own layout, its own CSS, its own asset pipeline. You're building inside ActiveAdmin's world, and the moment you need something it didn't anticipate, you're fighting its rendering pipeline to break out. Custom pages require learning ActiveAdmin's page DSL. Custom actions mean hooking into its controller lifecycle. Custom styling means overriding its theme. The escape hatch is climbing through a window.

I took something specific from ActiveAdmin: the idea that a resource's UI can be declared rather than assembled. `column :name, sortable: true` is a good sentence in any DSL. What I didn't want was the rest. The parallel universe. The separate admin app that happens to live in the same repository.

The adapter I built feeds ViewComponents, rendered in my layout, styled by my design system. There's no parallel universe. When you override the show page, you're writing a normal ViewComponent. When you drop the adapter entirely, you still have a normal Rails controller. Opting out isn't climbing through a window. It's walking through the front door.

## The adapter

```ruby
class VendorAdapter < ResourceAdapter
  permit :name, :email, :phone, :specialties, :total_amount,
         address_attributes: [:id, :_destroy, :line_1, :line_2, :city, :state, :postcode, :country]

  show do
    title(&:name)
    icon :building

    actions do
      edit_action
      delete_action confirm: 'Are you sure you want to delete this vendor?'
    end

    fields :email, :phone, :specialties
    field :total_amount, label: 'Total Amount', render: :currency
    field(:balance_due, label: 'Balance Due', render: :currency) { |v| v.total_amount - v.total_payments }
  end

  index do
    title 'Vendors'
    icon :building
    row_url { |vendor| app_vendor_path(vendor) }
    empty_state title: 'No vendors yet', icon: :building

    column :name, header: 'Name', sortable: true, filter_type: :search, type: :header
    column :email, sortable: true, filter_type: :search
    column :total_amount, header: 'Total Amount', sortable: true, render: :currency

    actions do
      new_action label: 'New Vendor'
    end
  end

  form do
    title 'Vendor'
    inputs 'Vendor Information' do
      input :name
      input :specialties
      input :email
      input :phone
      input :total_amount
      address :address
    end
  end
end
```

One file. A show page, index table, form, and strong params are all declared. The controller reflects that.

```ruby
class VendorsController < App::BaseController
  include CRUDResource

  actions :all

  private

  def before_create(resource)
    resource.event = Current.event
    resource
  end
end
```

Four lines and a hook. The model is discovered by convention — `VendorsController` resolves to `Vendor`, the adapter is inferred from that. The generic `IndexComponent` reads the adapter's column definitions. The generic `ShowComponent` reads the field definitions. The generic `FormComponent` reads the input definitions. No resource-specific component files at all.

The three concerns from article one are still doing the work. The adapter just removed the wiring between them. Data still flows through `DataAccess`. Responses still go through `render_for`. The components are the same design system building blocks. The adapter is the configuration layer that replaced the per-resource component files.

## Convention before configuration

The `VendorAdapter` above is the refined version. You don't have to start there.

`ResourceAdapter` ships a `default_for_model` that reflects the model's columns, infers a title method, strips system and foreign key columns, and auto-configures show, index, form, CSV, and JSON.

```ruby
class ResourceAdapter
  SYSTEM_COLUMNS = %w[id created_at updated_at].freeze
  TITLE_METHODS = %i[name title full_name].freeze

  def self.default_for_model(model_class)
    meta = default_model_metadata(model_class)

    Class.new(self) do
      param_key model_class.model_name.param_key.to_sym
      permit(*meta[:non_system])
      default_show_definition(meta)
      default_index_definition(meta)
      default_form_definition(meta)
      csv  { columns(*meta[:all_columns]) }
      json { attributes(*meta[:all_columns]) }
    end
  end
end
```

A resource with no adapter at all gets a reasonable default for free. `VendorsController` resolves to `Vendor`, finds no `VendorAdapter`, falls back to `default_for_model(Vendor)`. Columns become table headers. String columns get a search filter. Booleans render as badges. The hand-crafted adapter is the override path, not the starting point.

This matters for pace. A new resource can be scaffolded and working in minutes. The adapter comes later, when you know what the page actually needs. Convention first, configuration when it earns its keep.

## Where composition gets interesting

This pattern could work in any MVC framework. What makes it particularly effective in Rails is Turbo Frames.

A vendor's show page has fields, payments, and notes. Payments and notes are their own resources with their own CRUD lifecycle. The traditional options aren't great — a monolithic controller that manages all three, or scattered controllers stitched together with redirect logic. Neither scales well and both make the code harder to follow.

Turbo Frames let us decompose the page cleanly. The vendor adapter declares where embedded resources appear.

```ruby
show do
  # ... fields and actions ...

  embed :payments do |vendor|
    turbo_frame_tag 'vendor_payments_table',
      src: app_vendor_payments_path(vendor), loading: :lazy
  end
end
```

The payments controller is its own standard CRUD controller with its own adapter and authorisation.

```ruby
class App::Vendor::PaymentsController < App::BaseController
  include CRUDResource

  actions except: :show
  configure_resource model: VendorPayment

  embedded_in(
    section_title: 'Payment',
    path: -> { app_vendor_path(vendor, anchor: 'vendor_payments_table') },
    turbo_frame: 'vendor_payments_table',
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

`embedded_in` does three things: stores the configuration, registers a `before_action` that tells `render_for` which frame to replace, and provides `after_save_streams` so the child can push updates to sibling frames on the parent page. When a payment is saved, the response replaces the payments table *and* re-renders the vendor's summary fields. Balance due updates without a full page reload.

This is the pattern's multiplier. Every embedded controller gets the full CRUD lifecycle for free. The composition happens through Turbo Frames, not through a god controller. Each resource has its own authorisation, its own adapter, its own tests. The page is assembled from independent pieces that don't know about each other.

This only works because the pattern lives inside the application. ActiveAdmin can't do this because its controllers live in a separate namespace with separate routing. Turbo Frames need real controllers serving real responses. The adapter pattern composes naturally because it never left Rails.

## The gradient

Most abstractions work on the happy path but force you to eject entirely when you need something non-standard. The goal here is the opposite — use as much or as little as the problem demands.

At full convention, a resource is one adapter file and a four-line controller. The `VendorsController` above. No components, no templates, no view wiring.

One step down, override just the message. The CRUD concern uses `||=` for its defaults, so setting `@success_message` before calling `super` is all it takes. The rest of the update flow runs unchanged.

```ruby
def update
  @success_message = "Photo sharing has been #{new_enabled_state ? 'enabled' : 'disabled'}"
  super
end
```

Further down, override one view and keep the rest. `SharedPhotoConfigurationsController` uses a custom show component but the adapter-driven index and form are untouched.

```ruby
configure_views(
  show_component: -> {
    App::SharedPhotoConfiguration::ShowComponent.new(
      shared_photo_configuration: resource,
      photos_facade: photos_facade
    )
  }
)
```

Further still, drop the adapter entirely. `GuestCommunicationsController` uses `actions :none`, provides its own component, and adds custom actions. But it still gets Pundit scoping, the data pipeline, route resolution, and the response handler. Take what you need, leave the rest.

```ruby
class App::GuestCommunicationsController < App::BaseController
  include CRUDResource

  actions :none
  configure_resource model: Communication

  configure_views(
    show_component: -> { App::Guest::CommunicationsComponent.new(participant: participant) }
  )

  def send_rsvp_email
    render_for(resource, component: show_component, path: resource_path, message: 'Email sent')
  end
end
```

And at the far end, `SeatingChart::AssignmentsController` doesn't include `CRUDResource` at all. It's a normal Rails controller. No adapter, no concern, no convention. That's fine. The pattern earns trust precisely because opting out entirely is a legitimate choice, not a failure.

Every point on this gradient is a real controller in production. None of them is an escape hatch. They're all just Rails, with varying amounts of convention applied.

> **TODO:** The NotificationAdapter story. You built a `NotificationAdapter` and it was wrong. What happened? Did the resource not fit the CRUD shape? Did the adapter make a simple thing complicated? Write the failure honestly — this is what makes the gradient argument credible. Without it, the whole section reads as sales pitch.

## Testing the contract, not the configuration

When the mechanics are shared, the testing strategy inverts. Instead of testing every resource's index page, show page, and form, you cover the layers once.

The generic `IndexComponent` gets a thorough spec: does it render columns, handle sorting, apply filters, show empty states? The response handler gets its own spec: does it negotiate formats correctly, replace turbo frames, push flash messages? The adapter's DSL gets a spec: does `column :name, sortable: true` produce the right `Column` object with the right attributes?

Once those layers are covered, a simple adapter like `VendorAdapter` has very little that's interesting to test. The columns it declares are just configuration. The interesting decisions — how columns render, how sorting works, how turbo frames compose — are already covered.

A meta-spec that programmatically discovers and validates every adapter in the system closes the last gap. It iterates the adapters, checks that every declared field corresponds to a real model attribute or has a block, verifies that `frame_id` is set on embedded resources, and confirms that the adapter's `permit` list matches the form inputs. Convention enforcement isn't just a habit. Add an adapter with a missing `frame_id` and the build fails.

```ruby
ResourceAdapter.descendants.each do |adapter_class|
  describe adapter_class do
    it "declares valid fields" do
      adapter_class.show_definition.fields.each do |field|
        expect(field.name).to be_a(Symbol)
        # field must reference a model attribute or provide a block
        unless field.block
          expect(model_class.method_defined?(field.name)).to be(true),
            "#{adapter_class}#show declares :#{field.name} but #{model_class} doesn't respond to it"
        end
      end
    end
  end
end
```

The result is that simple adapters can skip tests entirely, which means the test suite stays fast and focused on the things that are genuinely unique about each resource. The computed field on `VendorAdapter` that calculates balance due? Test that. The fact that it has a `:name` column? Already covered.

## When the shortcut becomes a detour

> **TODO:** This section needs the NotificationAdapter story. What happened when you reached for the pattern and it made things worse? The sign that you've reached for it too early, or that the resource doesn't fit the CRUD shape. One concrete story, then the general lesson.

The pattern is a shortcut through Rails, not a detour around it. When it works, a new resource with a table, show page, form, CSV export, and JSON API is one adapter file and a four-line controller. When it partially works, you override the piece that doesn't fit and keep the rest. When it doesn't work at all, you write a normal Rails controller and nothing breaks.

That gradient is the thing that matters. Not the DSL, not the adapter, not the convention. The gradient. The ability to start with full convention and peel it back, layer by layer, until you're writing plain Rails again. Every point along the way is a reasonable place to stand.

> **TODO:** Closing paragraph. Land the whole two-part argument. Article 1 ended on signal vs noise, on the garden staying tidy. What's the version of that for someone who's built the full system? The feeling of working in a codebase where the pattern handles the routine so you can focus on the parts that are actually interesting.
