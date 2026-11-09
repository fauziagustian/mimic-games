// Dependency-injected lifecycle: the actual UI uses the shared game audio/scoring
// modules. Tests can exercise cancellation without a physical microphone.
export function shuffleSounds(sounds, random = Math.random) {
  const deck = [...sounds];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createPractice({unlock, arm, load, play, stopAudio, record, score, onState, onPitch, onLevel = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  let version = 0, stream = null, capture = null, state = {phase: 'idle'}, busy = false;
  const emit = next => {state = {...state, ...next}; onState(state);};
  const release = target => target?.getTracks().forEach(track => track.stop());
  function cancel(message = '') {
    version++; busy = false;
    capture?.stop(); capture = null;
    release(stream); stream = null; stopAudio();
    emit({phase: 'idle', cue: '', message, result: null, reference: null, sound: null, error: null, seconds: 0});
  }
  async function run(sound) {
    if (busy) return null;
    busy = true;
    const own = ++version, alive = () => own === version;
    let ownedStream = null, ownedCapture = null;
    emit({phase: 'prepare', sound, cue: '', message: '', result: null, reference: null, error: null});
    try {
      await unlock();
      if (!alive()) return null;
      const reference = await load(sound);
      if (!alive()) return null;
      ownedStream = await arm();
      if (!alive()) return null;
      stream = ownedStream;
      stream.getAudioTracks().forEach(track => {track.enabled = false;});
      emit({phase: 'listen', reference});
      const completed = await play(reference);
      if (!alive()) return null;
      if (!completed) {emit({phase: 'idle', message: 'Contoh dihentikan. Coba giliran lagi.'}); return null;}
      for (const cue of ['Ready', '3', '2', '1']) {
        emit({phase: 'countdown', cue});
        await sleep(1000);
        if (!alive()) return null;
      }
      const seconds = Math.min(15, Math.max(2, sound.duration + .4));
      emit({phase: 'record', cue: 'Start', seconds});
      ownedCapture = await record({seconds, stream, onLevel: (frame, elapsed) => {
        if (alive()) onLevel(frame, elapsed, seconds);
      }, onPitch: onPitch ? (frame, elapsed, sampleRate) => {
        if (alive()) onPitch(frame, elapsed, sampleRate);
      } : undefined});
      // Attach the rejection handler immediately, including when cancel races setup.
      const result = ownedCapture.result;
      if (!alive()) {ownedCapture.stop(); await result.catch(() => {}); return null;}
      capture = ownedCapture;
      const attempt = await result;
      if (!alive()) return null;
      release(ownedStream); ownedStream = null; stream = null; capture = null;
      emit({phase: 'scoring', cue: ''});
      await sleep(0); // Allow the recording UI to settle before feature extraction.
      if (!alive()) return null;
      const rating = await score(reference, attempt);
      if (!alive()) return null;
      const take = {sound, reference, attempt, rating};
      emit({phase: 'result', result: take});
      return take;
    } catch (error) {
      if (alive()) emit({phase: 'error', error, cue: ''});
      return null;
    } finally {
      release(ownedStream);
      if (alive()) {stream = null; capture = null; busy = false;}
    }
  }
  return {run, cancel, get busy() {return busy;}, get state() {return state;}};
}
