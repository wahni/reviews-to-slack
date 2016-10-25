/*!
 * reviews-to-slack
 * Copyright(c) 2015 Niklas Wahlén
 * MIT Licensed
 */

const request = require('request');
const Watcher = require('rss-watcher');
const cheerio = require('cheerio');

const WATCHER_EVENTS = {
  "NEW_ARTICLE": "new article",
  "ERROR": "error"
};

const REVIEWS_STORES = {
  "APP_STORE": "app-store",
  "GOOGLE_PLAY": "google-play",
}

const REVIEWS_LIMIT = 50;
const DEFAULT_INTERVAL_SECONDS = 300;

var published_reviews = [];

(function() {
  exports.start = function start(config) {
    if (!config.store) {
      // Determine from which store reviews are downloaded
      config.store = (config.appId.indexOf("\.") > -1) ? REVIEWS_STORES.GOOGLE_PLAY : REVIEWS_STORES.APP_STORE;
    }

    var appInformation = {};

    if (config.store === REVIEWS_STORES.APP_STORE) {
      if (!config.region) {
        config.region = "us";
      }

      if (!config.feed) {
        config.feed = "https://itunes.apple.com/" + config.region + "/rss/customerreviews/id=" + config.appId + "/sortBy=mostRecent/xml";
      } else {
        console.log("INFO: Setting feed directly is deprecated, see updated docs at https://github.com/wahni/reviews-to-slack");
      }

      var watcher;
      watcher = new Watcher(config.feed);
      watcher.set({
        feed: config.feed,
        interval: config.interval != null ? config.interval : DEFAULT_INTERVAL_SECONDS
      });

      watcher.on(WATCHER_EVENTS.NEW_ARTICLE, function onNewArticle(item) {
        if (!item) {
          if (config.debug) console.log("WARNING: Received null or undefined review");
          return;
        }

        if (isAppInformationEntry(item)) {
          if (config.debug) console.log("INFO: Received new app information");
          updateAppInformation(config, item, appInformation);
          return;
        }

        review = exports.parseAppStoreReview(item, config, appInformation);

        if (!exports.reviewPublished(review)) {
          if (config.debug) console.log("INFO: Received new review: " + review);
          message = exports.slackMessage(review, config, appInformation);
          exports.postToSlack(message, config);
          exports.markReviewAsPublished(config, review);
        } else if (exports.reviewPublished(config, review)) {
          if (config.debug) console.log("INFO: Review already published: " + review.text);
        }
      });

      watcher.on(WATCHER_EVENTS.ERROR, function onError(error) {
        return console.error("ERROR: for new review: " + error);
      });

      return watcher.run(function run(error, entries) {
        if (error != null) return console.error("ERROR: Could not parse feed for " + config.appId + ", " + error);

        if (entries == null) return console.log("WARNING: Currently no reviews available for " + config.appId);

        // Parse existing entries for app information
        for (var i = 0; i < entries.length; i++) {
          var item = entries[i];

          var review = exports.parseAppStoreReview(item, config, appInformation);

          // Mark any eixsting reviews as published
          exports.markReviewAsPublished(config, review)
          
          updateAppInformation(config, item, appInformation);
        }

        if (config.debug) {
          console.log("INFO: Started watching app: " + (config.appName ? config.appName : appInformation.appName));          
          var welcome = welcomeMessage(config, appInformation);
          exports.postToSlack(welcome, config);
        }
      });
    } else {
      exports.fetchGooglePlayReviews(config, appInformation, function (initialReviews) {
        for (var i = 0; i < initialReviews.length; i++) {
          var initialReview = initialReviews[i];
          exports.markReviewAsPublished(config, initialReview);
        }

        var interval_seconds = config.interval ? config.interval : DEFAULT_INTERVAL_SECONDS;

        setInterval(function(config, appInformation) {
          if (config.debug) console.log("INFO: [" + config.appId + "] Fetching Google Play reviews");

          exports.fetchGooglePlayReviews(config, appInformation, function (reviews) {
            exports.handleFetchedGooglePlayReviews(config, appInformation, reviews);
          });
        }, interval_seconds * 1000, config, appInformation);

        if (config.debug) {
          console.log("INFO: [" + config.appId + "] Started watching app: " + (config.appName ? config.appName : appInformation.appName));          
          var welcome = welcomeMessage(config, appInformation);
          exports.postToSlack(welcome, config);
        }
      });
    }
  }
}).call(this);

