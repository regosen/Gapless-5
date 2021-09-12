Gapless 5 &nbsp; <img src="https://ccrma.stanford.edu/~regosen/gapless5.gif" width="123" height="51">
=========

A gapless JavaScript/CSS audio player for HTML5

**PROBLEM**: There are 2 modern APIs for playing audio through the web, and both of them have problems:

- **HTML5 Audio**: the last chunk of audio gets cut off, making gapless transitions impossible
- **WebAudio**: can't play a file until it's fully loaded

**SOLUTION**: Use both!

- If WebAudio hasn't fully loaded yet, it begins playback with HTML5 Audio, then seamlessly switches to WebAudio once loaded.

Getting Started
-----
Gapless 5 is a registered bower package, so installation is as simple as:
```shell
 $ bower install gapless5 --save
```


Demos
-----

- Gapless 5 demonstration page.  It utilizes key mappings for cueing and other transport bar features. <br/>https://ccrma.stanford.edu/~regosen/gapless5

- Relisten: a listening site for live music sets (currently featuring Phish)
<br/>http://relisten.net/gapless

- Listening page for Zen Finger Painting's latest album.  It utilizes several callbacks to interact with the rest of the page. <br/>http://www.zenfingerpainting.com


Features
--------

- player can have multiple tracks
- page can have multiple players
- seamless transitions between tracks
  - pre-loading of subsequent tracks
  - files don't need to be fully loaded to start playback
- UI is optional
- no Flash!


Browser Support
---------------

- Safari (including iOS)
- Chrome (including Android)
- Firefox

*NOTE for Boostrap users: Bootstrap's css will mess up the player's look.  If you don't need Bootstrap in its entirety, try using Twitter customize to get just the subset of rules you need.*

Setup
-----

1. **HTML head**: reference the following:
  - `Gapless5.js`
  - _(Optional: if using built-in UI)_ `Gapless5.css`
2. **HTML body**
  - _(Optional: if using built-in UI)_ create a `<div>` or `<span>` element where you want the player to appear.  Give it a particular id.
3. **JavaScript** (examples and full reference below)
  - Create a `Gapless5` object, with the above id and options if desired.
    - id can be omitted or an empty string if you don't want the built-in UI.
  - Add tracks via options in constructor or `addTrack()`
  - Optional stuff:
    - Manipulate tracklist with `insertTrack()`, `removeTrack()`, and more.
    - Register your own callbacks.
    - Connect key presses to actions using `mapKeys()` or options in constructor.

Example:
```html
<head>
  <link href="gapless5.css" rel="stylesheet" type="text/css" />
  <script src="gapless5.js" language="JavaScript" type="text/javascript"></script>
</head>
<body>
  <div id="gapless5-player-id" />
  <script type="text/javascript"><!--

    const player = new Gapless5("gapless5-player-id");

    // You can add tracks by relative or absolute URL:
    player.addTrack("audio/song1.mp3");
    player.addTrack("https://my-audio-site.org/song2.m4a");

    // You can also add tracks from the file loader like this:
    const files = document.getElementById("my-file-input").files;
    files.forEach(file => {
      player.addTrack(URL.createObjectURL(file)); // this creates a "blob://" URL
    });
    player.play();

  --></script>
  <form>
    <input type="file" id="my-file-input" accept="audio/*">
  </form>
</body>
```


Functions
---------

Functions with parameters:
- **addTrack(audioPath)**
  - adds track to end of playlist
  - `audioPath`: path to audio file(s) or blob URL(s), see examples above
- **insertTrack(index, audioPath)**
  - inserts track at location `index`
  - `audioPath`: same as in addTrack
- **replaceTrack(index, audioPath)**
  - replaces track at location `index`
  - `audioPath`: same as in addTrack
- **gotoTrack(indexOrPath)**
  - jumps to specified track
  - `indexOrPath` can be the numerical index, or audio path
