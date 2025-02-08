// controllers/exchangeController.js
const supabase = require('../db/supabaseClient');

exports.exchange = async (req, res, next) => {
  try {
    const { userId, direction, amount } = req.body;
    if (!userId || !direction || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Неверные данные' });
    }

    const MAX_RUB_AMOUNT = 99999999.99;
    if (amount > MAX_RUB_AMOUNT) {
      return res.status(400).json({ success: false, error: 'Сумма обмена слишком большая' });
    }

    // Получаем данные пользователя
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (userError || !user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    // Получаем уровень halving
    let halvingStep = 0;
    const { data: halvingData } = await supabase
      .from('halving')
      .select('halving_step')
      .limit(1);
    if (halvingData && halvingData.length > 0) {
      halvingStep = halvingData[0].halving_step;
    }
    const rubMultiplier = 1 + halvingStep * 0.02;

    let newRubBalance, newCoinBalance;
    if (direction === 'rub_to_coin') {
      const userRubBalance = parseFloat(user.rub_balance || 0);
      if (userRubBalance < amount) {
        return res.status(400).json({ success: false, error: 'Недостаточно рублёвого баланса' });
      }
      const coinAmount = amount / rubMultiplier;
      newRubBalance = parseFloat((userRubBalance - amount).toFixed(2));
      newCoinBalance = parseFloat((parseFloat(user.balance) + coinAmount).toFixed(5));
    } else if (direction === 'coin_to_rub') {
      const userCoinBalance = parseFloat(user.balance || 0);
      if (userCoinBalance < amount) {
        return res.status(400).json({ success: false, error: 'Недостаточно монет' });
      }
      const rubAmount = amount * rubMultiplier;
      newCoinBalance = parseFloat((userCoinBalance - amount).toFixed(5));
      newRubBalance = parseFloat((parseFloat(user.rub_balance || 0) + rubAmount).toFixed(2));
    } else {
      return res.status(400).json({ success: false, error: 'Неверное направление обмена' });
    }

    const MAX_NUMERIC_RUB = 999999999.99999;
    const MAX_NUMERIC_COIN = 999999999.99999;
    if (newRubBalance > MAX_NUMERIC_RUB) {
      return res.status(400).json({ success: false, error: 'Новый рублевый баланс превышает максимально допустимое значение' });
    }
    if (newCoinBalance > MAX_NUMERIC_COIN) {
      return res.status(400).json({ success: false, error: 'Новый монетный баланс превышает максимально допустимое значение' });
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ rub_balance: newRubBalance, balance: newCoinBalance })
      .eq('user_id', userId);
    if (updateError) {
      return res.status(500).json({ success: false, error: 'Не удалось обновить баланс' });
    }

    const { error: insertError } = await supabase
      .from('exchange_transactions')
      .insert([{
        user_id: userId,
        direction,
        amount,
        new_rub_balance: newRubBalance,
        new_coin_balance: newCoinBalance
      }]);
    if (insertError) {
      console.error('Ошибка записи exchange_transactions:', insertError.message);
      return res.status(500).json({ success: false, error: 'Ошибка записи транзакции обмена: ' + insertError.message });
    }

    console.log(`[Exchange] Пользователь ${userId}: направление ${direction}, сумма ${amount}`);
    res.json({ success: true, newRubBalance, newCoinBalance });
  } catch (err) {
    next(err);
  }
};
