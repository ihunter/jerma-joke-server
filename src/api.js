const axios = require('axios')

require('dotenv').config()

module.exports = () => {
  return axios.create({
    baseURL: process.env.TWITCH_API_URL,
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID
    }
  })
}
