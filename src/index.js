require('dotenv').config()

const tmi = require('tmi.js')
const axios = require('axios')
const db = require('./db')
const moment = require('moment')
axios.defaults.headers.common['Client-ID'] = process.env.TWITCH_CLIENT_ID

const streamsRef = db.collection('streams')
let streamRef = null

async function getStream () {
  try {
    const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${process.env.USER_LOGIN}`)
    const stream = response.data.data[0]
    return stream
  } catch (error) {
    console.error('Error getting stream:', error.response.data.message)
  }
}

async function checkStream () {
  let stream
  try {
    stream = await getStream()
  } catch (error) {
    console.error('Error getting stream')
  }

  try {
    streamRef = await streamsRef.doc(stream.id)
    await streamRef.set(stream)
  } catch (error) {
    console.error('Error creating stream:', error)
  }

  // Stream is live and reference is set
  if (stream && streamRef) {
    console.log('Analyzing live stream')
    await analyzeData()
    return
  }

  // Stream is offline and reference is unset
  if (!stream && !streamRef) return

  // Stream is offline and reference is set
  if (!stream && streamRef) {
    try {
      // Update stream to offline
      await streamRef.update({
        type: 'offline'
      })

      await analyzeData()
    } catch (error) {
      console.error('Error updating stream:', error)
    }
    // Unset reference to stream
    streamRef = null
  }
}

const options = {
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.OAUTH_TOKEN
  },
  channels: [
    process.env.CHANNEL_NAME
  ]
}

// eslint-disable-next-line new-cap
const client = new tmi.client(options)

client.on('connected', onConnectedhandler)

client.on('message', onMessageHandler)

client.connect()

async function onMessageHandler (target, context, msg, self) {
  if (self) return console.log('No self response')

  if (!streamRef) return

  const message = msg.trim()

  if (message.includes('+2')) {
    context.joke = true
    context.msg = message
    try {
      await streamRef.collection('messages').doc(context.id).set(context)
      console.log('+2 recorded')
    } catch (error) {
      console.error('Error saving message:', error)
    }
  } else if (message.includes('-2')) {
    context.joke = false
    context.msg = message
    try {
      await streamRef.collection('messages').doc(context.id).set(context)
      console.log('-2 recorded')
    } catch (error) {
      console.error('Error saving message:', error)
    }
  }
}

async function analyzeData () {
  try {
    let jokeTotal = 0
    const intervalValue = +process.env.INTERVAL_VALUE // Interval in minutes
    const messagesSnapshot = await streamRef.collection('messages').orderBy('tmi-sent-ts').get()
    const streamDoc = await streamRef.get()
    const streamData = streamDoc.data()

    const streamStartedAt = moment(streamData.started_at)

    const data = []
    let interval = intervalValue

    messagesSnapshot.forEach(message => {
      const messageData = message.data()
      const messagePostedAt = moment(+messageData['tmi-sent-ts'])
      const messagePostTime = messagePostedAt.diff(streamStartedAt, 'minutes')

      if (messageData.joke) {
        jokeTotal += 2
      } else {
        jokeTotal -= 2
      }

      if (messagePostTime > interval) {
        data.push({
          currentJokeValue: jokeTotal,
          interval: interval
        })

        interval += intervalValue
      }
    })

    await streamRef.set({
      analyzedData: data
    }, { merge: true })
  } catch (error) {
    console.log('Error analyzing data:', error)
  }
}

function onConnectedhandler (addr, port) {
  console.log(`* Connected to ${addr}:${port}`)
}

checkStream()

setInterval(checkStream, 5 * 60 * 1000)
