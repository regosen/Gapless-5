//////////////
//
// Gapless 5: Gapless JavaScript/CSS audio player for HTML5
// (requires jQuery 1.x or greater)
//
// Version 0.5
// Copyright 2014 Rego Sen
//
//////////////

// PROBLEM: We have 2 API's for playing audio through the web, and both of them have problems:
//          - HTML5 Audio: the last chunk of audio gets cut off, making gapless transitions impossible
//          - WebAudio: can't play a file until it's fully loaded
// SOLUTION: Use both!
// If WebAudio hasn't loaded yet, start playback with HTML5 Audio.  Then seamlessly switch to WebAudio once it's loaded.

// NOTE: Mobile browsers don't fully support Audio objects in js, so we're stuck with only WebAudio in that case.
window.mobilecheck = function() {
	// taken from http://detectmobilebrowsers.com
	var check = false;
	(function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od|ad)|iris|kindle|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4)))check = true})(navigator.userAgent||navigator.vendor||window.opera);
	return check; }
window.hasWebKit = ('webkitAudioContext' in window) && !('chrome' in window);

// There can be only one AudioContext per window, so to have multiple players we must define this outside the player scope
var gapless5AudioContext = (window.hasWebKit) ? new webkitAudioContext() : (typeof AudioContext != "undefined") ? new AudioContext() : null;


var GAPLESS5_PLAYERS = {};
var Gapless5State = {
	"None"    : 0,
	"Loading" : 1,
	"Play"    : 2,
	"Stop"    : 3,
	"Error"   : 4
	};

