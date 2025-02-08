// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const miningController = require('../controllers/miningController');
const transactionController = require('../controllers/transactionController');
const halvingController = require('../controllers/halvingController');
const exchangeController = require('../controllers/exchangeController');
const rubPurchaseController = require('../controllers/rubPurchaseController');

// Обновление баланса (майнинг)
router.post('/update', miningController.updateMining);

// Эндпоинт для получения данных пользователя можно реализовать здесь или напрямую обращаться к Supabase
router.get('/user', (req, res) => {
  res.status(501).json({ success: false, error: 'Не реализовано' });
});

// История транзакций
router.get('/transactions', transactionController.getTransactions);

// Обмен валют
router.post('/exchange', exchangeController.exchange);

// Рублевые операции (purchase / sale)
router.post('/rub_purchase', rubPurchaseController.rubPurchase);

// Информация по halving
router.get('/halvingInfo', halvingController.getHalvingInfo);

module.exports = router;
