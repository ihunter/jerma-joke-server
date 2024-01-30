export type Stream = {
  data: DataPoint[];
  games: GameInfo[];
  id: string;
  jokeScoreHigh: number;
  jokeScoreLow: number;
  jokeScoreMax: number;
  jokeScoreMin: number;
  jokeScoreTotal: number;
  startedAt: string;
  streamUpTime: number;
  thumbnailURL: string;
  title: string;
  type: string;
  userID: string;
  userName: string;
  video: VideoInfo;
};

export type StreamInfo = {
  id: string;
  games: GameInfo[];
  startedAt: string;
  thumbnailURL: string;
  title: string;
  type: string;
  userID: string;
  userName: string;
  video?: VideoInfo;
};

export type DataPoint = {
  close: number;
  high: number;
  interval: number;
  jokeScore: number;
  low: number;
  open: number;
  totalMinusTwo: number;
  totalPlusTwo: number;
  volume: number;
};

export type GameInfo = {
  boxArtURL: string;
  id: string;
  name: string;
};

export type VideoInfo = {
  URL: string;
  createdAt: string;
  duration: string;
  id: string;
  publishedAt: string;
  thumbnailURL: string;
  title: string;
  type: string;
  userID: string;
  userName: string;
};

export type Message = {
  "badge-info"?: {
    [key: string]: string;
  };
  "badge-info-raw"?: string;
  badges?: {
    [key: string]: string;
  };
  "badges-raw"?: string;
  color: string;
  "display-name": string;
  emotes?: {
    [key: string]: string[];
  };
  "emotes-raw"?: string;
  flags?: string;
  id: string;
  joke: boolean;
  "message-type": string;
  mod: boolean;
  msg: string;
  "room-id": string;
  subscriber: boolean;
  "tmi-sent-ts": string;
  turbo: boolean;
  "user-id": string;
  "user-type"?: string;
  username: string;
};

export type JokeData = {
  jokeScore: number;
  high: number;
  low: number;
  open: number;
  close: number;
  totalMinusTwo: number;
  totalPlusTwo: number;
  volume: number;
};

export interface TwitchStreamResponse {
  data: TwitchStreamInfo[];
  pagination: Pagination;
}

export interface TwitchStreamInfo {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tag_ids: any[];
  tags: string[];
  is_mature: boolean;
}

export interface TwitchGameResponse {
  data: TwitchGameInfo[];
  pagination: Pagination;
}

export interface TwitchGameInfo {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id: string;
}

export interface TwitchVideoResponse {
  data: TwitchVideoInfo[];
  pagination: Pagination;
}

export interface TwitchVideoInfo {
  id: string;
  stream_id: any;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  description: string;
  created_at: string;
  published_at: string;
  url: string;
  thumbnail_url: string;
  viewable: string;
  view_count: number;
  language: string;
  type: string;
  duration: string;
  muted_segments: MutedSegment[] | null;
}

export interface MutedSegment {
  duration: number;
  offset: number;
}

export interface Pagination {
  cursor: string;
}
