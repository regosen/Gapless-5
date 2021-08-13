////////////
//
// Gapless 5: Gapless JavaScript/CSS audio player for HTML5
// (requires jQuery 1.x or greater)
//
// Version 0.7.0
// Copyright 2014 Rego Sen
//
//////////////

// PROBLEM: We have 2 APIs for playing audio through the web, and both of them have problems:
//  - HTML5 Audio: the last chunk of audio gets cut off, making gapless transitions impossible
//  - WebAudio: can't play a file until it's fully loaded
// SOLUTION: Use both!
// If WebAudio hasn't loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.

window.hasWebKit = ('webkitAudioContext' in window) && !('chrome' in window);

// There can be only one AudioContext per window, so to have multiple players we must define this outside the player scope
const gapless5AudioContext = (window.hasWebKit) ? new webkitAudioContext() : (typeof AudioContext !== "undefined") ? new AudioContext() : null;

const gapless5Players = {};
const Gapless5State = {
  "None"     : 0,
  "Loading"  : 1,
  "Play"     : 2,
  "Stop"     : 3,
  "Error"    : 4
  };

// A Gapless5Source "class" handles track-specific audio requests
function Gapless5Source(parentPlayer, inContext, inOutputNode) {

  // WebAudio API
  const context = inContext;
  const outputNode = inOutputNode;

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
  let audioFinished = false;
  let endedCallback = null;

  // request manager info
  let initMS = new Date().getTime();

  this.uiDirty = false;
  const parent = parentPlayer;

  this.setGain = (val) => {
    if (audio !== null) {
      audio.volume = val;
    }
  }

  this.getState = () => state;

  const setState = (newState) => {
    state = newState;
    queuedState = Gapless5State.None;
  };

  this.finished = () => audioFinished;

  this.timer = () => (new Date().getTime()) - initMS;

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
  }

  const onEnded = () =>{
    if (state === Gapless5State.Play) {
      audioFinished = true;
      parent.onEndedCallback();
    }
  }

  const onPlayEvent = () => {
    startTime = (new Date().getTime()) - position;
  }

  const onError = () => {
    this.cancelRequest(true);
  }

  const onLoadedWebAudio = (inBuffer) => {
    if (!request) return;
    request = null;
    buffer = inBuffer;
    endpos = inBuffer.duration * 1000;
    if (audio !== null || !parent.useHTML5Audio) {
      parent.dequeueNextLoad();
    }

    if (queuedState === Gapless5State.Play && state === Gapless5State.Loading) {
      playAudioFile(true);
    } else if ((audio !== null) && (queuedState === Gapless5State.None) && (state === Gapless5State.Play)) {
      //console.log("switching from HTML5 to WebAudio");
      position = new Date().getTime() - startTime;
      if (!window.hasWebKit) {
        position = position - this.tickMS;
      }
      this.setPosition(position, true);
    }
    if (state === Gapless5State.Loading) {
      state = Gapless5State.Stop;
    }
    // once we have WebAudio data loaded, we don't need the HTML5 audio stream anymore
    audio = null;
    this.uiDirty = true;
  }

  const onLoadedHTML5Audio = () => {
    if (state !== Gapless5State.Loading) return;

    if (buffer !== null || !parent.useWebAudio) {
      parent.dequeueNextLoad();
    }

    state = Gapless5State.Stop;
    endpos = audio.duration * 1000;

    if (queuedState === Gapless5State.Play) {
      playAudioFile(true);
    }
    this.uiDirty = true;
  }

  this.stop = () => {
    if (state === Gapless5State.Stop) return;
    
    if (parent.useWebAudio) {
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
    this.uiDirty = true;
  };

  const playAudioFile = () => {
    if (state === Gapless5State.Play) return;
    position = Math.max(position, 0);
    if (!Number.isFinite(position) || position >= endpos) position = 0;

    const offsetSec = position / 1000;
    startTime = (new Date().getTime()) - position;

    if (buffer !== null) {
      //console.log("playing WebAudio");
      gapless5AudioContext.resume();
      source = context.createBufferSource();
      source.connect(outputNode);
      source.buffer = buffer;

      const restSec = source.buffer.duration - offsetSec;
      if (endedCallback) {
        window.clearTimeout(endedCallback);
      }
      endedCallback = window.setTimeout(onEnded, restSec * 1000);
      if (window.hasWebKit)
        source.start(0, offsetSec, restSec);
      else
        source.start(0, offsetSec);
      setState(Gapless5State.Play);
    }
    else if (audio !== null) {
      //console.log("playing HTML5 Audio");
      audio.currentTime = offsetSec;
      audio.volume = outputNode.gain.value;
      audio.play();
      setState(Gapless5State.Play);
    }
    this.uiDirty = true;
  };

  // PUBLIC FUNCTIONS

  this.inPlayState = () => (state === Gapless5State.Play); 

  this.isPlayActive = () => (this.inPlayState() || queuedState === Gapless5State.Play) && !this.audioFinished; 

  this.getPosition = () => position;

  this.getLength = () => endpos;

  this.play = () => {
    if (state === Gapless5State.Loading) {
      queuedState = Gapless5State.Play;
    } else {
      playAudioFile(); // play immediately
    }
  }

  this.tick = () => {
    if (state === Gapless5State.Play) {
      position = (new Date().getTime()) - startTime;
    }

    if (loadedPercent < 1) {
      const newPercent = (state === Gapless5State.Loading) ? 0 : (audio && audio.seekable.length > 0) ? (audio.seekable.end(0) / audio.duration) : 1;
      if (loadedPercent !== newPercent) {
        loadedPercent = newPercent;
        parent.setLoadedSpan(loadedPercent)
      }
    }
  }

  this.setPosition = (newPosition, bResetPlay) => {
    position = newPosition;
    if (bResetPlay && this.inPlayState()) {
      this.stop();
      this.play();
    }
  };

  this.load = (inAudioPath) => {
    if (source || audio) {
      parent.dequeueNextLoad();
      return;
    }
    if (state === Gapless5State.Loading) {
      return;
    }
    state = Gapless5State.Loading;
    if (parent.useWebAudio) {
      const onLoadWebAudio = (data) => {
        if (data) {
          context.decodeAudioData(data,
            (incomingBuffer) => {
              onLoadedWebAudio(incomingBuffer);
            }
          );
        }
      };
      if (inAudioPath.startsWith("blob:")) {
        fetch(inAudioPath).then(r => {
          r.blob().then(blob => {
            request = new FileReader();
            request.onload = () => { if (request) onLoadWebAudio(request.result); };
            request.readAsArrayBuffer(blob);
            if (request.error) {
              onError();
            }
          });
        });
      } else {
        request = new XMLHttpRequest();
        request.open('get', inAudioPath, true);
        request.responseType = 'arraybuffer';
        request.onload = () => { if (request) onLoadWebAudio(request.response); };
        request.onerror = () => { if (request) onError(); };
        request.send();
      }
    }
    if (parent.useHTML5Audio) {
      const getHtml5Audio = () => {
        const audioObj = new Audio();
        audioObj.controls = false;
        audioObj.addEventListener('canplaythrough', onLoadedHTML5Audio, false);
        audioObj.addEventListener('ended', onEnded, false);
        audioObj.addEventListener('play', onPlayEvent, false);
        audioObj.addEventListener('error', onError, false);
        // TODO: switch to audio.networkState, now that it's universally supported
        return audioObj;
      }
      if (inAudioPath.startsWith("blob:")) {
        // TODO: blob as srcObject is not supported on all browsers
        fetch(inAudioPath).then(r => {
          r.blob().then(blob => {
            audio = getHtml5Audio();
            audio.srcObject = blob;
            audio.load();
          });
        });
      } else {
        audio = getHtml5Audio();
        audio.src = inAudioPath;
        audio.load();
      }
    }
    // cancel if url doesn't exist, but don't download again
    const { cancelRequest } = this;
    $.ajax({
      url: inAudioPath,
      type: "HEAD",
    }).fail(() => { 
      cancelRequest(true);
    });
  }
}

