// Middleware para checar permissões (roles) do usuário
// Uso: role('ADMIN'), role('MANAGER'), etc

module.exports = function role(...roles) {
  return (req, res, next) => {
    // Usuário deve estar autenticado (req.user vem do middleware auth)
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    // Verifica se o papel do usuário está entre os permitidos
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    next();
  };
}; 