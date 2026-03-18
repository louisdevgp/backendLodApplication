// utils/cloudinary.js
const cloudinary = require("../config/cloudinaryConfig"); // ← importe TON client configuré

// Upload un Buffer vers Cloudinary (resource_type:auto) via upload_stream
function uploadBuffer(buffer, filename = "proforma", folder = process.env.CLOUDINARY_FOLDER || "proformas") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename ? filename.replace(/[^\w.\-]/g, "_").replace(/\.[^.]+$/, "") : undefined,
        resource_type: "auto", // accepte images + pdf
        overwrite: false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url || result.url);
      }
    );
    stream.end(buffer);
  });
}

// Essaie d’extraire le public_id depuis une URL Cloudinary
function getPublicIdFromUrl(url) {
  try {
    // ex: https://res.cloudinary.com/<cloud>/image/upload/v1712345/proformas/abc123.pdf
    const u = new URL(url);
    const parts = u.pathname.split("/");
    // supprime les segments 'image'|'raw'|'video' et 'upload' et éventuellement la version v123
    const uploadIdx = parts.findIndex((p) => p === "upload");
    if (uploadIdx === -1) return null;
    const after = parts.slice(uploadIdx + 1); // [ 'v1712345', 'proformas', 'abc123.pdf' ]
    const withoutVersion = after[0]?.startsWith("v") ? after.slice(1) : after;
    const last = withoutVersion.pop() || "";
    const withoutExt = last.replace(/\.[^.]+$/, "");
    const publicId = [...withoutVersion, withoutExt].join("/");
    return publicId || null;
  } catch {
    return null;
  }
}

// Supprime une ressource Cloudinary à partir de l’URL (essaie image puis raw)
async function deleteByUrl(url) {
  const publicId = getPublicIdFromUrl(url);
  if (!publicId) return { ok: false, reason: "public_id introuvable" };

  try {
    // tente en image
    const r1 = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    if (r1.result === "ok" || r1.result === "not_found") return { ok: true, result: r1 };
    // sinon tente en raw (PDF)
    const r2 = await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
    return { ok: true, result: r2 };
  } catch (e) {
    return { ok: false, error: e };
  }
}

module.exports = { uploadBuffer, deleteByUrl, getPublicIdFromUrl };
