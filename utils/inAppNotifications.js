const { PrismaClient } = require("@prisma/client");
const { publishNotificationEvent } = require("./notificationsHub");

const prisma = new PrismaClient();

const cleanText = (value) => String(value || "").trim();

const createNotificationForUser = async ({
  utilisateurId,
  demandeId,
  message,
}) => {
  const userId = Number(utilisateurId);
  const demande_id = Number(demandeId);
  const msg = cleanText(message);

  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(demande_id) || demande_id <= 0) return null;
  if (!msg) return null;

  const notification = await prisma.notifications.create({
    data: {
      utilisateur_id: userId,
      demande_id,
      message: msg,
    },
  });

  publishNotificationEvent(userId, {
    action: "created",
    notificationId: notification.id,
    demandeId: demande_id,
  });

  return notification;
};

const createNotificationsForUsers = async ({
  utilisateurIds = [],
  demandeId,
  message,
}) => {
  const ids = Array.from(
    new Set(
      (utilisateurIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  if (!ids.length) return [];

  const created = await Promise.allSettled(
    ids.map((utilisateurId) =>
      createNotificationForUser({ utilisateurId, demandeId, message })
    )
  );

  return created
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
};

const notifyUsersDataRefreshed = (utilisateurIds = [], payload = {}) => {
  const ids = Array.from(
    new Set(
      (utilisateurIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  for (const userId of ids) {
    publishNotificationEvent(userId, {
      action: "refresh",
      ...payload,
    });
  }
};

module.exports = {
  createNotificationForUser,
  createNotificationsForUsers,
  notifyUsersDataRefreshed,
};

