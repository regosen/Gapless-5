/*
 *
 * Gapless 5: Gapless JavaScript/CSS audio player for HTML5
 *
 * Version 1.3.2
 * Copyright 2014 Rego Sen
 *
*/

// PROBLEM: We have 2 APIs for playing audio through the web, and both of them have problems:
//  - HTML5 Audio: the last chunk of audio gets cut off, making gapless transitions impossible
//  - WebAudio: can't play a file until it's fully loaded
// SOLUTION: Use both!
// If WebAudio hasn't loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.

const gapless5Players = {};
const Gapless5State = {
  None     : 0,
  Loading  : 1,
  Starting : 2,
  Play     : 3,
  Stop     : 4,
  Error    : 5
};

const LogLevel = {
  Debug: 1, // show console.debug and up
  Info: 2, // show console.log and up
  Warning: 3, // show console.warn and up
  Error: 4, // show console.error and up
  None: 5, // show nothing
};

// A Gapless5Source "class" handles track-specific audio requests
function Gapless5Source(parentPlayer, inAudioPath) {
  this.audioPath = inAudioPath;
  const player = parentPlayer;

  // HTML5 Audio
  let audio = null;

  // WebAudio
  let source = null;
  let buffer = null;
  let request = null;

  // states
  let lastTick = 0;
  let position = 0;
  let endpos = 0;
  let queuedState = Gapless5State.None;
  let state = Gapless5State.None;
  let loadedPercent = 0;
  let endedCallback = null;

  this.setVolume = (val) => {
    if (audio !== null) {
      audio.volume = val;
    }
  };

  const setState = (newState) => {
    if (state !== newState && newState === Gapless5State.Play) {
      lastTick = new Date().getTime();
    }
    state = newState;
    queuedState = Gapless5State.None;
    player.uiDirty = true;
  };

  this.getState = () => state;

  this.unload = (isError) => {
    this.stop();
    setState(isError ? Gapless5State.Error : Gapless5State.None);
    if (request) {
      request.abort();
    }
    audio = null;
    source = null;
    buffer = null;
    position = 0;
    endpos = 0;
    player.onunload(this.audioPath);
  };

  const onEnded = () => {
    if (state === Gapless5State.Play) {
      player.onEndedCallback();
    }
  };

  const onError = (error) => {
    player.onerror(this.audioPath, error);
    this.unload(true);
  };

  const onLoadedWebAudio = (inBuffer) => {
    if (!request) {
      return;
    }
    request = null;
    buffer = inBuffer;
    endpos = inBuffer.duration * 1000;

    if (queuedState === Gapless5State.Play && state === Gapless5State.Loading) {
      playAudioFile(true);
    } else if ((audio !== null) && (queuedState === Gapless5State.None) && this.inPlayState(true)) {
      console.debug(`switching from HTML5 to WebAudio: ${this.audioPath}`);
      position = audio.position;
      this.setPosition(position, true);
    }
    if (state === Gapless5State.Loading) {
      state = Gapless5State.Stop;
    }

    player.onload(this.audioPath);
    player.uiDirty = true;
  };

  const onLoadedHTML5Audio = () => {
    if (state !== Gapless5State.Loading) {
      return;
    }

    state = Gapless5State.Stop;
    endpos = audio.duration * 1000;

    if (queuedState === Gapless5State.Play) {
      playAudioFile(true);
    }
    player.uiDirty = true;
  };

  this.stop = () => {
    if (state === Gapless5State.None) {
      return;
    }

    if (player.useWebAudio) {
      if (source) {
        if (endedCallback) {
          window.clearTimeout(endedCallback);
          endedCallback = null;
        }
        source.stop(0);
      }
    }
    // avoid "play() request was interrupted" by pausing after promise is returned
    if (audio && state !== Gapless5State.Starting) {
      audio.pause();
    }

    setState(Gapless5State.Stop);
  };

  const setEndedCallbackTime = (restSec) => {
    if (endedCallback) {
      window.clearTimeout(endedCallback);
    }
    // not using AudioBufferSourceNode.onended or 'ended' because:
    // a) neither will trigger when looped
    // b) AudioBufferSourceNode version triggers on stop() as well
    endedCallback = window.setTimeout(onEnded, restSec * 1000 / player.playbackRate);
  };

  const playAudioFile = () => {
    if (this.inPlayState(true)) {
      return;
    }
    position = Math.max(position, 0);
    if (!Number.isFinite(position) || position >= this.getLength()) {
      position = 0;
    }
    const offsetSec = position / 1000;

    if (buffer !== null) {
      console.debug(`Playing WebAudio: ${this.audioPath}`);
      player.context.resume();
      source = player.context.createBufferSource();
      source.connect(player.gainNode);
      source.buffer = buffer;
      source.playbackRate.value = player.playbackRate;
      source.loop = player.loop && (player.singleMode || player.totalTracks() === 1);

      setEndedCallbackTime(source.buffer.duration - offsetSec);
      source.start(0, offsetSec);
      player.onplay(this.audioPath);
      setState(Gapless5State.Play);
    } else if (audio !== null) {
      console.debug(`Playing HTML5 Audio: ${this.audioPath}`);
      audio.currentTime = offsetSec;
      audio.volume = player.gainNode.gain.value;
      audio.loop = player.loop && (player.singleMode || player.totalTracks() === 1);
      audio.playbackRate = player.playbackRate;

      setEndedCallbackTime(audio.duration - offsetSec);
      setState(Gapless5State.Starting);
      audio.play().then(() => {
        if (state === Gapless5State.Starting) {
          setState(Gapless5State.Play);
          player.onplay(this.audioPath);
        } else {
          // in case stop was requested while awaiting promise
          audio.pause();
        }
      });
    }
  };

  // PUBLIC FUNCTIONS

  this.inPlayState = (checkStarting) => (state === Gapless5State.Play ||
    (checkStarting && state === Gapless5State.Starting));

  this.isPlayActive = (checkStarting) => (this.inPlayState(checkStarting) ||
    queuedState === Gapless5State.Play);

  this.getPosition = () => position;

  this.getLength = () => endpos;

  this.play = () => {
    if (state === Gapless5State.Loading) {
      console.debug(`Queueing ${this.audioPath}`);
      queuedState = Gapless5State.Play;
    } else {
      playAudioFile(); // play immediately
    }
  };

  this.setPlaybackRate = (rate) => {
    if (source) {
      source.playbackRate.value = rate;
    }
    if (audio) {
      audio.playbackRate = rate;
    }
    setEndedCallbackTime((endpos - position) / 1000);
  };

  this.tick = () => {
    if (state === Gapless5State.Play) {
      const nextTick = new Date().getTime();
      const elapsed = nextTick - lastTick;
      position = position + (elapsed * player.playbackRate);
      lastTick = nextTick;
    }

    if (loadedPercent < 1) {
      let newPercent = 1;
      if (state === Gapless5State.Loading) {
        newPercent = 0;
      } else if (audio && audio.seekable.length > 0) {
        newPercent = (audio.seekable.end(0) / audio.duration);
      }
      if (loadedPercent !== newPercent) {
        loadedPercent = newPercent;
        player.setLoadedSpan(loadedPercent);
      }
    }
  };

  this.setPosition = (newPosition, bResetPlay) => {
    position = newPosition;
    if (bResetPlay && this.inPlayState()) {
      this.stop();
      this.play();
    }
  };

  const fetchBlob = (audioPath, loader) => {
    fetch(audioPath).then((r) => {
      if (r.ok) {
        r.blob().then((blob) => {
          loader(blob);
        });
      } else {
        onError(r.statusText);
      }
    }).catch((e) => {
      onError(e);
    });
  };

  this.load = () => {
    if (state === Gapless5State.Loading) {
      return;
    }
    const { audioPath } = this;
    player.onloadstart(audioPath);
    state = Gapless5State.Loading;
    if (player.useWebAudio) {
      const onLoadWebAudio = (data) => {
        if (data) {
          player.context.decodeAudioData(data,
            (incomingBuffer) => {
              onLoadedWebAudio(incomingBuffer);
            }
          );
        }
      };
      if (audioPath.startsWith('blob:')) {
        fetchBlob(audioPath, (blob) => {
          request = new FileReader();
          request.onload = () => {
            if (request) {
              onLoadWebAudio(request.result);
            }
          };
          request.readAsArrayBuffer(blob);
          if (request.error) {
            onError(request.error);
          }
        });
      } else {
        request = new XMLHttpRequest();
        request.open('get', audioPath, true);
        request.responseType = 'arraybuffer';
        request.onload = () => {
          if (request) {
            onLoadWebAudio(request.response);
          }
        };
        request.onerror = () => {
          if (request) {
            onError('HttpRequest error');
          }
        };
        request.send();
      }
    }
    if (player.useHTML5Audio) {
      const getHtml5Audio = () => {
        const audioObj = new Audio();
        audioObj.controls = false;
        // no pitch preservation, to be consistent with WebAudio:
        audioObj.preservesPitch = false;
        audioObj.mozPreservesPitch = false;
        audioObj.webkitPreservesPitch = false;
        audioObj.addEventListener('canplaythrough', onLoadedHTML5Audio, false);
        audioObj.addEventListener('error', onError, false);
        // TODO: switch to audio.networkState, now that it's universally supported
        return audioObj;
      };
      if (audioPath.startsWith('blob:')) {
        // TODO: blob as srcObject is not supported on all browsers
        fetchBlob(audioPath, (blob) => {
          audio = getHtml5Audio();
          audio.srcObject = blob;
          audio.load();
        });
      } else {
        audio = getHtml5Audio();
        audio.src = audioPath;
        audio.load();
      }
    }
  };
}

