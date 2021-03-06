/*global require */
/*global __dirname */
/*global process */

const log = console.log;
let bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const opn = require('opn');
const {
	exec
} = require('child_process');

const buildSounds = require('./scripts/build-sounds.js');

let currentGame;
let currentGameDesc;
let currentGameRoot;

let PORT = 32023;
let gamesRoot = __dirname + '/../games/';
let jsonParser = bodyParser.json({limit:1024*1024*200});

// File System acess commands

app.get('/fs/projects', function (req, res) {
	res.send(enumProjects());
});

app.get('/fs/openProject', function (req, res) {
	
	let folder = gamesRoot + req.query.dir + '/';
	
	if(fs.existsSync(folder) && fs.existsSync(folder+'thing-project.json')) {
		currentGame = req.query.dir;
		currentGameRoot = folder;
		process.chdir(currentGameRoot);
		log('Project opened: ' + currentGameRoot);
		let projectDescSrc = fs.readFileSync('thing-project.json');
		currentGameDesc = JSON.parse(projectDescSrc);
		res.send(projectDescSrc);
	} else {
		log('Can\'t open project: ' + req.query.dir);
		res.send('false');
	}
});

let pathFixerExp = /\\/g;
let pathFixer = (stat) => {
	stat.name = stat.name.replace(pathFixerExp, '/');
};

app.get('/fs/enum', function (req, res) {
	if(!currentGame) throw 'No game opened';
	
	let list = walkSync('./img');
	walkSync('./prefabs', list);
	walkSync('./scenes', list);
	walkSync('./src', list);
	walkSync('./snd', list);
	walkSync('./' + currentGameDesc.localesPath, list);
	list.some(pathFixer);
	res.send(list);
});

app.get('/fs/delete', function (req, res) {
	if(!currentGame) throw 'No game opened';
	let fn = req.query.f;
	try {
		fs.unlinkSync(fn);
		res.end('{}');
	} catch (err) {
		res.end("Can't delete file: " + fn);
	}
});

app.get('/fs/edit', function (req, res) {
	if(!currentGame) throw 'No game opened';
	
	let fn = req.query.f;
	if(fn.indexOf('thing-engine/js/') >= 0) {
		fn = path.join(__dirname, '../', fn);
	} else {
		fn = path.resolve(currentGameRoot, fn);
	}
	setTimeout(() => {
		"use strict";
		try {
			opn(fn);
			res.end('{}');
		} catch (err) {
			res.end("Can't open file to edit: " + fn);
		}
	},100);

});

app.post('/fs/fetch', jsonParser, function (req, res) {
	let fetch = require('node-fetch');
	req.body.options.headers = { 'Content-Type': 'application/json' };
	fetch(req.body.url, req.body.options).then(res => res.json())
		.then((data) => {
			res.set('Content-Type', 'application/json');
			res.end(JSON.stringify(data));
		});
});

app.get('/fs/build', function (req, res) {
	log('BUILD project: ' + currentGameRoot);
	exec('node "' +
	path.resolve(__dirname, 'scripts/build.js') + '" "' +
	currentGameRoot+'" ' + 
	(req.query.debug ? 'debug' : ''),
	{maxBuffer: 1024 * 500},
	(err, stdout, errout) => {
		if(err) {
			console.error(err);
			res.end(JSON.stringify({errors:[stdout, errout], warnings:[]}));
		} else {
			log(stdout);
			res.end(stdout);
		}
	});
});

app.get('/fs/build-sounds', function (req, res) {
	log('BUILD sounds: ' + currentGameRoot);

	buildSounds(currentGameRoot,
		function (result) {
			res.end(JSON.stringify(result));
		},
		req.query.formats.split(','),
		req.query.nocache
	);
});

app.post('/fs/savefile', jsonParser, function (req, res) {
	let fileName = req.body.filename;
	//log('Save file: ' + fileName);
	ensureDirectoryExistence(fileName);
	fs.writeFile(fileName, req.body.data, function(err) {
		if(err) {
			throw err;
		}
		res.end();
	});
});

// modules import cache preventing
let moduleImportFixer = /(^\s*import.+from\s*['"][^'"]+)(['"])/gm;

