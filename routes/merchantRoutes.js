// routes/merchantRoutes.js
const express = require('express');
const router = express.Router();
const merchantController = require('../controllers/merchantController');

router.post('/merchantTransfer', merchantController.merchantTransfer);
router.get('/merchantBalance', merchantController.getMerchantBalance);

module.exports = router;
