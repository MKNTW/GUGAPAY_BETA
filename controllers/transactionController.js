// controllers/transactionController.js
const supabase = require('../db/supabaseClient');

exports.getTransactions = async (req, res, next) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId обязателен' });
    }

    // Получаем стандартные транзакции
    const { data: standardTx, error: standardError } = await supabase
      .from('transactions')
      .select('*')
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (standardError) {
      console.error('Ошибка получения стандартных транзакций:', standardError);
      return res.status(500).json({ success: false, error: 'Ошибка получения транзакций' });
    }

    // Получаем операции обмена
    const { data: exchangeTx, error: exchangeError } = await supabase
      .from('exchange_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (exchangeError) {
      console.error('Ошибка получения операций обмена:', exchangeError);
      return res.status(500).json({ success: false, error: 'Ошибка получения операций обмена' });
    }

    // Объединяем и сортируем транзакции
    const allTransactions = [...(standardTx || []), ...(exchangeTx || [])];
    allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, transactions: allTransactions });
  } catch (err) {
    next(err);
  }
};
