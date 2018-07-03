const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const port = process.env.PORT || 3000;
const OrientDBClient = require("orientjs").OrientDBClient;

const client = new OrientDBClient({
  host: "localhost",
  pool: {
    max: 10
  }
});

const boostrap = pool => {
  app.use((req, res, next) => {
    pool
      .acquire()
      .then(session => {
        res.locals.db = session;
        res.on("finish", () => {
          session.close();
        });
        next();
      })
      .catch(err => {
        res.status(500).send(err);
      });
  });
  app.get("/", function(req, res) {
    res.sendFile(__dirname + "/index.html");
  });

  app.get("/messages", function(req, res) {
    res.locals.db
      .query("select from Room order by date limit 20")
      .all()
      .then(messages => {
        res.send(messages);
      })
      .catch(err => {
        res.status(500).send(err);
      });
  });

  pool.acquire().then(session => {
    session.liveQuery(`select from Room`).on("data", msg => {
      // inserted record op = 1
      if (msg.operation === 1) {
        io.emit("chat message", msg.data);
      }
    });
    session.close();
  });
  io.on("connection", function(socket) {
    socket.on("chat message", function(msg) {
      pool.acquire().then(session => {
        session
          .command(
            `insert into Room set text = :text, date = sysdate(), author = :author`,
            { params: msg }
          )
          .one()
          .then(res => {
            // notification handled by live query
          })
          .catch(err => {
            console.log(err);
          });
      });
    });
  });
  http.listen(port, function() {
    console.log("listening on *:" + port);
  });
};

client
  .connect()
  .then(() => {
    return client.sessions({
      name: "chat",
      pool: {
        max: 25
      }
    });
  })
  .then(pool => {
    boostrap(pool);
  })
  .catch(err => {
    console.log(err);
  });
