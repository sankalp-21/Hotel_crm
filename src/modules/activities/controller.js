const activitiesService = require('./service');

async function create(req, res) {
  const activity = await activitiesService.createActivity(req.body, req.user);
  res.status(201).json(activity);
}

async function getOne(req, res) {
  const activity = await activitiesService.getActivity(req.params.id, req.propertyId);
  res.json(activity);
}

async function search(req, res) {
  const result = await activitiesService.searchActivities({
    propertyId: req.propertyId,
    ...req.query,
  });
  res.json(result);
}

async function update(req, res) {
  const activity = await activitiesService.updateActivity(
    req.params.id,
    req.propertyId,
    req.body,
    req.user
  );
  res.json(activity);
}

async function complete(req, res) {
  const activity = await activitiesService.completeActivity(req.params.id, req.propertyId, req.user);
  res.json(activity);
}

async function timeline(req, res) {
  const result = await activitiesService.getContactTimeline(req.params.id, req.propertyId, req.query);
  res.json(result);
}

module.exports = { create, getOne, search, update, complete, timeline };
