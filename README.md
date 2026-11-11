# Vyro Calls – real-time calling app (MERN + WebRTC)

User login → contacts → voice/video calls in real time.

- **MongoDB + Express**: users, JWT auth, contacts
- **React (Vite)**: pages and components, each with its own `.jsx` + `.css`
- **Socket.IO**: presence (who is online), call signalling, ring timeout and call history events
- **WebRTC**: the actual audio/video, peer to peer

## Run it

You need Node 18+ and a MongoDB instance (local or Atlas).

```bash
# 1. backend
cd server
cp .env.example .env        # set MONGO_URI and a long random JWT_SECRET
npm install
npm run dev                 # http://localhost:5000

# 2. frontend (new terminal)
cd client
npm install
npm run dev                 # http://localhost:5173
```

## Features

- **Voice and video calls** (1:1 and group) with mute / camera toggle
- **Ringing sounds**: the person being called hears a ringtone, the caller hears a ringback tone (synthesised in the browser, no audio files)
- **Ring timeout**: unanswered calls stop ringing after 30 s (`RING_TIMEOUT_MS`) and count as missed
- **Call history (Recents tab)**: incoming / outgoing / missed / declined, duration, one-tap call back, and a red badge for unseen missed calls (also shown in the tab title)
- **Search contacts by name**
- **Call recording** (1:1 calls only): record button on the call screen; the file is saved to your device when you stop or the call ends
- **Background alerts**: desktop notification and a flashing tab title for incoming and missed calls when the tab is not in view
- **Email OTP verification (Brevo)**: creating an account sends a 6-digit code to the user's email; the account only becomes active once the code is entered. Forgot password works the same way: a 6-digit code is emailed and must be verified before the new password is saved. Codes expire after 10 minutes, are single-use, allow 5 wrong tries, and can be resent every 30 s.
- **Contact requests**: search people by name (or exact email) and send a request. Only after they accept can the two of you call each other. Pending, sent and blocked people are managed on the **Requests** tab.
- **Block**: block a contact (or a requester) from the Contacts / Requests tab. Blocking removes the contact and any pending request, and the blocked person can no longer call you, invite you to group calls or send you requests. Unblock from Requests → Blocked (they must send a new request).
- **Calling offline contacts**: the call button works even when the contact is offline. They are emailed straight away and the call keeps ringing for `OFFLINE_RING_TIMEOUT_MS` (60 s). If they open the app and sign in during that window, the call rings on their screen; otherwise it ends as a missed call.
- **Group voice and video calls**: pick 2–5 contacts → everyone gets an invitation (online: ring; offline: email). People can join, decline or leave at any time; the call ends when the last person leaves. Up to 6 participants (`GROUP_MAX_PARTICIPANTS`).
- **Missed-call email**: whenever a call is missed (no answer, caller hung up before pickup, callee busy, or never joined a group call) the callee gets an email, in addition to the "is calling you" email.
- **"X is calling you" email**: the moment someone calls, the callee gets an email ("please pick up the call") whether they are online or offline. At most one such email per caller → callee pair per minute (`CALL_EMAIL_COOLDOWN_MS`).

## Try a call

1. Open `http://localhost:5173` in two different browsers (or one normal + one incognito window).
2. Register two users, e.g. Alice and Bob.
3. In Alice's window, add Bob using his registered email. Bob shows a green dot when he is online.
4. Press the phone (voice) or camera (video) button. Bob gets an incoming call and can accept or decline.

## Upgrading from the previous version

Contacts used to be one-way. Calls now need a mutual, accepted contact. Run this once against your database to turn every old one-way contact into a pending request the other person can accept:

```bash
cd server && node scripts/migrate-contacts.js
```

## Trying the new features

- **Requests**: register Alice and Bob → in Alice's window search "Bob" on the Contacts tab and press *Send request* → Bob sees a badge on the **Requests** tab (live) and accepts → both now see each other in Contacts.
- **Offline call**: log Bob out (or close his tab), call him from Alice. Alice sees "Calling… they are offline, we emailed them"; Bob gets the email. Log Bob in within a minute and the call rings.
- **Group call**: with 2+ accepted contacts, press *New group call* on the Contacts tab.
- **Block**: press the block icon next to a contact, then try calling from the other side.

- **Ringing**: click anywhere on the page once after loading it (browsers keep audio muted until you do), then call from the other window. Both sides should ring.
- **Missed calls**: call and let it ring out, hang up before they answer, or call while they're offline. Check the Recents tab. To test the timeout quickly, set `RING_TIMEOUT_MS=5000`.
- **Background alerts**: click **Turn on** in the notification banner, switch to another tab or window, then call yourself from the other browser.
- **Recording**: press the red record button once the call says connected. The other person sees "X is recording this call". Press it again (or hang up) and a `call-with-<name>-<date>.webm` file downloads.
- **Emails / OTP**: with `BREVO_API_KEY` unset, every email (including the 6-digit codes) is printed in the server console. To send real email, see *Brevo setup* below.
- **Call email**: call someone from the other browser, even while they are logged out, and check their inbox.

## Brevo setup (email)

1. Create a free account at https://www.brevo.com.
2. **SMTP & API → API keys** → generate a key → put it in `server/.env` as `BREVO_API_KEY`.
3. **Senders, Domains & IP → Senders** → add and verify the address you want mail to come from → set it as `BREVO_SENDER_EMAIL` (and `BREVO_SENDER_NAME=Vyro Calls`). Brevo rejects mail from unverified senders.
4. Restart the server. In production also set `NODE_ENV=production` and `CLIENT_ORIGIN` to your site URL (it is the link inside the call email).

