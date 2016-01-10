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
    var appInformation = {};

    var watcher;
    watcher = new Watcher(config.feed);
    watcher.set({
      feed: config.feed,
		  interval: config.interval != null ? config.interval : 300
    });

    watcher.on(WATCHER_EVENTS.NEW_ARTICLE, function onNewArticle(review) {
      if (isAppInformationEntry(review)) {
        if (config.debug) console.log("INFO: Received new app information");
        updateAppInformation(config, review, appInformation);
      } else {
		    if (config.debug) console.log("INFO: Received new review: " + review);
		    message = slackMessage(review, config, appInformation);
		    return postToSlack(message, config);
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
        
        if (isAppInformationEntry(entry)) {
          updateAppInformation(config, entry, appInformation);
        }

        if (i == 1) {
          message = slackMessage(entry, config, appInformation);
          postToSlack(message, config);
        }
      }

      if (config.debug) {
        console.log("INFO: Started watching app: " + (config.appName ? config.appName : appInformation.appName));
        var welcomeMessage = {
          "username": config.botUsername,
          "icon_url": config.botIcon,
          "channel": config.channel,
          "attachments": [
            {
              "mrkdwn_in": ["pretext", "author_name"],
              "fallback": "This channel will now receive App Store reviews for " + (config.appName ? config.appName : appInformation.appName),
              "pretext": "This channel will now receive App Store reviews for ",
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

var isAppInformationEntry = function(entry) {
  // App information is available in an entry with some special fields
  return entry != null && entry['im:name'] != null;
}

var updateAppInformation = function(config, info, appInformation) {
  if (config.appName == null && info['im:name'] != null) {
    appInformation.appName = info['im:name']['#'];
    if (config.debug) console.log("INFO: Found app name: " + appInformation.appName);
  }

  if (config.appIcon == null && info['im:image'] && info['im:image'].length > 0) {
    appInformation.appIcon = info['im:image'][0]['#'];
    if (config.debug) console.log("INFO: Found app icon: " + appInformation.appIcon);
  }

  if (config.appLink == null && info['link']) {
    appInformation.appLink = info['link'];
    if (config.debug) console.log("INFO: Found app link: " + appInformation.appLink);
  }
}

var slackMessage = function(review, config, appInformation) {
  if (config.debug) console.log("INFO: Creating message for review " + review.title);

  var title = review.title;
  var rating = review['im:rating'] != null && !isNaN(review['im:rating']['#']) ? parseInt(review['im:rating']['#']) : -1;
  var date = review.date.toISOString().replace("T", " ").substr(0, 16)

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
        "author_icon": config.appIcon ? config.appIcon : appInformation.appIcon,

        "title": title,
        "title_link": config.appLink ? config.appLink : appInformation.appLink,

        "text": text
      }
    ]
  }

  return message;
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