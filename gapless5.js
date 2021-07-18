////////////
//
// Gapless 5: Gapless JavaScript/CSS audio player for HTML5
// (requires jQuery 1.x or greater)
//
// Version 0.6.5
// Copyright 2014 Rego Sen
//
//////////////

// PROBLEM: We have 2 API's for playing audio through the web, and both of them have problems:
//  - HTML5 Audio: the last chunk of audio gets cut off, making gapless transitions impossible
//  - WebAudio: can't play a file until it's fully loaded
// SOLUTION: Use both!
// If WebAudio hasn't loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.

// NOTE: Mobile browsers don't fully support Audio objects in js, so we're stuck with only WebAudio in that case.
window.mobilecheck = function() {
  // taken from http://detectmobilebrowsers.com
  let check = false;
  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od|ad)|iris|kindle|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4)))check = true})(navigator.userAgent||navigator.vendor||window.opera);
  return check; }
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
  const that = this;
  const parent = parentPlayer;

  this.setGain = function (val) {
    if (audio !== null) {
      audio.volume = val;
    }
  }

  this.getState = function () { return state; }

  const setState = function (newState) {
    state = newState;
    queuedState = Gapless5State.None;
  };

  this.finished = function() { return audioFinished; }

  this.timer = function() {
    const now = new Date().getTime();
    return now - initMS;
  }

  this.cancelRequest = function (isError) {
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
    that.uiDirty = true;
  }

  const onEnded = function () {
    if (state === Gapless5State.Play) {
      audioFinished = true;
      parent.onEndedCallback();
    }
  }

  const onPlayEvent = function () {
    startTime = (new Date().getTime()) - position;
  }

  const onLoadedWebAudio = function (inBuffer) {
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
      position = (new Date().getTime()) - startTime;
      if (!window.hasWebKit) position -= tickMS;
      that.setPosition(position, true);
    }
    if (state === Gapless5State.Loading) {
      state = Gapless5State.Stop;
    }
    // once we have WebAudio data loaded, we don't need the HTML5 audio stream anymore
    audio = null;
    that.uiDirty = true;
  }

  const onLoadedHTML5Audio = function () {
    if (state !== Gapless5State.Loading) return;

    if (buffer !== null || !parent.useWebAudio) {
      parent.dequeueNextLoad();
    }

    state = Gapless5State.Stop;
    endpos = audio.duration * 1000;

    if (queuedState === Gapless5State.Play) {
      playAudioFile(true);
    }
    that.uiDirty = true;
  }

  this.stop = function () {
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
    that.uiDirty = true;
  };

  const playAudioFile = function () {
    if (state === Gapless5State.Play) return;
    position = Math.max(position, 0);
    if (position >= endpos) position = 0;

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
    that.uiDirty = true;
  };

  // PUBLIC FUNCTIONS

  this.inPlayState = function() {
    return (state === Gapless5State.Play); 
  }

  this.isPlayActive = function() {
    return (that.inPlayState() || queuedState === Gapless5State.Play) && !that.audioFinished; 
  }

  this.getPosition = function() { return position; }

  this.getLength = function() { return endpos; }

  this.play = function() {
    if (state === Gapless5State.Loading) {
      queuedState = Gapless5State.Play;
    } else {
      playAudioFile(); // play immediately
    }
  }

  this.tick = function() {
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

  this.setPosition = function(newPosition, bResetPlay) {
    position = newPosition;
    if (bResetPlay && that.inPlayState()) {
      that.stop();
      that.play();
    }
  };

  this.load = function(inAudioPath) {
    if (source || audio) {
      parent.dequeueNextLoad();
      return;
    }
    if (state === Gapless5State.Loading) {
      return;
    }
    state = Gapless5State.Loading;
    if (parent.useWebAudio) {
      const onLoadWebAudio = function(data) {
        context.decodeAudioData(data,
          function(incomingBuffer) {
            onLoadedWebAudio(incomingBuffer);
          }
        );
      };
      if (inAudioPath.startsWith("blob:")) {
        request = new FileReader();
        request.onload = () => onLoadWebAudio(request.result);
        fetch(inAudioPath).then(r => {
          r.blob().then(blob => {
            request.readAsArrayBuffer(blob);
          });
        });
      } else {
        request = new XMLHttpRequest();
        request.open('get', inAudioPath, true);
        request.responseType = 'arraybuffer';
        request.onload = () => onLoadWebAudio(request.response);
        request.send();
      }
    }
    if (parent.useHTML5Audio) {
      const getHtml5Audio = function() {
        const audioObj = new Audio();
        audioObj.controls = false;
        audioObj.addEventListener('canplaythrough', onLoadedHTML5Audio, false);
        audioObj.addEventListener('ended', onEnded, false);
        audioObj.addEventListener('play', onPlayEvent, false);
        // TODO: switch to audio.networkState, now that it's universally supported
        return audioObj;
      }
      if (inAudioPath.startsWith("blob:")) {
        // TODO: blob as srcObject is not supported on all browsers
        fetch(inAudioPath).then(r => {
          r.blob().then(blob => {
            audio = getHtml5Audio();
            audio.srcObject = blob;
          });
        });
      } else {
        audio = getHtml5Audio();
        audio.src = inAudioPath;
      }
    }
    // cancel if url doesn't exist, but don't download again
    $.ajax({
      url: inAudioPath,
      type: "HEAD",
    }).fail(function() { 
      that.cancelRequest(true);
    });
  }
}

