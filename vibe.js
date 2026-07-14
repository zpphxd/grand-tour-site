/* ============================================================
   Grand Tour deterministic vibe search
   Plain-English discovery without an AI service or external API.

   Basic use after data.js:
     VibeSearch.search('romantic food trip by train under €600')
     VibeSearch.metadata('oktoberfest')
     await VibeSearch.loadDossiers() // optional, improves scoring
     VibeSearch.selfTest()
   ============================================================ */
(function initVibeSearch(global) {
  'use strict';

  var VERSION = '1.0.0';
  var STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for', 'from',
    'i', 'id', 'im', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or',
    'some', 'something', 'that', 'the', 'this', 'to', 'trip', 'travel', 'want',
    'we', 'week', 'weekend', 'with', 'would', 'you'
  ]);

  var MONTHS = {
    jan: 'winter', january: 'winter', feb: 'winter', february: 'winter',
    mar: 'spring', march: 'spring', apr: 'spring', april: 'spring',
    may: 'spring', jun: 'summer', june: 'summer', jul: 'summer', july: 'summer',
    aug: 'summer', august: 'summer', sep: 'autumn', sept: 'autumn', september: 'autumn',
    oct: 'autumn', october: 'autumn', nov: 'winter', november: 'winter',
    dec: 'winter', december: 'winter'
  };

  var RATING_FACETS = new Set(['food', 'culture', 'nature', 'adventure', 'romance', 'family']);
  var ORDERED = {
    intensity: ['relaxed', 'moderate', 'active', 'intense'],
    crowd: ['quiet', 'moderate', 'lively', 'packed']
  };

  /* Longer phrases are evaluated first. Values are canonical metadata values. */
  var TERMS = [
    ['hidden gem', 'crowd', 'quiet'], ['off the beaten path', 'crowd', 'quiet'],
    ['away from crowds', 'crowd', 'quiet'], ['peace and quiet', 'crowd', 'quiet'],
    ['not too crowded', 'crowd', 'packed', 'exclude'], ['avoid crowds', 'crowd', 'packed', 'exclude'],
    ['not crowded', 'crowd', 'packed', 'exclude'], ['small crowds', 'crowd', 'quiet'],
    ['big atmosphere', 'crowd', 'lively'], ['people watching', 'crowd', 'lively'],
    ['bucket list', 'adventure', 'high'], ['once in a lifetime', 'adventure', 'high'],
    ['adrenaline rush', 'adventure', 'high'], ['get my heart racing', 'adventure', 'high'],
    ['take it easy', 'intensity', 'relaxed'], ['slow paced', 'intensity', 'relaxed'],
    ['low key', 'intensity', 'relaxed'], ['not too intense', 'intensity', 'intense', 'exclude'],
    ['very active', 'intensity', 'intense'], ['physically challenging', 'intensity', 'intense'],
    ['fine dining', 'food', 'high'], ['local cuisine', 'food', 'high'],
    ['street food', 'food', 'high'], ['wine tasting', 'food', 'high'],
    ['food and wine', 'food', 'high'], ['good food', 'food', 'high'],
    ['live music', 'culture', 'high'], ['classical music', 'culture', 'high'],
    ['arts and culture', 'culture', 'high'], ['local culture', 'culture', 'high'],
    ['beautiful scenery', 'nature', 'high'], ['great views', 'nature', 'high'],
    ['fresh air', 'nature', 'high'], ['in the mountains', 'nature', 'high'],
    ['date night', 'romance', 'high'], ['couples trip', 'romance', 'high'],
    ['romantic getaway', 'romance', 'high'], ['honeymoon', 'romance', 'high'],
    ['kid friendly', 'family', 'high'], ['family friendly', 'family', 'high'],
    ['with children', 'family', 'high'], ['with kids', 'family', 'high'],
    ['solo travel', 'social', 'solo'], ['on my own', 'social', 'solo'],
    ['with friends', 'social', 'friends'], ['group trip', 'social', 'group'],
    ['meet people', 'social', 'social'], ['make friends', 'social', 'social'],
    ['by public transport', 'travelMode', 'rail'], ['public transport', 'travelMode', 'rail'],
    ['without flying', 'travelMode', 'fly', 'exclude'], ['no flights', 'travelMode', 'fly', 'exclude'],
    ['night train', 'travelMode', 'rail'], ['road trip', 'travelMode', 'drive'],
    ['cheap', 'budget', 'budget'], ['affordable', 'budget', 'budget'],
    ['on a budget', 'budget', 'budget'], ['low cost', 'budget', 'budget'],
    ['money no object', 'budget', 'luxury'], ['treat myself', 'budget', 'luxury'],
    ['high end', 'budget', 'luxury'], ['all out', 'budget', 'luxury'],
    ['outdoors', 'type', 'outdoor'], ['outdoor', 'type', 'outdoor'],
    ['hiking', 'activity', 'hiking'], ['hike', 'activity', 'hiking'],
    ['skiing', 'activity', 'skiing'], ['ski', 'activity', 'skiing'],
    ['cycling', 'activity', 'cycling'], ['bike', 'activity', 'cycling'],
    ['foodie', 'food', 'high'], ['food', 'food', 'high'], ['wine', 'food', 'high'],
    ['beer', 'food', 'high'], ['restaurant', 'food', 'high'], ['gourmet', 'food', 'high'],
    ['art', 'culture', 'high'], ['arts', 'culture', 'high'], ['history', 'culture', 'high'],
    ['historic', 'culture', 'high'], ['museum', 'culture', 'high'], ['opera', 'culture', 'high'],
    ['theatre', 'culture', 'high'], ['theater', 'culture', 'high'], ['music', 'culture', 'high'],
    ['nature', 'nature', 'high'], ['scenery', 'nature', 'high'], ['scenic', 'nature', 'high'],
    ['lake', 'nature', 'high'], ['coast', 'nature', 'high'], ['mountain', 'nature', 'high'],
    ['adventure', 'adventure', 'high'], ['thrill', 'adventure', 'high'],
    ['wild', 'adventure', 'high'], ['extreme', 'intensity', 'intense'],
    ['romantic', 'romance', 'high'], ['romance', 'romance', 'high'],
    ['family', 'family', 'high'], ['children', 'family', 'high'], ['kids', 'family', 'high'],
    ['quiet', 'crowd', 'quiet'], ['calm', 'crowd', 'quiet'], ['peaceful', 'crowd', 'quiet'],
    ['lively', 'crowd', 'lively'], ['buzzing', 'crowd', 'lively'], ['party', 'crowd', 'lively'],
    ['crowded', 'crowd', 'packed'], ['huge crowds', 'crowd', 'packed'],
    ['relaxed', 'intensity', 'relaxed'], ['gentle', 'intensity', 'relaxed'],
    ['easy', 'intensity', 'relaxed'], ['active', 'intensity', 'active'],
    ['challenging', 'intensity', 'intense'], ['intense', 'intensity', 'intense'],
    ['solo', 'social', 'solo'], ['couple', 'social', 'couple'],
    ['friends', 'social', 'friends'], ['social', 'social', 'social'],
    ['train', 'travelMode', 'rail'], ['rail', 'travelMode', 'rail'],
    ['fly', 'travelMode', 'fly'], ['flight', 'travelMode', 'fly'],
    ['drive', 'travelMode', 'drive'], ['car', 'travelMode', 'drive'],
    ['free', 'budget', 'free'], ['thrifty', 'budget', 'budget'],
    ['luxury', 'budget', 'luxury'], ['splurge', 'budget', 'luxury'],
    ['spring', 'season', 'spring'], ['summer', 'season', 'summer'],
    ['autumn', 'season', 'autumn'], ['fall', 'season', 'autumn'],
    ['winter', 'season', 'winter'], ['festival', 'kind', 'festival'],
    ['sport', 'kind', 'sport'], ['sports', 'kind', 'sport']
  ].sort(function (a, b) { return b[0].length - a[0].length; });

  var NEGATORS = /(?:^|\s)(?:no|not|without|avoid|excluding|except|anything but|dont|do not)\s+(?:too\s+)?$/;
  var cache = { items: [], byId: Object.create(null), dossiers: Object.create(null) };

  /** Normalize accents, apostrophes, punctuation and whitespace for stable matching. */
  function normalize(value) {
    return String(value == null ? '' : value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[’']/g, '').replace(/,/g, '').replace(/[^a-z0-9€£$+\-\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function add(map, facet, value) {
    if (!map[facet]) map[facet] = new Set();
    map[facet].add(value);
  }

  function setMapToObject(map) {
    var output = {};
    Object.keys(map).forEach(function (key) { output[key] = Array.from(map[key]); });
    return output;
  }

  function hasPhrase(text, phrase) {
    return new RegExp('(?:^|\\s)' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?=\\s|$)').test(text);
  }

  /** Parse a natural-language request into explicit deterministic constraints. */
  function parse(query) {
    var text = normalize(query);
    var include = Object.create(null);
    var exclude = Object.create(null);
    var matched = [];
    var occupied = [];

    TERMS.forEach(function (term) {
      var phrase = term[0];
      var index = text.indexOf(phrase);
      if (index < 0 || !hasPhrase(text, phrase)) return;
      var end = index + phrase.length;
      if (occupied.some(function (span) { return index < span[1] && end > span[0]; })) return;
      var prefix = text.slice(Math.max(0, index - 24), index);
      var negated = term[3] === 'exclude' || NEGATORS.test(prefix);
      add(negated ? exclude : include, term[1], term[2]);
      matched.push({ phrase: phrase, facet: term[1], value: term[2], excluded: negated });
      occupied.push([index, end]);
    });

    /* Make common negative requests express the positive preference too. */
    if ((exclude.crowd || new Set()).has('packed')) add(include, 'crowd', 'quiet');
    if ((exclude.intensity || new Set()).has('intense')) add(include, 'intensity', 'relaxed');

    var maxBudget = null;
    var minBudget = null;
    var amountPattern = '(?:€|eur|chf|£|gbp|\$)?\\s*([0-9][0-9,.]*)';
    var maxMatch = text.match(new RegExp('(?:under|below|less than|up to|maximum|max|no more than|budget(?: of)?)\\s*' + amountPattern));
    var minMatch = text.match(new RegExp('(?:over|above|more than|minimum|min|at least)\\s*' + amountPattern));
    if (maxMatch) maxBudget = Number(maxMatch[1].replace(/,/g, ''));
    if (minMatch) minBudget = Number(minMatch[1].replace(/,/g, ''));

    var words = text.split(' ').filter(function (word) {
      return word.length > 2 && !STOP_WORDS.has(word) && !/^\d/.test(word) &&
        !TERMS.some(function (term) { return term[0].split(' ').indexOf(word) >= 0; });
    });

    return {
      raw: String(query || ''), normalized: text,
      include: setMapToObject(include), exclude: setMapToObject(exclude),
      maxBudget: maxBudget, minBudget: minBudget,
      textTokens: Array.from(new Set(words)), matchedPhrases: matched
    };
  }

  function flatten(value, output, key) {
    output = output || [];
    if (value == null || key === 'photos' || key === 'url') return output;
    if (typeof value === 'string' || typeof value === 'number') output.push(String(value));
    else if (Array.isArray(value)) value.forEach(function (entry) { flatten(entry, output, key); });
    else if (typeof value === 'object') Object.keys(value).forEach(function (child) { flatten(value[child], output, child); });
    return output;
  }

  function contains(text, words) {
    return words.some(function (word) { return text.indexOf(word) >= 0; });
  }

  function rating(text, positive, base) {
    var hits = positive.reduce(function (count, word) { return count + (text.indexOf(word) >= 0 ? 1 : 0); }, 0);
    return Math.max(0, Math.min(5, base + Math.min(3, hits)));
  }

  function seasonsFor(item, dossier) {
    var source = normalize([item.month, item.season, dossier && dossier.dates].filter(Boolean).join(' '));
    var result = new Set();
    Object.keys(MONTHS).forEach(function (month) {
      if (hasPhrase(source, month)) result.add(MONTHS[month]);
    });
    ['spring', 'summer', 'autumn', 'winter'].forEach(function (season) {
      if (hasPhrase(source, season)) result.add(season);
    });
    return Array.from(result);
  }

  function euroAmounts(value) {
    var source = String(value || '');
    var matches = [];
    var regex = /(€|eur|chf|£|gbp|\$)\s*([0-9][0-9,.]*)/gi;
    var match;
    while ((match = regex.exec(source))) {
      var number = Number(match[2].replace(/,/g, ''));
      var currency = match[1].toLowerCase();
      if (currency === 'chf') number *= 1.04;
      if (currency === '£' || currency === 'gbp') number *= 1.18;
      if (number > 5) matches.push(Math.round(number));
    }
    return matches;
  }

  function inferBudget(item, dossier, context) {
    var thrifty = euroAmounts(dossier && dossier.costs && dossier.costs.thrifty);
    var midrange = euroAmounts(dossier && dossier.costs && dossier.costs.midrange);
    var splurge = euroAmounts(dossier && dossier.costs && dossier.costs.splurge);
    var all = thrifty.concat(midrange, splurge);
    if (!all.length && context && context.months) {
      context.months.some(function (month) {
        var ids = [month.headline].concat(month.alts || []);
        if (ids.indexOf(item.id) < 0) return false;
        (month.chips || []).forEach(function (chip) {
          if (chip.t === 'cost') all = all.concat(euroAmounts(chip.v));
        });
        return all.length > 0;
      });
    }
    all.sort(function (a, b) { return a - b; });
    var min = thrifty[0] || all[0] || null;
    var typical = midrange[0] || (all.length ? all[Math.floor(all.length / 2)] : null);
    var max = splurge[splurge.length - 1] || all[all.length - 1] || null;
    var tiers = [];
    var fullText = normalize(flatten(dossier || {}).join(' '));
    if (contains(fullText, ['entry is free', 'free event', 'viewing is free', 'free roadside'])) tiers.push('free');
    if (typical != null) {
      if (typical <= 500) tiers.push('budget');
      else if (typical <= 1400) tiers.push('midrange');
      else tiers.push('luxury');
    } else tiers.push('midrange');
    if (max != null && max >= 2000) tiers.push('luxury');
    return { min: min, typical: typical, max: max, tiers: Array.from(new Set(tiers)), currency: 'EUR', estimated: !all.length };
  }

  function mergeOverrides(metadata, overrides) {
    if (!overrides) return metadata;
    Object.keys(overrides).forEach(function (key) {
      if (key === 'ratings') Object.assign(metadata.ratings, overrides.ratings);
      else metadata[key] = overrides[key];
    });
    return metadata;
  }

  /** Infer normalized facets from a compact card plus an optional full dossier. */
  function infer(item, options) {
    options = options || {};
    var dossier = options.dossier || cache.dossiers[item.id] || null;
    var place = (options.places || global.PLACES || {})[item.place] || {};
    var type = item.activity ? 'outdoor' : 'event';
    var text = normalize([item.name, item.kind, item.activity, item.month, item.season,
      place.name, flatten(dossier || {}).join(' ')].filter(Boolean).join(' '));
    var modes = new Set();
    (dossier && dossier.gettingThere || []).forEach(function (leg) { if (leg.mode) modes.add(leg.mode); });
    if (!modes.size) {
      if ((options.railStations || global.RAIL_STATIONS || {})[item.place]) modes.add('rail');
      if ((options.airports || global.AIRPORTS || {})[item.place]) modes.add('fly');
      modes.add('drive');
    }

    var intensity = 'moderate';
    if (type === 'outdoor') intensity = item.activity === 'hiking' ? 'active' : 'intense';
    if (contains(text, ['no technical', 'gentle', 'easy walk', 'easy day trip'])) intensity = 'relaxed';
    if (contains(text, ['10,000m', 'technical', 'extreme', 'hardest', 'very demanding', 'expert', 'black run'])) intensity = 'intense';

    var crowd = type === 'event' ? ((item.kind === 'festival' || item.kind === 'sport') ? 'lively' : 'moderate') : 'moderate';
    if (contains(text, ['millions', 'largest', 'biggest', 'packed', 'sells out in minutes', 'huge crowds', 'crowd avoidance'])) crowd = 'packed';
    if (contains(text, ['quiet', 'uncrowded', 'hidden', 'peaceful', 'off-season', 'away from crowds'])) crowd = 'quiet';

    var foodBase = item.kind === 'food' ? 5 : (contains(text, ['festival', 'market']) ? 2 : 1);
    var cultureBase = item.kind === 'arts' ? 5 : (type === 'event' ? 3 : 1);
    var natureBase = type === 'outdoor' ? 5 : 1;
    var adventureBase = type === 'outdoor' ? 4 : (item.kind === 'sport' ? 3 : 1);
    var romanceBase = item.kind === 'arts' || item.kind === 'food' ? 3 : 1;
    var familyBase = type === 'outdoor' ? 2 : 3;
    var ratings = {
      food: rating(text, ['food', 'wine', 'beer', 'truffle', 'chocolate', 'oyster', 'gourmet', 'restaurant', 'cuisine', 'market'], foodBase),
      culture: rating(text, ['history', 'historic', 'tradition', 'unesco', 'art', 'music', 'opera', 'theatre', 'cinema', 'museum', 'procession'], cultureBase),
      nature: rating(text, ['mountain', 'alpine', 'lake', 'coast', 'valley', 'glacier', 'trail', 'scenic', 'flower', 'forest'], natureBase),
      adventure: rating(text, ['adventure', 'wild', 'race', 'ski', 'cycling', 'hiking', 'climb', 'trail', 'adrenaline', 'challenge'], adventureBase),
      romance: rating(text, ['romantic', 'sunset', 'lakefront', 'wine', 'opera', 'venice', 'christmas', 'palace', 'candle', 'beach'], romanceBase),
      family: rating(text, ['family', 'families', 'children', 'kid', 'gentle', 'free entry', 'flower', 'market'], familyBase)
    };
    if (contains(text, ['dangerous', 'expert', 'drink-driving', 'firecracker', 'bull run', 'extreme'])) ratings.family = Math.max(0, ratings.family - 2);

    var social = new Set();
    if (crowd === 'lively' || crowd === 'packed') { social.add('friends'); social.add('group'); social.add('social'); }
    if (crowd === 'quiet' || item.kind === 'arts' || type === 'outdoor') social.add('solo');
    if (ratings.romance >= 4) social.add('couple');
    if (ratings.family >= 4) social.add('family');

    var metadata = {
      id: item.id, type: type, kind: item.kind || null, activity: item.activity || null,
      place: item.place, placeName: place.name || (dossier && dossier.city) || '',
      country: (dossier && dossier.country) || '', seasons: seasonsFor(item, dossier),
      travelModes: Array.from(modes), intensity: intensity, crowd: crowd,
      social: Array.from(social), ratings: ratings, budget: inferBudget(item, dossier, options),
      keywords: Array.from(new Set(text.split(' ').filter(function (word) { return word.length > 3 && !STOP_WORDS.has(word); }))),
      searchText: text, source: dossier ? 'dossier' : 'card', inferred: true
    };
    return mergeOverrides(metadata, item.metadata);
  }

  function candidateValue(metadata, facet) {
    if (facet === 'season') return metadata.seasons;
    if (facet === 'travelMode') return metadata.travelModes;
    if (facet === 'social') return metadata.social;
    if (facet === 'budget') return metadata.budget.tiers;
    if (facet === 'type') return [metadata.type];
    if (facet === 'kind') return [metadata.kind];
    if (facet === 'activity') return [metadata.activity];
    if (facet === 'intensity' || facet === 'crowd') return [metadata[facet]];
    if (RATING_FACETS.has(facet)) return [metadata.ratings[facet]];
    return [];
  }

  function matchesValue(metadata, facet, desired) {
    var values = candidateValue(metadata, facet);
    if (RATING_FACETS.has(facet)) {
      var score = values[0] || 0;
      return desired === 'high' ? score >= 4 : desired === 'low' ? score <= 2 : score >= 3;
    }
    return values.indexOf(desired) >= 0;
  }

  function labelFacet(facet, value) {
    var labels = { travelMode: 'travel', kind: 'format', social: 'company', activity: 'activity' };
    return (labels[facet] || facet) + ': ' + value;
  }

  function scoreOne(item, metadata, parsed, options) {
    var points = 38;
    var reasons = [];
    var misses = [];
    var excludedBy = [];
    var include = parsed.include;
    var exclude = parsed.exclude;

    Object.keys(exclude).forEach(function (facet) {
      exclude[facet].forEach(function (value) {
        if (matchesValue(metadata, facet, value)) excludedBy.push(labelFacet(facet, value));
      });
    });

    Object.keys(include).forEach(function (facet) {
      var requested = include[facet];
      var hit = requested.some(function (value) { return matchesValue(metadata, facet, value); });
      if (hit) {
        points += RATING_FACETS.has(facet) ? 12 : 10;
        var value = requested.find(function (entry) { return matchesValue(metadata, facet, entry); });
        reasons.push(labelFacet(facet, value));
      } else {
        points -= 9;
        misses.push(labelFacet(facet, requested.join(' or ')));
      }
    });

    if (parsed.maxBudget != null && metadata.budget.typical != null) {
      if (metadata.budget.typical <= parsed.maxBudget) {
        points += 14;
        reasons.push('typical budget ~€' + metadata.budget.typical + ' (under €' + parsed.maxBudget + ')');
      } else {
        points -= Math.min(24, 8 + Math.round((metadata.budget.typical - parsed.maxBudget) / 100));
        misses.push('typical budget ~€' + metadata.budget.typical);
        if (metadata.budget.min != null && metadata.budget.min > parsed.maxBudget) excludedBy.push('over €' + parsed.maxBudget);
      }
    }
    if (parsed.minBudget != null && metadata.budget.max != null) {
      if (metadata.budget.max >= parsed.minBudget) { points += 8; reasons.push('supports a premium experience'); }
      else { points -= 8; misses.push('limited splurge options'); }
    }

    parsed.textTokens.forEach(function (token) {
      if (metadata.searchText.indexOf(token) >= 0) { points += 3; reasons.push('mentions ' + token); }
    });

    /* A close ordinal value is still useful, but never presented as an exact match. */
    ['intensity', 'crowd'].forEach(function (facet) {
      if (!include[facet] || include[facet].some(function (v) { return matchesValue(metadata, facet, v); })) return;
      var wanted = ORDERED[facet].indexOf(include[facet][0]);
      var actual = ORDERED[facet].indexOf(metadata[facet]);
      if (wanted >= 0 && actual >= 0 && Math.abs(wanted - actual) === 1) points += 4;
    });

    return {
      item: item, metadata: metadata, score: Math.max(0, Math.min(100, Math.round(points))),
      reasons: Array.from(new Set(reasons)).slice(0, 5), misses: Array.from(new Set(misses)).slice(0, 4),
      excluded: excludedBy.length > 0, excludedBy: Array.from(new Set(excludedBy))
    };
  }

  /** Build/rebuild the local index. All event and outdoor items receive metadata. */
  function index(options) {
    options = options || {};
    var events = options.events || global.EVENTS || [];
    var adventures = options.adventures || global.ADVENTURES || [];
    var dossiers = options.dossiers || cache.dossiers;
    cache.items = events.concat(adventures).map(function (item) {
      var metadata = infer(item, Object.assign({}, options, { dossier: dossiers[item.id], months: options.months || global.MONTHS || [] }));
      var entry = { item: item, metadata: metadata };
      cache.byId[item.id] = entry;
      return entry;
    });
    return cache.items.slice();
  }

  /** Rank the current collection. Exclusions are hard filters unless includeExcluded is true. */
  function search(query, options) {
    options = options || {};
    var parsed = typeof query === 'string' ? parse(query) : query;
    if (options.items) {
      cache.items = options.items.map(function (item) {
        return { item: item, metadata: infer(item, Object.assign({}, options, { dossier: (options.dossiers || {})[item.id] })) };
      });
    } else if (!cache.items.length || options.reindex) index(options);
    var results = cache.items.map(function (entry) { return scoreOne(entry.item, entry.metadata, parsed, options); });
    results.sort(function (a, b) { return b.score - a.score || a.item.name.localeCompare(b.item.name); });
    if (!options.includeExcluded) results = results.filter(function (result) { return !result.excluded; });
    if (options.type) results = results.filter(function (result) { return result.metadata.type === options.type; });
    return { query: parsed, total: results.length, results: results.slice(0, options.limit || results.length) };
  }

  function metadata(id) {
    if (!cache.items.length) index();
    return cache.byId[id] ? cache.byId[id].metadata : null;
  }

  /**
   * Optionally fetch the repository's same-origin JSON dossiers, then rebuild.
   * This never calls an AI or third-party service.
   */
  async function loadDossiers(options) {
    options = options || {};
    var items = (options.events || global.EVENTS || []).concat(options.adventures || global.ADVENTURES || []);
    var baseUrl = String(options.baseUrl || 'data/events').replace(/\/$/, '');
    var settled = await Promise.allSettled(items.map(async function (item) {
      var response = await fetch(baseUrl + '/' + item.id + '.json');
      if (!response.ok) throw new Error(response.status + ' ' + item.id);
      return response.json();
    }));
    settled.forEach(function (result) {
      if (result.status === 'fulfilled' && result.value && result.value.id) cache.dossiers[result.value.id] = result.value;
    });
    index(Object.assign({}, options, { dossiers: cache.dossiers }));
    return { loaded: Object.keys(cache.dossiers).length, failed: settled.filter(function (result) { return result.status === 'rejected'; }).length };
  }

  /** Tiny console smoke test; returns details and does not mutate application data. */
  function selfTest() {
    var parsed = parse('A romantic foodie weekend by train under €600, not crowded and no skiing');
    var sample = [
      { id: 'quiet-wine', name: 'Quiet lakeside wine weekend', place: 'lake', kind: 'food', month: 'Sep 2027', metadata: {
        crowd: 'quiet', travelModes: ['rail'], budget: { min: 100, typical: 350, max: 700, tiers: ['budget'], currency: 'EUR' },
        ratings: { food: 5, culture: 3, nature: 4, adventure: 1, romance: 5, family: 3 }
      } },
      { id: 'ski-party', name: 'Huge ski party', place: 'peak', activity: 'skiing', season: 'winter', metadata: {
        crowd: 'packed', travelModes: ['fly'], budget: { min: 900, typical: 1600, max: 3000, tiers: ['luxury'], currency: 'EUR' },
        ratings: { food: 2, culture: 1, nature: 5, adventure: 5, romance: 1, family: 1 }
      } }
    ];
    var found = search(parsed, { items: sample, places: { lake: { name: 'Lake' }, peak: { name: 'Peak' } }, limit: 5 });
    var checks = {
      normalizesPlainEnglish: parsed.normalized.indexOf('romantic foodie') >= 0,
      understandsBudget: parsed.maxBudget === 600,
      understandsNegation: parsed.exclude.crowd.indexOf('packed') >= 0 && parsed.exclude.activity.indexOf('skiing') >= 0,
      ranksMatchingItem: found.results.length === 1 && found.results[0].item.id === 'quiet-wine',
      explainsResult: found.results[0] && found.results[0].reasons.length > 0
    };
    var passed = Object.keys(checks).every(function (key) { return checks[key]; });
    if (global.console) {
      console.table(checks);
      console.log('VibeSearch self-test ' + (passed ? 'passed' : 'failed'), found);
    }
    index();
    return { passed: passed, checks: checks, parsed: parsed, result: found.results[0] || null };
  }

  global.VibeSearch = Object.freeze({
    version: VERSION, normalize: normalize, parse: parse, infer: infer,
    index: index, search: search, metadata: metadata,
    loadDossiers: loadDossiers, selfTest: selfTest
  });
})(window);
