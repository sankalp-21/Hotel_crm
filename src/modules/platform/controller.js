const platformService = require('./service');

async function listUsers(req, res) {
  res.json(await platformService.listUsers(req.query));
}

async function setUserStatus(req, res) {
  res.json(await platformService.setUserStatus(req.params.id, req.body, req.user));
}

module.exports = { listUsers, setUserStatus };
