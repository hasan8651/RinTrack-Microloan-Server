require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vbonu5x.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const db = client.db("RinTrack");
    const usersCollection = db.collection("users");
    const loansCollection = db.collection("loans");
    const applicationsCollection = db.collection("applications");




        //  add loan by manager
    app.post("/loans", async (req, res) => {
      const loan = req.body;
      const result = await loansCollection.insertOne(loan);
      res.send(result);
    });

    //  get loans for home page
    app.get("/loans-home", async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send(result);
    });

    // get all loans
    app.get("/loans", async (req, res) => {
      const result = await loansCollection.find({}).toArray();
      res.send(result);
    });

    // get loan details
    app.get("/loans/:id", async (req, res) => {
      console.log(req.params.id);
      const result = await loansCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    // update loan data
    app.patch("/loans/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updatedData,
      };
      const result = await loansCollection.updateOne(query, updateDoc);
       res.send(result);      
    });

  // delete loan
    app.delete("/loans/:id", async (req, res) => {
      const id = req.params.id;
      const result = await loansCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //loan applications save in DB
    app.post("/loans/application", async (req, res) => {
      const data = req.body;
      const result = await applicationsCollection.insertOne(data);
      res.send({ result, success: true });
    });




// get pending loan applications
    app.get("/pending-loans", async (req, res) => {
      const result = await applicationsCollection
        .find({ status: "Pending" })
        .toArray();
      res.send(result);
    });

// get approved loan applications
    app.get("/approved-loans", async (req, res) => {
      const result = await applicationsCollection
        .find({ status: "Approved" })
        .toArray();
      res.send(result);
    });

      //loan applications get from DB by user
    app.get("/my-loans/:email", async (req, res) => {
      const result = await applicationsCollection
        .find({ userEmail: req.params.email })
        .toArray();
      res.send(result);
    });


    // save or update a user in db
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = userData.role || "customer";
      userData.status = "active";
      const query = {
        email: userData.email,
      };

      const alreadyExists = await usersCollection.findOne(query);
      console.log("User Already Exists---> ", !!alreadyExists);

      if (alreadyExists) {
        console.log("Updating user info......");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      console.log("Saving new user info......");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    // get user role
    app.get("/user/role", async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("RinTrack server is running");
});

app.listen(port, () => {
  console.log(`RinTrack server is running on port: ${port}`);
});
