// controllers/transferController.js
const supabase = require('../db/supabaseClient');

exports.transfer = async (req, res, next) => {
  try {
    const { fromUserId, toUserId, amount } = req.body;
    if (!fromUserId || !toUserId) {
      return res.status(400).json({ success: false, error: 'Не указан fromUserId/toUserId' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Неверная сумма' });
    }
    if (fromUserId === toUserId) {
      return res.status(400).json({ success: false, error: 'Нельзя переводить самому себе' });
    }
    // Проверяем отправителя
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
    // Проверяем получателя
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

    // Обновляем балансы
    await supabase
      .from('users')
      .update({ balance: newFromBalance.toFixed(5) })
      .eq('user_id', fromUserId);
    await supabase
      .from('users')
      .update({ balance: newToBalance.toFixed(5) })
      .eq('user_id', toUserId);

    // Запись операции в таблицу transactions
    const { error: insertError } = await supabase
      .from('transactions')
      .insert([
        { 
          from_user_id: fromUserId, 
          to_user_id: toUserId, 
          amount, 
          type: 'sent'
        }
      ]);
    if (insertError) {
      console.error('Ошибка вставки транзакции:', insertError);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции' });
    }
    console.log(`[transfer] from=${fromUserId} to=${toUserId} amount=${amount}`);
    res.json({ success: true, fromBalance: newFromBalance, toBalance: newToBalance });
  } catch (err) {
    next(err);
  }
};
