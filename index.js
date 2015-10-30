#! /usr/bin/env node
var io = require('socket.io');
var fs = require('fs');
var getIP = require('external-ip')();
var zip = require('adm-zip');
var hash = require('crypto');
var path = require('path');

var fail = 'Usage: codir <command>\n'+
		'\n'+
		'where <command> is one of:\n'+
		'\tadd, remove, run, version\n'+
		'\n'+
		'codir run <path> (-p <port>)\n'+
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
					else console.log(fail);
					break;
				default:
					console.log(fail);
			}
			break;
		case 'add':
			if (argc == 3) addPath(argv[1], argv[2]);
			else console.log(fail);
			break;
		case 'remove':
			if (argc == 3) removePath(argv[1], argv[2]);
			else console.log(fail);
			break;
		case 'version':
			if (argc == 1)  version();
			break;
		default:
			console.log(fail);
	}
}

function run (filepath, port) {
	getIP(function (err, ip) {
		fs.accessSync(filepath, fs.R_OK & fs.W_OK);
		var io = require('socket.io')(port);

		var truepath = path.resolve(filepath);
		var hashed = hash.createHash('sha1');
		hashed.update(ip + ':' + port);
		var shareid = hashed.digest('hex');
		addPath(truepath, shareid);

		console.log('Your Shareid: ' + shareid);
		console.log('Listening to port: ' + port);

		var project = new zip();
		project.addLocalFolder(truepath);
		var json = fs.readFileSync('projects.json');
		

		io.on('connection', function(socket) {
			console.log('User Connected: ', socket.id);
			socket.emit('connection-update', { 'archive': project, 'project': project});

			socket.on('workspace-open-file-update', function(update) {
				addPath(path.resolve(update.path), shareid);
				json = fs.readFileSync('projects.json');
				socket.emit('workspace-open-file-update', json[shareid].files[truepath]);
			});

			socket.on('workspace-file-edit-update', function(update) {
				json = fs.readFileSync('projects.json');
				json[shareid].files[fs.resolve(update.path)].deltas.push(update.delta);
				fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
				socket.broadcast.emit('workspace-file-edit-update', update);
			})

			socket.on('disconnect', function() {
				console.log('User Disconnected: ', socket.id);
			})
		});
	});
}

function addPath(filepath, shareid) {
	stats = fs.statSync(filepath);
	json = JSON.parse(fs.readFileSync('projects.json'));

	if (json[shareid] == null) json[shareid] = {
		'folders': [],
		'files': {}
	};

	if (stats.isDirectory() && json[shareid].folders.indexOf(filepath) == -1) {
		json[shareid].folders.push(filepath);
	}
	else if (stats.isFile()) {
		if (json[shareid].files[filepath] == null) json[shareid].files[filepath] = {
			'filepath': filepath,
			'deltas': [],
			'last-change': Date()
		};
	}

	fs.writeFileSync('projects.json', JSON.stringify(json, null, 3));
}