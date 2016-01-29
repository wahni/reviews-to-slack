/*!
 * reviews-to-slack
 * Copyright(c) 2015 Niklas Wahlén
 * MIT Licensed
 */

var request = require('request');
var Watcher = require('rss-watcher');

var WATCHER_EVENTS = {
  "NEW_ARTICLE": "new article",
  "ERROR": "error"
};

var REVIEWS_STORES = {
  "APP_STORE": "app-store",
  "GOOGLE_PLAY": "google-play",
}

var REVIEWS_LIMIT = 50;

var published_reviews = [];

(function() {
  exports.start = function start(config) {
    var appInformation = {};

    var watcher;
    watcher = new Watcher(config.feed);
    watcher.set({
      feed: config.feed,
		  interval: config.interval != null ? config.interval : 300
    });

    if (!config.store) {
      // Determine from which store reviews are downloaded
      config.store = (config.feed.indexOf("itunes.apple") > -1) ? REVIEWS_STORES.APP_STORE : REVIEWS_STORES.GOOGLE_PLAY;
    }

    watcher.on(WATCHER_EVENTS.NEW_ARTICLE, function onNewArticle(review) {
  		if (!review) {
  			if (config.debug) console.log("WARNING: Received null or undefined review");
  		} else if (isAppInformationEntry(review)) {
        if (config.debug) console.log("INFO: Received new app information");
        updateAppInformation(config, review, appInformation);
      } else if (!reviewPublished(config, review)) {
        if (config.debug) console.log("INFO: Received new review: " + review);
  	    message = slackMessage(review, config, appInformation);
        postToSlack(message, config);
        markReviewAsPublished(config, review);
      } else if (reviewPublished(config, review)) {
        if (config.store === REVIEWS_STORES.APP_STORE) {
          if (config.debug) console.log("INFO: Review already published: " + review.description);
        }
      }
    });

    watcher.on(WATCHER_EVENTS.ERROR, function onError(error) {
      return console.error("ERROR: for new review: " + error);
    });

    return watcher.run(function run(error, entries) {
      if (error != null) return console.error("ERROR: Could not parse feed " + config.feed + ", " + error);

      if (entries == null) return console.log("WARNING: Currently no reviews available for " + config.feed);

      // Parse existing entries for app information
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];

		    // Mark any eixsting reviews as published
        markReviewAsPublished(config, entry)
        
        updateAppInformation(config, entry, appInformation);
      }

      if (config.debug) {
        var appString = null;
        console.log("INFO: Started watching app: " + (config.appName ? config.appName : appInformation.appName));
        var store = storeName(config);
        var welcomeMessage = {
          "username": config.botUsername,
          "icon_url": config.botIcon,
          "channel": config.channel,
          "attachments": [
            {
              "mrkdwn_in": ["pretext", "author_name"],
              "fallback": "This channel will now receive " + store + " reviews for " + (config.appName ? config.appName : appInformation.appName),
              "pretext": "This channel will now receive " + store + " reviews for ",
              "author_name": config.appName ? config.appName : appInformation.appName,
              "author_icon": config.appIcon ? config.appIcon : appInformation.appIcon
            }
          ]
        }
        postToSlack(welcomeMessage, config);
      } 
    });
  }
}).call(this);

var storeName = function(config) {
  if (config.store === REVIEWS_STORES.APP_STORE)  {
    return "App Store";
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    return "Google Play";
  } else {
    return null;
  }
}

var markReviewAsPublished = function(config, review) {
  if (!review || reviewPublished(config, review)) return;

  var review_id = reviewId(config, review);
  if (!review_id) return;

  if (published_reviews.count >= REVIEWS_LIMIT) {
    published_reviews.pop(published_reviews.count - (REVIEWS_LIMIT + 1))
  }
  published_reviews.unshift(review_id)
}

var reviewPublished = function(config, review) {
  var review_id = reviewId(config, review);
  if (!review_id) return false;
  return published_reviews.indexOf(review_id) > -1
}

var reviewId = function(config, review) {
  if (config.store === REVIEWS_STORES.APP_STORE)  {
    return review['id'];
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    return review['guid'];
  } else {
    return null;
  }
}

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

var slackMessage = function(review, config, appInformation) {
  if (config.debug) console.log("INFO: Creating message for review " + review.title);

  var title = reviewTitle(review, config);
  var rating = reviewRating(review, config);
  var date = reviewDate(review, config);
  var author = reviewAuthor(review, config);
  var appLink = config.appLink ? config.appLink : appInformation.appLink;

  var stars = "";
  for (var i = 0; i < 5; i++) {
    stars += i < rating ? "★" : "☆";
  }

  var pretext = "New review";
  if (config.appName != null || appInformation.appName != null) {
    pretext += " for " + (config.appName ? config.appName : appInformation.appName);
  }
  pretext += "!";

  var color = rating >= 4 ? "good" : (rating >= 2 ? "warning" : "danger");

  var text = "";
  text += review.description + "\n";
  text += "_by " + author;
  if (date) {
    text += ", " + date;
  }
  if (appLink) {
    text += " - " + "<" + appLink + "|" + storeName(config) + ">";
  } else {
    text += " - " + storeName(config);
  }
  text += "_";

  message = {
    "username": config.botUsername,
    "icon_url": config.botIcon,
    "channel": config.channel,
    "attachments": [
      {
        "mrkdwn_in": ["text", "pretext", "title"],
        "fallback": pretext + ": " + title + " (" + stars + "): " + review.description,

        "pretext": pretext,
        "color": color,

        "author_name": stars,
        "author_icon": config.appIcon ? config.appIcon : appInformation.appIcon,

        "title": title,
        "title_link": appLink,

        "text": text
      }
    ]
  }

  return message;
}

var reviewTitle = function(review, config) {
  if (config.store === REVIEWS_STORES.APP_STORE)  {
    return review.title;
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    return null; // Google Play reviews does not have title
  } else {
    return null;
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
    return null; // Google Play review RSS dates are often unreliable (current date instead of review date)
  } else {
    return null;
  }
}

var reviewAuthor = function(review, config) {
  if (config.store === REVIEWS_STORES.APP_STORE)  {
    return review.author;
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    return review.title.substr(4);
  } else {
    return null;
  }
}

var postToSlack = function(message, config) {
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