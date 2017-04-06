const clientsPort = 9000;
const serverIo = require('socket.io')(clientsPort);
const fs = require('fs');
const WebMByteStream = require('webm-byte-stream');

let queues = {};

serverIo.on('connection', socket => {
  console.log('A client connected');
  console.log(queues);

  socket.on('upload', req => {
    console.log('Received file', req.filename);
    fs.appendFileSync(`fs/${req.filename}`, req.data);
  });

  socket.on('download_init', req => {
    queues[socket.id] = [];
    let webmstream = new WebMByteStream();

    webmstream.on('Initialization Segment', data => {
      console.log('Init header');
      socket.emit('download_init', { data });
    });

    webmstream.on('Media Segment', data => {
      let cluster = data.cluster;
      let timecode = data.timecode;
      // let duration = data.duration;
      if (queues[socket.id])
        queues[socket.id].push({ data: cluster, timecode });
    });

    let file = fs.createReadStream(`fs/${req.filename}`, { flags: 'r' });
    file.on('data', data => webmstream.write(data));
  });

  socket.on('download', req => {
    console.log('pending', queues[socket.id].length);
    if (queues[socket.id].length) {
      socket.emit('download', queues[socket.id].shift());
    } else {
      socket.emit('download', { end: true });
    }
  });

  socket.on('disconnect', () => {
    delete queues[socket.id];
  });
});

try {
  fs.mkdirSync('./fs');
} catch (err) {
  console.log('FS exists');
}
console.log('Listening on port', clientsPort);
