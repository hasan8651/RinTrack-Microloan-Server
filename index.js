require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: [process.env.SITE_DOMAIN, "http://localhost:5173"],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());
app.use(cookieParser());

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
  try {
    const cookieToken = req.cookies?.rin_session;
    const headerToken = req.headers?.authorization?.split(" ")[1];

    if (!cookieToken && !headerToken) {
      return res.status(401).json({ message: "Unauthorized Access!" });
    }

    const decoded = cookieToken
      ? await admin.auth().verifySessionCookie(cookieToken, true)
      : await admin.auth().verifyIdToken(headerToken);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    console.error("verifyJWT error", err?.message);
    return res.status(401).json({ message: "Unauthorized Access!" });
  }
};

// Role guards
const makeRoleGuard =
  (...roles) =>
  async (req, res, next) => {
    try {
      const email = req.tokenEmail;
      const user = await req.app.locals.usersCollection.findOne({ email });
      if (!roles.includes(user?.role)) {
        return res
          .status(403)
          .json({
            message: `${roles.join(" or ")} only actions!`,
            role: user?.role,
          });
      }
      next();
    } catch (err) {
      console.error("role guard error", err);
      res.status(500).json({ message: "Server error" });
    }
  };

const verifyADMIN = makeRoleGuard("admin");
const verifyManager = makeRoleGuard("manager");
const verifyBorrower = makeRoleGuard("borrower");
const verifyAdminOrManager = makeRoleGuard("admin", "manager");

//Login Logout (httpOnly session cookie)
app.post("/auth/login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Missing idToken" });
    const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 days
    const sessionCookie = await admin
      .auth()
      .createSessionCookie(idToken, { expiresIn });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("rin_session", sessionCookie, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "None" : "Lax",
      maxAge: expiresIn,
      path: "/",
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("login error", error?.message);
    return res.status(401).json({ message: "Invalid token" });
  }
});

// Logout: clear session cookie
app.post("/auth/logout", (req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("rin_session", {
    path: "/",
    sameSite: isProd ? "None" : "Lax",
    secure: isProd,
  });
  return res.json({ success: true });
});

