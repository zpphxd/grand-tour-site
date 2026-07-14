# Grand Tour intelligence and API roadmap

Verified 13 July 2026. Provider access, pricing, inventory rights and travel rules can change; re-check each source before contracting or launching.

## Product direction

Build Grand Tour as a trusted travel-intelligence and planning product first, with outbound booking handoffs. Do not become the merchant of record until traffic and conversion justify the support, refund, fraud, payments and regulatory burden.

The product should combine four layers:

1. Editorial dossiers: the taste, story and judgment that make the site distinctive.
2. Structured intelligence: normalized metadata, freshness, source and confidence on every useful fact.
3. Planning cockpit: comparisons, trip budgets, route ordering, reminders, saved plans and booking status.
4. Partner inventory: live discovery and affiliate redirects, isolated behind provider adapters.

## Recommended API stack

### P0 — useful now

| Need | Recommended source | Product use | Important constraint |
|---|---|---|---|
| Multimodal booking | [Omio Affiliate Programme](https://www.omio.com/affiliate) | Rail, coach, flight and ferry search/deep links | Approval-dependent; begin with links/widgets if API access takes longer |
| Activities | [Viator Partner API](https://docs.viator.com/partner-api/) | Tours, outdoor activities, schedules, prices and affiliate links | Rank editorially to avoid a commodity marketplace feel |
| Events | [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) | Event and venue discovery by date/place/category | Coverage is stronger for mainstream ticketed events than local culture |
| Outdoor foundation | [OpenStreetMap](https://www.openstreetmap.org/copyright) and [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) | Trails, huts, peaks, climbing, ski infrastructure and POIs | ODbL attribution; do not use public endpoints as production infrastructure |
| Outdoor routing | [openrouteservice](https://api.openrouteservice.org/) | Hiking, cycling, driving, matrices, isochrones and elevation | Route suitability is informational, never a safety guarantee |
| Curated outdoor content | [Outdooractive Data API](https://developers.outdooractive.com/API-Reference/Data-API.html) | Professional routes, POIs, huts, ski areas, GPX/KML | Commercial rights depend on the contracted content container |
| Weather | [Open-Meteo](https://open-meteo.com/en/pricing) | Forecast, historical weather, snow, marine and weather-fit scoring | Use the commercial endpoint for a commercial product and preserve attribution |
| Maps/search | [Mapbox pricing and APIs](https://www.mapbox.com/pricing) | Map, geocoding, routing and isochrones | Watch token exposure, storage rights and usage growth |
| Currency | [ECB Data API](https://data.ecb.europa.eu/help/api/data) | Daily reference FX for planning estimates | Reference rate is not the user's card/network settlement rate |
| Affordability | [Eurostat API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started) | Country price levels and destination affordability bands | Official but too coarse to represent a live quote |
| Entity enrichment | [Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access) | Multilingual place, heritage and landmark metadata | CC0, but volunteer data may be incomplete or stale |

The site can keep its existing [Swiss public-transport connections API](https://transport.opendata.ch/docs.html) for live information and Open-Meteo forecast panels while these adapters are built.

### P1 — after the data foundation

| Need | Candidate | Why later |
|---|---|---|
| Pan-European public transport | [Navitia](https://doc.navitia.io/) plus national GTFS/NeTEx/SIRI feeds | Information quality varies by country; it is not a booking layer |
| Flight transactions | [Duffel Flights](https://duffel.com/docs/guides/getting-started-with-flights) | Strong modern API, but booking creates refund, fraud and support obligations |
| Cars and rural access | [Duffel Cars](https://duffel.com/docs/guides/getting-started-with-cars) | Useful for remote trailheads after itinerary demand is proven |
| City cost estimates | [Numbeo API](https://www.numbeo.com/api/cost-of-living-api) | City-level detail is attractive, but commercial licensing and crowd-sourced quality need validation |
| Personalized entry rules | [Sherpa Requirements API](https://docs.joinsherpa.io/requirements-api/index.html) | Powerful and itinerary-aware, but handles sensitive traveler context and requires careful legal UX |
| Bathing and swimming | [EEA bathing-water services](https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater) | Excellent history layer for beaches/lakes, not a same-day safety signal |

### P2 — scale and partnership stage

- [Booking.com Demand API](https://developers.booking.com/demand/docs/open-api/demand-api) or [Expedia Rapid](https://developers.expediagroup.com/rapid) for richer lodging inventory after partner approval.
- [Trainline Global API](https://www.thetrainline.com/solutions/api) or [Distribusion](https://www.distribusion.com/products) for transactional ground transport.
- [GetYourGuide Partner API](https://partner.getyourguide.support/hc/en-us/articles/13981133907613-API-integration-and-requirements) after the product reaches its traffic/booking thresholds.
- [IATA Timatic](https://www.iata.org/en/services/compliance/timatic/) for airline-grade requirements at enterprise scale.
- Copernicus emergency layers and ECMWF raw forecast data for advanced outdoor risk products once there is geospatial expertise to communicate uncertainty responsibly.

## Canonical data model

Use PostgreSQL/PostGIS as the system of record and a facet-capable search index such as Typesense, Meilisearch or OpenSearch. Keep raw provider payloads separately so mappings can be debugged and rebuilt.

Core entities:

- `Destination`, `Event`, `Experience`, `OutdoorRoute`, `POI`
- `TransportLeg`, `Stay`, `BookableOffer`
- `VibeProfile`, `BudgetEstimate`
- `SourceRecord`, `Verification`

Every material fact should carry:

- provider and external ID
- source URL and licence
- retrieved and verified timestamps
- valid-from and valid-until timestamps
- confidence and last-material-change timestamp
- booking URL, separate from editorial content

Never merge objects purely by name. Resolve likely duplicates with provider IDs, coordinates, dates, venue/operator and fuzzy matching, then send uncertain cases to editorial review.

Suggested freshness:

- live prices and availability: fetch on demand, cache 5–15 minutes
- weather: 1–6 hours
- transport schedules: hours to one day by provider
- events: 6–24 hours
- advisories and entry rules: hourly change detection or daily minimum
- trails/POIs: weekly incremental refresh
- ECB rates: daily after publication
- official affordability statistics: monthly/annual

## Outdoor expansion

The most differentiated browse modes are not “hiking / cycling / skiing.” They answer an actual trip desire:

- train-to-trail
- hut-to-hut
- wild swimming with official water-quality history
- vineyard cycling
- coastal walks
- easy alpine panoramas
- ski without a car
- shoulder-season sun
- heat-safe and shaded hikes
- rainy-day nature
- serious outdoors with a civilized dinner afterward

Each route should include distance, ascent/descent, moving time, surface, technical difficulty, fitness demand, exposure, shade, season, snow risk, transit access, parking, huts, swimming, dog rules, permits/fees, accessibility, bailout points, emergency contacts, offline GPX, weather fit, verified date and source.

Do not use Strava as a public route catalogue. Its developer model is focused on authenticated users' own activity data; see the [official Strava developer documentation](https://developers.strava.com/docs/getting-started/).

## Deterministic vibe search

The implemented browser engine proves the interaction without an AI service. The durable production taxonomy should include:

- atmosphere: romantic, ceremonial, hedonistic, contemplative, glamorous, rustic
- energy and crowd levels
- social style: solo, intimate, communal, networking
- setting: coast, alpine, forest, vineyard, historic core, island
- activity and physical intensity
- polish: rugged through black-tie
- iconic versus obscure
- budget, duration, season and weather tolerance
- accessibility, family suitability and dog friendliness
- booking urgency and planning difficulty

Use a transparent phrase/synonym dictionary, exclusions and explicit filters. Combine facet scores with ordinary full-text relevance. Always display “why this matched” and let editors override inferred metadata.

Examples:

- “quiet seaside, not too touristy” → coast high, energy low, crowd low, iconic penalty
- “dress up and meet people” → high polish, high social energy, evening positive
- “hard hike with a great lunch after” → strenuous outdoor route plus high food score

## Budget intelligence

The current cockpit uses dossier tier midpoints and rough transport models. The next version should break a trip into normalized components:

- transport to/from destination
- local transit
- accommodation by night and occupancy
- ticket/activity inventory
- food/day
- contingency and currency buffer

Show a low/likely/high range, not false precision. Store the estimate date, assumptions, FX rate and source. Let users set annual and per-trip caps, then surface cheaper dates, sleeper towns, rail alternatives and cluster savings without hiding tradeoffs.

## Europe travel brief

Travel-rule content must be linked, dated and audience-specific rather than frozen into prose.

As of this verification date, the EU reports that EES became fully operational on 10 April 2026. ETIAS is expected in the last quarter of 2026, but an exact launch date has not been announced; use the [official EU ETIAS page](https://travel-europe.europa.eu/etias/ltr/about-etias) as the source of truth. Deep-link passenger rights from [Your Europe](https://europa.eu/youreurope/citizens/travel/passenger-rights/index_en.htm).

Useful travel-brief cards:

- passport/visa/entry status by nationality and itinerary
- Schengen day counter
- rail disruption and passenger-rights explainer
- roaming, plugs, currency and tipping
- emergency number and local medical guidance
- driving vignette, low-emission zone and licence requirements
- strike/closure/advisory watch with source and verified date

## Booking and legal boundary

Start with tracked affiliate redirects and official-organizer links. Keep click attribution separate from editorial ranking. Treat bookings as external until the user imports or confirms them.

Before transactional booking, complete legal and operational work for:

- merchant-of-record and travel-agent responsibilities
- PCI, PSD2/SCA, fraud and chargebacks
- cancellations, exchanges, refunds and disruption support
- GDPR controls for identity, passport and health data
- the EU Package Travel Directive when combining travel services
- clear supplier, price-freshness and availability disclosures

## Delivery sequence

1. Normalize the existing 53 dossiers into the canonical schema and add source/freshness fields.
2. Ship deterministic vibe search, comparison, saved shortlist and budget cockpit.
3. Add OSM/openrouteservice/Open-Meteo outdoor adapters and the richer route schema.
4. Integrate Omio, Viator and Ticketmaster behind provider adapters; retain official links as fallback.
5. Add travel briefs, freshness monitoring and “information changed” alerts.
6. Add account sync, collaborative planning and booking-import status.
7. Evaluate transactional providers only after affiliate conversion and support demand are measurable.
