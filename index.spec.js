/* global describe before */
/* global describe beforeEach */
/* global describe afterEach */
/* global describe it */

const sinon = require('sinon')
const chai = require('chai')
const expect = require('chai').expect
const sinonChai = require('sinon-chai')

const Watcher = require('rss-watcher')

const reviews = require('./index')

before(function () {
  chai.use(sinonChai)
})

beforeEach(function () {
  this.sandbox = sinon.sandbox.create()
  this.clock = sinon.useFakeTimers()
})

afterEach(function () {
  this.sandbox.restore()
  this.clock.restore()

  reviews.resetPublishedReviews()
})

describe('The module', function () {
  it('marks review as published', function * () {
    const review = {id: '123'}
    const config = {}

    const markReviewAsPublishedSpy = this.sandbox.spy(reviews, 'markReviewAsPublished')
    const reviewPublishedSpy = this.sandbox.spy(reviews, 'reviewPublished')

    expect(reviews.publishedReviews().length).to.eql(0)

    reviews.markReviewAsPublished(config, review)

    expect(markReviewAsPublishedSpy.callCount).to.eql(1)
    expect(reviewPublishedSpy.callCount).to.eql(1)

    expect(reviews.publishedReviews().length).to.eql(1)
    expect(reviews.reviewPublished(review)).to.eql(true)
  })

  it('does not mark other review as published', function * () {
    const review = {id: '123'}
    const otherReview = {id: '456'}
    const config = {}

    expect(reviews.publishedReviews().length).to.eql(0)

    reviews.markReviewAsPublished(config, review)

    expect(reviews.reviewPublished(review)).to.eql(true)
    expect(reviews.reviewPublished(otherReview)).to.eql(false)
  })

  it('resolves store to App Store', function * () {
    const config = {appId: '123'}

    const watcherSetStub = this.sandbox.stub(Watcher.prototype, 'set', function (settings) {

    })
    expect(watcherSetStub.callCount).to.eql(0)
    reviews.start(config)
    expect(watcherSetStub.callCount).to.eql(1)
    expect(config.store).to.eql('app-store')
  })

  it('resolves store to Google Play', function * () {
    const config = {appId: 'com.google.play'}
    const fetchGooglePlayReviewsStub = this.sandbox.stub(reviews, 'fetchGooglePlayReviews', function (config, appInformation) {
      return []
    })
    expect(fetchGooglePlayReviewsStub.callCount).to.eql(0)
    reviews.start(config)
    expect(fetchGooglePlayReviewsStub.callCount).to.eql(1)
    expect(config.store).to.eql('google-play')
  })

  it('parses App Store RSS item', function * () {
    const config = {
      appId: '123',
      appLink: 'http://www.google.com',
      store: 'app-store'
    }
    const theDate = new Date('2016-09-14T05:58:00-07:00')
    const rssItem = {
      id: '123',
      title: 'the title of the review',
      description: 'the text of the review',
      author: 'the author',
      date: theDate,
      'im:rating': {
        '#': 3
      }
    }

    const review = reviews.parseAppStoreReview(rssItem, config, {})

    expect(review.id).to.eql('123')
    expect(review.title).to.eql('the title of the review')
    expect(review.text).to.eql('the text of the review')
    expect(review.rating).to.eql(3)
    expect(review.date).to.eql('2016-09-14 12:58')
    expect(review.author).to.eql('the author')
    expect(review.link).to.eql('http://www.google.com')
    expect(review.storeName).to.eql('App Store')
  })

  it('generates Slack message from review', function * () {
    const config = {
      appName: 'the app name',
      appIcon: 'https://i.imgur.com/BoT.jpg',
      botUsername: 'the bot\'s username',
      botIcon: 'http://i.imgur.com/asdF.jpg',
      channel: '#notestforthewicked',
      store: 'app-store'
    }
    const review = {
      title: 'the title',
      text: 'the text',
      rating: 2,
      link: 'http://www.google.com',
      author: 'the author',
      storeName: 'App Store'
    }

    const message = reviews.slackMessage(review, config, {})

    expect(message.username).to.eql('the bot\'s username')
    expect(message.icon_url).to.eql('http://i.imgur.com/asdF.jpg')
    expect(message.channel).to.eql('#notestforthewicked')

    const attachment = message.attachments[0]

    expect(attachment.mrkdwn_in).to.eql(['text', 'pretext', 'title'])
    expect(attachment.fallback).to.eql('New review for ' + config.appName + '!: ' + review.title + ' (★★☆☆☆): ' + review.text)

    expect(attachment.pretext).to.eql('New review for ' + config.appName + '!')
    expect(attachment.color).to.eql('warning')

    expect(attachment.author_name).to.eql('★★☆☆☆')
    expect(attachment.author_icon).to.eql('https://i.imgur.com/BoT.jpg')

    expect(attachment.title).to.eql('the title')
    expect(attachment.title_link).to.eql('http://www.google.com')

    expect(attachment.text).to.eql(review.text + '\n_by the author - <http://www.google.com|App Store>_')
  })

  it('recognizes new Google Play reviews', function * () {
    const config = {
      appId: 'com.mock.id',
      store: 'google-play',
      interval: 1
    }

    const initialReviews = [
      {id: 123},
      {id: 456}
    ]

    const newReviews = [
      {id: 123},
      {id: 456},
      {id: 789}
    ]

    const reviewsFetchGooglePlayReviewsStub = this.sandbox.stub(reviews, 'fetchGooglePlayReviews', function (config, appInformation, callback) {
      switch (reviewsFetchGooglePlayReviewsStub.callCount) {
        case 1:
          // First call
          callback(initialReviews)
          break
        case 2:
          // Second call
          callback(initialReviews)
          break
        case 3:
          // Third call
          callback(newReviews)
          break
        default:
          break
      }
    })

    const reviewsPostToSlackStub = this.sandbox.stub(reviews, 'postToSlack')

    expect(reviewsFetchGooglePlayReviewsStub.callCount).to.eql(0)
    expect(reviewsPostToSlackStub.callCount).to.eql(0)

    // First call
    reviews.start(config)

    expect(reviewsFetchGooglePlayReviewsStub.callCount).to.eql(1)
    expect(reviewsPostToSlackStub.callCount).to.eql(0)

    this.clock.tick(1000)

    // Second call
    expect(reviewsFetchGooglePlayReviewsStub.callCount).to.eql(2)
    expect(reviewsPostToSlackStub.callCount).to.eql(0)

    this.clock.tick(1000)

    // Third call (should post a new message to Slack)
    expect(reviewsFetchGooglePlayReviewsStub.callCount).to.eql(3)
    expect(reviewsPostToSlackStub.callCount).to.eql(1)

    this.clock.tick(1000)

    // Fourth call
    expect(reviewsFetchGooglePlayReviewsStub.callCount).to.eql(4)
    expect(reviewsPostToSlackStub.callCount).to.eql(1)
  })
})
