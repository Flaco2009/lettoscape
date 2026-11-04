// Lettoscape – prozedurale Ambient-Sounds (Wind, Regen, Grillen). Keine Audiodateien noetig.
export class Ambience {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.5;
    this.rain = 0;
    this.night = 0;
    this.nextChirp = 0;
  }

  init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const noise = (type) => {
      const len = ctx.sampleRate * 4;
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else d[i] = w;
      }
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.start();
      return src;
    };

    // Wind
    const wind = noise('brown');
    const windF = ctx.createBiquadFilter();
    windF.type = 'lowpass';
    windF.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.35;
    wind.connect(windF).connect(this.windGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 250;
    lfo.connect(lfoAmt).connect(windF.frequency);
    lfo.start();

    // Wasser am Ufer
    const water = noise('brown');
    const waterF = ctx.createBiquadFilter();
    waterF.type = 'bandpass';
    waterF.frequency.value = 350;
    waterF.Q.value = 0.8;
    const waterG = ctx.createGain();
    waterG.gain.value = 0.12;
    water.connect(waterF).connect(waterG).connect(this.master);
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.18;
    const wla = ctx.createGain();
    wla.gain.value = 0.08;
    wl.connect(wla).connect(waterG.gain);
    wl.start();

    // Regen
    const rain = noise('white');
    const rainF = ctx.createBiquadFilter();
    rainF.type = 'highpass';
    rainF.frequency.value = 1200;
    const rainF2 = ctx.createBiquadFilter();
    rainF2.type = 'lowpass';
    rainF2.frequency.value = 7000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainF).connect(rainF2).connect(this.rainGain).connect(this.master);

    this.cricketBus = ctx.createGain();
    this.cricketBus.gain.value = 0;
    this.cricketBus.connect(this.master);
  }

  update(s) {
    this.volume = s.volume ?? 0.5;
    const want = !!s.sound;
    if (want && !this.ctx) this.init();
    if (!this.ctx) return;
    if (want && this.ctx.state === 'suspended') this.ctx.resume();
    this.enabled = want;
    this.master.gain.setTargetAtTime(want ? this.volume * 0.6 : 0, this.ctx.currentTime, 0.5);
  }

  setWeather(rain, hour) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * 0.25, t, 0.8);
    const night = (hour > 20.5 || hour < 5.5) ? 1 : 0;
    this.cricketBus.gain.setTargetAtTime(night * (1 - rain) * 0.05, t, 2);
    if (night && t > this.nextChirp) {
      this.chirp(t);
      this.nextChirp = t + 0.4 + Math.random() * 1.6;
    }
  }

  chirp(t) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.cricketBus);
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const st = t + i * 0.06;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(1, st + 0.01);
      g.gain.linearRampToValueAtTime(0, st + 0.04);
      o.connect(g).connect(pan);
      o.start(st);
      o.stop(st + 0.05);
    }
  }
}
