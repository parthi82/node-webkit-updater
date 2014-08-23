  //API
  //updater(manifest)
  // manifest.manifest - where to get manifest {version:'ver'}
  // manifest.pkg.mac/win/linux32/linux64
  // manifest.version
  // manifest.name - app name
  // -------APP--------
  // checkNewVersion(cb) - checks new version of app
  // download(cb) - downloads new version in temp
  // unpack(cb) - unpacks the version
  // runInstaller(apppath, args, options) - is starting the installer
  // -------INSTALLER---
  // install(cb) - installs the app in app folder
  // runApp(cb) - starting the app
  var request = require('request');
  var path = require('path');
  var os = require('os');
  var fs = require('fs');
  var exec = require('child_process').exec;
  var execFile = require('child_process').execFile;
  var spawn = require('child_process').spawn;
  var ncp = require('ncp');
 
  var platform = /^win/.test(process.platform)?'win':/^darwin/.test(process.platform)?'mac':process.arch == 'ia32'?'linux32':'linux64'; //here will be regular exp where we will define platform

  function updater(manifest){
    this.manifest = manifest;
  }
  updater.prototype.checkNewVersion = function(cb){
    request.get(this.manifest.manifestUrl, gotManifest.bind(this)); //get manifest from url

    function gotManifest(err, req, data){
      if(err) {
        return cb(err);
      }
      try{
        data = JSON.parse(data);
      } catch(e){
        return cb(e)
      }
      if(data.version !== this.manifest.version){
        cb(null, data);
      }
    }
  }
  /**
   * Download the package to template folder
   * @param  {Function} cb called when download completes
   * @param  {Object} manifest package.json manifest where are defined remote url
   * @return {Request} Request stream, the stream contains `manifest` property with new manifest
   */
  updater.prototype.download = function(cb, newManifest){
    var manifest = newManifest || this.manifest;
    var url = manifest.packages[platform];
    var pkg = request(url);
    var filename = path.basename(url);
    // download the package to template folder
    //fs.unlink(path.join(os.tmpdir(), filename), function(){
      pkg.pipe(fs.createWriteStream(path.join(os.tmpdir(), filename)));
    //});
    
    pkg.on('end', appDownloaded);

    function appDownloaded(){
      process.nextTick(function(){
        cb(null, path.join(os.tmpdir(), filename))
      });
    }
    return pkg;
  }

  updater.prototype.getAppPath = function(){
    var appPath = {
      mac: path.join(process.cwd(),'../../..'),
      win: path.dirname(process.execPath)
    }
    appPath.linux32 = appPath.win;
    appPath.linux64 = appPath.win;
    return appPath[platform];
  }

  updater.prototype.getAppExec = function(){
    var execFolder = this.getAppPath();
    var exec = {
      mac:'',
      win: path.basename(process.execPath),
      linux32: path.basename(process.execPath),
      linux64: path.basename(process.execPath)
    }
    return path.join(execFolder, exec[platform]);
  }

  updater.prototype.unpack = function(){
    pUnpack[platform].apply(this, arguments);
  }

  var pUnpack = {
    mac: function(filename, cb){
      var args = arguments;
      if(filename.slice(-4) == ".zip"){
        exec('unzip -xo ' + filename,{cwd: os.tmpdir()}, function(err){
          if(err){
            console.log(err);
            return cb(err);
          }
          var theName = path.basename(filename, '.zip');
          var appPath = path.join(os.tmpdir(), theName, theName + '.app');
          cb(null, appPath);
        })

      }
      if(filename.slice(-4) == ".dmg"){
        // just in case if something was wrong during previous mount
        exec('hdiutil unmount /Volumes/'+path.basename(filename, '.dmg'), function(err){
          exec('hdiutil attach ' + filename + ' -nobrowse', function(err){
            if(err) {
              if(err.code == 1){
                pUnpack.mac.apply(this, args);
              }
              return cb(err);
            }
            findMountPoint(path.basename(filename, '.dmg'), cb);
          });
        });

        function findMountPoint(dmg_name, callback) {
          exec('hdiutil info', function(err, stdout){
            if (err) return callback(err);
            var results = stdout.split("\n");
            var dmgExp = new RegExp(dmg_name + '$');
            for (var i=0,l=results.length;i<l;i++) {
              if (results[i].match(dmgExp)) {
                var mountPoint = results[i].split("\t").pop();
                var fileToRun = path.join(mountPoint, dmg_name + ".app");
                return callback(null, fileToRun);
              }
            }
            callback(Error("Mount point not found"));
          })
        }
      }
    },
    win: function(filename, cb){
      // unzip by C. Spieler (docs: https://www.mkssoftware.com/docs/man1/unzip.1.asp, issues: http://www.info-zip.org/)
      exec(path.resolve(__dirname, 'tools/unzip.exe') + " -u -o " +
        filename + " -d " + os.tmpdir(), function(err){
          if(err){
            return cb(err);
          }
          var theName = path.basename(filename, path.extname(filename));
          cb(null, path.join(os.tmpdir(), theName, theName + '.exe'));
        });
    },
    linux32: function(filename, cb){
      //filename fix
      console.log('starting');
      exec('tar -zxvf ' + filename,{cwd: os.tmpdir()}, function(err){
        console.log(arguments);
        if(err){
          console.log(err);
          return cb(err);
        }
        var theName = path.basename(filename, '.tar.gz');
        cb(null,path.join(os.tmpdir(), theName, theName));
      })
     },
  }
  pUnpack.linux64 = pUnpack.linux32;

  updater.prototype.runInstaller = function(){
    return pRun[platform].apply(this, arguments);
  }

  var pRun = {
    mac: function(apppath, args, options){
      //spawn
      if(args && args.length) {
        args = [apppath].concat('--args', args);
      } else {
        args = [apppath];
      }
      return run('open', args, options);
    },
    win: function(apppath, args, options, cb){
      return run(apppath, args, options, cb);
    },
    linux32: function(apppath, args, options, cb){
      fs.chmodSync(apppath, 0755);
      if(!options) options = {};
      options.cwd = path.dirname(apppath);
      return run(apppath, args, options, cb);
    }
  }

  pRun.linux64 = pRun.linux32;

  function run(path, args, options, cb){
    var opts = {
      detached: true
    }
    for(var key in options){
      opts[key] = options[key];
    }
    var sp = spawn(path, args, opts);
    sp.unref();
    return sp;
  }

  updater.prototype.install = function(){
    return pInstall[platform].apply(this, arguments);
  }
  var pInstall = {
    mac: function(to, cb){
      ncp(this.getAppPath(), to, cb);
    },
    win: function(to, cb){
      deleteApp(appDeleted.bind(this));
      function appDeleted(err){
        ncp(this.getAppPath(), to, appCopied.bind(this));
      }
      function deleteApp(cb){
        exec('rd ' + to + '/s /q', cb)
      }
      function appCopied(err){
        if(err){
          setTimeout(function(){deleteApp(appDeleted.bind(this))}.bind(this), 100);
          return
        }
        cb();
      }
    },
    linux32: function(to, cb){
      ncp(this.getAppPath(), to, cb);
    }
  }
  pInstall.linux64 = pInstall.linux32;

  updater.prototype.run = function(){
    pRun[platform].apply(this, arguments);
  }

  module.exports = updater;
