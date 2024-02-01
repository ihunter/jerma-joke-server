require("dotenv").config();

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = JSON.parse(process.env.GOOGLE_CREDS);

const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://jerma-joke.firebaseio.com",
});

const db = getFirestore(app);

module.exports = {
  db: db,
};
