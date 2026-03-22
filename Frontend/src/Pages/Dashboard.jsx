import React, { useState, useEffect } from 'react';

const Dashboard = () => {
  // Simulated real-time sensor state
  const [currentNoiseLevel, setCurrentNoiseLevel] = useState(0);
  const [status, setStatus] = useState('Quiet');

  // Configurable thresholds matching the ESP32 logic
  const [thresholds, setThresholds] = useState({
    quiet: 200,
    medium: 500,
    loud: 1000,
  });

  // Hardware states
  const [leds, setLeds] = useState({
    blue: false,
    green: false,
    red: false,
    buzzer: false,
  });

  // Handle threshold updates
  const handleThresholdChange = (e) => {
    const { name, value } = e.target;
    setThresholds((prev) => ({
      ...prev,
      [name]: parseInt(value) || 0,
    }));
  };

  // Evaluate hardware state based on current noise level and thresholds
  useEffect(() => {
    if (currentNoiseLevel < thresholds.quiet) {
      setStatus('Quiet');
      setLeds({ blue: false, green: false, red: false, buzzer: false });
    } else if (currentNoiseLevel >= thresholds.quiet && currentNoiseLevel < thresholds.medium) {
      setStatus('Medium-low');
      setLeds({ blue: true, green: false, red: false, buzzer: false });
    } else if (currentNoiseLevel >= thresholds.medium && currentNoiseLevel < thresholds.loud) {
      setStatus('Medium');
      setLeds({ blue: true, green: true, red: false, buzzer: false });
    } else {
      setStatus('Loud');
      setLeds({ blue: true, green: true, red: true, buzzer: true });
    }
  }, [currentNoiseLevel, thresholds]);

  // Simulate incoming serial data for demonstration purposes
  // In production, replace this with a WebSocket or API call to your ESP32
  useEffect(() => {
    const interval = setInterval(() => {
      // Generate a random noise level between 0 and 1500
      const mockSensorValue = Math.floor(Math.random() * 1500);
      setCurrentNoiseLevel(mockSensorValue);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Noise Level Controller</h1>
        <p className="text-gray-500">Real-time monitoring and threshold configuration</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Real-Time Monitor Panel */}
        <div className="border border-gray-200 rounded-xl p-6 bg-white shadow-sm space-y-6">
          <h2 className="text-xl font-semibold">Live Feed</h2>
          
          <div className="flex flex-col items-center justify-center py-8">
            <span className="text-6xl font-black text-gray-800">{currentNoiseLevel}</span>
            <span className="text-sm text-gray-500 uppercase tracking-widest mt-2">Average Amplitude</span>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="font-medium text-gray-700">System Status:</span>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                status === 'Quiet' ? 'bg-gray-100 text-gray-600' :
                status === 'Medium-low' ? 'bg-blue-100 text-blue-700' :
                status === 'Medium' ? 'bg-green-100 text-green-700' :
                'bg-red-100 text-red-700 animate-pulse'
              }`}>
                {status}
              </span>
            </div>

            {/* Hardware Indicators */}
            <div className="pt-4 border-t border-gray-100">
              <h3 className="text-sm font-medium text-gray-500 mb-4">Active Hardware</h3>
              <div className="flex justify-around">
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-10 h-10 rounded-full transition-colors ${leds.blue ? 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-gray-200'}`} />
                  <span className="text-xs font-medium">Blue LED</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-10 h-10 rounded-full transition-colors ${leds.green ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-gray-200'}`} />
                  <span className="text-xs font-medium">Green LED</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-10 h-10 rounded-full transition-colors ${leds.red ? 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-gray-200'}`} />
                  <span className="text-xs font-medium">Red LED</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-10 h-10 rounded-lg transition-colors flex items-center justify-center ${leds.buzzer ? 'bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.5)] text-white' : 'bg-gray-200 text-gray-400'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                  </div>
                  <span className="text-xs font-medium">Buzzer</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Panel */}
        <div className="border border-gray-200 rounded-xl p-6 bg-white shadow-sm space-y-6">
          <h2 className="text-xl font-semibold">Threshold Configuration</h2>
          <p className="text-sm text-gray-500">Adjust the boundaries for triggering the LEDs and buzzer.</p>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="quiet" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Quiet Threshold</label>
              <div className="flex items-center gap-4">
                <input 
                  id="quiet" 
                  name="quiet" 
                  type="number" 
                  value={thresholds.quiet} 
                  onChange={handleThresholdChange}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-sm text-gray-500 w-32">Triggers Blue</span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="medium" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Medium Threshold</label>
              <div className="flex items-center gap-4">
                <input 
                  id="medium" 
                  name="medium" 
                  type="number" 
                  value={thresholds.medium} 
                  onChange={handleThresholdChange}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-sm text-gray-500 w-32">Triggers Green</span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="loud" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Loud Threshold</label>
              <div className="flex items-center gap-4">
                <input 
                  id="loud" 
                  name="loud" 
                  type="number" 
                  value={thresholds.loud} 
                  onChange={handleThresholdChange}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-sm text-gray-500 w-32">Triggers Red + Buzzer</span>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-gray-100">
            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 bg-gray-900 text-white hover:bg-gray-800 h-10 px-4 py-2 w-full">
              Sync to ESP32 Device
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;