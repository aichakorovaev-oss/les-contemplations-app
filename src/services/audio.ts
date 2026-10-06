export class GalleryAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  toneGain: GainNode | null = null;
  stepGain: GainNode | null = null;
  lastStep = 0;
  volume = 0.55;

  async ensure(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch (_) {}
      }
      return;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC() as AudioContext;
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;

    // Room tone: brown-ish noise, low-passed, slow LFO on filter cutoff.
    const bufSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.4;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(lp.frequency);

    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.18;
    this.toneGain = toneGain;
    noise.connect(lp).connect(toneGain).connect(master);
    noise.start();
    lfo.start();

    // Steps bus
    const stepGain = ctx.createGain();
    stepGain.gain.value = 0.5;
    stepGain.connect(master);
    this.stepGain = stepGain;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) {
      this.master.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.15);
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      try {
        this.ctx.suspend();
      } catch (e) {}
    }
  }

  footstep(): void {
    if (!this.ctx) {
      this.ensure().catch(() => {});
      return;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.stepGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (t - this.lastStep < 0.28) return;
    this.lastStep = t;

    const len = 0.18;
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.18));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220 + Math.random() * 80;
    bp.Q.value = 1.2;

    const g = ctx.createGain();
    g.gain.value = 0.12 + Math.random() * 0.06;
    src.connect(bp).connect(g).connect(this.stepGain);
    src.start(t);
    src.stop(t + len);

    // Sub thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.08, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og).connect(this.stepGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

export const galleryAudio = new GalleryAudio();
