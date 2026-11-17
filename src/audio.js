(function () {
  'use strict';

  window.RA = window.RA || {};

  const audio = {
    ctx: null,
    masterGain: null,
    sfxGain: null,
    musicGain: null,
    noiseBuffer: null,
    enabled: true,
    musicEnabled: true,
    sfxVolume: 0.7,
    musicVolume: 0.38,
    musicPlaying: false,
    musicTimer: null,
    musicStep: 0,
    lastSpeakTime: 0,
    lastSpeakPhrase: '',
    sfxCooldowns: {},

    init: function () {
      try {
        if (!this.ctx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return false;
          this.ctx = new AudioCtx();

          this.masterGain = this.ctx.createGain();
          this.sfxGain = this.ctx.createGain();
          this.musicGain = this.ctx.createGain();

          this.masterGain.gain.value = this.enabled ? 1.0 : 0.0;
          this.sfxGain.gain.value = this.sfxVolume;
          this.musicGain.gain.value = this.musicEnabled ? this.musicVolume : 0.0;

          this.sfxGain.connect(this.masterGain);
          this.musicGain.connect(this.masterGain);
          this.masterGain.connect(this.ctx.destination);

          this._createNoiseBuffer();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(function () {});
        }
        return true;
      } catch (e) {
        return false;
      }
    },

    _createNoiseBuffer: function () {
      if (!this.ctx) return;
      try {
        const sampleRate = this.ctx.sampleRate || 44100;
        const length = sampleRate * 1.5;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buffer;
      } catch (e) {
        // Ignore if buffer creation fails
      }
    },

    toggleMute: function () {
      this.enabled = !this.enabled;
      try {
        if (this.masterGain && this.ctx) {
          this.masterGain.gain.setValueAtTime(this.enabled ? 1.0 : 0.0, this.ctx.currentTime);
        }
        if (!this.enabled && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
      } catch (e) {}
      return this.enabled;
    },

    toggleMusic: function () {
      this.musicEnabled = !this.musicEnabled;
      try {
        if (this.musicGain && this.ctx) {
          this.musicGain.gain.setValueAtTime(
            this.musicEnabled ? this.musicVolume : 0.0,
            this.ctx.currentTime
          );
        }
        if (this.musicEnabled && !this.musicPlaying) {
          this.startMusic();
        } else if (!this.musicEnabled && this.musicPlaying) {
          this.stopMusic();
        }
      } catch (e) {}
      return this.musicEnabled;
    },

    setVolume: function (sfx, music) {
      if (typeof sfx === 'number' && !isNaN(sfx)) {
        this.sfxVolume = Math.max(0, Math.min(1, sfx));
      }
      if (typeof music === 'number' && !isNaN(music)) {
        this.musicVolume = Math.max(0, Math.min(1, music));
      }
      try {
        if (this.sfxGain && this.ctx) {
          this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
        }
        if (this.musicGain && this.ctx) {
          this.musicGain.gain.setValueAtTime(
            this.musicEnabled ? this.musicVolume : 0.0,
            this.ctx.currentTime
          );
        }
      } catch (e) {}
    },

    setSfxVolume: function (sfx) {
      this.setVolume(sfx, this.musicVolume);
    },

    setMusicVolume: function (music) {
      this.setVolume(this.sfxVolume, music);
    },

    startMusic: function () {
      try {
        this.init();
        if (this.musicTimer) {
          clearInterval(this.musicTimer);
          this.musicTimer = null;
        }
        this.musicPlaying = true;
        if (!this.musicEnabled) return;

        const stepDurationMs = 135; // ~111 BPM 16th-note industrial march tempo
        const self = this;
        this.musicTimer = setInterval(function () {
          if (!self.enabled || !self.musicEnabled || !self.ctx) return;
          if (self.ctx.state === 'suspended') return;
          self._playMusicStep(self.musicStep);
          self.musicStep = (self.musicStep + 1) % 64;
        }, stepDurationMs);
      } catch (e) {}
    },

    stopMusic: function () {
      this.musicPlaying = false;
      if (this.musicTimer) {
        clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    },

    _playMusicStep: function (step) {
      try {
        const now = this.ctx.currentTime;
        const barStep = step % 16;
        const phrase = Math.floor(step / 16);

        // Hell March-inspired industrial E-minor driving bassline (E1, G1, A1, B1, F1)
        const bassPattern = [
          41.2, 41.2, 0, 41.2,
          41.2, 0, 49.0, 55.0,
          41.2, 41.2, 0, 41.2,
          61.7, 55.0, 49.0, 43.65
        ];
        const bassFreq = bassPattern[barStep];
        if (bassFreq > 0) {
          const osc = this.ctx.createOscillator();
          const filter = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(bassFreq, now);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(phrase >= 2 ? 420 : 280, now);
          filter.Q.setValueAtTime(4.5, now);

          gain.gain.setValueAtTime(0.26, now);
          gain.gain.exponentialRampToValueAtTime(0.008, now + 0.12);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.musicGain);

          osc.start(now);
          osc.stop(now + 0.13);
        }

        // Heavy military stomp kick on beats 0, 4, 8, 12
        if (barStep % 4 === 0) {
          const kickOsc = this.ctx.createOscillator();
          const kickGain = this.ctx.createGain();
          kickOsc.type = 'sine';
          kickOsc.frequency.setValueAtTime(125, now);
          kickOsc.frequency.exponentialRampToValueAtTime(34, now + 0.11);

          kickGain.gain.setValueAtTime(0.38, now);
          kickGain.gain.exponentialRampToValueAtTime(0.005, now + 0.12);

          kickOsc.connect(kickGain);
          kickGain.connect(this.musicGain);
          kickOsc.start(now);
          kickOsc.stop(now + 0.13);
        }

        // Crisp regiment snare march on beats 4, 12, and military roll on 14, 15
        if (barStep === 4 || barStep === 12 || (phrase % 2 === 1 && (barStep === 14 || barStep === 15))) {
          this._triggerNoise(now, 0.09, 1400, 'bandpass', barStep >= 14 ? 0.14 : 0.22, this.musicGain);
        }

        // Industrial metallic hi-hat pulse on even 16ths
        if (barStep % 2 === 0) {
          this._triggerNoise(now, 0.03, 5500, 'highpass', 0.06, this.musicGain);
        }

        // Brass/Power-chord synth riff on phrases 1 & 3
        if (phrase === 1 || phrase === 3) {
          const leadPattern = [
            164.8, 0, 164.8, 196.0,
            220.0, 0, 196.0, 174.6,
            164.8, 0, 164.8, 246.9,
            220.0, 196.0, 174.6, 164.8
          ];
          const leadFreq = leadPattern[barStep];
          if (leadFreq > 0) {
            const leadOsc = this.ctx.createOscillator();
            const subOsc = this.ctx.createOscillator();
            const leadFilter = this.ctx.createBiquadFilter();
            const leadGain = this.ctx.createGain();

            leadOsc.type = 'sawtooth';
            subOsc.type = 'square';
            leadOsc.frequency.setValueAtTime(leadFreq, now);
            subOsc.frequency.setValueAtTime(leadFreq * 1.5, now); // Power fifth

            leadFilter.type = 'lowpass';
            leadFilter.frequency.setValueAtTime(1350, now);

            leadGain.gain.setValueAtTime(0.11, now);
            leadGain.gain.exponentialRampToValueAtTime(0.008, now + 0.12);

            leadOsc.connect(leadFilter);
            subOsc.connect(leadFilter);
            leadFilter.connect(leadGain);
            leadGain.connect(this.musicGain);

            leadOsc.start(now);
            subOsc.start(now);
            leadOsc.stop(now + 0.13);
            subOsc.stop(now + 0.13);
          }
        }
      } catch (e) {}
    },

    _triggerNoise: function (startTime, duration, filterFreq, filterType, volume, targetGain) {
      if (!this.ctx || !this.noiseBuffer) return;
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = filterType || 'bandpass';
        filter.frequency.setValueAtTime(filterFreq || 1000, startTime);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.003, startTime + duration);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(targetGain || this.sfxGain);

        src.start(startTime);
        src.stop(startTime + duration);
      } catch (e) {}
    },

    _triggerTone: function (type, startFreq, endFreq, duration, volume, delay) {
      if (!this.ctx) return;
      try {
        const startTime = this.ctx.currentTime + (delay || 0);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(startFreq, startTime);
        if (endFreq && endFreq !== startFreq) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);
        }

        gain.gain.setValueAtTime(volume || 0.25, startTime);
        gain.gain.exponentialRampToValueAtTime(0.004, startTime + duration);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(startTime);
        osc.stop(startTime + duration);
      } catch (e) {}
    },

    playSfx: function (type) {
      if (!this.enabled) return;
      try {
        if (!this.init() || !this.ctx) return;

        // Throttle high-frequency combat SFX so simultaneous shots don't clip
        const nowMs = performance.now ? performance.now() : Date.now();
        const minGap = (type === 'rifle' || type === 'bullet' || type === 'machinegun') ? 45 : 25;
        if (this.sfxCooldowns[type] && nowMs - this.sfxCooldowns[type] < minGap) {
          return;
        }
        this.sfxCooldowns[type] = nowMs;

        const now = this.ctx.currentTime;

        switch (type) {
          case 'click':
            this._triggerTone('triangle', 1100, 650, 0.045, 0.22, 0);
            break;

          case 'select':
            this._triggerTone('sine', 680, 920, 0.06, 0.2, 0);
            this._triggerTone('sine', 1040, 1040, 0.05, 0.16, 0.05);
            break;

          case 'move':
          case 'attack':
            this._triggerTone('triangle', 520, 780, 0.07, 0.22, 0);
            this._triggerTone('triangle', 780, 640, 0.07, 0.18, 0.06);
            break;

          case 'rifle':
          case 'bullet':
            this._triggerNoise(now, 0.055, 2200, 'bandpass', 0.28, this.sfxGain);
            this._triggerTone('sawtooth', 320, 90, 0.045, 0.18, 0);
            break;

          case 'machinegun':
            this._triggerNoise(now, 0.045, 1900, 'bandpass', 0.26, this.sfxGain);
            this._triggerNoise(now + 0.055, 0.045, 2100, 'bandpass', 0.26, this.sfxGain);
            break;

          case 'cannon':
          case 'shell':
            this._triggerNoise(now, 0.18, 520, 'lowpass', 0.48, this.sfxGain);
            this._triggerTone('sine', 160, 38, 0.19, 0.42, 0);
            break;

          case 'rocket':
            this._triggerNoise(now, 0.28, 1200, 'bandpass', 0.34, this.sfxGain);
            this._triggerTone('sawtooth', 260, 580, 0.24, 0.18, 0);
            break;

          case 'tesla':
            this._triggerTone('sawtooth', 1450, 260, 0.22, 0.35, 0);
            this._triggerTone('square', 920, 1880, 0.15, 0.26, 0.04);
            this._triggerNoise(now, 0.22, 3400, 'highpass', 0.32, this.sfxGain);
            break;

          case 'c4':
          case 'explosion':
            this._triggerNoise(now, 0.36, 380, 'lowpass', 0.52, this.sfxGain);
            this._triggerTone('sine', 120, 28, 0.32, 0.45, 0);
            break;

          case 'big_explosion':
            this._triggerNoise(now, 0.65, 290, 'lowpass', 0.68, this.sfxGain);
            this._triggerTone('sawtooth', 95, 22, 0.58, 0.52, 0);
            break;

          case 'build_place':
          case 'place':
            this._triggerNoise(now, 0.14, 420, 'lowpass', 0.38, this.sfxGain);
            this._triggerTone('triangle', 140, 65, 0.16, 0.36, 0);
            this._triggerTone('sine', 440, 660, 0.12, 0.2, 0.09);
            break;

          case 'cash':
            this._triggerTone('sine', 987.77, 987.77, 0.07, 0.24, 0);
            this._triggerTone('sine', 1318.5, 1318.5, 0.14, 0.26, 0.07);
            break;

          case 'repair':
            this._triggerTone('triangle', 580, 860, 0.08, 0.2, 0);
            this._triggerTone('triangle', 680, 980, 0.08, 0.2, 0.09);
            break;

          case 'sell':
            this._triggerTone('sawtooth', 660, 320, 0.14, 0.22, 0);
            this._triggerTone('sine', 1180, 1480, 0.12, 0.22, 0.12);
            break;

          case 'low_power':
            this._triggerTone('sawtooth', 420, 210, 0.26, 0.32, 0);
            this._triggerTone('sawtooth', 380, 180, 0.32, 0.32, 0.28);
            break;

          case 'radar_on':
            this._triggerTone('sine', 330, 660, 0.14, 0.24, 0);
            this._triggerTone('sine', 660, 1320, 0.22, 0.26, 0.12);
            break;

          case 'chrono':
            this._triggerTone('sine', 240, 1680, 0.38, 0.35, 0);
            this._triggerTone('triangle', 1480, 320, 0.35, 0.28, 0.12);
            this._triggerNoise(now, 0.35, 2600, 'bandpass', 0.26, this.sfxGain);
            break;

          case 'iron_curtain':
            this._triggerTone('sawtooth', 110, 220, 0.45, 0.36, 0);
            this._triggerTone('square', 220, 440, 0.42, 0.25, 0.08);
            break;

          case 'nuke_siren':
            this._triggerTone('sawtooth', 380, 880, 0.55, 0.38, 0);
            this._triggerTone('sawtooth', 880, 380, 0.45, 0.35, 0.55);
            this._triggerTone('sawtooth', 380, 880, 0.55, 0.38, 1.0);
            break;

          case 'nuke_blast':
            this._triggerNoise(now, 1.2, 220, 'lowpass', 0.85, this.sfxGain);
            this._triggerTone('sawtooth', 80, 18, 1.1, 0.72, 0);
            this._triggerNoise(now + 0.15, 0.9, 650, 'bandpass', 0.45, this.sfxGain);
            break;

          case 'victory':
            this._triggerTone('triangle', 523.25, 523.25, 0.16, 0.3, 0);
            this._triggerTone('triangle', 659.25, 659.25, 0.16, 0.3, 0.16);
            this._triggerTone('triangle', 783.99, 783.99, 0.16, 0.3, 0.32);
            this._triggerTone('triangle', 1046.5, 1046.5, 0.45, 0.36, 0.48);
            break;

          case 'defeat':
            this._triggerTone('sawtooth', 392.0, 370.0, 0.25, 0.3, 0);
            this._triggerTone('sawtooth', 349.23, 329.63, 0.25, 0.3, 0.26);
            this._triggerTone('sawtooth', 311.13, 261.63, 0.55, 0.35, 0.52);
            break;

          case 'flak':
            this._triggerNoise(now, 0.085, 1650, 'bandpass', 0.38, this.sfxGain);
            this._triggerTone('square', 420, 110, 0.065, 0.24, 0);
            break;

          case 'sam_missile':
            this._triggerNoise(now, 0.26, 1500, 'bandpass', 0.36, this.sfxGain);
            this._triggerTone('sawtooth', 340, 820, 0.22, 0.24, 0);
            break;

          case 'torpedo':
            this._triggerTone('sine', 180, 55, 0.28, 0.36, 0);
            this._triggerNoise(now, 0.24, 620, 'lowpass', 0.32, this.sfxGain);
            break;

          case 'sonar':
            this._triggerTone('sine', 1320, 1310, 0.18, 0.24, 0);
            this._triggerTone('sine', 1320, 1300, 0.14, 0.12, 0.22);
            break;

          case 'dog_bark':
          case 'dog':
            this._triggerTone('sawtooth', 360, 150, 0.075, 0.32, 0);
            this._triggerNoise(now, 0.065, 950, 'bandpass', 0.28, this.sfxGain);
            this._triggerTone('sawtooth', 390, 140, 0.085, 0.34, 0.09);
            this._triggerNoise(now + 0.09, 0.07, 1050, 'bandpass', 0.28, this.sfxGain);
            break;

          case 'spy_infiltrate':
          case 'infiltrate':
            this._triggerTone('sine', 523.25, 659.25, 0.11, 0.24, 0);
            this._triggerTone('triangle', 783.99, 1046.5, 0.18, 0.26, 0.1);
            this._triggerTone('sine', 1318.5, 1567.98, 0.22, 0.22, 0.2);
            break;

          case 'seismic_charge':
          case 'mad_charge':
          case 'seismic':
            this._triggerTone('sawtooth', 55, 140, 0.55, 0.48, 0);
            this._triggerTone('sine', 42, 95, 0.6, 0.52, 0.08);
            this._triggerNoise(now, 0.55, 240, 'lowpass', 0.42, this.sfxGain);
            break;

          case 'crate_pickup':
          case 'crate':
            this._triggerTone('triangle', 587.33, 587.33, 0.07, 0.24, 0);
            this._triggerTone('triangle', 880.0, 880.0, 0.08, 0.26, 0.07);
            this._triggerTone('triangle', 1174.66, 1174.66, 0.16, 0.28, 0.15);
            break;

          case 'radar_ping':
          case 'alert':
            this._triggerTone('sine', 1180, 1480, 0.08, 0.25, 0);
            this._triggerTone('sine', 1480, 1180, 0.1, 0.22, 0.1);
            break;

          case 'quicksave':
          case 'quickload':
            this._triggerTone('sine', 784.0, 987.77, 0.07, 0.22, 0);
            this._triggerTone('sine', 1174.66, 1567.98, 0.14, 0.24, 0.08);
            break;

          case 'bridge_destroy':
          case 'splash':
            this._triggerNoise(now, 0.52, 340, 'lowpass', 0.62, this.sfxGain);
            this._triggerTone('sawtooth', 110, 26, 0.45, 0.48, 0);
            this._triggerNoise(now + 0.12, 0.4, 1100, 'bandpass', 0.34, this.sfxGain);
            break;

          default:
            this._triggerTone('sine', 600, 800, 0.06, 0.18, 0);
            break;
        }
      } catch (e) {}
    },

    speak: function (phrase) {
      if (!phrase) return;

      // Update EVA ticker DOM element if present
      try {
        const evaEl = document.getElementById('eva-message');
        if (evaEl) {
          evaEl.textContent = 'EVA // ' + String(phrase).toUpperCase();
        }
      } catch (e) {}

      if (!this.enabled) return;

      const now = Date.now();
      // Throttle identical phrases within 2.2s or any phrase within 0.75s so EVA alerts don't stack up
      if (phrase === this.lastSpeakPhrase && now - this.lastSpeakTime < 2200) {
        return;
      }
      if (now - this.lastSpeakTime < 750) {
        return;
      }
      this.lastSpeakPhrase = phrase;
      this.lastSpeakTime = now;

      // Play crisp tactical EVA telemetry chime before voice
      try {
        if (this.init() && this.ctx) {
          this._triggerTone('sine', 880, 1174.66, 0.06, 0.14, 0);
        }
      } catch (e) {}

      // Synthesize speech via Web Speech API if available
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function') {
          window.speechSynthesis.cancel();
          const utter = new window.SpeechSynthesisUtterance(String(phrase));
          utter.rate = 1.06;
          utter.pitch = 0.92;
          utter.volume = Math.max(0.1, Math.min(1, this.sfxVolume));
          window.speechSynthesis.speak(utter);
        }
      } catch (e) {}
    }
  };

  window.RA.audio = audio;
})();
