/* ========================
   ИМПОРТЫ И НАСТРОЙКИ СЕРВЕРА
======================== */
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { createClient: createRedisClient } = require('redis');
const csrf = require('csurf');
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'your_default_jwt_secret';

// Инициализация Supabase
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('[Supabase] Ошибка: отсутствует SUPABASE_URL или SUPABASE_KEY');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Инициализация Redis для кеширования
const redisClient = createRedisClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.connect().catch(err => {
  console.error('[Redis] Ошибка подключения:', err);
});

// Настройка CSRF-защиты (только для изменяющих запросов)
const csrfProtection = csrf({ cookie: { httpOnly: true, secure: isProduction, sameSite: 'None' } });

// Проверка наличия Telegram Bot Token (для авторизации через Telegram)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('Ошибка: TELEGRAM_BOT_TOKEN не установлен');
  process.exit(1);
}

/* ========================
   ФУНКЦИИ И ВАЛИДАЦИЯ
======================== */
// Генерация уникального шестизначного ID пользователя
async function generateSixDigitId() {
  let id;
  let isUnique = false;
  while (!isUnique) {
    id = Math.floor(100000 + Math.random() * 900000).toString();
    const { data } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', id)
      .maybeSingle();
    if (!data) isUnique = true;
  }
  return id;
}

/* ========================
   ИНИЦИАЛИЗАЦИЯ EXPRESS-ПРИЛОЖЕНИЯ
======================== */
const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 10000;

// Настройка CORS (разрешен только домен mkntw.ru)
const corsOptions = {
  origin: 'https://mkntw.ru',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
};
app.use(cors(corsOptions));

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

// Применение CSRF-защиты только к опасным запросам
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return csrfProtection(req, res, next);
  }
  next();
});

// Маршрут для получения CSRF-токена
app.get('/csrf-token', csrfProtection, (req, res) => {
  try {
    const token = req.csrfToken();
    res.json({ csrfToken: token });
  } catch (err) {
    console.error('[csrf-token] Ошибка получения CSRF:', err);
    res.status(200).json({ csrfToken: '' });
  }
});

// Ограничение количества запросов для эндпоинтов аутентификации
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 час
  max: 1000,
  message: 'Слишком много запросов с этого IP, попробуйте позже.'
});
app.use(['/login', '/register', '/merchantLogin', '/auth/telegram'], authLimiter);

// Middleware для проверки JWT-токена
function verifyToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Отсутствует токен авторизации' });
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Неверный или просроченный токен' });
    }
    req.user = decoded;
    next();
  });
}

/* ========================
   AUTHENTICATION ENDPOINTS
======================== */

// Выход из системы (logout)
app.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'None'
  });
  res.json({ success: true, message: 'Вы вышли из системы' });
});

// Тестовый маршрут и проверка соединения
app.get('/', (req, res) => {
  res.send('BLAH BLAH BLAH BLÈ BLÈ BLÈ BLÖ BLÖ BLÖ 👾👾👾');
});
app.get('/ping', (req, res) => res.sendStatus(200));

