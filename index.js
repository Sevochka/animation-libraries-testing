const puppeteer = require('puppeteer');


const URL = 'http://localhost:3000';
const TABS = ['DIVS', 'SVGS', 'CANVAS'];
const LIBRARIES = ['gsap', 'animejs', 'mojs', 'popmotion', 'velocity-js', 'react-spring', 'framer-motion'];

// DIVS
// const PARTICLES = [10000, 15000, 30000, 45000];
// SVGS
// const PARTICLES = [2000, 5000, 10000, 15000];
// CANVAS
const PARTICLES = [15000, 30000, 40000, 50000];

const REPEATS = 1;
const BASE_ANIMATION_TIME = 5000;
const BASE_STAGGER_TIME = 10;

// Function to wait (similar to sleep in other languages)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getUrl = (tab, library, particles) => {
  return `${URL}?tab=${tab}&library=${library}&particles=${particles}`;
}

// Function to start counting frames and tracking longest frame time
async function startFrameCounting(page) {
  await page.evaluate(() => {
    window.framesRendered = 0;
    window.longestFrameTime = 0;
    let lastFrameTimestamp = performance.now();
    const countFrames = () => {
      const now = performance.now();
      const frameTime = now - lastFrameTimestamp;
      window.longestFrameTime = Math.max(window.longestFrameTime, frameTime);
      lastFrameTimestamp = now;
      window.framesRendered++;
      window.requestAnimationFrame(countFrames);
    };
    window.requestAnimationFrame(countFrames);
  });
}

// Function to record memory usage over time
async function recordMemoryUsageOverTime(page, interval, duration) {
  let memoryReadings = [];
  let startTime = Date.now();
  while (Date.now() - startTime < duration) {
    const memoryUsage = await page.evaluate(() => performance.memory.usedJSHeapSize);
    memoryReadings.push(memoryUsage);
    await sleep(interval);
  }
  return memoryReadings;
}

// Function to measure the duration of the animation
async function measureAnimationDuration(page) {
  return page.evaluate(() => {
    performance.measure('anim-duration', 'start-anim', 'end-anim');
    const measure = performance.getEntriesByName('anim-duration')[0];
    return measure.duration;
  });
}

// Function to calculate FPS and Jank/Stutter Score
async function calculateFPSAndJank(page, duration) {
  const { framesRendered, longestFrameTime } = await page.evaluate(() => ({
    framesRendered: window.framesRendered,
    longestFrameTime: window.longestFrameTime,
  }));
  const fps = (framesRendered / duration) * 1000; // duration is in milliseconds

  // Calculate Jank/Stutter Score (assuming a jank is when frame time is over 16.67ms for 60fps)
  const jankThreshold = 16.67; // milliseconds
  const jankScore = framesRendered - (duration / jankThreshold);

  return { fps, longestFrameTime, jankScore };
}

// Function to get CPU and GPU Utilization
async function getCPUAndGPUUsage(client) {
  const { metrics } = await client.send('Performance.getMetrics');
  const cpuUsage = metrics.find(m => m.name === 'TaskDuration').value; // Approximation of CPU usage
  return { cpuUsage, gpuUsage: 'any' };
}

// Function to get Memory Fluctuations and Number of Layout Reflows
async function getMemoryAndLayoutReflows(page) {
  const memoryAndReflows = await page.evaluate(() => {
    const memoryUsageStart = performance.memory.usedJSHeapSize;
    const layoutReflows = performance.getEntriesByType('layout').length;
    return { memoryUsageStart, layoutReflows };
  });
  return memoryAndReflows;
}