// A Gapless5FileList "class". Processes an array of JSON song objects, taking
// the "file" members out to constitute the this.playlist.sources[] in the Gapless5 player
function Gapless5FileList(inShuffle, inLoadLimit = -1) {
  // OBJECT STATE
  // Playlist and Track Items
  this.sources = []; // List of Gapless5Sources
  this.startingTrack = 0;
  this.trackNumber = -1; // Displayed track index in GUI

  // If the tracklist ordering changes, after a pre/next song,
  // the playlist needs to be regenerated
  this.shuffledIndices = [];
  this.shuffleMode = Boolean(inShuffle); // Ordered (false) or Shuffle (true)
  this.shuffleRequest = null;
  this.preserveCurrent = true;
  this.loadLimit = inLoadLimit;

  // PRIVATE METHODS

  this.setStartingTrack = (inStartingTrack) => {
    if (inStartingTrack === 'random') {
      this.startingTrack = Math.floor(Math.random() * this.sources.length);
    } else {
      this.startingTrack = inStartingTrack || 0;
    }
    console.debug(`Setting starting track to ${this.startingTrack}`);
    this.trackNumber = this.startingTrack;
  };

  this.gotoTrack = (pointOrPath, forcePlay, allowOverride, resetPosition) => {
    const oldSourceIndex = this.getSourceIndex(this.trackNumber);
    const wasPlaying = this.sources[oldSourceIndex].isPlayActive();
    const restartTrack = () => {
      resetPosition(true);
      if (forcePlay || wasPlaying) {
        this.sources[oldSourceIndex].play();
      }
      return this.trackNumber;
    };

    const newIndex = (typeof pointOrPath === 'string') ?
      this.findTrack(pointOrPath) :
      pointOrPath;

    const updateShuffle = (nextIndex) => {
      if (this.shuffleRequest !== null) {
        if (this.shuffleRequest) {
          this.shuffleRequest = null;
          return enableShuffle(nextIndex);
        }
        this.shuffleRequest = null;
        return disableShuffle(nextIndex);
      }
      return nextIndex;
    };

    const overrideIndex = updateShuffle(newIndex);
    this.trackNumber = allowOverride ? overrideIndex : newIndex;
    console.debug(`Setting track number to ${this.trackNumber}`);
    this.updateLoading();

    const newSourceIndex = this.getSourceIndex(this.trackNumber);

    if (oldSourceIndex === newSourceIndex) {
      return restartTrack();
    }

    resetPosition(true);

    this.sources[oldSourceIndex].stop();
    if (forcePlay || wasPlaying) {
      this.sources[newSourceIndex].play();
    }

    return this.trackNumber;
  };

  // Going into shuffle mode. Remake the list
  const enableShuffle = (nextIndex) => {
    // Shuffle the list
    const indices = Array.from(Array(this.sources.length).keys());
    for (let n = 0; n < indices.length - 1; n++) {
      const k = n + Math.floor(Math.random() * (indices.length - n));
      [ indices[k], indices[n] ] = [ indices[n], indices[k] ];
    }

    if (this.preserveCurrent && this.trackNumber === indices[nextIndex]) {
      // make sure our current shuffled index matches what is playing
      [ indices[this.trackNumber], indices[nextIndex] ] = [ indices[nextIndex], indices[this.trackNumber] ];
    }

    // if shuffle happens to be identical to original list (more likely with fewer tracks),
    // swap another two tracks
    if (JSON.stringify(indices) === JSON.stringify(Array.from(Array(this.sources.length).keys()))) {
      const subIndices = indices.filter((index) => index !== this.trackNumber);
      const subIndex1 = Math.floor(Math.random() * (subIndices.length));
      const subIndex2 = (subIndex1 + 1) % subIndices.length;
      const index1 = indices[subIndices[subIndex1]];
      const index2 = indices[subIndices[subIndex2]];
      [ indices[index1], indices[index2] ] = [ indices[index2], indices[index1] ];
    }

    this.shuffledIndices = indices;
    this.shuffleMode = true;
    console.debug(`Shuffled tracks: ${this.shuffledIndices}`);
    return nextIndex;
  };

  // Leaving shuffle mode.
  const disableShuffle = (nextIndex) => {
    this.shuffleMode = false;
    console.debug('Disabling shuffle');

    if (this.preserveCurrent && this.shuffledIndices[this.trackNumber] === nextIndex) {
      // avoid playing the same track twice, skip to next track
      return (nextIndex + 1) % this.numTracks();
    }
    return nextIndex;
  };

  // PUBLIC METHODS
  // After a shuffle or unshuffle, the array has changed. Get the index
  // for the current-displayed song in the previous array.
  this.lastIndex = (index, newList, oldList) => {
    const compare = newList[index];
    // Cannot compare full objects after clone() :(
    // Instead, compare the generated index
    for (let n = 0; n < oldList.length; n++) {
      if (oldList[n].index === compare.index) {
        return n;
      }
    }

    // Default value, in case some array value was removed
    return 0;
  };

  this.removeAllTracks = (flushList) => {
    for (let i = 0; i < this.sources.length; i++) {
      this.sources[i].unload(); // also calls stop
    }
    if (flushList) {
      this.shuffledIndices = [];
      this.setStartingTrack(-1);
    }
    this.sources = [];
  };

  this.setPlaybackRate = (rate) => {
    for (let i = 0; i < this.sources.length; i++) {
      this.sources[i].setPlaybackRate(rate);
    }
  };

  // Toggle shuffle mode or not, and prepare for rebasing the playlist
  // upon changing to the next available song. NOTE that each function here
  // changes flags, so the logic must exclude any logic if a revert occurs.
  this.setShuffle = (nextShuffle, preserveCurrent = true) => {
    this.shuffleRequest = nextShuffle;
    this.preserveCurrent = preserveCurrent;
    if (!preserveCurrent) {
      enableShuffle(this.trackNumber);
    }
  };

  this.isShuffled = () => {
    if (this.shuffleRequest !== null) {
      return this.shuffleRequest;
    }
    return this.shuffleMode;
  };

  this.numTracks = () => this.sources.length;

  this.getTracks = () => {
    const tracks = [];
    for (let i = 0; i < this.numTracks(); i++) {
      const realIndex = this.getSourceIndex(i);
      tracks.push(this.sources[realIndex].audioPath);
    }
    return tracks;
  };

  this.findTrack = (path) => this.getTracks().indexOf(path);

  this.getSourceIndex = (index) => this.shuffleMode ? this.shuffledIndices[index] : index;

  this.getPlaylistIndex = (index) => this.shuffleMode ? this.shuffledIndices.indexOf(index) : index;

  // inclusive start, exclusive end
  const generateIntRange = (first, last) => Array.from({ length: (1 + last - first) }, (_v, k) => k + first);

  // returns actual indices (not shuffled)
  this.loadableTracks = () => {
    if (this.loadLimit === -1) {
      return generateIntRange(0, this.sources.length);
    }
    // loadable tracks are a range where size=loadLimit, centered around current track
    const startTrack = Math.round(Math.max(0, this.trackNumber - ((this.loadLimit - 1) / 2)));
    const endTrack = Math.round(Math.min(this.sources.length, this.trackNumber + (this.loadLimit / 2)));
    const loadableIndices = generateIntRange(startTrack, endTrack);

    console.debug(`loadable playlist: ${JSON.stringify(loadableIndices)}`);
    return loadableIndices;
  };

  this.updateLoading = () => {
    const loadable = this.loadableTracks();

    for (const [ index, source ] of this.sources.entries()) {
      const playlistIndex = this.getPlaylistIndex(index);
      const shouldLoad = loadable.includes(playlistIndex);
      if (shouldLoad === (source.getState() === Gapless5State.None)) {
        if (shouldLoad) {
          console.debug(`Loading track ${playlistIndex}: ${source.audioPath}`);
          source.load();
        } else {
          console.debug(`Unloading track ${playlistIndex}: ${source.audioPath}`);
          source.unload();
        }
      }
    }
  };

  // Add a new song into the FileList object.
  this.add = (index, audioPath, player) => {
    const source = new Gapless5Source(player, audioPath);
    this.sources.splice(index, 0, source);

    // insert new index in random position
    this.shuffledIndices.splice(Math.floor(Math.random() * this.numTracks()), 0, this.numTracks() - 1);

    // Shift trackNumber if the insert file is earlier in the list
    if (index <= this.trackNumber || this.trackNumber === -1) {
      this.trackNumber = this.trackNumber + 1;
      console.debug(`Shifting track number to ${this.trackNumber}`);
    }
    this.updateLoading();
  };

  // Remove a song from the FileList object.
  this.remove = (index) => {
    this.sources.splice(index, 1);
    this.shuffledIndices.splice(this.shuffledIndices.indexOf(index), 1);

    // Stay at the same song index, unless trackNumber is after the
    // removed index, or was removed at the edge of the list
    if (this.trackNumber > 0 &&
      ((index < this.trackNumber) || (index >= this.numTracks() - 2))) {
      this.trackNumber = this.trackNumber - 1;
      console.debug(`Decrementing track number to ${this.trackNumber}`);
    }
    this.updateLoading();
  };
}

