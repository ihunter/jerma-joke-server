require('dotenv').config()
const https = require('https')
const axios = require('axios')
const moment = require('moment')

module.exports = () => {
  const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env

  // https://stackoverflow.com/questions/63064393/getting-axios-error-connect-etimedout-when-making-high-volume-of-calls
  const twitchAPI = axios.create({
    baseURL: process.env.TWITCH_API_URL,
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID
    },
    timeout: 60000,
    httpsAgent: new https.Agent({ keepAlive: true })
  })

  let token = null
  let tokenExpiresIn = 0
  let startDate = Date.now()

  return async () => {
    const currentDate = Date.now()
    const durationInSeconds = Math.ceil((currentDate - startDate) / 1000)

    if ((tokenExpiresIn - durationInSeconds) <= 0) {
      console.log('Token expired, requesting new token')
      const res = await twitchAPI.post(
        `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
      )

      token = res.data.access_token
      tokenExpiresIn = res.data.expires_in
      startDate = Date.now()
      console.log(`New token expires in ${moment.duration(tokenExpiresIn, 'seconds').humanize()}`)
    }

    twitchAPI.defaults.headers.common.Authorization = `Bearer ${token}`

    return twitchAPI
  }
}