The free plan has a daily sending limit, and every call attempt can send an email, so watch your quota.

## Project structure

```
server/
  index.js            Express + Socket.IO bootstrap
  socket.js           JWT-authenticated socket, presence, 1:1 call signalling,
                      offline ringing, ring timeout, call-history records
  groups.js           group-call rooms: invites, join/leave, WebRTC signalling relay
  presence.js         tracks online users
  models/             User (incl. blocked list), Contact, ContactRequest, Call, Otp
  routes/             auth.js (OTP sign-up / reset), contacts.js (search, requests, block), calls.js
  services/mailer.js  Brevo API: OTP emails and the "is calling you" email
  services/relations.js  may A call B? (mutual contacts, no block either way)
  services/callLog.js    saves call history + sends the missed-call email
  services/otp.js     issue / verify 6-digit codes (hashed, expiring, attempt-limited)
  models/Otp.js       one active code per email + purpose
  middleware/auth.js  JWT sign / verify
client/src/
  context/            AuthContext, SocketContext
  hooks/useCall.js    1:1 WebRTC call lifecycle (offer/answer/ICE, mute, camera, sounds, alerts)
  hooks/useGroupCall.js  group calls (mesh WebRTC, one connection per participant)
  hooks/useRecorder.js  in-browser call recording
  hooks/usePageActive.js  is the person looking at the app?
  utils/ringer.js     ringtone / ringback (Web Audio)
  utils/alerts.js     desktop notifications, tab-title flashing and badge
  services/api.js     axios instance with token
  pages/              Login, Register, VerifyEmail, ForgotPassword (code + new password), Dashboard  (+ .css)
  components/         Brand (logo), OtpInput, RequestsPanel, NewGroupCall, GroupCallScreen, ContactList, CallHistory, AddContact, IncomingCall, CallScreen,
                      NotifyBanner, Icons (+ .css)
```

## How a call works

1. Caller grabs mic/camera, creates a WebRTC offer, sends `call:invite` over Socket.IO.
2. Server checks the callee is online and not busy, then forwards `call:incoming`.
   The server starts a ring timer. If nobody answers in time it sends `call:timeout` to both sides and logs a missed call.
3. Callee accepts, creates an answer, sends `call:answer`.
4. Both sides exchange ICE candidates (`call:ice`) until the peer connection is up.
5. Audio/video then flows directly between the two browsers. Socket.IO is only used for setup and hang-up.

## Things to know before going further

- **HTTPS**: browsers only allow mic/camera on `localhost` or HTTPS. To test across two devices or deploy, serve both over HTTPS.
- **TURN server**: the app uses free Google STUN servers, which work for most home networks. Users on mobile data or strict corporate networks usually need a TURN relay (e.g. coturn). Set `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` in `client/.env`.
- **Scale**: online status is held in server memory, so this works for one server instance. For several instances, add the Socket.IO Redis adapter and move presence to Redis.
- **Group calls are a mesh**: every participant sends their video to every other participant, so bandwidth and CPU grow quickly. 4–6 people is a realistic limit; for bigger or more reliable calls use an SFU (e.g. LiveKit, mediasoup). A TURN server matters even more for groups. Group calls cannot be recorded.
- **Offline calling is "ring if they show up"**: the app can't ring a closed browser. The email tells the callee to open the app, and the call waits `OFFLINE_RING_TIMEOUT_MS` for them. Real background ringing would need Web Push / a native app.
- Contacts are mutual: they only exist after the other person accepts a request.
- **Autoplay rules**: a browser only plays the ringtone after the person has clicked, tapped or pressed a key on the page at least once. A freshly reloaded tab that nobody has touched will ring silently (the on-screen call card and notification still appear).
- **Notifications** use the desktop Notification API (Chrome, Edge, Firefox, Safari on desktop). Mobile Chrome only allows notifications from a service worker, so there you get the in-page ring and title badge only. Alerts need the tab to be open: a closed browser can't be notified without Web Push, which this app doesn't use.
- **Recording** happens in the browser and is saved to the recorder's own device; nothing is uploaded. Both voices are mixed into one track. For video calls the other person's video is recorded, not your own camera. The other person is shown a banner while you record, but laws on recording calls vary by country and region, so make sure your users get any consent they need. Output is `.webm` (Chrome, Edge, Firefox) or `.mp4` (Safari).
- **Emails and quota**: one call can cause up to two emails (calling + missed). Both are limited to one per caller → callee pair per `CALL_EMAIL_COOLDOWN_MS`, but watch your Brevo daily limit.
- **Search privacy**: search matches names (contains) or an exact email, needs 2+ characters, is rate limited, and never shows people who blocked you. If you want people to be findable only by exact email, change the `$or` in `routes/contacts.js`.
- **OTP security**: only an HMAC of each code is stored; codes are single-use, expire in 10 minutes and lock after 5 wrong attempts. Requests are rate limited (20 per 15 minutes per IP). If the server sits behind a reverse proxy, add `app.set('trust proxy', 1)` in `server/index.js` so the limiter sees real client IPs. Accounts that existed before OTP was added can still sign in. Resetting a password does **not** sign out existing sessions: login tokens are stateless and stay valid for their 7 days.

## Production build

```bash
cd client && npm run build   # outputs client/dist
```

Serve `client/dist` from any static host / reverse proxy and point `VITE_API_URL` and `VITE_SERVER_URL` at your server before building.
