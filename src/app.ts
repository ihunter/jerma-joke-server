import "dotenv/config";

import tmi from "tmi.js";
import dayjs from "dayjs";
import { db } from "./db";
import { twitchApi } from "./api";
import { errorHandler } from "./utils/axios-error-handling";
import { promisify } from "util";
import type {
  TwitchStreamResponse,
  TwitchGameResponse,
  TwitchVideoResponse,
  StreamInfo,
  Message,
  JokeData,
} from "./types";
import { AxiosError } from "axios";

const sleep = promisify(setTimeout);

const ONE_SECOND = 1000;
const TEN_SECONDS = ONE_SECOND * 10;
const channelName = process.env.CHANNEL_NAME || "";

const client = new tmi.client({
  channels: [channelName],
});

// Global
let streamDocRef:
  | FirebaseFirestore.DocumentReference<
      FirebaseFirestore.DocumentData,
      FirebaseFirestore.DocumentData
    >
  | undefined;
let stream: StreamInfo | undefined;
const messages: Message[] = [];
const newMessages: Message[] = [];

let analyzeDataIntervalId: ReturnType<typeof setInterval>;

function clearGlobals() {
  streamDocRef = undefined;
  stream = undefined;
  messages.length = 0;
  newMessages.length = 0;
  clearInterval(analyzeDataIntervalId);
}

client.connect().then(() => {
  console.log(`Listening to ${process.env.CHANNEL_NAME}`);
});

client.on("message", (channel, userstate, message, self) => {
  if (self || !streamDocRef) return;

  const score =
    message.match(/(?<=^|\s)[+-]2(?=$|\s)/g) ||
    message.match(/(?<=^|\s)jermaPlus2(?=$|\s)/g) ||
    message.match(/(?<=^|\s)jermaMinus2(?=$|\s)/g);

  if (!score) return;

  userstate.joke = score.includes("+2") || score.includes("jermaPlus2");
  userstate.msg = message;

  newMessages.push(userstate as Message);
});

async function update() {
  try {
    const currentStream = await getStreamData();

    if (currentStream) {
      if (stream && stream.id !== currentStream.id) {
        console.log("New stream detected");
        endOfStream();
      }

      stream = currentStream;
    }
  } catch (error) {
    console.error("Failed to update stream");
    if (error instanceof AxiosError) {
      errorHandler(error);
    }
  }

  if (stream && !streamDocRef) {
    try {
      console.log("Stream detected, establishing database connection");
      // Get stream doc from database or create if one doesn't exist
      streamDocRef = db.collection("streams").doc(stream.id);

      // Get messages subcollection or create if one doesn't exist
      const messagesCollectionRef = streamDocRef.collection("messages");
      const messagesQueryRef = messagesCollectionRef.orderBy("tmi-sent-ts");
      const messagesSnapshot = await messagesQueryRef.get();

      messagesSnapshot.forEach((doc) => {
        messages.push(doc.data() as Message);
      });

      await streamDocRef.set({ ...stream }, { merge: true });

      analyzeDataIntervalId = setInterval(analyzeData, ONE_SECOND);
    } catch (error) {
      console.error("Error creating stream:", error);
    }
  } else if (!stream && streamDocRef) {
    endOfStream();
  }
}

// Format stream data from twitch api
async function getStreamData() {
  try {
    const { data } = await twitchApi.get<TwitchStreamResponse>(
      `streams?user_id=${process.env.USER_ID}`
    );

    const currentStream = data.data.at(0);

    if (!currentStream) return;

    // Check if stream already exists in the db
    if (!stream) {
      const streamDocRef = db.collection("streams").doc(currentStream.id);

      const streamDoc = await streamDocRef.get();

      if (streamDoc.exists) {
        console.log("Stream already exists in db");
        stream = streamDoc.data() as StreamInfo;
      }
    }

    if (
      stream &&
      currentStream.game_id &&
      !stream?.games?.some((game) => game.id === currentStream.game_id)
    ) {
      const game = await getGameData(currentStream.game_id);
      if (game) {
        stream?.games?.push(game);
        const games = stream.games;
        if (streamDocRef) {
          await streamDocRef.set({ games }, { merge: true });
        }
      }
    }

    const video = await getVideoData();

    if (stream && video && stream.video?.id !== video.id) {
      // update VOD because sometimes when the stream starts its the last streams VOD
      if (streamDocRef) {
        console.log("New video id found!");
        await streamDocRef.set({ video }, { merge: true });
      }
    }

    return {
      id: currentStream.id,
      games: stream?.games || [],
      startedAt: currentStream.started_at,
      thumbnailURL: currentStream.thumbnail_url,
      title: currentStream.title,
      type: currentStream.type,
      userID: currentStream.user_id,
      userName: currentStream.user_name,
      video: video,
    };
  } catch (error) {
    console.error("Failed to get stream");
    if (error instanceof AxiosError) {
      errorHandler(error);
    }
  }
}