exports.handleFetchedGooglePlayReviews = function(config, appInformation, reviews) {
  for (var n = 0; n < reviews.length; n++) {
    var review = reviews[n];
    if (exports.reviewPublished(review)) {
      continue;
    }
    if (config.debug) console.log("INFO: [" + config.appId + "] Found a new Google Play review: " + review.text);
    message = exports.slackMessage(review, config, appInformation);
    exports.postToSlack(message, config);
    exports.markReviewAsPublished(config, review);
  }
}

exports.fetchGooglePlayReviews = function(config, appInformation, callback) {
  form = {'xhr': 1, 'id': config.appId, 'reviewSortOrder': 0, 'pageNum': 0, 'reviewType': 0};
  if (config.region) {
    form['gl'] = config.region;
    form['hl'] = config.region;
  }
  result = request.post({
    url: 'https://play.google.com/store/getreviews',
    form: form
  },
    function (error, response, body) {
      if (config.debug) console.log("INFO: [" + config.appId + "] Got response for request " + JSON.stringify(response.request));
      if (error) {
        console.error("ERROR: [" + config.appId + "] Could not fetch Google Play reviews, " + error);
      } else {
        // The body contains some unwanted prefix data, then a JSON matrix (starts with '[')
        // The actual HTML body that contains the reviews is at position (0,2).
        body_string = String(body);
        json_body = JSON.parse(body_string.substring(body_string.indexOf('[')));
        reviews_body = json_body[0][2];

        if (!reviews_body) {
          if (config.debug) console.log("INFO: [" + config.appId + "] No reviews in body: " + body_string);
          callback([]);
        }

        $ = cheerio.load(reviews_body);

        var html_reviews = $('.single-review');

        var reviews = html_reviews.map(function (i, element) {
          // this === element
          var review = {};
          review.id = $(this).find('.review-header').attr('data-reviewid');
          review.date = $(this).find('.review-header .review-date').text().trim();
          review.title = $(this).find('.review-body .review-title').text().trim();
          review.text = $(this).find('.review-body').first().contents().filter(function() {
            return this.type === 'text';
          }).text().trim();
          review.author = $(this).find('.review-header .author-name').text().trim();
          ratingData = $(this).find('.current-rating').attr('style');
          review.rating = parseInt(ratingData.replace(/[^\d]/g, '')) / 20;
          review.link = 'https://play.google.com' + $(this).find('.reviews-permalink').attr('href'),

          review.storeName = "Google Play";

          return review;
        });

        console.log("INFO: [" + config.appId + "] Found " + reviews.length + " reviews");

        callback(reviews);
      }
    }
  );
}

// Published reviews

exports.markReviewAsPublished = function(config, review) {
  if (!review || !review.id || this.reviewPublished(review)) return;

  if (published_reviews.count >= REVIEWS_LIMIT) {
    published_reviews.pop(published_reviews.count - (REVIEWS_LIMIT + 1));
  }
  published_reviews.unshift(review.id);
}

exports.reviewPublished = function(review) {
  if (!review || !review.id) return false;
  return published_reviews.indexOf(review.id) >= 0;
}

exports.publishedReviews = function() {
  return published_reviews;
}

exports.resetPublishedReviews = function() {
  return published_reviews = [];
}

// App Store app information

var isAppInformationEntry = function(entry) {
    // App information is available in an entry with some special fields
    return entry != null && entry['im:name'];
}

