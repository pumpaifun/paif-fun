import express from "express";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { securityHeaders } from "./security-headers.mjs";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("A valid PORT is required");
const publicDir = fileURLToPath(new URL("./dist/public/", import.meta.url));
if (!existsSync(`${publicDir}/index.html`)) throw new Error("Build the website before starting its production server");

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
  next();
});
app.use(express.static(publicDir));
app.use("/{*path}", (_req, res) => res.sendFile(`${publicDir}/index.html`));
app.listen(port, "0.0.0.0");
