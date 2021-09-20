/*
 *
 * Gapless 5: Gapless JavaScript/CSS audio player for HTML5
 *
 * Version 1.0.1
 * Copyright 2014 Rego Sen
 *
*/

// PROBLEM: We have 2 APIs for playing audio through the web, and both of them have problems:
//  - HTML5 Audio: the last chunk of audio gets cut off, making gapless transitions impossible
//  - WebAudio: can't play a file until it's fully loaded
// SOLUTION: Use both!
// If WebAudio hasn't loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.

window.hasWebKit = ('webkitAudioContext' in window) && !('chrome' in window);

const gapless5Players = {};
const Gapless5State = {
  None     : 0,
  Loading  : 1,
  Play     : 2,
  Stop     : 3,
  Error    : 4
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

  // Audio object version
  let audio = null;

  // Buffer source version
  let source = null;
  let buffer = null;
  let request = null;

  // states
  let startTime = 0;
  let position = 0;
  let endpos = 0;
  let queuedState = Gapless5State.None;
  let state = Gapless5State.None;
  let loadedPercent = 0;
  let audioFinished = false; // eslint-disable-line no-unused-vars
  let endedCallback = null;

  // request manager info
  let initMS = new Date().getTime();

  this.setGain = (val) => {
    if (audio !== null) {
      audio.volume = val;
    }
  };

  const setState = (newState) => {
    state = newState;
    queuedState = Gapless5State.None;
  };

  this.timer = () => {
    return (new Date().getTime()) - initMS;
  };

  this.cancelRequest = (isError) => {
    setState(isError ? Gapless5State.Error : Gapless5State.None);
    if (request) {
      request.abort();
    }
    audio = null;
    source = null;
    buffer = null;
    position = 0;
    endpos = 0;
    initMS = (new Date().getTime());
    this.uiDirty = true;
  };

  const onEnded = () => {
    if (state === Gapless5State.Play) {
      audioFinished = true;
      player.onEndedCallback();
    }
  };

  const onPlayEvent = () => {
    startTime = (new Date().getTime()) - position;
  };

  const onError = () => {
    this.cancelRequest(true);
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
    } else if ((audio !== null) && (queuedState === Gapless5State.None) && (state === Gapless5State.Play)) {
      console.debug(`switching from HTML5 to WebAudio: ${this.audioPath}`);
      position = new Date().getTime() - startTime;
      if (!window.hasWebKit) {
        position = position - this.tickMS;
      }
      this.setPosition(position, true);
    }
    if (state === Gapless5State.Loading) {
      state = Gapless5State.Stop;
    }

    player.onload(this.audioPath);
    // once we have WebAudio data loaded, we don't need the HTML5 audio stream anymore
    audio = null;
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
    if (state === Gapless5State.Stop) {
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
    if (audio) {
      audio.pause();
    }

    setState(Gapless5State.Stop);
    player.uiDirty = true;
  };

  const playAudioFile = () => {
    if (state === Gapless5State.Play) {
      return;
    }
    position = Math.max(position, 0);
    if (!Number.isFinite(position) || position >= endpos) {
      position = 0;
    }

    const offsetSec = position / 1000;
    startTime = (new Date().getTime()) - position;

    if (buffer !== null) {
      console.debug(`playing WebAudio: ${this.audioPath}`);
      player.context.resume();
      source = player.context.createBufferSource();
      source.connect(player.gainNode);
      source.buffer = buffer;

      const restSec = source.buffer.duration - offsetSec;
      if (endedCallback) {
        window.clearTimeout(endedCallback);
      }
      endedCallback = window.setTimeout(onEnded, restSec * 1000);
      if (window.hasWebKit) {
        source.start(0, offsetSec, restSec);
      } else {
        source.start(0, offsetSec);
      }
      setState(Gapless5State.Play);
    } else if (audio !== null) {
      console.debug(`playing HTML5 Audio: ${this.audioPath}`);
      audio.currentTime = offsetSec;
      audio.volume = player.gainNode.gain.value;
      audio.play();
      setState(Gapless5State.Play);
    }
    player.uiDirty = true;
  };

  // PUBLIC FUNCTIONS

  this.inPlayState = () => {
    return (state === Gapless5State.Play);
  };

  this.isPlayActive = () => {
    return (this.inPlayState() || queuedState === Gapless5State.Play) && !this.audioFinished;
  };

  this.getPosition = () => {
    return position;
  };

  this.getLength = () => {
    return endpos;
  };

  this.play = () => {
    if (state === Gapless5State.Loading) {
      queuedState = Gapless5State.Play;
    } else {
      playAudioFile(); // play immediately
    }
  };

  this.tick = () => {
    if (state === Gapless5State.Play) {
      position = (new Date().getTime()) - startTime;
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

  this.load = () => {
    if (state === Gapless5State.Loading) {
      return;
    }
    const { audioPath } = this;
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
        fetch(audioPath).then((r) => {
          r.blob().then((blob) => {
            request = new FileReader();
            request.onload = () => {
              if (request) {
                onLoadWebAudio(request.result);
              }
            };
            request.readAsArrayBuffer(blob);
            if (request.error) {
              onError();
            }
          });
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
            onError();
          }
        };
        request.send();
      }
    }
    if (player.useHTML5Audio) {
      const getHtml5Audio = () => {
        const audioObj = new Audio();
        audioObj.controls = false;
        audioObj.addEventListener('canplaythrough', onLoadedHTML5Audio, false);
        audioObj.addEventListener('ended', onEnded, false);
        audioObj.addEventListener('play', onPlayEvent, false);
        audioObj.addEventListener('error', onError, false);
        // TODO: switch to audio.networkState, now that it's universally supported
        return audioObj;
      };
      if (audioPath.startsWith('blob:')) {
        // TODO: blob as srcObject is not supported on all browsers
        fetch(audioPath).then((r) => {
          r.blob().then((blob) => {
            audio = getHtml5Audio();
            audio.srcObject = blob;
            audio.load();
          });
        });
      } else {
        audio = getHtml5Audio();
        audio.src = audioPath;
        audio.load();
      }
    }
  };

  this.load();
}

