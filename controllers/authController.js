// controllers/authController.js
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabaseClient');

// Регистрация пользователя
exports.registerUser = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Логин и пароль обязательны' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен содержать минимум 6 символов' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = Math.floor(100000 + Math.random() * 900000).toString();

    const { error } = await supabase
      .from('users')
      .insert([{
        username,
        password: hashedPassword,
        user_id: userId,
        balance: 0,
        rub_balance: 0,
        blocked: 0
      }]);

    if (error) {
      if (error.message.includes('unique')) {
        return res.status(409).json({ success: false, error: 'Такой логин уже существует' });
      }
      return res.status(500).json({ success: false, error: error.message });
    }

    console.log('[Регистрация] Новый пользователь:', username, ' userId=', userId);
    res.json({ success: true, userId });
  } catch (err) {
    next(err);
  }
};

// Логин пользователя
exports.loginUser = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !data) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    if (data.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
    }
    const isPassOk = await bcrypt.compare(password, data.password);
    if (!isPassOk) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }

    console.log('[Login] Пользователь вошёл:', username, ' userId=', data.user_id);
    res.json({ success: true, userId: data.user_id });
  } catch (err) {
    next(err);
  }
};

// Логин мерчанта
exports.loginMerchant = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const { data, error } = await supabase
      .from('merchants')
      .select('*')
      .eq('merchant_login', username)
      .single();

    if (error || !data) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    if (data.blocked === 1) {
      return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
    }
    const isPassOk = await bcrypt.compare(password, data.merchant_password);
    if (!isPassOk) {
      return res.status(401).json({ success: false, error: 'Неверные данные пользователя' });
    }
    console.log('[MerchantLogin] Мерчант вошёл:', username, ' merchantId=', data.merchant_id);
    res.json({ success: true, merchantId: data.merchant_id });
  } catch (err) {
    next(err);
  }
};