async function run() {
  try {
    // await client.connect();
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const db = client.db("RinTrack");
    const usersCollection = db.collection("users");
    const loansCollection = db.collection("loans");
    const applicationsCollection = db.collection("applications");

    // expose collections to role guards
    app.locals.usersCollection = usersCollection;

    //  add loan by manager
    app.post("/loans", verifyJWT, verifyManager, async (req, res) => {
      const loan = req.body;
      const result = await loansCollection.insertOne({
        ...loan,
        createdAt: loan?.createdAt || new Date(),
      });
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

// get all loans with Search, Filtering, Sorting and Pagination
app.get("/loans", async (req, res) => {
  try {
    const search = req.query.search || "";
    const category = req.query.category || "";
    const sort = req.query.sort || "desc";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 8;

     const query = {
      title: { $regex: search, $options: "i" },
    };

    if (category) {
      query.category = category;
    }

    let sortOptions = { createdAt: -1 };
    if (sort === "asc") sortOptions = { createdAt: 1 };
    if (sort === "price-high") sortOptions = { maxLoanLimit: -1 };
    if (sort === "price-low") sortOptions = { maxLoanLimit: 1 };

    const skip = (page - 1) * limit;
    
    const totalCount = await loansCollection.countDocuments(query);
    const loans = await loansCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({
      loans,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});


// loan categories for filter menu
app.get('/loan-categories', async (req, res) => {
  try {
    const categories = await loansCollection.aggregate([
      {
        $group: {
          _id: "$category"
        }
      },
      {
        $project: {
          _id: 0,
          category: "$_id"
        }
      }
    ]).toArray();

    const categoryList = categories.map(item => item.category).filter(Boolean);
    
    res.send(categoryList);
  } catch (error) {
    console.error("Aggregation Error:", error);
    res.status(500).send({ error: error.message });
  }
});


    // get loan details
    app.get("/loans/:id", async (req, res) => {
      const result = await loansCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    // update loan data
    app.patch(
      "/loans/:id",
      verifyJWT,
      verifyAdminOrManager,
      async (req, res) => {
        const id = req.params.id;
        const updatedData = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: updatedData };
        const result = await loansCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // delete loan
    app.delete(
      "/loans/:id",
      verifyJWT,
      verifyAdminOrManager,
      async (req, res) => {
        const id = req.params.id;
        const result = await loansCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    //loan applications save in DB
    app.post(
      "/loans/application",
      verifyJWT,
      verifyBorrower,
      async (req, res) => {
        const data = req.body;
        const result = await applicationsCollection.insertOne({
          ...data,
          createdAt: data?.createdAt || new Date(),
        });
        res.send({ result, success: true });
      }
    );

    // get pending loan applications
    app.get("/pending-loans", verifyJWT, verifyManager, async (req, res) => {
      const result = await applicationsCollection
        .find({ status: "Pending" })
        .toArray();
      res.send(result);
    });

    // get approved loan applications
    app.get("/approved-loans", verifyJWT, verifyManager, async (req, res) => {
      const result = await applicationsCollection
        .find({ status: "Approved" })
        .toArray();
      res.send(result);
    });

    // Update Status of loan application by manager
    app.patch(
      "/update-status/:id",
      verifyJWT,
      verifyManager,
      async (req, res) => {
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
      }
    );

    // loan applications get from DB by user
    app.get("/my-loans/:email", verifyJWT, verifyBorrower, async (req, res) => {
      if (req.params.email !== req.tokenEmail) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await applicationsCollection
        .find({ userEmail: req.params.email })
        .toArray();
      res.send(result);
    });

    // loan application delete from DB by user
    app.delete(
      "/loan-application/:id",
      verifyJWT,
      verifyBorrower,
      async (req, res) => {
        const id = req.params.id;
        const result = await applicationsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // save or update a user in db
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = userData.role || "borrower";
      userData.status = "active";
      const query = { email: userData.email };

      const alreadyExists = await usersCollection.findOne(query);
      if (alreadyExists) {
        const result = await usersCollection.updateOne(query, {
          $set: { last_loggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    // get user role
    app.get("/user/role", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    // get all user for admin manage
    app.get("/users", verifyJWT, verifyADMIN, async (req, res) => {
      try {
        const adminEmail = req.tokenEmail;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const search = req.query.search || "";
        const role = req.query.role || "";
        const query = { email: { $ne: adminEmail } };
        if (role) query.role = role;
        if (search) {
          query.$or = [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ];
        }

        const totalUsers = await usersCollection.countDocuments(query);
        const totalPages = Math.ceil(totalUsers / limit);
        const users = await usersCollection
          .find(query)
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();
        res.send({ users, totalPages, currentPage: page });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // get user profile
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // Update users role by ADMIN
    app.patch("/users", verifyJWT, verifyADMIN, async (req, res) => {
      const { email, role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );
      res.send(result);
    });

    // Update users profile
    app.patch("/users/:email", verifyJWT, async (req, res) => {
      const emailParam = req.params.email;
      const { name, image } = req.body;
      if (req.tokenEmail !== emailParam) {
        return res.status(403).json({ message: "Forbidden access" });
      }
      const result = await usersCollection.updateOne(
        { email: emailParam },
        { $set: { name, image } }
      );
      res.send(result);
    });

    // Suspend User by ADMIN
    app.patch(
      "/users/suspend/:id",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
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
        res.send({ success: true, result });
      }
    );

    // get all loan applications
    app.get("/loan-applications", async (req, res) => {
      const result = await applicationsCollection.find({}).toArray();
      res.send(result);
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
        const session = await stripe.checkout.sessions.retrieve(session_id);
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
