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

(function() {
  exports.start = function start(config) {
    var watcher;
    watcher = new Watcher(config.feed);
    watcher.set({
      feed: config.feed,
		  interval: config.interval != null ? config.interval : 300
    });

    watcher.on(WATCHER_EVENTS.NEW_ARTICLE, function onNewArticle(review) {
      if (isAppInformationEntry(review)) {
		    if (config.debug) console.log("Received app information");
      } else {
		    if (config.debug) console.log("Received new review: " + review);
		    message = slackMessage(review, config);
		    return postToSlack(message, config);
	    }
    });

    watcher.on(WATCHER_EVENTS.ERROR, function onError(error) {
      return console.error("ERROR: for new review: " + error);
    });

    return watcher.run(function run(error, reviews) {
      if (error != null) {
        return console.error("ERROR: Could not parse feed " + config.feed + ", " + error);
      }

      if (reviews == null) {
        return console.log("WARNING: Currently no reviews available for " + config.feed);
      }

      // Parse existing reviews for app information
      for (var i = 0; i < reviews.length; i++) {
        var review = reviews[i];
        
        // App information is available in an entry with some special fields
        if (isAppInformationEntry(review)) {
          if (config.appName == null && review['im:name'] != null) {
            config.appName = review['im:name']['#'];
            if (config.debug) console.log("Found app name: " + config.appName);
          }

          if (config.appIcon== null && review['im:image'] && review['im:image'].length > 0) {
            config.appIcon = review['im:image'][0]['#'];
            if (config.debug) console.log("Found app icon: " + config.appIcon);
          }

          if (config.appLink == null && review['link']) {
            config.appLink = review['link'];
            if (config.debug) console.log("Found app link: " + config.appLink);
          }
        }
      }

      if (config.debug) {
        console.log("Started watching app: " + config.appName);
        var welcomeMessage = {
          "username": config.botUsername,
          "icon_url": config.botIcon,
          "channel": config.channel,
          "attachments": [
            {
              "mrkdwn_in": ["pretext", "author_name"],
              "fallback": "This channel will now receive App Store reviews for " + config.appName,
              "pretext": "This channel will now receive App Store reviews for ",
              "author_name": config.appName,
              "author_icon": config.appIcon
            }
          ]
        }
        postToSlack(welcomeMessage, config);
      } 
    });
  }
}).call(this);

var isAppInformationEntry = function(review) {
    return review != null && review['im:name'] != null;
}

var slackMessage = function(review, config) {
  if (config.debug) console.log("Creating message for review " + review.title);

  var title = review.title;
  var rating = review['im:rating'] != null && !isNaN(review['im:rating']['#']) ? parseInt(review['im:rating']['#']) : -1;
  var date = review.date.toISOString().replace("T", " ").substr(0, 16)

  var stars = "";
  for (var i = 0; i < 5; i++) {
    stars += i < rating ? "★" : "☆";
  }

  var pretext = "New review";
  if (config.appName != null) {
    pretext += " for " + config.appName;
  }
  pretext += "!";

  var color = rating >= 4 ? "good" : (rating >= 2 ? "warning" : "danger");

  var text = "";
  text += review.description + "\n";
  text += "_by " + review.author + ", " + date + "_";

  message = {
    "username": config.botUsername,
    "icon_url": config.botIcon,
    "channel": config.channel,
    "attachments": [
      {
        "mrkdwn_in": ["text", "pretext", "title"],
        "fallback": pretext + ": " + title + "(" + stars + "): " + review.author,

        "pretext": pretext,
        "color": color,

        "author_name": stars,
        "author_icon": config.appIcon,

        "title": title,
        "title_link": config.appLink,

        "text": text
      }
    ]
  }

  return message;
}

var postToSlack = function(message, config) {
  messageJSON = JSON.stringify(message);
  if (config.debug) console.log("Posting new message to Slack: " + messageJSON);
  return result = request.post({
    url: config.slackHook,
    headers: {
      "Content-Type": "application/json"
    },
    body: messageJSON
  });
}