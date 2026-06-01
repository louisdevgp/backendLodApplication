const express = require("express");
const { verifyToken } = require("../../middlewares/authMiddleware");
const {
  listMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  streamMyNotifications,
} = require("../../controllers/Notifications/notificationsController");

const router = express.Router();

router.get("/stream", streamMyNotifications);

router.use(verifyToken);
router.get("/", listMyNotifications);
router.patch("/read-all", markAllNotificationsAsRead);
router.patch("/:id/read", markNotificationAsRead);

module.exports = router;

