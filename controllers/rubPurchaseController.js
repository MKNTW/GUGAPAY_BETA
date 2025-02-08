// controllers/rubPurchaseController.js
const supabase = require('../db/supabaseClient');

exports.rubPurchase = async (req, res, next) => {
  try {
    const { userId, operation_type, amount } = req.body;
    if (!userId || !operation_type || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Неверные параметры' });
    }
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (userError || !user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    let currentRubBalance = parseFloat(user.rub_balance || 0);
    let newRubBalance;
    if (operation_type === 'purchase') {
      if (currentRubBalance < amount) {
        return res.status(400).json({ success: false, error: 'Недостаточно рублёвого баланса' });
      }
      newRubBalance = (currentRubBalance - amount).toFixed(2);
    } else if (operation_type === 'sale') {
      newRubBalance = (currentRubBalance + amount).toFixed(2);
    } else {
      return res.status(400).json({ success: false, error: 'Неверный тип операции' });
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ rub_balance: newRubBalance })
      .eq('user_id', userId);
    if (updateError) {
      return res.status(500).json({ success: false, error: 'Не удалось обновить баланс' });
    }

    const { error: insertError } = await supabase
      .from('rub_purchases')
      .insert([{ user_id: userId, operation_type, amount }]);
    if (insertError) {
      console.error('Ошибка записи rub_purchases:', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции рублевых операций' });
    }

    console.log(`[Rub Purchase] Пользователь ${userId}: операция ${operation_type}, сумма ${amount}. Новый рублевый баланс: ${newRubBalance}`);
    res.json({ success: true, newRubBalance });
  } catch (err) {
    next(err);
  }
};
