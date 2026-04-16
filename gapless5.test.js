const xhrMockClass = () => ({
  open            : jest.fn(),
  send            : jest.fn(),
  setRequestHeader: jest.fn(),
  abort           : jest.fn(),
});
XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass);

const audioMockClass = () => ({
  addEventListener: jest.fn(),
  load: jest.fn(),
  pause: jest.fn(),
  play: jest.fn(() => Promise.resolve(jest.fn())),
});
Audio = jest.fn().mockImplementation(audioMockClass);

const audioContextMockClass = () => ({
  createGain: () => ({
    gain: { value: 1 },
    connect: jest.fn(),
  }),
});

window = {
  clearTimeout     : jest.fn(),
  setTimeout       : jest.fn(),
  AudioContext     : jest.fn().mockImplementation(audioContextMockClass),
};

const { Gapless5, LogLevel } = require('./gapless5.js');

/** test data **/

const TRACKS = [ '0.mp3', '1.mp3', '2.mp3', '3.mp3', '4.mp3' ];
const INIT_OPTIONS = {
  logLevel: LogLevel.None,
  useWebAudio: false,
  useHTML5Audio: false,
};

/** test suite **/

describe('Gapless-5 object', () => {
  let player = null;

  beforeEach(() => {
    player = new Gapless5(INIT_OPTIONS);
  });

  it('has correct initial state', () => {
    expect(player.getTracks()).toStrictEqual([]);
    expect(player.totalTracks()).toBe(0);
    expect(player.getIndex()).toBe(-1);
    expect(player.getPosition()).toBe(0);
    expect(player.canShuffle()).toBe(false);
    expect(player.initialized).toBe(true);
    expect(player.hasGUI).toBe(false);
  });

  it('can manipulate tracklist and position', () => {
    player.addTrack(TRACKS[1]);
    expect(player.getIndex()).toBe(0);
    player.insertTrack(0, TRACKS[0]);
    expect(player.getTracks()).toStrictEqual([ TRACKS[0], TRACKS[1] ]);
    expect(player.findTrack(TRACKS[1])).toBe(1);
    player.setPlaybackRate(0.1);
    player.setPosition(10);
    expect(player.getPosition()).toBe(10);

    player.removeTrack(0);
    expect(player.getTracks()).toStrictEqual([ TRACKS[1] ]);
    player.removeAllTracks();
    expect(player.getTracks()).toStrictEqual([]);
    player.setPosition(10);
    expect(player.getPosition()).toBe(0); // setPosition should do nothing without a track
  });
});