// A Gapless5FileList "class". Processes an array of JSON song objects, taking
// the "file" members out to constitute the this.playlist.sources[] in the Gapless5 player
function Gapless5FileList(inShuffle) {
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
    const oldIndex = this.getIndex(this.trackNumber, false);
    const oldSourceIndex = this.getIndex(this.trackNumber, true);
    const restartTrack = () => {
      resetPosition(true);
      if (forcePlay || this.sources[oldSourceIndex].isPlayActive()) {
        this.sources[oldSourceIndex].play();
      }
      return this.trackNumber;
    };

    const newIndex = (typeof pointOrPath === 'string') ?
      this.findTrack(pointOrPath) :
      pointOrPath;

    if (oldIndex === newIndex) {
      return restartTrack(); // don't actually instantiate shuffle yet
    }

    const updateShuffle = (nextIndex) => {
      if (this.shuffleRequest !== null) {
        if (this.shuffleRequest) {
          this.shuffleRequest = null;
          return enableShuffle(this.trackNumber, nextIndex);
        }
        this.shuffleRequest = null;
        return disableShuffle(this.trackNumber, nextIndex);
      }
      return nextIndex;
    };

    const overrideIndex = updateShuffle(newIndex);
    this.trackNumber = allowOverride ? overrideIndex : newIndex;
    console.debug(`Setting track number to ${this.trackNumber}`);

    const newSourceIndex = this.getIndex(this.trackNumber, true);

    if (oldSourceIndex === newSourceIndex) {
      return restartTrack();
    }

    // Cancel any track that's in loading state right now
    if (this.sources[oldSourceIndex].state === Gapless5State.Loading) {
      this.sources[oldSourceIndex].cancelRequest();
    }

    resetPosition(true);
    if (this.sources[newSourceIndex].state === Gapless5State.None) {
      this.sources[newSourceIndex].load();
    }

    if ((forcePlay) || this.sources[oldSourceIndex].isPlayActive()) {
      this.sources[newSourceIndex].play();
    }
    this.sources[oldSourceIndex].stop();

    return this.trackNumber;
  };

  // Going into shuffle mode. Remake the list
  const enableShuffle = (lastIndex, nextIndex) => {
    // Shuffle the list
    const indices = Array.from(Array(this.sources.length).keys());
    for (let n = 0; n < indices.length - 1; n++) {
      const k = n + Math.floor(Math.random() * (indices.length - n));
      [ indices[k], indices[n] ] = [ indices[n], indices[k] ];
    }

    if (this.preserveCurrent && lastIndex === indices[nextIndex]) {
      // make sure our current shuffled index matches what is playing
      [ indices[lastIndex], indices[nextIndex] ] = [ indices[nextIndex], indices[lastIndex] ];
    }

    // if shuffle happens to be identical to original list (more likely with fewer tracks),
    // swap another two tracks
    if (JSON.stringify(indices) === JSON.stringify(Array.from(Array(this.sources.length).keys()))) {
      const subIndices = indices.filter((index) => {
        return index !== lastIndex;
      });
      const subIndex1 = Math.floor(Math.random() * (subIndices.length));
      const subIndex2 = (subIndex1 + 1) % subIndices.length;
      const index1 = indices[subIndices[subIndex1]];
      const index2 = indices[subIndices[subIndex2]];
      [ indices[index1], indices[index2] ] = [ indices[index2], indices[index1] ];
    }

    this.shuffledIndices = indices;
    this.shuffleMode = true;
    return nextIndex;
  };

  // Leaving shuffle mode.
  const disableShuffle = (lastIndex, nextIndex) => {
    this.shuffleMode = false;

    if (this.preserveCurrent && this.shuffledIndices[lastIndex] === nextIndex) {
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
      if (this.sources[i].state === Gapless5State.Loading) {
        this.sources[i].cancelRequest();
      }
      this.sources[i].stop();
    }
    if (flushList) {
      this.shuffledIndices = [];
      this.setStartingTrack(-1);
    }
    this.sources = [];
  };

  // Toggle shuffle mode or not, and prepare for rebasing the playlist
  // upon changing to the next available song. NOTE that each function here
  // changes flags, so the logic must exclude any logic if a revert occurs.
  this.setShuffle = (nextShuffle, preserveCurrent = true) => {
    this.shuffleRequest = nextShuffle;
    this.preserveCurrent = preserveCurrent;
    if (!preserveCurrent) {
      enableShuffle(this.trackNumber, this.trackNumber);
    }
  };

  this.isShuffled = () => {
    if (this.shuffleRequest !== null) {
      return this.shuffleRequest;
    }
    return this.shuffleMode;
  };

  this.numTracks = () => {
    return this.sources.length;
  };

  this.getTracks = () => {
    const tracks = [];
    for (let i = 0; i < this.numTracks(); i++) {
      const realIndex = this.getIndex(i, true);
      tracks.push(this.sources[realIndex].audioPath);
    }
    return tracks;
  };

  this.findTrack = (path) => {
    return this.getTracks().indexOf(path);
  };

  // Find the given index in the current playlist
  this.getIndex = (index, actualIndex = false) => {
    if (this.shuffleMode && actualIndex) {
      return this.shuffledIndices[index];
    }
    return index;
  };

  // Add a new song into the FileList object.
  this.add = (index, audioPath, player) => {
    this.sources.splice(index, 0, new Gapless5Source(player, audioPath));

    // insert new index in random position
    this.shuffledIndices.splice(Math.floor(Math.random() * this.numTracks()), 0, this.numTracks() - 1);

    // Shift trackNumber if the insert file is earlier in the list
    if (index <= this.trackNumber || this.trackNumber === -1) {
      this.trackNumber = this.trackNumber + 1;
      console.debug(`Shifting track number to ${this.trackNumber}`);
    }
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
  };
}

