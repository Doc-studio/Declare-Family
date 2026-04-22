/**
 * ================================================================
 * DECLARE FAMILY — M-Pesa Daraja API Backend
 * server.js  |  Node.js + Express
 * ================================================================
 *
 * SETUP INSTRUCTIONS
 * ------------------
 * 1. npm install express axios cors dotenv
 * 2. Create a .env file with your Safaricom credentials (see below)
 * 3. node server.js
 *
 * REQUIRED .env FILE
 * ------------------
 * CONSUMER_KEY=your_consumer_key_from_daraja_portal
 * CONSUMER_SECRET=your_consumer_secret_from_daraja_portal
 * SHORTCODE=174379          # Use 174379 for sandbox, your paybill/till for production
 * PASSKEY=your_lipa_na_mpesa_passkey
 * CALLBACK_URL=https://yourdomain.com/mpesa/callback
 * PAYBILL_NUMBER=0116251682 # Declare Family collection number
 * PORT=3000
 *
 * PRODUCTION vs SANDBOX
 * ---------------------
 * Change BASE_URL to https://api.safaricom.co.ke for live payments
 *
 * ================================================================
 */

require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Allow requests from your HTML frontend

/* ── CONFIG ──────────────────────────────────────────────────── */
const BASE_URL        = 'https://sandbox.safaricom.co.ke'; // Switch to api.safaricom.co.ke for production
const CONSUMER_KEY    = process.env.CONSUMER_KEY    || 'your_consumer_key';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'your_consumer_secret';
const SHORTCODE       = process.env.SHORTCODE       || '174379';
const PASSKEY         = process.env.PASSKEY         || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const CALLBACK_URL    = process.env.CALLBACK_URL    || 'https://yourdomain.com/mpesa/callback';
const PAYBILL         = process.env.PAYBILL_NUMBER  || '0116251682';

/* In-memory store for transaction status (use a database in production) */
const transactions = {};

/* ── STEP 1: GET OAUTH TOKEN ─────────────────────────────────── */
async function getAccessToken() {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const { data } = await axios.get(
        `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { Authorization: `Basic ${auth}` } }
    );
    return data.access_token;
}

/* ── STEP 2: STK PUSH ────────────────────────────────────────── */
app.post('/mpesa/stkpush', async (req, res) => {
    try {
        const { phone, amount, accountRef, memberID, memberName } = req.body;

        if (!phone || !amount) {
            return res.status(400).json({ success: false, message: 'Phone and amount are required.' });
        }

        // Normalize phone to 254 format
        let normalized = String(phone).replace(/\s/g, '').replace(/^\+/, '');
        if (normalized.startsWith('0')) normalized = '254' + normalized.slice(1);
        if (normalized.startsWith('7') || normalized.startsWith('1')) normalized = '254' + normalized;
        if (normalized.length !== 12) {
            return res.status(400).json({ success: false, message: 'Invalid phone number. Use format 07XXXXXXXX.' });
        }

        const amountInt = Math.max(1, Math.floor(Number(amount)));
        if (isNaN(amountInt) || amountInt < 1) {
            return res.status(400).json({ success: false, message: 'Invalid amount.' });
        }

        const token = await getAccessToken();
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

        const payload = {
            BusinessShortCode: SHORTCODE,
            Password:          password,
            Timestamp:         timestamp,
            TransactionType:   'CustomerPayBillOnline',
            Amount:            amountInt,
            PartyA:            normalized,          // Customer phone
            PartyB:            PAYBILL,             // Declare Family collection number
            PhoneNumber:       normalized,
            CallBackURL:       CALLBACK_URL,
            AccountReference:  accountRef || `DF-${memberID || 'MEMBER'}`,
            TransactionDesc:   `Declare Family Contribution - ${memberName || 'Member'}`
        };

        const response = await axios.post(
            `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
            payload,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const { CheckoutRequestID, ResponseCode, ResponseDescription, CustomerMessage } = response.data;

        if (ResponseCode !== '0') {
            return res.status(400).json({ success: false, message: ResponseDescription || 'STK push failed.' });
        }

        // Store pending transaction
        transactions[CheckoutRequestID] = {
            status:        'pending',
            phone:         normalized,
            amount:        amountInt,
            memberID:      memberID || '',
            memberName:    memberName || '',
            accountRef:    accountRef || '',
            initiatedAt:   new Date().toISOString(),
            checkoutID:    CheckoutRequestID
        };

        return res.json({
            success:           true,
            checkoutRequestID: CheckoutRequestID,
            message:           CustomerMessage || 'STK push sent. Please check your phone and enter your M-Pesa PIN.'
        });

    } catch (err) {
        console.error('STK Push Error:', err?.response?.data || err.message);
        const msg = err?.response?.data?.errorMessage || err.message || 'STK push request failed.';
        return res.status(500).json({ success: false, message: msg });
    }
});

