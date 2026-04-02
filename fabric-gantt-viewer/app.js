// Global state
let csvData = [];
let zoomLevel = 1;
let lineChartZoomLevel = 1;
let selectedRequestId = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('csvFileInput').addEventListener('change', handleFileUpload);
  document.getElementById('zoomInBtn').addEventListener('click', () => adjustZoom(1.2));
  document.getElementById('zoomOutBtn').addEventListener('click', () => adjustZoom(0.8));
  document.getElementById('resetZoomBtn').addEventListener('click', resetZoom);
  document.getElementById('lineZoomInBtn').addEventListener('click', () => adjustLineChartZoom(1.5));
  document.getElementById('lineZoomOutBtn').addEventListener('click', () => adjustLineChartZoom(0.67));
  document.getElementById('lineResetZoomBtn').addEventListener('click', resetLineChartZoom);
  document.getElementById('closeDetailsBtn').addEventListener('click', hideDetails);
});

// Handle CSV file upload
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = e.target.result;
      csvData = parseCSV(text);
      
      if (csvData.length === 0) {
        showToast('No data found in CSV file', 'danger');
        return;
      }

      // Validate required columns
      const requiredColumns = ['request_id', 'submit_time', 'start_time', 'end_time', 'cu_per_second', 'allocated_cpu_time_seconds'];
      const hasAllColumns = requiredColumns.every(col => csvData[0].hasOwnProperty(col));
      
      if (!hasAllColumns) {
        showToast('CSV file missing required columns', 'danger');
        return;
      }

      // Process data
      processData();
      showToast(`Loaded ${csvData.length} records successfully`, 'success');
      
      // Show metrics and chart
      document.getElementById('metricsSection').style.display = 'flex';
      document.getElementById('mainContent').style.display = 'flex';
      
      // Calculate and display metrics
      displayMetrics();
      
      // Render gantt chart
      renderGanttChart();
      
      // Render line chart
      renderLineChart();
      
    } catch (error) {
      console.error('Error parsing CSV:', error);
      showToast('Error parsing CSV file: ' + error.message, 'danger');
    }
  };
  reader.readAsText(file);
}

// Parse CSV text to array of objects
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index].trim();
      });
      data.push(row);
    }
  }
  
  return data;
}

// Parse a CSV line handling quoted values
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

// Process data - convert timestamps and calculate durations
function processData() {
  csvData = csvData.map(row => {
    return {
      ...row,
      submit_time_ms: parseTimestamp(row.submit_time),
      start_time_ms: parseTimestamp(row.start_time),
      end_time_ms: parseTimestamp(row.end_time),
      cu_per_second: parseFloat(row.cu_per_second) || 0,
      allocated_cpu_time_seconds: parseFloat(row.allocated_cpu_time_seconds) || 0,
      total_elapsed_time_seconds: parseFloat(row.total_elapsed_time_seconds) || 0
    };
  }).filter(row => row.submit_time_ms && row.end_time_ms);
  
  // Sort by submit time
  csvData.sort((a, b) => a.submit_time_ms - b.submit_time_ms);
}

// Parse timestamp to milliseconds
function parseTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? null : date.getTime();
}

// Calculate and display metrics
function displayMetrics() {
  if (csvData.length === 0) return;
  
  // End-to-end duration
  const minSubmitTime = Math.min(...csvData.map(r => r.submit_time_ms));
  const maxEndTime = Math.max(...csvData.map(r => r.end_time_ms));
  const totalDurationSeconds = (maxEndTime - minSubmitTime) / 1000;
  
  document.getElementById('metricDuration').textContent = formatDuration(totalDurationSeconds);
  document.getElementById('metricDurationSeconds').textContent = `${totalDurationSeconds.toFixed(2)} seconds`;
  
  // Average CU per second
  const totalCU = csvData.reduce((sum, r) => sum + r.cu_per_second, 0);
  const avgCU = totalCU / csvData.length;
  const minCU = Math.min(...csvData.map(r => r.cu_per_second));
  const maxCU = Math.max(...csvData.map(r => r.cu_per_second));
  document.getElementById('metricAvgCU').textContent = avgCU.toFixed(2);
  document.getElementById('metricMinMaxCU').textContent = `min: ${minCU.toFixed(2)} | max: ${maxCU.toFixed(2)}`;
  
  // Total allocated CPU time
  const totalCPU = csvData.reduce((sum, r) => sum + r.allocated_cpu_time_seconds, 0);
  document.getElementById('metricTotalCPU').textContent = totalCPU.toFixed(2);
  
  // Peak CU per second (considering parallel queries)
  const peakInfo = calculatePeakCU();
  document.getElementById('metricPeakCU').textContent = peakInfo.peakCU.toFixed(2);
  document.getElementById('metricPeakTime').textContent = `at ${new Date(peakInfo.peakTime).toLocaleTimeString()}`;
}

