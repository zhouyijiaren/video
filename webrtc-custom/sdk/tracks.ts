export type TrackKind = 'audio' | 'video';

type PlayOptions = {
  fit?: 'contain' | 'cover';
  muted?: boolean;
};

class DummyPipeTarget {
  pipe() {
    return this;
  }
}

export class MediaTrackWrapper {
  readonly kind: TrackKind;
  readonly track: MediaStreamTrack;
  private element?: HTMLMediaElement;
  processorDestination = new DummyPipeTarget();

  constructor(track: MediaStreamTrack) {
    this.track = track;
    this.kind = track.kind as TrackKind;
  }

  play(container: string | HTMLElement, opts: PlayOptions = {}) {
    const target =
      typeof container === 'string'
        ? document.getElementById(container)
        : container;
    if (!target) return;

    this.stop();
    const el =
      this.kind === 'video'
        ? document.createElement('video')
        : document.createElement('audio');
    el.autoplay = true;
    el.playsInline = true;
    if (this.kind === 'audio') {
      el.controls = false;
    }
    if (opts.muted || this.kind === 'audio') {
      el.muted = !!opts.muted || this.kind === 'audio';
    }
    el.srcObject = new MediaStream([this.track]);

    if (this.kind === 'video') {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.objectFit = opts.fit === 'contain' ? 'contain' : 'cover';
    }

    target.innerHTML = '';
    target.appendChild(el);
    this.element = el;
  }

  stop() {
    if (this.element) {
      this.element.srcObject = null;
      this.element.remove();
      this.element = undefined;
    }
  }

  close() {
    this.stop();
    try {
      this.track.stop();
    } catch (_) {}
  }

  setEnabled(enabled: boolean) {
    this.track.enabled = enabled;
  }

  async setPlaybackDevice(deviceId: string) {
    if (!this.element || typeof (this.element as any).setSinkId !== 'function') {
      return;
    }
    try {
      await (this.element as any).setSinkId(deviceId);
    } catch (err) {
      console.warn('[webrtc-sdk] failed to set sinkId', err);
    }
  }

  pipe(_processor: any) {
    return this;
  }
}
