import process from 'node:process'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import 'dotenv/config'

const serviceAccount = JSON.parse(process.env.GOOGLE_CREDS!)

const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: 'https://jerma-joke.firebaseio.com',
})

const db = getFirestore(app)

db.settings({ ignoreUndefinedProperties: true })

export { db }
