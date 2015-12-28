# reviews-to-slack

[Node.js](https://nodejs.org/) library for posting app reviews to [Slack](https://slack.com/).

```js
var reviews = require('reviews-to-slack')
reviews.start({
  slackHook: 'https://hooks.slack.com/services/T00000000/B00000000/token',
  feed: 'https://itunes.apple.com/us/rss/customerreviews/id=123456789/sortBy=mostRecent/xml'
})
```

## Installation

```sh
npm install reviews-to-slack
```

## Usage

### Quick setup

Only provide mandatory fields to send reviews for an app to the default channel for the webhook.

```js
var reviews = require('reviews-to-slack')
reviews.start({
  slackHook: 'https://hooks.slack.com/services/T00000000/B00000000/token',
  feed: 'https://itunes.apple.com/us/rss/customerreviews/id=123456789/sortBy=mostRecent/xml'
})
```

### More complex setup

Example that sends reviews for different apps to different channels. Can be extended with any combination of the options (see below).

```js
var reviews = require('reviews-to-slack')
var apps = [
  {
    feed: 'https://itunes.apple.com/us/rss/customerreviews/id=123456789/sortBy=mostRecent/xml',
    channel: '#channel'
  },
  {
    feed: 'https://itunes.apple.com/us/rss/customerreviews/id=987654321/sortBy=mostRecent/xml',
    channel: '@user'
  }
]
for (var i = 0; i < apps.length; i++) {
  var app = app[i]
  reviews.start({
    slackHook: 'https://hooks.slack.com/services/T00000000/B00000000/token',
    feed: app.feed,
    channel: app.channel
  })
}
```

## start(options) -- Available options

 - `slackHook`: Mandatory, URL to an incoming Slack webhook
 - `feed`: Mandatory, URL to a review feed, i.e. `https://itunes.apple.com/COUNTRY_IDENTIFIER/rss/customerreviews/id=APP_ID/sortBy=mostRecent/xml`
 - `interval`: How often the feed should be queried, in seconds. **Default**: `300`
 - `debug`: Set to `true` to log debug information and send welcome message to Slack. **Default**: `false`
 - `channel`: Which channel to post to, set to override channel set in Slack
 - `botUsername`: Set to override the default bot username set in Slack
 - `botIcon`: Set to override the default bot icon set in Slack
 - `appName`: Set to override the app name fetched from the feed
 - `appIcon`: Set to override the app icon fetched from the feed
 - `appLink`: Set to override the app link fetched from the feed

## License
[MIT](LICENSE)
