const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const port = process.env.PORT || 4000;
const OrientDBClient = require("orientjs").OrientDBClient;

const config = {
  host: "localhost",
  db: "chat",
  user: "admin",
  password: "admin",
  rootUser: "root",
  rootPassword: "root"
};
const run = async () => {
  let { client, pool } = await setupDatabase();
  boostrap({ client, pool });
};

const setupDatabase = async () => {
  let client = await OrientDBClient.connect({
    host: config.host,
    pool: {
      max: 10
    }
  });

  let exists = await client.existsDatabase({
    name: config.db,
    username: config.rootUser,
    password: config.rootPassword
  });

  if (!exists) {
    await client.createDatabase({
      name: config.db,
      username: config.rootUser,
      password: config.rootPassword
    });
  }

  let pool = await client.sessions({
    name: config.db,
    username: config.user,
    password: config.password,
    pool: {
      max: 25
    }
  });

  let session = await pool.acquire();
  await session.command("create class Room IF NOT EXISTS extends V").one();
  await session.close();
  return { client, pool };
};

const startLiveQuery = async pool => {
  let session = await pool.acquire();

  session.liveQuery(`select from Room`).on("data", msg => {
    // inserted record op = 1
    if (msg.operation === 1) {
      io.emit("chat message", msg.data);
    }
  });
  await session.close();
};

const listenForMessage = pool => {
  io.on("connection", function(socket) {
    socket.on("chat message", async msg => {
      let session = await pool.acquire();
      try {
        session
          .command(
            `insert into Room set text = :text, date = sysdate(), author = :author`,
            { params: msg }
          )
          .one();
      } catch (ex) {
        console.log(ex);
      }
    });
  });
};
const boostrap = ({ client, pool }) => {
  startLiveQuery(pool);
  listenForMessage(pool);

  app.use(async (req, res, next) => {
    try {
      let session = await pool.acquire();
      res.locals.db = session;
      res.on("finish", async () => {
        await session.close();
      });
      next();
    } catch (ex) {
      res.status(500).send(err);
    }
  });
  app.get("/", function(req, res) {
    res.sendFile(__dirname + "/index.html");
  });

  app.get("/messages", async (req, res) => {
    try {
      let messages = await res.locals.db
        .query("select from Room order by date limit 20")
        .all();
      res.send(messages);
    } catch (err) {
      res.status(500).send(err);
    }
  });

  http.listen(port, function() {
    console.log("listening on *:" + port);
  });
};

run();
