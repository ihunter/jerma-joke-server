require("dotenv").config();
const { db } = require("./db");
const moment = require("moment");

async function analyzeData() {
  const streamsCollectionSnapshot = await db.collection("streams").get();

  const streams = [];
  streamsCollectionSnapshot.forEach(async (stream) => {
    const streamData = stream.data();
    streams.push(streamData);
  });

  for (let i = 0; i < streams.length; i++) {
    const streamData = streams[i];
    const streamDocRef = db.collection("streams").doc(streamData.id);
    console.log("Stream:", streamData.title);

    const messages = [];
    const messagesCollectionRef = streamDocRef.collection("messages");
    const messagesQueryRef = messagesCollectionRef.orderBy("tmi-sent-ts");
    const messagesSnapshot = await messagesQueryRef.get();

    messagesSnapshot.forEach((message) => {
      messages.push(message.data());
    });

    let jokeScoreTotal = 0;
    let jokeScoreMin = 0;
    let jokeScoreMax = 0;
    let jokeScoreHigh = 0;
    let jokeScoreLow = 0;

    const timeSeries = new Map();
    const streamStartedAt = streamData.startedAt;

    messages.forEach((message) => {
      // Get total score
      jokeScoreTotal += message.joke ? 2 : -2;

      // Get high score
      jokeScoreHigh =
        jokeScoreTotal > jokeScoreHigh ? jokeScoreTotal : jokeScoreHigh;

      // Get low score
      jokeScoreLow =
        jokeScoreTotal < jokeScoreLow ? jokeScoreTotal : jokeScoreLow;

      // Get max score
      jokeScoreMax += message.joke ? 2 : 0;

      // Get min score
      jokeScoreMin += !message.joke ? -2 : 0;

      const messagePostedAt = moment(+message["tmi-sent-ts"]);
      const interval = messagePostedAt.diff(streamStartedAt, "minutes");

      if (timeSeries.has(interval)) {
        const intervalData = timeSeries.get(interval);
        intervalData.jokeScore += message.joke ? 2 : -2;

        intervalData.high =
          intervalData.jokeScore > intervalData.high
            ? intervalData.jokeScore
            : intervalData.high;

        intervalData.low =
          intervalData.jokeScore < intervalData.low
            ? intervalData.jokeScore
            : intervalData.low;

        intervalData.close = intervalData.jokeScore;

        // timeSeries.set(interval, value + jokeValue);
      } else {
        timeSeries.set(interval, {
          jokeScore: jokeScoreTotal,
          high: jokeScoreTotal,
          low: jokeScoreTotal,
          open: jokeScoreTotal,
          close: jokeScoreTotal,
        });
      }
    });

    const data = [];
    timeSeries.forEach((intervalData, key) => {
      data.push({
        interval: key,
        ...intervalData,
      });
    });

    try {
      await streamDocRef.set(
        {
          data,
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Failed to save condensed data:", error);
    }
  }
}

analyzeData();
