'use strict';

const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const shareBtn = document.getElementById('shareBtn');
const roomIdInput = document.getElementById('roomId');
const serverUrlInput = document.getElementById('serverUrl');
const localContainer = document.getElementById('localContainer');
const remoteContainer = document.getElementById('remoteContainer');

let socket;
let device;
let sendTransport;
let recvTransport;
let localStream;
let audioProducer;
let videoProducer;
let screenProducer;
let consumers = new Map();
let joined = false;

async function loadMediasoupClient() {
  if (window.mediasoupClient) return window.mediasoupClient;
  if (typeof mediasoupClient !== 'undefined') {
    window.mediasoupClient = mediasoupClient;
    return window.mediasoupClient;
  }

  const url = './vendor/mediasoup-client.min.js';
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });

  if (window.mediasoupClient) return window.mediasoupClient;
  if (typeof mediasoupClient !== 'undefined') {
    window.mediasoupClient = mediasoupClient;
    return window.mediasoupClient;
  }
  throw new Error('mediasoup-client failed to load from local vendor file');
}

function setUiJoined(state) {
  joined = state;
  joinBtn.disabled = state;
  leaveBtn.disabled = !state;
  toggleMicBtn.disabled = !state;
  toggleCamBtn.disabled = !state;
  shareBtn.disabled = !state;
}

function createTile(id, label, element) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = id;

  const name = document.createElement('div');
  name.className = 'tile-label';
  name.textContent = label;

  tile.appendChild(element);
  tile.appendChild(name);
  return tile;
}

function addLocalTrack(track, label) {
  const el = document.createElement(track.kind === 'video' ? 'video' : 'audio');
  el.autoplay = true;
  el.muted = true;
  el.playsInline = true;
  const ms = new MediaStream([track]);
  el.srcObject = ms;

  const tileId = `local-${track.kind}`;
  const existing = document.getElementById(tileId);
  if (existing) existing.remove();

  localContainer.appendChild(createTile(tileId, label, el));
}

function addRemoteConsumer(consumer, peerId) {
  const {track} = consumer;
  const el = document.createElement(track.kind === 'video' ? 'video' : 'audio');
  el.autoplay = true;
  el.playsInline = true;
  const ms = new MediaStream([track]);
  el.srcObject = ms;

  const tileId = `remote-${consumer.id}`;
  const label = `${peerId} (${track.kind})`;
  remoteContainer.appendChild(createTile(tileId, label, el));
}

function removeRemoteConsumer(consumerId) {
  const tile = document.getElementById(`remote-${consumerId}`);
  if (tile) tile.remove();
}

function request(eventName, payload, responseEvent, matchFn) {
  return new Promise(resolve => {
    const handler = data => {
      if (matchFn && !matchFn(data)) return;
      socket.off(responseEvent, handler);
      resolve(data);
    };
    socket.on(responseEvent, handler);
    socket.emit(eventName, payload);
  });
}

async function createTransport(consumer) {
  const data = await request(
    'createWebRtcTransport',
    {consumer},
    'transportCreated',
    resp => resp.consumer === !!consumer,
  );

  const transport = consumer
    ? device.createRecvTransport(data)
    : device.createSendTransport(data);

  transport.on('connect', ({dtlsParameters}, callback, errback) => {
    request(
      'connectTransport',
      {transportId: transport.id, dtlsParameters},
      'transportConnected',
      resp => resp.transportId === transport.id,
    )
      .then(() => callback())
      .catch(errback);
  });

  if (!consumer) {
    transport.on('produce', async ({kind, rtpParameters, appData}, callback, errback) => {
      try {
        const data = await request(
          'produce',
          {transportId: transport.id, kind, rtpParameters, appData},
          'produced',
        );
        callback({id: data.producerId});
      } catch (err) {
        errback(err);
      }
    });
  }

  return transport;
}

async function consumeProducer(producerId, peerId) {
  const data = await request(
    'consume',
    {
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    },
    'consuming',
    resp => resp.producerId === producerId,
  );

  const consumer = await recvTransport.consume({
    id: data.id,
    producerId: data.producerId,
    kind: data.kind,
    rtpParameters: data.rtpParameters,
  });

  consumers.set(consumer.id, consumer);
  addRemoteConsumer(consumer, peerId);

  await request('resume', {consumerId: consumer.id}, 'resumed', resp => resp.consumerId === consumer.id);
}

async function joinRoom() {
  if (joined) return;

  const roomId = roomIdInput.value.trim();
  const serverUrl = serverUrlInput.value.trim();
  if (!roomId || !serverUrl) return;

  socket = io(serverUrl, {transports: ['websocket']});

  const joinedData = await request('join', {roomId}, 'joined');

  const msClient = await loadMediasoupClient();
  device = new msClient.Device();
  await device.load({routerRtpCapabilities: joinedData.rtpCapabilities});
  socket.emit('setRtpCapabilities', {rtpCapabilities: device.rtpCapabilities});

  sendTransport = await createTransport(false);
  recvTransport = await createTransport(true);

  socket.on('newProducer', async ({producerId, peerId}) => {
    await consumeProducer(producerId, peerId);
  });

  socket.on('producerClosed', ({producerId}) => {
    for (const [id, consumer] of consumers) {
      if (consumer.producerId === producerId) {
        consumer.close();
        consumers.delete(id);
        removeRemoteConsumer(id);
      }
    }
  });

  for (const producer of joinedData.existingProducers) {
    await consumeProducer(producer.producerId, producer.peerId);
  }

  localStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  audioProducer = await sendTransport.produce({track: audioTrack, appData: {type: 'audio'}});
  videoProducer = await sendTransport.produce({track: videoTrack, appData: {type: 'video'}});

  addLocalTrack(audioTrack, 'Local Audio');
  addLocalTrack(videoTrack, 'Local Video');

  setUiJoined(true);
}

async function leaveRoom() {
  if (!joined) return;

  try {
    if (audioProducer) audioProducer.close();
    if (videoProducer) videoProducer.close();
    if (screenProducer) screenProducer.close();

    if (sendTransport) sendTransport.close();
    if (recvTransport) recvTransport.close();

    for (const consumer of consumers.values()) {
      consumer.close();
    }
    consumers.clear();

    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
    }

    if (socket) socket.disconnect();
  } finally {
    localContainer.innerHTML = '';
    remoteContainer.innerHTML = '';
    setUiJoined(false);
  }
}

function toggleMic() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleMicBtn.textContent = track.enabled ? 'Mute Mic' : 'Unmute Mic';
}

function toggleCam() {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleCamBtn.textContent = track.enabled ? 'Stop Cam' : 'Start Cam';
}

async function toggleScreenShare() {
  if (!sendTransport) return;

  if (screenProducer) {
    screenProducer.close();
    screenProducer = null;
    shareBtn.textContent = 'Share Screen';
    return;
  }

  const screenStream = await navigator.mediaDevices.getDisplayMedia({video: true});
  const screenTrack = screenStream.getVideoTracks()[0];
  screenProducer = await sendTransport.produce({
    track: screenTrack,
    appData: {type: 'screenshare'},
  });

  screenTrack.onended = () => {
    if (screenProducer) {
      screenProducer.close();
      screenProducer = null;
      shareBtn.textContent = 'Share Screen';
    }
  };

  shareBtn.textContent = 'Stop Share';
}

joinBtn.addEventListener('click', joinRoom);
leaveBtn.addEventListener('click', leaveRoom);
toggleMicBtn.addEventListener('click', toggleMic);
toggleCamBtn.addEventListener('click', toggleCam);
shareBtn.addEventListener('click', toggleScreenShare);

setUiJoined(false);