// ==== Новый маршрут авторизации Telegram WebApp ====
app.post('/auth/telegram', async (req, res) => {
  const initData = req.body.initData;
  if (!initData) {
    return res.status(400).json({ success: false, error: 'initData отсутствует' });
  }

  try {
    // Парсим данные и удаляем hash/signature
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    urlParams.delete('signature'); // если вдруг есть

    // Формируем data_check_string
    const dataCheckString = Array.from(urlParams.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');

    // Секрет для HMAC = SHA256 от bot_token
    const secret = crypto.createHash('sha256')
      .update(TELEGRAM_BOT_TOKEN)
      .digest();

    // Проверяем подпись
    const hmac = crypto.createHmac('sha256', secret)
      .update(dataCheckString)
      .digest('hex');
    if (hmac !== hash) {
      console.error('[telegramAuth] Неверная подпись initData');
      return res.status(401).json({ success: false, error: 'Неверная подпись WebApp' });
    }

    // Парсим объект user из initData (urlParams.get('user'))
    let telegramUser;
    try {
      telegramUser = JSON.parse(urlParams.get('user'));
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Невалидные данные пользователя' });
    }

    // Проверяем, есть ли такой пользователь в БД (по telegram_id)
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramUser.id)
      .maybeSingle();

    let userId = existingUser?.user_id;

    // Если нет, создаём
    if (!existingUser) {
      userId = await generateSixDigitId();
      const { error } = await supabase.from('users').insert([{
        user_id: userId,
        telegram_id: telegramUser.id,
        username: telegramUser.username || '',
        first_name: telegramUser.first_name || '',
        photo_url: telegramUser.photo_url || '',
        balance: 0,
        rub_balance: 0,
        blocked: false,
        password: null
      }]);
      if (error) {
        console.error('[TelegramAuth] Ошибка создания пользователя:', error);
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
      }
      console.log(`[TelegramAuth] Создан новый пользователь с ID ${userId}`);
    }

    // Генерируем JWT
    const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'None',
      maxAge: 86400000
    });

    console.log(`[TelegramAuth] Успешный вход пользователя userId=${userId} (isNew=${!existingUser})`);
    res.json({ success: true, userId, isNewUser: !existingUser });
  } catch (err) {
    console.error('Ошибка Telegram авторизации:', err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// === Стандартная регистрация пользователя ===
const registerSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});
app.post('/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { username, password } = value;
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = Math.floor(100000 + Math.random() * 900000).toString();
    const { error: supabaseError } = await supabase.from('users').insert([{
      username,
      password: hashedPassword,
      user_id: userId,
      balance: 0,
      rub_balance: 0,
      blocked: 0
    }]);
    if (supabaseError) {
      if (supabaseError.message && supabaseError.message.includes('unique')) {
        return res.status(409).json({ success: false, error: 'Такой логин уже существует' });
      }
      return res.status(500).json({ success: false, error: supabaseError.message || 'Ошибка базы данных' });
    }
    res.json({ success: true, message: 'Пользователь успешно зарегистрирован', userId });
  } catch (err) {
    console.error('[register] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   2) ЛОГИН ПОЛЬЗОВАТЕЛЯ
======================== */
const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});
app.post('/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { username, password } = value;
    const { data, error: supabaseError } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();
    if (supabaseError || !data) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    if (data.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
    }
    const isPassOk = await bcrypt.compare(password, data.password);
    if (!isPassOk) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    // Успешный вход: выдаем JWT-токен
    const token = jwt.sign({ userId: data.user_id, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'None',
      maxAge: 3600000  // 1 час
    });
    res.json({ success: true, message: 'Пользователь успешно авторизован', user: data });
  } catch (err) {
    console.error('[login] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   3) ЛОГИН МЕРЧАНТА
======================== */
const merchantLoginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});
app.post('/merchantLogin', async (req, res) => {
  try {
    const { error, value } = merchantLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { username, password } = value;
    const { data, error: supabaseError } = await supabase
      .from('merchants')
      .select('*')
      .eq('merchant_login', username)
      .single();
    if (supabaseError || !data) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    if (data.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
    }
    const isPassOk = await bcrypt.compare(password, data.merchant_password);
    if (!isPassOk) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    const token = jwt.sign({ merchantId: data.merchant_id, role: 'merchant' }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'None',
      maxAge: 86400000  // 24 часа
    });
    res.json({ success: true, message: 'Мерчант успешно авторизован', merchant: data });
  } catch (err) {
    console.error('[merchantLogin] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   4) МАЙНИНГ (/update)
======================== */
const updateMiningSchema = Joi.object({
  amount: Joi.number().positive().required()
});
app.post('/update', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const userId = req.user.userId;
    const { error, value } = updateMiningSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { amount } = value;
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (userError || !userData) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    if (userData.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
    }
    const newBalance = parseFloat(userData.balance || 0) + amount;
    const { error: updateErr } = await supabase
      .from('users')
      .update({ balance: newBalance.toFixed(5) })
      .eq('user_id', userId);
    if (updateErr) {
      return res.status(500).json({ success: false, error: 'Не удалось обновить баланс' });
    }
    const { data: halvingData } = await supabase
      .from('halving')
      .select('*')
      .limit(1);
    let totalMined = amount;
    if (halvingData && halvingData.length > 0) {
      totalMined = parseFloat(halvingData[0].total_mined || 0) + amount;
    }
    const halvingStep = Math.floor(totalMined);
    await supabase
      .from('halving')
      .upsert([{ id: 1, total_mined: totalMined, halving_step: halvingStep }]);
    console.log('[Mining] userId=', userId, '+', amount, '=>', newBalance);
    res.json({ success: true, balance: newBalance.toFixed(5), halvingStep });
  } catch (err) {
    console.error('[update] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   5) GET /user (получение данных пользователя)
======================== */
app.get('/user', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const userId = req.user.userId;
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error || !userData) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    if (userData.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Пользователь заблокирован' });
    }
    let halvingStep = 0;
    const { data: halvingData } = await supabase
      .from('halving')
      .select('halving_step')
      .limit(1);
    if (halvingData && halvingData.length > 0) {
      halvingStep = halvingData[0].halving_step;
    }
    res.json({ success: true, user: { ...userData, halvingStep } });
  } catch (err) {
    console.error('[user] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   6) POST /transfer (перевод монет между пользователями)
======================== */
const transferSchema = Joi.object({
  toUserId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  tags: Joi.string().allow('', null)
});
app.post('/transfer', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const fromUserId = req.user.userId;
    const { error, value } = transferSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { toUserId, amount, tags } = value;
    if (fromUserId === toUserId) {
      return res.status(400).json({ success: false, error: 'Нельзя переводить самому себе' });
    }
    const { data: fromUser } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', fromUserId)
      .single();
    if (!fromUser) {
      return res.status(404).json({ success: false, error: 'Отправитель не найден' });
    }
    if (parseFloat(fromUser.balance) < amount) {
      return res.status(400).json({ success: false, error: 'Недостаточно средств' });
    }
    const { data: toUser } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', toUserId)
      .single();
    if (!toUser) {
      return res.status(404).json({ success: false, error: 'Получатель не найден' });
    }
    const newFromBalance = parseFloat(fromUser.balance) - amount;
    const newToBalance = parseFloat(toUser.balance) + amount;
    await supabase.from('users').update({ balance: newFromBalance.toFixed(5) }).eq('user_id', fromUserId);
    await supabase.from('users').update({ balance: newToBalance.toFixed(5) }).eq('user_id', toUserId);
    // Генерация уникального хеша транзакции
    const hash = crypto.randomBytes(16).toString('hex');
    const { error: insertError } = await supabase.from('transactions').insert([{
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount,
      hash,
      tags: tags || null,
      type: 'sent',
      currency: 'GUGA'
    }]);
    if (insertError) {
      console.error('Ошибка записи транзакции:', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    console.log(`[transfer] ${fromUserId} → ${toUserId} = ${amount} GUGA, hash=${hash}`);
    res.json({ success: true, fromBalance: newFromBalance, toBalance: newToBalance, hash });
  } catch (err) {
    console.error('[transfer] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   6.1) POST /transferRub (перевод рублей между пользователями)
======================== */
app.post('/transferRub', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const fromUserId = req.user.userId;
    const { toUserId, amount, tags } = req.body;
    if (!toUserId || !amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Неверные данные' });
    }
    if (fromUserId === toUserId) {
      return res.status(400).json({ success: false, error: 'Нельзя переводить самому себе' });
    }
    const { data: fromUser } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', fromUserId)
      .single();
    const { data: toUser } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', toUserId)
      .single();
    if (!fromUser || !toUser) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    const rubBalance = parseFloat(fromUser.rub_balance || 0);
    if (rubBalance < amount) {
      return res.status(400).json({ success: false, error: 'Недостаточно рублей' });
    }
    const newFromRub = rubBalance - amount;
    const newToRub = parseFloat(toUser.rub_balance || 0) + amount;
    await supabase.from('users').update({ rub_balance: newFromRub.toFixed(2) }).eq('user_id', fromUserId);
    await supabase.from('users').update({ rub_balance: newToRub.toFixed(2) }).eq('user_id', toUserId);
    const hash = crypto.randomBytes(16).toString('hex');
    const { error: insertError } = await supabase.from('transactions').insert([{
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount,
      hash,
      tags: tags || null,
      type: 'sent',
      currency: 'RUB'
    }]);
    if (insertError) {
      console.error('Ошибка записи транзакции (RUB):', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    console.log(`[transferRub] ${fromUserId} → ${toUserId} = ${amount}₽`);
    res.json({ success: true, newFromRub, newToRub, hash });
  } catch (err) {
    console.error('[transferRub] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   7) GET /transactions (история транзакций)
======================== */
app.get('/transactions', verifyToken, async (req, res) => {
  try {
    let allTransactions = [];
    if (req.user.role === 'user') {
      const userId = req.user.userId;
      const { data: sentTx, error: sentError } = await supabase
        .from('transactions')
        .select('*')
        .eq('from_user_id', userId)
        .order('created_at', { ascending: false });
      const { data: receivedTx, error: receivedError } = await supabase
        .from('transactions')
        .select('*')
        .eq('to_user_id', userId)
        .order('created_at', { ascending: false });
      if (sentError || receivedError) {
        return res.status(500).json({ success: false, error: 'Ошибка при получении транзакций пользователя' });
      }
      allTransactions = [
        ...(sentTx || []).map(tx => ({ ...tx, display_time: tx.created_at })),
        ...(receivedTx || []).map(tx => ({ ...tx, display_time: tx.created_at }))
      ];
      const { data: exchangeTx, error: exchangeError } = await supabase
        .from('exchange_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('client_time', { ascending: false });
      if (!exchangeError) {
        const mappedExchangeTx = (exchangeTx || []).map(tx => ({
          ...tx,
          type: 'exchange',
          display_time: tx.client_time || tx.created_at
        }));
        allTransactions = [...allTransactions, ...mappedExchangeTx];
      }
    } else if (req.user.role === 'merchant') {
      const merchantId = req.user.merchantId;
      const { data: merchantPayments, error: merchantError } = await supabase
        .from('merchant_payments')
        .select('*')
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: false });
      if (merchantError) {
        return res.status(500).json({ success: false, error: 'Ошибка при получении транзакций мерчанта' });
      }
      allTransactions = (merchantPayments || []).map(tx => ({
        ...tx,
        type: 'merchant_payment',
        display_time: tx.created_at
      }));
    } else {
      return res.status(400).json({ success: false, error: 'Неверная роль для получения транзакций' });
    }
    // Отбираем последние 20 транзакций
    allTransactions.sort((a, b) => new Date(b.display_time) - new Date(a.display_time));
    const last20Transactions = allTransactions.slice(0, 100);
    // console.log('Последние 20 транзакций:', last20Transactions);
    res.json({ success: true, transactions: last20Transactions });
  } catch (err) {
    console.error('[transactions] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка при получении истории' });
  }
});

/* ========================
   УНИВЕРСАЛЬНЫЙ SYNC-ЭНДПОИНТ
======================== */
app.get('/sync', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const cacheKey = `sync:${userId}`;
    // Проверяем кеш Redis
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    const [userData, txData, exchangeData, rateData] = await Promise.all([
      supabase.from('users').select('*').eq('user_id', userId).single(),
      supabase.from('transactions').select('*').or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`).order('created_at', { ascending: false }).limit(10),
      supabase.from('exchange_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
      supabase.from('exchange_rate_history').select('*').order('created_at', { ascending: false }).limit(1)
    ]);
    const payload = {
      success: true,
      user: userData.data,
      transactions: txData.data,
      exchange: exchangeData.data,
      latestRate: rateData.data[0]
    };
    // Кешируем результат на 1 секунду
    await redisClient.set(cacheKey, JSON.stringify(payload), { EX: 1 });
    res.json(payload);
  } catch (err) {
    console.error('[sync] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка синхронизации' });
  }
});

/* ========================
   9) POST /merchantTransfer (мерчант → пользователь)
======================== */
const merchantTransferSchema = Joi.object({
  toUserId: Joi.string().required(),
  amount: Joi.number().positive().required()
});
app.post('/merchantTransfer', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'merchant') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const merchantId = req.user.merchantId;
    const { error, value } = merchantTransferSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { toUserId, amount } = value;
    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'Отсутствует идентификатор мерчанта' });
    }
    const { data: merch } = await supabase
      .from('merchants')
      .select('*')
      .eq('merchant_id', merchantId)
      .single();
    if (!merch) {
      return res.status(404).json({ success: false, error: 'Мерчант не найден' });
    }
    if (merch.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
    }
    if (parseFloat(merch.balance) < amount) {
      return res.status(400).json({ success: false, error: 'Недостаточно средств у мерчанта' });
    }
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', toUserId)
      .single();
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    const newMerchantBal = parseFloat(merch.balance) - amount;
    await supabase.from('merchants').update({ balance: newMerchantBal.toFixed(5) }).eq('merchant_id', merchantId);
    const newUserBal = parseFloat(user.balance) + amount;
    await supabase.from('users').update({ balance: newUserBal.toFixed(5) }).eq('user_id', toUserId);
    const { error: insertError } = await supabase.from('transactions').insert([{
      from_user_id: 'MERCHANT:' + merchantId,
      to_user_id: toUserId,
      amount,
      type: 'received'
    }]);
    if (insertError) {
      console.error('Ошибка записи транзакции (merchantTransfer):', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    console.log(`[merchantTransfer] merchant=${merchantId} -> user=${toUserId} amount=${amount}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[merchantTransfer] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка при переводе мерчант->пользователь' });
  }
});

/* ========================
   10) POST /payMerchantOneTime (оплата QR-кода мерчанта пользователем)
======================== */
const payMerchantSchema = Joi.object({
  merchantId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  purpose: Joi.string().allow('')
});
app.post('/payMerchantOneTime', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const userId = req.user.userId;
    const { error, value } = payMerchantSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { merchantId, amount, purpose } = value;
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (!userData) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    if (userData.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Пользователь заблокирован' });
    }
    if (parseFloat(userData.balance) < amount) {
      return res.status(400).json({ success: false, error: 'Недостаточно средств у пользователя' });
    }
    const { data: merchData } = await supabase
      .from('merchants')
      .select('*')
      .eq('merchant_id', merchantId)
      .single();
    if (!merchData) {
      return res.status(404).json({ success: false, error: 'Мерчант не найден' });
    }
    if (merchData.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Мерчант заблокирован' });
    }
    const newUserBalance = parseFloat(userData.balance) - amount;
    await supabase.from('users').update({ balance: newUserBalance.toFixed(5) }).eq('user_id', userId);
    const merchantAmount = amount;
    const newMerchantBalance = parseFloat(merchData.balance) + merchantAmount;
    await supabase.from('merchants').update({ balance: newMerchantBalance.toFixed(5) }).eq('merchant_id', merchantId);
    const { error: insertError } = await supabase.from('transactions').insert([{
      from_user_id: userId,
      to_user_id: 'MERCHANT:' + merchantId,
      amount,
      type: 'merchant_payment'
    }]);
    if (insertError) {
      console.error('Ошибка записи транзакции для мерчанта:', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    await supabase.from('merchant_payments').insert([{
      user_id: userId,
      merchant_id: merchantId,
      amount: merchantAmount,
      purpose
    }]);
    console.log(`[payMerchantOneTime] user=${userId} => merchant=${merchantId}, amount=${amount}, merchantGets=${merchantAmount}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[payMerchantOneTime] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   11) GET /exchangeRates (история обменных курсов)
======================== */
app.get('/exchangeRates', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    let query = supabase
      .from('exchange_rate_history')
      .select('*')
      .order('created_at', { ascending: false });
    if (limit) {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, rates: data });
  } catch (err) {
    console.error('[exchangeRates] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   12) POST /exchange (обмен RUB ↔ COIN)
======================== */
const exchangeSchema = Joi.object({
  direction: Joi.string().valid('rub_to_coin', 'coin_to_rub').required(),
  amount: Joi.number().positive().required()
});
app.post('/exchange', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const userId = req.user.userId;
    const { error, value } = exchangeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { direction, amount } = value;
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (userError || !userData) {
      console.error('Ошибка получения пользователя:', userError);
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    if (userData.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Пользователь заблокирован' });
    }
    const { data: poolData, error: poolError } = await supabase
      .from('liquidity_pool')
      .select('*')
      .eq('id', 1)
      .single();
    if (poolError || !poolData) {
      console.error('Ошибка получения данных пула:', poolError);
      return res.status(500).json({ success: false, error: 'Данные пула не найдены' });
    }
    let reserveCoin = parseFloat(poolData.reserve_coin);
    let reserveRub = parseFloat(poolData.reserve_rub);
    let newReserveCoin, newReserveRub, outputAmount;
    const fee = 0.02;  // комиссия 2%
    if (direction === 'rub_to_coin') {
      const userRub = parseFloat(userData.rub_balance || 0);
      if (userRub < amount) {
        return res.status(400).json({ success: false, error: 'Недостаточно рублей' });
      }
      const effectiveRub = amount * (1 - fee);
      outputAmount = reserveCoin - (reserveCoin * reserveRub) / (reserveRub + effectiveRub);
      if (outputAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Невозможно выполнить обмен' });
      }
      newReserveRub = reserveRub + effectiveRub;
      newReserveCoin = reserveCoin - outputAmount;
      const newUserRub = userRub - amount;
      const userCoin = parseFloat(userData.balance || 0);
      const newUserCoin = userCoin + outputAmount;
      const { error: updateUserError } = await supabase.from('users').update({
        rub_balance: Number(newUserRub.toFixed(2)),
        balance: Number(newUserCoin.toFixed(5))
      }).eq('user_id', userId);
      if (updateUserError) {
        console.error('Ошибка обновления пользователя:', updateUserError);
        return res.status(500).json({ success: false, error: 'Ошибка обновления баланса пользователя' });
      }
    } else if (direction === 'coin_to_rub') {
      const userCoin = parseFloat(userData.balance || 0);
      if (userCoin < amount) {
        return res.status(400).json({ success: false, error: 'Недостаточно монет' });
      }
      const effectiveCoin = amount * (1 - fee);
      outputAmount = reserveRub - (reserveRub * reserveCoin) / (reserveCoin + effectiveCoin);
      if (outputAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Невозможно выполнить обмен' });
      }
      newReserveCoin = reserveCoin + effectiveCoin;
      newReserveRub = reserveRub - outputAmount;
      const userRub = parseFloat(userData.rub_balance || 0);
      const newUserRub = userRub + outputAmount;
      const newUserCoin = parseFloat(userData.balance) - amount;
      const { error: updateUserError } = await supabase.from('users').update({
        rub_balance: Number(newUserRub.toFixed(2)),
        balance: Number(newUserCoin.toFixed(5))
      }).eq('user_id', userId);
      if (updateUserError) {
        console.error('Ошибка обновления пользователя:', updateUserError);
        return res.status(500).json({ success: false, error: 'Ошибка обновления баланса пользователя' });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Неверное направление обмена' });
    }
    const newExchangeRate = newReserveRub / newReserveCoin;
    if (newExchangeRate < 0.01) {
      return res.status(400).json({ success: false, error: 'Обмен невозможен: курс не может опуститься ниже 0.01' });
    }
    const { error: updatePoolError } = await supabase.from('liquidity_pool').update({
      reserve_coin: Number(newReserveCoin.toFixed(5)),
      reserve_rub: Number(newReserveRub.toFixed(2)),
      updated_at: new Date().toISOString()
    }).eq('id', 1);
    if (updatePoolError) {
      console.error('Ошибка обновления пула:', updatePoolError);
      return res.status(500).json({ success: false, error: 'Ошибка обновления данных пула' });
    }
    const { error: txError } = await supabase.from('exchange_transactions').insert([{
      user_id: userId,
      direction,
      amount,
      exchanged_amount: Number(outputAmount.toFixed(5)),
      new_rub_balance: direction === 'rub_to_coin'
        ? Number((parseFloat(userData.rub_balance) - amount).toFixed(2))
        : Number((parseFloat(userData.rub_balance) + outputAmount).toFixed(2)),
      new_coin_balance: direction === 'rub_to_coin'
        ? Number((parseFloat(userData.balance) + outputAmount).toFixed(5))
        : Number((parseFloat(userData.balance) - amount).toFixed(5)),
      created_at: new Date().toISOString(),
      exchange_rate: Number(newExchangeRate.toFixed(5))
    }]);
    if (txError) {
      console.error('Ошибка записи транзакции:', txError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    const rateValue = Number(newExchangeRate.toFixed(5));
    const { error: rateError } = await supabase.from('exchange_rate_history').insert([{ exchange_rate: rateValue }]);
    if (rateError) {
      console.error('Ошибка записи курса в историю:', rateError);
    }
    res.json({
      success: true,
      newRubBalance: direction === 'rub_to_coin'
        ? Number((parseFloat(userData.rub_balance) - amount).toFixed(2))
        : Number((parseFloat(userData.rub_balance) + outputAmount).toFixed(2)),
      newCoinBalance: direction === 'rub_to_coin'
        ? Number((parseFloat(userData.balance) + outputAmount).toFixed(5))
        : Number((parseFloat(userData.balance) - amount).toFixed(5)),
      currentratedisplay: Number(newExchangeRate.toFixed(5)),
      exchanged_amount: Number(outputAmount.toFixed(5))
    });
  } catch (err) {
    console.error('[exchange] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   13) GET /merchant/info (информация о мерчанте)
======================== */
app.get('/merchant/info', verifyToken, async (req, res) => {
  if (req.user.role !== 'merchant') {
    return res.status(403).json({ success: false, error: 'Доступ запрещён' });
  }
  const merchantId = req.user.merchantId;
  const { data: merchantData, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('merchant_id', merchantId)
    .single();
  if (error || !merchantData) {
    return res.status(404).json({ success: false, error: 'Мерчант не найден' });
  }
  res.json({ success: true, merchant: merchantData });
});

/* ========================
   GET /merchantBalance (баланс мерчанта)
======================== */
app.get('/merchantBalance', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'merchant') {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    const merchantId = req.user.merchantId;
    const { data, error } = await supabase
      .from('merchants')
      .select('*')
      .eq('merchant_id', merchantId)
      .single();
    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Мерчант не найден' });
    }
    res.json({ success: true, balance: data.balance });
  } catch (err) {
    console.error('[merchantBalance] Ошибка:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/* ========================
   14) POST /auth/telegram (авторизация через Telegram)
======================== */
app.post('/auth/telegram', async (req, res) => {
  if (!isTelegramAuthValid(req.body, TELEGRAM_BOT_TOKEN)) {
    return res.status(403).json({ success: false, error: 'Неверная подпись Telegram' });
  }

  try {
    const {
      id: telegramId,
      first_name: firstName,
      username,
      photo_url: photoUrl
    } = req.body;

    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (existingUser) {
      const token = jwt.sign({ userId: existingUser.user_id, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'None',
        maxAge: 86400000
      });
      return res.json({ success: true, userId: existingUser.user_id, isNewUser: false });
    }

    const userId = await generateSixDigitId();

    const generateUniqueUsername = async (base) => {
      let candidate = (base || `user${Date.now()}`).substring(0, 15);
      let counter = 1;
      while (true) {
        const { data } = await supabase
          .from('users')
          .select('username')
          .eq('username', candidate)
          .maybeSingle();
        if (!data) return candidate;
        candidate = `${base}_${counter++}`.substring(0, 15);
      }
    };

    const uniqueUsername = await generateUniqueUsername(username || firstName);

    const { error } = await supabase.from('users').insert([{
      user_id: userId,
      telegram_id: telegramId,
      username: uniqueUsername,
      first_name: firstName ? firstName.substring(0, 30) : null,
      photo_url: photoUrl,
      balance: 0,
      rub_balance: 0,
      blocked: false,
      password: null
    }]);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ success: false, error: 'Ошибка регистрации' });
    }

    const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'None',
      maxAge: 86400000
    });

    res.json({ success: true, userId, isNewUser: true });
  } catch (error) {
    console.error('Telegram auth error:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

/* ========================
   15) GET /transaction/:hash (поиск транзакции по хешу)
======================== */
app.get('/transaction/:hash', async (req, res) => {
  const { hash } = req.params;
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('hash', hash)
    .single();
  if (error || !data) {
    return res.status(404).json({ success: false, error: 'Транзакция не найдена' });
  }
  res.json({ success: true, transaction: data });
});

// Запуск сервера
app.listen(port, '0.0.0.0', () => {
  console.log(`[Server] Запущен на порту ${port}`);
});

app.post('/auth/telegram', async (req, res) => {
  const initData = req.body.initData;
  console.log("== [Telegram Auth] initData:", initData);
  console.log("== [Telegram Auth] Token:", TELEGRAM_BOT_TOKEN);

  if (!initData) {
    return res.status(400).json({ success: false, error: 'initData отсутствует' });
  }

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");
  urlParams.delete("signature");

  const dataCheckString = Array.from(urlParams.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  console.log("== [Telegram Auth] data_check_string:\n", dataCheckString);

  const secret = require("crypto").createHash("sha256").update(TELEGRAM_BOT_TOKEN).digest();
  const hmac = require("crypto").createHmac("sha256", secret).update(dataCheckString).digest("hex");

  console.log("== [Telegram Auth] Ожидаемый HMAC:", hmac);
  console.log("== [Telegram Auth] Пришедший hash:", hash);

  if (hmac !== hash) {
    console.warn("== [Telegram Auth] Неверная подпись WebApp ==");
    return res.status(401).json({ success: false, error: 'Неверная подпись WebApp' });
  }

  const userRaw = urlParams.get("user");
  let user;
  try {
    user = JSON.parse(userRaw);
  } catch (e) {
    return res.status(400).json({ success: false, error: "Невалидные данные пользователя" });
  }

  console.log("== [Telegram Auth] Пользователь:", user);

  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', user.id)
      .maybeSingle();

    let userId = existingUser?.user_id;
    if (!existingUser) {
      userId = await generateSixDigitId();
      const { error } = await supabase.from('users').insert([{
        user_id: userId,
        telegram_id: user.id,
        username: user.username || '',
        first_name: user.first_name || '',
        photo_url: user.photo_url || '',
        balance: 0,
        rub_balance: 0,
        blocked: false,
        password: null
      }]);
      if (error) {
        console.error("Ошибка создания пользователя:", error);
        return res.status(500).json({ success: false, error: "Ошибка базы данных" });
      }
    }

    const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'None',
      maxAge: 86400000
    });

    res.json({ success: true, userId, isNewUser: !existingUser });
  } catch (err) {
    console.error("Ошибка Telegram авторизации:", err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});
