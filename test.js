var socket = require('socket.io-client')('http://128.164.26.160:8000');
var AdmZip = require('adm-zip');

socket.emit('live-file-connection');

socket.on('live_file_connection', function (event) {
	var zip = new AdmZip();

	console.log('test');
	zip.addFile('test/', event, 'test');
	zip.writeZip(__dirname + '/test.zip');
});