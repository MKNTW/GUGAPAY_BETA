// controllers/merchantController.js
const supabase = require('../db/supabaseClient');

exports.merchantTransfer = async (req, res, next) => {
  try {
    const { merchantId, toUserId, amount } = req.body;
    if (!merchantId || !toUserId || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Неверные данные' });
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
    await supabase
      .from('merchants')
      .update({ balance: newMerchantBal.toFixed(5) })
      .eq('merchant_id', merchantId);
    const newUserBal = parseFloat(user.balance) + amount;
    await supabase
      .from('users')
      .update({ balance: newUserBal.toFixed(5) })
      .eq('user_id', toUserId);
    
    // Запись транзакции в таблицу transactions
    const { error: insertError } = await supabase
      .from('transactions')
      .insert([
        {
          from_user_id: 'MERCHANT:' + merchantId,
          to_user_id: toUserId,
          amount,
          type: 'received'
        }
      ]);
    if (insertError) {
      console.error('Ошибка вставки транзакции (merchantTransfer):', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    console.log(`[merchantTransfer] merchant=${merchantId} -> user=${toUserId} amount=${amount}`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.getMerchantBalance = async (req, res, next) => {
  try {
    const { merchantId } = req.query;
    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'merchantId обязателен' });
    }
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
    next(err);
  }
};