// A Gapless5FileList "class". Processes an array of JSON song objects, taking 
// the "file" members out to constitute the this.sources[] in the Gapless5 player
const Gapless5FileList = function(inPlayList, inStartingTrack, inShuffle) {

  // OBJECT STATE
  // Playlist and Track Items
  this.original = inPlayList;  // Starting JSON input
  this.previous = [];    // Support double-toggle undo
  this.current = [];    // Working playlist
  this.previousItem = 0;    // To last list and last index

  if (inStartingTrack === "random") {
    this.startingTrack = Math.floor(Math.random() * this.original.length);
  } else {
    this.startingTrack = inStartingTrack || 0;
  }

  this.currentItem = this.startingTrack;
  this.trackNumber = this.startingTrack;  // Displayed track index in GUI

  // If the tracklist ordering changes, after a pre/next song,
  // the playlist needs to be regenerated
  this.shuffleMode = !!inShuffle;  // Ordered (false) or Shuffle (true)
  this.remakeList = false;         // Will need to re-order list upon track changing

  // PRIVATE METHODS
  // Clone an object so it's not passed by reference
  // Works for objects that have no clever circular references
  // or complex types. It's a "flash serialize".
  const clone = (input) => { 
    return JSON.parse(JSON.stringify(input));
  }

  // Swap two elements in an array
  const swapElements = (someList, sourceIndex, destIndex) => { 
    const tmp = someList[sourceIndex];
    someList[sourceIndex] = someList[destIndex];
    someList[destIndex] = tmp;
  }

  // Reorder an array so that the outputList starts at the desiredIndex
  // of the inputList.
  const reorderedCopy = (inputList, desiredIndex) => {
    const tempList = clone(inputList);
    return tempList.concat(tempList.splice(0, desiredIndex));
  }

  // Shuffle a playlist, making sure that the next track in the list
  // won't be the same as the current track being played.
  const shuffledCopy = (inputList, index) => {
    let outputList = clone(inputList);

    // Shuffle the list
    for ( let n = 0; n < outputList.length - 1; n++ ) {
      const k = n + Math.floor(Math.random() * (outputList.length - n ));
      swapElements(outputList, k, n);
    }

    if (index !== -1) {
      // Reorder playlist array so that the chosen index comes first, 
      // and gotoTrack isn't needed after Player object is remade.
      outputList = reorderedCopy(outputList, index);

      // After shuffling, move the current-playing track to the 0th
      // place in the index. So regardless of the next move, this track
      // will be appropriately far away in the list
      const swapIndex = this.lastIndex(index, this.current, outputList);
      if ( swapIndex !== 0 ) {
        swapElements(outputList, swapIndex, 0);
      }
    }

    // If the list of indexes in the new list is the same as the last,
    // do a reshuffle. TOWRITE
    return outputList;
  }

  // Already pressed the shuffle button once from normal mode.
  // Revert to previous list / item, and terminate.
  const revertShuffle = () => {
    this.current = this.previous;
    this.currentItem = this.previousItem;

    this.shuffleMode = !this.shuffleMode;
    this.remakeList = false;
  }

  // Going into shuffle mode. Tell the Player to remake the list
  // as soon as a new track is reached or chosen. 
  const enableShuffle = (preserveCurrent = true) => {
    // Save old state in case we need to revert
    this.previous = clone(this.current);
    this.previousItem = this.currentItem;

    this.current = shuffledCopy(this.original, preserveCurrent ? this.currentItem : -1);
    this.currentItem = 0;
  
    this.shuffleMode = true;
    this.remakeList = true;
  }

  // Leaving shuffle mode. Tell the Player to remake the list
  // as soon as a new track is reached or chosen. 
  const disableShuffle = () => {
    // Save old state in case we need to revert
    this.previous = clone(this.current);
    this.previousItem = this.currentItem;

    // Find where current song is in original playlist, and make that
    // the head of the new unshuffled playlist
    const point = this.lastIndex(this.currentItem, this.current, this.original);
    this.current = reorderedCopy(this.original, point);

    this.currentItem = 0;  // Position to head of list
    this.shuffleMode = false;
    this.remakeList = true;
  }

  // Add a song to a single member of the FileList object, adjusting
  // each FileList entry's _index value as necessary.
  const addFile = (point, file, list, listShuffled) => {
    const addin = {};
    addin._index = point + 1;
    addin.file = file;

    // Prior to insertion, recalculate _index on all shifted values. 
    // All indexes that shifted up should be added by one.
    for ( let i = 0; i < list.length; i++ )
      if ( list[i]._index >= addin._index ) 
        list[i]._index = list[i]._index + 1;

    // If shuffle mode, new index should be array size so
    // unshuffled mode puts it at the back of the array.
    if (listShuffled)
      list.push(addin);
    else
      list.splice(point, 0, addin);
  }

  // Remove a song from a single member of the FileList object,
  // adjusting each FileList entry's _index value as necessary.
  const removeFile = (point, list, listShuffled) => {
    if (listShuffled) {
      for ( let j = 0 ; j < list.length ; j++ )
        if ( list[j]._index === point + 1 )
          list.splice(j, 1);
    } else {
      list.splice(point, 1);
    }

    // After removing the item, re-number the indexes
    for ( let k = 0 ; k < list.length ; k++ )
      if ( list[k]._index >= point + 1 )
        list[k]._index = list[k]._index - 1;
  }


  // PUBLIC METHODS
  // After a shuffle or unshuffle, the array has changed. Get the index
  // for the current-displayed song in the previous array.
  this.lastIndex = (index, newList, oldList) => {
    const compare = newList[index];
    for (let n = 0; n < oldList.length ; n++ )
      // Cannot compare full objects after clone() :(
      // Instead, compare the generated _index
      if ( oldList[n]._index === compare._index )
        return n;

    // Default value, in case some array value was removed
    return 0;
  }

  this.removeAllTracks = () => {
    this.original = [];  
    this.previous = [];
    this.current = [];
    this.previousItem = 0;
    this.startingTrack = -1;
    this.currentItem = this.startingTrack;
    this.trackNumber = this.startingTrack;
  }

  // Toggle shuffle mode or not, and prepare for rebasing the playlist
  // upon changing to the next available song. NOTE that each function here
  // changes flags, so the logic must exclude any logic if a revert occurs.
  this.toggleShuffle = (forceReshuffle = false, preserveCurrent = true) => {
    if (forceReshuffle) {
      return enableShuffle(preserveCurrent);
    }
    if ( this.remakeList ) {
      return revertShuffle();  
    }

    return this.shuffleMode ? disableShuffle() : enableShuffle(preserveCurrent);
  }

  // After toggling the list, the next/prev track action must trigger
  // the list getting remade, with the next desired track as the head.
  // This function will remake the list as needed.
  this.rebasePlayList = (index) => {
    if ( this.shuffleMode ) {
      this.current = reorderedCopy(this.current, index);
    }
    this.currentItem = 0;    // Position to head of the list
    this.remakeList = false;    // Rebasing is finished.
  }

  // Signify to this object that at the next track change, it will be OK 
  // to reorder the current playlist starting at the next desired track.
  this.readyToRemake = () => this.remakeList;

  // Are we in shuffle mode or not? If we just came out of shuffle mode,
  // the player object will want to know.
  this.isShuffled = () => this.shuffleMode;

  // PlayList manipulation requires us to keep state on which track is     
  // playing. Player object state changes may need to update the current    
  // index in the FileList object as well.    
  this.set = (index) => {
    this.previousItem = this.currentItem;  
    this.currentItem = index;
    this.trackNumber = this.current[index]._index;    
  }

  // Get the "highlighted" track in the current playlist. After a shuffle,
  // this may not be the track that is currently playing.  
  this.get = () => this.currentItem;

  // Helper: find the given index in the current playlist
  this.getIndex = (index) => {
    if ( this.isShuffled() ) {
      for ( let i=0; i < this.current.length; i++ )
        if ( this.current[i]._index === index )
          return i - 1;
    } else {
      return index;
    }
  }

  // Add a new song into the FileList object.
  // TODO: this should take objects, not files, as input
  //   Consider rewriting deshuffle to rely entirely on _index vals
  this.add = (index, file) => {
    const { current, original, remakeList, shuffleMode } = this;
    this.previous = clone(current);
    this.previousItem = this.currentItem;

    // Update current list
    addFile(index, file, current, shuffleMode);

    // Update original list. Assume it doesn't start in shuffle
    addFile(index, file, original, false);

    // Update the previous list too. If readyToRemake, that means
    // the last list is the opposite shuffleMode of the current.
    if ( remakeList )
      addFile(index, file, this.previous, !shuffleMode);
    else
      addFile(index, file, this.previous, shuffleMode);

    // Shift currentItem if the insert file is earlier in the list
    if ( index <= this.currentItem || this.currentItem === -1 )
      this.currentItem = this.currentItem + 1;

    this.trackNumber = current[this.currentItem]._index;
  }

  // Remove a song from the FileList object.
  this.remove = (index) => {
    const { current, original, remakeList, shuffleMode } = this;
    this.previous = clone(current);
    this.previousItem = this.currentItem;

    // Remove from current array
    removeFile(index, current, shuffleMode);      

    // Remove from the unshuffled array as well
    removeFile(index, original, shuffleMode);      

    // Update previous list too
    removeFile(index, this.previous, remakeList ? !shuffleMode : shuffleMode);

    // Stay at the same song index, unless currentItem is after the
    // removed index, or was removed at the edge of the list 
    if (( index < this.currentItem ) || ( index >= this.previous.length - 1))
      if ( this.currentItem > 0 )
        this.currentItem = this.currentItem - 1;

    this.trackNumber = current[this.currentItem]._index;
  }

  // Get an array of songfile paths from this object, appropriate for 
  // including in a Player object.
  this.files = () => {
    return this.current.map((song) => { return song.file });
  }

  if (this.original.length > 0) {
    // Add _index parameter to the JSON array of tracks
    for ( let n = 0; n < this.original.length; n++) {
      this.original[n]._index = n + 1;
    }

    // Set displayed song number to whatever the current-playing index is
    this.trackNumber = this.original[this.startingTrack]._index;

    // Create the current playing list, based on startingTrack and shuffleMode.
    if ( this.shuffleMode ) {
      // If shuffle mode is on, shuffle the starting list
      this.current = clone(this.original);
      enableShuffle();
    } else {
      // On object creation, make current list use startingTrack as head of list
      this.current = reorderedCopy(this.original, this.startingTrack);
    }
  } else {
    this.current = [];
    this.currentItem = -1;
  }
}

