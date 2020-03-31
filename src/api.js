const axios = require('axios')

require('dotenv').config()

async function getOAuthToken () {
  const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env
  
  const res = await axios.post(
    `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
  )

  const cred = res.data

  return cred.access_token
}

module.exports = async () => {
  return axios.create({
    baseURL: process.env.TWITCH_API_URL,
    headers: {
      Authorization: `Bearer ${await getOAuthToken()}`,
      'Client-ID': process.env.TWITCH_CLIENT_ID
    }
  })
}