// Calculate peak CU considering parallel queries
function calculatePeakCU() {
  // Create events for start and end times
  const events = [];
  
  csvData.forEach(row => {
    if (row.start_time_ms && row.end_time_ms) {
      events.push({ time: row.start_time_ms, type: 'start', cu: row.cu_per_second });
      events.push({ time: row.end_time_ms, type: 'end', cu: row.cu_per_second });
    }
  });
  
  // Sort events by time
  events.sort((a, b) => a.time - b.time);
  
  let currentCU = 0;
  let peakCU = 0;
  let peakTime = events[0]?.time || Date.now();
  
  events.forEach(event => {
    if (event.type === 'start') {
      currentCU += event.cu;
    } else {
      currentCU -= event.cu;
    }
    
    if (currentCU > peakCU) {
      peakCU = currentCU;
      peakTime = event.time;
    }
  });
  
  return { peakCU, peakTime };
}

// Format duration to HH:MM:SS
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Render Gantt Chart
function renderGanttChart() {
  const container = document.getElementById('ganttChart');
  container.innerHTML = '';
  
  if (csvData.length === 0) return;
  
  // Calculate time range
  const minTime = Math.min(...csvData.map(r => r.submit_time_ms));
  const maxTime = Math.max(...csvData.map(r => r.end_time_ms));
  const timeRange = maxTime - minTime;
  
  // Get peak CU info
  const peakInfo = calculatePeakCU();
  
  // Create timeline header
  const timelineHeader = createTimelineHeader(minTime, maxTime, timeRange);
  container.appendChild(timelineHeader);
  
  // Create gantt rows
  csvData.forEach(row => {
    const ganttRow = createGanttRow(row, minTime, timeRange);
    container.appendChild(ganttRow);
  });
  
  // Add peak CU vertical line (after rows are rendered)
  addPeakCULine(container, peakInfo, minTime, timeRange, csvData.length);
}

// Create timeline header with time markers
function createTimelineHeader(minTime, maxTime, timeRange) {
  const header = document.createElement('div');
  header.className = 'timeline-header';
  
  // Calculate appropriate interval based on time range
  const durationSeconds = timeRange / 1000;
  let intervalSeconds;
  
  if (durationSeconds <= 60) {
    intervalSeconds = 10; // 10 second intervals
  } else if (durationSeconds <= 300) {
    intervalSeconds = 30; // 30 second intervals
  } else if (durationSeconds <= 600) {
    intervalSeconds = 60; // 1 minute intervals
  } else if (durationSeconds <= 3600) {
    intervalSeconds = 300; // 5 minute intervals
  } else {
    intervalSeconds = 600; // 10 minute intervals
  }
  
  const numTicks = Math.ceil(durationSeconds / intervalSeconds);
  
  for (let i = 0; i <= numTicks; i++) {
    const timeMs = minTime + (i * intervalSeconds * 1000);
    const percentage = ((timeMs - minTime) / timeRange) * 100 * zoomLevel;
    
    const tick = document.createElement('div');
    tick.className = 'timeline-tick';
    tick.style.position = 'absolute';
    tick.style.left = percentage + '%';
    tick.textContent = new Date(timeMs).toLocaleTimeString();
    
    header.appendChild(tick);
  }
  
  return header;
}

