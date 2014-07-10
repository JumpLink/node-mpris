/*
 * The MIT License (MIT)
 * 
 * Copyright (c) 2014 Pascal Garber
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// sudo apt-get install libdbus-1-dev
// http://wiki.ubuntuusers.de/D-Bus
// https://github.com/Shouqun/node-dbus

var util = require('util');
var debug = require('debug')('info');
var debugEvent = require('debug')('event');
var _debugIface = require('debug')('iface');
var debugIface = function(object) {
  if(_debugIface)
    _debugIface(object.interfaceName, "\n"+util.inspect(object, showHidden=false, depth=2, colorize=true)+"\n");
};
var DBus = require('dbus'); 
var dbus = new DBus();
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var events = require('events');
var mc = new events.EventEmitter();
mc.Player = new events.EventEmitter();
mc.TrackList = new events.EventEmitter();
mc.Playlists = new events.EventEmitter();

var bus;
var TIMEOUTDELAY = 30000;
var INTERVALDELAY = 100;
/*
 * Wait for the dbus name of the player
 */
waitForService = function (serviceName, timeoutDelay, intervalDelay, callback) {
  bus.getInterface('org.freedesktop.DBus', '/', 'org.freedesktop.DBus', function(err, iface) {
    var timeout, interval;

    if(err) { return callback(err); } else {
      var checkService = function (callback) {
        debug("looking for dbus service");
        iface.ListNames['finish'] = function(serviceList) {
          for (index = 0; index < serviceList.length; ++index) {
            if(serviceList[index] === serviceName) {
              return callback(true);
            }
          }
          return callback(false);
        }
        iface.ListNames();
      }

      timeout = setTimeout(function () {
        debug("timeout");
        clearInterval(interval);
        return callback("timeout");
      }, timeoutDelay);
      
      interval = setInterval(function() {
        checkService(function (found) {
          if (found) {
            clearInterval(interval);
            clearTimeout(timeout);
            callback(null);
          }
        });
      }, intervalDelay);
    }
  });
}

var watchProperties = function (valueToSet, dbusName, callback) {
  bus.getInterface(dbusName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', function(err, iface) {
    if(err) {
      callback(err);
    } else {
      iface.on('PropertiesChanged', function(interfaceName, value) {
        var valueKey = Object.keys(value)[0];
        var signalName = valueKey+"Changed";
        debugEvent(interfaceName+"."+signalName, value[valueKey]);
        if (typeof valueKey == 'string' || valueKey instanceof String) {
          switch(interfaceName) {
            case 'org.mpris.MediaPlayer2':
              valueToSet.emit(signalName, value[valueKey], valueToSet[valueKey]);
              valueToSet[valueKey] = value[valueKey];
            break;
            case 'org.mpris.MediaPlayer2.Player':
              valueToSet.Player.emit(signalName, value[valueKey], valueToSet.Player[valueKey]);
              valueToSet.Player[valueKey] = value[valueKey];
            break;
            case 'org.mpris.MediaPlayer2.TrackList':
              valueToSet.TrackList.emit(signalName, value[valueKey], valueToSet.TrackList[valueKey]);
              valueToSet.TrackList[valueKey] = value[valueKey];
            break;
            case 'org.mpris.MediaPlayer2.Playlists':
              valueToSet.Playlists.emit(signalName, value[valueKey], valueToSet.Playlists[valueKey]);
              valueToSet.Playlists[valueKey] = value[valueKey];
            break;
          }
        } else { // WORKAROUND if value is not sent, e.g. http://specifications.freedesktop.org/mpris-spec/latest/Track_List_Interface.html#Property:Tracks
          switch(interfaceName) {
            case 'org.mpris.MediaPlayer2':
            break;
            case 'org.mpris.MediaPlayer2.Player':
            break;
            case 'org.mpris.MediaPlayer2.TrackList':
              valueToSet.TrackList.emit("TracksChanged");
            break;
            case 'org.mpris.MediaPlayer2.Playlists':
            break;
          }
        }

      });
      callback(null);
    }
  });
}

var integrateMethods = function (valueToSet, iface, methodKeys) {
  methodKeys.forEach(function(methodKey) {
    valueToSet[methodKey] =  function () {
      // var arguments = Array.prototype.slice.call(arguments); ?
      iface[methodKey]['timeout'] = TIMEOUTDELAY;
      if(arguments.length >=0) {
        callback = arguments[arguments.length-1];
        iface[methodKey]['finish'] = callback;
      }
      debug("Call method "+methodKey+" with arguments: ");
      debug(arguments);
      switch(arguments.length) {
        case 0:
          iface[methodKey]();
        break;
        case 1:
          iface[methodKey](callback);
        break;
        case 2:
          iface[methodKey](arguments[0], callback);
        break;
        case 3:
          iface[methodKey](arguments[0], arguments[1], callback);
        break;
        case 4:
          iface[methodKey](arguments[0], arguments[1], arguments[2], callback);
        break;
        case 5:
          iface[methodKey](arguments[0], arguments[1], arguments[2], arguments[3], callback);
        break;
      }
    }
  });
}

// type = "get" | "set"
var integrateProperties = function (valueToSet, type, iface, propertyKeys) {
    type = type.toLowerCase();
    propertyKeys.forEach(function(propertyKey) {
      if(type == 'get')
        valueToSet['Get'+propertyKey] = function (callback) {
          iface.getProperty(propertyKey, callback);
        }
      else
        valueToSet['Set'+propertyKey] = function (value, callback) {
          iface.setProperty(propertyKey, value, callback);
        }
    });
}

