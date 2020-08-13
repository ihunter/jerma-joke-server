require('dotenv').config()

const tmi = require('tmi.js')
const API = require('./api')
const { db } = require('./db')
const moment = require('moment')
const api = API()

const sleep = require('util').promisify(setTimeout)

const ONE_SECOND = 1000
const TEN_SECONDS = ONE_SECOND * 10

// eslint-disable-next-line new-cap
const client = new tmi.client({
  connection: {
    reconnect: true
  },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.OAUTH_TOKEN
  },
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
const newMessages = []
const games = []
let analyzeDataIntervalID = null

function clearGlobals () {
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
async function getStreamData () {
  try {
    const twitchAPI = await api()
    const response = await twitchAPI.get(`streams?user_login=${process.env.USER_LOGIN}`)
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
    console.error('Failed to get stream:', error)
  }
}

// Format video data from twitch api
async function getVideoData (id) {
  try {
    const query = id ? `videos?id=${id}` : `videos?user_id=${process.env.USER_ID}`
    const twitchAPI = await api()
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
    console.error('Failed to get VOD:', error.response.data.message)
  }
}

async function getGameData (gameID) {
  try {
    const twitchAPI = await api()
    const response = await twitchAPI.get(`games?id=${gameID}`)
    const game = response.data.data[0]

    if (!game) return false

    return {
      id: game.id,
      name: game.name,
      boxArtURL: game.box_art_url
    }
  } catch (error) {
    console.error('Failed to get game:', error.response.data.message)
  }
}

async function update () {
  try {
    const streamTemp = await getStreamData()

    if ((stream && streamTemp) && (stream.id !== streamTemp.id)) {
      console.log('New stream detected')
      endOfStream()
    }

    stream = streamTemp
  } catch (error) {
    console.error('Failed to update stream:', error)
  }

  if (stream && !streamDocRef) {
    try {
      console.log('Stream started, establishing database connection')
      startedAt = stream.startedAt
      streamDocRef = await streamsCollectionRef.doc(stream.id)

      const messagesCollectionRef = await streamDocRef.collection('messages')
      const messagesQueryRef = await messagesCollectionRef.orderBy('tmi-sent-ts')
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

async function endOfStream () {
  try {
    console.log('Stream over, final analysis')
    const localStreamDocRef = streamDocRef
    const streamDoc = await streamDocRef.get()
    const streamData = streamDoc.data()
    const videoID = streamData.video.id
    const streamStartedAt = moment(startedAt)
    const streamUpTime = moment().diff(streamStartedAt, 'minutes')
    clearGlobals()

    await localStreamDocRef.set({ type: 'offline', streamUpTime }, { merge: true })

    let video = await getVideoData(videoID)
    while (!video.thumbnailURL) {
      await sleep(2000)
      video = await getVideoData(videoID)
    }

    await localStreamDocRef.set({ video }, { merge: true })
    console.log('Final analysis complete')
  } catch (error) {
    console.error('Failed to update stream:', error)
  }
}

async function onMessageHandler (target, context, message, self) {
  if (self || !streamDocRef) return

  const score = message.match(/(?<=^|\s)[+-]2(?=$|\s)/g)

  if (!score) return

  context.joke = score.includes('+2')
  context.msg = message

  messages.push(context)
  newMessages.push(context)
}

async function analyzeData () {
  // Check if any new messages have been recorded
  if (newMessages.length <= 0) return

  // Batch write new messages to the database
  const batch = db.batch()
  newMessages.forEach(msg => {
    const ref = streamDocRef.collection('messages').doc(msg.id)
    batch.set(ref, msg)
  })
  await batch.commit()

  newMessages.length = 0

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
