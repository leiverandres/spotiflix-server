// TODO: pass in env brokerDir, my ip address

const WebMByteStream = require('webm-byte-stream');
const ioClient = require('socket.io-client');
const ioServer = require('socket.io');
const diskspace = require('diskspace');
const fs = require('fs');

const clientsPort = process.env.PORT || '9000';
const brokerDir = `http://${process.env.BROKER || 'localhost:8080'}/server`;
const myDirection = `localhost:${clientsPort}`;
let curLoad = 0;
let clients = {};

const brokerSocket = ioClient(brokerDir);
const clientSocket = ioServer(clientsPort);

function startServer() {
  clientSocket.on('connection', socket => {
    console.log('Client connected', socket.id);

    socket.on('upload', req => {
      console.log('Received file', req.filename);
      fs.appendFileSync(`fs/${req.filename}`, req.data);
      if (req.first) {
        curLoad += req.fileSize;
        updateServerPriority(brokerSocket);
      }
      if (req.end) {
        curLoad -= req.fileSize;
        updateServerPriority(brokerSocket);
      }
    });

    socket.on('download_init', req => {
      clients[socket.id] = {};
      clients[socket.id].queue = [];
      curLoad += fs.statSync(`fs/${req.filename}`).size;
      updateServerPriority(brokerSocket);
      let webmstream = new WebMByteStream();

      webmstream.on('Initialization Segment', data => {
        console.log('Init header');
        socket.emit('download_init', { data });
      });

      webmstream.on('Media Segment', data => {
        let cluster = data.cluster;
        let timecode = data.timecode;
        // let duration = data.duration;
        if (clients[socket.id].queue)
          clients[socket.id].queue.push({ data: cluster, timecode });
      });

      let file = fs.createReadStream(`fs/${req.filename}`, { flags: 'r' });
      file.on('data', data => webmstream.write(data));
    });

    socket.on('download', req => {
      console.log('pending', clients[socket.id].queue.length);
      if (clients[socket.id].queue.length) {
        socket.emit('download', clients[socket.id].queue.shift());
      } else {
        curLoad -= fs.statSync(`fs/${req.filename}`).size;
        updateServerPriority(brokerSocket);
        socket.emit('download', { end: true });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
      delete clients[socket.id];
    });
  });

  console.log('Listening on port', clientsPort);
}

try {
  fs.mkdirSync('./fs');
} catch (err) {
  console.log('FS exists');
}
// ----------------------------------------------------------------------------
// SERVER-BROKER CONNECTION
function getDiskSpace(cb) {
  diskspace.check('/', (err, result) => {
    cb(err, result.used);
  });
}

brokerSocket.on('connect', function() {
  getDiskSpace((err, diskUsed) => {
    const req = {
      dir: myDirection,
      disk: diskUsed
    };
    console.log(`Disk space: ${req.disk}`);
    brokerSocket.emit('register_server', req);
  });
});

brokerSocket.on('register_server', () => {
  console.log('Successfully registered to broker');
  startServer();
});

brokerSocket.on('update_server', () => {
  console.log('Priority successfully updated in broker');
});

function updateServerPriority(wsBroker) {
  getDiskSpace((err, diskUsed) => {
    const req = {
      dir: myDirection,
      disk: diskUsed,
      load: curLoad
    };
    wsBroker.emit('update_server', req);
  });
}

brokerSocket.on('disconnect', () => {
  console.log('Disconnected from broker');
});
// ----------------------------------------------------------------------------
