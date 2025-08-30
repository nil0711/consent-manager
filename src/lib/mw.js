export function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (role && req.session.user.role !== role) return res.status(403).send("Forbidden");
    next();
  };
}

export function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

export const dash = (role) => (role === "researcher" ? "/researcher" : "/participant");
