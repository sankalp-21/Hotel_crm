const contactsService = require('./service');

async function create(req, res) {
  const contact = await contactsService.createContact(req.body, req.user);
  res.status(201).json(contact);
}

async function getOne(req, res) {
  const contact = await contactsService.getContact(req.params.id, req.propertyId);
  res.json(contact);
}

async function search(req, res) {
  const result = await contactsService.searchContacts({ propertyId: req.propertyId, ...req.query });
  res.json(result);
}

async function update(req, res) {
  const contact = await contactsService.updateContact(req.params.id, req.propertyId, req.body, req.user);
  res.json(contact);
}

module.exports = { create, getOne, search, update };
