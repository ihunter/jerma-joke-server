import { twitchApi } from "../api";
import { errorHandler } from "../utils/axios-error-handling";

twitchApi
  .get("streams?user_id=23936415")
  .then((res) => {
    console.log("Passed");
  })
  .catch((err) => {
    console.error("Failed");
    errorHandler(err);
  });

setTimeout(() => {
  twitchApi
    .get("streams?user_id=23936415")
    .then((res) => {
      console.log("Passed");
    })
    .catch((err) => {
      console.error("Failed");
      errorHandler(err);
    });
}, 5000);
