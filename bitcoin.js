const Binance = require("node-binance-api");
const net = require("net");
const sendErrorResponse = require("./helpers/sendErrorResponseHelper");
const {
    sellRequestApiHelper,
    buyRequestApiHelper,
} = require("./helpers/cryptoApiHelper");
const binance = new Binance().options({
    APIKEY: "o4wwkfYJ9YMYkvYpGYwfuqoCvKjXgY9xXph7eR0AzQk4UWMgm4ZHSPZ2BsSPU9jC",
    APISECRET:
        "R8Anzpgr0YdiURDiqdSECkTpgbAerMrhCIyVC1exn4Jx18qImQIK0PsoTiyTm8pc",
});
const LEVERAGE = process.env.LEVERAGE || 10;
const TRADING_PAIR = process.env.TRADING_PAIR || "BNBUSDT"; // Default to BNBUSDT if TRADING_PAIR is not set in .env
const QUANTITY = process.env.QUANTITY || ".0001";
const calculateEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data[0].close;
    const emaSeries = [ema];

    for (let i = 1; i < data.length; i++) {
        ema = data[i].close * k + ema * (1 - k);
        emaSeries.push(ema);
    }

    return emaSeries;
};

const calculateRSI = (data, period) => {
    if (data.length < period + 1) {
        console.log("Insufficient data to calculate RSI");
        return undefined; // Insufficient data to calculate RSI
    }

    const gains = [];
    const losses = [];
    let avgGain = 0;
    let avgLoss = 0;
    let rs = 0;
    let rsi = 0;

    // Calculation for the initial period
    for (let i = 0; i < period; i++) {
        const diff = data[i + 1].close - data[i].close;
        if (diff >= 0) {
            gains.push(diff);
            losses.push(0);
        } else {
            gains.push(0);
            losses.push(Math.abs(diff));
        }
    }

    avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);

    // Calculation for the remaining data
    for (let i = period; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rs = avgGain / avgLoss;
        rsi = 100 - 100 / (1 + rs);

        gains.push(gain);
        losses.push(loss);
    }

    return rsi;
};

const checkBullishDivergence = (prices, rsi) => {
    let divergence = false;
    let lowPrice = Infinity;
    let lowRSI = Infinity;

    for (let i = 0; i < prices.length; i++) {
        if (prices[i].low < lowPrice) {
            lowPrice = prices[i].low;
        }
        if (rsi[i] < lowRSI) {
            lowRSI = rsi[i];
        }
    }

    for (let i = prices.length - 1; i >= 0; i--) {
        if (prices[i].low === lowPrice && rsi[i] > lowRSI) {
            divergence = true;
            break;
        }
    }

    return divergence;
};

const getOrderBookData = async () => {
    try {
        const orderBook = await binance.bookTickers();
        const btcOrderBook = orderBook[TRADING_PAIR];

        let bids = [];
        if (Array.isArray(btcOrderBook.bids)) {
            bids = btcOrderBook.bids.map((bid) => ({
                price: parseFloat(bid.price),
                quantity: parseFloat(bid.quantity),
            }));
        } else if (typeof btcOrderBook.bid === "string") {
            bids = [
                {
                    price: parseFloat(btcOrderBook.bid),
                    quantity: parseFloat(btcOrderBook.bids),
                },
            ];
        }

        let asks = [];
        if (Array.isArray(btcOrderBook.asks)) {
            asks = btcOrderBook.asks.map((ask) => ({
                price: parseFloat(ask.price),
                quantity: parseFloat(ask.quantity),
            }));
        } else if (typeof btcOrderBook.ask === "string") {
            asks = [
                {
                    price: parseFloat(btcOrderBook.ask),
                    quantity: parseFloat(btcOrderBook.asks),
                },
            ];
        }

        // Rest of the code remains unchanged
        const combinedOrders = [...bids, ...asks];
        const priceAreas = combinedOrders.reduce((acc, order) => {
            const key = order.price.toFixed(2);
            if (!acc[key]) {
                acc[key] = 0;
            }
            acc[key] += order.quantity;
            return acc;
        }, {});

        const maxOrderArea = Object.entries(priceAreas).reduce(
            (max, entry) => (entry[1] > max[1] ? entry : max),
            [null, 0]
        );
        const maxOrderPrice = maxOrderArea[0]
            ? parseFloat(maxOrderArea[0])
            : null;

        return { maxOrderPrice, priceAreas };
    } catch (error) {
        console.error("Error in getOrderBookData:", error);
        throw error; // Propagate the error to the calling function
    }
};

