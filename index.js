const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT || 8000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
var jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const { getAuth } = require('firebase-admin/auth');

app.use(express.json())
app.use(cors())


/*  Firebase Admin Sdk Start  */
const firebase_private_key_b64 = Buffer.from(process.env.FIREBASE_PRIVATE_KEY, 'base64');
const firebase_private_key = firebase_private_key_b64.toString('utf8');
admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(firebase_private_key))
});
/*  Firebase Admin Sdk End  */

/* Home Route */
app.get('/', (req, res) => {
    res.send('Welcome to Jerin Parlour Server Side')
})

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.bdkak.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


/*    Verify JWT Start    */
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ Unauthorized: "access" })
    }
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
            return res.status(403).send({ "Unauthorized": "Forbidden access" })
        }
        req.decoded = decoded;
        next();
    })
}
/*    Verify JWT End    */


async function run() {

    try {
        await client.connect();
        const serviceCollection = client.db("jerinParlour").collection("services");
        const reveiwCollection = client.db("jerinParlour").collection("reveiws");
        const bookingCollection = client.db("jerinParlour").collection("bookings");
        const userCollection = client.db("jerinParlour").collection("user");
        const paymentCollection = client.db("jerinParlour").collection("payment");

        // Payment Confirm Route
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const order = req.body;
            const price = order.price;
            const amount = price;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            });
            res.send({ clientSecret: paymentIntent.client_secret });
        })

        // Verify Admin
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester })
            if (requesterAccount.role === "Admin") {
                next();
            } else {
                return res.status(403).send({ message: "forbidden" });
            }
        }

        /*    Service Collection Route Start    */
        app.get("/available", async (req, res) => {
            const date = req.query.date;
            const id = req.query.id;
            const services = await serviceCollection.findOne({ _id: ObjectId(id) });
            const query = { date: date }
            const bookings = await bookingCollection.find(query).toArray();
            const serviceBooking = bookings.filter(book => book.treatment === services.name)
            const bookSlots = serviceBooking.map(book => book.slot)
            const available = services.slots.filter(slot => !bookSlots.includes(slot))
            services.slots = available;
            res.send(services);
        })

        app.get("/allServices", async (req, res) => {
            const result = await serviceCollection.find().toArray();
            res.send(result);
        })

        app.get("/services", verifyJWT, verifyAdmin, async (req, res) => {
            const result = await serviceCollection.find().toArray();
            res.send(result);
        })

        app.get("/services/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await serviceCollection.findOne(query);
            res.send(result);
        })

        app.post("/services", verifyJWT, verifyAdmin, async (req, res) => {
            const name = req.query.name;
            const query = { name };
            const exists = await serviceCollection.findOne(query);
            if (exists) {
                return res.send({ success: false });
            }
            const newService = req.body
            const result = await serviceCollection.insertOne(newService);
            res.send({ success: true, result });
        })

        app.delete("/services/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await serviceCollection.deleteOne(query);
            res.send(result);
        })
        /*    Service Collection Route End    */

        /*    Reveiw Collection Route Start    */
        app.get("/reveiws", async (req, res) => {
            const result = await reveiwCollection.find().toArray();
            res.send(result);
        })

        app.post("/reveiws", verifyJWT, async (req, res) => {
            const name = req.query.name;
            const query = { name: name }
            const exists = await reveiwCollection.findOne(query);
            if (exists) {
                return res.send({ success: false });
            }
            const newReveiw = req.body
            const result = await reveiwCollection.insertOne(newReveiw);
            res.send({ success: true, result });
        })
        /*    Reveiw Collection Route End    */

        /*    Booking Collection Route Start    */
        app.get('/orders/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        app.put('/orders/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const orderInformation = req.body;
            const payment = {
                bookingId: orderInformation.orderId,
                transactionId: orderInformation.transactionId
            }
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedOrder = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedOrder);
        })

        app.get("/allBooking", verifyJWT, verifyAdmin, async (req, res) => {
            const result = await bookingCollection.find().toArray();
            res.send(result)
        })

        app.get("/booking", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = { clientEmail: email }
            const result = await bookingCollection.find(query).toArray();
            res.send(result);
        })

        app.get("/booking/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await bookingCollection.findOne(query);
            res.send(result);
        })

        app.post("/booking", verifyJWT, async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, clientName: booking.clientName }
            const exists = await bookingCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send(result);
        })

        app.delete("/booking/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await bookingCollection.deleteOne(query);
            res.send(result);
        })

        app.delete("/manageBooking/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await bookingCollection.deleteOne(query);
            res.send(result);
        })
        /*    Booking Collection Route End    */

        /*    User Collection Route Start    */
        app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.get("/user", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await userCollection.findOne(query);
            res.send(result);
        })

        app.get("/admin/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email })
            const isAdmin = user.role === "Admin"
            res.send({ Admin: isAdmin })
        })

        app.put("/userUpdate", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const updateUser = req.body;
            const filter = { email: email };
            const options = { upsert: true }
            const updateDoc = {
                $set: updateUser,
            }
            const result = await userCollection.updateOne(filter, updateDoc, options)
            res.send({ success: true, result })
        })

        app.put("/user/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email }
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            var token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "40d" })
            res.send({ result, token });
        })

        app.patch("/user", verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.body.email;
            const filter = { email: email }
            const exists = await userCollection.findOne(filter);
            if (!exists || exists.role === "Admin") {
                return res.send({ success: false })
            }
            const updateDoc = {
                $set: { role: "Admin" }
            };
            if (exists.role !== "Admin") {
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send({ success: true, result })
            }
        })

        app.delete("/user", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.query.id;
            const uid = req.query.uid;
            const query = { _id: ObjectId(id) }
            // Delete User in Database
            const result = await userCollection.deleteOne(query);
            // Delete User in Firebase
            getAuth().deleteUser(uid)
            // Database given result pass in client side
            res.send(result);
        })
        /*    User Collection Route End    */

    } finally {
        // await client.close();
    }
}

run().catch(console.dir);

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})