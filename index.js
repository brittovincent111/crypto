require("dotenv").config();
const express = require("express");
const { getBitcoinDataReq } = require("./bitcoin");
const app = express();
const PORT = process.env.PORT || 3000;
const bodyParser = require("body-parser");

async function startServer() {
    setInterval(getBitcoinDataReq, 1000);
    app.get("/", (req, res) => {
        res.send("hello world!");
    });

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

startServer().catch((err) => {
    console.error("Error starting the server:", err);
});
