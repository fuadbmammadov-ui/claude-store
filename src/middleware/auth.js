function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'İcazə yoxdur',
        message: 'Bu bölməyə giriş icazəniz yoxdur.',
      });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
