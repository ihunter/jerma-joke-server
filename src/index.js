require('dotenv').config()

const tmi = require('tmi.js')
const twitchAPI = require('./api')
const { db } = require('./db')
const moment = require('moment')
const errorHandler = require('./axios-error-handling')

const sleep = require('util').promisify(setTimeout)

const ONE_SECOND = 1000
const TEN_SECONDS = ONE_SECOND * 10

const client = new tmi.client({
  channels: [
    process.env.CHANNEL_NAME
  ]
})

// Global
const streamsCollectionRef = db.collection('streams')
let streamDocRef = null
let stream = null
let startedAt = null
const messages = []
let newMessages = []
const games = []
let analyzeDataIntervalID = null

function clearGlobals() {
  streamDocRef = null
  stream = null
  startedAt = null
  messages.length = 0
  games.length = 0
  clearInterval(analyzeDataIntervalID)
}

client.on('message', onMessageHandler)
client.connect()

// Format stream data from twitch api
async function getStreamData() {
  try {
    const response = await twitchAPI.get(`streams?user_id=${process.env.USER_ID}`)
    const stream = response.data.data[0]

    if (!stream) return false

    if (stream.game_id !== 0 && !games.find(game => game.id === stream.game_id)) {
      const game = await getGameData(stream.game_id)
      if (game) {
        games.push(game)
        if (streamDocRef) {
          await streamDocRef.set({ games }, { merge: true })
        }
      }
    }

    const video = await getVideoData()

    return {
      id: stream.id,
      games: games,
      startedAt: stream.started_at,
      thumbnailURL: stream.thumbnail_url,
      title: stream.title,
      type: stream.type,
      userID: stream.user_id,
      userName: stream.user_name,
      video: video
    }
  } catch (error) {
    console.error('Failed to get stream')
    errorHandler(error)
  }
}

// Format video data from twitch api
async function getVideoData() {
  try {
    const query = `videos?user_id=${process.env.USER_ID}`
    const response = await twitchAPI.get(query)
    const video = response.data.data[0]

    if (!video) return false

    return {
      id: video.id,
      userID: video.user_id,
      userName: video.user_name,
      title: video.title,
      createdAt: video.created_at,
      publishedAt: video.published_at,
      URL: video.url,
      thumbnailURL: video.thumbnail_url,
      type: video.type,
      duration: video.duration
    }
  } catch (error) {
    console.error('Failed to get VOD')
    errorHandler(error)
  }
}

async function getGameData(gameID) {
  try {
    const response = await twitchAPI.get(`games?id=${gameID}`)
    const game = response.data.data[0]

    if (!game) return false

    return {
      id: game.id,
      name: game.name,
      boxArtURL: game.box_art_url
    }
  } catch (error) {
    console.error('Failed to get game')
    errorHandler(error)
  }
}

async function update() {
  try {
    const streamTemp = await getStreamData()

    if ((stream && streamTemp) && (stream.id !== streamTemp.id)) {
      console.log('New stream detected')
      endOfStream()
    }

    stream = streamTemp
  } catch (error) {
    console.error('Failed to update stream')
    errorHandler(error)
  }

  if (stream && !streamDocRef) {
    try {
      console.log('Stream started, establishing database connection')
      startedAt = stream.startedAt
      streamDocRef = streamsCollectionRef.doc(stream.id)

      const messagesCollectionRef = streamDocRef.collection('messages')
      const messagesQueryRef = messagesCollectionRef.orderBy('tmi-sent-ts')
      const messagesSnapshot = await messagesQueryRef.get()

      messagesSnapshot.forEach(message => {
        messages.push(message.data())
      })

      await streamDocRef.set({ ...stream }, { merge: true })

      analyzeDataIntervalID = setInterval(analyzeData, ONE_SECOND)
    } catch (error) {
      console.error('Error creating stream:', error)
    }
  } else if (!stream && streamDocRef) {
    endOfStream()
  }
}

async function endOfStream() {
  try {
    console.log('Stream over, final analysis')
    const localStreamDocRef = streamDocRef
    const streamStartedAt = moment(startedAt)
    const streamUpTime = moment().diff(streamStartedAt, 'minutes')
    clearGlobals()

    await localStreamDocRef.set({ type: 'offline', streamUpTime }, { merge: true })

    let video = await getVideoData()
    while (!video.thumbnailURL) {
      await sleep(2000)
      video = await getVideoData()
    }

    await localStreamDocRef.set({ video }, { merge: true })
    console.log('Final analysis complete')
  } catch (error) {
    console.error('Failed to update stream:', error)
  }
}

async function onMessageHandler(target, context, message, self) {
  if (self || !streamDocRef) return

  const plus2Emote = 'jermaPlus2'
  const minus2Emote = 'jermaMinus2'

  const score = message.match(/(?<=^|\s)[+-]2(?=$|\s)/g) || message.includes(plus2Emote) || message.includes(minus2Emote)

  if (!score) return

  context.joke = score.includes('+2') || score.includes(plus2Emote)
  context.msg = message

  newMessages.push(context)
}

async function analyzeData() {
  // Check if any new messages have been recorded
  if (newMessages.length <= 0) return
  messages.push(...newMessages)
  const before = newMessages.length

  // Batch write new messages to the database
  const batch = db.batch()
  newMessages.forEach(msg => {
    const ref = streamDocRef.collection('messages').doc(msg.id)
    batch.set(ref, msg)
  })
  await batch.commit()

  newMessages = newMessages.slice(before)

  let jokeScoreTotal = 0
  let jokeScoreMin = 0
  let jokeScoreMax = 0
  let jokeScoreHigh = 0
  let jokeScoreLow = 0

  const timeSeries = new Map()
  const streamStartedAt = moment(startedAt)
  const streamUpTime = moment().diff(streamStartedAt, 'minutes')

  messages.forEach(message => {
    // Get total score
    jokeScoreTotal += message.joke ? 2 : -2

    // Get high score
    jokeScoreHigh = jokeScoreTotal > jokeScoreHigh ? jokeScoreTotal : jokeScoreHigh

    // Get low score
    jokeScoreLow = jokeScoreTotal < jokeScoreLow ? jokeScoreTotal : jokeScoreLow

    // Get max score
    jokeScoreMax += message.joke ? 2 : 0

    // Get min score
    jokeScoreMin += !message.joke ? -2 : 0

    const messagePostedAt = moment(+message['tmi-sent-ts'])
    const interval = messagePostedAt.diff(streamStartedAt, 'minutes')

    if (timeSeries.has(interval)) {
      const jokeValue = message.joke ? 2 : -2
      const value = timeSeries.get(interval)
      timeSeries.set(interval, value + jokeValue)
    } else {
      timeSeries.set(interval, jokeScoreTotal)
    }
  })

  const data = []
  timeSeries.forEach((value, key) => {
    data.push({
      interval: key,
      jokeScore: value
    })
  })

  try {
    await streamDocRef.set(
      {
        data,
        streamUpTime,
        jokeScoreTotal,
        jokeScoreMin,
        jokeScoreMax,
        jokeScoreHigh,
        jokeScoreLow
      },
      { merge: true }
    )
  } catch (error) {
    console.error('Failed to save condensed data:', error)
  }
}

update()
setInterval(update, TEN_SECONDS)
