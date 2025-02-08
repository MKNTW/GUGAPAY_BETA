// controllers/halvingController.js
const supabase = require('../db/supabaseClient');

exports.getHalvingInfo = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('halving')
      .select('*')
      .limit(1);
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    if (data && data.length > 0) {
      res.json({ success: true, halvingStep: data[0].halving_step || 0 });
    } else {
      res.json({ success: true, halvingStep: 0 });
    }
  } catch (err) {
    next(err);
  }
};
