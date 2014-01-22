Gapless 5 &nbsp; <img src="https://ccrma.stanford.edu/~regosen/gapless5.gif" width="123" height="51">
=========

Gapless JavaScript/CSS audio player for HTML5
(requires jQuery 1.x or greater)

**PROBLEM**: There are 2 modern API's for playing audio through the web, and both of them have problems:

- **HTML5 Audio**: the last chunk of audio gets cut off, making gapless transitions impossible
- **WebAudio**: can't play a file until it's fully loaded

**SOLUTION**: Use both!

- If WebAudio hasn't fully loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.
- NOTE: Mobile browsers don't fully support Audio objects in js, so we're stuck with only WebAudio in that case.




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


Demos
-----

- Listening page for Zen Finger Painting's latest album.  It utilizes several callbacks to interact with the rest of the page: http://www.zenfingerpainting.com


Setup
-----

1. HTML head: reference the following...
  - jQuery (must come before Gapless5.js)
  - Gapless5.js
  - Gapless5.css
2. HTML body
  - create an element with a particular id
3. JavaScript
  - create a Gapless5 object, passing the above id as a parameter
  - add tracks using addTrack() or via options (see below)
    - you can also register callbacks (see below)

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

  --></script>
</body>
```


Options
-------

- **tracks**
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

Example:

```
var player = new Gapless5("gapless5-block", {
  tracks: ["loop1.mp3", "loop2.mp3"], 
  loop: true, 
  playOnLoad: true
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