- **removeTrack(indexOrPath)**
  - removes specified track from playlist
  - `indexOrPath` can be the numerical index, or audio path
- **mapKeys(jsonMapping)**
  - pressing specified key (case-insensitive) will trigger any Action function listed below.
  - `jsonMapping` maps an action to a key, see example code below

Functions that return the current state:
- **isShuffled()**
  - returns true if shuffled
- **getTracks()**
  - returns list of audioPaths in play order
  - if shuffled, the shuffled order will be reflected here
- **findTrack(audioPath)**
  - returns index of track in playlist


Actions (these can be mapped to keys via mapKeys):

*These correspond to built-in UI buttons*
- **prev()**: matches behavior of "prev" button (scrubs to start if you've progressed into a track)
- **playpause()**: matches behavior of "play/pause" button
- **stop()**: matches behavior of "stop" button
- **toggleShuffle()**: switches between shuffled and un-shuffled
  - subsequent shuffles will be different each time
- **next()**: matches behavior of "next" button

*These do not correspond to built-in UI buttons*
- **prevtrack()**: unlike "prev" button, this will always jump to the previous track
- **cue()**: play from start
- **play()**: non-togglable "play"
- **pause()**: non-togglable "pause"
- **shuffle(preserveCurrent = true)**: non-togglable shuffle, re-shuffles if previously shuffled
  - if **preserveCurrent** is false, it will shuffle all tracks (without preserving current track)
- **removeAllTracks()**: clears entire playlist

Example:
```js
player.mapKeys({cue: "7", stop: "8", next: "9"});

player.play();
player.pause();

// indexes start at 0
player.replaceTrack(0, "audio/song1_alt.flac");
player.insertTrack(1, "audio/transition.wav");

player.gotoTrack(1);
player.gotoTrack("audio/song1_alt.flac"); // can also goto track by path

player.removeTrack(2);
player.removeTrack("audio/transition.wav"); // can also remove track by path
player.removeAllTracks();
```
Options
-------

- **tracks**
  - path to audio file(s) or blob URL(s), see examples above
  - can be a single track as a string, an array, or a JSON object containing an array of JSON objects
- **loop**
  - default = false
  - loops after end of list/track
- **singleMode**
  - default = false
  - plays/loops single track only
- **exclusive**
  - default = false
  - stops other Gapless5 players when this one is playing
- **playOnLoad**
  - default = false
  - play immediately once first track is loaded
  - *NOTE: user must have interacted with the page before we can autoplay (per browser policy)*
- **startingTrack**
  - default: 0
  - either an array index into the tracks array, or the string "random" for a random index
- **shuffleButton**
  - default = true
  - adds shuffle button to the player UI
- **shuffle**
  - default = false
  - enables shuffle mode immediately after playlist load
- **useHTML5Audio**
  - default = true
- **useWebAudio**
  - default = true
  - if you don't care about gapless playback, set useWebAudio to false for better performance
- **mapKeys**
  - pressing specified key (case-insensitive) will trigger any Action function listed above.
- **logLevel**
  - minimum logging level (default = `LogLevel.Info`)
  - set this to `LogLevel.Debug` for more verbose logging

Example:

```js
const player = new Gapless5("gapless5-player-id", {
  tracks: ["loop1.mp3", "loop2.mp3"],
  loop: true,
  mapKeys: {prev: "a", playpause: "s", stop: "d", next: "f"}
});
```

Callbacks
---------

- onprev
- onplay
- onpause
- onstop
- onnext
- onload
- onerror
- onfinishedtrack
- onfinishedall

Example:

```js
function prevCallback() {
  console.log("user clicked 'prev'");
}

const player = new Gapless5('gapless5-player-id', {tracks: ["track1.mp3", "track2.mp3"]});
player.onprev = prevCallback;
player.onnext = function () { console.log("user clicked 'next'"); };
```

License
-------

Licensed under the MIT License.
