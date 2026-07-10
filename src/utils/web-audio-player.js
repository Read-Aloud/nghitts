let sharedAudioContext = null;

const getAudioContextConstructor = () => window.AudioContext || window.webkitAudioContext;

export const isWebAudioSupported = () => Boolean(getAudioContextConstructor());

export const getSharedAudioContext = async () => {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextConstructor();
  }

  if (sharedAudioContext.state === "suspended") {
    await sharedAudioContext.resume();
  }

  return sharedAudioContext;
};

export class WebAudioPlayer {
  constructor(audioBlob) {
    this.audioBlob = audioBlob;
    this.audioBuffer = null;
    this.decodePromise = null;
    this.source = null;
    this.gainNode = null;
    this.startedAt = 0;
    this.offset = 0;
    this.isPlaying = false;
    this.playToken = 0;
  }

  get ended() {
    return Boolean(this.audioBuffer) && !this.isPlaying && this.offset >= this.audioBuffer.duration;
  }

  async load() {
    if (this.audioBuffer) return this.audioBuffer;

    if (!this.decodePromise) {
      this.decodePromise = (async () => {
        const context = await getSharedAudioContext();
        const buffer = await this.audioBlob.arrayBuffer();
        this.audioBuffer = await context.decodeAudioData(buffer);
        return this.audioBuffer;
      })();
    }

    return this.decodePromise;
  }

  async play({ restart = false, volume = 1, onStart, onEnd, onError } = {}) {
    const token = ++this.playToken;

    try {
      const context = await getSharedAudioContext();
      const audioBuffer = await this.load();
      if (token !== this.playToken) return;

      this.stopSource();

      if (restart || this.offset >= audioBuffer.duration) {
        this.offset = 0;
      }

      const source = context.createBufferSource();
      const gainNode = context.createGain();
      source.buffer = audioBuffer;
      gainNode.gain.value = volume;
      source.connect(gainNode);
      gainNode.connect(context.destination);
      source.onended = () => {
        if (this.source !== source) return;
        this.source = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.offset = audioBuffer.duration;
        source.disconnect();
        gainNode.disconnect();
        onEnd?.();
      };

      this.source = source;
      this.gainNode = gainNode;
      this.startedAt = context.currentTime - this.offset;
      this.isPlaying = true;
      source.start(0, this.offset);
      onStart?.();
    } catch (err) {
      this.isPlaying = false;
      onError?.(err);
    }
  }

  async pause({ onPause } = {}) {
    this.playToken++;
    if (!this.isPlaying) return;

    const context = await getSharedAudioContext();
    const duration = this.audioBuffer?.duration ?? 0;
    this.offset = duration
      ? Math.min(context.currentTime - this.startedAt, duration)
      : 0;
    this.stopSource();
    this.isPlaying = false;
    onPause?.();
  }

  stop({ reset = false } = {}) {
    this.playToken++;
    this.stopSource();
    this.isPlaying = false;
    if (reset) {
      this.offset = 0;
    }
  }

  stopSource() {
    if (!this.source) return;

    const source = this.source;
    this.source = null;
    source.onended = null;
    source.disconnect();
    this.gainNode?.disconnect();
    this.gainNode = null;
    try {
      source.stop();
    } catch {
      // Source may already have stopped naturally.
    }
  }
}

export const playBlobWithWebAudio = async (audioBlob, options = {}) => {
  const player = new WebAudioPlayer(audioBlob);
  await player.play(options);
  return player;
};