const getBitcoinData = async () => {
    try {
        const candlesticks = await binance.candlesticks(
            TRADING_PAIR,
            "1m",
            undefined,
            { limit: 200 }
        );
        const prices = candlesticks.map((candlestick) => ({
            time: candlestick[0],
            open: parseFloat(candlestick[1]),
            high: parseFloat(candlestick[2]),
            low: parseFloat(candlestick[3]),
            close: parseFloat(candlestick[4]),
            volume: parseFloat(candlestick[5]),
        }));

        const ema10 = calculateEMA(prices, 10);
        const ema50 = calculateEMA(prices, 50);
        const ema100 = calculateEMA(prices, 100);
        const ema200 = calculateEMA(prices, 200);
        const rsi = calculateRSI(prices, 14);
        const bullishDivergence = checkBullishDivergence(prices, rsi);
        const currentPrice = prices[prices.length - 1].close;
        const above200EMA = currentPrice > ema200[ema200.length - 1];

        const { maxOrderPrice, priceAreas } = await getOrderBookData();

        console.log("Calculated RSI:", rsi); // Add this line for debugging

        return {
            currentPrice,
            ema10: ema10[ema10.length - 1],
            ema50: ema50[ema50.length - 1],
            ema100: ema100[ema100.length - 1],
            ema200: ema200[ema200.length - 1],
            rsi, // Correctly assign the RSI value
            bullishDivergence,
            above200EMA,
            maxOrderPrice,
            priceAreas,
            timestamp: new Date().getTime(),
        };
    } catch (error) {
        console.error("Error in getBitcoinData:", error);
        throw error; // Propagate the error to the calling function
    }
};

// getBitcoinData().then(data => {
//   console.log('Current Bitcoin Price:', data.currentPrice);
//   console.log('10 EMA:', data.ema10);
//   console.log('50 EMA:', data.ema50);
//   console.log('200 EMA:', data.ema200);
//   console.log('Current RSI:', data.rsi);
//   console.log('Bullish Divergence:', data.bullishDivergence);
//   console.log('Price above 200 EMA:', data.above200EMA);
//   console.log('Price area with most orders:', data.maxOrderPrice);
//   console.log('Price areas and order quantities:', data.priceAreas);
// });

let isBuy = false;
let isSell = false;
let price = 0;
let ema200 = false;
let ema100 = false;
let ema50 = false;
let ema10 = false;

const checkPoints = {
    ema200: {
        isSell: false,
        isBuy: false,
        price: 0,
    },
    ema100: {
        isSell: false,
        isBuy: false,
        price: 0,
    },
    ema50: {
        isSell: false,
        isBuy: false,
        price: 0,
    },
    ema10: {
        isSell: false,
        isBuy: false,
        price: 0,
    },
};

const placeSellOrder = async ({
    currentPrice,
    price,
    orderType,
    ema,
    divergence,
}) => {
    const usd = 0.01;

    try {
        await binance.futuresLeverage(TRADING_PAIR, LEVERAGE);
        const orderResult = await binance.futuresMarketSell(
            TRADING_PAIR,
            QUANTITY
        );
        // let orderResult;

        console.log(orderResult, "sell");

        if (!orderResult) {
            return;
        }

        let response = await sellRequestApiHelper({
            isBuy,
            currentPrice,
            price,
            ema,
            divergence,
            leverage: LEVERAGE,
            quantity: QUANTITY,
        });

        if (orderType === "sell") {
            checkPoints[ema].isSell = true;
            checkPoints[ema].isBuy = false;
        } else {
            checkPoints[ema].isSell = false;
            checkPoints[ema].isBuy = false;
        }
        return orderResult;
    } catch (error) {
        console.error("Error placing sell order:", error);
    }
};

