const usersService = require('./service');

async function list(req, res) {
  res.json(await usersService.listMembers({ ...req.query, propertyId: req.propertyId }));
}

async function getOne(req, res) {
  res.json(await usersService.viewMember(req.params.id, req.propertyId));
}

async function addMember(req, res) {
  const member = await usersService.addMemberByEmail({ ...req.body, propertyId: req.propertyId }, req.user);
  res.status(201).json(member);
}

async function addRole(req, res) {
  const member = await usersService.addRole(req.params.id, req.propertyId, req.body.roleId, req.user);
  res.status(201).json(member);
}

async function removeRole(req, res) {
  const member = await usersService.removeRole(req.params.id, req.propertyId, req.params.roleId, req.user);
  // null: that was their last role, so they are no longer a member of this property.
  if (!member) return res.status(204).send();
  return res.json(member);
}

async function removeMember(req, res) {
  await usersService.removeMember(req.params.id, req.propertyId, req.user);
  res.status(204).send();
}

module.exports = { list, getOne, addMember, addRole, removeRole, removeMember };
