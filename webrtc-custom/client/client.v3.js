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

function getVideoStats(container) {
  const videos = container.querySelectorAll('video');
  let live = 0;
  videos.forEach(v => {
    if (v.readyState >= 2 && v.videoWidth > 0) {
      live += 1;
    }
  });
  return {count: videos.length, live};
}

window.__demoState = {joined: false};
window.__demoStats = () => {
  const local = getVideoStats(localContainer);
  const remote = getVideoStats(remoteContainer);
  return {
    joined: joined,
    localVideo: local,
    remoteVideo: remote,
    consumers: consumers.size,
  };
};
window.__demoJoin = () => joinRoom();
window.__demoStatsDetailed = async () => {
  let sendBytes = 0;
  let recvBytes = 0;
  if (sendTransport && sendTransport._handler && sendTransport._handler._pc) {
    const stats = await sendTransport._handler._pc.getStats();
    stats.forEach(report => {
      if (report.type === 'outbound-rtp' && typeof report.bytesSent === 'number') {
        sendBytes += report.bytesSent;
      }
    });
  }
  if (recvTransport && recvTransport._handler && recvTransport._handler._pc) {
    const stats = await recvTransport._handler._pc.getStats();
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && typeof report.bytesReceived === 'number') {
        recvBytes += report.bytesReceived;
      }
    });
  }
  return {sendBytes, recvBytes};
};

function createFakeMediaStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let hue = 0;
  setInterval(() => {
    hue = (hue + 5) % 360;
    ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.fillText(`Fake ${hue}`, 20, 40);
  }, 200);

  const videoStream = canvas.captureStream(10);

  let audioTrack;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const dest = audioCtx.createMediaStreamDestination();
    osc.frequency.value = 440;
    osc.connect(dest);
    osc.start();
    audioTrack = dest.stream.getAudioTracks()[0];
    audioCtx.resume().catch(() => {});
  } catch (_) {
    audioTrack = null;
  }

  const stream = new MediaStream();
  if (videoStream.getVideoTracks()[0]) {
    stream.addTrack(videoStream.getVideoTracks()[0]);
  }
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }
  return stream;
}

async function loadMediasoupClient() {
  if (window.mediasoupClient) return window.mediasoupClient;
  if (typeof mediasoupClient !== 'undefined') {
    window.mediasoupClient = mediasoupClient;
    return window.mediasoupClient;
  }

  const url = new URL('./vendor/mediasoup-client.min.js', window.location.href).toString();
  console.log('[demo] loading mediasoup-client from', url);
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
  // Fallback: fetch and eval (last resort).
  console.warn('[demo] mediasoup-client script loaded but global missing, trying eval fallback');
  const resp = await fetch(url, {cache: 'no-store'});
  if (resp.ok) {
    const code = await resp.text();
    // eslint-disable-next-line no-eval
    eval(code);
    if (window.mediasoupClient) return window.mediasoupClient;
  }

  throw new Error('mediasoup-client failed to load from local vendor file');
}

function setUiJoined(state) {
  joined = state;
  window.__demoState.joined = state;
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
  el.muted = false;
  if (track.kind === 'audio') {
    el.controls = true;
  }
  el.onloadedmetadata = () => {
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        console.warn('[demo] autoplay blocked for remote track', track.kind);
      });
    }
  };
  track.onmute = () => console.log('[demo] remote track muted', track.kind, peerId);
  track.onunmute = () => console.log('[demo] remote track unmuted', track.kind, peerId);
  track.onended = () => console.log('[demo] remote track ended', track.kind, peerId);
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

  transport.on('connectionstatechange', state => {
    console.log(`[demo] ${consumer ? 'recv' : 'send'} transport state`, state);
  });

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

  console.log(
    '[demo] consuming',
    consumer.id,
    consumer.kind,
    peerId,
    consumer.track.readyState,
  );
  consumers.set(consumer.id, consumer);
  addRemoteConsumer(consumer, peerId);

  await request('resume', {consumerId: consumer.id}, 'resumed', resp => resp.consumerId === consumer.id);
}