// Main function to measure performance
async function startMeasurement(tab, library, particles) {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: false,
  });
  const page = await browser.newPage();

  const startLoadTime = Date.now();

  // Navigate to the page with the animation
  await page.goto(getUrl(tab, library, particles), {
    waitUntil: 'domcontentloaded',
  });
  try {
    await page.waitForSelector('#content', { timeout: 300000 });
  } catch (e) {
    console.log(`TAB - ${tab}; LIBRARY - ${library}; PARTICLES - ${particles};`);
    console.error('Timeout ran out')
    return;
  }
  // await page.emulateCPUThrottling(15)
  // await sleep(3000)

  console.log('loaded')

  // Start a Chrome DevTools Protocol session
  const client = await page.target().createCDPSession();
  await client.send('Performance.enable');
  await client.send('Overlay.setShowFPSCounter', { show: true });

  // Start counting frames
  await startFrameCounting(page);

  // Start the animation and mark its beginning
  await page.evaluate(() => {
    performance.mark('start-anim');
  });

  const sleepTime = BASE_ANIMATION_TIME + (particles - 1) * BASE_STAGGER_TIME;

  const loadTime = Date.now() - startLoadTime;

  // Wait for the animation to finish
  // await sleep(sleepTime); // Duration of the animation in milliseconds
  await sleep(10000); // Duration of the animation in milliseconds


  // Mark the end of the animation
  await page.evaluate(() => performance.mark('end-anim'));

  // Measure the duration of the animation
  const duration = await measureAnimationDuration(page);

  // Calculate FPS and Jank/Stutter Score
  const { fps, longestFrameTime, jankScore } = await calculateFPSAndJank(page, duration);

  // Get CPU and GPU usage (note: GPU usage is not directly measurable)
  const { cpuUsage, gpuUsage } = await getCPUAndGPUUsage(client);

  // Get Memory Fluctuations and Number of Layout Reflows
  const { memoryUsageStart, layoutReflows } = await getMemoryAndLayoutReflows(page);

  const memoryReadings = await recordMemoryUsageOverTime(page, 1000, duration);

  const averageMemoryUsage = memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length;


  // console.log(`Memory Readings: ${memoryReadings.join(', ')}`);


  // // Output the collected metrics
  // console.log(`TAB - ${tab}; LIBRARY - ${library}; PARTICLES - ${particles};`);
  // console.log(`Duration: ${duration} ms`)
  // console.log(`FPS: ${fps.toFixed(2)}`);
  // console.log(`Average Memory Usage: ${averageMemoryUsage}b`);
  // console.log(`CPU usage: ${cpuUsage} ms`);
  // console.log(`Longest Frame Time: ${longestFrameTime}ms`);
  // console.log(`Jank/Stutter Score: ${jankScore}`);
  // console.log(`Load time: ${loadTime}ms`);
  // console.log('')

  await browser.close();

  return {
    duration,
    fps,
    averageMemoryUsage,
    cpuUsage,
    longestFrameTime,
    jankScore,
    loadTime
  };
}

const start = async () => {
  for (let i = 0; i < TABS.length; i++) {
    const tab = TABS[i];

    for (let k = 0; k < PARTICLES.length; k++) {
      const particles = PARTICLES[k];

      for (let j = 0; j < LIBRARIES.length; j++) {
        const library = LIBRARIES[j];

        // Initialize variables to store sums of metrics
        let sumDuration = 0, sumFps = 0, sumMemoryUsage = 0, sumCpuUsage = 0, sumLongestFrameTime = 0, sumJankScore = 0, sumLoadTime = 0;

        for (let repeat = 0; repeat < REPEATS; repeat++) {
          console.log(`Starting Measurement: Tab - ${tab}, Library - ${library}, Particles - ${particles}, Repeat - ${repeat + 1}`);

          // Get metrics from the measurement
          const metrics = await startMeasurement(tab, library, particles);

          // Accumulate the metrics
          sumFps += metrics.fps;
          sumMemoryUsage += metrics.averageMemoryUsage;
          sumCpuUsage += metrics.cpuUsage;
          sumLongestFrameTime += metrics.longestFrameTime;
          sumJankScore += metrics.jankScore;
          sumLoadTime += metrics.loadTime;
        }

        // Calculate averages
        const avgFps = sumFps / REPEATS;
        const avgMemoryUsage = sumMemoryUsage / REPEATS;
        const avgCpuUsage = sumCpuUsage / REPEATS;
        const avgLongestFrameTime = sumLongestFrameTime / REPEATS;
        const avgJankScore = sumJankScore / REPEATS;
        const avgLoadTime = sumLoadTime / REPEATS;

        // Output the average metrics
        console.log(`Averages for Tab - ${tab}, Library - ${library}, Particles - ${particles}:`);
        console.log(`Average FPS: ${avgFps}`);
        console.log(`Average Memory Usage: ${avgMemoryUsage}b`);
        console.log(`Average CPU usage: ${avgCpuUsage} ms`);
        console.log(`Average Longest Frame Time: ${avgLongestFrameTime}ms`);
        console.log(`Average Jank/Stutter Score: ${avgJankScore}`);
        console.log(`Average Load time: ${avgLoadTime}ms`);
        console.log('');
      }
    }
  }
}

start();
