const axios = require("axios");

const buyRequestApiHelper = async ({
    isSell,
    currentPrice,
    price,
    ema,
    divergence,
    leverage,
    quantity,
}) => {
    try {
        let response = await axios.post(`${process.env.DATABASE_SERVER}/buy`, {
            isSell,
            currentPrice,
            price,
            ema,
            divergence,
            leverage,
            quantity,
        });

        return response.data;
    } catch (e) {
        return e;
    }
};

const sellRequestApiHelper = async ({
    isBuy,
    currentPrice,
    price,
    ema,
    divergence,
    leverage,
    quantity,
}) => {
    try {
        let response = await axios.post(`${process.env.DATABASE_SERVER}/sell`, {
            isBuy: isBuy,
            currentPrice: currentPrice,
            price: price,
            ema,
            divergence,
            leverage,
            quantity,
        });

        return response.data;
    } catch (e) {
        return e;
    }
};

module.exports = { sellRequestApiHelper, buyRequestApiHelper };
