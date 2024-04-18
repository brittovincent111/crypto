const Binance = require('node-binance-api');
const net = require('net');
const binance = new Binance().options({
  APIKEY: 'o4wwkfYJ9YMYkvYpGYwfuqoCvKjXgY9xXph7eR0AzQk4UWMgm4ZHSPZ2BsSPU9jC',
  APISECRET: 'R8Anzpgr0YdiURDiqdSECkTpgbAerMrhCIyVC1exn4Jx18qImQIK0PsoTiyTm8pc'
});

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
    console.log('Insufficient data to calculate RSI');
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
    const btcOrderBook = orderBook['BTCUSDT'];

    let bids = [];
    if (Array.isArray(btcOrderBook.bids)) {
      bids = btcOrderBook.bids.map(bid => ({
        price: parseFloat(bid.price),
        quantity: parseFloat(bid.quantity)
      }));
    } else if (typeof btcOrderBook.bid === 'string') {
      bids = [{
        price: parseFloat(btcOrderBook.bid),
        quantity: parseFloat(btcOrderBook.bids)
      }];
    }

    let asks = [];
    if (Array.isArray(btcOrderBook.asks)) {
      asks = btcOrderBook.asks.map(ask => ({
        price: parseFloat(ask.price),
        quantity: parseFloat(ask.quantity)
      }));
    } else if (typeof btcOrderBook.ask === 'string') {
      asks = [{
        price: parseFloat(btcOrderBook.ask),
        quantity: parseFloat(btcOrderBook.asks)
      }];
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

    const maxOrderArea = Object.entries(priceAreas).reduce((max, entry) => entry[1] > max[1] ? entry : max, [null, 0]);
    const maxOrderPrice = maxOrderArea[0] ? parseFloat(maxOrderArea[0]) : null;

    return { maxOrderPrice, priceAreas };
  } catch (error) {
    console.error('Error in getOrderBookData:', error);
    throw error; // Propagate the error to the calling function
  }
};






const getBitcoinData = async () => {
  try {
    const candlesticks = await binance.candlesticks('BTCUSDT', '5m', undefined, { limit: 200 });
    const prices = candlesticks.map(candlestick => ({
      time: candlestick[0],
      open: parseFloat(candlestick[1]),
      high: parseFloat(candlestick[2]),
      low: parseFloat(candlestick[3]),
      close: parseFloat(candlestick[4]),
      volume: parseFloat(candlestick[5])
    }));

    const ema10 = calculateEMA(prices, 10);
    const ema50 = calculateEMA(prices, 50);
    const ema200 = calculateEMA(prices, 200);
    const rsi = calculateRSI(prices, 14);
    const bullishDivergence = checkBullishDivergence(prices, rsi);
    const currentPrice = prices[prices.length - 1].close;
    const above200EMA = currentPrice > ema200[ema200.length - 1];

    const { maxOrderPrice, priceAreas } = await getOrderBookData();

    console.log('Calculated RSI:', rsi); // Add this line for debugging

    return {
      currentPrice,
      ema10: ema10[ema10.length - 1],
      ema50: ema50[ema50.length - 1],
      ema200: ema200[ema200.length - 1],
      rsi, // Correctly assign the RSI value
      bullishDivergence,
      above200EMA,
      maxOrderPrice,
      priceAreas,
      timestamp: new Date().getTime(),
    };
  } catch (error) {
    console.error('Error in getBitcoin:', error);
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
getBitcoinData()
  .then(data => {
    console.log('Bitcoin data:', data);
  })
  .catch(error => {
    console.error('Unhandled promise rejection:', error);
  });

  module.exports = {getBitcoinData};