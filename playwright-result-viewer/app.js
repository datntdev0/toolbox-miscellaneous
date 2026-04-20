// Global variables
let reportData = null;
let processedTests = [];

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('loadButton').addEventListener('click', loadReport);
    document.getElementById('fileInput').addEventListener('change', function(e) {
        if (e.target.files.length > 0) {
            loadReport();
        }
    });
});

// Load and process the report
function loadReport() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) {
        alert('Please select a JSON file first');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            reportData = JSON.parse(e.target.result);
            processReport();
        } catch (error) {
            alert('Error parsing JSON file: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// Process the report data
function processReport() {
    processedTests = [];
    
    if (!reportData || !reportData.suites) {
        alert('Invalid report format');
        return;
    }
    
    // Extract all tests from the nested structure
    reportData.suites.forEach(suite => {
        processSuite(suite, suite.file || suite.title);
    });
    
    // Update UI
    updateSummaryStats();
    renderTopTests();
    renderAllTests();
    
    // Show sections
    document.getElementById('summarySection').style.display = 'flex';
    document.getElementById('topTestsSection').style.display = 'block';
    document.getElementById('allTestsSection').style.display = 'block';
}

// Recursively process suites and extract test data
function processSuite(suite, filePath, parentSuite = null) {
    const suiteName = suite.title;
    
    // Process specs in this suite
    if (suite.specs && suite.specs.length > 0) {
        suite.specs.forEach(spec => {
            processSpec(spec, filePath, suiteName, parentSuite);
        });
    }
    
    // Process nested suites
    if (suite.suites && suite.suites.length > 0) {
        suite.suites.forEach(nestedSuite => {
            processSuite(nestedSuite, filePath, suiteName);
        });
    }
}

// Process individual spec (test)
function processSpec(spec, filePath, suiteName, parentSuite) {
    if (!spec.tests || spec.tests.length === 0) {
        return;
    }
    
    const durations = [];
    let allPassed = true;
    
    // Extract durations from test results
    spec.tests.forEach(test => {
        if (test.results && test.results.length > 0) {
            test.results.forEach(result => {
                if (result.duration !== undefined) {
                    durations.push(result.duration);
                }
                if (result.status !== 'passed') {
                    allPassed = false;
                }
            });
        }
    });
    
    // If no duration data, skip this test
    if (durations.length === 0) {
        return;
    }
    
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    
    processedTests.push({
        title: spec.title,
        file: filePath,
        suite: suiteName,
        parentSuite: parentSuite,
        min: min,
        max: max,
        avg: avg,
        runs: durations.length,
        status: spec.ok !== false && allPassed ? 'passed' : 'failed'
    });
}

// Update summary statistics
function updateSummaryStats() {
    const total = processedTests.length;
    const passed = processedTests.filter(t => t.status === 'passed').length;
    const failed = total - passed;
    const totalDuration = reportData.stats?.duration || 0;
    
    document.getElementById('totalTests').textContent = total;
    document.getElementById('passedTests').textContent = passed;
    document.getElementById('failedTests').textContent = failed;
    document.getElementById('totalDuration').textContent = formatDuration(totalDuration);
}

// Render top test suites by average duration
function renderTopTests() {
    // Group tests by suite
    const suiteStats = {};
    
    processedTests.forEach(test => {
        const suiteKey = `${test.file}::${test.suite}`;
        
        if (!suiteStats[suiteKey]) {
            suiteStats[suiteKey] = {
                suite: test.suite,
                file: test.file,
                tests: [],
                allDurations: [],
                failedCount: 0
            };
        }
        
        suiteStats[suiteKey].tests.push(test);
        suiteStats[suiteKey].allDurations.push(test.min, test.max, test.avg);
        if (test.status === 'failed') {
            suiteStats[suiteKey].failedCount++;
        }
    });
    
    // Calculate aggregated stats for each suite
    const suiteArray = Object.values(suiteStats).map(suite => {
        const allAvgs = suite.tests.map(t => t.avg);
        const allMins = suite.tests.map(t => t.min);
        const allMaxs = suite.tests.map(t => t.max);
        const totalRuns = suite.tests.reduce((sum, t) => sum + t.runs, 0);
        
        return {
            suite: suite.suite,
            file: suite.file,
            min: Math.min(...allMins),
            max: Math.max(...allMaxs),
            avg: allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length,
            testCount: suite.tests.length,
            runs: totalRuns,
            status: suite.failedCount > 0 ? 'failed' : 'passed'
        };
    });
    
    // Sort by average duration and get top 10
    const topSuites = suiteArray
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 10);
    
    const tbody = document.getElementById('topTestsTableBody');
    tbody.innerHTML = '';
    
    topSuites.forEach((suite, index) => {
        const row = document.createElement('tr');
        row.className = suite.status === 'failed' ? 'table-danger' : '';
        
        row.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td>${escapeHtml(suite.suite)}</td>
            <td><small class="text-muted">${escapeHtml(suite.file)}</small></td>
            <td>${formatNumber(suite.min)}</td>
            <td>${formatNumber(suite.max)}</td>
            <td><strong>${formatNumber(suite.avg)}</strong></td>
            <td>${suite.testCount} tests (${suite.runs} runs)</td>
            <td>
                <span class="badge bg-${suite.status === 'passed' ? 'success' : 'danger'}">
                    ${suite.status}
                </span>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Render all tests grouped by file and suite
function renderAllTests() {
    const tbody = document.getElementById('allTestsTableBody');
    tbody.innerHTML = '';
    
    // Group tests by file
    const testsByFile = {};
    processedTests.forEach(test => {
        if (!testsByFile[test.file]) {
            testsByFile[test.file] = {};
        }
        if (!testsByFile[test.file][test.suite]) {
            testsByFile[test.file][test.suite] = [];
        }
        testsByFile[test.file][test.suite].push(test);
    });
    
    // Render grouped structure
    Object.keys(testsByFile).sort().forEach(file => {
        const fileId = 'file-' + generateId();
        const fileTests = testsByFile[file];
        const fileTestCount = Object.values(fileTests).flat().length;
        
        // File header row
        const fileRow = document.createElement('tr');
        fileRow.className = 'table-secondary file-header';
        fileRow.innerHTML = `
            <td>
                <button class="btn btn-sm btn-link text-dark" type="button" 
                        data-bs-toggle="collapse" data-bs-target="#${fileId}">
                    <i class="bi bi-chevron-down"></i>
                </button>
            </td>
            <td colspan="6">
                <strong><i class="bi bi-file-earmark-code"></i> ${escapeHtml(file)}</strong>
                <span class="badge bg-secondary ms-2">${fileTestCount} tests</span>
            </td>
        `;
        tbody.appendChild(fileRow);
        
        // Suite groups within this file
        Object.keys(fileTests).sort().forEach(suite => {
            const suiteId = 'suite-' + generateId();
            const suiteTests = fileTests[suite];
            
            // Suite header row
            const suiteRow = document.createElement('tr');
            suiteRow.className = 'collapse show suite-header';
            suiteRow.id = fileId;
            suiteRow.innerHTML = `
                <td></td>
                <td>
                    <button class="btn btn-sm btn-link text-dark ps-3" type="button" 
                            data-bs-toggle="collapse" data-bs-target="#${suiteId}">
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <strong><i class="bi bi-folder2-open"></i> ${escapeHtml(suite)}</strong>
                    <span class="badge bg-info ms-2">${suiteTests.length} tests</span>
                </td>
                <td colspan="5"></td>
            `;
            tbody.appendChild(suiteRow);
            
            // Test rows
            suiteTests.forEach(test => {
                const testRow = document.createElement('tr');
                testRow.className = `collapse show test-row ${test.status === 'failed' ? 'table-danger' : ''}`;
                testRow.id = suiteId;
                testRow.innerHTML = `
                    <td></td>
                    <td class="ps-5">${escapeHtml(test.title)}</td>
                    <td>${formatNumber(test.min)}</td>
                    <td>${formatNumber(test.max)}</td>
                    <td><strong>${formatNumber(test.avg)}</strong></td>
                    <td>${test.runs}</td>
                    <td>
                        <span class="badge bg-${test.status === 'passed' ? 'success' : 'danger'}">
                            ${test.status}
                        </span>
                    </td>
                `;
                tbody.appendChild(testRow);
            });
        });
    });
}

// Utility functions
function formatDuration(ms) {
    if (ms < 1000) {
        return ms.toFixed(0) + 'ms';
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return seconds.toFixed(2) + 's';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0);
    return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(num) {
    return num.toFixed(2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let idCounter = 0;
function generateId() {
    return 'id-' + (idCounter++);
}
