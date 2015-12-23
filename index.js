#! /usr/bin/env node

version = "0.3.5"

var app = require('http').createServer()
var io = require('socket.io')(app);
var fs = require('fs');
var getIP = require('external-ip')();
var zip = require('adm-zip');
var hash = require('crypto');
var path = require('path');
var RWLock = require('rwlock');
var EventEmitter = require('events').EventEmitter;
var rl = require('readline').createInterface({
	input: process.stdin,
	output: process.stdout
});

var depth = path.resolve('.').split('/').length - 2;
var root = '';
for (i = 0; i < depth; i++) root += '../';

	var lock = new RWLock();
var jsonLock = 'json';

try {
	var json = JSON.parse(fs.readFileSync('projects.json'));
} catch (e) {
	console.log(e);
	fs.writeFileSync('projects.json', '{}');
	var json = {};
}

var fail = 'Usage: codir run <path> (-p <port>)\n'+
	'\tshares the file path specified by path\n'+
	'\tif port is unspecified codir will pick one at random\n'+
	'\n'+
	'codir add <path> <shareid>\n'+
	'\tadds the file path specifed by path to the project specifed by shareid\n'+
	'\tshareid is printed to the console by "codir run" at runtime\n'+
	'\n'+
	'codir remove <path> <shareid>\n'+
	'\tremoves the file path specifed by path from the project specifed by shareid\n'+
	'\tshareid is printed to the console by "codir run" at runtime\n'+
	'\n'+
	'codir version\n'+
	'\tprints the version of codir-server installed to the command line\n';


if (process.argv.length < 3 || (process.argv.length == 3 && process.argv[2] == '&')) {
	console.log(fail);
	process.exit();
} else {
	var argv = process.argv.slice(2);
	if (argv[argv.length - 1] == '&') argv = argv.slice(0, argv.length - 1);
	var argc = argv.length;

	console.log(argv+':'+argc);	
	switch (argv[0]) {
		case 'run':
			switch(argc) {
				case 2:
					run(argv[1], 8000 + Math.floor(Math.random() * 1000));
					break;
				case 4:
					if (argv[2] == '-p') run(argv[1], argv[3]);
					else { 
						console.log(fail);
						process.exit();
					}
					break;
				default:
					console.log(fail);
					process.exit();
			}
			break;
		case 'add':
			if (argc == 3) addPath(argv[1], argv[2]);
			else {
				console.log(fail);
				process.exit();
			}
			break;
		case 'remove':
			if (argc == 3) removePath(argv[1], argv[2]);
			else {
				console.log(fail);
				process.exit();
			}
			break;
		case 'version':
			if (argc == 1) console.log(version);
			else console.log(fail)
			process.exit();
			break;
		default:
			console.log(fail);
			process.exit();
	}
}

function run (filepath, port, pass) {
	getIP(function (err, ip) {
		fs.accessSync(filepath, fs.R_OK & fs.W_OK);
		//app.listen(port, ip, function() {
		app.listen(port, function() {
			console.log('Listening to port: ' + port);
		})

		var truepath = path.resolve(filepath);
		
		//var hashed = hash.createHash('sha1');
		//hashed.update(ip + ':' + port);
		//var shareid = hashed.digest('hex');

		//var cipher = hash.createCipher('aes64', pass || 'codir-shareid')
		//var shareid = cipher.update(ip + ':' + port, 'utf8', 'hex') + cipher.final('hex');

		var shareid = ip+':'+port

		addPath(shareid, truepath);

		console.log('Your Shareid: ' + shareid);

		io.on('connection', function(socket) {
			console.log('User Connected: ', socket.id);
			//socket.emit('connection-update', { 'archive': project, 'project': project});
			socket.on('live-file-connection', function() {
				lock.writeLock(json, function (release) {
					console.log('live-file-connection');

					var project = new zip();

					for (item in json[shareid].folders) {
						if (json[shareid].folders[item].isRoot) project.addLocalFolder(item);
					}
					for (item in json[shareid].files) {
						if (json[shareid].files[item].isRoot) project.addLocalFolder(item);
					}

					socket.emit('live-file-connection', {
						'zip': project.toBuffer().toString('hex'),
						'shareid': shareid 
					});
					release()
				});
			});

			socket.on('workspace-open-file-update', function(update) {
				//addPath(shareid, path.resolve(update.path));
				//json = fs.readFileSync('projects.json');
				for (var file in json[update.shareid].redirects) {
					var index = file.indexOf(update.path)
					if (index != -1 && index + update.path.length == file.length) {
						var path = json[update.shareid].redirects[file]
						socket.emit('workspace-open-file-update', {'path': update.path, 'deltas': json[update.shareid].files[path].deltas})
						return
					}
				}

				for (var file in json[update.shareid].files) {
					var index = file.indexOf(update.path)
					if (index != -1 && index + update.path.length == file.length) {
						socket.emit('workspace-open-file-update', {'path': update.path, 'deltas': json[update.shareid].files[file].deltas})
						return
					}
				}

				//socket.emit('workspace-open-file-update', json[shareid].files[truepath]);
			});

			socket.on('workspace-file-edit-update', function(update) {
				//json = fs.readFileSync('projects.json');
				//json[shareid].files[fs.resolve(update.path)].deltas.push(update.delta);
				//fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
				//socket.broadcast.emit('workspace-file-edit-update', update);

				console.log('Edit: ' + JSON.stringify(update));

				for (var file in json[update.shareid].redirects) {
					var index = file.indexOf(update.path);
					if (index != -1 && index + update.path.length == file.length) {
						var path = json[update.shareid].redirects[file];
						json[update.shareid].files[path].deltas.push(update.deltas);
						fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
						socket.broadcast.emit('workspace-file-edit-update', {'path': update.path, 'deltas': update.deltas});
						return
					}
				}

				for (var file in json[update.shareid].files) {
					var index = file.indexOf(update.path)
					if (index != -1 && index + update.path.length == file.length) {
						json[update.shareid].files[file].deltas.push(update.deltas)
						fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
						socket.broadcast.emit('workspace-file-edit-update', {'path': update.path, 'deltas': update.deltas});
						return
					}
				}
			});

			socket.on('disconnect', function() {
				console.log('User Disconnected: ', socket.id);
			})
		});

		fs.watchFile('projects.json', {'interval': 1000}, function (curr, prev) {
			console.log('Project updated:')
		});

		watch(shareid, root);
	});
}

