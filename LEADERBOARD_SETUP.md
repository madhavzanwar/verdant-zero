# Verdant Zero — Leaderboard Setup Guide

Verdant Zero supports both an offline-first high score cache and an optional global Firestore database.

## 1. Zero-Config Mode (Default)
By default, player scores, college rankings, and daily scores are persisted locally using `localStorage`. No external account, credit card, or network connection is required.

## 2. Global Firestore Leaderboard (Optional)
To enable multi-player campus leaderboards across devices:

1. Create a Firebase project at [https://console.firebase.google.com](https://console.firebase.google.com).
2. Enable Cloud Firestore in **Databases**.
3. Create a `.env` file in the project root:
   ```env
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_API_KEY=your-api-key
   ```
4. Set Firestore Security Rules to allow leaderboard reads and validated writes:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /leaderboard/{docId} {
         allow read: if true;
         allow create: if request.resource.data.score is int &&
                          request.resource.data.score >= 0 &&
                          request.resource.data.nickname is string &&
                          request.resource.data.nickname.size() <= 24;
         allow update, delete: if false;
       }
     }
   }
   ```
5. Run `npm run build` or `npm run dev`.
