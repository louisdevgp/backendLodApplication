const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const {
  subscribeNotificationEvents,
  publishNotificationEvent,
} = require("../../utils/notificationsHub");

const prisma = new PrismaClient();

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const resolveUserIdFromRequest = (req) => {
  const auth = req.header("Authorization");
  const tokenFromHeader = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const token = tokenFromHeader || req.query?.token;
  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const id = Number(payload?.userId || payload?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return id;
  } catch {
    return null;
  }
};

const listMyNotifications = async (req, res) => {
  try {
    const utilisateurId = Number(req.user?.id);
    if (!Number.isFinite(utilisateurId) || utilisateurId <= 0) {
      return res.status(401).json({ message: "Utilisateur non authentifie." });
    }

    const page = parsePositiveInt(req.query?.page, 1);
    const limit = Math.min(parsePositiveInt(req.query?.limit, 20), 100);
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notifications.findMany({
        where: { utilisateur_id: utilisateurId },
        orderBy: { date_envoi: "desc" },
        skip,
        take: limit,
      }),
      prisma.notifications.count({ where: { utilisateur_id: utilisateurId } }),
      prisma.notifications.count({
        where: { utilisateur_id: utilisateurId, lu: false },
      }),
    ]);

    return res.status(200).json({
      notifications,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      unreadCount,
    });
  } catch (error) {
    console.error("Erreur listMyNotifications:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const utilisateurId = Number(req.user?.id);
    const notificationId = Number(req.params?.id);

    if (!Number.isFinite(utilisateurId) || utilisateurId <= 0) {
      return res.status(401).json({ message: "Utilisateur non authentifie." });
    }
    if (!Number.isFinite(notificationId) || notificationId <= 0) {
      return res.status(400).json({ message: "ID notification invalide." });
    }

    const updated = await prisma.notifications.updateMany({
      where: {
        id: notificationId,
        utilisateur_id: utilisateurId,
      },
      data: { lu: true },
    });

    if (!updated.count) {
      return res.status(404).json({ message: "Notification introuvable." });
    }

    publishNotificationEvent(utilisateurId, {
      action: "read_one",
      notificationId,
    });

    return res.status(200).json({ message: "Notification marquee comme lue." });
  } catch (error) {
    console.error("Erreur markNotificationAsRead:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const markAllNotificationsAsRead = async (req, res) => {
  try {
    const utilisateurId = Number(req.user?.id);
    if (!Number.isFinite(utilisateurId) || utilisateurId <= 0) {
      return res.status(401).json({ message: "Utilisateur non authentifie." });
    }

    const updated = await prisma.notifications.updateMany({
      where: {
        utilisateur_id: utilisateurId,
        lu: false,
      },
      data: { lu: true },
    });

    publishNotificationEvent(utilisateurId, {
      action: "read_all",
      updated: updated.count,
    });

    return res.status(200).json({
      message: "Toutes les notifications ont ete marquees comme lues.",
      updated: updated.count,
    });
  } catch (error) {
    console.error("Erreur markAllNotificationsAsRead:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const streamMyNotifications = (req, res) => {
  const userId = resolveUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ message: "Token invalide ou manquant." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({
    type: "connected",
    at: new Date().toISOString(),
  });

  const unsubscribe = subscribeNotificationEvents(userId, (payload) => {
    send(payload);
  });

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: {}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
};

module.exports = {
  listMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  streamMyNotifications,
};

