const api = require('./api')
const db = require('./db')

class Stream {
  constructor (userLogin = 'jerma985') {
    this.userLogin = userLogin
    this.id = null
    this.userID = null
    this.userName = null
    this.gameID = null
    this.type = null
    this.title = null
    this.viewerCount = null
    this.startedAt = null
    this.language = null
    this.thumbnailURL = null
    this.tagIDs = null
    this.live = null
  }

  async save () {
    try {
      if (!this.live) return
      const stream = JSON.parse(JSON.stringify(this))
      await db.collection('streams').doc(this.id).set(stream)
      console.log('Saved stream')
    } catch (error) {
      console.error('Error creating stream:', error)
    }
  }

  async update () {
    try {
      const response = await api().get(`streams?user_login=${this.userLogin}`)
      const data = response.data.data[0]

      if (!data) {
        this.type = 'offline'
        this.live = false
      } else {
        this.id = data.id
        this.userID = data.user_id
        this.userName = data.user_name
        this.gameID = data.game_id
        this.type = data.type
        this.title = data.title
        this.viewerCount = data.viewer_count
        this.startedAt = data.started_at
        this.language = data.language
        this.thumbnailURL = data.thumbnail_url
        this.tagIDs = data.tag_ids
        this.live = true
      }

      console.log('Updated stream')
    } catch (error) {
      console.error('Error updating stream:', error)
    }
  }
}

const stream = new Stream('Bugha')

stream.update()
  .then(() => {
    stream.save()
  })
  .catch(console.error)
