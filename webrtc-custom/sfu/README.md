# WebRTC SFU (Mediasoup) - Local

This is a minimal, runnable SFU backend for multi-party WebRTC with screen sharing support. It provides signaling via Socket.IO and media forwarding via mediasoup.

## Start
```sh
cd video/webrtc-custom/sfu
npm i
npm start
```

Default port: `3001`
- Health check: `http://localhost:3001/health`

## Environment
- `PORT`: HTTP/WS port (default 3001)
- `ANNOUNCED_IP`: Set if running behind NAT or on a public server

When the browser runs inside Docker, `ANNOUNCED_IP` must be a host-reachable IP so the container can reach ICE candidates.
macOS example:
```sh
ANNOUNCED_IP=$(ipconfig getifaddr en0) npm start
```

## Signaling Events
All events are via Socket.IO.

### join
Client -> Server: `{ roomId, rtpCapabilities }`
Server -> Client: `joined` with `{ rtpCapabilities, existingProducers }`

### createWebRtcTransport
Client -> Server: `{ consumer: boolean }`
Server -> Client: `transportCreated` with transport parameters

### connectTransport
Client -> Server: `{ transportId, dtlsParameters }`
Server -> Client: `transportConnected`

### produce
Client -> Server: `{ transportId, kind, rtpParameters, appData }`
Server -> Client: `produced` with `{ producerId }`
Server -> Room: `newProducer` with `{ producerId, peerId, kind, appData }`

### consume
Client -> Server: `{ transportId, producerId, rtpCapabilities }`
Server -> Client: `consuming` with consumer parameters (paused)

### resume
Client -> Server: `{ consumerId }`
Server -> Client: `resumed`

### getProducers
Client -> Server: no payload
Server -> Client: `producers` with list of `{ producerId, peerId, kind, appData }`

### closeProducer
Client -> Server: `{ producerId }`

### producerClosed
Server -> Client: `{ producerId }` (when a producer ends)

## Screen Share
Treat screenshare as another producer with appData, for example:
```js
appData: { type: 'screenshare' }
```

## Notes
- This server is WebRTC-SFU only and does not handle authentication or room persistence.
- For production, add auth, HTTPS/WSS, TURN, and robust cleanup.

## Interface Test (No UI)
This script spins up multiple headless clients using mediasoup-client FakeHandler.
It validates the signaling flow and producer/consumer lifecycle without real RTP.

```sh
cd video/webrtc-custom/sfu
npm i
npm run test:interfaces
```

Options:
```sh
SFU_URL=http://localhost:3001 SFU_ROOM=demo SFU_CLIENTS=2 npm run test:interfaces
```

## Docker UI Test (Real RTP)
This uses headless Chromium (Puppeteer) to open two demo clients and verify remote video frames.

Option A - All-in-Docker (recommended):
```sh
cd video/webrtc-custom/sfu/docker-test-puppeteer
docker compose up --build --abort-on-container-exit
```

Option B - Host services + Docker tester:
1) Run SFU server on host: `npm start`
2) Run client static server on host: `cd ../client && python3 -m http.server 8080`

Build & run tester (Docker, non-docker.io base image):
```sh
cd video/webrtc-custom/sfu/docker-test-puppeteer
docker build -t sfu-puppeteer-test .
docker run --rm --add-host=host.docker.internal:host-gateway sfu-puppeteer-test
```

If media is not flowing between host and Docker, try forcing TCP on the SFU:
```sh
MEDIASOUP_FORCE_TCP=1 npm start
```
