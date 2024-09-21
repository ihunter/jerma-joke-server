import type { JokeData, Message, Stream } from '../types'
import dayjs from 'dayjs'
import { db } from '../db'
import 'dotenv/config'

async function analyzeData() {
  const streamsCollectionSnapshot = await db.collection('streams').get()

  const streams = streamsCollectionSnapshot.docs.map((doc) => {
    return doc.data() as Stream
  })

  for (let i = 0; i < streams.length; i++) {
    const streamData = streams[i]
    const streamDocRef = db.collection('streams').doc(streamData.id)

    const messagesCollectionRef = streamDocRef.collection('messages')
    const messagesQueryRef = messagesCollectionRef.orderBy('tmi-sent-ts')
    const messagesSnapshot = await messagesQueryRef.get()

    const messages = messagesSnapshot.docs.map((doc) => {
      return doc.data() as Message
    })

    let jokeScoreTotal = 0
    let jokeScoreMin = 0
    let jokeScoreMax = 0
    let jokeScoreHigh = 0
    let jokeScoreLow = 0

    const timeSeries = new Map<number, JokeData>()
    const streamStartedAt = streamData.startedAt

    messages.forEach((message) => {
      // Get total score
      jokeScoreTotal += message.joke ? 2 : -2

      // Get high score
      jokeScoreHigh
        = jokeScoreTotal > jokeScoreHigh ? jokeScoreTotal : jokeScoreHigh

      // Get low score
      jokeScoreLow
        = jokeScoreTotal < jokeScoreLow ? jokeScoreTotal : jokeScoreLow

      // Get max score
      jokeScoreMax += message.joke ? 2 : 0

      // Get min score
      jokeScoreMin += !message.joke ? -2 : 0

      const messagePostedAt = dayjs(Number.parseInt(message['tmi-sent-ts']))
      const interval = messagePostedAt.diff(streamStartedAt, 'minutes')
      const intervalData = timeSeries.get(interval)

      if (intervalData !== undefined) {
        intervalData.jokeScore += message.joke ? 2 : -2

        intervalData.high
          = intervalData.jokeScore > intervalData.high
            ? intervalData.jokeScore
            : intervalData.high

        intervalData.low
          = intervalData.jokeScore < intervalData.low
            ? intervalData.jokeScore
            : intervalData.low

        intervalData.close = intervalData.jokeScore

        intervalData.totalMinusTwo += message.joke ? 0 : -2

        intervalData.totalPlusTwo += message.joke ? 2 : 0

        intervalData.volume += 1
      }
      else {
        timeSeries.set(interval, {
          jokeScore: jokeScoreTotal,
          high: jokeScoreTotal,
          low: jokeScoreTotal,
          open: jokeScoreTotal,
          close: jokeScoreTotal,
          totalMinusTwo: jokeScoreMin,
          totalPlusTwo: jokeScoreMax,
          volume: 1,
        })
      }
    })

    const data = Array.from(timeSeries).map(([key, value]) => {
      return {
        interval: key,
        ...value,
      }
    })

    try {
      await streamDocRef.set(
        {
          data,
        },
        { merge: true },
      )
    }
    catch (error) {
      console.error('Failed to save condensed data:', error)
    }
  }
}

analyzeData()
