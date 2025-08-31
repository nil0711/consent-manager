import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createApp } from "./app.js";
import apiSearch from "./routes/api_search.js";
import apiTrending from "./routes/api_trending.js"; // 👈 NEW

const innerApp = createApp();
const root = express();

root.use(express.static("public"));

// APIs (mount before app for clean 404s)
root.use("/api/studies", apiSearch);
root.use("/api/studies", apiTrending);   // 👈 NEW

root.use(innerApp);

const port = process.env.PORT || 3000;
root.listen(port, () => console.log(`http://localhost:${port}`));
