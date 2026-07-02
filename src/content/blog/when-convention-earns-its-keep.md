---
title: "The Shape of the Thing: When Convention Earns Its Keep"
description: "A DSL and adapter layer that lives inside your Rails app, not alongside it."
draft: false
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

And it isn't only a maintenance cost. Each near-duplicate file is one more surface for an LLM to drift across. Models churn them out fast, but every generation differs a little, and the variance compounds when there's no shared structure holding them to one shape.

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

The core issue is that ActiveAdmin gives you an application. Its own controllers, its own views, its own layout, its own CSS, its own asset pipeline. It doesn't take the standard Rails pieces and build on top. It feels like it ejects from them entirely.

You're building inside ActiveAdmin's world, and the moment you need something it didn't anticipate you're fighting its rendering pipeline to break back out. Custom pages mean learning ActiveAdmin's page DSL. Custom actions mean hooking into its controller lifecycle. Custom styling means overriding its theme. The escape hatches aren't as intuitive as you'd hope. Which is a shame, because before I rag on it (the way a lot of the community does now) I want to be fair. For what it does, it does incredibly well. You just have to know upfront that it isn't friendly the moment you work outside its usual parameters.

Avo and Administrate came along to fill some of those gaps. Whilst I liked a lot of what they offered, to my eye they all stopped just short of being as beautiful as the declarative layer ActiveAdmin nails.

So as a plain experiment, I set out to see whether I could build that declarative layer on top of ordinary Rails controllers, and whether it was worth the effort. The conclusion was a resounding yes. I'll grant I might be looking at it through rose-coloured glasses, given I'm the one who wrote it.

What I took was the declaration. What I didn't want was the rest. The parallel universe. The separate admin app that happens to live in the same repository. The adapter feeds ViewComponents, rendered in my layout, styled by my design system. When you override the show page, you're writing a normal ViewComponent. When you drop the adapter entirely, you still have a normal Rails controller. No window to climb through on the way out.

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

## Convention as a steering layer

There's a second way to read everything above, and it's the reading I keep coming back to. The adapter saves me boilerplate, but it also steers the LLM onto the correct path by forcing the convention.

The convention does the hard part, so the model has one narrow groove to follow instead of inventing a controller and three components from scratch each time. Fewer decisions means fewer chances to get one subtly wrong, and subtle wrongness is exactly how functional drift creeps in.