/* ── STEP 3: SAFARICOM CALLBACK (receives payment confirmation) ── */
app.post('/mpesa/callback', (req, res) => {
    try {
        const body   = req.body?.Body?.stkCallback;
        const id     = body?.CheckoutRequestID;
        const result = body?.ResultCode; // 0 = success

        if (!id) return res.status(400).json({ message: 'Invalid callback' });

        if (result === 0) {
            // SUCCESS: Payment confirmed
            const meta = body?.CallbackMetadata?.Item || [];
            const get  = (name) => (meta.find(i => i.Name === name) || {}).Value;

            transactions[id] = Object.assign(transactions[id] || {}, {
                status:     'confirmed',
                mpesaRef:   get('MpesaReceiptNumber'),
                amount:     get('Amount'),
                confirmedAt: new Date().toISOString()
            });

            console.log(`✅ Payment confirmed: ${id} | Ref: ${get('MpesaReceiptNumber')} | Ksh ${get('Amount')}`);
        } else {
            // FAILED: User cancelled, wrong PIN, timeout, etc.
            transactions[id] = Object.assign(transactions[id] || {}, {
                status:    'failed',
                reason:    body?.ResultDesc || 'Payment not completed',
                failedAt:  new Date().toISOString()
            });
            console.log(`❌ Payment failed: ${id} | ${body?.ResultDesc}`);
        }

        // Acknowledge Safaricom immediately (required)
        return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    } catch (err) {
        console.error('Callback error:', err.message);
        return res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Always ACK
    }
});

/* ── STEP 4: FRONTEND POLLS THIS TO KNOW IF PAYMENT SUCCEEDED ── */
app.get('/mpesa/status/:checkoutRequestID', (req, res) => {
    const id  = req.params.checkoutRequestID;
    const tx  = transactions[id];

    if (!tx) {
        return res.json({ status: 'pending', message: 'Waiting for confirmation...' });
    }

    return res.json({
        status:    tx.status,        // 'pending' | 'confirmed' | 'failed'
        mpesaRef:  tx.mpesaRef || null,
        amount:    tx.amount   || null,
        memberID:  tx.memberID || null,
        reason:    tx.reason   || null
    });
});

/* ── OPTIONAL: QUERY STATUS DIRECTLY FROM SAFARICOM ─────────── */
app.get('/mpesa/query/:checkoutRequestID', async (req, res) => {
    try {
        const token     = await getAccessToken();
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password  = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

        const response = await axios.post(
            `${BASE_URL}/mpesa/stkpushquery/v1/query`,
            { BusinessShortCode: SHORTCODE, Password: password, Timestamp: timestamp, CheckoutRequestID: req.params.checkoutRequestID },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return res.json(response.data);
    } catch (err) {
        return res.status(500).json({ error: err?.response?.data || err.message });
    }
});

/* ── HEALTH CHECK ────────────────────────────────────────────── */
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Declare Family M-Pesa Gateway', time: new Date().toISOString() }));

/* ── START SERVER ────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Declare Family M-Pesa Server running on port ${PORT}`);
    console.log(`   STK Push  →  POST  /mpesa/stkpush`);
    console.log(`   Callback  →  POST  /mpesa/callback`);
    console.log(`   Status    →  GET   /mpesa/status/:id`);
    console.log(`   Health    →  GET   /health\n`);
});

module.exports = app;
