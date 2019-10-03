require('dotenv').config()

const tmi = require('tmi.js')
const api = require('./api')
const db = require('./db')
const moment = require('moment')

const sleep = require('util').promisify(setTimeout)

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

client.on('message', onMessageHandler)

client.connect()

// Global
const streamsCollectionRef = db.collection('streams')
let streamDocRef = null
let stream = null
let startedAt = null
const messages = []
const games = []

function clearGlobals () {
  streamDocRef = null
  stream = null
  startedAt = null
  messages.length = 0
  games.length = 0
}

// Format stream data from twitch api
async function getStreamData () {
  try {
    const response = await api.get(`streams?user_login=${process.env.USER_LOGIN}`)
    const stream = response.data.data[0]

    if (!stream) return false

    if (!games.find(game => game.id === stream.game_id) && stream.game_id !== 0) {
      const game = await getGameData(stream.game_id)
      if (game) {
        console.log('New game detected:', game)
        games.push(game)
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
    console.error('Failed to get stream:', error.response.data.message)
  }
}

// Format video data from twitch api
async function getVideoData (id) {
  try {
    const query = id ? `videos?id=${id}` : `videos?user_id=${process.env.USER_ID}`
    const response = await api.get(query)
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
    const response = await api.get(`games?id=${gameID}`)
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
    console.log('Document Ref ID:', localStreamDocRef.id)
    console.log('Video ID:', videoID)
    clearGlobals()

    let video = await getVideoData(videoID)
    while (!video.thumbnailURL) {
      await sleep(2000)
      video = await getVideoData(videoID)
      console.log(video.thumbnailURL)
    }
    await localStreamDocRef.set({ type: 'offline', video }, { merge: true })
  } catch (error) {
    console.error('Failed to update stream:', error)
  }
}

async function onMessageHandler (target, context, message, self) {
  if (self) return console.log('No self response')

  if (!streamDocRef) return

  if (message.includes('+2')) {
    context.joke = true
    context.msg = message
    try {
      messages.push(context)
      await streamDocRef.collection('messages').doc(context.id).set(context)
      await analyzeData()
    } catch (error) {
      console.error('Failed to save message:', error)
    }
  } else if (message.includes('-2')) {
    context.joke = false
    context.msg = message
    try {
      messages.push(context)
      await streamDocRef.collection('messages').doc(context.id).set(context)
      await analyzeData()
    } catch (error) {
      console.error('Failed to save message:', error)
    }
  }
}

async function analyzeData () {
  // Calculate the total joke score so far
  const jokeScoreTotal = messages.reduce((sum, message) => {
    return message.joke ? sum + 2 : sum - 2
  }, 0)

  const jokeScoreMin = messages.reduce((sum, message) => {
    return message.joke ? sum : sum - 2
  }, 0)

  const jokeScoreMax = messages.reduce((sum, message) => {
    return message.joke ? sum + 2 : sum
  }, 0)

  let jokeScoreHigh = 0
  messages.reduce((sum, message) => {
    message.joke ? sum += 2 : sum -= 2
    if (sum > jokeScoreHigh) jokeScoreHigh = sum
    return sum
  }, 0)

  let jokeScoreLow = 0
  messages.reduce((sum, message) => {
    message.joke ? sum += 2 : sum -= 2
    if (sum < jokeScoreLow) jokeScoreLow = sum
    return sum
  }, 0)

  const streamStartedAt = moment(startedAt)
  const streamUpTime = moment().diff(streamStartedAt, 'minutes')

  let jokeScore = 0
  const parsedMessages = messages.map(message => {
    const messagePostedAt = moment(+message['tmi-sent-ts'])
    const interval = messagePostedAt.diff(streamStartedAt, 'minutes')

    message.joke ? jokeScore += 2 : jokeScore -= 2

    return { jokeScore, interval }
  })

  // Combine all messages with the same interval into one data point
  let interval = -1
  const data = []
  for (let i = parsedMessages.length - 1; i >= 0; i--) {
    const message = parsedMessages[i]
    if (message.interval !== interval) {
      data.unshift(message)
      interval = message.interval
    }
  }

  try {
    await streamDocRef.set({ games, data, streamUpTime, jokeScoreTotal, jokeScoreMin, jokeScoreMax, jokeScoreHigh, jokeScoreLow }, { merge: true })
  } catch (error) {
    console.error('Failed to save condensed data:', error)
  }
}

async function offlineAnalysis (streamID) {
  const streamDocRef = await streamsCollectionRef.doc(`${streamID}`)
  const messagesCollectionRef = await streamDocRef.collection('messages')
  const messagesQueryRef = await messagesCollectionRef.orderBy('tmi-sent-ts')

  const streamSnapshot = await streamDocRef.get()
  const messagesSnapshot = await messagesQueryRef.get()

  const streamData = streamSnapshot.data()

  const stream = {
    id: streamData.id,
    gameID: streamData.game_id,
    startedAt: streamData.started_at,
    thumbnailURL: streamData.thumbnail_url,
    title: streamData.title,
    type: streamData.type,
    userID: streamData.user_id,
    userName: streamData.user_name
  }

  let jokeScoreTotal = 0
  messagesSnapshot.forEach(message => {
    message.data().joke ? jokeScoreTotal += 2 : jokeScoreTotal -= 2
  })

  let jokeScoreMin = 0
  messagesSnapshot.forEach(message => {
    message.data().joke ? jokeScoreMin += 0 : jokeScoreMin -= 2
  })

  let jokeScoreMax = 0
  messagesSnapshot.forEach(message => {
    message.data().joke ? jokeScoreMax += 2 : jokeScoreMax += 0
  })

  let sum = 0
  let jokeScoreHigh = 0
  messagesSnapshot.forEach(message => {
    message.data().joke ? sum += 2 : sum -= 2
    if (sum > jokeScoreHigh) jokeScoreHigh = sum
  })

  sum = 0
  let jokeScoreLow = 0
  messagesSnapshot.forEach(message => {
    message.data().joke ? sum += 2 : sum -= 2
    if (sum < jokeScoreLow) jokeScoreLow = sum
  })

  const streamStartedAt = moment(startedAt)

  let jokeScore = 0
  const parsedMessages = []
  messagesSnapshot.forEach(message => {
    const messageData = message.data()
    const messagePostedAt = moment(+messageData['tmi-sent-ts'])
    const interval = messagePostedAt.diff(streamStartedAt, 'minutes')

    messageData.joke ? jokeScore += 2 : jokeScore -= 2

    parsedMessages.push({ jokeScore, interval })
  })

  let interval = -1
  const data = []
  for (let i = parsedMessages.length - 1; i >= 0; i--) {
    const message = parsedMessages[i]
    if (message.interval !== interval) {
      data.unshift(message)
      interval = message.interval
    }
  }

  await streamDocRef.set({ ...stream, data, jokeScoreTotal, jokeScoreMin, jokeScoreMax, jokeScoreHigh, jokeScoreLow }, { merge: true })
}

update()
setInterval(update, 10000)

// offlineAnalysis('35453791088')
//   .then(() => console.log('Jobs done.'))
//   .catch(console.error)