// parameters are optional.  
//   elem_id: id of existing HTML element where UI should be rendered
//   options:
//     tracks: path of file (or array of music file paths)
//     playOnLoad (default = false): play immediately
//     useWebAudio (default = true)
//     useHTML5Audio (default = true)
//     startingTrack (number or "random", default = 0)
//     shuffle (true or false): start the jukebox in shuffle mode
//     shuffleButton (default = true): whether shuffle button appears or not in UI
const Gapless5 = function(elem_id = "", options = {}) {

// MEMBERS AND CONSTANTS

// UI
const tickMS = 27; // fast enough for numbers to look real-time
const scrubSize = 65535;
const statusText = {
  loading:  "loading\u2026",
  error: "error!",
};
this.scrubWidth = 0;
this.scrubPosition = 0;
this.isScrubbing = false;

// System
this.initialized = false;

this.loop = ('loop' in options) && (options.loop);
this.singleMode = ('singleMode' in options) && (options.singleMode);

this.useWebAudio = ('useWebAudio' in options) ? options.useWebAudio : true;
this.useHTML5Audio = ('useHTML5Audio' in options) ? options.useHTML5Audio : true;
this.id = Math.floor((1 + Math.random()) * 0x10000);

// WebAudio API
const context = gapless5AudioContext;
const gainNode = (window.hasWebKit || (typeof AudioContext !== "undefined")) ? context.createGain() : null;
if (context && gainNode) {
  gainNode.connect(context.destination);
}

// Playlist
this.trk = null;  // Playlist manager object
this.sources = [];    // List of Gapless5Sources
this.loadQueue = [];    // List of files to consume
this.loadingTrack = -1;    // What file to consume

// Callback and Execution logic
this.isPlayButton = true;
this.keyMappings = {};

// Callbacks
this.onprev = null;
this.onplay = null;
this.onpause = null;
this.onstop = null;
this.onnext = null;
this.onshuffle = null;

this.onerror = null;
this.onfinishedtrack = null;
this.onfinishedall = null;


// INTERNAL HELPERS
const getUIPos = () => {
  const { isScrubbing, scrubPosition, sources } = this;
  const position = isScrubbing ? scrubPosition : sources[dispIndex()].getPosition();
  return (position / sources[dispIndex()].getLength()) * scrubSize;
};

const getSoundPos = (uiPosition) => {
  return ((uiPosition / scrubSize) * this.sources[dispIndex()].getLength());
};

const numTracks = () => {
  // FileList object must be initiated
  if ( this.sources.length > 0 && this.trk !== null )
    return this.trk.current.length;
  else
    return 0;
};

// Index for calculating actual playlist location
const index = () => {
  // FileList object must be initiated
  if ( this.trk !== null )
    return this.trk.get();
  else
    return -1;
};

// Index for displaying the currently playing
// track, suitable for use in update functions
const dispIndex = () => {
  const maxIndex = this.sources.length - 1;
  if ( readyToRemake() )
    return Math.min(this.trk.previousItem, maxIndex);
  else if ( this.trk !== null )
    return Math.min(this.trk.get(), maxIndex);
  else
    return -1;
}

const readyToRemake = () => {
  // FileList object must be initiated
  if ( this.trk.readyToRemake() !== null )
    return this.trk.readyToRemake();
  else
    return false;
};

const getFormattedTime = (inMS) => {
  let minutes = Math.floor(inMS / 60000);
  const seconds_full = (inMS - (minutes * 60000)) / 1000;
  let seconds = Math.floor(seconds_full);
  let csec = Math.floor((seconds_full - seconds) * 100);
  
  if (minutes < 10) { minutes = "0" + minutes; }
  if (seconds < 10) { seconds = "0" + seconds; }
  if (csec < 10) { csec = "0" + csec; }
  
  return minutes + ':' + seconds + '.' + csec;
};

const getTotalPositionText = () => {
  let text = statusText.loading;
  if (this.sources.length === 0) {
    return text;
  } 
  const source = this.sources[dispIndex()];
  const srcLength = source.getLength();
  if (numTracks() === 0) {
    text = getFormattedTime(0);
  } else if (source.getState() === Gapless5State.Error) {
    text = statusText.error;
  } else if (srcLength > 0) {
    text = getFormattedTime(srcLength);
  }
  return text;
};

const runCallback = (cb) => {
  if (cb) cb();
};

// after shuffle mode toggle and track change, re-grab the tracklist
const refreshTracks = (newIndex) => {
  // prevent updates while tracks are coming in
  this.initialized = false;

  this.removeAllTracks(false);
  this.trk.rebasePlayList(newIndex);

  const tracks = this.getTracks();
  for (let i = 0; i < tracks.length; i++ ) {
    this.addInitialTrack(tracks[i]);
  }

  // re-enable GUI updates
  this.initialized = true;
};

// Determines how and when the next track should be loaded.
this.dequeueNextLoad = () => {
  if (this.loadQueue.length > 0) {
    const entry = this.loadQueue.shift();
    this.loadingTrack = entry[0];
    if (this.loadingTrack < this.sources.length) {
      this.sources[this.loadingTrack].load(entry[1]);
    }
  } else {
    this.loadingTrack = -1;
  }
}

// (PUBLIC) ACTIONS
this.totalTracks = () => {
  return numTracks();
}

this.mapKeys = (options) => {
  for (let key in options) {
    const uppercode = options[key].toUpperCase().charCodeAt(0);
    const lowercode = options[key].toLowerCase().charCodeAt(0);
    const player = gapless5Players[this.id];
    if (player.hasOwnProperty(key)) {
      this.keyMappings[uppercode] = player[key];
      this.keyMappings[lowercode] = player[key];
    } else {
      console.error(`Gapless5 mapKeys() error: no function named '${key}'`);
    }
  }
  $(window).keydown((e) => {
    if (e.keyCode in this.keyMappings) {
      this.keyMappings[e.keyCode](e);
    }
  });
};

this.setGain = (uiPos) => {
  const normalized = uiPos / scrubSize;
  gainNode.gain.value = normalized;
  this.sources[dispIndex()].setGain(normalized);
};

this.scrub = (uiPos) => {
  this.scrubPosition = getSoundPos(uiPos);
  $("#currentPosition" + this.id).html(getFormattedTime(this.scrubPosition));
  enableButton('prev', this.loop || (index() !== 0 || this.scrubPosition !== 0));
  if (!this.isScrubbing) {
    this.sources[dispIndex()].setPosition(this.scrubPosition, true);
  }
};

this.setLoadedSpan = (percent) => {
  $("#loaded-span" + this.id).width(percent * this.scrubWidth);
  if (percent === 1) {
    $("#totalPosition" + this.id).html(getTotalPositionText());
  }
};

this.onEndedCallback = () => {
  // we've finished playing the track
  resetPosition();
  this.sources[dispIndex()].stop(true);
  if (this.loop || index() < numTracks() - 1) {
    if (this.singleMode) {
      this.prev(true);
    } else {
      this.next(true);
    }
    runCallback(this.onfinishedtrack);
  } else {
    runCallback(this.onfinishedtrack);
    runCallback(this.onfinishedall);
  }
};

this.onStartedScrubbing = () => {
  this.isScrubbing = true;
};

this.onFinishedScrubbing = () => {
  this.isScrubbing = false;
  if (this.sources[dispIndex()].inPlayState() && this.scrubPosition >= this.sources[dispIndex()].getLength()) {
    this.next(true);
  } else {
    this.sources[dispIndex()].setPosition(this.scrubPosition, true);
  }
};

// Assume the FileList already accounts for this track, and just add it to the
// loading queue. Until this.sources[] lives in the FileList object, this compromise
// ensures addTrack/removeTrack functions can modify the FileList object when
// called by Gapless applications.
this.addInitialTrack = (audioPath) => {
  const next = this.sources.length;
  this.sources[next] = new Gapless5Source(this, context, gainNode);
  this.loadQueue.push([next, audioPath]);
  if (this.loadingTrack === -1) {
    this.dequeueNextLoad();
  }
  if (this.initialized) {
    updateDisplay();
  }
};

this.addTrack = (audioPath) => {
  const next = this.sources.length;
  this.sources[next] = new Gapless5Source(this, context, gainNode);
  // TODO: refactor to take an entire JSON object
  // TODO: move this function to the fileList object
  this.trk.add(next, audioPath);
  this.loadQueue.push([next, audioPath]);
  if (this.loadingTrack === -1) {
    this.dequeueNextLoad();
  }
  if (this.initialized) {
    updateDisplay();
  }
};

this.insertTrack = (point, audioPath) => {
  const trackCount = numTracks();
  point = Math.min(Math.max(point, 0), trackCount);
  if (point === trackCount) {
    this.addTrack(audioPath);
  } else {
    this.sources.splice(point, 0, new Gapless5Source(this, context, gainNode));
    // TODO: refactor to take an entire JSON object
    // TODO: move this function to the fileList object
    this.trk.add(point, audioPath);
    //re-enumerate queue
    for (let i in this.loadQueue) {
      const entry = this.loadQueue[i];
      if (entry[0] >= point) {
        entry[0] += 1;
      }
    }
    this.loadQueue.splice(0,0,[point,audioPath]);
    updateDisplay();
  }
};

this.getTracks = () => this.trk.files();

this.findTrack = (path) => {
  return this.getTracks().indexOf(path);
};

this.removeTrack = (pointOrPath) => {
  const point = (typeof pointOrPath === 'string') ?
    this.findTrack(pointOrPath) :
    pointOrPath;

  if (point < 0 || point >= this.sources.length) return;

  const curSource = this.sources[point];
  if (!curSource) {
    return;
  }
  let wasPlaying = false;

  if (curSource.getState() === Gapless5State.Loading) {
    curSource.cancelRequest();
  } else if (curSource.getState() === Gapless5State.Play) {
    wasPlaying = true;
    curSource.stop();
  }
  
  let removeIndex = -1;
  for (let i in this.loadQueue) {
    const entry = this.loadQueue[i];
    if (entry[0] === point) {
      removeIndex = i;
    } else if (entry[0] > point) {
      entry[0] -= 1;
    }
  }
  if (removeIndex >= 0) {
    this.loadQueue.splice(removeIndex,1);
  }
  // TODO: move this functionality into the FileList object
  this.sources.splice(point, 1);
  this.trk.remove(point);

  if (this.loadingTrack === point) {
    this.dequeueNextLoad();
  }
  if ( point === this.trk.currentItem ) {
    this.next();  // Don't stop after a delete
    if ( wasPlaying )
      this.play();
  }

  if (this.initialized) {
    updateDisplay();
  }
};

this.replaceTrack = (point, audioPath) => {
  this.removeTrack(point);
  this.insertTrack(point, audioPath);
}

this.removeAllTracks = (flushPlaylist = true) => {
  for (let i = 0; i < this.sources.length; i++) {
    if (this.sources[i].getState() === Gapless5State.Loading) {
      this.sources[i].cancelRequest();
    }
    this.sources[i].stop();
  }
  if (flushPlaylist) {
    this.trk.removeAllTracks();
  }
  this.loadingTrack = -1;
  // TODO: move this function into the FileList object
  this.sources = [];
  this.loadQueue = [];
  if (this.initialized) {
    updateDisplay();
  }
};

this.isShuffled = () => this.trk.isShuffled();

// shuffles, re-shuffling if previously shuffled
this.shuffle = (preserveCurrent = true) => {
  if (!canShuffle()) return;

  this.trk.toggleShuffle(true, preserveCurrent);

  if (this.initialized) {
    updateDisplay();
  }
};

// toggles between shuffled and unshuffled
this.toggleShuffle = () => {
  if (!canShuffle()) return;

  this.trk.toggleShuffle();

  if (this.initialized) {
    updateDisplay();
  }
};
// backwards-compatibility with previous function name
this.shuffleToggle = this.toggleShuffle;

this.gotoTrack = (pointOrPath, bForcePlay) => {
  const newIndex = (typeof pointOrPath === 'string') ?
    this.findTrack(pointOrPath) :
    pointOrPath;

  let justRemade = false;

  // If the list is flagged for remaking on the change of shuffle mode, 
  // remake the list in shuffled order
  if ( readyToRemake() ) {
    // just changed our shuffle mode. remake the list
    refreshTracks(newIndex);
    justRemade = true;
  }

  // No shuffle / unshuffle occurred, and we're just restarting a track
  if (!justRemade && newIndex === index()) {
    resetPosition();
    if ((bForcePlay) || this.sources[index()].isPlayActive()) {
      this.sources[newIndex].play();
    }
  }

  // A shuffle or an unshuffle just occurred
  else if ( justRemade ) {
    this.trk.set(newIndex);
    this.sources[newIndex].load(this.getTracks()[newIndex]);
    this.sources[newIndex].play();

    updateDisplay();
  } else {
    // A normal track change just occurred
    const oldIndex = index();
    this.trk.set(newIndex);
    // Cancel any track that's in loading state right now
    if (this.sources[oldIndex].getState() === Gapless5State.Loading) {
      this.sources[oldIndex].cancelRequest();
      // TODO: better way to have just the file list?
      this.loadQueue.push([oldIndex, this.getTracks()[oldIndex]]);
    }

    resetPosition(true); // make sure this comes after currentIndex has been updated
    if (this.sources[newIndex].getState() === Gapless5State.None) {
      // TODO: better way to have just the file list?
      this.sources[newIndex].load(this.getTracks()[newIndex]);

      //re-sort queue so that this track is at the head of the list
      for (let i in this.loadQueue) {
        const entry = this.loadQueue.shift();
        if (entry[0] === newIndex) {
          break;
        }
        this.loadQueue.push(entry);
      }
    }
    updateDisplay();
    
    if ((bForcePlay) || this.sources[oldIndex].isPlayActive()) {
      this.sources[newIndex].play();
    }
    this.sources[oldIndex].stop(); // call this last

  }
  enableButton('prev', this.loop || (!this.singleMode && newIndex > 0));
  enableButton('next', this.loop || (!this.singleMode && newIndex < numTracks() - 1));
};

this.prevtrack = () => {
  if (this.sources.length === 0) return;
  let track = 0;
  if (index() > 0) {
    track = index() - 1;
  } else if (this.loop) {
    track = numTracks() - 1;
  } else {
    return;
  }
  this.gotoTrack(track);
  runCallback(this.onprev);
};

this.prev = (e) => {
  if (this.sources.length === 0) return;
  let wantsCallback = true;
  let track = 0;
  if ( readyToRemake() ) {
    // jump to start of track that's in a new position
    // at the head of the re-made list.
    wantsCallback = false
  } else if (this.sources[index()].getPosition() > 0) {
    // jump to start of track if we're not there
    track = index();
    wantsCallback = false;
  } else if (this.singleMode && this.loop) {
    track = index();
  } else if (index() > 0) {
    track = index() - 1;
  } else if (this.loop) {
    track = numTracks() - 1;
  } else {
    return;
  }
  this.gotoTrack(track, e === true);
  if (wantsCallback) {
    runCallback(this.onprev);
  }
};

this.next = (e) => {
  if (this.sources.length === 0) return;
  let track = 0;
  if (this.singleMode) {
    track = index();
  } else if (index() < numTracks() - 1) {
    track = index() + 1;
  } else if (!this.loop) {
    return;
  }
  this.gotoTrack(track, e === true);
  runCallback(this.onnext);
};

this.play = () => {
  if (this.sources.length === 0) return;
  if (this.sources[dispIndex()].audioFinished) {
    this.next(true);
  } else {
    this.sources[dispIndex()].play();
  }
  runCallback(this.onplay);
};

this.playpause = (e) => {
  if (this.isPlayButton)
    this.play(e);
  else
    this.pause(e);
}

this.cue = (e) => {
  if (!this.isPlayButton) {
    this.prev(e);
  } else if (this.sources[dispIndex()].getPosition() > 0) {
    this.prev(e);
    this.play(e);
  } else {
    this.play(e);
  }
}

this.pause = (e) => {
  if (this.sources.length === 0) return;
  this.sources[dispIndex()].stop();
  runCallback(this.onpause);
};

this.stop = (e) => {
  if (this.sources.length === 0) return;
  resetPosition();
  this.sources[dispIndex()].stop(true);
  runCallback(this.onstop);
};


// (PUBLIC) QUERIES AND CALLBACKS

this.isPlaying = () => this.sources[dispIndex()].inPlayState();

// INIT AND UI

const resetPosition = (forceScrub) => {
  if (!forceScrub && this.sources[dispIndex()].getPosition() === 0) return; // nothing else to do
  this.scrub(0);
  $("#transportbar" + this.id).val(0);
};

const enableButton = (buttonId, bEnable) => {
  if (bEnable) {
    $("#" + buttonId + this.id).removeClass('disabled');
    $("#" + buttonId + this.id).addClass('enabled');
  } else {
    $("#" + buttonId + this.id).removeClass('enabled');
    $("#" + buttonId + this.id).addClass('disabled');
  }
};

const enableShuffleButton = (mode, bEnable) => {
  const isShuffle = mode === "shuffle";
  const oldButtonClass = isShuffle ? "g5unshuffle" : "g5shuffle";
  const newButtonClass = isShuffle ? "g5shuffle" : "g5unshuffle";

  $("#" + "shuffle" + this.id).removeClass(oldButtonClass);
  $("#" + "shuffle" + this.id).addClass(newButtonClass);

  enableButton('shuffle', bEnable);
};

// Must have at least 3 tracks in order for shuffle button to work
// If so, permanently turn on the shuffle toggle
const canShuffle = () => this.trk.current.length > 2;

const updateDisplay = () => {
  const { id, trk, loop} = this;
  if (numTracks() === 0) {
    $("#trackIndex" + id).html(0);
    $("#tracks" + id).html(0);
    $("#totalPosition" + id).html("00:00.00");
    enableButton('prev', false);
    enableShuffleButton('shuffle', false);
    enableButton('next', false);
  } else {
    $("#trackIndex" + id).html(trk.trackNumber);
    $("#tracks" + id).html(trk.current.length);
    $("#totalPosition" + id).html(getTotalPositionText());
    enableButton('prev', loop || index() > 0 || this.sources[index()].getPosition() > 0);
    enableButton('next', loop || index() < numTracks() - 1);

    if (this.sources[dispIndex()].inPlayState()) {
      enableButton('play', false);
      this.isPlayButton = false;
    } else {
      enableButton('play', true);
      this.isPlayButton = true;

      if (this.sources[dispIndex()].getState() === Gapless5State.Error) {
        runCallback(this.onerror);
      }
    }

    enableShuffleButton(this.trk.isShuffled() ? 'unshuffle' : 'shuffle', canShuffle());
    this.sources[index()].uiDirty = false;
  }
};

const Tick = () => {
  if (numTracks() > 0) {
    this.sources[dispIndex()].tick();

    if (this.sources[dispIndex()].uiDirty) {
      updateDisplay();
    }
    if (this.sources[dispIndex()].inPlayState()) {
      let soundPos = this.sources[dispIndex()].getPosition();
      if (this.isScrubbing) {
        // playing track, update bar position
        soundPos = this.scrubPosition;
      }
      $("#transportbar" + this.id).val(getUIPos());
      $("#currentPosition" + this.id).html(getFormattedTime(soundPos));
    }
  }
  window.setTimeout(() => { Tick(); }, tickMS);
};

const createGUI = (playerHandle) => {
  const { id } = this;
  const playerWrapper = (player_html) => `
    <div class="g5position">
      <span id="currentPosition${id}">00:00.00</span> |
      <span id="totalPosition${id}">${statusText.loading}</span> |
      <span id="trackIndex${id}">1</span>/<span id="tracks${id}">1</span>
    </div>
    <div class="g5inside">
      ${player_html}
    </div>
  `;

  if (typeof Audio === "undefined") {
    return playerWrapper('This player is not supported by your browser.');
  }

  return playerWrapper(`
    <div class="g5transport">
      <div class="g5meter"><span id="loaded-span${id}" style="width: 0%"></span></div>
        <input type="range" class="transportbar" name="transportbar" id="transportbar${id}"
        min="0" max="${scrubSize}" value="0" oninput="${playerHandle}.scrub(this.value);"
        onmousedown="${playerHandle}.onStartedScrubbing();" ontouchstart="${playerHandle}.onStartedScrubbing();"
        onmouseup="${playerHandle}.onFinishedScrubbing();" ontouchend="${playerHandle}.onFinishedScrubbing();" />
      </div>
    <div class="g5buttons" id="g5buttons${id}">
      <button class="g5button g5prev" id="prev${id}"/>
      <button class="g5button g5play" id="play${id}"/>
      <button class="g5button g5stop" id="stop${id}"/>
      <button class="g5button g5shuffle" id="shuffle${id}"/>
      <button class="g5button g5next" id="next${id}"/>
      <input type="range" class="volume" name="gain" min="0" max="${scrubSize}" value="${scrubSize}" oninput="${playerHandle}.setGain(this.value);" />
    </div>
  `);
};

const Init = (guiId, options) => {
  const guiElement = guiId ? $("#" + guiId) : [];
  const { id } = this;
  gapless5Players[id] = this;

  if (guiElement.length > 0) {
    const playerHandle = `gapless5Players[${id}]`;
    guiElement.html(createGUI(playerHandle));

    // css adjustments
    if (navigator.userAgent.indexOf('macOS') === -1) {
      $("#transportbar" + id).addClass("g5meter-1pxup");
    }

    // set up button mappings
    $('#prev' + id)[0].addEventListener("mousedown", gapless5Players[id].prev);
    $('#play' + id)[0].addEventListener("mousedown", gapless5Players[id].playpause);
    $('#stop' + id)[0].addEventListener("mousedown", gapless5Players[id].stop);
    $('#shuffle' + id)[0].addEventListener("mousedown", gapless5Players[id].toggleShuffle);
    $('#next' + id)[0].addEventListener("mousedown", gapless5Players[id].next);

    enableButton('play', true);
    enableButton('stop', true);

    // set up whether shuffleButton appears or not (default is visible)
    if (( 'shuffleButton' in options ) && !options.shuffleButton) {
      // Style items per earlier Gapless versions
      const transSize = "111px";
      const playSize = "115px";
      $( "input[type='range'].transportbar" ).css("width", transSize);
      $( ".g5meter" ).css("width", transSize);
      $( ".g5position" ).css("width", playSize);
      $( ".g5inside" ).css("width", playSize);
      $( "#shuffle" + id).remove();
    }
    this.scrubWidth = $("#transportbar" + id).width();
  }

  if (typeof Audio === "undefined") {
    console.error("This player is not supported by your browser.")
    return;
  }

  // set up starting track number
  if ('startingTrack' in options) {
    if (typeof options.startingTrack === 'number') {
      this.startingTrack = options.startingTrack;
    } else if ((typeof options.startingTrack === 'string') && (options.startingTrack === "random")) {
      this.startingTrack = "random";
    }
  }

  // set up key mappings
  if ('mapKeys' in options) {
    this.mapKeys(options['mapKeys']);
  }
  
  // set up whether shuffle is enabled when the player loads (default is false)
  const shuffleOnInit = ('shuffle' in options) && options.shuffle;
  
  // set up tracks into a FileList object
  if ('tracks' in options) {
    const setupTracks = (player) => {
      const tracks = player.getTracks();
      for (let i = 0; i < tracks.length; i++) {
        player.addInitialTrack(tracks[i]);
      }
    };
    
    const items = [];
    let startingTrack = 0;
    if (Array.isArray(options.tracks)) {
      if (typeof options.tracks[0] === 'string') {
        // convert array into JSON items
        for (let i = 0; i < options.tracks.length; i++) {
          items[i] = { file: options.tracks[i] };
        }
      } else if (typeof options.tracks[0] === 'object') {
        items = options.tracks;
        startingTrack = this.startingTrack || 0;
      }
    } else if (typeof options.tracks === 'string') {
      items[0] = { file: options.tracks };
    }
    this.trk = new Gapless5FileList(items, startingTrack, shuffleOnInit);
    setupTracks(this);
  } else {
    this.trk = new Gapless5FileList([], -1, shuffleOnInit);
  }

  this.initialized = true;
  updateDisplay();

  // autostart if desired
  const playOnLoad = ('playOnLoad' in options) && options.playOnLoad;
  if (playOnLoad && (this.trk.current.length > 0)) {
    this.sources[index()].play();
  }
  Tick();
};

$(document).ready(Init(elem_id, options));
};
