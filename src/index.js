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

client.on('connected', onConnectedhandler)

client.on('message', onMessageHandler)

client.connect()

const streamsCollectionRef = db.collection('streams')
let streamDocRef = null

async function getStream () {
  try {
    const response = await api.get(`streams?user_login=${process.env.USER_LOGIN}`)
    const stream = response.data.data[0]
    return stream
  } catch (error) {
    console.error('Failed to get stream:', error.response.data.message)
  }
}

async function checkStream () {
  let stream = null

  try {
    stream = await getStream()
  } catch (error) {
    console.error('Failed to get stream:', error)
  }

  if (stream && !streamDocRef) {
    try {
      streamDocRef = await streamsCollectionRef.doc(stream.id)
      await streamDocRef.set(stream, { merge: true })
    } catch (error) {
      console.error('Error creating stream:', error)
    }
  } else if (stream && streamDocRef) {
    try {
      await analyzeData()
    } catch (error) {
      console.error('Failed to analyze stream:', error)
    }
  } else if (!stream && streamDocRef) {
    try {
      await streamDocRef.update({ type: 'offline' })
      await analyzeData()
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
      await streamDocRef.collection('messages').doc(context.id).set(context)
      console.log('+2 recorded')
    } catch (error) {
      console.error('Failed to save message:', error)
    }
  } else if (message.includes('-2')) {
    context.joke = false
    context.msg = message
    try {
      await streamDocRef.collection('messages').doc(context.id).set(context)
      console.log('-2 recorded')
    } catch (error) {
      console.error('Failed to save message:', error)
    }
  }
}

async function analyzeData () {
  try {
    const streamDoc = await streamDocRef.get()
    const streamData = streamDoc.data()
    const analyzedData = streamData.analyzedData || []

    const currentJokeTotal = analyzedData.length ? analyzedData[analyzedData.length - 1].currentJokeValue : 0

    let lastMessageSnapshot
    let messagesSnapshot

    // ID of last message used for calcualting tally
    let messageCursor = streamData.messageCursor
    if (messageCursor) {
      // Get the last message used for calculating tally
      lastMessageSnapshot = await streamDocRef.collection('messages').doc(messageCursor).get()
      messagesSnapshot = await streamDocRef.collection('messages').orderBy('tmi-sent-ts').startAfter(lastMessageSnapshot).get()
    } else {
      messagesSnapshot = await streamDocRef.collection('messages').orderBy('tmi-sent-ts').get()
    }

    if (!messagesSnapshot.docs.length) return

    const streamStartedAt = moment(streamData.started_at)

    let jokeTotal = 0
    messageCursor = messagesSnapshot.docs[messagesSnapshot.docs.length - 1].data().id

    messagesSnapshot.forEach(message => {
      const messageData = message.data()
      const messagePostedAt = moment(+messageData['tmi-sent-ts'])
      const messagePostTime = messagePostedAt.diff(streamStartedAt, 'minutes')

      if (messageData.joke) {
        jokeTotal += 2
      } else {
        jokeTotal -= 2
      }

      analyzedData.push({
        currentJokeValue: jokeTotal + currentJokeTotal,
        interval: messagePostTime
      })
    })

    await streamDocRef.set({ analyzedData, messageCursor }, { merge: true })
  } catch (error) {
    console.error('Failed to analyze data:', error)
  }
}

function onConnectedhandler (addr, port) {
  console.log(`* Connected to ${addr}:${port}`)
}

checkStream()

setInterval(checkStream, 1 * 10 * 1000)