describe('Gapless-5 object with tracklist', () => {
  let player = null;

  beforeEach(() => {
    player = new Gapless5({
      ...INIT_OPTIONS,
      tracks: TRACKS,
    });
  });

  it('has correct initial state', () => {
    expect(player.getTracks()).toStrictEqual(TRACKS);
    expect(player.getIndex()).toBe(0);
    expect(player.getPosition()).toBe(0);
    expect(player.initialized).toBe(true);
    expect(player.hasGUI).toBe(false);
  });

  it('can shuffle and un-shuffle tracklist', () => {
    expect(player.canShuffle()).toBe(true);
    expect(player.isShuffled()).toBe(false);
    player.shuffle();
    expect(player.isShuffled()).toBe(true);

    // shouldn't actually shuffle until we change tracks
    expect(player.getTracks()).toStrictEqual(TRACKS);
    player.next();
    expect(player.getTracks()).not.toStrictEqual(TRACKS);
    expect(player.totalTracks()).toBe(TRACKS.length);

    // shouldn't actually unshuffle until we change tracks
    player.toggleShuffle();
    expect(player.isShuffled()).toBe(false);
    expect(player.getTracks()).not.toStrictEqual(TRACKS);
    player.next();
    expect(player.getTracks()).toStrictEqual(TRACKS);
  });

  it('can navigate the tracklist', () => {
    expect(player.getIndex()).toBe(0);
    player.next();
    expect(player.getIndex()).toBe(1);
    player.prev();
    expect(player.getIndex()).toBe(0);
    player.gotoTrack(2);
    expect(player.getIndex()).toBe(2);

    // should loop around
    player.loop = true;
    TRACKS.forEach(() => player.next());
    expect(player.getIndex()).toBe(2);

    // should not loop around
    player.loop = false;
    TRACKS.forEach(() => player.next());
    expect(player.getIndex()).toBe(TRACKS.length - 1);
  });

  it('triggers navigation callbacks', () => {
    player.onprev = jest.fn();
    player.onnext = jest.fn();
    player.onplayrequest = jest.fn();
    player.onpause = jest.fn();
    player.onstop = jest.fn();

    player.next();
    expect(player.onnext).toHaveBeenCalledWith(TRACKS[0], TRACKS[1]);
    player.prev();
    expect(player.onprev).toHaveBeenCalledWith(TRACKS[1], TRACKS[0]);
    player.play();
    expect(player.onplayrequest).toHaveBeenCalledWith(TRACKS[0]);
    player.pause();
    expect(player.onpause).toHaveBeenCalledWith(TRACKS[0]);
    player.stop();
    expect(player.onstop).toHaveBeenCalledWith(TRACKS[0]);
  });

  it('regression: maintains correct index when removing tracks that come after the currently playing track', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    // Verify initial state
    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual(testTracks);

    // Move to track 1
    testPlayer.gotoTrack(1);
    expect(testPlayer.getIndex()).toBe(1);

    // Remove track at index 2
    testPlayer.removeTrack(2);

    // Check index is still 1 and track list is updated
    expect(testPlayer.getIndex()).toBe(1);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track2.mp3' ]);
  });

  it('regression: maintains correct index when removing the currently playing track', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    // Verify initial state
    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual(testTracks);

    // Move to track 1
    testPlayer.gotoTrack(1);
    expect(testPlayer.getIndex()).toBe(1);
    testPlayer.play();

    // Remove the currently playing track
    testPlayer.removeTrack(1);

    // Check index is still 1 and track list is updated, therefore we move to the next available track
    expect(testPlayer.getIndex()).toBe(1);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track3.mp3' ]);

    testPlayer.play();

    // Remove the currently playing track
    testPlayer.removeTrack(1);

    // Check index is still 0 and track list is updated, therefore we move to the next available track
    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3' ]);

    testPlayer.play();

    // Remove the only remaining track — list is empty, index resets to -1
    testPlayer.removeTrack(0);
    expect(testPlayer.getIndex()).toBe(-1);
    expect(testPlayer.getTracks()).toStrictEqual([]);
  });

  it('regression: removing a track does not wipe shuffledIndices', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3', 'track4.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    testPlayer.shuffle();
    testPlayer.next(); // commit the shuffle
    expect(testPlayer.isShuffled()).toBe(true);
    expect(testPlayer.playlist.shuffledIndices.length).toBe(testTracks.length);

    testPlayer.removeTrack(0);

    // Shuffle order should still be intact (one fewer entry, still shuffled)
    expect(testPlayer.isShuffled()).toBe(true);
    expect(testPlayer.playlist.shuffledIndices.length).toBe(testTracks.length - 1);
    expect(testPlayer.getTracks().length).toBe(testTracks.length - 1);
  });

  it('regression: removing currently-playing track repeatedly until empty does not crash', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    // Walk the list down to zero by always removing the current track
    // This reproduces a crash in the pre-PR code where updateLoading()
    // would dereference an undefined source after the list went empty.
    while (testPlayer.getTracks().length > 0) {
      testPlayer.removeTrack(testPlayer.getIndex());
    }
    expect(testPlayer.getTracks()).toStrictEqual([]);
    expect(testPlayer.getIndex()).toBe(-1);
  });

  it('regression: removing current-at-tail with loop=true wraps to start and resumes', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
      loop: true,
    });

    testPlayer.gotoTrack(2);
    expect(testPlayer.getIndex()).toBe(2);

    // Force the tail source to report as playing so removeTrack takes the
    // wasPlaying branch (the mock audio env never transitions real state).
    testPlayer.playlist.sources[2].inPlayState = () => true;

    testPlayer.onnext = jest.fn();
    testPlayer.onplayrequest = jest.fn();

    testPlayer.removeTrack(2);

    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track2.mp3' ]);
    expect(testPlayer.onnext).toHaveBeenCalledWith('track3.mp3', 'track1.mp3');
    expect(testPlayer.onplayrequest).toHaveBeenCalledTimes(1);
    expect(testPlayer.onplayrequest).toHaveBeenCalledWith('track1.mp3');
  });

  it('regression: removing current-at-tail with loop=false clamps and always pauses', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
      loop: false,
    });

    testPlayer.gotoTrack(2);
    expect(testPlayer.getIndex()).toBe(2);

    // Force the tail source to report as playing so removeTrack takes the
    // wasPlaying branch — this is the scenario where the old code would
    // have auto-resumed on the clamped-to-last track.
    testPlayer.playlist.sources[2].inPlayState = () => true;

    testPlayer.onnext = jest.fn();
    testPlayer.onplayrequest = jest.fn();

    testPlayer.removeTrack(2);

    expect(testPlayer.getIndex()).toBe(1);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track2.mp3' ]);
    expect(testPlayer.onnext).toHaveBeenCalledWith('track3.mp3', 'track2.mp3');
    expect(testPlayer.onplayrequest).not.toHaveBeenCalled();
  });
});

describe('Gapless-5 object with load limit', () => {
  it('obeys load limit', () => {
    const player = new Gapless5({
      ...INIT_OPTIONS,
      loadLimit: 2,
    });
    const loadedTracks = new Set([]);
    player.onloadstart = (audioPath) => {
      loadedTracks.add(audioPath);
    };
    player.onunload = (audioPath) => {
      loadedTracks.delete(audioPath);
    };

    TRACKS.forEach((track) => player.addTrack(track));
    expect(player.totalTracks()).toBe(TRACKS.length);
    expect(loadedTracks.size).toBe(2);
    player.next();
    expect(loadedTracks.size).toBe(2);
    player.next();
    expect(loadedTracks.size).toBe(2);
    player.removeAllTracks();
    expect(loadedTracks.size).toBe(0);
  });
});
