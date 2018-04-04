/*!
 * reviews-to-slack
 * Copyright(c) 2018 Niklas Wahlén
 * MIT Licensed
 */

const request = require('request')
const Watcher = require('rss-watcher')
const cheerio = require('cheerio')

const WATCHER_EVENTS = {
  'NEW_ARTICLE': 'new article',
  'ERROR': 'error'
}

const REVIEWS_STORES = {
  'APP_STORE': 'app-store',
  'GOOGLE_PLAY': 'google-play'
}

const REVIEWS_LIMIT = 50
const DEFAULT_INTERVAL_SECONDS = 300

var publishedReviews = [];

(function () {
  exports.start = function start (config) {
    if (!config.store) {
      // Determine from which store reviews are downloaded
      config.store = (config.appId.indexOf('.') > -1) ? REVIEWS_STORES.GOOGLE_PLAY : REVIEWS_STORES.APP_STORE
    }

    var appInformation = {}

    if (config.store === REVIEWS_STORES.APP_STORE) {
      if (!config.region) {
        config.region = 'us'
      }

      if (!config.feed) {
        config.feed = 'https://itunes.apple.com/' + config.region + '/rss/customerreviews/id=' + config.appId + '/sortBy=mostRecent/xml'
      } else {
        console.log('INFO: Setting feed directly is deprecated, see updated docs at https://github.com/wahni/reviews-to-slack')
      }

      var watcher = new Watcher(config.feed)
      watcher.set({
        feed: config.feed,
        interval: config.interval != null ? config.interval : DEFAULT_INTERVAL_SECONDS
      })

      watcher.on(WATCHER_EVENTS.NEW_ARTICLE, function onNewArticle (item) {
        if (!item) {
          if (config.debug) console.log('WARNING: Received null or undefined review')
          return
        }

        if (isAppStoreInformationEntry(item)) {
          if (config.debug) console.log('INFO: Received new app information')
          updateAppStoreAppInformation(config, item, appInformation)
          return
        }

        var review = exports.parseAppStoreReview(item, config, appInformation)

        if (!exports.reviewPublished(review)) {
          if (config.debug) console.log('INFO: Received new review: ' + review)
          var message = exports.slackMessage(review, config, appInformation)
          exports.postToSlack(message, config)
          exports.markReviewAsPublished(config, review)
        } else if (exports.reviewPublished(config, review)) {
          if (config.debug) console.log('INFO: Review already published: ' + review.text)
        }
      })

      watcher.on(WATCHER_EVENTS.ERROR, function onError (error) {
        return console.error('ERROR: for new review: ' + error)
      })

      return watcher.run(function run (error, entries) {
        if (error != null) return console.error('ERROR: Could not parse feed for ' + config.appId + ', ' + error)

        if (entries == null) return console.log('WARNING: Currently no reviews available for ' + config.appId)

        // Parse existing entries for app information
        for (var i = 0; i < entries.length; i++) {
          var item = entries[i]

          var review = exports.parseAppStoreReview(item, config, appInformation)

          // Mark any eixsting reviews as published
          exports.markReviewAsPublished(config, review)

          updateAppStoreAppInformation(config, item, appInformation)
        }

        if (config.debug) {
          console.log('INFO: Started watching app: ' + (config.appName ? config.appName : appInformation.appName))
          var welcome = welcomeMessage(config, appInformation)
          exports.postToSlack(welcome, config)
        }
      })
    } else {
      exports.setupGooglePlayAppInformation(config, appInformation, function () {
        exports.fetchGooglePlayReviews(config, appInformation, function (initialReviews) {
          for (var i = 0; i < initialReviews.length; i++) {
            var initialReview = initialReviews[i]
            exports.markReviewAsPublished(config, initialReview)
          }

          var intervalSeconds = config.interval ? config.interval : DEFAULT_INTERVAL_SECONDS

          setInterval(function (config, appInformation) {
            if (config.debug) console.log('INFO: [' + config.appId + '] Fetching Google Play reviews')

            exports.fetchGooglePlayReviews(config, appInformation, function (reviews) {
              exports.handleFetchedGooglePlayReviews(config, appInformation, reviews)
            })
          }, intervalSeconds * 1000, config, appInformation)

          if (config.debug) {
            console.log('INFO: [' + config.appId + '] Started watching app: ' + (config.appName ? config.appName : appInformation.appName))
            var welcome = welcomeMessage(config, appInformation)
            exports.postToSlack(welcome, config)
          }
        })
      })
    }
  }
}).call(this)

// Google Play