var integrateSignals = function (valueToSet, iface, signalKeys) {
  signalKeys.forEach(function(signalKey) {
    iface.on(signalKey, function(arg1, arg2, arg3, arg4, arg5) {
      valueToSet.emit(signalKey, arg1, arg2, arg3, arg4, arg5);
    });
  });
}

var loadInterface = function (dbusName, interfaceName, callback) {
  bus.getInterface(dbusName, '/org/mpris/MediaPlayer2', interfaceName, function(err, iface) {
    if(err) {
      callback(err);
    } else {
      debugIface(iface);

      var methodKeys = Object.keys(iface.object.method);
      var propertyGetterKeys = Object.keys(iface.object.property); // generate getters for all properties
      var propertySetterKeys = []; // generate setters just for writeable properties
      var signalKeys = Object.keys(iface.object.signal);

      switch(iface.interfaceName) {
        case 'org.mpris.MediaPlayer2':
          valueToSet = mc;
          propertySetterKeys = ['Fullscreen'];
        break;
        case 'org.mpris.MediaPlayer2.Player':
          valueToSet = mc.Player;
          propertySetterKeys = ['LoopStatus', 'Rate', 'Shuffle', 'Volume'];
        break;
        case 'org.mpris.MediaPlayer2.TrackList':
          valueToSet = mc.TrackList;
        break;
        case 'org.mpris.MediaPlayer2.Playlists':
          valueToSet = mc.Playlists;
        break;
      }

      /* =========== Methods ===========*/
      integrateMethods(valueToSet, iface, methodKeys);

      /* =========== Properties (getter and setter) ===========*/
      integrateProperties(valueToSet, 'get', iface, propertyGetterKeys);
      integrateProperties(valueToSet, 'set', iface, propertySetterKeys);

      /* =========== Signals ===========*/
      integrateSignals(valueToSet, iface, signalKeys);

      callback(null);
    }
  });
};

mc.disconnect = function (playerName, callback) {
  delete bus;
};

mc.connect = function (playerName, callback) {
  bus = dbus.getBus('session');
  mc.playerName = playerName;
  mc.dbusName = 'org.mpris.MediaPlayer2.' + this.playerName;

  waitForService(mc.dbusName, TIMEOUTDELAY, INTERVALDELAY, function (error) {
    if(error) {
      console.error (error);
    } else {
      debug("player found! :)");
      loadInterface(mc.dbusName, 'org.mpris.MediaPlayer2', function (errorBase) {
        loadInterface(mc.dbusName, 'org.mpris.MediaPlayer2.Player', function (errorPlayer) {
          loadInterface(mc.dbusName, 'org.mpris.MediaPlayer2.TrackList', function (errorTrackList) {
            loadInterface(mc.dbusName, 'org.mpris.MediaPlayer2.Playlists', function (errorPlaylists) {
              watchProperties(mc, mc.dbusName, function (errorWatchProperties) {
                if(errorBase || errorPlayer || errorTrackList || errorPlaylists || errorWatchProperties ) callback(errorBase+" "+errorPlayer+" "+errorTrackList+" "+errorPlaylists+" "+errorWatchProperties, mc);
                else callback(null, mc);
              });
            });
          });
        });
      });
    }
  });
}

mc.stop = function(all, callback) {
  var processName;
 
  switch(mc.playerName) {
    case 'omxplayer':
      processName = 'omxplayer.bin';
    break;
    default:
      processName = mc.playerName;
    break;
  }

  mc.Quit(function (error) {
    if(all) {
      exec('killall '+processName , function () {
          mc.disconnect();
          mc.emit('Stop');
          if (callback) return callback(error);
      }); 
    } else {
      mc.disconnect();
      mc.emit('Stop');
      if (callback) return callback(error);
    }
  });
};

mc.start = function(playerName, arguments, callback) {
  var command, arguments, playerApp;

  switch(playerName) {
    case 'omxplayer':
      command ='omxplayer';
      // if no arguments set default
      if( !(arguments instanceof Array) ) {
        arguments = [
          '-o', 'hdmi', // show video on hdmi
          '--blank'     // black background
        ]
      }
    break;
    case 'vlc':
      command ='vlc';
      if( !(arguments instanceof Array) ) {
        arguments = [
          '-I', 'dummy',        // no gui
          '--control', 'dbus',  // with d-bus support  
          '-f'                  // fullscreen        
        ]
      }
    break;
    case 'audacious':
      // TODO
    break;
    case 'bmp':
      // TODO
    break;
    case 'xmms2':
      // TODO
    break;
    case 'rhythmbox':
      // TODO
    break;
    case 'totem':
      command ='totem';
      // NOTE you need to enable the d-bus plugin in totem
      if( !(arguments instanceof Array) ) {
        arguments = [
          '--fullscreen',                  // fullscreen
          '--replace'
        ]
      }
    break;
    case 'spotify': 
      // TODO http://www.mabishu.com/blog/2010/11/15/playing-with-d-bus-interface-of-spotify-for-linux/
    break;
  }

  playerApp = spawn(command, arguments, {stdio: [ 'ignore', 'ignore', 'ignore' ]});

  playerApp.on('exit', function (code) {
    debug('playerApp exit code: ' + code); 
    mc.emit('exit', code);
  });

  playerApp.on('close', function (code, signal) {
    debug('playerApp close code: '+code+' signal: '+signal);
    mc.emit('close', code, signal);
  });

  playerApp.on('error', function (error) {
    console.error('playerApp error: '+error);
    mc.emit('error', error);
  });

  mc.connect(playerName, callback);
};

module.exports = mc;
