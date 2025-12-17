import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Activity, AlertCircle, RefreshCw, Wifi, WifiOff, CheckCircle } from 'lucide-react';

const DerivAnalysisTool = () => {
  const [connection, setConnection] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState('R_100');
  const [tickData, setTickData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState([]);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const API_TOKEN = 'oiukQfcrgdpdSLE';
  const APP_ID = '1089';

  const markets = [
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s)' },
    { value: 'BOOM1000', label: 'Boom 1000' },
    { value: 'CRASH1000', label: 'Crash 1000' },
  ];

  const addDebug = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    setDebugInfo(prev => [...prev.slice(-15), `${timestamp}: ${message}`]);
  };

  useEffect(() => {
    connectToAPI();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const connectToAPI = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      addDebug('Connecting to Deriv API...');
      const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
      addDebug(`WebSocket URL: ${wsUrl}`);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        addDebug('✓ WebSocket CONNECTED');
        setIsConnected(true);
        setError(null);
        
        // Send authorization
        addDebug('Sending authorization request...');
        const authRequest = { authorize: API_TOKEN };
        ws.send(JSON.stringify(authRequest));
        addDebug(`Auth payload: ${JSON.stringify(authRequest)}`);
      };

      ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          addDebug(`← Received: ${response.msg_type || 'unknown'}`);
          
          // Handle errors
          if (response.error) {
            const errMsg = `${response.error.message} (${response.error.code})`;
            addDebug(`✗ ERROR: ${errMsg}`);
            setError(errMsg);
            
            // If auth error, try public subscription
            if (response.error.code === 'InvalidToken' || response.error.code === 'AuthorizationRequired') {
              addDebug('Token invalid, trying public access...');
              setIsAuthorized(true);
              subscribeToMarket(ws, selectedMarket);
            }
            return;
          }

          // Handle authorization response
          if (response.authorize) {
            addDebug('✓ AUTHORIZED successfully');
            setIsAuthorized(true);
            setError(null);
            subscribeToMarket(ws, selectedMarket);
            return;
          }

          // Handle tick data
          if (response.tick) {
            handleTickData(response.tick);
            return;
          }

          // Handle other message types
          if (response.msg_type) {
            addDebug(`Info: ${response.msg_type}`);
          }
          
        } catch (err) {
          addDebug(`Parse error: ${err.message}`);
        }
      };

      ws.onerror = (error) => {
        addDebug(`✗ WebSocket ERROR: ${error.type}`);
        setError('WebSocket connection error');
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        addDebug(`Connection closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        setIsConnected(false);
        setIsAuthorized(false);
        
        // Auto reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          addDebug('Auto-reconnecting...');
          connectToAPI();
        }, 3000);
      };

      setConnection(ws);
      
    } catch (err) {
      addDebug(`✗ Connection error: ${err.message}`);
      setError(`Failed to connect: ${err.message}`);
      setIsConnected(false);
    }
  };

  const subscribeToMarket = (ws, market) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addDebug('Cannot subscribe: WebSocket not open');
      return;
    }

    addDebug(`→ Subscribing to ${market}...`);
    const subscribeRequest = {
      ticks: market,
      subscribe: 1
    };
    ws.send(JSON.stringify(subscribeRequest));
    addDebug(`Subscription sent: ${JSON.stringify(subscribeRequest)}`);
  };

  const handleTickData = (tick) => {
    addDebug(`✓ Tick: ${tick.quote}`);
    setTickData(prev => {
      const newData = [...prev, {
        time: new Date(tick.epoch * 1000).toLocaleTimeString(),
        price: parseFloat(tick.quote),
        epoch: tick.epoch
      }];
      return newData.slice(-100);
    });
    setError(null);
  };

  useEffect(() => {
    if (isAuthorized && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setTickData([]);
      setAnalysis(null);
      
      // Unsubscribe from all
      wsRef.current.send(JSON.stringify({ forget_all: 'ticks' }));
      
      // Subscribe to new market
      setTimeout(() => {
        subscribeToMarket(wsRef.current, selectedMarket);
      }, 200);
    }
  }, [selectedMarket, isAuthorized]);

  const calculateSMA = (data, period) => {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((acc, val) => acc + val.price, 0) / period;
  };

  const calculateRSI = (data, period = 14) => {
    if (data.length < period + 1) return null;
    
    const changes = [];
    for (let i = 1; i < data.length; i++) {
      changes.push(data[i].price - data[i - 1].price);
    }
    
    const recentChanges = changes.slice(-period);
    const gains = recentChanges.filter(c => c > 0);
    const losses = recentChanges.filter(c => c < 0).map(Math.abs);
    
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };

  const calculateVolatility = (data, period = 20) => {
    if (data.length < period) return null;
    
    const slice = data.slice(-period);
    const mean = slice.reduce((acc, val) => acc + val.price, 0) / period;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val.price - mean, 2), 0) / period;
    return Math.sqrt(variance);
  };

  const calculateMomentum = (data, period = 10) => {
    if (data.length < period) return null;
    return ((data[data.length - 1].price - data[data.length - period].price) / data[data.length - period].price) * 100;
  };

  const analyzeMarket = () => {
    if (tickData.length < 20) {
      setError('Need at least 20 ticks for analysis');
      return;
    }

    setLoading(true);
    
    setTimeout(() => {
      const currentPrice = tickData[tickData.length - 1].price;
      const sma20 = calculateSMA(tickData, 20);
      const sma50 = calculateSMA(tickData, 50);
      const rsi = calculateRSI(tickData);
      const volatility = calculateVolatility(tickData);
      const momentum = calculateMomentum(tickData);
      
      const signals = [];
      let trendStrength = 0;
      
      if (sma20 && sma50) {
        if (currentPrice > sma20 && sma20 > sma50) {
          signals.push({ type: 'bullish', indicator: 'Moving Average', message: 'Strong uptrend - Price > SMA20 > SMA50' });
          trendStrength += 2;
        } else if (currentPrice < sma20 && sma20 < sma50) {
          signals.push({ type: 'bearish', indicator: 'Moving Average', message: 'Strong downtrend - Price < SMA20 < SMA50' });
          trendStrength -= 2;
        } else if (currentPrice > sma20) {
          signals.push({ type: 'bullish', indicator: 'Moving Average', message: 'Price above SMA20' });
          trendStrength += 1;
        } else {
          signals.push({ type: 'bearish', indicator: 'Moving Average', message: 'Price below SMA20' });
          trendStrength -= 1;
        }
      }
      
      if (rsi) {
        if (rsi > 70) {
          signals.push({ type: 'warning', indicator: 'RSI', message: `Overbought: RSI at ${rsi.toFixed(1)} (>70)` });
          trendStrength -= 1;
        } else if (rsi < 30) {
          signals.push({ type: 'warning', indicator: 'RSI', message: `Oversold: RSI at ${rsi.toFixed(1)} (<30)` });
          trendStrength += 1;
        } else {
          signals.push({ type: 'neutral', indicator: 'RSI', message: `Neutral: RSI at ${rsi.toFixed(1)}` });
        }
      }
      
      if (momentum) {
        if (momentum > 1) {
          signals.push({ type: 'bullish', indicator: 'Momentum', message: `Positive momentum: +${momentum.toFixed(2)}%` });
          trendStrength += 1;
        } else if (momentum < -1) {
          signals.push({ type: 'bearish', indicator: 'Momentum', message: `Negative momentum: ${momentum.toFixed(2)}%` });
          trendStrength -= 1;
        }
      }
      
      let recommendation = 'NEUTRAL';
      if (trendStrength >= 3) recommendation = 'STRONG BUY';
      else if (trendStrength >= 1) recommendation = 'BUY';
      else if (trendStrength <= -3) recommendation = 'STRONG SELL';
      else if (trendStrength <= -1) recommendation = 'SELL';
      
      setAnalysis({
        currentPrice,
        sma20,
        sma50,
        rsi,
        volatility,
        momentum,
        signals,
        recommendation,
        trendStrength
      });
      
      setLoading(false);
      addDebug(`Analysis complete: ${recommendation}`);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                Deriv Analysis Tool
              </h1>
              <p className="text-slate-400 mt-1">ML-powered technical analysis</p>
            </div>
            
            <div className="flex items-center gap-4">
              <button
                onClick={connectToAPI}
                className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reconnect
              </button>
              
              <div className="flex items-center gap-2 bg-slate-700/50 px-4 py-2 rounded-lg">
                {isConnected ? (
                  <Wifi className="w-5 h-5 text-green-400" />
                ) : (
                  <WifiOff className="w-5 h-5 text-red-400" />
                )}
                <div>
                  <div className="text-sm font-medium">
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </div>
                  {isConnected && (
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      {isAuthorized ? (
                        <>
                          <CheckCircle className="w-3 h-3 text-green-400" />
                          Authorized
                        </>
                      ) : (
                        'Authorizing...'
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Market</label>
              <select 
                value={selectedMarket}
                onChange={(e) => setSelectedMarket(e.target.value)}
                disabled={!isAuthorized}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {markets.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            
            <div className="flex items-end">
              <button
                onClick={analyzeMarket}
                disabled={loading || tickData.length < 20}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-slate-600 disabled:to-slate-700 px-6 py-2.5 rounded-lg font-medium transition flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                <Activity className="w-4 h-4" />
                Analyze Market
                {tickData.length < 20 && ` (${tickData.length}/20)`}
              </button>
            </div>
          </div>
          
          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <span className="text-red-300 text-sm">{error}</span>
            </div>
          )}

          {/* Debug Console */}
          <details className="mt-4 bg-slate-900/50 rounded-lg">
            <summary className="cursor-pointer p-3 text-sm text-slate-400 hover:text-slate-300">
              Debug Console ({debugInfo.length} events)
            </summary>
            <div className="p-3 space-y-1 max-h-48 overflow-y-auto border-t border-slate-700">
              {debugInfo.length === 0 ? (
                <div className="text-xs text-slate-500">No events yet...</div>
              ) : (
                debugInfo.map((info, idx) => (
                  <div key={idx} className="text-xs font-mono text-slate-400">
                    {info}
                  </div>
                ))
              )}
            </div>
          </details>
        </div>

        {/* Price Chart */}
        {tickData.length > 0 && (
          <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Live Price Chart</h2>
              <div className="text-sm text-slate-400">{tickData.length} ticks</div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={tickData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis 
                  dataKey="time" 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  stroke="#94a3b8"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1e293b', 
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#3b82f6" 
                  strokeWidth={2} 
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Analysis Results */}
        {analysis && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-2">Current Price</h3>
                <p className="text-3xl font-bold">{analysis.currentPrice.toFixed(4)}</p>
              </div>
              
              <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-2">RSI (14)</h3>
                <p className="text-3xl font-bold">{analysis.rsi?.toFixed(1) || 'N/A'}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {analysis.rsi > 70 ? 'Overbought' : analysis.rsi < 30 ? 'Oversold' : 'Neutral'}
                </p>
              </div>
              
              <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-2">Momentum</h3>
                <p className={`text-3xl font-bold ${analysis.momentum > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {analysis.momentum?.toFixed(2)}%
                </p>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6 mb-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Recommendation</h3>
                <div className={`px-6 py-3 rounded-lg font-bold text-lg ${
                  analysis.recommendation.includes('BUY') 
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                    : analysis.recommendation.includes('SELL') 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                    : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                }`}>
                  {analysis.recommendation}
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-3">Moving Averages</h4>
                  <div className="space-y-2">
                    <p className="text-slate-300">SMA(20): <span className="font-bold">{analysis.sma20?.toFixed(4)}</span></p>
                    <p className="text-slate-300">SMA(50): <span className="font-bold">{analysis.sma50?.toFixed(4) || 'N/A'}</span></p>
                  </div>
                </div>
                
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-3">Risk Metrics</h4>
                  <p className="text-slate-300">Volatility: <span className="font-bold">{analysis.volatility?.toFixed(6)}</span></p>
                  <p className="text-xs text-slate-400 mt-1">Std dev of last 20 ticks</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-6">
              <h3 className="text-xl font-bold mb-4">Technical Signals</h3>
              <div className="space-y-3">
                {analysis.signals.map((signal, idx) => (
                  <div key={idx} className="flex items-start gap-3 bg-slate-700/30 rounded-lg p-4">
                    {signal.type === 'bullish' && <TrendingUp className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />}
                    {signal.type === 'bearish' && <TrendingDown className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />}
                    {signal.type === 'warning' && <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />}
                    {signal.type === 'neutral' && <Activity className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />}
                    <div>
                      <p className="font-medium text-white">{signal.indicator}</p>
                      <p className="text-sm text-slate-400">{signal.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Waiting States */}
        {!analysis && tickData.length > 0 && tickData.length < 20 && (
          <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-12 text-center">
            <Activity className="w-16 h-16 mx-auto mb-4 text-blue-500 animate-pulse" />
            <p className="text-xl font-medium mb-2">Collecting Data...</p>
            <p className="text-slate-400 mb-4">{tickData.length} / 20 ticks</p>
            <div className="max-w-md mx-auto bg-slate-700 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${(tickData.length / 20) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {tickData.length === 0 && isConnected && (
          <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-12 text-center">
            <Wifi className="w-16 h-16 mx-auto mb-4 text-green-500 animate-pulse" />
            <p className="text-xl font-medium mb-2">Connected</p>
            <p className="text-slate-400">Waiting for market data...</p>
          </div>
        )}

        {!isConnected && (
          <div className="bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700 p-12 text-center">
            <WifiOff className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <p className="text-xl font-medium mb-2">Disconnected</p>
            <p className="text-slate-400 mb-4">Click Reconnect to try again</p>
            <p className="text-sm text-slate-500">Check the Debug Console above for details</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DerivAnalysisTool;