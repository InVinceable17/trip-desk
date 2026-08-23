# Putting Trip Desk on the web

A one-time checklist. About twenty minutes, most of it waiting for Firebase.

The result: `https://<you>.github.io/trip-desk/` — bookmarkable, installable on a
phone home screen, works with no signal, and syncing across every device you sign
in on.

**What you give up by moving off the Claude artifact:** the live Google Flights
fare check. That runs through the Browserless connector, which only exists inside
Claude. The deep links (*open fares*, *open search*) still jump to the right
Google Flights page, and Claude can still scrape prices on request and hand you
JSON to paste in. Everything else is identical — same code, same data shape.

---

## 1 · Make the Firebase project

1. <https://console.firebase.google.com> → **Add project** → name it `trip-desk`.
   Turn Google Analytics **off**; it has nothing to measure here.
2. **Build → Firestore Database → Create database.** Pick a region near you
   (`nam5` is fine in the US). Start in **production mode** — the rules in step 3
   replace whatever it starts with.
3. **Build → Authentication → Get started → Google → Enable.** Set the support
   email to your own. Save.
4. **Project settings (gear) → Your apps → Web (`</>`)**. Nickname `trip-desk`,
   *don't* tick Firebase Hosting. Copy the `firebaseConfig` object it shows you.

## 2 · Wire the config in

Create `firebase.config.json` next to `package.json`, using the values from the
last step (see `firebase.config.example.json` for the shape):

```json
{
  "apiKey": "AIza...",
  "authDomain": "trip-desk-xxxxx.firebaseapp.com",
  "projectId": "trip-desk-xxxxx",
  "storageBucket": "trip-desk-xxxxx.firebasestorage.app",
  "messagingSenderId": "000000000000",
  "appId": "1:000000000000:web:abcdef"
}
```

**Commit this file.** It is not a secret — it names the project, it does not
authorise anything. Google publishes this config in their own quickstarts. What
keeps other people out is step 4.

## 3 · Get your UID

```
npm install
npm run build:web
npx serve docs        # or: python3 -m http.server -d docs 8080
```

Open it, click **Sign in with Google**. The trips won't load — that's correct, the
rules haven't been set yet. Now go to **Firebase console → Authentication → Users**
and copy the **User UID** of the account you just used.

## 4 · Set the rules — this is the actual lock

Open `firestore.rules`, replace `REPLACE_WITH_YOUR_UID` with your UID, and add a
second line for anyone you travel with (they need to sign in once first so their
UID exists).

Paste the whole file into **Firestore Database → Rules** and **Publish**.

Reload the app. Your trips load. Sign in with any other Google account and you
get nothing — that's the allowlist working, not a bug.

## 5 · Put it on GitHub Pages

```
git init && git add -A && git commit -m "Trip Desk"
git branch -M main
git remote add origin git@github.com:<you>/trip-desk.git
git push -u origin main
```

**Repo → Settings → Pages → Source: Deploy from a branch → `main` / `/docs`.**
Give it a minute, then load `https://<you>.github.io/trip-desk/`.

Last thing: **Firebase console → Authentication → Settings → Authorised domains
→ Add domain** → `<you>.github.io`. Sign-in fails without it.

## 6 · Bring your trips across

In the Claude artifact: **backups → Copy JSON**. On the hosted site:
**backups → Restore from JSON → paste → Replace everything with this**.

It writes straight to Firestore, so it's on your other devices by the time you
pick one up. Keep the artifact around read-only until you trust the new one.

---

## Day to day

```
npm run all      # build both targets and run every test
```

Then commit and push. Pages serves `docs/` directly — no CI, no build step on
GitHub, matching the "one file is better than five" habit in the root CLAUDE.md.

**Adding someone later:** they sign in once (they'll see nothing), you copy their
UID out of the console, add it to `members()` in `firestore.rules`, publish. No
redeploy needed.

**The service worker caches the app shell**, so a rebuild only reaches people
after they reload twice — once to fetch the new shell, once to run it. The cache
name is hashed from the built HTML, so an unchanged rebuild doesn't churn it.

**Costs:** nothing. Firestore's free tier is 50k reads and 20k writes a day; this
app does a handful of each per session.
