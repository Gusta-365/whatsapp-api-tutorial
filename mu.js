const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const conexion = require("./conexion");
//var router = express.Router();
const { connect } = require('http2');
const connection = require('./conexion');
const port = process.env.PORT || 8000;


const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * The two middlewares above only handle for data json & urlencode (x-www-form-urlencoded)
 * So, we need to add extra middleware to handle form-data
 * Here we can use express-fileupload
 */
app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});

//inicio

app.get('/insertar', (req, res) => {
  conexion.query('SELECT * FROM clientes;', (error, resultados) => {
      if(error) return console.error(error.message);

      if(resultados.length > 0){
          res.json(resultados);
      } else {
          res.send('No hay registros');
      }
  });
});

app.get('/insertar/:id', (req, res) => {
  const {id} = req.params;

  conexion.query(`SELECT * FROM clientes WHERE id=${id};`, (error, resultado) => {
      if(error) return console.error(error.message);

      if(resultado.length > 0){
          res.json(resultado);
      } else {
          res.send('No hay registros');
      }
  });
});

app.post('/add', (req, res) => {
  const cliente = {
      nombre: req.body.nombre,
      telefono: req.body.telefono,
      estado: req.body.estado,
      fecha: req.body.fecha
  };

  const query = `INSERT INTO clientes SET ?`;

  conexion.query(query, cliente, (error)=> {
      if(error) return console.error(error.message);

      res.send(`se inserto correctamente el cliente`);
  });
});

app.put('/update/:id', (req, res) => {
  const {id} = req.params;

  const {nombre, telefono, estado, fecha} = req.body;

  const query = `UPDATE clientes SET nombre='${nombre}', telefono='${telefono}', estado='${estado}', fecha='${fecha}' WHERE id='${id}';`;
  conexion.query(query, (error) => {
      if(error) return console.error(error.message);

      res.send(`Se actualizo correctamente el registro ${id}`);
  });
});

app.delete('/delete/:id', (req, res) => {
  const {id} = req.params;

  const query = `DELETE FROM clientes WHERE id=${id}`;

  conexion.query(query, (error) => {
      if(error) return console.error(error.message);

      res.send(`Se eliminó correctamente el registro ${id}`);
  });
});



//fin

//inicio

//Inserta un nuevo registro y recepciona en método post los datos de nombre y correo
// app.get('/in', (req, res, next) => {
//    res.json({nombre : res.nombre, telefono : res.telefono, 
//             estados : res.estados, fecha : res.fecha});



//             conexion.query("SELECT * FROM clientes", function (err, datosResultado) {
//               if (!err) {
//                   console.log(datosResultado);
//                   res.render('clientes', { title: 'nuestros clientes', productos:datosResultado });
//               }
      
//           })
            
//   });


//fin

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id, description) {
  console.log('Creating session: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });


    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      /**
       * At the first time of running (e.g. restarting the server), our client is not ready yet!
       * It will need several time to authenticating.
       * 
       * So to make people not confused for the 'ready' status
       * We need to make it as FALSE for this condition
       */
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});

// Send message
app.post('/send-message', async (req, res) => {
  //console.log(req);



  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id == sender)?.client;

  connection.query('SELECT * FROM clientes', function (err, result, fields) {
    if (err) throw err;
    console.log(result);
  });

  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  /**
   * Check if the number is already registered
   * Copied from app.js
   * 
   * Please check app.js for more validations example
   * You can add the same here!
   */
  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }


    
  
  

  


  client.sendMessage(number, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});

//module.exports = app;

