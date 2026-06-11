const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

const cleanPart = (value = "documents") =>
  String(value || "documents")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "documents";

const normalizeFolder = (folder = "documents") =>
  String(folder || "documents")
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(cleanPart)
    .join(path.sep) || "documents";

const sanitizeFileName = (filename = "fichier") => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const safeBase = cleanPart(base || "fichier");
  const safeExt = ext.replace(/[^\w.]/g, "").slice(0, 20);
  return `${safeBase}${safeExt}`;
};

const ensureUploadDir = (folder = "documents") => {
  const safeFolder = normalizeFolder(folder);
  const dir = path.join(UPLOAD_ROOT, safeFolder);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, safeFolder };
};

const getPublicBaseUrl = (req) =>
  String(process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL || "").trim() ||
  `${req.protocol}://${req.get("host")}`;

const buildPublicUrl = (req, relativePath) => {
  const publicPath = relativePath.split(path.sep).map(encodeURIComponent).join("/");
  return `${getPublicBaseUrl(req)}/uploads/${publicPath}`;
};

const resolveLocalFileFromUrlish = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, reason: "Source vide." };

  let pathname = raw.replace(/\\/g, "/");

  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      return { ok: false, reason: "URL invalide." };
    }
  }

  const normalized = pathname.startsWith("/")
    ? pathname
    : `/${pathname.replace(/^\/+/, "")}`;
  const marker = "/uploads/";
  const index = normalized.toLowerCase().indexOf(marker);
  if (index === -1) {
    return { ok: false, reason: "Chemin hors uploads locaux." };
  }

  const relativeUrlPath = normalized.slice(index + marker.length);
  const parts = relativeUrlPath
    .split("/")
    .map((part) => decodeURIComponent(part))
    .filter(Boolean);

  if (!parts.length) {
    return { ok: false, reason: "Fichier introuvable." };
  }

  const root = path.resolve(UPLOAD_ROOT);
  const absolutePath = path.resolve(UPLOAD_ROOT, ...parts);
  if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
    return { ok: false, reason: "Chemin invalide." };
  }

  return {
    ok: true,
    absolutePath,
    parts,
    filename: parts[parts.length - 1],
  };
};

const saveBufferToLocalFile = async (req, buffer, originalname = "fichier", folder = "documents") => {
  if (!buffer) throw new Error("Fichier vide ou invalide.");

  const { dir, safeFolder } = ensureUploadDir(folder);
  const safeName = sanitizeFileName(originalname);
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
  const absolutePath = path.join(dir, filename);
  await fs.promises.writeFile(absolutePath, buffer);

  const relativePath = path.join(safeFolder, filename);
  return {
    url: buildPublicUrl(req, relativePath),
    filename,
    path: absolutePath,
    relativePath,
  };
};

const deleteLocalFileByUrl = async (url) => {
  try {
    const parsed = new URL(url);
    const marker = "/uploads/";
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return { ok: false, reason: "URL hors uploads locaux" };

    const relativeUrlPath = parsed.pathname.slice(index + marker.length);
    const parts = relativeUrlPath.split("/").map((p) => decodeURIComponent(p)).filter(Boolean);
    const absolutePath = path.resolve(UPLOAD_ROOT, ...parts);
    const root = path.resolve(UPLOAD_ROOT);

    if (!absolutePath.startsWith(root + path.sep)) {
      return { ok: false, reason: "Chemin invalide" };
    }

    await fs.promises.unlink(absolutePath);
    return { ok: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, reason: "Fichier deja absent" };
    return { ok: false, error };
  }
};

module.exports = {
  UPLOAD_ROOT,
  ensureUploadDir,
  saveBufferToLocalFile,
  deleteLocalFileByUrl,
  resolveLocalFileFromUrlish,
  sanitizeFileName,
  normalizeFolder,
};