exports.setupGooglePlayAppInformation = function (config, appInformation, callback) {
  appInformation.appLink = 'https://play.google.com/store/apps/details?id=' + config.appId

  if (config.region) {
    appInformation.appLink += '&gl=' + config.region + '&hl=' + config.region
  }

  request.get(appInformation.appLink, function (error, response, body) {
    if (error) {
      console.error('WARNING: [' + config.appId + '] Could not fetch app information, ' + error)
    } else if (body) {
      const $ = cheerio.load(body)
      appInformation.appName = $('[itemprop="name"]').text().trim()
      if (config.debug) console.log('INFO: [' + config.appId + '] Fetched app name: ' + appInformation.appName)

      var webpIcon = $('[itemprop="image"]').attr('src')
      if (typeof webpIcon === 'string' && !webpIcon.startsWith('http')) {
        webpIcon = 'https:' + webpIcon
      }
      appInformation.appIcon = webpIcon + '-no-tmp.png' // Force png as Slack currently cannot display the WebP image.
      if (config.debug) console.log('INFO: [' + config.appId + '] Fetched app icon: ' + appInformation.appIcon)
    }

    callback()
  })
}

exports.handleFetchedGooglePlayReviews = function (config, appInformation, reviews) {
  for (var n = 0; n < reviews.length; n++) {
    var review = reviews[n]
    if (exports.reviewPublished(review)) {
      continue
    }
    if (config.debug) console.log('INFO: [' + config.appId + '] Found a new Google Play review: ' + review.text)
    var message = exports.slackMessage(review, config, appInformation)
    exports.postToSlack(message, config)
    exports.markReviewAsPublished(config, review)
  }
}

exports.fetchGooglePlayReviews = function (config, appInformation, callback) {
  var form = {'xhr': 1, 'id': config.appId, 'reviewSortOrder': 0, 'pageNum': 0, 'reviewType': 0}
  if (config.region) {
    form['gl'] = config.region
    form['hl'] = config.region
  }
  request.post({
    url: 'https://play.google.com/store/getreviews',
    form: form
  },
    function (error, response, body) {
      if (config.debug) console.log('INFO: [' + config.appId + '] Got response for request ' + JSON.stringify(response.request))
      if (error) {
        console.error('ERROR: [' + config.appId + '] Could not fetch Google Play reviews, ' + error)
      } else {
        // The body contains some unwanted prefix data, then a JSON matrix (starts with '[')
        // The actual HTML body that contains the reviews is at position (0,2).
        var bodyString = String(body)
        var jsonBody = []
        try {
          jsonBody = JSON.parse(bodyString.substring(bodyString.indexOf('[')))
        } catch (e) {
          console.error('ERROR: [' + config.appId + '] Could not parse JSON in: ' + bodyString + ', ' + e)
          callback(new Error([]))
          return
        }

        var reviewsBody = jsonBody[0][2]

        if (!reviewsBody) {
          if (config.debug) console.log('INFO: [' + config.appId + '] No reviews in body: ' + bodyString)
          callback(new Error([]))
          return
        }

        try {
          var $ = cheerio.load(reviewsBody)
        } catch (e) {
          console.error('ERROR: [' + config.appId + '] Could not parse HTML: ' + reviewsBody + ', ' + e)
          callback(new Error([]))
          return
        }

        var htmlReviews = $('.single-review')

        var reviews = htmlReviews.map(function (i, element) {
          // this === element
          var review = {}
          review.id = $(this).find('.review-header').attr('data-reviewid')
          review.date = $(this).find('.review-header .review-date').text().trim()
          review.title = $(this).find('.review-body .review-title').text().trim()
          review.text = $(this).find('.review-body').first().contents().filter(function () {
            return this.type === 'text'
          }).text().trim()
          review.author = $(this).find('.review-header .author-name').text().trim()
          var ratingData = $(this).find('.current-rating').attr('style')
          review.rating = parseInt(ratingData.replace(/[^\d]/g, '')) / 20
          review.link = 'https://play.google.com' + $(this).find('.reviews-permalink').attr('href')

          review.storeName = 'Google Play'

          return review
        })

        callback(reviews)
      }
    }
  )
}

// Published reviews

exports.markReviewAsPublished = function (config, review) {
  if (!review || !review.id || this.reviewPublished(review)) return

  if (publishedReviews.count >= REVIEWS_LIMIT) {
    publishedReviews.pop(publishedReviews.count - (REVIEWS_LIMIT + 1))
  }
  publishedReviews.unshift(review.id)
}

exports.reviewPublished = function (review) {
  if (!review || !review.id) return false
  return publishedReviews.indexOf(review.id) >= 0
}

exports.publishedReviews = function () {
  return publishedReviews
}

exports.resetPublishedReviews = function () {
  publishedReviews = []
}

// App Store