let moduleImportAbsFixer = /(^\s*import.+from\s*['"])([^.\/])/gm;

function absoluteImportsFixer(fileName, req, res, next, additionalProcessor) {
	let needParse = req.path.endsWith('.js') && !req.path.endsWith('.min.js');
	if(needParse) {
		fs.readFile(fileName, function (err, content) {
			if (err) {
				log('JS PREPROCESSING ERROR: ' + err);
				next(err);
			} else {
				res.set('Content-Type', 'application/javascript');
				let rendered = content.toString().replace(moduleImportAbsFixer, (substr, m1, m2) => {					
					return m1 + "/" + m2;
				});
				if(additionalProcessor) {
					rendered = additionalProcessor(rendered);
				}
				return res.end(rendered);
			}
		});
	} else {
		next();
	}
}
app.use('/games/', (req, res, next) => {
	absoluteImportsFixer(path.join(__dirname, '../games', req.path), req, res, next, (content) => {
		let modulesVersion = req.query ? req.query.v : false;
		if(modulesVersion) {
			res.set('Content-Type', 'application/javascript');
			content = content.toString().replace(moduleImportFixer, (substr, m1, m2) => {
				if(m1.indexOf('thing-engine/js/') >= 0 || m1.indexOf('thing-editor/') >= 0) {
					return substr;
				}
				return m1 + '?v=' + modulesVersion + m2;
			});
		}
		return content;
	});
});
app.use('/thing-engine/', (req, res, next) => {
	absoluteImportsFixer(path.join(__dirname, '../thing-engine', req.path), req, res, next);
});
app.use('/thing-editor/', (req, res, next) => {
	absoluteImportsFixer(path.join(__dirname, req.path), req, res, next);
});

app.use('/games/', express.static(path.join(__dirname, '../games'), {dotfiles:'allow'}));
app.use('/thing-engine/', express.static(path.join(__dirname, '../thing-engine'), {dotfiles:'allow'}));
app.use('/thing-editor/', express.static(__dirname, {dotfiles:'allow'}));

app.get('/', function(req, res) {
	res.redirect('/thing-editor');
});

//========= start server ================================================================
let server = app.listen(PORT, () => log('Thing-editor listening on port ' + PORT + '!')); // eslint-disable-line no-unused-vars
if(process.argv.indexOf('n') < 0) {
	opn('', {app: ['chrome', /*--new-window --no-sandbox --js-flags="--max_old_space_size=32768"--app=*/ 'http://127.0.0.1:' + PORT + '/thing-editor']});
}

//======== socket connection with client ================================================
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: PORT + 1 });
let clientsConnected = 0;
wss.on('connection', function connection(ws) {
	ws.on('message', function incoming(/*message*/) {
		//console.log('received: %s', message);
	});
	ws.on('close', function onWsClose(){
		clientsConnected--;
	});
	clientsConnected++;
	ws.send(JSON.stringify({clientsConnected}));
	if(clientsConnected > 1) {
		ws.close();
	}
});

//=========== enum files ================================
const walkSync = (dir, filelist = []) => {
	fs.readdirSync(dir).forEach(file => {
		let stats = fs.statSync(path.join(dir, file));
		
		if(stats.isDirectory()) {
			filelist = walkSync(path.join(dir, file), filelist);
		} else if(stats.size > 0) {
			filelist.push({name: path.join(dir, file), mtime: stats.mtimeMs});
		}
	});
	return filelist;
};

//============= enum projects ===========================
const enumProjects = () => {
	let ret = [];
	let dir = gamesRoot;
	fs.readdirSync(dir).forEach(file => {
		let dirName = path.join(dir, file);
		if(fs.statSync(dirName).isDirectory()) {
			let projDescFile = dirName + '/thing-project.json';
			if(fs.existsSync(projDescFile)) {
				let desc = JSON.parse(fs.readFileSync(projDescFile, 'utf8'));
				desc.dir = file;
				ret.push(desc);
			}
		}
	});
	return ret;
};

//=============== create folder for file ==================
function ensureDirectoryExistence(filePath) {
	let dirname = path.dirname(filePath);
	if (fs.existsSync(dirname)) {
		return true;
	}
	ensureDirectoryExistence(dirname);
	fs.mkdirSync(dirname);
}