const placeBuyOrder = async ({
    currentPrice,
    price,
    orderType,
    ema,
    divergence,
}) => {
    const usd = 0.01;

    try {
        await binance.futuresLeverage(TRADING_PAIR, LEVERAGE);
        const orderResult = await binance.futuresMarketBuy(
            TRADING_PAIR,
            QUANTITY
        );
        console.log(ema, "ema");
        console.log(orderResult, ema, "buy");

        if (!orderResult) {
            return;
        }

        let response = await buyRequestApiHelper({
            isSell,
            currentPrice,
            price,
            ema,
            divergence,
            leverage: LEVERAGE,
            quantity: QUANTITY,
        });

        if (orderType === "buy") {
            checkPoints[ema].isBuy = true;
            checkPoints[ema].isSell = false;
        } else {
            checkPoints[ema].isSell = false;
            checkPoints[ema].isBuy = false;
        }

        return orderResult;
    } catch (error) {
        console.error("Error placing buy order:", error);
    }
};

const checkProfit = ({ price = 0, currentPrice = 0, isBuy }) => {
    const profitPercentage = isBuy
        ? ((currentPrice - price) / price) * 100 // Buy scenario
        : ((price - currentPrice) / price) * 100; // Sell scenario
    console.log(profitPercentage, "profitPercentage");
    return profitPercentage >= 0.25;
};

const sellAndBuyChecking = async ({ currentPrice, bullishDivergence }) => {
    for (key in checkPoints) {
        if (checkPoints[key].isBuy || checkPoints[key].isSell) {
            let check = await checkProfit({
                price: checkPoints[key].price,
                currentPrice: currentPrice,
                isBuy: checkPoints[key].isBuy,
            });

            console.log(check, checkPoints[key].isBuy, checkPoints[key].isSell);

            if (checkPoints[key].isBuy && check) {
                await placeSellOrder({
                    price: checkPoints[key].price,
                    currentPrice: currentPrice,
                    orderType: "buy",
                    divergence: bullishDivergence,
                    ema: key,
                });
            } else if (checkPoints[key].isSell && check) {
                await placeBuyOrder({
                    price: checkPoints[key].price,
                    currentPrice: currentPrice,
                    orderType: "sell",
                    divergence: bullishDivergence,
                    ema: key,
                });
            }
        }
    }
};