var isAppStoreInformationEntry = function (entry) {
    // App Store app information is available in an entry with some special fields
  return entry != null && entry['im:name']
}

var updateAppStoreAppInformation = function (config, entry, appInformation) {
  if (!isAppStoreInformationEntry(entry)) return

  if (config.appName == null && entry['im:name'] != null) {
    appInformation.appName = entry['im:name']['#']
    if (config.debug) console.log('INFO: Found app name: ' + appInformation.appName)
  }

  if (config.appIcon == null && entry['im:image'] && entry['im:image'].length > 0) {
    appInformation.appIcon = entry['im:image'][0]['#']
    if (config.debug) console.log('INFO: Found app icon: ' + appInformation.appIcon)
  }

  if (config.appLink == null && entry['link']) {
    appInformation.appLink = entry['link']
    if (config.debug) console.log('INFO: Found app link: ' + appInformation.appLink)
  }
}

exports.parseAppStoreReview = function (rssItem, config, appInformation) {
  var review = {}

  review.id = rssItem['id']
  review.title = rssItem.title
  review.text = rssItem.description
  review.rating = reviewRating(rssItem, config)
  review.date = reviewDate(rssItem, config)
  review.author = rssItem.author
  review.link = config.appLink ? config.appLink : appInformation.appLink
  review.storeName = 'App Store'

  return review
}

// Slack

exports.slackMessage = function (review, config, appInformation) {
  if (config.debug) console.log('INFO: Creating message for review ' + review.title)

  var stars = ''
  for (var i = 0; i < 5; i++) {
    stars += i < review.rating ? '★' : '☆'
  }

  var pretext = 'New review'
  if (config.appName != null || appInformation.appName != null) {
    pretext += ' for ' + (config.appName ? config.appName : appInformation.appName)
  }
  pretext += '!'

  var color = review.rating >= 4 ? 'good' : (review.rating >= 2 ? 'warning' : 'danger')

  var text = ''
  text += review.text + '\n'
  text += '_by ' + review.author
  if (review.date) {
    text += ', ' + review.date
  }
  if (review.link) {
    text += ' - ' + '<' + review.link + '|' + review.storeName + '>'
  } else {
    text += ' - ' + review.storeName
  }
  text += '_'

  var message = {
    'username': config.botUsername,
    'icon_url': config.botIcon,
    'channel': config.channel,
    'attachments': [
      {
        'mrkdwn_in': ['text', 'pretext', 'title'],
        'fallback': pretext + ': ' + review.title + ' (' + stars + '): ' + review.text,

        'pretext': pretext,
        'color': color,

        'author_name': stars,
        'author_icon': config.appIcon ? config.appIcon : appInformation.appIcon,

        'title': review.title,
        'title_link': review.link,

        'text': text
      }
    ]
  }

  return message
}

var welcomeMessage = function (config, appInformation) {
  var storeName = config.store === REVIEWS_STORES.APP_STORE ? 'App Store' : 'Google Play'
  var appName = config.appName ? config.appName : (appInformation.appName ? appInformation.appName : config.appId)
  return {
    'username': config.botUsername,
    'icon_url': config.botIcon,
    'channel': config.channel,
    'attachments': [
      {
        'mrkdwn_in': ['pretext', 'author_name'],
        'fallback': 'This channel will now receive ' + storeName + ' reviews for ' + appName,
        'pretext': 'This channel will now receive ' + storeName + ' reviews for ',
        'author_name': appName,
        'author_icon': config.appIcon ? config.appIcon : appInformation.appIcon
      }
    ]
  }
}

var reviewRating = function (review, config) {
  if (config.store === REVIEWS_STORES.APP_STORE) {
    return review['im:rating'] != null && !isNaN(review['im:rating']['#']) ? parseInt(review['im:rating']['#']) : -1
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    var rating = review.title.substr(0, 1)
    return rating != null && !isNaN(rating) ? parseInt(rating) : -1
  } else {
    return -1
  }
}

var reviewDate = function (review, config) {
  if (config.store === REVIEWS_STORES.APP_STORE) {
    return review.date.toISOString().replace('T', ' ').substr(0, 16)
  } else if (config.store === REVIEWS_STORES.GOOGLE_PLAY) {
    return undefined // Google Play review RSS dates are often unreliable (current date instead of review date)
  } else {
    return undefined
  }
}

exports.postToSlack = function (message, config) {
  var messageJSON = JSON.stringify(message)
  if (config.debug) console.log('INFO: Posting new message to Slack: ' + messageJSON)
  return request.post({
    url: config.slackHook,
    headers: {
      'Content-Type': 'application/json'
    },
    body: messageJSON
  })
}
