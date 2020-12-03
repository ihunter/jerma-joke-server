require('dotenv').config()
const axios = require('axios')

module.exports = () => {
  const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env

  const twitchAPI = axios.create({
    baseURL: process.env.TWITCH_API_URL,
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID
    }
  })

  let token = null
  let tokenExpiresIn = 0
  let startDate = Date.now()

  return async () => {
    const currentDate = Date.now()
    const durationInSeconds = Math.ceil((currentDate - startDate) / 1000)
    console.log(`Token Expires In ${tokenExpiresIn - durationInSeconds} Seconds`)

    if ((tokenExpiresIn - durationInSeconds) <= 0) {
      console.log('Token Expired, Requesting New Token')
      const res = await twitchAPI.post(
        `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
      )

      token = res.data.access_token
      tokenExpiresIn = res.data.expires_in
      startDate = Date.now()
      console.log(`New Token Expires In ${tokenExpiresIn} Seconds`)
    }

    twitchAPI.defaults.headers.common.Authorization = `Bearer ${token}`

    return twitchAPI
  }
}
