const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
const cors = require('cors'); // Run 'npm install cors' in terminal
app.use(cors());
// 1. YOUR DARAJA CREDENTIALS (From Safaricom Developer Portal)
const CONSUMER_KEY = 'your_consumer_key';
const CONSUMER_SECRET = 'your_consumer_secret';
const SHORTCODE = '174379'; // Sandbox shortcode
const PASSKEY = 'your_passkey';

// 2. MIDDLEWARE TO GET OAUTH TOKEN
async function getAccessToken(req, res, next) {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    try {
        const { data } = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        req.token = data.access_token;
        next();
    } catch (err) { res.status(500).send("Auth failed"); }
}

// 3. THE STK PUSH ENDPOINT
app.post('/stkpush', getAccessToken, async (req, res) => {
    const phone = req.body.phone; // e.g., 254712345678
    const amount = req.body.amount;
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

    try {
        const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            "BusinessShortCode": SHORTCODE,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phone,
            "PartyB": SHORTCODE,
            "PhoneNumber": phone,
            "CallBackURL": "https://yourdomain.com/callback", // Must be a real HTTPS URL
            "AccountReference": "DeclareFamily",
            "TransactionDesc": "Subscription Payment"
        }, {
            headers: { Authorization: `Bearer ${req.token}` }
        });
        res.json(response.data);
    } catch (err) { res.status(400).send(err.message); }
});

app.listen(3000, () => console.log('Server running on port 3000'));
