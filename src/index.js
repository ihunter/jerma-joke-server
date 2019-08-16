require('dotenv').config()

const tmi = require('tmi.js')
const admin = require('firebase-admin')
const axios = require('axios')
axios.defaults.headers.common['Client-ID'] = process.env.CLIENT_ID

// const serviceAccount = require('../jerma-joke-firebase-adminsdk-4vksc-6b4b6c4893.json')

const serviceAccount = {
  type: process.env.TYPE,
  project_id: process.env.PROJECT_ID,
  private_key_id: process.env.PRIVATE_KEY_ID,
  private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.CLIENT_EMAIL,
  client_id: process.env.CLIENT_ID,
  auth_uri: process.env.AUTH_URI,
  token_uri: process.env.TOKEN_URI,
  auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.CLIENT_CERT_URL
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://jerma-joke.firebaseio.com'
})

const db = admin.firestore()
const streamsRef = db.collection('streams')
let streamRef

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
  const stream = await getStream()

  if (!stream) return

  streamRef = await streamsRef.doc(stream.id)

  await streamRef.set(stream)
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

  if (message.indexOf('+2') !== -1) {
    context.joke = true
    context.msg = message
    await streamRef.collection('messages').doc(context.id).set(context)
  } else if (message.indexOf('-2') !== -1) {
    context.joke = false
    context.msg = message
    await streamRef.collection('messages').doc(context.id).set(context)
  }
}

function onConnectedhandler (addr, port) {
  console.log(`* Connected to ${addr}:${port}`)
}

setInterval(checkStream, 60000)