async function joinRoom() {
  if (joined) return;
  try {
    const roomId = roomIdInput.value.trim();
    const serverUrl = serverUrlInput.value.trim();
    if (!roomId || !serverUrl) return;

    const urlParams = new URLSearchParams(window.location.search);
    if (typeof io === 'undefined') {
      throw new Error('socket.io client not loaded');
    }

    let socketOptions = {transports: ['websocket']};
    const transportParam = urlParams.get('transport') || urlParams.get('transports');
    if (transportParam) {
      if (transportParam === 'auto') {
        socketOptions = {};
      } else {
        const list = transportParam
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
        if (list.length) {
          socketOptions = {transports: list};
        }
      }
    }

    socket = io(serverUrl, socketOptions);

    const joinedData = await request('join', {roomId}, 'joined');

    const msClient = await loadMediasoupClient();
    device = new msClient.Device();
    await device.load({routerRtpCapabilities: joinedData.rtpCapabilities});
    socket.emit('setRtpCapabilities', {rtpCapabilities: device.rtpCapabilities});

    sendTransport = await createTransport(false);
    recvTransport = await createTransport(true);

    socket.on('newProducer', async ({producerId, peerId}) => {
      console.log('[demo] newProducer', producerId, peerId);
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

    socket.on('producerPaused', ({producerId}) => {
      console.warn('[demo] producer paused', producerId);
    });

    socket.on('producerResumed', ({producerId}) => {
      console.warn('[demo] producer resumed', producerId);
    });

    for (const producer of joinedData.existingProducers) {
      console.log('[demo] existingProducer', producer.producerId, producer.peerId);
      await consumeProducer(producer.producerId, producer.peerId);
    }

    if (urlParams.get('fake') === 'canvas') {
      localStream = createFakeMediaStream();
    } else {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
      } catch (err) {
        console.warn('[demo] getUserMedia failed, falling back to fake stream', err);
        localStream = createFakeMediaStream();
      }
    }

    const tracks = localStream.getTracks();
    tracks.forEach(t => {
      t.onmute = () => console.log('[demo] local track muted', t.kind);
      t.onunmute = () => console.log('[demo] local track unmuted', t.kind);
      t.onended = () => console.log('[demo] local track ended', t.kind);
    });
    console.log('[demo] local tracks', JSON.stringify(tracks.map(t => ({
      kind: t.kind,
      readyState: t.readyState,
      muted: t.muted,
      enabled: t.enabled,
    }))));
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];

    if (audioTrack) {
      audioTrack.enabled = true;
    }
    if (videoTrack) {
      videoTrack.enabled = true;
      videoTrack.contentHint = 'motion';
    }

    audioProducer = await sendTransport.produce({track: audioTrack, appData: {type: 'audio'}});
    videoProducer = await sendTransport.produce({track: videoTrack, appData: {type: 'video'}});
    console.log('[demo] produced', {
      audio: audioProducer?.id,
      video: videoProducer?.id,
    });

    setInterval(() => {
      if (sendTransport) {
        console.log('[demo] send transport state snapshot', sendTransport.connectionState);
      }
      if (recvTransport) {
        console.log('[demo] recv transport state snapshot', recvTransport.connectionState);
      }
    }, 5000);

    addLocalTrack(audioTrack, 'Local Audio');
    addLocalTrack(videoTrack, 'Local Video');

    setUiJoined(true);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error('[demo] join failed', message);
    if (err && err.stack) {
      console.error('[demo] join failed stack', err.stack);
    }
    throw err;
  }
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

// Optional auto-join via URL params: ?server=...&room=...&autojoin=1
const params = new URLSearchParams(window.location.search);
if (params.get('server')) {
  serverUrlInput.value = params.get('server');
}
if (params.get('room')) {
  roomIdInput.value = params.get('room');
}
if (params.get('autojoin') === '1') {
  setTimeout(() => {
    joinRoom().catch(err => console.error('[demo] autojoin failed', err));
  }, 500);
}