var updateAppInformation = function(config, entry, appInformation) {
  if (!isAppInformationEntry(entry)) return;

  if (config.appName == null && entry['im:name'] != null) {
    appInformation.appName = entry['im:name']['#'];
    if (config.debug) console.log("INFO: Found app name: " + appInformation.appName);
  }

  if (config.appIcon == null && entry['im:image'] && entry['im:image'].length > 0) {
    appInformation.appIcon = entry['im:image'][0]['#'];
    if (config.debug) console.log("INFO: Found app icon: " + appInformation.appIcon);
  }

  if (config.appLink == null && entry['link']) {
    appInformation.appLink = entry['link'];
    if (config.debug) console.log("INFO: Found app link: " + appInformation.appLink);
  }
}

exports.parseAppStoreReview = function(rssItem, config, appInformation) {
  review = {};

  review.id = rssItem['id'];
  review.title = rssItem.title;
  review.text = rssItem.description;
  review.rating = reviewRating(rssItem, config);
  review.date = reviewDate(rssItem, config);
  review.author = rssItem.author;
  review.link = config.appLink ? config.appLink : appInformation.appLink;
  review.storeName = "App Store";

  return review;
}

// Slack

exports.slackMessage = function(review, config, appInformation) {
  if (config.debug) console.log("INFO: Creating message for review " + review.title);

  var stars = "";
  for (var i = 0; i < 5; i++) {
    stars += i < review.rating ? "★" : "☆";
  }

  var pretext = "New review";
  if (config.appName != null || appInformation.appName != null) {
    pretext += " for " + (config.appName ? config.appName : appInformation.appName);
  }
  pretext += "!";

  var color = review.rating >= 4 ? "good" : (review.rating >= 2 ? "warning" : "danger");

  var text = "";
  text += review.text + "\n";
  text += "_by " + review.author;
  if (review.date) {
    text += ", " + review.date;
  }
  if (review.link) {
    text += " - " + "<" + review.link + "|" + review.storeName + ">";
  } else {
    text += " - " + review.storeName;
  }
  text += "_";

  message = {
    "username": config.botUsername,
    "icon_url": config.botIcon,
    "channel": config.channel,
    "attachments": [
      {
        "mrkdwn_in": ["text", "pretext", "title"],
        "fallback": pretext + ": " + review.title + " (" + stars + "): " + review.text,

        "pretext": pretext,
        "color": color,

        "author_name": stars,
        "author_icon": config.appIcon ? config.appIcon : appInformation.appIcon,

        "title": review.title,
        "title_link": review.link,

        "text": text
      }
    ]
  }

  return message;
}

var welcomeMessage = function(config, appInformation) {
  var storeName = config.store === REVIEWS_STORES.APP_STORE ? "App Store" : "Google Play"; 
  var appName = config.appName ? config.appName : (appInformation.appName ? appInformation.appName : config.appId);
  return {
    "username": config.botUsername,
    "icon_url": config.botIcon,
    "channel": config.channel,
    "attachments": [
      {
        "mrkdwn_in": ["pretext", "author_name"],
        "fallback": "This channel will now receive " + storeName + " reviews for " + appName,
        "pretext": "This channel will now receive " + storeName + " reviews for ",
        "author_name": appName,
        "author_icon": config.appIcon ? config.appIcon : appInformation.appIcon
      }
    ]
  }
}

var reviewRating = function(review, config) {
  if (config.store === REVIEWS_STORES.APP_STORE)  {
    return review['im:rating'] != null && !isNaN(review['im:rating']['#']) ? parseInt(review['im:rating']['#']) : -1;
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    rating = review.title.substr(0, 1);
    return rating != null && !isNaN(rating) ? parseInt(rating) : -1;
  } else {
    return -1;
  }
}

var reviewDate = function(review, config) {
  if (config.store === REVIEWS_STORES.APP_STORE)  {
    return review.date.toISOString().replace("T", " ").substr(0, 16);
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    return undefined; // Google Play review RSS dates are often unreliable (current date instead of review date)
  } else {
    return undefined;
  }
}

exports.postToSlack = function(message, config) {
  messageJSON = JSON.stringify(message);
  if (config.debug) console.log("INFO: Posting new message to Slack: " + messageJSON);
  return result = request.post({
    url: config.slackHook,
    headers: {
      "Content-Type": "application/json"
    },
    body: messageJSON
  });
}