// server.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const cloudtipsRoutes = require('./routes/cloudtipsRoutes');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const app = express();
const port = process.env.PORT || 3000;

// Безопасность: установка базовых HTTP-заголовков
app.use(helmet());

// Ограничиваем CORS (можно указать конкретный origin через переменную CORS_ORIGIN)
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));

// Разбор JSON-тела запроса
app.use(express.json());

// Маршруты
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', merchantRoutes);
app.use('/cloudtips', cloudtipsRoutes);

// Тестовый endpoint
app.get('/', (req, res) => {
  res.send('GugaCoin backend server (users + merchants + QR payments + rub_balance + Cloudtips).');
});

// Обработка 404
app.use(notFound);

// Централизованная обработка ошибок
app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`[Server] Запущен на порту ${port}`);
});