// parameters are optional.
//   options:
//     guiId: id of existing HTML element where UI should be rendered
//     tracks: path of file (or array of music file paths)
//     useWebAudio (default = true)
//     useHTML5Audio (default = true)
//     startingTrack (number or "random", default = 0)
//     loadLimit (max number of tracks loaded at one time, default = -1, no limit)
//     logLevel (default = LogLevel.Info) minimum logging level
//     shuffle (true or false): start the jukebox in shuffle mode
//     shuffleButton (default = true): whether shuffle button appears or not in UI
//     loop (default = false): whether to return to first track after end of playlist
//     singleMode (default = false): whether to treat single track as playlist
//     playbackRate (default = 1.0): higher number = faster playback
//     exclusive (default = false): whether to stop other gapless players when this is playing
function Gapless5(options = {}, deprecated = {}) { // eslint-disable-line no-unused-vars
  // Backwards-compatibility with deprecated API
  if (typeof options === 'string') {
    console.warn('Using deprecated API.  Pass element id into options as "guiId"');
    options = { // eslint-disable-line no-param-reassign
      ...deprecated,
      guiId: options,
    };
  }

  // UI
  const scrubSize = 65535;
  const statusText = {
    loading:  'loading\u2026',
    error: 'error!',
  };
  this.hasGUI = false;
  this.scrubWidth = 0;
  this.scrubPosition = 0;
  this.isScrubbing = false;

  // System
  this.tickMS = 27; // fast enough for numbers to look real-time
  this.initialized = false;
  this.uiDirty = true;
  this.playlist = new Gapless5FileList(options.shuffle, options.loadLimit);

  // Setup up minimum logging
  switch (options.logLevel || LogLevel.Info) {
  /* eslint-disable no-fallthrough */
  case LogLevel.None:
    console.error = () => {};
  case LogLevel.Error:
    console.warn = () => {};
  case LogLevel.Warning:
    console.log = () => {};
  case LogLevel.Info:
    console.debug = () => {};
  case LogLevel.Debug:
  default:
    break;
  /* eslint-enable no-fallthrough */
  }

  this.loop = options.loop || false;
  this.singleMode = options.singleMode || false;
  this.exclusive = options.exclusive || false;

  // these default to true if not defined
  this.useWebAudio = options.useWebAudio !== false;
  this.useHTML5Audio = options.useHTML5Audio !== false;
  this.playbackRate = options.playbackRate || 1.0;
  this.id = Math.floor((1 + Math.random()) * 0x10000);
  gapless5Players[this.id] = this;

  let AudioContext = window.AudioContext || window.webkitAudioContext;
  if (window.gapless5AudioContext === undefined)
    window.gapless5AudioContext = new AudioContext();

  this.context = window.gapless5AudioContext;
  this.gainNode = (this.context !== undefined) ? this.context.createGain() : null;
  if (this.context && this.gainNode) {
    this.gainNode.gain.value = options.volume !== undefined ? options.volume : 1.0;
    this.gainNode.connect(this.context.destination);
  }

  // Callback and Execution logic
  this.isPlayButton = true;
  this.keyMappings = {};

  // Callbacks
  this.onprev = () => {};
  this.onplayrequest = () => {}; // play requested by user
  this.onplay = () => {}; // play actually starts
  this.onpause = () => {};
  this.onstop = () => {};
  this.onnext = () => {};

  this.onerror = () => {};
  this.onloadstart = () => {}; // load started
  this.onload = () => {}; // load completed
  this.onunload = () => {};
  this.onfinishedtrack = () => {};
  this.onfinishedall = () => {};

  // INTERNAL HELPERS
  const getUIPos = () => {
    const { isScrubbing, scrubPosition } = this;
    const position = isScrubbing ? scrubPosition : this.currentSource().getPosition();
    return (position / this.currentSource().getLength()) * scrubSize;
  };

  const getSoundPos = (uiPosition) => ((uiPosition / scrubSize) * this.currentSource().getLength());

  // Current index (if sourceIndex = true and shuffle is on, value will be different)
  this.getIndex = (sourceIndex = false) => {
    // FileList object must be initiated
    if (this.playlist !== null) {
      const { trackNumber } = this.playlist;
      return sourceIndex ? this.playlist.getSourceIndex(trackNumber) : trackNumber;
    }
    return -1;
  };

  const getFormattedTime = (inMS) => {
    let minutes = Math.floor(inMS / 60000);
    const secondsFull = (inMS - (minutes * 60000)) / 1000;
    let seconds = Math.floor(secondsFull);
    let csec = Math.floor((secondsFull - seconds) * 100);

    if (minutes < 10) {
      minutes = `0${minutes}`;
    }
    if (seconds < 10) {
      seconds = `0${seconds}`;
    }
    if (csec < 10) {
      csec = `0${csec}`;
    }

    return `${minutes}:${seconds}.${csec}`;
  };

  const getTotalPositionText = () => {
    let text = statusText.loading;
    if (this.totalTracks() === 0) {
      return text;
    }
    const source = this.currentSource();
    const srcLength = source.getLength();
    if (this.totalTracks() === 0) {
      text = getFormattedTime(0);
    } else if (source.state === Gapless5State.Error) {
      text = statusText.error;
    } else if (srcLength > 0) {
      text = getFormattedTime(srcLength);
    }
    return text;
  };

  const getElement = (prefix) => document.getElementById(`${prefix}${this.id}`);

  // (PUBLIC) ACTIONS
  this.totalTracks = () => {
    // FileList object must be initiated
    if (this.playlist !== null) {
      return this.playlist.numTracks();
    }
    return 0;
  };

  this.mapKeys = (keyOptions) => {
    for (let key in keyOptions) {
      const uppercode = keyOptions[key].toUpperCase().charCodeAt(0);
      const lowercode = keyOptions[key].toLowerCase().charCodeAt(0);
      const player = gapless5Players[this.id];
      if (Gapless5.prototype.hasOwnProperty.call(player, key)) {
        this.keyMappings[uppercode] = player[key];
        this.keyMappings[lowercode] = player[key];
      } else {
        console.error(`Gapless5 mapKeys() error: no function named '${key}'`);
      }
    }
    document.addEventListener('keydown', (e) => {
      const keyCode = e.key.charCodeAt(0);
      if (keyCode in this.keyMappings) {
        this.keyMappings[keyCode](e);
      }
    });
  };

  // volume is normalized between 0 and 1
  this.setVolume = (volume) => {
    this.gainNode.gain.value = volume;
    this.currentSource().setVolume(volume);
    if (this.hasGUI) {
      getElement('volume').value = scrubSize * volume;
    }
  };

  this.setGain = (uiPos) => {
    console.warn('Using deprecated API.  Use setVolume() with value between 0 and 1 instead.');
    this.setVolume(uiPos / scrubSize);
  };

  this.scrub = (uiPos, updateTransport = false) => {
    this.scrubPosition = getSoundPos(uiPos);
    if (this.hasGUI) {
      getElement('currentPosition').innerText = getFormattedTime(this.scrubPosition);
      enableButton('prev', this.loop || (this.getIndex() !== 0 || this.scrubPosition !== 0));
      if (updateTransport) {
        getElement('transportbar').value = uiPos;
      }
    }
    if (!this.isScrubbing) {
      this.currentSource().setPosition(this.scrubPosition, true);
    }
  };

  this.setLoadedSpan = (percent) => {
    if (this.hasGUI) {
      getElement('loaded-span').style.width = percent * this.scrubWidth;
      if (percent === 1) {
        getElement('totalPosition').innerText = getTotalPositionText();
      }
    }
  };

  this.onEndedCallback = () => {
    // we've finished playing the track
    const { audioPath } = this.currentSource();
    resetPosition();
    if (this.loop || this.getIndex() < this.totalTracks() - 1) {
      if (this.loop) {
        this.prev(true);
      } else if (this.singleMode || this.totalTracks() === 1) {
        this.currentSource().stop(true);
      } else {
        this.currentSource().stop(true);
        this.next(true);
      }
      this.onfinishedtrack(audioPath);
    } else {
      this.currentSource().stop(true);
      this.onfinishedtrack(audioPath);
      this.onfinishedall();
    }
  };

  this.onStartedScrubbing = () => {
    this.isScrubbing = true;
  };

  this.onFinishedScrubbing = () => {
    this.isScrubbing = false;
    if (this.currentSource().inPlayState() && this.scrubPosition >= this.currentSource().getLength()) {
      this.next(true);
    } else {
      this.currentSource().setPosition(this.scrubPosition, true);
    }
  };

  this.addTrack = (audioPath) => {
    const next = this.playlist.sources.length;
    this.playlist.add(next, audioPath, this);
    this.uiDirty = true;
  };

  this.insertTrack = (point, audioPath) => {
    const trackCount = this.totalTracks();
    const safePoint = Math.min(Math.max(point, 0), trackCount);
    if (safePoint === trackCount) {
      this.addTrack(audioPath);
    } else {
      this.playlist.add(safePoint, audioPath, this);
    }
    this.uiDirty = true;
  };

  this.getTracks = () => this.playlist.getTracks();

  this.findTrack = (path) => this.playlist.findTrack(path);

  this.removeTrack = (pointOrPath) => {
    const point = (typeof pointOrPath === 'string') ?
      this.findTrack(pointOrPath) :
      pointOrPath;

    if (point < 0 || point >= this.playlist.numTracks()) {
      return;
    }
    const deletedPlaying = point === this.playlist.trackNumber;

    const curSource = this.playlist.sources[point];
    if (!curSource) {
      return;
    }
    let wasPlaying = false;

    if (curSource.state === Gapless5State.Loading) {
      curSource.unload();
    } else if (curSource.inPlayState(true)) {
      wasPlaying = true;
      curSource.stop();
    }

    this.playlist.remove(point);

    if (deletedPlaying) {
      this.next(); // Don't stop after a delete
      if (wasPlaying) {
        this.play();
      }
    }

    this.uiDirty = true;
  };

  this.replaceTrack = (point, audioPath) => {
    this.removeTrack(point);
    this.insertTrack(point, audioPath);
  };

  this.removeAllTracks = (flushPlaylist = true) => {
    this.playlist.removeAllTracks(flushPlaylist);
    this.uiDirty = true;
  };

  this.isShuffled = () => this.playlist.isShuffled();

  // shuffles, re-shuffling if previously shuffled
  this.shuffle = (preserveCurrent = true) => {
    if (!this.canShuffle()) {
      return;
    }
    this.playlist.setShuffle(true, preserveCurrent);
    this.uiDirty = true;
  };

  // toggles between shuffled and unshuffled
  this.toggleShuffle = () => {
    if (this.canShuffle()) {
      this.playlist.setShuffle(!this.isShuffled());
      this.uiDirty = true;
    }
  };
  // backwards-compatibility with previous function name
  this.shuffleToggle = this.toggleShuffle;

  this.currentSource = () => this.playlist.sources[this.getIndex(true)];

  this.setPlaybackRate = (rate) => {
    tick(); // tick once here before changing the playback rate, to maintain correct position
    this.playbackRate = rate;
    this.playlist.setPlaybackRate(rate);
  };

  this.gotoTrack = (pointOrPath, forcePlay, allowOverride = false) => {
    const newIndex = this.playlist.gotoTrack(pointOrPath, forcePlay, allowOverride, resetPosition);
    enableButton('prev', this.loop || (!this.singleMode && newIndex > 0));
    enableButton('next', this.loop || (!this.singleMode && newIndex < this.totalTracks() - 1));
    this.uiDirty = true;
  };

  this.prevtrack = () => {
    if (this.totalTracks() === 0) {
      return;
    }
    let track = 0;
    if (this.getIndex() > 0) {
      track = this.getIndex() - 1;
    } else if (this.loop) {
      track = this.totalTracks() - 1;
    } else {
      return;
    }
    const lastAudioPath = this.currentSource().audioPath;
    this.gotoTrack(track);
    this.onprev(lastAudioPath, this.currentSource().audioPath);
  };

  this.prev = (e) => {
    if (this.totalTracks() === 0) {
      return;
    }
    let wantsCallback = true;
    let track = 0;
    let playlistIndex = this.getIndex();
    if (this.currentSource().getPosition() > 0) {
      // jump to start of track if we're not there
      track = playlistIndex;
      wantsCallback = false;
    } else if (this.singleMode && this.loop) {
      track = playlistIndex;
    } else if (playlistIndex > 0) {
      track = playlistIndex - 1;
    } else if (this.loop) {
      track = this.totalTracks() - 1;
    } else {
      return;
    }

    const lastAudioPath = this.currentSource().audioPath;
    this.gotoTrack(track, e === true);
    if (wantsCallback) {
      this.onprev(lastAudioPath, this.currentSource().audioPath);
    }
  };

  this.next = (e) => {
    if (this.totalTracks() === 0) {
      return;
    }
    let track = 0;
    let playlistIndex = this.getIndex();
    if (this.singleMode) {
      track = playlistIndex;
    } else if (playlistIndex < this.totalTracks() - 1) {
      track = playlistIndex + 1;
    } else if (!this.loop) {
      return;
    }
    const lastAudioPath = this.currentSource().audioPath;
    this.gotoTrack(track, e === true, true);
    this.onnext(lastAudioPath, this.currentSource().audioPath);
  };

  this.play = () => {
    if (this.totalTracks() === 0) {
      return;
    }
    this.currentSource().play();
    if (this.exclusive) {
      const { id } = this;
      for (const otherId in gapless5Players) {
        if (otherId !== id.toString()) {
          gapless5Players[otherId].stop();
        }
      }
    }
    this.onplayrequest(this.currentSource().audioPath);
  };

  this.playpause = (e) => {
    if (this.isPlayButton) {
      this.play(e);
    } else {
      this.pause(e);
    }
  };

  this.cue = (e) => {
    if (!this.isPlayButton) {
      this.prev(e);
    } else if (this.currentSource().getPosition() > 0) {
      this.prev(e);
      this.play(e);
    } else {
      this.play(e);
    }
  };

  this.pause = () => {
    if (this.totalTracks() > 0) {
      this.currentSource().stop();
      this.onpause(this.currentSource().audioPath);
    }
  };

  this.stop = () => {
    if (this.totalTracks() > 0) {
      this.currentSource().stop(true);
      resetPosition();
      this.onstop(this.currentSource().audioPath);
    }
  };


  // (PUBLIC) QUERIES AND CALLBACKS

  this.isPlaying = () => this.currentSource().inPlayState();

  // INIT AND UI

  const resetPosition = (forceScrub) => {
    if (forceScrub || this.currentSource().getPosition() > 0) {
      this.scrub(0, true);
    }
  };

  const enableButton = (buttonId, bEnable) => {
    if (this.hasGUI) {
      const elem = getElement(buttonId);
      if (elem) {
        const { classList } = elem;
        classList.remove(bEnable ? 'disabled' : 'enabled');
        classList.add(bEnable ? 'enabled' : 'disabled');
      }
    }
  };

  const enableShuffleButton = (mode, bEnable) => {
    const elem = getElement('shuffle');
    if (elem) {
      const isShuffle = mode === 'shuffle';
      elem.classList.remove(isShuffle ? 'g5unshuffle' : 'g5shuffle');
      elem.classList.add(isShuffle ? 'g5shuffle' : 'g5unshuffle');
      enableButton('shuffle', bEnable);
    }
  };

  // Must have at least 3 tracks in order for shuffle button to work
  // If so, permanently turn on the shuffle toggle
  this.canShuffle = () => this.totalTracks() > 2;

  const updateDisplay = () => {
    if (!this.hasGUI) {
      return;
    }
    if (this.totalTracks() === 0) {
      getElement('trackIndex').innerText = '0';
      getElement('tracks').innerText = '0';
      getElement('totalPosition').innerText = '00:00.00';
      enableButton('prev', false);
      enableShuffleButton('shuffle', false);
      enableButton('next', false);
    } else {
      getElement('trackIndex').innerText = this.playlist.trackNumber;
      getElement('tracks').innerText = this.totalTracks();
      getElement('totalPosition').innerText = getTotalPositionText();
      enableButton('prev', this.loop || this.getIndex() > 0 || this.currentSource().getPosition() > 0);
      enableButton('next', this.loop || this.getIndex() < this.totalTracks() - 1);

      if (this.currentSource().inPlayState(true)) {
        enableButton('play', false);
        this.isPlayButton = false;
      } else {
        enableButton('play', true);
        this.isPlayButton = true;

        if (this.currentSource().state === Gapless5State.Error) {
          this.onerror(this.currentSource().audioPath);
        }
      }
      enableShuffleButton(this.isShuffled() ? 'unshuffle' : 'shuffle', this.canShuffle());
    }
  };

  const tick = () => {
    if (this.totalTracks() > 0) {
      this.currentSource().tick();

      if (this.uiDirty) {
        this.uiDirty = false;
        updateDisplay();
      }
      if (this.currentSource().inPlayState()) {
        let soundPos = this.currentSource().getPosition();
        if (this.isScrubbing) {
        // playing track, update bar position
          soundPos = this.scrubPosition;
        }
        if (this.hasGUI) {
          getElement('transportbar').value = getUIPos();
          getElement('currentPosition').innerText = getFormattedTime(soundPos);
        }
      }
    }
    window.setTimeout(() => {
      tick();
    }, this.tickMS);
  };

  const createGUI = (playerHandle) => {
    const { id } = this;
    const playerWrapper = (html) => `
    <div class="g5position" id="g5position${id}">
      <span id="currentPosition${id}">00:00.00</span> |
      <span id="totalPosition${id}">${statusText.loading}</span> |
      <span id="trackIndex${id}">1</span>/<span id="tracks${id}">1</span>
    </div>
    <div class="g5inside" id="g5inside${id}">
      ${html}
    </div>
  `;

    if (typeof Audio === 'undefined') {
      this.hasGUI = false;
      return playerWrapper('This player is not supported by your browser.');
    }

    return playerWrapper(`
    <div class="g5transport">
      <div class="g5meter" id="g5meter${id}"><span id="loaded-span${id}" style="width: 0%"></span></div>
        <input type="range" class="transportbar" name="transportbar" id="transportbar${id}"
        min="0" max="${scrubSize}" value="0" oninput="${playerHandle}.scrub(this.value);"
        onmousedown="${playerHandle}.onStartedScrubbing();" ontouchstart="${playerHandle}.onStartedScrubbing();"
        onmouseup="${playerHandle}.onFinishedScrubbing();" ontouchend="${playerHandle}.onFinishedScrubbing();" />
      </div>
    <div class="g5buttons" id="g5buttons${id}">
      <button class="g5button g5prev" id="prev${id}"></button>
      <button class="g5button g5play" id="play${id}"></button>
      <button class="g5button g5stop" id="stop${id}"></button>
      <button class="g5button g5shuffle" id="shuffle${id}"></button>
      <button class="g5button g5next" id="next${id}"></button>
      <input type="range" id="volume${id}" class="volume" name="gain" min="0" max="${scrubSize}"
        value="${scrubSize}" oninput="${playerHandle}.setVolume(this.value / ${scrubSize});"
      />
    </div>
  `);
  };

  const guiElement = options.guiId ? document.getElementById(options.guiId) : null;
  if (guiElement) {
    this.hasGUI = true;
    guiElement.insertAdjacentHTML('beforeend', createGUI(`gapless5Players[${this.id}]`));

    // css adjustments
    if (navigator.userAgent.indexOf('macOS') === -1) {
      getElement('transportbar').classList.add('g5meter-1pxup');
    }

    const onMouseDown = (elemId, cb) => {
      const elem = getElement(elemId);
      if (elem) {
        elem.addEventListener('mousedown', cb);
      }
    };

    // set up button mappings
    onMouseDown('prev', this.prev);
    onMouseDown('play', this.playpause);
    onMouseDown('stop', this.stop);
    onMouseDown('shuffle', this.toggleShuffle);
    onMouseDown('next', this.next);

    enableButton('play', true);
    enableButton('stop', true);

    // set up whether shuffleButton appears or not (default is visible)
    if (options.shuffleButton === false) {
      // Style items per earlier Gapless versions
      const setElementWidth = (elemId, width) => {
        const elem = getElement(elemId);
        if (elem) {
          elem.style.width = width;
        }
      };

      const transSize = '111px';
      const playSize = '115px';
      setElementWidth('transportbar', transSize);
      setElementWidth('g5meter', transSize);
      setElementWidth('g5position', playSize);
      setElementWidth('g5inside', playSize);
      getElement('shuffle').remove();
    }
    this.scrubWidth = getElement('transportbar').style.width;
  }

  if (typeof Audio === 'undefined') {
    console.error('This player is not supported by your browser.');
    return;
  }

  // set up starting track number
  if ('startingTrack' in options) {
    if (typeof options.startingTrack === 'number') {
      this.startingTrack = options.startingTrack;
    } else if ((typeof options.startingTrack === 'string') && (options.startingTrack === 'random')) {
      this.startingTrack = 'random';
    }
  }

  // set up key mappings
  if ('mapKeys' in options) {
    this.mapKeys(options.mapKeys);
  }

  // set up tracks into a FileList object
  if ('tracks' in options) {
    let items = [];
    let startingTrack = 0;
    if (Array.isArray(options.tracks)) {
      if (typeof options.tracks[0] === 'string') {
        items = options.tracks;
        for (let i = 0; i < options.tracks.length; i++) {
          items[i] = options.tracks[i];
        }
      } else if (typeof options.tracks[0] === 'object') {
        // convert JSON items into array
        for (let i = 0; i < options.tracks.length; i++) {
          items[i] = options.tracks[i].file;
        }
        startingTrack = this.startingTrack || 0;
      }
    } else if (typeof options.tracks === 'string') {
      items[0] = options.tracks;
    }
    for (let i = 0; i < items.length; i++) {
      this.addTrack(items[i]);
    }
    this.playlist.setStartingTrack(startingTrack);
  }

  this.initialized = true;
  this.uiDirty = true;

  tick();
}

// simple UMD plumbing based on https://gist.github.com/kamleshchandnani/07c63f3d728672d91f97b69bbf700eed
(function umd(global, factory) {
  if (typeof define === 'function' && define.amd) {
    define([ 'exports' ], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports);
  } else {
    const mod = {
      exports: {}
    };
    factory(mod.exports);
    global.Gapless5 = mod.exports.Gapless5;
    global.LogLevel = mod.exports.LogLevel;
  }
}(this, (exports) => {
  exports.Gapless5 = Gapless5;
  exports.LogLevel = LogLevel;
}));