Ask a model for a `Vendor::IndexComponent` and it makes dozens of small decisions on the way. Naming, sorting, param shapes, empty states. On each one its training data pulls toward the generic Rails answer, not mine. Ask it for a `VendorAdapter` and most of those decisions are already made. The DSL only accepts a narrow set of sentences, and `column :name, sortable: true` is a hard sentence to get wrong. The correct path becomes the shortest one, which is what Rico Mariani called [the pit of success](https://blog.codinghorror.com/falling-into-the-pit-of-success/). The agent falls into my conventions instead of having to be talked into them.

It's also less to generate and less to read. One adapter file instead of four. That matters more than it sounds, because a model's context is a finite resource, not a free one ([Anthropic's framing](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). The research is blunt about it. Chroma's [context rot](https://research.trychroma.com/context-rot) report found models grow less reliable as the input grows, not more, even on simple tasks, and the older [Lost in the Middle](https://arxiv.org/abs/2307.03172) work showed they quietly lose what's buried in the middle of a long context. Spend that budget on boilerplate and there's less of it left for the part that's actually hard. More signal, less noise, for the model as much as the reviewer.

And when the model wanders anyway, the convention is checkable. The meta-spec in the testing section below fails the build when an adapter doesn't hold its shape, so my taste becomes something the agent gets caught against rather than something I have to spot in review. This is the passive half of the idea, making the right path the short one. The active half, nudging the agent through hooks at the moment it reads or writes the relevant files, is its own post: [Nudging LLMs Just In Time](/blog/just-in-time-not-just-in-case).

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

One rung down, override just the message. The CRUD concern uses `||=` for its defaults, so setting `@success_message` before calling `super` is all it takes. `App::GuestSharesController` casts the incoming flag, sets the message and the frame to replace, then lets the rest of the update flow run unchanged. The real controller pulls other levers besides, custom components and a few bespoke actions, but the update override stands on its own.

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

Further still, drop the adapter entirely. `App::Guest::CommunicationsController` uses `actions :none`, supplies its own component and paths, and adds custom actions. It still gets Pundit scoping, the data pipeline, and the response handler. Take what you need, leave the rest.

```ruby
class App::Guest::CommunicationsController < App::BaseController
  include CRUDResource

  actions :none
  configure_resource model: Communication
  configure_views(
    show_component: -> { App::Guest::CommunicationsComponent.new(participant: participant) }
  )

  def send_rsvp_email
    @resource = participant.communications.new(
      kind: 'email', template: 'rsvp', to: participant.email,
      owner: participant, status: 'queued'
    )
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

And at the far end, `App::SeatingChart::AssignmentsController` doesn't include `CRUDResource` at all. It's a normal Rails controller with custom `assign`, `unassign`, and `rename` actions rendering turbo streams directly. No adapter, no concern, no convention. That's fine. The pattern earns trust because opting out entirely is a legitimate choice, not a failure.

Every point on this gradient is a real controller in production. None of them is an escape hatch. They're all just Rails, with varying amounts of convention applied.

The seating chart earned its spot at the far end the hard way, though. I'll come back to that.

## Testing the contract, not the configuration

When the mechanics are shared, the testing strategy inverts. Instead of testing every resource's index, show, and form, you cover the layers once.

The generic `IndexComponent` gets a thorough spec. Does it render columns, handle sorting, apply filters, show empty states? The response handler gets its own, covering format negotiation, turbo frame replacement, and flash messages. The DSL gets one too. Does `column :name, sortable: true` produce the right `Column` object with the right attributes?

Once those layers are covered, a simple adapter like `VendorAdapter` has very little left that's interesting to test. The columns it declares are just configuration. The interesting decisions (how columns render, how sorting works, how frames compose) are already covered.

A meta-spec that discovers and validates every adapter in the system closes the last gap. It globs the adapter files, constantises each one, and checks the definition holds its shape. An index needs a frame id and at least one column. Row actions and footer items aren't just asserted on, they run against a fabricated record, so a footer that sums a method the model doesn't have fails the build. Convention enforcement stops depending on habit. That's a net under the LLM too. When a model scaffolds an adapter that doesn't hold the shape, the spec catches it before I do.

```ruby
adapter_classes.each do |adapter_class|
  describe adapter_class.name do
    it 'has at least one column' do
      expect(adapter_class.resolved_index_columns).to_not be_empty
    end

    it 'returns row actions for a real record' do
      actions = index_definition.row_actions_for(Fabricate(fabricator_name))
      expect(actions).to all(be_a(ResourceAdapter::Index::RowAction))
    end

    it 'can calculate values for footer items' do
      index_definition.footer_items.each do |item|
        expect { item.value_for(collection) }.to_not raise_error
      end
    end
  end
end
```

The net doesn't stretch as far as I'd like yet. A bare `field :balance_due` on a show page isn't checked against the model the way the footer items are, and it could be, a `method_defined?` assertion away. That's the next check to add.

The payoff is that simple adapters can skip tests entirely, which keeps the suite fast and focused on what's genuinely unique to each resource. A field that wraps a block doing real work is worth a test. An adapter declaring a `:name` column is already covered.

## When the shortcut becomes a detour

The seating chart didn't start at the far end of the gradient. On paper a seating assignment is a textbook resource. A model, a participant, a table, a seat number. By this point reaching for an adapter was a reflex, so that's what I did.

```ruby
class SeatingAssignmentAdapter < ResourceAdapter
  index do
    title 'Seating Assignments'
    frame_id 'seating_assignments_table'

    column :guest, header: 'Guest', sortable: true do |assignment|
      assignment.participant.full_name
    end
    column :table, sortable: true do |assignment|
      assignment.table.name
    end
    column :seat_number, header: 'Seat', sortable: true
  end

  form do
    inputs 'Assignment' do
      input :participant_id
      input :table_id
      input :seat_number
    end
  end
end
```

Every line of that is valid, and the whole thing is wrong. Nobody manages a seating chart one record at a time. The page is the arrangement, not the rows. Guests get dragged between tables, and dropping one renumbers the seats around it, updates the table it left, and moves a capacity bar on the other side of the screen. The record is an implementation detail of a larger gesture, and a form with a participant select and a seat number field is technically CRUD and practically useless.

The convention had an answer for each complaint on its own. Override the form component. Push after-save streams. Override the response. That stacking was the sign, and it took me longer to read than I'd like to admit. When the overrides outnumber the declarations, the convention isn't carrying anything. I'd recreated the ActiveAdmin problem inside my own DSL, fighting the abstraction to break out of it, except this time with nobody else to blame.

So it got walked back. `App::SeatingChart::AssignmentsController` became the plain Rails controller you saw at the far end of the gradient, three custom actions rendering turbo streams. Nothing else moved. The rest of the app stayed on the convention.

The part I like most is what survived. Venues and caterers want the seating chart as a spreadsheet, and an export is genuinely tabular even when the page isn't. So the adapter still exists, trimmed to the one definition that fits the shape, and the seating chart's controller streams it when you hit export. The real version also injects the event's dietary question, so the caterer gets requirements against every seat.

```ruby
class SeatingAssignmentAdapter < ResourceAdapter
  csv do
    column :table_number, header: 'Table Number' do |assignment|
      assignment.table.number
    end

    column :guest_name, header: 'Guest Name' do |assignment|
      assignment.participant.full_name
    end
  end
end
```

The lesson is the title of this piece. The adapter describes a shape, a list, a detail page, a form. When a resource is that shape, the whole convention comes for free. When the unit of work isn't a record, when the user is manipulating an arrangement or walking through a wizard, forcing the shape makes a simple thing complicated. The test isn't whether the model looks like a resource but whether the screen does.

The pattern is a shortcut through Rails, not a detour around it. When it works, a new resource with a table, show page, form, CSV export, and JSON API is one adapter file and a short controller. When it partially works, you override the piece that doesn't fit and keep the rest. When it doesn't work at all, you write a normal Rails controller and nothing breaks.

That gradient is the thing that matters, more than the DSL or the adapter or the convention itself. You can start at full convention and peel it back, rung by rung, until you're writing plain Rails again. Every point along the way is a reasonable place to stand.

The previous piece ended on the claim that when the blueprint is there and working, you're not fighting the noise, it's all signal. The adapter is that claim taken as far as I'm willing to take it. A vendor is one file that reads like a description of its pages, and the routine surface, the tables, the forms, the exports, mostly stops being something I think about. What's left to spend attention on is the seating chart, the RSVP flow, the parts that make this app this app. That's the trade both of these articles have been circling. Let convention carry the boring shape of the thing, and keep your focus (and your agent's context) for the parts that were never going to come for free.