// Add peak CU vertical line to the chart
function addPeakCULine(container, peakInfo, minTime, timeRange, rowCount) {
  const peakPercentage = ((peakInfo.peakTime - minTime) / timeRange) * 100;
  
  // Calculate height: 48px per row (40px min-height + 8px margin) + 50px for header
  const lineHeight = (rowCount * 48) + 50;
  
  const line = document.createElement('div');
  line.className = 'peak-cu-line';
  line.style.left = peakPercentage + '%';
  line.style.height = lineHeight + 'px';
  
  const label = document.createElement('div');
  label.className = 'peak-cu-label';
  label.textContent = `Peak: ${peakInfo.peakCU.toFixed(2)} CU/s`;
  line.appendChild(label);
  
  container.appendChild(line);
}

// Create a gantt row for a single request
function createGanttRow(row, minTime, timeRange) {
  const rowDiv = document.createElement('div');
  rowDiv.className = 'gantt-row';
  
  // Label
  const label = document.createElement('div');
  label.className = 'gantt-label';
  label.textContent = row.request_id;
  label.title = row.request_id;
  rowDiv.appendChild(label);
  
  // Bars container
  const barsContainer = document.createElement('div');
  barsContainer.className = 'gantt-bars-container';
  barsContainer.style.minWidth = (100 * zoomLevel) + '%';
  
  // Queue bar (submit to start)
  if (row.start_time_ms) {
    const queueStart = ((row.submit_time_ms - minTime) / timeRange) * 100;
    const queueWidth = ((row.start_time_ms - row.submit_time_ms) / timeRange) * 100;
    
    if (queueWidth > 0) {
      const queueBar = document.createElement('div');
      queueBar.className = 'gantt-bar gantt-bar-queue';
      queueBar.style.left = queueStart + '%';
      queueBar.style.width = queueWidth + '%';
      queueBar.dataset.requestId = row.request_id;
      queueBar.addEventListener('click', () => showDetails(row.request_id));
      
      barsContainer.appendChild(queueBar);
    }
  }
  
  // Running bar (start to end)
  const runningStart = ((row.start_time_ms - minTime) / timeRange) * 100;
  const runningWidth = ((row.end_time_ms - row.start_time_ms) / timeRange) * 100;
  
  const runningBar = document.createElement('div');
  runningBar.className = 'gantt-bar gantt-bar-running';
  runningBar.style.left = runningStart + '%';
  runningBar.style.width = Math.max(runningWidth, 0.5) + '%';
  runningBar.dataset.requestId = row.request_id;
  runningBar.addEventListener('click', () => showDetails(row.request_id));
  
  if (selectedRequestId === row.request_id) {
    runningBar.classList.add('selected');
  }
  
  barsContainer.appendChild(runningBar);
  rowDiv.appendChild(barsContainer);
  
  return rowDiv;
}

// Show details panel for a request
function showDetails(requestId) {
  selectedRequestId = requestId;
  const row = csvData.find(r => r.request_id === requestId);
  
  if (!row) return;
  
  // Update column layout
  document.getElementById('ganttColumn').className = 'col-lg-8';
  document.getElementById('detailsColumn').style.display = 'block';
  
  // Populate details
  const detailsContent = document.getElementById('detailsContent');
  detailsContent.innerHTML = `
    <div class="detail-group">
      <div class="detail-group-title">Request Information</div>
      <div class="detail-item">
        <div class="detail-label">Request ID</div>
        <div class="detail-value">${row.request_id}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Connection ID</div>
        <div class="detail-value">${row.connection_id || 'N/A'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Statement Type</div>
        <div class="detail-value">${row.statement_type || 'N/A'}</div>
      </div>
    </div>

    <div class="detail-group">
      <div class="detail-group-title">Timing Information</div>
      <div class="detail-item">
        <div class="detail-label">Submit Time</div>
        <div class="detail-value">${new Date(row.submit_time_ms).toLocaleString()}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Start Time</div>
        <div class="detail-value">${new Date(row.start_time_ms).toLocaleString()}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">End Time</div>
        <div class="detail-value">${new Date(row.end_time_ms).toLocaleString()}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Queue Time</div>
        <div class="detail-value">${((row.start_time_ms - row.submit_time_ms) / 1000).toFixed(2)} seconds</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Running Time</div>
        <div class="detail-value">${((row.end_time_ms - row.start_time_ms) / 1000).toFixed(2)} seconds</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Total Elapsed Time</div>
        <div class="detail-value">${row.total_elapsed_time_seconds} seconds</div>
      </div>
    </div>

    <div class="detail-group">
      <div class="detail-group-title">Performance Metrics</div>
      <div class="detail-item">
        <div class="detail-label">CU per Second</div>
        <div class="detail-value">${row.cu_per_second}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Allocated CPU Time</div>
        <div class="detail-value">${row.allocated_cpu_time_seconds} seconds</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Row Count</div>
        <div class="detail-value">${row.row_count || 'N/A'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Data Scanned (Remote)</div>
        <div class="detail-value">${row.data_scanned_remote_storage_mb || '0'} MB</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Data Scanned (Memory)</div>
        <div class="detail-value">${row.data_scanned_memory_mb || '0'} MB</div>
      </div>
    </div>

    <div class="detail-group">
      <div class="detail-group-title">Command</div>
      <div class="detail-command">${row.command || 'N/A'}</div>
    </div>
  `;
  
  // Highlight selected bar
  document.querySelectorAll('.gantt-bar').forEach(bar => {
    bar.classList.remove('selected');
    if (bar.dataset.requestId === requestId) {
      bar.classList.add('selected');
    }
  });
}

