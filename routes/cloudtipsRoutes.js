// routes/cloudtipsRoutes.js
const express = require('express');
const router = express.Router();
const cloudtipsController = require('../controllers/cloudtipsController');

router.post('/complete', cloudtipsController.completeCloudtips);

module.exports = router;
