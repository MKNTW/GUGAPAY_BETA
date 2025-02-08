// middleware/notFound.js
function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    error: 'Not Found'
  });
}

module.exports = notFound;