const getBitcoinDataReq = async (req, res) => {
    try {
        let data = await getBitcoinData();
        let balances = await binance.futuresBalance();
        const usdtBalanceObj = balances.find(
            (balance) => balance.asset === "USDT"
        );

        if (data.currentPrice > data?.ema200) {
            ema200 = true;
        } else {
            ema200 = false;
        }

        if (data.currentPrice > data?.ema100) {
            ema100 = true;
        } else {
            ema100 = false;
        }

        if (data.currentPrice > data.ema50) {
            ema50 = true;
        } else {
            ema50 = false;
        }

        if (data.currentPrice > data.ema10) {
            ema10 = true;
        } else {
            ema10 = false;
        }

        sellAndBuyChecking({
            currentPrice: data.currentPrice,
            bullishDivergence: data.bullishDivergence,
        });
        // if (isBuy || isSell) {
        //     let check = await checkProfit({
        //         price: price,
        //         currentPrice: data.currentPrice,
        //         isBuy,
        //     });

        //     console.log(check, isBuy, isSell);

        //     if (isBuy && check) {
        //         await placeSellOrder({
        //             price: price,
        //             currentPrice: data.currentPrice,
        //             orderType: "buy",
        //             divergence: data.bullishDivergence,
        //         });
        //     } else if (isSell && check) {
        //         await placeBuyOrder({
        //             price: price,
        //             currentPrice: data.currentPrice,
        //             orderType: "sell",
        //             divergence: data.bullishDivergence,
        //         });
        //     }
        //     // }
        // }
        if (
            ema200 === true &&
            ema100 === false &&
            ema50 === false &&
            ema10 === false &&
            checkPoints["ema200"].isBuy === false &&
            checkPoints["ema200"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema200.toFixed(1)) {
                await placeBuyOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "buy",
                    divergence: data.bullishDivergence,
                    ema: "ema200",
                });
                checkPoints["ema200"].price = data.currentPrice;
            }
        } else if (
            ema200 === true &&
            ema100 === true &&
            ema50 === false &&
            ema10 === false &&
            checkPoints["ema100"].isBuy === false &&
            checkPoints["ema100"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema100.toFixed(1)) {
                await placeBuyOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "buy",
                    divergence: data.bullishDivergence,
                    ema: "ema100",
                });
                checkPoints["ema100"].price = data.currentPrice;
            }
        } else if (
            ema200 === true &&
            ema100 === true &&
            ema50 === true &&
            ema10 === false &&
            checkPoints["ema50"].isBuy === false &&
            checkPoints["ema50"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema50.toFixed(1)) {
                await placeBuyOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "buy",
                    divergence: data.bullishDivergence,
                    ema: "ema50",
                });
                checkPoints["ema50"].price = data.currentPrice;
            }
        } else if (
            ema200 === true &&
            ema100 === true &&
            ema50 === true &&
            ema10 === true &&
            checkPoints["ema10"].isBuy === false &&
            checkPoints["ema10"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema10.toFixed(1)) {
                await placeBuyOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "buy",
                    divergence: data.bullishDivergence,
                    ema: "ema10",
                });
                checkPoints["ema10"].price = data.currentPrice;
            }
        } else if (
            ema200 === false &&
            ema100 === false &&
            ema50 === false &&
            ema10 === false &&
            checkPoints["ema10"].isBuy === false &&
            checkPoints["ema10"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema10.toFixed(1)) {
                await placeSellOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "sell",
                    divergence: data.bullishDivergence,
                    ema: "ema10",
                });
                checkPoints["ema10"].price = data.currentPrice;
            }
        } else if (
            ema200 === false &&
            ema100 === false &&
            ema50 === false &&
            ema10 === true &&
            checkPoints["ema50"].isBuy === false &&
            checkPoints["ema50"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema50.toFixed(1)) {
                await placeSellOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "sell",
                    divergence: data.bullishDivergence,
                    ema: "ema50",
                });
                checkPoints["ema50"].price = data.currentPrice;
            }
        } else if (
            ema200 === false &&
            ema100 === false &&
            ema50 === true &&
            ema10 === true &&
            checkPoints["ema100"].isBuy === false &&
            checkPoints["ema100"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema100.toFixed(1)) {
                await placeSellOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "sell",
                    divergence: data.bullishDivergence,
                    ema: "ema100",
                });
                checkPoints["ema100"].price = data.currentPrice;
            }
        } else if (
            ema200 === false &&
            ema100 === true &&
            ema50 === true &&
            ema10 === true &&
            checkPoints["ema200"].isBuy === false &&
            checkPoints["ema200"].isSell === false
        ) {
            if (data.currentPrice.toFixed(1) === data.ema200.toFixed(1)) {
                await placeSellOrder({
                    price: data.currentPrice,
                    currentPrice: data.currentPrice,
                    orderType: "sell",
                    divergence: data.bullishDivergence,
                    ema: "ema200",
                });
                checkPoints["ema200"].price = data.currentPrice;
            }
        }
        // } else if (
        //     data.above200EMA === false &&
        //     data.bullishDivergence === true
        // ) {
        //     await placeBuyOrder({
        //         price: data.currentPrice,
        //         currentPrice: data.currentPrice,
        //         orderType: "buy",
        //         divergence: data.bullishDivergence,
        //         ema: "",
        //     });
        //     price = data.currentPrice;
        // } else {
        //     console.log("invalid rule");
        //     // return sendErrorResponse(res, 400, "invalid rule");
        // }
        //  else if (data.rsi < 30) {
        //     const availableBalance = parseFloat(balance);
        //     console.log(availableBalance, "available balance");

        //     currentPrice = data.currentPrice;

        //     const buyAmount = availableBalance * 0.1;

        //     await placeBuyOrder(buyAmount);
        // }

        // const date = data.timestamp;
    } catch (err) {
        console.log(err);
        // sendErrorResponse(res, 500, err);
    }
};

module.exports = { getBitcoinDataReq };
