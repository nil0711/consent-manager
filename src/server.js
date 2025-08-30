import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app.js";

const app = createApp();
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));
