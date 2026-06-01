const { EventEmitter } = require("events");

const notificationsHub = new EventEmitter();
notificationsHub.setMaxListeners(0);

const channelForUser = (userId) => `notifications:user:${Number(userId)}`;

const publishNotificationEvent = (userId, payload = {}) => {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return;
  notificationsHub.emit(channelForUser(id), {
    type: "notifications_updated",
    at: new Date().toISOString(),
    ...payload,
  });
};

const subscribeNotificationEvents = (userId, listener) => {
  const channel = channelForUser(userId);
  notificationsHub.on(channel, listener);
  return () => notificationsHub.off(channel, listener);
};

module.exports = {
  publishNotificationEvent,
  subscribeNotificationEvents,
};

