require("dotenv").config();
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import https from "https";
import rateLimit from "axios-rate-limit";
import { errorHandler } from "../utils/axios-error-handling";

interface RetryConfig extends AxiosRequestConfig {
  _retry: boolean;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

const twitchApi = rateLimit(
  axios.create({
    baseURL: process.env.TWITCH_API_URL,
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
    },
    timeout: 60000,
    httpsAgent: new https.Agent({ keepAlive: true }),
  }),
  { maxRPS: 12 }
);

// Add a response interceptor
twitchApi.interceptors.response.use(
  (response) => {
    // Any status code within the range of 2xx cause this function to trigger
    // Do something with response data

    // Set api ratelimit based on response header "ratelimit-remaining"
    const ratelimitRemaining: string = response.headers["ratelimit-remaining"];
    const maxRPS: number = Math.floor(parseInt(ratelimitRemaining) / 60) - 1;
    twitchApi.setMaxRPS(maxRPS);

    return response;
  },
  async (error: AxiosError) => {
    // Any status codes that falls outside the range of 2xx cause this function to trigger
    // Do something with response error
    const { config, response } = error;

    if (!config || !response) return;

    const originalRequest: RetryConfig = { _retry: false, ...config };

    if (response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const token = await getAuthToken();
        twitchApi.defaults.headers.common.Authorization = `Bearer ${token}`;
      } catch (error) {
        console.log("Error getting token:", error);
      }

      return twitchApi(originalRequest);
    }

    return Promise.reject(error);
  }
);

async function getAuthToken() {
  try {
    const { data } = await axios.post<TokenResponse>(
      `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    );
    return data.access_token;
  } catch (error) {
    if (error instanceof AxiosError) {
      errorHandler(error);
    }
  }
}

export { twitchApi };
