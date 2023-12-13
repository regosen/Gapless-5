/**
  * optional parameters:
  *   guiId (string): id of existing HTML element where UI should be rendered
  *   tracks (string | string[]): path of file (or array of music file paths)
  *   useWebAudio (default = true)
  *   useHTML5Audio (default = true)
  *   startingTrack (number or "random", default = 0)
  *   loadLimit (max number of tracks loaded at one time, default = -1, no limit)
  *   logLevel (default = LogLevel.Info) minimum logging level
  *   shuffle (true or false): start the jukebox in shuffle mode
  *   shuffleButton (default = true): whether shuffle button appears or not in UI
  *   loop (default = false): whether to return to first track after end of playlist
  *   singleMode (default = false): whether to treat single track as playlist
  *   playbackRate (default = 1.0): higher number = faster playback
  *   exclusive (default = false): whether to stop other gapless players when this is playing
  *
  * @param {Object.<string, any>} [options] - see description
  * @param {Object.<string, any>} [deprecated] - do not use
  */
export function Gapless5(options?: {
    [x: string]: any;
}, deprecated?: {
    [x: string]: any;
}): void;
export class Gapless5 {
    /**
      * optional parameters:
      *   guiId (string): id of existing HTML element where UI should be rendered
      *   tracks (string | string[]): path of file (or array of music file paths)
      *   useWebAudio (default = true)
      *   useHTML5Audio (default = true)
      *   startingTrack (number or "random", default = 0)
      *   loadLimit (max number of tracks loaded at one time, default = -1, no limit)
      *   logLevel (default = LogLevel.Info) minimum logging level
      *   shuffle (true or false): start the jukebox in shuffle mode
      *   shuffleButton (default = true): whether shuffle button appears or not in UI
      *   loop (default = false): whether to return to first track after end of playlist
      *   singleMode (default = false): whether to treat single track as playlist
      *   playbackRate (default = 1.0): higher number = faster playback
      *   exclusive (default = false): whether to stop other gapless players when this is playing
      *
      * @param {Object.<string, any>} [options] - see description
      * @param {Object.<string, any>} [deprecated] - do not use
      */
    constructor(options?: {
        [x: string]: any;
    }, deprecated?: {
        [x: string]: any;
    });
    hasGUI: boolean;
    scrubWidth: string | number;
    scrubPosition: number;
    isScrubbing: boolean;
    tickMS: number;
    avgTickMS: number;
    initialized: boolean;
    uiDirty: boolean;
    playlist: Gapless5FileList;
    loop: any;
    singleMode: any;
    exclusive: any;
    queuedTrack: string | number;
    fadingTrack: number;
    volume: any;
    crossfade: any;
    crossfadeShape: any;
    onPlayAllowed: () => void;
    useWebAudio: boolean;
    useHTML5Audio: boolean;
    playbackRate: any;
    id: any;
    context: any;
    keyMappings: {};
    /**
     * @param {string} from_track - track that we're switching from
     * @param {string} to_track - track that we're switching to
     */
    onprev: (from_track: string, to_track: string) => void;
    /**
     * play requested by user
     *
     * @param {string} track_path - track to be played
     */
    onplayrequest: (track_path: string) => void;
    /**
     * play actually starts
     *
     * @param {string} track_path - track being played
     */
    onplay: (track_path: string) => void;
    /**
     * @param {string} track_path - track to pause
     */
    onpause: (track_path: string) => void;
    /**
     * @param {string} track_path - track to stop
     */
    onstop: (track_path: string) => void;
    /**
     * @param {string} from_track - track that we're switching from
     * @param {string} to_track - track that we're switching to
     */
    onnext: (from_track: string, to_track: string) => void;
    /**
     * Triggered when sound position has changed
     *
     * @param {number} current_track_time - current time offset of active track 0 if unavailable
     * @param {number} current_track_index - current track index in playlist
     */
    ontimeupdate: (current_track_time: number, current_track_index: number) => void;
    /**
     * @param {string} track_path - track that failed to load or play
     * @param {Error | string} [error] - error object or message
     */
    onerror: (track_path: string, error?: Error | string) => void;
    /**
     * @param {string} track_path - track being loaded
     */
    onloadstart: (track_path: string) => void;
    /**
     * Load completed
     * NOTE: this triggers twice per track when both WebAudio and HTML5 are enabled
     * *
     * @param {string} track_path - track being loaded
     * @param {boolean} fully_loaded - true for WebAudio data, false for HTML5 Audio data
     */
    onload: (track_path: string, fully_loaded: boolean) => void;
    /**
     * @param {string} track_path - track that unloaded
     */
    onunload: (track_path: string) => void;
    /**
     * @param {string} track_path - track that finished playing
     */
    onfinishedtrack: (track_path: string) => void;
    /**
     * Entire playlist finished playing
     */
    onfinishedall: () => void;
    /**
     * @param {boolean} [sourceIndex] - if true and shuffle is on, value will be different
     * @returns {number} - -1 if not found
     */
    getIndex: (sourceIndex?: boolean) => number;
    /**
     * @returns {number}
     */
    totalTracks: () => number;
    /**
     * @returns {boolean}
     */
    isSingleLoop: () => boolean;
    /**
     * See 'Actions' section in README for supported Actions
     *
     * @param {Object.<string, string>} keyOptions - key is the Action, value is the key to press
     */
    mapKeys: (keyOptions: {
        [x: string]: string;
    }) => void;
    /**
     * @returns {number}
     */
    getPosition: () => number;
    /**
     * @param {number} position - in milliseconds
     */
    setPosition: (position: number) => void;
    /**
     * @param {number} volume - normalized between 0 and 1
     */
    setVolume: (volume: number) => void;
    setGain: (uiPos: any) => void;
    scrub: (uiPos: any, updateTransport?: boolean) => void;
    /**
     * @param {number} percent - between 0 and 1
     */
    setLoadedSpan: (percent: number) => void;
    /**
     * @returns {number} - between 0 and 1
     */
    getSeekablePercent: () => number;
    onEndedCallback: () => void;
    onStartedScrubbing: () => void;
    onFinishedScrubbing: () => void;
    /**
     * @param {string} audioPath - path to audio file(s) or blob URL(s)
     */
    addTrack: (audioPath: string) => void;
    /**
     * @param {number} point - playlist index where to insert track
     * @param {string} audioPath - path to audio file(s) or blob URL(s)
     */
    insertTrack: (point: number, audioPath: string) => void;
    /**
     * @returns {string[]}
     */
    getTracks: () => string[];
    /**
     * @returns {string} - audio path for current track, '' if none
     */
    getTrack: () => string;
    /**
     * @param {string} path - audio path for track to find
     * @returns {number} - index in playlist, -1 if not found
     */
    findTrack: (path: string) => number;
    /**
     * @param {number | string} pointOrPath - audio path or playlist index
     */
    removeTrack: (pointOrPath: number | string) => void;
    /**
     * @param {number} point - playlist index where to replace track
     * @param {string} audioPath - path to audio file(s) or blob URL(s)
     */
    replaceTrack: (point: number, audioPath: string) => void;
    removeAllTracks: (flushPlaylist?: boolean) => void;
    /**
     * @returns {boolean}
     */
    isShuffled: () => boolean;
    /**
     * @param {boolean} [preserveCurrent] - true to keep current playing track in place
     */
    shuffle: (preserveCurrent?: boolean) => void;
    toggleShuffle: () => void;
    shuffleToggle: () => void;
    currentSource: () => Gapless5Source;
    currentLength: () => number;
    currentPosition: () => number;
    /**
     * @param {number} rate - default = 1.0, higher = plays faster, lower = plays slower
     */
    setPlaybackRate: (rate: number) => void;
    /**
     * @param {number} duration - in milliseconds
     */
    setCrossfade: (duration: number) => void;
    /**
     * @param {CrossfadeShape} shape - sets the crossfade curve shape
     */
    setCrossfadeShape: (shape: {
        None: number;
        Linear: number;
        EqualPower: number;
    }) => void;
    /**
     * @param {number | string} pointOrPath - audio path or playlist index to play next
     */
    queueTrack: (pointOrPath: number | string) => void;
    /**
     * @param {number | string} pointOrPath - audio path or playlist index to play
     * @param {boolean} [forcePlay] - true to start playing even if player was stopped
     * @param {boolean} [allowOverride] - internal use only
     * @param {boolean} [crossfadeEnabled] - internal use only
     */
    gotoTrack: (pointOrPath: number | string, forcePlay?: boolean, allowOverride?: boolean, crossfadeEnabled?: boolean) => void;
    prevtrack: () => void;
    prev: (uiEvent: any, forceReset: any) => void;
    next: (_uiEvent: any, forcePlay: any, crossfadeEnabled: any) => void;
    play: () => void;
    playpause: () => void;
    cue: () => void;
    pause: () => void;
    stop: () => void;
    isPlaying: () => boolean;
    canShuffle: () => boolean;
    startingTrack: string | number;
}
export namespace LogLevel {
    let Debug: number;
    let Info: number;
    let Warning: number;
    let Error: number;
    let None: number;
}
export namespace CrossfadeShape {
    let None_1: number;
    export { None_1 as None };
    export let Linear: number;
    export let EqualPower: number;
}
declare function Gapless5FileList(parentPlayer: any, parentLog: any, inShuffle: any, inLoadLimit?: number, inTracks?: any[], inStartingTrack?: number): void;
declare class Gapless5FileList {
    constructor(parentPlayer: any, parentLog: any, inShuffle: any, inLoadLimit?: number, inTracks?: any[], inStartingTrack?: number);
    sources: Gapless5Source[];
    startingTrack: number;
    trackNumber: number;
    shuffledIndices: any[];
    shuffleMode: boolean;
    shuffleRequest: any;
    preserveCurrent: boolean;
    loadLimit: number;
    setStartingTrack: (newStartingTrack: any) => void;
    currentSource: () => Gapless5Source;
    isLastTrack: (index: any) => boolean;
    setCrossfade: (crossfadeIn: any, crossfadeOut: any) => void;
    gotoTrack: (pointOrPath: any, forcePlay: any, allowOverride: any, crossfadeEnabled: any) => number;
    lastIndex: (index: any, newList: any, oldList: any) => number;
    stopAllTracks: (resetPositions: any, excludedTracks?: any[]) => void;
    removeAllTracks: (flushList: any) => void;
    setPlaybackRate: (rate: any) => void;
    setShuffle: (nextShuffle: any, preserveCurrent?: boolean) => void;
    isShuffled: () => any;
    numTracks: () => number;
    getTracks: () => any[];
    indexFromTrack: (pointOrPath: any) => any;
    findTrack: (path: any) => number;
    getSourceIndexed: (index: any) => {
        index: any;
        source: Gapless5Source;
    };
    getPlaylistIndex: (index: any) => any;
    loadableTracks: () => Set<any>;
    updateLoading: () => void;
    add: (index: any, audioPath: any) => void;
    remove: (index: any) => void;
}
declare function Gapless5Source(parentPlayer: any, parentLog: any, inAudioPath: any): void;
declare class Gapless5Source {
    constructor(parentPlayer: any, parentLog: any, inAudioPath: any);
    audioPath: any;
    trackName: any;
    setCrossfade: (amountIn: any, amountOut: any, resetEndedCallback?: boolean) => void;
    calcFadeAmount: (percent: any) => number;
    getVolume: () => number;
    getState: () => number;
    unload: (isError: any) => void;
    stop: (resetPosition?: boolean) => void;
    inPlayState: (checkStarting: any) => boolean;
    isPlayActive: (checkStarting: any) => boolean;
    getPosition: () => number;
    getLength: () => number;
    play: (syncPosition: any) => void;
    setPlaybackRate: (rate: any) => void;
    tick: (updateLoopState: any) => number;
    getSeekablePercent: () => number;
    setPosition: (newPosition: any, bResetPlay: any) => void;
    load: () => void;
}
export {};
