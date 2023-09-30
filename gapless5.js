/*
 *
 * Gapless 5: Gapless JavaScript/CSS audio player for HTML5
 *
 * Version 1.4.4
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
  Error    : 5,
};

const LogLevel = {
  Debug: 1, // show log.debug and up
  Info: 2, // show log.info and up
  Warning: 3, // show log.warn and up
  Error: 4, // show log.error and up
  None: 5, // show nothing
};

const CrossfadeShape = {
  None: 1, // plays both tracks at full volume
  Linear: 2,
  EqualPower: 3,
};

// A Gapless5Source "class" handles track-specific audio requests
function Gapless5Source(parentPlayer, parentLog, inAudioPath) {
  this.audioPath = inAudioPath;
  this.trackName = inAudioPath.replace(/^.*[\\/]/, '').split('.')[0];
  const player = parentPlayer;
  const log = parentLog;

  // HTML5 Audio
  let audio = null;

  // WebAudio
  let source = null;
  let buffer = null;
  let request = null;
  let gainNode = null;

  // states
  let lastTick = 0;
  let position = 0;
  let endpos = 0;
  let queuedState = Gapless5State.None;
  let state = Gapless5State.None;
  let seekablePercent = 0;
  let endedCallback = null;
  let volume = 1; // source-specific volume (for cross-fading)
  let crossfadeIn = 0;
  let crossfadeOut = 0;

  this.setCrossfade = (amountIn, amountOut, resetEndedCallback = true) => {
    crossfadeIn = amountIn;
    crossfadeOut = amountOut;
    if (endpos > 0) {
      const totalFade = crossfadeIn + crossfadeOut;
      if (totalFade > endpos) {
        log.warn(`Crossfade total exceeds duration (${totalFade} > ${endpos}), clamping for ${this.audioPath}`);
        crossfadeIn = Math.min(amountIn, endpos / 2);
        crossfadeOut = Math.min(amountOut, endpos / 2);
      }
    }
    if (resetEndedCallback) {
      setEndedCallbackTime((endpos - position) / 1000);
    }
  };

  this.calcFadeAmount = (percent) => {
    const clamped = Math.max(0, Math.min(1, percent));
    if (player.crossfadeShape === CrossfadeShape.Linear) {
      return 1 - clamped;
    }
    if (player.crossfadeShape === CrossfadeShape.EqualPower) {
      return 1 - Math.sqrt(clamped);
    }
    return 0;
  };

  this.getVolume = () => {
    volume = 1;
    const actualPos = position * player.playbackRate;
    const actualEnd = endpos * player.playbackRate;
    if (actualPos < crossfadeIn) {
      volume = volume - this.calcFadeAmount(actualPos / crossfadeIn);
    }
    const timeRemaining = actualEnd - actualPos;
    if (timeRemaining < crossfadeOut) {
      volume = volume - this.calcFadeAmount(timeRemaining / crossfadeOut);
    }
    return Math.min(1, Math.max(0, volume * player.volume));
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
    seekablePercent = 0;
    if (gainNode) {
      gainNode.disconnect();
      gainNode = null;
    }
    player.onunload(this.audioPath);
  };

  const onEnded = () => {
    if (state === Gapless5State.Play) {
      player.onEndedCallback();
    }
  };

  const parseError = (error) => {
    if (error) {
      if (error.message) {
        return error.message;
      }
      if (error.target && error.target.error && error.target.error.message) {
        return error.target.error.message;
      }
      return error;
    }
    return 'Error playing Gapless 5 audio';
  };

  const onError = (error) => {
    const message = parseError(error);
    log.error(message);
    this.unload(true);
    player.onerror(this.audioPath, message);
  };

  const isErrorStatus = (status) => status / 100 >= 4;

  const onLoadedWebAudio = (inBuffer) => {
    if (!request) {
      return;
    }
    request = null;
    buffer = inBuffer;
    endpos = inBuffer.duration * 1000;
    if (!gainNode) {
      gainNode = player.context.createGain();
      gainNode.connect(player.context.destination);
    }
    gainNode.gain.value = this.getVolume();

    if (queuedState === Gapless5State.Play && state === Gapless5State.Loading) {
      this.setCrossfade(crossfadeIn, crossfadeOut); // re-clamp, now that endpos is reset
      playAudioFile(true);
    } else if ((audio !== null) && (queuedState === Gapless5State.None) && this.inPlayState(true)) {
      log.debug(`Switching from HTML5 to WebAudio: ${this.audioPath}`);
      setState(Gapless5State.Stop);
      this.play(true);
    }
    if (state === Gapless5State.Loading) {
      state = Gapless5State.Stop;
    }
    player.onload(this.audioPath, true);
    player.playlist.updateLoading();
    player.uiDirty = true;
  };

  const onLoadedHTML5Audio = () => {
    if (state !== Gapless5State.Loading) {
      return;
    }
    state = Gapless5State.Stop;
    endpos = audio.duration * 1000;

    if (queuedState === Gapless5State.Play) {
      this.setCrossfade(crossfadeIn, crossfadeOut); // re-clamp, now that endpos is reset
      playAudioFile(true);
    }

    player.onload(this.audioPath, false);
    player.playlist.updateLoading();
    player.uiDirty = true;
  };

  this.stop = (resetPosition = false) => {
    if (state === Gapless5State.None) {
      return;
    }
    log.debug(`Stopping: ${this.audioPath}`);

    if (audio) {
      audio.pause();
    }
    if (source) {
      if (endedCallback) {
        window.clearTimeout(endedCallback);
        endedCallback = null;
      }
      source.stop(0);
      source.disconnect();
    }

    setState(Gapless5State.Stop);
    if (resetPosition) {
      this.setPosition(0);
      this.setCrossfade(0, 0, false);
    }
  };

  const setEndedCallbackTime = (restSecNormalized) => {
    if (endedCallback) {
      window.clearTimeout(endedCallback);
    }
    if (this.inPlayState(true)) {
      const restSec = Math.max(0, (restSecNormalized / player.playbackRate) - (crossfadeOut / 1000));

      // not using AudioBufferSourceNode.onended or 'ended' because:
      // a) neither will trigger when looped
      // b) AudioBufferSourceNode version triggers on stop() as well
      log.debug(`onEnded() will be called on ${this.audioPath} in ${restSec.toFixed(2)} sec`);
      endedCallback = window.setTimeout(onEnded, (restSec * 1000));
    }
  };

  const getStartOffsetMS = (syncPosition, syncLatencySec) => {
    if (syncPosition && audio) {
      // offset will fall behind by a tick, factor this in when syncing position
      return audio.currentTime ? ((audio.currentTime + syncLatencySec) * 1000) + player.avgTickMS : 0;
    }
    return position;
  };

  const playAudioFile = (syncPosition) => {
    if (this.inPlayState(true)) {
      return;
    }
    position = Math.max(position, 0);
    if (!Number.isFinite(position) || position >= this.getLength()) {
      position = 0;
    }
    const looped = player.isSingleLoop();

    if (buffer !== null) {
      setState(Gapless5State.Starting);
      player.context.resume().then(() => {
        if (state === Gapless5State.Starting) {
          gainNode.gain.value = this.getVolume();

          if (source) {
            // stop existing AudioBufferSourceNode
            source.stop();
            source.disconnect();
          }
          source = player.context.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = player.playbackRate;
          source.loop = looped;
          source.connect(gainNode);

          const offsetSec = getStartOffsetMS(syncPosition, player.context.baseLatency) / 1000;
          log.debug(`Playing WebAudio${looped ? ' (looped)' : ''}: ${this.audioPath} at ${offsetSec.toFixed(2)} sec`);
          source.start(0, offsetSec);
          setState(Gapless5State.Play);
          player.onplay(this.audioPath);
          setEndedCallbackTime(source.buffer.duration - offsetSec);
          if (audio) {
            audio.pause();
          }
        } else if (source) {
          // in case stop was requested while awaiting promise
          source.stop();
          source.disconnect();
        }
      });
    } else if (audio !== null) {
      const offsetSec = position / 1000;
      audio.currentTime = offsetSec;
      audio.volume = this.getVolume();
      audio.loop = looped;
      audio.playbackRate = player.playbackRate;

      setState(Gapless5State.Starting);
      audio.play().then(() => {
        if (state === Gapless5State.Starting) {
          log.debug(`Playing HTML5 Audio${looped ? ' (looped)' : ''}: ${this.audioPath} at ${offsetSec.toFixed(2)} sec`);
          setState(Gapless5State.Play);
          player.onplay(this.audioPath);
          setEndedCallbackTime(audio.duration - offsetSec);
        } else if (audio) {
          // in case stop was requested while awaiting promise
          audio.pause();
        }
      }).catch((e) => {
        if (e.name !== 'AbortError') {
          // Known HTML5 Audio issue on iOS Safari: user must interact separately for loading vs playing
          log.warn(`Failed to play ${this.audioPath}: ${e.message}`);
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

  this.play = (syncPosition) => {
    player.onPlayAllowed();
    if (state === Gapless5State.Loading) {
      log.debug(`Loading ${this.audioPath}`);
      queuedState = Gapless5State.Play;
    } else {
      playAudioFile(syncPosition); // play immediately
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

  this.tick = (updateLoopState) => {
    if (state === Gapless5State.Play) {
      const nextTick = new Date().getTime();
      const elapsed = nextTick - lastTick;
      position = position + (elapsed * player.playbackRate);
      lastTick = nextTick;
      if (updateLoopState) {
        const shouldLoop = player.isSingleLoop();
        if (source && source.loop !== shouldLoop) {
          source.loop = shouldLoop;
          log.debug(`Setting WebAudio loop to ${shouldLoop}`);
        }
        if (audio && audio.loop !== shouldLoop) {
          audio.loop = shouldLoop;
          log.debug(`Setting HTML5 audio loop to ${shouldLoop}`);
        }
      }
      if (audio !== null) {
        audio.volume = this.getVolume();
      }
      if (gainNode !== null) {
        const { currentTime } = window.gapless5AudioContext;
        // Ramping to prevent clicks
        // Not ramping for the whole fade because user can pause, set master volume, etc.
        gainNode.gain.linearRampToValueAtTime(this.getVolume(), currentTime + (player.tickMS / 1000));
      }
    }

    if (seekablePercent < 1) {
      const { Starting, Play, Stop } = Gapless5State;
      if (player.useWebAudio && [ Starting, Play, Stop ].includes(state)) {
        seekablePercent = 1;
      } else if (player.useHTML5Audio && audio !== null && audio.seekable.length > 0) {
        seekablePercent = audio.seekable.end(audio.seekable.length - 1) / audio.duration;
        if (!Number.isFinite(seekablePercent)) {
          seekablePercent = 0;
        }
      } else {
        seekablePercent = 0;
      }
    }
    return seekablePercent;
  };

  this.getSeekablePercent = () => seekablePercent;

  this.setPosition = (newPosition, bResetPlay) => {
    if (bResetPlay && this.inPlayState()) {
      this.stop();
      position = newPosition;
      this.play();
    } else {
      position = newPosition;
    }
  };

  const fetchBlob = (audioPath, loader) => {
    fetch(audioPath).then((r) => {
      if (r.ok) {
        r.blob().then((blob) => {
          loader(blob);
        });
      } else {
        onError(r.statusUI);
      }
    }).catch((e) => {
      onError(e);
    });
  };

  this.load = () => {
    if (state !== Gapless5State.None) {
      return;
    }
    const { audioPath } = this;
    player.onloadstart(audioPath);
    state = Gapless5State.Loading;
    if (player.useWebAudio) {
      const onLoadWebAudio = (data) => {
        if (data) {
          player.context.decodeAudioData(data).then(
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
            onError('Failed to load audio track');
          }
        };
        request.onloadend = () => {
          if (request && isErrorStatus(request.status)) {
            onError('Failed to load audio track');
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
function Gapless5FileList(parentPlayer, parentLog, inShuffle, inLoadLimit = -1, inTracks = [], inStartingTrack = 0) {
  const player = parentPlayer;
  const log = parentLog;

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

  this.setStartingTrack = (newStartingTrack) => {
    if (newStartingTrack === 'random') {
      this.startingTrack = Math.floor(Math.random() * this.sources.length);
    } else {
      this.startingTrack = newStartingTrack || 0;
    }
    log.debug(`Setting starting track to ${this.startingTrack}`);
    this.trackNumber = this.startingTrack;
  };

  this.currentSource = () => {
    if (this.numTracks() === 0) {
      return null;
    }
    const { source } = this.getSourceIndexed(this.trackNumber);
    return source;
  };

  this.isLastTrack = (index) => (index === this.sources.length - 1) && !player.loop && (player.queuedTrack === null);

  this.setCrossfade = (crossfadeIn, crossfadeOut) => {
    this.currentSource().setCrossfade(crossfadeIn, this.isLastTrack(this.trackNumber) ? 0 : crossfadeOut);
  };

  this.gotoTrack = (pointOrPath, forcePlay, allowOverride, crossfadeEnabled) => {
    const { index: prevIndex, source: prevSource } = this.getSourceIndexed(this.trackNumber);
    // TODO: why is this returning false when queuedState was Play?
    const wasPlaying = prevSource.isPlayActive(true);
    const requestedIndex = this.indexFromTrack(pointOrPath);
    this.stopAllTracks(true, crossfadeEnabled ? [ player.fadingTrack ] : []);

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

    this.trackNumber = allowOverride ? updateShuffle(requestedIndex) : requestedIndex;
    log.debug(`Setting track number to ${this.trackNumber}`);
    this.updateLoading();
    player.scrub(0, true);

    const { index: nextIndex, source: nextSource } = this.getSourceIndexed(this.trackNumber);

    if (prevIndex === nextIndex) {
      if (forcePlay || wasPlaying) {
        prevSource.stop();
        prevSource.play();
      }
      return this.trackNumber;
    }
    if (!crossfadeEnabled) {
      prevSource.stop(true);
    }
    if (forcePlay || wasPlaying) {
      const crossfadeIn = crossfadeEnabled ? player.crossfade : 0;
      const crossfadeOut = crossfadeEnabled && !this.isLastTrack(nextIndex) ? player.crossfade : 0;
      nextSource.setCrossfade(crossfadeIn, crossfadeOut);
      nextSource.play();
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
    log.debug(`Shuffled tracks: ${this.shuffledIndices}`);
    return nextIndex;
  };

  // Leaving shuffle mode.
  const disableShuffle = (nextIndex) => {
    this.shuffleMode = false;
    log.debug('Disabling shuffle');

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

  this.stopAllTracks = (resetPositions, excludedTracks = []) => {
    for (let i = 0; i < this.sources.length; i++) {
      if (!excludedTracks.includes(this.getPlaylistIndex(i))) {
        this.sources[i].stop(resetPositions);
      }
    }
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

  // returns tracks in play order (if shuffled, the shuffled order will be reflected here)
  this.getTracks = () => {
    const tracks = [];
    for (let i = 0; i < this.numTracks(); i++) {
      const { source } = this.getSourceIndexed(i);
      tracks.push(source.audioPath);
    }
    return tracks;
  };

  // if path, returns index in play order
  this.indexFromTrack = (pointOrPath) => (typeof pointOrPath === 'string') ?
    this.findTrack(pointOrPath) : pointOrPath;

  // returns index in play order
  this.findTrack = (path) => this.getTracks().indexOf(path);

  // returns source + index in play order
  this.getSourceIndexed = (index) => {
    const realIndex = this.shuffleMode ? this.shuffledIndices[index] : index;
    return { index: realIndex, source: this.sources[realIndex] };
  };

  this.getPlaylistIndex = (index) => this.shuffleMode ? this.shuffledIndices.indexOf(index) : index;

  // inclusive start, exclusive end
  const generateIntRange = (first, last) => Array.from({ length: (1 + last - first) }, (_v, k) => k + first);

  // returns set of actual indices (not shuffled)
  this.loadableTracks = () => {
    if (this.loadLimit === -1) {
      return new Set(generateIntRange(0, this.sources.length));
    }
    // loadable tracks are a range where size=loadLimit, centered around current track
    const startTrack = Math.round(Math.max(0, this.trackNumber - ((this.loadLimit - 1) / 2)));
    const endTrack = Math.round(Math.min(this.sources.length, this.trackNumber + (this.loadLimit / 2)));
    const loadableIndices = new Set(generateIntRange(startTrack, endTrack));
    if (player.queuedTrack !== null) {
      loadableIndices.add(this.indexFromTrack(player.queuedTrack));
    }
    if (player.fadingTrack !== null) {
      loadableIndices.add(this.indexFromTrack(player.fadingTrack));
    }
    log.debug(`Loadable indices: ${JSON.stringify([ ...loadableIndices ])}`);
    return loadableIndices;
  };

  this.updateLoading = () => {
    const loadableSet = this.loadableTracks();

    // make sure to load current track before surrounding tracks
    const curSourceIndex = this.getPlaylistIndex(this.trackNumber);
    const curSource = this.sources[curSourceIndex];
    if (loadableSet.has(curSourceIndex) && (curSource.getState() === Gapless5State.None)) {
      log.debug(`Loading track ${curSourceIndex}: ${curSource.audioPath}`);
      curSource.load();
    } else {
      for (const [ index, source ] of this.sources.entries()) {
        const playlistIndex = this.getPlaylistIndex(index);
        const shouldLoad = loadableSet.has(playlistIndex);
        const hasLoaded = source.getState() !== Gapless5State.None;
        if (shouldLoad !== hasLoaded) {
          if (shouldLoad) {
            log.debug(`Loading track ${playlistIndex}: ${source.audioPath}`);
            source.load();
          } else {
            source.unload();
            log.debug(`Unloaded track ${playlistIndex}: ${source.audioPath}`);
          }
        }
      }
    }
  };

  // Add a new song into the FileList object.
  this.add = (index, audioPath) => {
    const source = new Gapless5Source(player, log, audioPath);
    this.sources.splice(index, 0, source);

    // insert new index in random position
    this.shuffledIndices.splice(Math.floor(Math.random() * this.numTracks()), 0, this.numTracks() - 1);

    // Shift trackNumber if the insert file is earlier in the list
    if (index <= this.trackNumber || this.trackNumber === -1) {
      this.trackNumber = this.trackNumber + 1;
      if (this.trackNumber > 0) {
        log.debug(`Insertion shifted current track number to ${this.trackNumber}`);
      }
    }
    this.updateLoading();
  };

  // Remove a song from the FileList object.
  this.remove = (index) => {
    this.sources.splice(index, 1);
    this.shuffledIndices.splice(this.shuffledIndices.indexOf(index), 1);
    for (let i = 0; i < this.shuffledIndices.length; i++) {
      if (this.shuffledIndices[i] >= index) {
        this.shuffledIndices[i] = this.shuffledIndices[i] - 1;
      }
    }

    // Stay at the same song index, unless trackNumber is after the
    // removed index, or was removed at the edge of the list
    if (this.trackNumber > 0 &&
      ((index < this.trackNumber) || (index >= this.numTracks() - 2))) {
      this.trackNumber = this.trackNumber - 1;
      log.debug(`Decrementing track number to ${this.trackNumber}`);
    }
    if (this.isShuffled && !player.canShuffle()) {
      this.setShuffle(false);
      player.uiDirty = true;
    }
    this.updateLoading();
  };

  // process inputs from constructor
  if (inTracks.length > 0) {
    for (let i = 0; i < inTracks.length; i++) {
      this.sources.push(new Gapless5Source(player, log, inTracks[i]));
      this.shuffledIndices.splice(Math.floor(Math.random() * this.numTracks()), 0, this.numTracks() - 1);
    }
    this.setStartingTrack(inStartingTrack);
    this.updateLoading();
  }
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
  const statusUI = {
    loading:  'loading\u2026',
    error: 'error!',
    percent: 0,
  };
  this.hasGUI = false;
  this.scrubWidth = 0;
  this.scrubPosition = 0;
  this.isScrubbing = false;

  // System
  let tickCallback = null;
  this.tickMS = 27; // fast enough for numbers to look real-time
  this.avgTickMS = this.tickMS;
  this.initialized = false;
  this.uiDirty = true;
  const log = {
    debug: () => {},
    log: () => {},
    warn: () => {},
    error: () => {},
  };
  switch (options.logLevel || LogLevel.Info) {
  /* eslint-disable no-fallthrough */
  case LogLevel.Debug:
    log.debug = console.debug;
  case LogLevel.Info:
    log.info = console.info;
  case LogLevel.Warning:
    log.warn = console.warn;
  case LogLevel.Error:
    log.error = console.error;
  case LogLevel.None:
  default:
    break;
  /* eslint-enable no-fallthrough */
  }
  this.playlist = null;
  this.loop = options.loop || false;
  this.singleMode = options.singleMode || false;
  this.exclusive = options.exclusive || false;
  this.queuedTrack = null;
  this.fadingTrack = null;
  this.volume = options.volume !== undefined ? options.volume : 1.0;
  this.crossfade = options.crossfade || 0;
  this.crossfadeShape = options.crossfadeShape || CrossfadeShape.None;

  // This is a hack to activate WebAudio on certain iOS versions
  const silenceWavData = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  let playAllowed = false; // true after user initiates action
  const stubAudio = new Audio();
  stubAudio.controls = false;
  stubAudio.loop = true;
  stubAudio.src = silenceWavData;
  stubAudio.load();
  this.onPlayAllowed = () => {
    if (!playAllowed) {
      playAllowed = true;
      stubAudio.play().then(() => {
        stubAudio.pause();
      });
    }
  };

  // these default to true if not defined
  this.useWebAudio = options.useWebAudio !== false;
  this.useHTML5Audio = options.useHTML5Audio !== false;
  this.playbackRate = options.playbackRate || 1.0;
  this.id = options.guiId || Math.floor((1 + Math.random()) * 0x10000);
  gapless5Players[this.id] = this;

  // There can be only one AudioContext per window, so to have multiple players we must define this outside the player scope
  if (window.gapless5AudioContext === undefined) {
    const MaybeContext = window.AudioContext || window.webkitAudioContext;
    if (MaybeContext) {
      window.gapless5AudioContext = new MaybeContext();
    }
  }
  this.context = window.gapless5AudioContext;

  // Callback and Execution logic
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
    if (!this.currentSource() || !this.currentLength()) {
      return 0;
    }
    const { isScrubbing, scrubPosition } = this;
    const position = isScrubbing ? scrubPosition : this.currentPosition();
    return (position / this.currentLength()) * scrubSize;
  };

  const getSoundPos = (uiPosition) => ((uiPosition / scrubSize) * this.currentLength());

  // Current index (if sourceIndex = true and shuffle is on, value will be different)
  this.getIndex = (sourceIndex = false) => {
    // FileList object must be initiated
    if (this.playlist !== null) {
      const { trackNumber } = this.playlist;
      return sourceIndex ? this.playlist.getSourceIndexed(trackNumber).index : trackNumber;
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
    let text = statusUI.loading;
    if (this.totalTracks() === 0) {
      return text;
    }
    const srcLength = this.currentLength();
    if (this.currentSource() && this.currentSource().state === Gapless5State.Error) {
      text = statusUI.error;
    } else if (srcLength > 0) {
      text = getFormattedTime(srcLength);
    }
    return text;
  };

  const getTrackName = () => {
    const source = this.currentSource();
    return source ? source.trackName : '';
  };

  const getElement = (prefix) => document.getElementById(`g5${prefix}-${this.id}`);

  const setElementText = (prefix, text) => {
    const element = getElement(prefix);
    if (element) {
      element.innerText = text;
    }
  };

  const isValidIndex = (index) => index >= 0 && index < this.playlist.numTracks();

  // (PUBLIC) ACTIONS
  this.totalTracks = () => {
    // FileList object must be initiated
    if (this.playlist !== null) {
      return this.playlist.numTracks();
    }
    return 0;
  };

  this.isSingleLoop = () => this.loop && (this.singleMode || this.totalTracks() === 1);

  this.mapKeys = (keyOptions) => {
    for (const key in keyOptions) {
      const uppercode = keyOptions[key].toUpperCase().charCodeAt(0);
      const lowercode = keyOptions[key].toLowerCase().charCodeAt(0);
      const player = gapless5Players[this.id];
      if (Gapless5.prototype.hasOwnProperty.call(player, key)) {
        this.keyMappings[uppercode] = player[key];
        this.keyMappings[lowercode] = player[key];
      } else {
        log.error(`Gapless5 mapKeys() error: no function named '${key}'`);
      }
    }
    document.addEventListener('keydown', (e) => {
      const keyCode = e.key.charCodeAt(0);
      if (keyCode in this.keyMappings) {
        this.keyMappings[keyCode](e);
      }
    });
  };

  this.getPosition = () => {
    if (this.currentSource()) {
      return this.currentSource().getPosition();
    }
    return 0;
  };

  this.setPosition = (position) => {
    if (this.currentSource()) {
      this.currentSource().setPosition(position, true);
    }
  };

  // volume is normalized between 0 and 1
  this.setVolume = (volume) => {
    this.volume = volume;
    if (this.hasGUI) {
      getElement('volume').value = scrubSize * volume;
    }
  };

  this.setGain = (uiPos) => {
    log.warn('Using deprecated API.  Use setVolume() with value between 0 and 1 instead.');
    this.setVolume(uiPos / scrubSize);
  };

  this.scrub = (uiPos, updateTransport = false) => {
    if (this.hasGUI) {
      this.scrubPosition = getSoundPos(uiPos);
      setElementText('position', getFormattedTime(this.scrubPosition));
      enableButton('prev', this.loop || (this.getIndex() !== 0 || this.scrubPosition !== 0));
      if (updateTransport) {
        getElement('transportbar').value = uiPos;
      }
      if (!this.isScrubbing && this.currentSource()) {
        this.currentSource().setPosition(this.scrubPosition);
      }
    }
  };

  this.setLoadedSpan = (percent) => {
    if (this.hasGUI && statusUI.percent !== percent) {
      statusUI.percent = percent;
      getElement('loadedspan').style.width = percent * this.scrubWidth;
      if (percent === 1) {
        setElementText('duration', getTotalPositionText());
      }
    }
  };

  this.getSeekablePercent = () => {
    const source = this.currentSource();
    return source ? source.getSeekablePercent() : 0;
  };

  this.onEndedCallback = () => {
    // we've finished playing the track
    let finishedAll = false;
    const source = this.currentSource();
    if (source) {
      const { audioPath } = source;
      if (this.queuedTrack !== null) {
        this.gotoTrack(this.queuedTrack);
        this.queuedTrack = null;
      } else if (this.loop || this.getIndex() < this.totalTracks() - 1) {
        if (this.singleMode || this.totalTracks() === 1) {
          if (this.loop) {
            this.prev(null, false);
          }
        } else {
          const tryStopFadingTrack = () => {
            const fadingSource = getFadingSource();
            if (fadingSource) {
              fadingSource.stop(true);
            }
            this.fadingTrack = null;
          };
          this.fadingTrack = this.getIndex();
          window.setTimeout(() => {
            tryStopFadingTrack();
          }, this.crossfade);
          this.next(null, true, true);
        }
      } else {
        source.stop(true);
        this.scrub(0, true);
        finishedAll = true;
      }
      this.onfinishedtrack(audioPath);
    }
    if (finishedAll) {
      this.onfinishedall();
    }
  };

  this.onStartedScrubbing = () => {
    this.isScrubbing = true;
  };

  this.onFinishedScrubbing = () => {
    this.isScrubbing = false;
    const source = this.currentSource();
    if (source) {
      if (source.inPlayState() && this.scrubPosition >= this.currentLength()) {
        this.next(null, true);
      } else {
        source.setPosition(this.scrubPosition, true);
      }
    }
  };

  this.addTrack = (audioPath) => {
    const nextTrack = this.playlist.numTracks();
    this.playlist.add(nextTrack, audioPath);
    this.uiDirty = true;
  };

  this.insertTrack = (point, audioPath) => {
    const numTracks = this.totalTracks();
    const safePoint = Math.min(Math.max(point, 0), numTracks);
    if (safePoint === numTracks) {
      this.addTrack(audioPath);
    } else {
      this.playlist.add(safePoint, audioPath);
    }
    this.uiDirty = true;
  };

  this.getTracks = () => this.playlist.getTracks();

  this.getTrack = () => this.currentSource() ? this.currentSource().audioPath : None;

  this.findTrack = (path) => this.playlist.findTrack(path);

  this.removeTrack = (pointOrPath) => {
    const point = this.playlist.indexFromTrack(pointOrPath);
    if (!isValidIndex(point)) {
      log.warn(`Cannot remove missing track: ${pointOrPath}`);
      return;
    }
    const deletedPlaying = point === this.playlist.trackNumber;

    const { source: curSource } = this.playlist.getSourceIndexed(point);
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

  this.currentSource = () => this.playlist ? this.playlist.currentSource() : null;
  this.currentLength = () => this.currentSource() ? this.currentSource().getLength() : 0;
  this.currentPosition = () => this.currentSource() ? this.currentSource().getPosition() : 0;

  this.setPlaybackRate = (rate) => {
    tick(); // tick once here before changing the playback rate, to maintain correct position
    this.playbackRate = rate;
    this.playlist.setPlaybackRate(rate);
  };

  this.setCrossfade = (duration) => {
    this.crossfade = duration;
    if (this.isPlaying()) {
      const totalCrossfade = this.crossfade;
      this.playlist.setCrossfade(totalCrossfade, totalCrossfade);
    }
  };

  this.setCrossfadeShape = (shape) => {
    this.crossfadeShape = shape;
  };

  this.queueTrack = (pointOrPath) => {
    if (!isValidIndex(this.playlist.indexFromTrack(pointOrPath))) {
      log.error(`Cannot queue missing track: ${pointOrPath}`);
    } else {
      this.queuedTrack = pointOrPath;
      this.playlist.updateLoading();
    }
  };

  this.gotoTrack = (pointOrPath, forcePlay, allowOverride = false, crossfadeEnabled = false) => {
    if (!isValidIndex(this.playlist.indexFromTrack(pointOrPath))) {
      log.error(`Cannot go to missing track: ${pointOrPath}`);
    } else {
      const newIndex = this.playlist.gotoTrack(pointOrPath, forcePlay, allowOverride, crossfadeEnabled);
      enableButton('prev', this.loop || (!this.singleMode && newIndex > 0));
      enableButton('next', this.loop || (!this.singleMode && newIndex < this.totalTracks() - 1));
      this.uiDirty = true;
    }
  };

  this.prevtrack = () => {
    const currentSource = this.currentSource();
    if (!currentSource) {
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
    this.gotoTrack(track);
    const newSource = this.currentSource();
    this.onprev(currentSource.audioPath, newSource.audioPath);
  };

  this.prev = (uiEvent, forceReset) => {
    const currentSource = this.currentSource();
    if (!currentSource) {
      return;
    }
    let wantsCallback = true;
    let track = 0;
    let playlistIndex = this.getIndex();
    const position = currentSource.getPosition();
    if (position > 0) {
      // jump to start of track if we're not there
      this.scrub(0, true);
      currentSource.setPosition(0, forceReset || Boolean(uiEvent));
      this.playlist.setCrossfade(0, this.crossfade);
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

    if (wantsCallback) {
      this.gotoTrack(track, forceReset, true);
      const newSource = this.currentSource();
      this.onprev(currentSource.audioPath, newSource.audioPath);
    }
  };

  this.next = (_uiEvent, forcePlay, crossfadeEnabled) => {
    const currentSource = this.currentSource();
    if (!currentSource) {
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
    this.gotoTrack(track, forcePlay, true, crossfadeEnabled);
    const newSource = this.currentSource();
    this.onnext(currentSource.audioPath, newSource.audioPath);
  };

  this.play = () => {
    const source = this.currentSource();
    if (!source) {
      return;
    }
    this.playlist.setCrossfade(0, this.crossfade);
    source.play();
    if (this.exclusive) {
      const { id } = this;
      for (const otherId in gapless5Players) {
        if (otherId !== id.toString()) {
          gapless5Players[otherId].stop();
        }
      }
    }
    this.onplayrequest(source.audioPath);
  };

  this.playpause = () => {
    const source = this.currentSource();
    if (source && source.inPlayState(true)) {
      this.pause();
    } else {
      this.play();
    }
  };

  this.cue = () => {
    if (this.currentPosition() > 0) {
      this.prev(null, true);
    }
    this.play();
  };

  this.pause = () => {
    const source = this.currentSource();
    this.playlist.stopAllTracks();
    if (source) {
      this.onpause(source.audioPath);
    }
  };

  this.stop = () => {
    const source = this.currentSource();
    const lastPosition = source ? source.getPosition() : 0;
    this.playlist.stopAllTracks(true);
    if (source) {
      if (lastPosition > 0) {
        this.scrub(0, true);
      }
      this.onstop(source.audioPath);
    }
  };


  // (PUBLIC) QUERIES AND CALLBACKS

  this.isPlaying = () => this.currentSource() && this.currentSource().inPlayState() || false;

  // INIT AND UI

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
    const numTracks = this.totalTracks();
    if (numTracks === 0) {
      setElementText('index', '0');
      setElementText('numtracks', '0');
      setElementText('trackname', '');
      setElementText('position', getFormattedTime(0));
      setElementText('duration', getFormattedTime(0));
      enableButton('prev', false);
      enableShuffleButton('shuffle', false);
      enableButton('next', false);
    } else {
      setElementText('index', this.playlist.trackNumber + 1);
      setElementText('numtracks', numTracks);
      setElementText('trackname', getTrackName());
      setElementText('duration', getTotalPositionText());
      enableButton('prev', this.loop || this.getIndex() > 0 || this.currentPosition() > 0);
      enableButton('next', this.loop || this.getIndex() < numTracks - 1);

      const source = this.currentSource();
      if (source && source.inPlayState(true)) {
        enableButton('play', false);
      } else {
        enableButton('play', true);

        if (source && source.state === Gapless5State.Error) {
          this.onerror(source.audioPath);
        }
      }
      enableShuffleButton(this.isShuffled() ? 'unshuffle' : 'shuffle', this.canShuffle());
    }
  };

  const getFadingSource = () => {
    if (this.fadingTrack !== null) {
      const { source: fadingSource } = this.playlist.getSourceIndexed(this.fadingTrack);
      return fadingSource;
    }
    return null;
  };

  let lastTick = -1;
  const tick = () => {
    // JS tick latency is variable, maintain rolling average of past ticks
    const curTick = Date.now();
    if (lastTick >= 0) {
      const elapsedMS = curTick - lastTick;
      this.avgTickMS = (this.avgTickMS * 0.9) + (elapsedMS * 0.1);
    }
    lastTick = curTick;
    const fadingSource = getFadingSource();
    if (fadingSource) {
      fadingSource.tick(false);
    }
    const source = this.currentSource();
    if (source) {
      const loadedSpan = source.tick(true);
      this.setLoadedSpan(loadedSpan);
      if (this.uiDirty) {
        this.uiDirty = false;
        updateDisplay();
      }
      if (source.inPlayState()) {
        let soundPos = source.getPosition();
        if (this.isScrubbing) {
          // playing track, update bar position
          soundPos = this.scrubPosition;
        }
        if (this.hasGUI) {
          getElement('transportbar').value = getUIPos();
          setElementText('position', getFormattedTime(soundPos));
        }
      }
    }
    if (tickCallback) {
      window.clearTimeout(tickCallback);
    }
    tickCallback = window.setTimeout(tick, this.tickMS);
  };

  const createGUI = (playerHandle) => {
    const { id } = this;
    const elemId = (name) => `g5${name}-${id}`;
    const playerWrapper = (html) => `
    <div class="g5positionbar" id="${elemId('positionbar')}">
      <span id="${elemId('position')}">${getFormattedTime(0)}</span> |
      <span id="${elemId('duration')}">${statusUI.loading}</span> |
      <span id="${elemId('index')}">1</span>/<span id="${elemId('numtracks')}">1</span>
    </div>
    <div class="g5inside" id="${elemId('inside')}">
      ${html}
    </div>
  `;

    if (typeof Audio === 'undefined') {
      this.hasGUI = false;
      return playerWrapper('This player is not supported by your browser.');
    }

    return playerWrapper(`
    <div class="g5transport">
      <div class="g5meter" id="${elemId('meter')}"><span id="${elemId('loadedspan')}" style="width: 0%"></span></div>
      <input type="range" class="transportbar" name="transportbar" id="${elemId('transportbar')}"
        min="0" max="${scrubSize}" value="0" oninput="${playerHandle}.scrub(this.value);"
        onmousedown="${playerHandle}.onStartedScrubbing();" ontouchstart="${playerHandle}.onStartedScrubbing();"
        onmouseup="${playerHandle}.onFinishedScrubbing();" ontouchend="${playerHandle}.onFinishedScrubbing();"
      />
    </div>
    <div class="g5buttons" id="${elemId('buttons')}">
      <button class="g5button g5prev" id="${elemId('prev')}"></button>
      <button class="g5button g5play" id="${elemId('play')}"></button>
      <button class="g5button g5stop" id="${elemId('stop')}"></button>
      <button class="g5button g5shuffle" id="${elemId('shuffle')}"></button>
      <button class="g5button g5next" id="${elemId('next')}"></button>
      <input type="range" id="${elemId('volume')}" class="volume" name="gain" min="0" max="${scrubSize}"
        value="${scrubSize}" oninput="${playerHandle}.setVolume(this.value / ${scrubSize});"
      />
    </div>
  `);
  };

  const guiElement = options.guiId ? document.getElementById(options.guiId) : null;
  if (guiElement) {
    this.hasGUI = true;
    guiElement.insertAdjacentHTML('beforeend', createGUI(`gapless5Players['${this.id}']`));

    const onMouseDown = (elementId, cb) => {
      const elem = getElement(elementId);
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
    setElementText('position', getFormattedTime(0));

    // set up whether shuffleButton appears or not (default is visible)
    if (options.shuffleButton === false) {
      // Style items per earlier Gapless versions
      const setElementWidth = (elementId, width) => {
        const elem = getElement(elementId);
        if (elem) {
          elem.style.width = width;
        }
      };

      const transSize = '111px';
      const playSize = '115px';
      setElementWidth('transportbar', transSize);
      setElementWidth('meter', transSize);
      setElementWidth('positionbar', playSize);
      setElementWidth('inside', playSize);
      getElement('shuffle').remove();
    }
    this.scrubWidth = getElement('transportbar').style.width;
  }

  if (typeof Audio === 'undefined') {
    log.error('This player is not supported by your browser.');
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
        startingTrack = this.startingTrack || 0;
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
    this.playlist = new Gapless5FileList(this, log, options.shuffle, options.loadLimit, items, startingTrack);
  } else {
    this.playlist = new Gapless5FileList(this, log, options.shuffle, options.loadLimit);
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
    global.CrossfadeShape = mod.exports.CrossfadeShape;
  }
}(this, (exports) => {
  exports.Gapless5 = Gapless5;
  exports.LogLevel = LogLevel;
  exports.CrossfadeShape = CrossfadeShape;
}));