// Format video data from twitch api
async function getVideoData() {
  try {
    const { data } = await twitchApi.get<TwitchVideoResponse>(
      `videos?user_id=${process.env.USER_ID}`
    );

    const video = data.data.at(0);

    if (!video) return;

    return {
      id: video.id,
      userID: video.user_id,
      userName: video.user_name,
      title: video.title,
      createdAt: video.created_at,
      publishedAt: video.published_at,
      URL: video.url,
      thumbnailURL: video.thumbnail_url,
      type: video.type,
      duration: video.duration,
    };
  } catch (error) {
    console.error("Failed to get VOD");
    if (error instanceof AxiosError) {
      errorHandler(error);
    }
  }
}

async function getGameData(gameId: string) {
  try {
    const { data } = await twitchApi.get<TwitchGameResponse>(
      `games?id=${gameId}`
    );

    const game = data.data.at(0);

    if (!game) return;

    return {
      id: game.id,
      name: game.name,
      boxArtURL: game.box_art_url,
    };
  } catch (error) {
    console.error("Failed to get game");
    if (error instanceof AxiosError) {
      errorHandler(error);
    }
  }
}

async function endOfStream() {
  try {
    console.log("Stream over, final analysis");
    const localStreamDocRef = streamDocRef;
    const streamStartedAt = dayjs(stream?.startedAt);
    const streamUpTime = dayjs().diff(streamStartedAt, "minutes");
    clearGlobals();

    if (!localStreamDocRef) return;

    await localStreamDocRef.set(
      { type: "offline", streamUpTime },
      { merge: true }
    );

    let video = await getVideoData();

    while (
      !video ||
      !video.thumbnailURL ||
      video.thumbnailURL ===
        "https://vod-secure.twitch.tv/_404/404_processing_%{width}x%{height}.png"
    ) {
      // Sometimes the URL looks like this and is not good
      // https://vod-secure.twitch.tv/_404/404_processing_%{width}x%{height}.png
      await sleep(10000);
      video = await getVideoData();
    }

    await localStreamDocRef.set({ video }, { merge: true });
    console.log("Final analysis complete");
  } catch (error) {
    console.error("Failed to update stream:", error);
  }
}

async function analyzeData() {
  // Check if any new messages have been recorded
  if (newMessages.length <= 0) return;
  messages.push(...newMessages);
  const before = newMessages.length;

  // Batch write new messages to the database
  const batch = db.batch();
  newMessages.forEach((msg) => {
    if (streamDocRef) {
      const ref = streamDocRef.collection("messages").doc(msg.id);
      batch.set(ref, msg);
    }
  });
  await batch.commit();

  newMessages.splice(0, before);

  let jokeScoreTotal = 0;
  let jokeScoreMin = 0;
  let jokeScoreMax = 0;
  let jokeScoreHigh = 0;
  let jokeScoreLow = 0;

  const timeSeries = new Map<number, JokeData>();
  const streamStartedAt = dayjs(stream?.startedAt);
  const streamUpTime = dayjs().diff(streamStartedAt, "minutes");

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

    const messagePostedAt = dayjs(parseInt(message["tmi-sent-ts"]));
    const interval = messagePostedAt.diff(streamStartedAt, "minutes");
    const intervalData = timeSeries.get(interval);

    if (intervalData !== undefined) {
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

      intervalData.totalMinusTwo += message.joke ? 0 : -2;

      intervalData.totalPlusTwo += message.joke ? 2 : 0;

      intervalData.volume += 1;
    } else {
      timeSeries.set(interval, {
        jokeScore: jokeScoreTotal,
        high: jokeScoreTotal,
        low: jokeScoreTotal,
        open: jokeScoreTotal,
        close: jokeScoreTotal,
        totalMinusTwo: jokeScoreMin,
        totalPlusTwo: jokeScoreMax,
        volume: 1,
      });
    }
  });

  const data = Array.from(timeSeries).map(([key, value]) => {
    return {
      interval: key,
      ...value,
    };
  });

  try {
    if (!streamDocRef) return;
    await streamDocRef.set(
      {
        data,
        streamUpTime,
        jokeScoreTotal,
        jokeScoreMin,
        jokeScoreMax,
        jokeScoreHigh,
        jokeScoreLow,
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Failed to save condensed data:", error);
  }
}

update();
setInterval(update, TEN_SECONDS);
