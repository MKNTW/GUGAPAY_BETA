// controllers/cloudtipsController.js
const supabase = require('../db/supabaseClient');

exports.completeCloudtips = async (req, res, next) => {
  try {
    const { invoiceid, amount } = req.body;
    if (!invoiceid || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Неверные параметры' });
    }
    // Ожидаемый формат invoiceid: "userId_timestamp"
    const parts = invoiceid.split('_');
    if (parts.length < 2) {
      return res.status(400).json({ success: false, error: 'Неверный формат invoiceid' });
    }
    const userId = parts[0];

    // Находим пользователя
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (userError || !user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const currentRubBalance = parseFloat(user.rub_balance || 0);
    const newRubBalance = (currentRubBalance + amount).toFixed(2);

    // Обновляем рублевый баланс
    const { error: updateError } = await supabase
      .from('users')
      .update({ rub_balance: newRubBalance })
      .eq('user_id', userId);
    if (updateError) {
      return res.status(500).json({ success: false, error: 'Не удалось обновить баланс' });
    }

    // Записываем транзакцию в cloudtips_transactions
    const { error: insertError } = await supabase
      .from('cloudtips_transactions')
      .insert([{ order_id: invoiceid, user_id: userId, rub_amount: amount }]);
    if (insertError) {
      console.error('Ошибка записи cloudtips_transactions:', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции пополнения' });
    }

    console.log(`[CloudTips] Пользователь ${userId} пополнен на ${amount} ₽. Новый баланс: ${newRubBalance}`);
    res.json({ success: true, newRubBalance });
  } catch (err) {
    next(err);
  }
};
