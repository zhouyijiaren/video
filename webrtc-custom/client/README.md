# WebRTC SFU Client Demo

A minimal browser client for the local SFU server.

## Run
Use any static server. Example:
```sh
cd video/webrtc-custom/client
python3 -m http.server 8080
```
Then open:
```
http://localhost:8080
```

Make sure the SFU server is running on `http://localhost:3001`.

## Notes
- This demo uses CDN builds of `socket.io-client` and `mediasoup-client`.
- Screen share is sent as a video producer with `appData.type = 'screenshare'`.