// A Gapless5FileList "class". Processes an array of JSON song objects, taking 
// the "file" members out to constitute the that.sources[] in the Gapless5 player
const Gapless5FileList = function(inPlayList, inStartingTrack, inShuffle) {

  // OBJECT STATE
  // Playlist and Track Items
  this.original = inPlayList;  // Starting JSON input
  this.previous = [];    // Support double-toggle undo
  this.current = [];    // Working playlist
  this.previousItem = 0;    // To last list and last index

  this.startingTrack = inStartingTrack;
  if ( inStartingTrack === null ) {
    this.startingTrack = 0;
  }
  if ( inStartingTrack === "random" ) {
    this.startingTrack = Math.floor(Math.random()*this.original.length);
  }  
  this.currentItem = this.startingTrack;
  this.trackNumber = this.startingTrack;  // Displayed track index in GUI

  const that = this;

  // If the tracklist ordering changes, after a pre/next song,
  // the playlist needs to be regenerated
  let shuffleMode = !!inShuffle;  // Ordered (false) or Shuffle (true)
  let remakeList = false;         // Will need to re-order list upon track changing

  // PRIVATE METHODS
  // Clone an object so it's not passed by reference
  // Works for objects that have no clever circular references
  // or complex types. It's a "flash serialize".
  const clone = function(input) { 
    return JSON.parse(JSON.stringify(input));
  }

  // Swap two elements in an array
  const swapElements = function(someList, sourceIndex, destIndex) { 
    const tmp = someList[sourceIndex];
    someList[sourceIndex] = someList[destIndex];
    someList[destIndex] = tmp;
  }

  // Add _index values to each member of the array, so we know what the
  // original track was.
  const addIndices = function(inputList) {
    const temp = inputList.slice();
    for ( let n = 0; n < temp.length ; n++)
      temp[n]._index = n + 1;
    return temp;
  }

  // Reorder an array so that the outputList starts at the desiredIndex
  // of the inputList.
  const reorder = function(inputList, desiredIndex) {
    const tempList = clone(inputList);
    return tempList.concat(tempList.splice(0, desiredIndex));
  }

  // Shuffle a playlist, making sure that the next track in the list
  // won't be the same as the current track being played.
  const shuffle = function(inputList, index) {
    let outputList = inputList.slice();

    // Shuffle the list
    for ( let n = 0; n < outputList.length - 1; n++ ) {
      const k = n + Math.floor(Math.random() * (outputList.length - n ));
      swapElements(outputList, k, n);
    }

    // Reorder playlist array so that the chosen index comes first, 
    // and gotoTrack isn't needed after Player object is remade.
    outputList = reorder(outputList, index);

    // After shuffling, move the current-playing track to the 0th
    // place in the index. So regardless of the next move, this track
    // will be appropriately far away in the list
    const swapIndex = that.lastIndex(index, that.current, outputList);
    if ( swapIndex !== 0 )
      swapElements(outputList, swapIndex, 0);

    // If the list of indexes in the new list is the same as the last,
    // do a reshuffle. TOWRITE
    return outputList;
  }

  // Already pressed the shuffle button once from normal mode.
  // Revert to previous list / item, and terminate.
  const revertShuffle = function() {
    that.current = that.previous;
    that.currentItem = that.previousItem;

    shuffleMode = !shuffleMode;
    remakeList = false;
  }

  // Going into shuffle mode. Tell the Player to remake the list
  // as soon as a new track is reached or chosen. 
  const enableShuffle = function() {
    // Save old state in case we need to revert
    that.previous = clone(that.current);
    that.previousItem = that.currentItem;

    that.current = shuffle(that.original, that.currentItem);
    that.currentItem = 0;
  
    shuffleMode = true;
    remakeList = true;
  }

  // Leaving shuffle mode. Tell the Player to remake the list
  // as soon as a new track is reached or chosen. 
  const disableShuffle = function() {
    // Save old state in case we need to revert
    that.previous = clone(that.current);
    that.previousItem = that.currentItem;

    // Find where current song is in original playlist, and make that
    // the head of the new unshuffled playlist
    const point = that.lastIndex(that.currentItem, that.current, that.original);
    that.current = reorder(that.original, point);

    that.currentItem = 0;  // Position to head of list
    shuffleMode = false;
    remakeList = true;
  }

  // Add a song to a single member of the FileList object, adjusting
  // each FileList entry's _index value as necessary.
  const addFile = function(point, file, list, listShuffled) {
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
  const removeFile = function(point, list, listShuffled) {
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
  this.lastIndex = function(index, newList, oldList) {
    const compare = newList[index];
    for (let n = 0; n < oldList.length ; n++ )
      // Cannot compare full objects after clone() :(
      // Instead, compare the generated _index
      if ( oldList[n]._index === compare._index )
        return n;

    // Default value, in case some array value was removed
    return 0;
  }

  this.removeAllTracks = function() {
    that.original = [];  
    that.previous = [];
    that.current = [];
    that.previousItem = 0;
    that.startingTrack = -1;
    that.currentItem = this.startingTrack;
    that.trackNumber = this.startingTrack;
  }

  // Toggle shuffle mode or not, and prepare for rebasing the playlist
  // upon changing to the next available song. NOTE that each function here
  // changes flags, so the logic must exclude any logic if a revert occurs.
  this.toggleShuffle = function() {
    if ( remakeList ) 
      return revertShuffle();  

    return shuffleMode ? disableShuffle() : enableShuffle();
  }

  // After toggling the list, the next/prev track action must trigger
  // the list getting remade, with the next desired track as the head.
  // This function will remake the list as needed.
  this.rebasePlayList = function(index) {
    if ( shuffleMode )
      that.current = reorder(that.current, index);

    that.currentItem = 0;    // Position to head of the list
    remakeList = false;    // Rebasing is finished.
  }

  // Signify to this object that at the next track change, it will be OK 
  // to reorder the current playlist starting at the next desired track.
  this.readyToRemake = function() {
    return remakeList;
  }

  // Are we in shuffle mode or not? If we just came out of shuffle mode,
  // the player object will want to know.
  this.isShuffled = function() {
    return shuffleMode;
  }

  // PlayList manipulation requires us to keep state on which track is     
  // playing. Player object state changes may need to update the current    
  // index in the FileList object as well.    
  this.set = function(index) {
    that.previousItem = that.currentItem;  
    that.currentItem = index;
    that.trackNumber = this.current[index]._index;    
  }

  // Get the "highlighted" track in the current playlist. After a shuffle,
  // this may not be the track that is currently playing.  
  this.get = function() {
    return that.currentItem;
  }

  // Helper: find the given index in the current playlist
  this.getIndex = function(index) {
    if ( that.isShuffled() ) {
      for ( let i=0; i < that.current.length; i++ )
        if ( that.current[i]._index === index )
          return i - 1;
    } else {
      return index;
    }
  }

  // Add a new song into the FileList object.
  // TODO: this should take objects, not files, as input
  //   Consider rewriting deshuffle to rely entirely on _index vals
  this.add = function(index, file) {
    that.previous = clone(that.current);
    that.previousItem = that.currentItem;

    // Update current list
    addFile(index, file, that.current, shuffleMode);

    // Update original list. Assume it doesn't start in shuffle
    addFile(index, file, that.original, false);

    // Update the previous list too. If readyToRemake, that means
    // the last list is the opposite shuffleMode of the current.
    if ( remakeList )
      addFile(index, file, that.previous, !shuffleMode);
    else
      addFile(index, file, that.previous, shuffleMode);

    // Shift currentItem if the insert file is earlier in the list
    if ( index <= that.currentItem || that.currentItem === -1 )
      that.currentItem = that.currentItem + 1;

    that.trackNumber = that.current[that.currentItem]._index;
  }

  // Remove a song from the FileList object.
  this.remove = function(index) {
    that.previous = clone(that.current);
    that.previousItem = that.currentItem;

    // Remove from current array
    removeFile(index, that.current, shuffleMode);      

    // Remove from the unshuffled array as well
    removeFile(index, that.original, shuffleMode);      

    // Update previous list too
    removeFile(index, that.previous, remakeList ? !shuffleMode : shuffleMode);

    // Stay at the same song index, unless currentItem is after the
    // removed index, or was removed at the edge of the list 
    if (( index < that.currentItem ) || ( index >= that.previous.length - 1))
      if ( that.currentItem > 0 )
        that.currentItem = that.currentItem - 1;

    that.trackNumber = that.current[that.currentItem]._index;
  }

  // Get an array of songfile paths from this object, appropriate for 
  // including in a Player object.
  this.files = function() {
    return that.current.map(function (song) { return song.file });
  }

  if (this.original.length > 0) {
    // Add _index parameter to the JSON array of tracks
    this.original = addIndices(this.original);

    // Set displayed song number to whatever the current-playing index is
    this.trackNumber = this.original[this.startingTrack]._index;

    // Create the current playing list, based on startingTrack and shuffleMode.
    if ( shuffleMode ) {
      // If shuffle mode is on, shuffle the starting list
      this.current = clone(this.original);
      enableShuffle();
    } else {
      // On object creation, make current list use startingTrack as head of list
      this.current = reorder(this.original, this.startingTrack);
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
//     useHTML5Audio (default = false on mobile browsers, true otherwise)
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
let scrubWidth = 0;
let scrubPosition = 0;
let isScrubbing = false;

// System
let initialized = false;
const isMobileBrowser = window.mobilecheck();

this.loop = ('loop' in options) && (options.loop);
this.useWebAudio = ('useWebAudio' in options) ? options.useWebAudio : true;
this.useHTML5Audio = ('useHTML5Audio' in options) ? options.useHTML5Audio : !isMobileBrowser;
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
let inCallback = false;
const that = this;
let isPlayButton = true;
let isShuffleActive = false;
const keyMappings = {};

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
const getUIPos = function () {
  const position = isScrubbing ? scrubPosition : that.sources[dispIndex()].getPosition();
  return (position / that.sources[dispIndex()].getLength()) * scrubSize;
};

const getSoundPos = function (uiPosition) {
  return ((uiPosition / scrubSize) * that.sources[dispIndex()].getLength());
};

const numTracks = function () {
  // FileList object must be initiated
  if ( that.sources.length > 0 && that.trk !== null )
    return that.trk.current.length;
  else
    return 0;
};

// Index for calculating actual playlist location
const index = function () {
  // FileList object must be initiated
  if ( that.trk !== null )
    return that.trk.get();
  else
    return -1;
};

// Index for displaying the currently playing
// track, suitable for use in update functions
const dispIndex = function () {
  const maxIndex = that.sources.length - 1;
  if ( readyToRemake() )
    return Math.min(that.trk.previousItem, maxIndex);
  else if ( that.trk !== null )
    return Math.min(that.trk.get(), maxIndex);
  else
    return -1;
}

const readyToRemake = function () {
  // FileList object must be initiated
  if ( that.trk.readyToRemake() !== null )
    return that.trk.readyToRemake();
  else
    return false;
};

const getFormattedTime = function (inMS) {
  let minutes = Math.floor(inMS / 60000);
  const seconds_full = (inMS - (minutes * 60000)) / 1000;
  let seconds = Math.floor(seconds_full);
  let csec = Math.floor((seconds_full - seconds) * 100);
  
  if (minutes < 10) { minutes = "0" + minutes; }
  if (seconds < 10) { seconds = "0" + seconds; }
  if (csec < 10) { csec = "0" + csec; }
  
  return minutes + ':' + seconds + '.' + csec;
};

const getTotalPositionText = function () {
  let text = statusText.loading;
  if (that.sources.length === 0) {
    return text;
  } 
  const source = that.sources[dispIndex()];
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

const runCallback = function (cb) {
  if (cb) {
    inCallback = true;
    cb();
    inCallback = false;
  }
};

// after shuffle mode toggle and track change, re-grab the tracklist
const refreshTracks = function(newIndex) {
  // prevent updates while tracks are coming in
  initialized = false;

  that.removeAllTracks(false);
  that.trk.rebasePlayList(newIndex);

  const tracks = that.getTracks();
  for (let i = 0; i < tracks.length; i++ ) {
    that.addInitialTrack(tracks[i]);
  }

  // re-enable GUI updates
  initialized = true;
};

// Determines how and when the next track should be loaded.
this.dequeueNextLoad = function() {
  if (that.loadQueue.length > 0) {
    const entry = that.loadQueue.shift();
    that.loadingTrack = entry[0];
    if (that.loadingTrack < that.sources.length) {
      that.sources[that.loadingTrack].load(entry[1]);
    }
  } else {
    that.loadingTrack = -1;
  }
}

// (PUBLIC) ACTIONS
this.totalTracks = function() {
  return numTracks();
}

this.mapKeys = function (options) {
  for (let key in options) {
    const uppercode = options[key].toUpperCase().charCodeAt(0);
    const lowercode = options[key].toLowerCase().charCodeAt(0);
    const player = gapless5Players[that.id];
    if (player.hasOwnProperty(key)) {
      keyMappings[uppercode] = player[key];
      keyMappings[lowercode] = player[key];
    } else {
      console.error(`Gapless5 mapKeys() error: no function named '${key}'`);
    }
  }
  $(window).keydown(function(e) {
    if (e.keyCode in keyMappings) {
      keyMappings[e.keyCode](e);
    }
  });
};

this.setGain = function (uiPos) {
  const normalized = uiPos / scrubSize;
  gainNode.gain.value = normalized;
  that.sources[dispIndex()].setGain(normalized);
};

this.scrub = function (uiPos) {
  scrubPosition = getSoundPos(uiPos);
  $("#currentPosition" + that.id).html(getFormattedTime(scrubPosition));
  enableButton('prev', that.loop || (index() !== 0 || scrubPosition !== 0));
  if (!isScrubbing) {
    that.sources[dispIndex()].setPosition(scrubPosition, true);
  }
};

this.setLoadedSpan = function(percent) {
  $("#loaded-span" + that.id).width(percent * scrubWidth);
  if (percent === 1) {
    $("#totalPosition" + that.id).html(getTotalPositionText());
  }
};

this.onEndedCallback = function() {
  // we've finished playing the track
  resetPosition();
  that.sources[dispIndex()].stop(true);
  if (that.loop || index() < numTracks() - 1) {
    that.next(true);
    runCallback(that.onfinishedtrack);
  } else {
    runCallback(that.onfinishedtrack);
    runCallback(that.onfinishedall);
  }
};

this.onStartedScrubbing = function() {
  isScrubbing = true;
};

this.onFinishedScrubbing = function() {
  isScrubbing = false;
  const newPosition = scrubPosition;
  if (that.sources[dispIndex()].inPlayState() && newPosition >= that.sources[dispIndex()].getLength()) {
    that.next(true);
  } else {
    that.sources[dispIndex()].setPosition(newPosition, true);
  }
};

// Assume the FileList already accounts for this track, and just add it to the
// loading queue. Until that.sources[] lives in the FileList object, this compromise
// ensures addTrack/removeTrack functions can modify the FileList object when
// called by Gapless applications.
this.addInitialTrack = function(audioPath) {
  const next = that.sources.length;
  that.sources[next] = new Gapless5Source(this, context, gainNode);
  that.loadQueue.push([next, audioPath]);
  if (that.loadingTrack === -1) {
    that.dequeueNextLoad();
  }
  if (initialized) {
    updateDisplay();
  }
};

this.addTrack = function (audioPath) {
  const next = that.sources.length;
  that.sources[next] = new Gapless5Source(this, context, gainNode);
  // TODO: refactor to take an entire JSON object
  // TODO: move this function to the fileList object
  that.trk.add(next, audioPath);
  that.loadQueue.push([next, audioPath]);
  if (that.loadingTrack === -1) {
    that.dequeueNextLoad();
  }
  if (initialized) {
    updateDisplay();
  }
};

this.insertTrack = function (point, audioPath) {
  const trackCount = numTracks();
  point = Math.min(Math.max(point, 0), trackCount);
  if (point === trackCount) {
    that.addTrack(audioPath);
  } else {
    that.sources.splice(point, 0, new Gapless5Source(this, context, gainNode));
    // TODO: refactor to take an entire JSON object
    // TODO: move this function to the fileList object
    that.trk.add(point, audioPath);
    //re-enumerate queue
    for (let i in that.loadQueue) {
      const entry = that.loadQueue[i];
      if (entry[0] >= point) {
        entry[0] += 1;
      }
    }
    that.loadQueue.splice(0,0,[point,audioPath]);
    updateDisplay();
  }
};

this.getTracks = function () {
  return that.trk.files();
};

this.findTrack = function (path) {
  return that.getTracks().indexOf(path);
};

this.removeTrack = function (pointOrPath) {
  const point = (typeof pointOrPath === 'string') ?
    that.findTrack(pointOrPath) :
    pointOrPath;

  if (point < 0 || point >= that.sources.length) return;

  const curSource = that.sources[point];
  let wasPlaying = false;

  if (curSource.getState() === Gapless5State.Loading) {
    curSource.cancelRequest();
  } else if (curSource.getState() === Gapless5State.Play) {
    wasPlaying = true;
    curSource.stop();
  }
  
  let removeIndex = -1;
  for (let i in that.loadQueue) {
    const entry = that.loadQueue[i];
    if (entry[0] === point) {
      removeIndex = i;
    } else if (entry[0] > point) {
      entry[0] -= 1;
    }
  }
  if (removeIndex >= 0) {
    that.loadQueue.splice(removeIndex,1);
  }
  // TODO: move this functionality into the FileList object
  that.sources.splice(point, 1);
  that.trk.remove(point);

  if (that.loadingTrack === point) {
    that.dequeueNextLoad();
  }
  if ( point === that.trk.currentItem ) {
    that.next();  // Don't stop after a delete
    if ( wasPlaying )
      that.play();
  }

  if (initialized) {
    updateDisplay();
  }
};

this.replaceTrack = function (point, audioPath) {
  that.removeTrack(point);
  that.insertTrack(point, audioPath);
}

this.removeAllTracks = function (flushPlaylist = true) {
  for (let i = 0; i < that.sources.length; i++) {
    if (that.sources[i].getState() === Gapless5State.Loading) {
      that.sources[i].cancelRequest();
    }
    that.sources[i].stop();
  }
  if (flushPlaylist) {
    that.trk.removeAllTracks();
  }
  that.loadingTrack = -1;
  // TODO: move this function into the FileList object
  that.sources = [];
  that.loadQueue = [];
  if (initialized) {
    updateDisplay();
  }
};

this.isShuffled = function() { 
  return that.trk.isShuffled();
};

this.toggleShuffle = function() {
  if (!isShuffleActive) return;

  that.trk.toggleShuffle();

  if (initialized) {
    updateDisplay();
  }
};
// backwards-compatibility with previous function name
this.shuffleToggle = this.toggleShuffle;

this.gotoTrack = function (pointOrPath, bForcePlay) {
  if (inCallback) return;
  const newIndex = (typeof pointOrPath === 'string') ?
    that.findTrack(pointOrPath) :
    pointOrPath;

  let justRemade = false;

  // If the list is flagged for remaking on the change of shuffle mode, 
  // remake the list in shuffled order
  if ( readyToRemake() ) {
    // just changed our shuffle mode. remake the list
    refreshTracks(newIndex);
    justRemade = true;
  }

  const trackDiff = newIndex - index();

  // No shuffle / unshuffle occurred, and we're just restarting a track
  if (trackDiff === 0 && !justRemade) {
    resetPosition();
    if ((bForcePlay) || that.sources[index()].isPlayActive()) {
      that.sources[newIndex].play();
    }
  }

  // A shuffle or an unshuffle just occurred
  else if ( justRemade ) {
    that.trk.set(newIndex);
    that.sources[newIndex].load(that.getTracks()[newIndex]);
    that.sources[newIndex].play();

    updateDisplay();
  } else {
    // A normal track change just occurred
    const oldIndex = index();
    that.trk.set(newIndex);
    // Cancel any track that's in loading state right now
    if (that.sources[oldIndex].getState() === Gapless5State.Loading) {
      that.sources[oldIndex].cancelRequest();
      // TODO: better way to have just the file list?
      that.loadQueue.push([oldIndex, that.getTracks()[oldIndex]]);
    }

    resetPosition(true); // make sure this comes after currentIndex has been updated
    if (that.sources[newIndex].getState() === Gapless5State.None) {
      // TODO: better way to have just the file list?
      that.sources[newIndex].load(that.getTracks()[newIndex]);

      //re-sort queue so that this track is at the head of the list
      for (let i in that.loadQueue) {
        const entry = that.loadQueue.shift();
        if (entry[0] === newIndex) {
          break;
        }
        that.loadQueue.push(entry);
      }
    }
    updateDisplay();
    
    if ((bForcePlay) || that.sources[oldIndex].isPlayActive()) {
      that.sources[newIndex].play();
    }
    that.sources[oldIndex].stop(); // call this last

  }
  enableButton('prev', that.loop || (newIndex > 0));
  enableButton('next', that.loop || (newIndex < numTracks() - 1));
};

this.prevtrack = function () {
  if (that.sources.length === 0) return;
  if (index() > 0) {
    that.gotoTrack(index() - 1);
    runCallback(that.onprev);
  } else if (that.loop) {
    that.gotoTrack(numTracks() - 1);
    runCallback(that.onprev);
  }
};

this.prev = function () {
  if (that.sources.length === 0) return;
  if ( readyToRemake() ) {
    // jump to start of track that's in a new position
    // at the head of the re-made list.
    that.gotoTrack(0);
  } else if (that.sources[index()].getPosition() > 0) {
    // jump to start of track if we're not there
    that.gotoTrack(index());
  } else if (index() > 0) {
    that.gotoTrack(index() - 1);
    runCallback(that.onprev);
  } else if (that.loop) {
    that.gotoTrack(numTracks() - 1);
    runCallback(that.onprev);
  }
};

this.next = function (e) {
  if (that.sources.length === 0) return;
  const forcePlay = (e === true);
  if (index() < numTracks() - 1) {
    that.gotoTrack(index() + 1, forcePlay);
    runCallback(that.onnext);
  } else if (that.loop) {
    that.gotoTrack(0, forcePlay);
    runCallback(that.onnext);
  }
};

this.play = function () {
  if (that.sources.length === 0) return;
  if (that.sources[dispIndex()].audioFinished) {
    that.next(true);
  } else {
    that.sources[dispIndex()].play();
  }
  runCallback(that.onplay);
};

this.playpause = function (e) {
  if (isPlayButton)
    that.play(e);
  else
    that.pause(e);
}

this.cue = function (e) {
  if (!isPlayButton) {
    that.prev(e);
  } else if (that.sources[dispIndex()].getPosition() > 0) {
    that.prev(e);
    that.play(e);
  } else {
    that.play(e);
  }
}

this.pause = function (e) {
  if (that.sources.length === 0) return;
  that.sources[dispIndex()].stop();
  runCallback(that.onpause);
};

this.stop = function (e) {
  if (that.sources.length === 0) return;
  resetPosition();
  that.sources[dispIndex()].stop(true);
  runCallback(that.onstop);
};


// (PUBLIC) QUERIES AND CALLBACKS

this.isPlaying = function () {
  return that.sources[dispIndex()].inPlayState();
};

// INIT AND UI

const resetPosition = function(forceScrub) {
  if (!forceScrub && that.sources[dispIndex()].getPosition() === 0) return; // nothing else to do
  that.scrub(0);
  $("#transportbar" + that.id).val(0);
};

const enableButton = function (buttonId, bEnable) {
  if (bEnable) {
    $("#" + buttonId + that.id).removeClass('disabled');
    $("#" + buttonId + that.id).addClass('enabled');
  } else {
    $("#" + buttonId + that.id).removeClass('enabled');
    $("#" + buttonId + that.id).addClass('disabled');
  }
};

const enableShuffleButton = function (mode, bEnable) {
  const isShuffle = mode === "shuffle";
  const oldButtonClass = isShuffle ? "g5unshuffle" : "g5shuffle";
  const newButtonClass = isShuffle ? "g5shuffle" : "g5unshuffle";

  $("#" + "shuffle" + that.id).removeClass(oldButtonClass);
  $("#" + "shuffle" + that.id).addClass(newButtonClass);

  enableButton('shuffle', bEnable);
};

const updateDisplay = function () {
  const { id, trk, loop} = that;
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
    enableButton('prev', loop || index() > 0 || that.sources[index()].getPosition() > 0);
    enableButton('next', loop || index() < numTracks() - 1);

    if (that.sources[dispIndex()].inPlayState()) {
      enableButton('play', false);
      isPlayButton = false;
    } else {
      enableButton('play', true);
      isPlayButton = true;

      if (that.sources[dispIndex()].getState() === Gapless5State.Error) {
        runCallback(that.onerror);
      }
    }

    // Must have at least 3 tracks in order for shuffle button to work
    // If so, permanently turn on the shuffle toggle
    if (that.trk.current.length > 2) {
      isShuffleActive = true;
    }
    enableShuffleButton(that.trk.isShuffled() ? 'unshuffle' : 'shuffle', isShuffleActive);
    that.sources[index()].uiDirty = false;
  }
};

const Tick = function() {
  if (numTracks() > 0) {
    that.sources[dispIndex()].tick();

    if (that.sources[dispIndex()].uiDirty) {
      updateDisplay();
    }
    if (that.sources[dispIndex()].inPlayState()) {
      let soundPos = that.sources[dispIndex()].getPosition();
      if (isScrubbing) {
        // playing track, update bar position
        soundPos = scrubPosition;
      }
      $("#transportbar" + that.id).val(getUIPos());
      $("#currentPosition" + that.id).html(getFormattedTime(soundPos));
    }
  }
  window.setTimeout(function () { Tick(); }, tickMS);
};

const createGUI = function (playerHandle) {
  const { id } = that;
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

  const volumeHtml = isMobileBrowser ? 
    '<button class="g5button volumedisabled" />' :
    `<input type="range" class="volume" name="gain" min="0" max="${scrubSize}" value="${scrubSize}" oninput="${playerHandle}.setGain(this.value);" />`;
  
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
      ${volumeHtml}
    </div>
  `);
};

const Init = function(guiId, options) {
  const guiElement = guiId ? $("#" + guiId) : [];
  const { id } = that;
  gapless5Players[id] = that;

  if (guiElement.length > 0) {
    const playerHandle = `gapless5Players[${id}]`;
    guiElement.html(createGUI(playerHandle));

    // css adjustments
    if (!isMobileBrowser && navigator.userAgent.indexOf('Mac OS X') === -1) {
      $("#transportbar" + id).addClass("g5meter-1pxup");
      $("#g5buttons" + id).addClass("g5buttons-1pxup");
    }
    if (isMobileBrowser) {
      $("#transportbar" + id).addClass("g5transport-1pxup");
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
    scrubWidth = $("#transportbar" + id).width();
  }

  if (typeof Audio === "undefined") {
    console.error("This player is not supported by your browser.")
    return;
  }

  // set up starting track number
  if ('startingTrack' in options) {
    if (typeof options.startingTrack === 'number') {
      that.startingTrack = options.startingTrack;
    } else if ((typeof options.startingTrack === 'string') && (options.startingTrack === "random")) {
      that.startingTrack = "random";
    }
  }

  // set up key mappings
  if ('mapKeys' in options) {
    that.mapKeys(options['mapKeys']);
  }
  
  // set up whether shuffle is enabled when the player loads (default is false)
  const shuffleOnInit = ('shuffle' in options) && options.shuffle;
  
  // set up tracks into a FileList object
  if ('tracks' in options) {
    const setupTracks = function(player) {
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
        startingTrack = that.startingTrack || 0;
      }
    } else if (typeof options.tracks === 'string') {
      items[0] = { file: options.tracks };
    }
    that.trk = new Gapless5FileList(items, startingTrack, shuffleOnInit);
    setupTracks(that);
  } else {
    that.trk = new Gapless5FileList([], -1, shuffleOnInit);
  }

  initialized = true;
  updateDisplay();

  // autostart if desired
  const playOnLoad = ('playOnLoad' in options) && options.playOnLoad;
  if (playOnLoad && (that.trk.current.length > 0)) {
    that.sources[index()].play();
  }
  Tick();
};

$(document).ready(Init(elem_id, options));
};
