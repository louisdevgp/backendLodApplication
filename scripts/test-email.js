// scripts/test-mail.js
require("dotenv").config();
const { envoyerEmail } = require("../config/emailConfig");

(async () => {
  try {
    const to = process.env.TEST_TO || process.env.NODEMAILER_USER;
    const res = await envoyerEmail(
      to,
      "Test Office365 ✔",
      "<p>Si vous lisez ceci, SMTP O365 est OK.</p>"
    );
    console.log("OK:", res);
  } catch (e) {
    console.error("ÉCHEC:", e);
  }
})();