// Hide details panel
function hideDetails() {
  selectedRequestId = null;
  document.getElementById('ganttColumn').className = 'col-lg-12';
  document.getElementById('detailsColumn').style.display = 'none';
  
  // Remove selection highlight
  document.querySelectorAll('.gantt-bar').forEach(bar => {
    bar.classList.remove('selected');
  });
}

// Zoom controls
function adjustZoom(factor) {
  zoomLevel *= factor;
  zoomLevel = Math.max(0.5, Math.min(zoomLevel, 5)); // Limit zoom between 0.5x and 5x
  renderGanttChart();
}

function resetZoom() {
  zoomLevel = 1;
  renderGanttChart();
}

// Line chart zoom controls
function adjustLineChartZoom(factor) {
  lineChartZoomLevel *= factor;
  lineChartZoomLevel = Math.max(1, Math.min(lineChartZoomLevel, 10)); // Limit zoom between 1x and 10x
  renderLineChart();
}

function resetLineChartZoom() {
  lineChartZoomLevel = 1;
  renderLineChart();
}

// Render line chart showing total CU per second over time
function renderLineChart() {
  if (csvData.length === 0) return;
  
  // Calculate time range
  const minTime = Math.min(...csvData.map(r => r.submit_time_ms));
  const maxTime = Math.max(...csvData.map(r => r.end_time_ms));
  const durationSeconds = Math.ceil((maxTime - minTime) / 1000);
  
  // Calculate total CU at each second
  const cuBySecond = [];
  for (let sec = 0; sec <= durationSeconds; sec++) {
    const currentTime = minTime + (sec * 1000);
    let totalCU = 0;
    
    // Sum CU from all queries running at this time
    csvData.forEach(row => {
      if (row.start_time_ms <= currentTime && currentTime <= row.end_time_ms) {
        totalCU += row.cu_per_second;
      }
    });
    
    cuBySecond.push({ second: sec, cu: totalCU, time: currentTime });
  }
  
  // Find max CU for scaling
  const maxCU = Math.max(...cuBySecond.map(d => d.cu));
  
  // Get peak info for highlighting
  const peakInfo = calculatePeakCU();
  
  // Draw the chart
  drawLineChart(cuBySecond, maxCU, minTime, peakInfo);
}

