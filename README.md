Gapless 5 &nbsp; <img src="https://ccrma.stanford.edu/~regosen/gapless5.gif" width="123" height="51">
=========

A gapless JavaScript/CSS audio player for HTML5

**PROBLEM**: There are 2 modern API's for playing audio through the web, and both of them have problems:

- **HTML5 Audio**: the last chunk of audio gets cut off, making gapless transitions impossible
- **WebAudio**: can't play a file until it's fully loaded

**SOLUTION**: Use both!

- If WebAudio hasn't fully loaded yet, it begins playback with HTML5 Audio, then seamlessly switches to WebAudio once loaded.
- *NOTE: Most mobile browsers don't fully support HTML5 Audio objects in js, so we're stuck with only WebAudio in that case.*


Getting Started
-----
Gapless 5 is a registered bower package, so installation is as simple as:
```
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
- no Flash!


Browser Support
---------------

- Safari
  - tested on OSX and iOS
- Chrome
  - not tested on Android yet
- Firefox
- *unsupported on IE*
  - can't seem to programmatically create audio objects

*NOTE for Boostrap users: Bootstrap's css will mess up the player's look.  If you don't need Bootstrap in its entirety, try using Twitter customize to get just the subset of rules you need.*

Setup
-----

1. **HTML head**: reference the following
  - jQuery (1.0 or greater, must be referenced before Gapless5.js)
  - Gapless5.js
  - Gapless5.css
2. **HTML body**
  - create any element with a particular id
3. **JavaScript**
  - create a Gapless5 object, passing the above id as a parameter
  - add tracks using addTrack() or via options (see below)
  - optional stuff:
    - manipulate tracklist with insertTrack(), replaceTrack(), removeTrack(), and removeAllTracks() (see example)
    - register callbacks (see below)
    - link keys to actions using mapKeys() or via options (see below)

Example:
```
<head>
  <link href="gapless5.css" rel="stylesheet" type="text/css" />
  <script src="//code.jquery.com/jquery-1.10.2.min.js" language="JavaScript" type="text/javascript"></script>
  <script src="gapless5.js" language="JavaScript" type="text/javascript"></script>
</head>
<body>
  <div id="gapless5-block" />
  <script type="text/javascript"><!--

    var player = new Gapless5("gapless5-block");
    player.addTrack("audio/song1.mp3");
    player.addTrack("audio/song2.mp3");

    // extra stuff to manipulate tracklist, indexes start at 0!
    player.replaceTrack(0, "audio/song1_alt.mp3");
    player.insertTrack(1, "audio/transition.mp3");
    player.removeTrack(2); // removes third track
    player.removeAllTracks(); // clear all tracks

    player.mapKeys({cue: "7", stop: "8", next: "9"});

  --></script>
</body>
```


Options
-------

- **tracks**
  - path to audio file(s)
  - can be an array, or a single track as a string
- **loop** (loops playlist)
  - default = false
- **playOnLoad** (plays immediately when you open the page)
  - default = false
- **useHTML5Audio**
  - default = false on mobile browsers, true otherwise
- **useWebAudio**
  - default = true
  - if you don't care about gapless playback, set useWebAudio to false for better performance
- **mapKeys**
  - pressing specified key (case-insensitive) will trigger specified action.
  - Actions that behave like the buttons:
    - **prev**: matches behavior of "prev" button (scrubs to start if you've progressed into a track)
    - **playpause**: matches behavior of "play/pause" button
    - **stop**: matches behavior of "stop" button
    - **next**: matches behavior of "next" button
  - Actions that differ from the buttons:
    - **prevtrack**: unlike "prev" button, this will always jump to the previous track
    - **cue**: play from start
    - **play**: non-togglable "play"
    - **pause**: non-togglable "pause"

Example:

```
var player = new Gapless5("gapless5-block", {
  tracks: ["loop1.mp3", "loop2.mp3"],
  loop: true,
  playOnLoad: true,
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
- onerror
- onfinishedtrack
- onfinishedall

Example:

```
function prevCallback() {
  console.log("user clicked 'prev'");
}

player = new Gapless5('gapless5-block', {tracks: ["track1.mp3", "track2.mp3"]});
player.onprev = prevCallback;
player.onnext = function () { console.log("user clicked 'next'"); };
```

License
-------

Licensed under the MIT License.