// parameters are optional.
//   options:
//     guiId: id of existing HTML element where UI should be rendered
//     tracks: path of file (or array of music file paths)
//     useWebAudio (default = true)
//     useHTML5Audio (default = true)
//     startingTrack (number or "random", default = 0)
//     logLevel (default = LogLevel.Info) minimum logging level
//     shuffle (true or false): start the jukebox in shuffle mode
//     shuffleButton (default = true): whether shuffle button appears or not in UI
//     loop (default = false): whether to return to first track after end of playlist
//     singleMode (default = false): whether to treat single track as playlist
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
  const tickMS = 27; // fast enough for numbers to look real-time
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
  this.initialized = false;
  this.uiDirty = true;
  this.playlist = new Gapless5FileList(options.shuffle);

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
  this.id = Math.floor((1 + Math.random()) * 0x10000);
  gapless5Players[this.id] = this;

  // There can be only one AudioContext per window, so to have multiple players we must define this outside the player scope
  if (window.gapless5AudioContext === undefined) {
    if (window.hasWebKit) {
      // eslint-disable-next-line new-cap
      window.gapless5AudioContext = new webkitAudioContext();
    } else if (typeof AudioContext !== 'undefined') {
      window.gapless5AudioContext = new AudioContext();
    }
  }
  this.context = window.gapless5AudioContext;
  this.gainNode = (this.context !== undefined) ? this.context.createGain() : null;
  if (this.context && this.gainNode) {
    this.gainNode.connect(this.context.destination);
  }

  // Callback and Execution logic
  this.isPlayButton = true;
  this.keyMappings = {};

  // Callbacks
  this.onprev = () => {};
  this.onplay = () => {};
  this.onpause = () => {};
  this.onstop = () => {};
  this.onnext = () => {};
  this.onshuffle = () => {};

  this.onerror = () => {};
  this.onload = () => {};
  this.onfinishedtrack = () => {};
  this.onfinishedall = () => {};

  // INTERNAL HELPERS
  const getUIPos = () => {
    const { isScrubbing, scrubPosition } = this;
    const position = isScrubbing ? scrubPosition : this.currentSource().getPosition();
    return (position / this.currentSource().getLength()) * scrubSize;
  };

  const getSoundPos = (uiPosition) => {
    return ((uiPosition / scrubSize) * this.currentSource().getLength());
  };

  // Index for calculating actual playlist location
  const index = (actualIndex = false) => {
    // FileList object must be initiated
    if (this.playlist !== null) {
      return this.playlist.getIndex(this.playlist.trackNumber, actualIndex);
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

  const getElement = (prefix) => {
    return document.getElementById(`${prefix}${this.id}`);
  };

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

  this.setGain = (uiPos) => {
    const normalized = uiPos / scrubSize;
    this.gainNode.gain.value = normalized;
    this.currentSource().setGain(normalized);
  };

  this.scrub = (uiPos, updateTransport = false) => {
    this.scrubPosition = getSoundPos(uiPos);
    if (this.hasGUI) {
      getElement('currentPosition').innerText = getFormattedTime(this.scrubPosition);
      enableButton('prev', this.loop || (index() !== 0 || this.scrubPosition !== 0));
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
    resetPosition();
    this.currentSource().stop(true);
    if (this.loop || index() < this.totalTracks() - 1) {
      if (this.singleMode) {
        this.prev(true);
      } else {
        this.next(true);
      }
      this.onfinishedtrack();
    } else {
      this.onfinishedtrack();
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

  this.getTracks = () => {
    return this.playlist.getTracks();
  };

  this.findTrack = (path) => {
    return this.playlist.findTrack(path);
  };

  this.removeTrack = (pointOrPath) => {
    const point = (typeof pointOrPath === 'string') ?
      this.findTrack(pointOrPath) :
      pointOrPath;

    if (point < 0 || point >= this.numTracks()) {
      return;
    }
    const deletedPlaying = point === this.playlist.trackNumber;

    const curSource = this.playlist.sources[point];
    if (!curSource) {
      return;
    }
    let wasPlaying = false;

    if (curSource.state === Gapless5State.Loading) {
      curSource.cancelRequest();
    } else if (curSource.state === Gapless5State.Play) {
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

  this.isShuffled = () => {
    return this.playlist.isShuffled();
  };

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

  this.currentSource = () => {
    return this.playlist.sources[index(true)];
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
    if (index() > 0) {
      track = index() - 1;
    } else if (this.loop) {
      track = this.totalTracks() - 1;
    } else {
      return;
    }
    this.gotoTrack(track);
    this.onprev();
  };

  this.prev = (e) => {
    if (this.totalTracks() === 0) {
      return;
    }
    let wantsCallback = true;
    let track = 0;
    if (this.currentSource().getPosition() > 0) {
      // jump to start of track if we're not there
      track = index();
      wantsCallback = false;
    } else if (this.singleMode && this.loop) {
      track = index();
    } else if (index() > 0) {
      track = index() - 1;
    } else if (this.loop) {
      track = this.totalTracks() - 1;
    } else {
      return;
    }
    this.gotoTrack(track, e === true);
    if (wantsCallback) {
      this.onprev();
    }
  };

  this.next = (e) => {
    if (this.totalTracks() === 0) {
      return;
    }
    let track = 0;
    if (this.singleMode) {
      track = index();
    } else if (index() < this.totalTracks() - 1) {
      track = index() + 1;
    } else if (!this.loop) {
      return;
    }
    this.gotoTrack(track, e === true, true);
    this.onnext();
  };

  this.play = () => {
    if (this.totalTracks() === 0) {
      return;
    }
    if (this.currentSource().audioFinished) {
      this.next(true);
    } else {
      this.currentSource().play();
    }
    if (this.exclusive) {
      const { id } = this;
      for (const otherId in gapless5Players) {
        if (otherId !== id.toString()) {
          gapless5Players[otherId].stop();
        }
      }
    }
    this.onplay();
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
      this.onpause();
    }
  };

  this.stop = () => {
    if (this.totalTracks() > 0) {
      resetPosition();
      this.currentSource().stop(true);
      this.onstop();
    }
  };


  // (PUBLIC) QUERIES AND CALLBACKS

  this.isPlaying = () => {
    return this.currentSource().inPlayState();
  };

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
  this.canShuffle = () => {
    return this.totalTracks() > 2;
  };

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
      enableButton('prev', this.loop || index() > 0 || this.currentSource().getPosition() > 0);
      enableButton('next', this.loop || index() < this.totalTracks() - 1);

      if (this.currentSource().inPlayState()) {
        enableButton('play', false);
        this.isPlayButton = false;
      } else {
        enableButton('play', true);
        this.isPlayButton = true;

        if (this.currentSource().state === Gapless5State.Error) {
          this.onerror();
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
    }, tickMS);
  };

  const createGUI = (playerHandle) => {
    const { id } = this;
    const playerWrapper = (html) => {
      return `
    <div class="g5position" id="g5position${id}">
      <span id="currentPosition${id}">00:00.00</span> |
      <span id="totalPosition${id}">${statusText.loading}</span> |
      <span id="trackIndex${id}">1</span>/<span id="tracks${id}">1</span>
    </div>
    <div class="g5inside" id="g5inside${id}">
      ${html}
    </div>
  `;
    };

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
      <input type="range" class="volume" name="gain" min="0" max="${scrubSize}"
        value="${scrubSize}" oninput="${playerHandle}.setGain(this.value);"
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
  }
}(this, (exports) => {
  exports.Gapless5 = Gapless5;
}));
