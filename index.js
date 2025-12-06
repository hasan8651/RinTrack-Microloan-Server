require("dotenv").config();
const express = require('express');
const cors = require('cors');

const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();

const port = process.env.PORT || 5000;



// middleware
app.use(cors());
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vbonu5x.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
        // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    
    const db = client.db("RinTrack");
   const usersCollection = db.collection('users')

    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}










run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('RinTrack server is running')
})





app.listen(port, () => {
    console.log(`RinTrack server is running on port: ${port}`)
})