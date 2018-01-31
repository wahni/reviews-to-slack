[![Build Status](https://travis-ci.org/wahni/reviews-to-slack.svg?branch=master)](https://travis-ci.org/wahni/reviews-to-slack)
[![Coverage Status](https://coveralls.io/repos/github/wahni/reviews-to-slack/badge.svg?branch=master)](https://coveralls.io/github/wahni/reviews-to-slack?branch=master)

# reviews-to-slack

[Node.js](https://nodejs.org/) library for posting [App Store](https://itunes.apple.com/us/genre/ios/id36) and [Google Play](https://play.google.com/store) app reviews to [Slack](https://slack.com/).

```js
var reviews = require('reviews-to-slack')
reviews.start({
  slackHook: 'https://hooks.slack.com/services/T00000000/B00000000/token',
  appId: '123456789'
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
  appId: '123456789'
})
```

### More complex setup

Example that sends reviews for different apps to different channels. Can be extended with any combination of the options (see below).

```js
var reviews = require('reviews-to-slack')
var apps = [
  {
    appId: '123456789',
    channel: '#channel'
  },
  {
    appId: 'com.my.app',
    channel: '@user'
  }
]
for (var i = 0; i < apps.length; i++) {
  var app = apps[i]
  reviews.start({
    slackHook: 'https://hooks.slack.com/services/T00000000/B00000000/token',
    appId: app.appId,
    channel: app.channel
  })
}
```

## start(options) -- Available options

 - `slackHook`: Mandatory, URL to an incoming Slack webhook.
 - `appId`: Mandatory, ID of an app in App Store or Google Play, e.g. `123456789` or `com.my.app`.
 - `region`: Two-letter country code for App Store (e.g. `us`), or two-letter language code for Google Play (e.g. `en`).
 - `interval`: How often the feed should be queried, in seconds. **Default**: `300`
 - `debug`: Set to `true` to log debug information and send welcome message to Slack. **Default**: `false`
 - `channel`: Which channel to post to, set to override channel set in Slack.
 - `store`: To explicitly set the store, `app-store` or `google-play`. In most cases desired store can be derived from the appId so setting this is usually not required.
 - `botUsername`: Set to override the default bot username set in Slack.
 - `botIcon`: Set to override the default bot icon set in Slack.
 - `appName`: Set to override the app name fetched from the reviews provider.
 - `appIcon`: Set to override the app icon fetched from the reviews provider.
 - `appLink`: Set to override the app link fetched from the reviews provider.

## License
[MIT](LICENSE)
