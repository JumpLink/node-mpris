#!/usr/bin/env node
var optimist = require('optimist');
var argv = optimist
  .usage('Usage: $0 -p [string] -u [string]')
  .string(['p','f']).default('p', 'vlc').alias('p', 'player').alias('p', 'mediaplayer').describe('p', 'Mediaplayer to start')
  .alias('u', 'uri').demand('u').describe('u', 'URI for file to play, local files should use the "file://" schema.')
  .alias('h', 'help').describe('h', 'Show this help')
  .argv;

if(argv.h) {
  optimist.showHelp();
  process.exit(code=0);
}

var util = require('util');
var mpris = require('../mpris.js');

mpris.Player.on('MetadataChanged', function (newValue, oldValue) {
  if(!oldValue || Object.keys(newValue).length != Object.keys(oldValue).length) {
    console.log("Metadata updated:");
    console.log(util.inspect(newValue, showHidden=false, depth=2, colorize=true));
  }
});

  
mpris.Player.on('PlaybackStatusChanged', function (newValue, oldValue) {
  if(newValue != oldValue) {
    mpris.GetIdentity(function (error, identity) {
      mpris.Player.GetMetadata(function (error, metadata) {
        console.log(identity+' is now '+newValue.toLowerCase()+' "'+metadata['xesam:url']+'"');
      });
    });
  }
});

mpris.start(argv.mediaplayer, null, function (error) {
  mpris.Player.OpenUri(argv.uri, function (error) {
    mpris.Player.Play(function(error){
      mpris.GetSupportedUriSchemes(function (error, uriSchemes) {
        console.log("\nSupported Uri Schemes:");
        console.log(util.inspect(uriSchemes, showHidden=false, depth=2, colorize=true));
      });
      mpris.GetSupportedMimeTypes(function (error, mimetypes) {
        console.log("\nSupported Mimetypes:");
        console.log(util.inspect(mimetypes, showHidden=false, depth=2, colorize=true));
      });
    });
  });
});