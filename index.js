require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


// middleware
app.use(
  cors({
    origin: [`${process.env.SITE_DOMAIN}`],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vbonu5x.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};




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


    // verifyADMIN
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only Actions!", role: user?.role });
      next();
    };

    // verifyBorrower
    const verifyBorrower = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "borrower")
        return res
          .status(403)
          .send({ message: "Borrower only Actions!", role: user?.role });
      next();
    };

    // verifyManager
    const verifyManager = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "manager")
        return res
          .status(403)
          .send({ message: "Manager only Actions!", role: user?.role });
      next();
    };

    //  add loan by manager
    app.post("/loans", async (req, res) => {
      const loan = req.body;
      const result = await loansCollection.insertOne(loan);
      res.send(result);
    });

    //  get loans for home page
    app.get("/loans-home", async (req, res) => {
      const result = await loansCollection
        .find({ showOnHome: true })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
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

    // Update Status of loan application by manager
    app.patch("/update-status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const updateData = { status };
      if (status === "Approved") {
        updateData.approvedAt = new Date();
      }
      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
      res.send(result);
    });

    //loan applications get from DB by user
    app.get("/my-loans/:email", async (req, res) => {
      const result = await applicationsCollection
        .find({ userEmail: req.params.email })
        .toArray();
      res.send(result);
    });

    //loan application delete from DB by user
    app.delete("/loan-application/:id", async (req, res) => {
      const id = req.params.id;
      const result = await applicationsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // save or update a user in db
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = userData.role || "borrower";
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



      // Suspend User by ADMIN
    app.patch("/users/suspend/:id", async (req, res) => {
      const id = req.params.id;
      const { reason, feedback } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "suspended",
            suspendReason: reason,
            suspendFeedback: feedback,
            suspendedAt: new Date(),
          },
        }
      );
      res.send({
        success: true,
        result,
      });
    });

    // payment checkout
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo.loanTitle,
                description: `$${paymentInfo.amount}`,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo.amount * 100,
            },
            quantity: paymentInfo.quantity,
          },
        ],
        customer_email: paymentInfo.borrower?.email,
        mode: "payment",
        metadata: {
          loanApplicationId: paymentInfo.loanApplicationId,
          borrower: paymentInfo.borrower?.email,
        },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/loans`,
      });
      res.send({ url: session.url });
    });

    app.get("/payment-success", async (req, res) => {
      const { session_id } = req.query;
      try {
        // Retrieve the session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id);
        // Check if payment succeeded
        if (session.payment_status === "paid") {
          const loanApplicationId = session.metadata.loanApplicationId;
          if (!loanApplicationId) {
            return res.status(400).json({
              success: false,
              message: "No loanApplicationId in session metadata",
            });
          }

          // Update the loan application fee status in the database
          const result = await applicationsCollection.updateOne(
            { _id: new ObjectId(loanApplicationId) },
            {
              $set: {
                applicationFeeStatus: "Paid",
                stripePaymentId: session.payment_intent,
                paymentEmail: session.customer_email,
                paymentAmount: session.amount_total / 100,
                paidAt: new Date(),
              },
            }
          );

          return res.status(200).json({
            success: true,
            message: "Payment successful",
            loanApplicationId,
            stripePaymentId: session.payment_intent,
          });
        } else {
          return res
            .status(400)
            .json({ success: false, message: "Payment not completed" });
        }
      } catch (error) {
        console.error("Payment error:", error);
        return res.status(500).json({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
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
