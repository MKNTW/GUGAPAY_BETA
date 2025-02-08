// db/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('[Supabase] Ошибка: отсутствует SUPABASE_URL или SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = supabase;