// A Gapless5Source "class" handles track-specific audio requests
function Gapless5Source(parentPlayer, inContext, inOutputNode) {

	// WebAudio API
	var context = inContext;
	var outputNode = inOutputNode;
	var audioPath = "";

	// Audio object version
	var audio = null;

	// Buffer source version
	var source = null;
	var buffer = null;
	var request = null;

	// states
	var startTime = 0;
	var position = 0;
	var endpos = 0;
	var queuedState = Gapless5State.None;
	var state = Gapless5State.None;
	var loadedPercent = 0;
	var audioFinished = false;

	this.uiDirty = false;
	var that = this;
	var parent = parentPlayer;

	this.setGain = function (val) {
		if (audio != null)
		{
			audio.volume = val;
		}
	}

	this.getState = function () { return state; }

	var setState = function (newState) {
		state = newState;
		queuedState = Gapless5State.None;
	};

	this.cancelRequest = function (isError) {
		setState((isError == true) ? Gapless5State.Error : Gapless5State.None);
		if (request)
		{
			request.abort();
		}
		audio = null;
		source = null;
		buffer = null;
		position = 0;
		endpos = 0;
		that.uiDirty = true;
	}

	var onEnded = function (endEvent) {
		if (state != Gapless5State.Play) return;
		audioFinished = true;
		parent.onEndedCallback();
	}

	var onPlayEvent = function (playEvent) {
		startTime = (new Date().getTime()) - position;
	}

	var onLoadedWebAudio = function (inBuffer) {
		if (!request) return;
		request = null;
		buffer = inBuffer;
		endpos = inBuffer.duration * 1000;
		if (audio != null || !parent.useHTML5Audio)
		{
			parent.dequeueNextLoad();
		}

		if (queuedState == Gapless5State.Play && state == Gapless5State.Loading)
		{
			playAudioFile(true);
		}
		else if ((audio != null) && (queuedState == Gapless5State.None) && (state == Gapless5State.Play))
		{
			//console.log("switching from HTML5 to WebAudio");
			position = (new Date().getTime()) - startTime;
			if (!window.hasWebKit) position -= parent.tickMS;
			that.setPosition(position, true);
		}
		if (state == Gapless5State.Loading)
		{
			state = Gapless5State.Stop;
		}
		// once we have WebAudio data loaded, we don't need the HTML5 audio stream anymore
		audio = null;
		that.uiDirty = true;
	}

	var onLoadedHTML5Audio = function (inBuffer) {
		if (state != Gapless5State.Loading) return;
		if (buffer != null || !parent.useWebAudio)
		{
			parent.dequeueNextLoad();
		}

		state = Gapless5State.Stop;
		endpos = audio.duration * 1000;

		if (queuedState == Gapless5State.Play)
		{
			playAudioFile(true);
		}
		that.uiDirty = true;
	}

	this.stop = function () {
		if (state == Gapless5State.Stop) return;
		
		if (parent.useWebAudio)
		{
			if (source)
			{
				source.onended = null;
				if (window.hasWebKit) 
					source.noteOff(0);
				else 
					source.stop(0);
			}
		}
		if (audio)
		{
			audio.pause();
		}

		setState(Gapless5State.Stop);
		that.uiDirty = true;
	};

	var playAudioFile = function (force) {
		if (state == Gapless5State.Play) return;
		if (position >= endpos) position = 0;

		var offsetSec = position / 1000;
		startTime = (new Date().getTime()) - position;

		if (buffer != null)
		{
			//console.log("playing WebAudio");
			source = context.createBufferSource();
			source.connect(outputNode);
			source.buffer = buffer;
			source.onended = onEnded;

			var offsetSec = position / 1000;
			var restSec = source.buffer.duration-offsetSec;
			if (window.hasWebKit)
				source.noteGrainOn(0, offsetSec, restSec);
			else
				source.start(0, offsetSec);
			setState(Gapless5State.Play);
		}
		else if (audio != null)
		{
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
		return (state == Gapless5State.Play); 
	}

	this.isPlayActive = function() {
		return (that.inPlayState() || queuedState == Gapless5State.Play) && !that.audioFinished; 
	}

	this.getPosition = function() { return position; }

	this.getLength = function() { return endpos; }

	this.play = function() {
		if (state == Gapless5State.Loading)
		{
			queuedState = Gapless5State.Play;
		}
		else
		{
			playAudioFile(); // play immediately
		}
	}

	this.tick = function() {
		if (state == Gapless5State.Play)
		{
			position = (new Date().getTime()) - startTime;
		}

		if (loadedPercent < 1)
		{
			var newPercent = (state == Gapless5State.Loading) ? 0 : (audio && audio.seekable.length > 0) ? (audio.seekable.end(0) / audio.duration) : 1;
			if (loadedPercent != newPercent)
			{
				loadedPercent = newPercent;
				parent.setLoadedSpan(loadedPercent)
			}
		}
	}

	this.setPosition = function(newPosition, bResetPlay) {
		position = newPosition;
		if (bResetPlay == true && that.inPlayState())
		{
			that.stop();
			that.play();
		}
	};

	this.load = function(inAudioPath) {
		audioPath = inAudioPath;
		if (source || audio)
		{
			parent.dequeueNextLoad();
			return;
		}
		if (state == Gapless5State.Loading)
		{
			return;
		}
		state = Gapless5State.Loading;
		if (parent.useWebAudio)
		{
			request = new XMLHttpRequest();
			request.open('get', inAudioPath, true);
			request.responseType = 'arraybuffer';

			request.onload = function () {
				context.decodeAudioData(request.response,
					 function(incomingBuffer) {
						 onLoadedWebAudio(incomingBuffer);
					 }
				 );
			};
			request.send();
		}
		if (parent.useHTML5Audio)
		{
			audio = new Audio();
			audio.controls = false;
			audio.src = inAudioPath;
	 		audio.addEventListener('canplaythrough', onLoadedHTML5Audio, false);
	 		audio.addEventListener('ended', onEnded, false);
	 		audio.addEventListener('play', onPlayEvent, false);
 			// not using audio.networkState because it's not dependable on all browsers
		}
		// cancel if url doesn't exist
		$.get(inAudioPath).fail(function() { 
	        that.cancelRequest(true);
	    })
	}
}


// parameters are optional.  options:
//   tracks: path of file (or array of music file paths)
//   playOnLoad (default = false): play immediately
//   useWebAudio (default = true)
//   useHTML5Audio (default = false on mobile browsers, true otherwise)
var Gapless5 = function(elem_id, options) {

// MEMBERS AND CONSTANTS

// PUBLIC
this.tracks = [];
this.tickMS = 27; // fast enough for numbers to look real-time

// PRIVATE

// UI
var SCRUB_RESOLUTION = 65535;
var SCRUB_WIDTH = 0;
var scrubPosition = 0;
var isScrubbing = false;
var LOAD_TEXT = "loading..."
var ERROR_TEXT = "error!"

// System
var initialized = false;
var isMobileBrowser = window.mobilecheck();
this.loop = (options != null) && (options.loop == true);
this.useWebAudio = ((options != null) && ('useWebAudio' in options)) ? options.useWebAudio : true;
this.useHTML5Audio = ((options != null) && ('useHTML5Audio' in options)) ? options.useHTML5Audio : !isMobileBrowser;
this.id = Math.floor((1 + Math.random()) * 0x10000);

// WebAudio API
var context = gapless5AudioContext;
var gainNode = (window.hasWebKit) ? context.createGainNode() : (typeof AudioContext != "undefined") ? context.createGain() : null;
if (context && gainNode)
{
	gainNode.connect(context.destination);
}

// Playlist
var trackIndex = (typeof startingTrack == 'undefined') ? 0 : startingTrack;
var loadingTrack = -1;
var sources = [];

// Callback and Execution logic
var inCallback = false;
var firstUICallback = true;
var that = this;
var isPlayButton = true;
var keyMappings = {};

// Callbacks
this.onprev = null;
this.onplay = null;
this.onpause = null;
this.onstop = null;
this.onnext = null;

this.onerror = null;
this.onfinishedtrack = null;
this.onfinishedall = null;


// INTERNAL HELPERS

var getUIPos = function () {
	var position = isScrubbing ? scrubPosition : sources[trackIndex].getPosition();
	return (position / sources[trackIndex].getLength()) * SCRUB_RESOLUTION;
};

var getSoundPos = function (uiPosition) {
	return ((uiPosition / SCRUB_RESOLUTION) * sources[trackIndex].getLength());
};

var numTracks = function () {
	return that.tracks.length;
};

var getFormattedTime = function (inMS) {
    var minutes = Math.floor(inMS / 60000);
    var seconds_full = (inMS - (minutes * 60000)) / 1000;
    var seconds = Math.floor(seconds_full);
    var csec = Math.floor((seconds_full - seconds) * 100);
    
    if (minutes < 10) { minutes = "0" + minutes; }
    if (seconds < 10) { seconds = "0" + seconds; }
    if (csec < 10) { csec = "0" + csec; }
    
    return minutes + ':' + seconds + '.' + csec;
};

var getTotalPositionText = function () {
	var text = LOAD_TEXT;
	var srcLength = sources[trackIndex].getLength();
	if (that.tracks.length == 0)
	{
		text = getFormattedTime(0);
	}
	else if (sources[trackIndex].getState() == Gapless5State.Error)
	{
		text = ERROR_TEXT;
	}
	else if (srcLength > 0)
	{
		text = getFormattedTime(srcLength);
	}
	return text;
};

var runCallback = function (cb) {
	if (cb)
	{
		inCallback = true;
		cb();
		inCallback = false;
	}
};

// (PUBLIC) ACTIONS

this.mapKeys = function (options) {
	for (var key in options)
	{
		var uppercode = options[key].toUpperCase().charCodeAt(0);
		var lowercode = options[key].toLowerCase().charCodeAt(0);
		var linkedfunc = null;
		var player = GAPLESS5_PLAYERS[that.id];
		switch (key)
		{
			case "cue":
				linkedfunc = player.cue;
				break;
			case "play":
				linkedfunc = player.play;
				break;
			case "pause":
				linkedfunc = player.pause;
				break;
			case "playpause":
				linkedfunc = player.playpause;
				break;
			case "stop":
				linkedfunc = player.stop;
				break;
			case "prevtrack":
				linkedfunc = player.prevtrack;
				break;
			case "prev":
				linkedfunc = player.prev;
				break;
			case "next":
				linkedfunc = player.next;
				break;
		}
		if (linkedfunc != null)
		{
			keyMappings[uppercode] = linkedfunc;
			keyMappings[lowercode] = linkedfunc;
		}
	}
};

this.setGain = function (uiPos) {
	var normalized = uiPos / SCRUB_RESOLUTION;
	//var power_range = Math.sin(normalized * 0.5*Math.PI);
	gainNode.gain.value = normalized; //power_range;
	sources[trackIndex].setGain(normalized);
};

this.scrub = function (uiPos) {
	scrubPosition = getSoundPos(uiPos);
	$("#currentPosition" + that.id).html(getFormattedTime(scrubPosition));
	enableButton('prev', that.loop || (trackIndex != 0 || scrubPosition != 0));
	if (!isScrubbing)
	{
		sources[trackIndex].setPosition(scrubPosition, true);
	}
};

this.setLoadedSpan = function(percent)
{
	$("#loaded-span" + that.id).width(percent * SCRUB_WIDTH);
	if (percent == 1)
	{
		$("#totalPosition" + that.id).html(getTotalPositionText());
	}
};

this.onEndedCallback = function() {
	// we've finished playing the track
	resetPosition();
	sources[trackIndex].stop(true);
	if (that.loop || trackIndex < numTracks() - 1)
	{
		that.next(true);
		runCallback(that.onfinishedtrack);
	}
	else
	{
		runCallback(that.onfinishedtrack);
		runCallback(that.onfinishedall);
	}
};

this.dequeueNextLoad = function() { 
	if (that.loadQueue.length > 0)
	{
		var entry = that.loadQueue.shift();
		loadingTrack = entry[0];
		if (loadingTrack < sources.length)
		{
			//console.log("loading track " + loadingTrack + ": " + entry[1]);
			sources[loadingTrack].load(entry[1]);
		}
	}
	else
	{
		loadingTrack = -1;
	}
}

this.onStartedScrubbing = function () {
	isScrubbing = true;
};

this.onFinishedScrubbing = function () {
	isScrubbing = false;
	var newPosition = scrubPosition;
	if (sources[trackIndex].inPlayState() && newPosition >= sources[trackIndex].getLength())
	{
		that.next(true);
	}
	else
	{
		sources[trackIndex].setPosition(newPosition, true);
	}
};

this.loadQueue = [];

this.addTrack = function (audioPath) {
	var index = numTracks();
	that.tracks.push(audioPath);
	sources[index] = new Gapless5Source(this, context, gainNode);
	that.loadQueue.push([index, audioPath]);
	if (loadingTrack == -1)
	{
		that.dequeueNextLoad();
	}
	if (initialized)
	{
		updateDisplay();
	}
};

this.insertTrack = function (index, audioPath) {
	var trackCount = numTracks();
	index = Math.min(Math.max(index, 0), trackCount);
	if (index == trackCount)
	{
		that.addTrack(audioPath);
	}
	else
	{
		var oldIndex = index+1;
		that.tracks.splice(index,0,audioPath);
		sources.splice(index, 0, new Gapless5Source(this, context, gainNode));

		//re-enumerate queue
		for (var i in that.loadQueue)
		{
			var entry = that.loadQueue[i];
			if (entry[0] >= index)
			{
				entry[0] += 1;
			}
		}
		that.loadQueue.splice(0,0,[index,audioPath]);
		updateDisplay();
	}
};

this.removeTrack = function (index) {
	if (index < 0 || index >= sources.length) return;

	var curSource = sources[index];
	if (curSource.getState() == Gapless5State.Loading)
	{
		curSource.cancelRequest();
	}
	else if (curSource.getState() == Gapless5State.Play)
	{
		curSource.stop();
	}
	
	var removeIndex = -1;
	for (var i in that.loadQueue)
	{
		var entry = that.loadQueue[i];
		if (entry[0] == index)
		{
			removeIndex = i;
		}
		else if (entry[0] > index)
		{
			entry[0] -= 1;
		}
	}
	if (removeIndex >= 0)
	{
		that.loadQueue.splice(removeIndex,1);
	}
	that.tracks.splice(index,1);
	sources.splice(index,1);
	if (loadingTrack == index)
	{
		that.dequeueNextLoad();
	}
	if (initialized)
	{
		updateDisplay();
	}
};

this.replaceTrack = function (index, audioPath) {
	that.removeTrack(index);
	that.insertTrack(index, audioPath);
}

this.removeAllTracks = function () {
	for (var i in sources)
	{
		if (sources[i].getState() == Gapless5State.Loading)
		{
			sources[i].cancelRequest();
		}
	}
	trackIndex = 0;
	loadingTrack = -1;
	sources = [];
	that.tracks = [];
	that.loadQueue = [];
	if (initialized)
	{
		updateDisplay();
	}
};

this.gotoTrack = function (newIndex, bForcePlay) {
	if (inCallback) return;

    var trackDiff = (newIndex - trackIndex)
	if (trackDiff == 0)
	{
		resetPosition();
		if ((bForcePlay == true) || sources[trackIndex].isPlayActive())
		{
			sources[newIndex].play();
		}
	}
	else
	{
		var oldIndex = trackIndex;
		trackIndex = newIndex;
		if (sources[oldIndex].getState() == Gapless5State.Loading)
		{
			sources[oldIndex].cancelRequest();
			that.loadQueue.push([oldIndex, sources[oldIndex].audioPath]);
		}

		resetPosition(true); // make sure this comes after trackIndex has been updated
		if (sources[newIndex].getState() == Gapless5State.None)
		{
			sources[newIndex].load(that.tracks[trackIndex]);

			//re-sort queue so that this track is at the head of the list
			for (var i in that.loadQueue)
			{
				var entry = that.loadQueue.shift();
				if (entry[0] == newIndex)
				{
					break;
				}
				that.loadQueue.push(entry);
			}
		}
		updateDisplay();
		
		if ((bForcePlay == true) || sources[oldIndex].isPlayActive())
		{
			sources[newIndex].play();
		}
		sources[oldIndex].stop(); // call this last

	}
	enableButton('prev', that.loop || (newIndex > 0));
	enableButton('next', that.loop || (newIndex < that.tracks.length - 1));
};

this.prevtrack = function (e) {
	if (sources.length == 0) return;
	if (trackIndex > 0)
	{
		that.gotoTrack(trackIndex - 1);
		runCallback(that.onprev);
	}
	else if (that.loop)
	{
		that.gotoTrack(numTracks() - 1);
		runCallback(that.onprev);
	}
};

this.prev = function (e) {
	if (sources.length == 0) return;
	if (sources[trackIndex].getPosition() > 0)
	{
		// jump to start of track if we're not there
		that.gotoTrack(trackIndex);
	}
	else if (trackIndex > 0)
	{
		that.gotoTrack(trackIndex - 1);
		runCallback(that.onprev);
	}
	else if (that.loop)
	{
		that.gotoTrack(numTracks() - 1);
		runCallback(that.onprev);
	}
};

this.next = function (e) {
	if (sources.length == 0) return;
	var bForcePlay = (e == true);
	if (trackIndex < numTracks() - 1)
	{
		that.gotoTrack(trackIndex + 1, bForcePlay);
		runCallback(that.onnext);
	}
	else if (that.loop)
	{
		that.gotoTrack(0, bForcePlay);
		runCallback(that.onnext);
	}
};

this.play = function (e) {
	if (sources.length == 0) return;
	if (sources[trackIndex].audioFinished)
	{
		that.next(true);
	}
	else
	{
		sources[trackIndex].play();
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
	if (!isPlayButton)
	{
		that.prev(e);
	}
	else if (sources[trackIndex].getPosition() > 0)
	{
		that.prev(e);
		that.play(e);
	}
	else
	{
		that.play(e);
	}
}

this.pause = function (e) {
	if (sources.length == 0) return;
	sources[trackIndex].stop();
	runCallback(that.onpause);
};

this.stop = function (e) {
	if (sources.length == 0) return;
	resetPosition();
	sources[trackIndex].stop(true);
	runCallback(that.onstop);
};

// (PUBLIC) QUERIES AND CALLBACKS

this.isPlaying = function () {
	return sources[trackIndex].inPlayState();
};

// INIT AND UI

var resetPosition = function(forceScrub) {
	if (!forceScrub && sources[trackIndex].getPosition() == 0) return; // nothing else to do
	that.scrub(0);
	$("#transportbar" + that.id).val(0);
};

var enableButton = function (buttonId, bEnable) {
	if (bEnable)
	{
		$("#" + buttonId + that.id).removeClass('disabled');
		$("#" + buttonId + that.id).addClass('enabled');
	}
	else
	{
		$("#" + buttonId + that.id).removeClass('enabled');
		$("#" + buttonId + that.id).addClass('disabled');
	}
};

var updateDisplay = function () {
	if (numTracks() == 0)
	{
		$("#trackIndex" + that.id).html(0);
		$("#tracks" + that.id).html(0);
		$("#totalPosition" + that.id).html("00:00.00");
		enableButton('prev', false);
		enableButton('next', false);
	}
	else
	{
		$("#trackIndex" + that.id).html(trackIndex + 1);
		$("#tracks" + that.id).html(numTracks());
		$("#totalPosition" + that.id).html(getTotalPositionText());
		enableButton('prev', that.loop || trackIndex > 0 || sources[trackIndex].getPosition() > 0);
		enableButton('next', that.loop || trackIndex < that.tracks.length - 1);

		if (sources[trackIndex].inPlayState())
		{
			enableButton('play', false);
			isPlayButton = false;
		}
		else
		{
			enableButton('play', true);
			isPlayButton = true;

			if (sources[trackIndex].getState() == Gapless5State.Error)
			{
				runCallback(that.onerror);
			}
		}
		sources[trackIndex].uiDirty = false;
	}
};

var Tick = function(tickMS) {
	if (numTracks() > 0)
	{
		sources[trackIndex].tick();

		if (sources[trackIndex].uiDirty)
		{
			updateDisplay();
		}
		if (sources[trackIndex].inPlayState())
		{
			var soundPos = sources[trackIndex].getPosition();
			if (isScrubbing)
			{
				// playing track, update bar position
				soundPos = scrubPosition;
			}
			$("#transportbar" + that.id).val(getUIPos());
			$("#currentPosition" + that.id).html(getFormattedTime(soundPos));
		}
	}
	window.setTimeout(function () { Tick(tickMS); }, tickMS);
};

var PlayerHandle = function() {
	return "GAPLESS5_PLAYERS[" + that.id + "]";
};

var Init = function(elem_id, options, tickMS) {
	if ($("#" + elem_id).length == 0)
	{
		console.log("ERROR in Gapless5: no element with id '" + elem_id + "' exists!");
		return;
	}
	GAPLESS5_PLAYERS[that.id] = that;

	// generate html for player
	player_html = '<div class="g5position">';
	player_html += '<span id="currentPosition' + that.id + '">00:00.00</span> | <span id="totalPosition' + that.id + '">' + LOAD_TEXT + '</span>';
	player_html += ' | <span id="trackIndex' + that.id + '">1</span>/<span id="tracks' + that.id + '">1</span>';
	player_html += '</div>';
	
	player_html += '<div class="g5inside">';
	if (typeof Audio == "undefined")
	{
		player_html += 'This player is not supported by your browser.';
		player_html += '</div>';
		$("#" + elem_id).html(player_html);
		return;
	}
	player_html += '<div class="g5transport">';
	player_html += '<div class="g5meter"><span id="loaded-span' + that.id + '" style="width: 0%"></span></div>';

	player_html += '<input type="range" class="transportbar" name="transportbar" id="transportbar' + that.id + '" ';
	player_html += 'min="0" max="' + SCRUB_RESOLUTION + '" value="0" oninput="' + PlayerHandle() + '.scrub(this.value);" ';
	player_html += 'onmousedown="' + PlayerHandle()   + '.onStartedScrubbing();" ontouchstart="' + PlayerHandle() + '.onStartedScrubbing();" ';
	player_html += 'onmouseup="'   + PlayerHandle()   + '.onFinishedScrubbing();" ontouchend="'  + PlayerHandle() + '.onFinishedScrubbing();" />';

	player_html += '</div>';
	player_html += '<div class="g5buttons" id="g5buttons' + that.id + '">';
	player_html += '<button class="g5button g5prev" id="prev' + that.id + '"/>';
	player_html += '<button class="g5button g5play" id="play' + that.id + '"/>';
	player_html += '<button class="g5button g5stop" id="stop' + that.id + '"/>';
	player_html += '<button class="g5button g5next" id="next' + that.id + '"/>';

	if (isMobileBrowser)
	{
		player_html += '<button class="g5button volumedisabled" />';
		player_html += '</div>';
	}
	else
	{
		player_html += '<input type="range" class="volume" name="gain" min="0" max="' + SCRUB_RESOLUTION + '" value="' + SCRUB_RESOLUTION + '" oninput="' + PlayerHandle() + '.setGain(this.value);" />';
		player_html += '</div>';
	}
	player_html += '</div>';
	$("#" + elem_id).html(player_html);

	// css adjustments
	if (!isMobileBrowser && navigator.userAgent.indexOf('Mac OS X') == -1)
	{
		$("#transportbar" + that.id).addClass("g5meter-1pxup");
		$("#g5buttons" + that.id).addClass("g5buttons-1pxup");
	}
	if (isMobileBrowser)
	{
		$("#transportbar" + that.id).addClass("g5transport-1pxup");
	}

	// set up button mappings
	$('#prev' + that.id)[0].addEventListener("mousedown", GAPLESS5_PLAYERS[that.id].prev);
	$('#play' + that.id)[0].addEventListener("mousedown", GAPLESS5_PLAYERS[that.id].playpause);
	$('#stop' + that.id)[0].addEventListener("mousedown", GAPLESS5_PLAYERS[that.id].stop);
	$('#next' + that.id)[0].addEventListener("mousedown", GAPLESS5_PLAYERS[that.id].next);

	// set up key mappings
	if (options != null && 'mapKeys' in options)
	{
		that.mapKeys(options['mapKeys']);
	}
	$(window).keydown(function(e){
		var keycode = e.keyCode;
    	if (keycode in keyMappings)
    	{
    		keyMappings[keycode](e);
    	}
	});

	SCRUB_WIDTH = $("#transportbar" + that.id).width();
	enableButton('play', true);
	enableButton('stop', true);

	// set up tracks
	if (options != null && 'tracks' in options)
	{
		if (typeof options.tracks == 'string')
		{
			that.addTrack(options.tracks);
		}
		else if (typeof options.tracks == "object")
		{
			for (var index in options.tracks)
			{
				that.addTrack(options.tracks[index]);
			}
		}
	}

	initialized = true;
	updateDisplay();

	// autostart if desired
	var playOnLoad = (options != undefined) && ('playOnLoad' in options) && (options.playOnLoad == true);
	if (playOnLoad && (that.tracks.length > 0))
	{
		sources[trackIndex].play();
	}
	Tick(tickMS);
};

$(document).ready(Init(elem_id, options, this.tickMS));

};
