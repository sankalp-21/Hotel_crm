const authService = require('./service');

async function login(req, res) {
  const result = await authService.login(req.body);
  res.json(result);
}

async function refresh(req, res) {
  const result = await authService.refresh(req.body);
  res.json(result);
}

async function logout(req, res) {
  await authService.logout(req.body);
  res.status(204).send();
}

async function createUser(req, res) {
  const user = await authService.createUser(req.body, req.user);
  res.status(201).json(user);
}

async function changePassword(req, res) {
  await authService.changePassword(req.user, req.body);
  res.status(204).send();
}

async function listRoles(req, res) {
  const items = await authService.listAssignableRoles(req.propertyId, req.user);
  res.json({ items });
}

async function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, refresh, logout, createUser, changePassword, listRoles, me };