function addPath(shareid, filepath, isNotRoot) {
	//if (/(^|\/)\.[^\/\.]/g.test(filepath)) return;
	lock.writeLock(jsonLock, function(release) {
		var stats = fs.statSync(path.relative(__dirname, filepath));

		if (json[shareid] == undefined) json[shareid] = {
			'folders': {},
			'files': {},
			'redirects': {},
			'last-change': {}
		};

		if (stats.isDirectory()) {
			if (json[shareid].folders[filepath] == undefined) json[shareid].folders[filepath] = {
				'filepath': filepath,
				'last-change': new Date().getTime(),
			};

			if (!isNotRoot) json[shareid].folders[filepath].isRoot = true;

			fs.readdir(filepath, function (err, files) {
				for (i in files) addPath(shareid, path.join(filepath, files[i]), true);
			});
		}
		else if (stats.isFile()) {
			if (json[shareid].files[filepath] == undefined) json[shareid].files[filepath] = {
				'filepath': filepath,
				'deltas': [],
				'last-change': new Date().getTime()
			};

			if (!isNotRoot) json[shareid].files[filepath].isRoot = true;
		}

		fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
		release();
	});
	if (!isNotRoot) console.log('Adding path ', filepath, ' to: ', shareid);
}

function removePath(shareid, filepath) {
	lock.writeLock(jsonLock, function(release) {
		console.log('Removing path ', filepath, ' from: ', shareid);
		if (json[shareid].folders[filepath]) delete json[shareid].folders[filepath];
		for (item in json[shareid].files) {
			if (json[shareid].files.hasOwnProperty(item) && item.indexOf(filepath) == 0) delete json[shareid].files[filepath];
		}

		fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
		release();
	});
}

function movePath(shareid, oldPath, newPath) {
	lock.writeLock(jsonLock, function(release) {
		console.log('Moving path ', oldPath, ' to ', newPath, ' in: ', shareid);

		for (item in json[shareid].folders) {
			if (json[shareid].folders.hasOwnProperty(item) && item.indexOf(oldPath) == 0) {
				var obj = json[shareid].folders[item];
				var path = item.replace(oldPath, newPath);

				delete json[shareid].folders[item];
				json[shareid].folders[path] = obj;
				json[shareid].folders[path].filepath = path;

				if (json[shareid].redirects == undefined) json[shareid].redirects = {};
				json[shareid].redirects[item] = path;
			}
		}

		for (item in json[shareid].files) {
			if (json[shareid].files.hasOwnProperty(item) && item.indexOf(oldPath) == 0) {
				var obj = json[shareid].files[item];
				var path = item.replace(oldPath, newPath);

				delete json[shareid].files[item];
				json[shareid].files[path] = obj;
				json[shareid].files[path].filepath = path;

				if (json[shareid].redirects == undefined) json[shareid].redirects = {};
				json[shareid].redirects[item] = path;
			}
		}

		fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
		release();
	});
}

function isProjectFolder(shareid, path) {
	for (item in json[shareid].folders) {
		if (json[shareid].folders.hasOwnProperty(item) && item.indexOf(path) == 0) return true;
	}

	return false;
}

function isInProject(shareid, path) {
	for (item in json[shareid].folders) {
		if (json[shareid].folders.hasOwnProperty(item) && path.indexOf(item) == 0) return true;
	}

	return false;
}

function watch(shareid, root) {
	var renames = [];
	var renameLock = 'renames';
	var ee = new EventEmitter();

	fs.watch(root, {recursive: true}, function (event, filepath) {
		if (event === 'rename') {
			renames.push({'path': path.resolve(root, filepath), 'time': new Date().getTime()});
			setTimeout(function () {
				ee.emit('rename-event');
			}, 100);
		}
	});

	ee.on('rename-event', function() {

		lock.writeLock(renameLock, function(release) {
			if (renames.length > 0) {
				if (renames.length > 1 && renames[1].time - renames[0].time < 5) {
					var isProj = isProjectFolder(shareid, renames[0].path);
					var isInProj = [isInProject(shareid, renames[0].path), isInProject(shareid, renames[1].path)];

					if (isInProj[0] && isInProj[1]) movePath(shareid, renames[0].path, renames[1].path);
					else if (isProj) movePath(shareid, renames[0].path, renames[1].path);
					else if (isInProj[0]) removePath(shareid, renames[0].path);
					else if (isInProj[1]) addPath(shareid, renames[1].path);

					renames.shift();
					renames.shift();
				}
				else {
					var isInProj = isInProject(shareid, renames[0].path);

					try {
						var exists = fs.accessSync(shareid, renames[0].path);
						if (isInProject) addPath(shareid, renames[0].path);
					} catch (e) {
						if (isInProj) removePath(shareid, renames[0].path);
					}

					renames.shift();
				}
			}
			release();
		});
	});
}