require('dotenv').config()

const tmi = require('tmi.js')
const api = require('./api')
const db = require('./db')
const moment = require('moment')

// eslint-disable-next-line new-cap
const client = new tmi.client({
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

const streamsCollectionRef = db.collection('streams')
let streamDocRef = null
let stream = null
let vod = null
const messages = []

async function getStream () {
  try {
    const response = await api.get(`streams?user_login=${process.env.USER_LOGIN}`)
    const stream = response.data.data[0]
    return stream
  } catch (error) {
    console.error('Failed to get stream:', error.response.data.message)
  }
}

async function getVod () {
  try {
    const response = await api.get(`videos?user_id=${process.env.USER_ID}`)
    const video = response.data.data[0]
    return video
  } catch (error) {
    console.error('Failed to get VOD:', error.response.data.message)
  }
}

async function updateStream () {
  try {
    const streamData = await getStream()
    const vodData = await getVod()
    if (stream && streamData && streamData.id !== stream.id) {
      streamDocRef = null
    }
    stream = streamData
    vod = vodData
  } catch (error) {
    console.error('Failed to get stream:', error)
  }

  if (stream && !streamDocRef) {
    try {
      console.log('Stream started, establishing database connection')
      // Clear messages array on stream start
      messages.length = 0
      streamDocRef = await streamsCollectionRef.doc(stream.id)
      await streamDocRef.set({ ...stream, vod }, { merge: true })
    } catch (error) {
      console.error('Error creating stream:', error)
    }
  } else if (stream && streamDocRef) {
    try {
      await analyzeDataFromMemory()// await analyzeData()
    } catch (error) {
      console.error('Failed to analyze stream:', error)
    }
  } else if (!stream && streamDocRef) {
    try {
      console.log('Stream over, final analysis')
      vod = await getVod()
      await streamDocRef.update({ type: 'offline', vod })
      await offlineAnalysis()
      // Clear messages array on stream over
      messages.length = 0
      streamDocRef = null
    } catch (error) {
      console.error('Failed to update stream:', error)
    }
  }
}

async function onMessageHandler (target, context, msg, self) {
  if (self) return console.log('No self response')

  if (!streamDocRef) return

  const message = msg.trim()

  if (message.includes('+2')) {
    context.joke = true
    context.msg = message
    try {
      messages.push(context)
      await streamDocRef.collection('messages').doc(context.id).set(context)
    } catch (error) {
      console.error('Failed to save message:', error)
    }
  } else if (message.includes('-2')) {
    context.joke = false
    context.msg = message
    try {
      messages.push(context)
      await streamDocRef.collection('messages').doc(context.id).set(context)
    } catch (error) {
      console.error('Failed to save message:', error)
    }
  }
}

async function analyzeDataFromMemory () {
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

  const streamStartedAt = moment(stream.started_at)
  const streamUpTime = moment().diff(streamStartedAt, 'minutes')

  let jokeScore = 0
  const parsedMessages = messages.map(message => {
    const messagePostedAt = moment(+message['tmi-sent-ts'])
    const messagePostTime = messagePostedAt.diff(streamStartedAt, 'minutes')

    message.joke ? jokeScore += 2 : jokeScore -= 2

    return { jokeScore, messagePostTime }
  })

  // Combine all messages with the same interval into one data point
  let interval = -1
  const condensedData = []
  for (let i = parsedMessages.length - 1; i >= 0; i--) {
    const message = parsedMessages[i]
    if (message.messagePostTime !== interval) {
      condensedData.unshift(message)
      interval = message.messagePostTime
    }
  }

  try {
    await streamDocRef.set({ condensedData, streamUpTime, jokeScoreTotal, jokeScoreMin, jokeScoreMax }, { merge: true })
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

  const streamStartedAt = moment(streamData.started_at)

  const analyzedData = []
  let jokeSum = 0
  messagesSnapshot.forEach(message => {
    const messageData = message.data()
    const messagePostedAt = moment(+messageData['tmi-sent-ts'])
    const messageStreamTimestamp = messagePostedAt.diff(streamStartedAt, 'minutes')

    if (messageData.joke) {
      jokeSum += 2
    } else {
      jokeSum -= 2
    }

    analyzedData.push({
      currentJokeValue: jokeSum,
      interval: messageStreamTimestamp
    })
  })
  console.log(jokeSum)
  await streamDocRef.set({ analyzedData }, { merge: true })
}

updateStream()

setInterval(updateStream, 10000)
