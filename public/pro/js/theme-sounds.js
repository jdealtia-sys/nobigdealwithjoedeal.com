/**
 * NBD Pro Theme Engine - Ambient Audio System
 * Web Audio API-based ambient soundscapes for themes
 * IIFE pattern, exposed as window.ThemeSounds
 */

(function() {
  'use strict';

  // ============================================================================
  // AUDIO CONTEXT & STATE MANAGEMENT
  // ============================================================================

  let audioContext = null;
  let masterGain = null;
  let profileGain = null;
  let currentProfile = null;
  let isEnabled = false;
  let volume = 0.03; // Very subtle default
  let noiseBuffer = null;
  let currentNodes = [];
  let isInitialized = false;

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
    }
    return audioContext;
  }

  function ensureAudioContext() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function createNoiseBuffer(ctx) {
    if (noiseBuffer) return noiseBuffer;
    const bufferLength = 2 * ctx.sampleRate; // 2 seconds
    const noiseBuffer_ = ctx.createBuffer(1, bufferLength, ctx.sampleRate);
    const output = noiseBuffer_.getChannelData(0);
    for (let i = 0; i < bufferLength; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noiseBuffer = noiseBuffer_;
    return noiseBuffer;
  }

  function stopAndDisconnectNodes() {
    currentNodes.forEach(node => {
      try {
        if (node.stop) node.stop(0);
        if (node.disconnect) node.disconnect();
      } catch (e) {
        // Node already stopped or disconnected
      }
    });
    currentNodes = [];
  }

  function respectsReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ============================================================================
  // SOUND PROFILE GENERATORS
  // ============================================================================

  function createOceanProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // White noise source
    const noiseBuffer_ = createNoiseBuffer(ctx);
    const bufferSource = ctx.createBufferSource();
    bufferSource.buffer = noiseBuffer_;
    bufferSource.loop = true;
    nodes.push(bufferSource);

    // Bandpass filter (200-400 Hz)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.5;

    // LFO for modulation (slow gain sweep)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.3; // Very slow
    nodes.push(lfo);

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4; // Modulation depth

    // Connect: noise → filter → gain (modulated by LFO)
    bufferSource.connect(filter);
    filter.connect(gain);
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    bufferSource.start(0);
    lfo.start(0);

    return nodes;
  }

  function createRainProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    const noiseBuffer_ = createNoiseBuffer(ctx);
    const bufferSource = ctx.createBufferSource();
    bufferSource.buffer = noiseBuffer_;
    bufferSource.loop = true;
    nodes.push(bufferSource);

    // Highpass filter at 2kHz
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.8;

    bufferSource.connect(filter);
    filter.connect(gain);

    // Occasional low rumble (thunderstorm variant)
    const rumbleInterval = setInterval(() => {
      if (currentProfile !== 'rain') {
        clearInterval(rumbleInterval);
        return;
      }
      const rumbleDuration = 0.3;
      const rumbleOsc = ctx.createOscillator();
      rumbleOsc.frequency.value = 40 + Math.random() * 20; // Deep bass
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.setValueAtTime(0.05, ctx.currentTime);
      rumbleGain.gain.linearRampToValueAtTime(0, ctx.currentTime + rumbleDuration);

      rumbleOsc.connect(rumbleGain);
      rumbleGain.connect(gain);
      rumbleOsc.start(ctx.currentTime);
      rumbleOsc.stop(ctx.currentTime + rumbleDuration);
    }, 15000 + Math.random() * 15000); // 15-30 seconds

    bufferSource.start(0);

    return nodes;
  }

  function createForestProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    const noiseBuffer_ = createNoiseBuffer(ctx);
    const bufferSource = ctx.createBufferSource();
    bufferSource.buffer = noiseBuffer_;
    bufferSource.loop = true;
    nodes.push(bufferSource);

    // Filtered noise
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 800;

    bufferSource.connect(filter);
    filter.connect(gain);

    // Periodic chirp tones
    const chirpInterval = setInterval(() => {
      if (currentProfile !== 'forest') {
        clearInterval(chirpInterval);
        return;
      }
      const chirpOsc = ctx.createOscillator();
      chirpOsc.frequency.value = 2000 + Math.random() * 2000; // 2-4kHz
      const chirpGain = ctx.createGain();
      const chirpDuration = 0.15;

      chirpGain.gain.setValueAtTime(0.02, ctx.currentTime);
      chirpGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + chirpDuration);

      chirpOsc.connect(chirpGain);
      chirpGain.connect(gain);
      chirpOsc.start(ctx.currentTime);
      chirpOsc.stop(ctx.currentTime + chirpDuration);
    }, 3000 + Math.random() * 5000); // 3-8 seconds

    bufferSource.start(0);

    return nodes;
  }

  function createWindProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    const noiseBuffer_ = createNoiseBuffer(ctx);
    const bufferSource = ctx.createBufferSource();
    bufferSource.buffer = noiseBuffer_;
    bufferSource.loop = true;
    nodes.push(bufferSource);

    // Bandpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.7;

    // LFO for gust effect (slower gain modulation)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.4;
    nodes.push(lfo);

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;

    bufferSource.connect(filter);
    filter.connect(gain);
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    bufferSource.start(0);
    lfo.start(0);

    return nodes;
  }

  function createFireplaceProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    const noiseBuffer_ = createNoiseBuffer(ctx);
    const bufferSource = ctx.createBufferSource();
    bufferSource.buffer = noiseBuffer_;
    bufferSource.loop = true;
    nodes.push(bufferSource);

    // Aggressive bandpass for crackle
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 4000;
    filter.Q.value = 2.0;

    bufferSource.connect(filter);
    filter.connect(gain);

    // Random amplitude modulation for crackle/pop
    const modInterval = setInterval(() => {
      if (currentProfile !== 'fireplace') {
        clearInterval(modInterval);
        return;
      }
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(Math.random() * 0.08, ctx.currentTime);
      modGain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      modGain.connect(gain.gain);
      // Modulation source is the noise itself (amplitude envelope)
    }, 100 + Math.random() * 150);

    bufferSource.start(0);

    return nodes;
  }

  function createDigitalProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // Base tone: 60Hz sine (low hum)
    const baseTone = ctx.createOscillator();
    baseTone.frequency.value = 60;
    baseTone.type = 'sine';
    nodes.push(baseTone);

    const baseGain = ctx.createGain();
    baseGain.gain.value = 0.01; // Very subtle

    baseTone.connect(baseGain);
    baseGain.connect(gain);

    // High harmonic: 240Hz (subtle sci-fi texture)
    const harmonic = ctx.createOscillator();
    harmonic.frequency.value = 240;
    harmonic.type = 'sine';
    nodes.push(harmonic);

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.005;

    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);

    baseTone.start(0);
    harmonic.start(0);

    return nodes;
  }

  function createSpaceProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // Deep sub-bass: 40Hz sine
    const drone = ctx.createOscillator();
    drone.frequency.value = 40;
    drone.type = 'sine';
    nodes.push(drone);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.02;

    // Very slow modulation
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.1;
    nodes.push(lfo);

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;

    drone.connect(droneGain);
    droneGain.connect(gain);
    lfo.connect(lfoGain);
    lfoGain.connect(droneGain.gain);

    drone.start(0);
    lfo.start(0);

    return nodes;
  }

  function createArcadeProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // Pentatonic scale frequencies
    const pentatonic = [261, 329, 392, 493];
    let noteIndex = 0;

    const arpInterval = setInterval(() => {
      if (currentProfile !== 'arcade') {
        clearInterval(arpInterval);
        return;
      }

      const osc = ctx.createOscillator();
      osc.frequency.value = pentatonic[noteIndex % pentatonic.length];
      osc.type = 'square';
      nodes.push(osc);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.008, ctx.currentTime);
      noteGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);

      osc.connect(noteGain);
      noteGain.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);

      noteIndex++;
    }, 200); // Chiptune tempo

    return nodes;
  }

  function createJazzProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // Cmaj7 chord: C(261), E(329), G(392), B(493)
    const jazzFreqs = [261, 329, 392, 493];

    jazzFreqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq + (Math.random() * 2 - 1); // Subtle detuning
      osc.type = 'triangle';
      nodes.push(osc);

      const noteGain = ctx.createGain();
      noteGain.gain.value = 0.004; // Very quiet warm pad

      osc.connect(noteGain);
      noteGain.connect(gain);
      osc.start(0);
    });

    return nodes;
  }

  function createCafeProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // Light noise floor
    const noiseBuffer_ = createNoiseBuffer(ctx);
    const bufferSource = ctx.createBufferSource();
    bufferSource.buffer = noiseBuffer_;
    bufferSource.loop = true;
    nodes.push(bufferSource);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.015;

    bufferSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(gain);
    bufferSource.start(0);

    // Occasional soft clinks (high-frequency sine pings)
    const clinkInterval = setInterval(() => {
      if (currentProfile !== 'cafe') {
        clearInterval(clinkInterval);
        return;
      }

      const clink = ctx.createOscillator();
      clink.frequency.value = 3000 + Math.random() * 2000; // 3-5kHz
      clink.type = 'sine';

      const clinkGain = ctx.createGain();
      const clinkDuration = 0.1;
      clinkGain.gain.setValueAtTime(0.015, ctx.currentTime);
      clinkGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + clinkDuration);

      clink.connect(clinkGain);
      clinkGain.connect(gain);
      clink.start(ctx.currentTime);
      clink.stop(ctx.currentTime + clinkDuration);
    }, 2000 + Math.random() * 3000);

    return nodes;
  }

  function createAmbientPadProfile(ctx) {
    const nodes = [];
    const gain = profileGain;

    // Two detuned sine waves for beat frequency effect
    const freq1 = 110; // A2
    const freq2 = 110.5; // Slightly detuned

    const osc1 = ctx.createOscillator();
    osc1.frequency.value = freq1;
    osc1.type = 'sine';
    nodes.push(osc1);

    const osc2 = ctx.createOscillator();
    osc2.frequency.value = freq2;
    osc2.type = 'sine';
    nodes.push(osc2);

    const gain1 = ctx.createGain();
    gain1.gain.value = 0.015;

    const gain2 = ctx.createGain();
    gain2.gain.value = 0.015;

    osc1.connect(gain1);
    gain1.connect(gain);
    osc2.connect(gain2);
    gain2.connect(gain);

    osc1.start(0);
    osc2.start(0);

    return nodes;
  }

  // ============================================================================
  // PROFILE SWITCHING
  // ============================================================================

  const profileGenerators = {
    ocean: createOceanProfile,
    rain: createRainProfile,
    forest: createForestProfile,
    wind: createWindProfile,
    fireplace: createFireplaceProfile,
    digital: createDigitalProfile,
    space: createSpaceProfile,
    arcade: createArcadeProfile,
    jazz: createJazzProfile,
    cafe: createCafeProfile,
    'ambient-pad': createAmbientPadProfile,
    none: () => []
  };

  function switchProfile(profileName) {
    if (currentProfile === profileName) return;
    if (!isEnabled || respectsReducedMotion()) return;

    const ctx = ensureAudioContext();

    // Fade out current profile
    if (profileGain) {
      profileGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      setTimeout(() => stopAndDisconnectNodes(), 500);
    }

    // Create new profile gain
    profileGain = ctx.createGain();
    profileGain.gain.value = 0;
    profileGain.connect(masterGain);

    // Fade in new profile
    profileGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);

    // Generate new profile nodes
    if (profileGenerators[profileName]) {
      currentNodes = profileGenerators[profileName](ctx);
    }

    currentProfile = profileName;
  }

  // ============================================================================
  // NOTIFICATION SOUNDS
  // ============================================================================

  function playNotificationSound(type) {
    if (respectsReducedMotion()) return;
    const ctx = ensureAudioContext();
    const notificationGain = ctx.createGain();
    notificationGain.connect(masterGain);

    const duration = 0.2;
    const now = ctx.currentTime;

    switch (type) {
      case 'chiptune': {
        // Descending two-note bleep
        const note1 = ctx.createOscillator();
        note1.type = 'square';
        note1.frequency.value = 800;
        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.05, now);
        g1.gain.linearRampToValueAtTime(0, now + 0.1);
        note1.connect(g1);
        g1.connect(notificationGain);
        note1.start(now);
        note1.stop(now + 0.1);

        const note2 = ctx.createOscillator();
        note2.type = 'square';
        note2.frequency.value = 600;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.05, now + 0.1);
        g2.gain.linearRampToValueAtTime(0, now + 0.2);
        note2.connect(g2);
        g2.connect(notificationGain);
        note2.start(now + 0.1);
        note2.stop(now + 0.2);
        break;
      }

      case 'zen': {
        // Triangle wave with slow decay
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 528; // Healing frequency
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.04, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.connect(env);
        env.connect(notificationGain);
        osc.start(now);
        osc.stop(now + 0.6);
        break;
      }

      case 'dramatic': {
        // Sawtooth stab
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 200;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.08, now);
        env.gain.linearRampToValueAtTime(0, now + duration);
        osc.connect(env);
        env.connect(notificationGain);
        osc.start(now);
        osc.stop(now + duration);
        break;
      }

      case 'bubble': {
        // Ascending sine with pitch bend
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + duration);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.06, now);
        env.gain.linearRampToValueAtTime(0, now + duration);
        osc.connect(env);
        env.connect(notificationGain);
        osc.start(now);
        osc.stop(now + duration);
        break;
      }

      default: {
        // Standard short sine ping
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 800;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.05, now);
        env.gain.linearRampToValueAtTime(0, now + duration);
        osc.connect(env);
        env.connect(notificationGain);
        osc.start(now);
        osc.stop(now + duration);
      }
    }
  }

  // ============================================================================
  // VISIBILITY & LIFECYCLE
  // ============================================================================

  function handleVisibilityChange() {
    if (document.hidden) {
      stopAndDisconnectNodes();
    } else if (isEnabled && currentProfile && currentProfile !== 'none') {
      switchProfile(currentProfile);
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.ThemeSounds = {
    init() {
      if (isInitialized) return;

      // Load initial state
      const savedEnabled = localStorage.getItem('nbd-theme-sound');
      isEnabled = savedEnabled === 'true' ? true : false;

      // Set up audio context on first interaction
      const setupContext = () => {
        const ctx = ensureAudioContext();
        masterGain = ctx.createGain();
        masterGain.gain.value = volume;
        masterGain.connect(ctx.destination);
        document.removeEventListener('click', setupContext);
        document.removeEventListener('keydown', setupContext);
      };

      document.addEventListener('click', setupContext);
      document.addEventListener('keydown', setupContext);

      // Handle visibility changes
      document.addEventListener('visibilitychange', handleVisibilityChange);

      isInitialized = true;
    },

    setProfile(profileName) {
      if (!profileGenerators.hasOwnProperty(profileName)) {
        console.warn(`Unknown sound profile: ${profileName}`);
        return;
      }
      switchProfile(profileName);
    },

    setEnabled(enabled) {
      isEnabled = enabled;
      localStorage.setItem('nbd-theme-sound', enabled ? 'true' : 'false');

      if (enabled && currentProfile && currentProfile !== 'none') {
        switchProfile(currentProfile);
      } else {
        stopAndDisconnectNodes();
        if (profileGain) {
          profileGain.gain.linearRampToValueAtTime(0, getAudioContext().currentTime + 0.3);
        }
      }
    },

    isEnabled() {
      return isEnabled;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (masterGain) {
        masterGain.gain.value = volume * 0.03; // Scale to base quietness
      }
    },

    getVolume() {
      return volume;
    },

    playNotification(type) {
      if (respectsReducedMotion()) return;
      ensureAudioContext();
      playNotificationSound(type);
    },

    destroy() {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopAndDisconnectNodes();
      if (audioContext) {
        audioContext.close();
      }
      currentProfile = null;
      isInitialized = false;
    }
  };

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.ThemeSounds.init();
    });
  } else {
    window.ThemeSounds.init();
  }
})();