// Draw SVG line chart
function drawLineChart(data, maxCU, minTime, peakInfo) {
  const svg = document.getElementById('lineChart');
  const container = document.getElementById('lineChartContainer');
  const baseWidth = container.clientWidth;
  const width = baseWidth * lineChartZoomLevel;
  const height = 300;
  
  // Set SVG dimensions
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.innerHTML = '';
  
  // Chart margins
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  // Create chart group
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
  svg.appendChild(g);
  
  // Y-axis scale (CU)
  const yScale = (cu) => chartHeight - (cu / maxCU) * chartHeight;
  
  // X-axis scale (seconds)
  const xScale = (second) => (second / (data.length - 1)) * chartWidth;
  
  // Draw horizontal grid lines
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = (chartHeight / gridLines) * i;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'line-chart-grid');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', y);
    line.setAttribute('x2', chartWidth);
    line.setAttribute('y2', y);
    g.appendChild(line);
    
    // Y-axis labels
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'line-chart-label');
    label.setAttribute('x', -10);
    label.setAttribute('y', y + 4);
    label.setAttribute('text-anchor', 'end');
    label.textContent = ((maxCU - (maxCU / gridLines) * i).toFixed(1));
    g.appendChild(label);
  }
  
  // Draw area under the line
  let areaPath = `M 0,${chartHeight}`;
  data.forEach((d, i) => {
    const x = xScale(i);
    const y = yScale(d.cu);
    if (i === 0) {
      areaPath += ` L ${x},${y}`;
    } else {
      areaPath += ` L ${x},${y}`;
    }
  });
  areaPath += ` L ${chartWidth},${chartHeight} Z`;
  
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('class', 'line-chart-area');
  area.setAttribute('d', areaPath);
  g.appendChild(area);
  
  // Draw line path
  let pathData = '';
  data.forEach((d, i) => {
    const x = xScale(i);
    const y = yScale(d.cu);
    pathData += (i === 0 ? 'M' : 'L') + ` ${x},${y}`;
  });
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'line-chart-path');
  path.setAttribute('d', pathData);
  g.appendChild(path);
  
  // Draw points (show more points based on data density)
  const samplingRate = Math.max(1, Math.floor(data.length / 200)); // More points visible
  data.forEach((d, i) => {
    if (i % samplingRate === 0 || d.time === peakInfo.peakTime || d.cu > 0) {
      const x = xScale(i);
      const y = yScale(d.cu);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', d.time === peakInfo.peakTime ? 'line-chart-peak-point' : 'line-chart-point');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', d.time === peakInfo.peakTime ? 5 : 3);
      
      // Tooltip
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Time: ${new Date(d.time).toLocaleTimeString()}\nCU/s: ${d.cu.toFixed(2)}`;
      circle.appendChild(title);
      
      g.appendChild(circle);
    }
  });
  
  // Draw X-axis
  const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  xAxis.setAttribute('class', 'line-chart-axis');
  xAxis.setAttribute('x1', 0);
  xAxis.setAttribute('y1', chartHeight);
  xAxis.setAttribute('x2', chartWidth);
  xAxis.setAttribute('y2', chartHeight);
  g.appendChild(xAxis);
  
  // Draw Y-axis
  const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  yAxis.setAttribute('class', 'line-chart-axis');
  yAxis.setAttribute('x1', 0);
  yAxis.setAttribute('y1', 0);
  yAxis.setAttribute('x2', 0);
  yAxis.setAttribute('y2', chartHeight);
  g.appendChild(yAxis);
  
  // X-axis labels (time)
  const xLabels = 8;
  for (let i = 0; i <= xLabels; i++) {
    const dataIndex = Math.floor((data.length - 1) * (i / xLabels));
    const d = data[dataIndex];
    const x = xScale(dataIndex);
    
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'line-chart-label');
    label.setAttribute('x', x);
    label.setAttribute('y', chartHeight + 20);
    label.setAttribute('text-anchor', 'middle');
    label.textContent = new Date(d.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    g.appendChild(label);
  }
  
  // Y-axis title
  const yTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  yTitle.setAttribute('class', 'line-chart-title');
  yTitle.setAttribute('transform', `translate(${-45},${chartHeight / 2}) rotate(-90)`);
  yTitle.setAttribute('text-anchor', 'middle');
  yTitle.textContent = 'Total CU per Second';
  g.appendChild(yTitle);
  
  // X-axis title
  const xTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xTitle.setAttribute('class', 'line-chart-title');
  xTitle.setAttribute('x', chartWidth / 2);
  xTitle.setAttribute('y', chartHeight + 35);
  xTitle.setAttribute('text-anchor', 'middle');
  xTitle.textContent = 'Time';
  g.appendChild(xTitle);
}

// Show toast notification
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  
  // Remove existing color classes
  toast.classList.remove('text-bg-success', 'text-bg-danger', 'text-bg-info');
  
  // Add appropriate color class
  toast.classList.add(`text-bg-${type}`);
  
  // Set message
  toastMsg.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-circle' : 'info-circle'} me-2"></i>${message}`;
  
  // Show toast
  const bsToast = new bootstrap.Toast(toast);
  bsToast.show();
}
