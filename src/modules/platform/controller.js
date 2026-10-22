const platformService = require('./service');

async function listUsers(req, res) {
  res.json(await platformService.listUsers(req.query));
}

async function setUserStatus(req, res) {
  res.json(await platformService.setUserStatus(req.params.id, req.body, req.user));
}

async function listOutbox(req, res) {
  res.json(await platformService.listOutbox(req.query));
}

async function retryOutboxEvent(req, res) {
  res.json(await platformService.retryOutboxEvent(req.params.id, req.user));
}

module.exports = { listUsers, setUserStatus, listOutbox, retryOutboxEvent };
