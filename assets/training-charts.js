// Load Chart.js data and render elegant interactive charts
(function() {
// Match the Odyssey-Mini and Odyssey-Mid benchmark colors.
const COLOR_8B = '#eb6935';  // Odyssey-Mini: orange
const COLOR_14B = '#3b8f2c';  // Odyssey-Mid: green

// User-identified 8B anomalies; preserve raw values in training_data.json.
const EMA_REPAIR_STEPS = {
    unknown: [0.4, 1.4, 7.2, 68.2, 70.0, 70.8],
    steps: [68, 70, 71],
    response_length: [70, 72, 73]
};
function repairWithHistoricalEMA(series, steps) {
    const affectedSteps = new Set(steps.map(s => Number(s.toFixed(1))));
    const alpha = 0.2;
    let ema = series.y[0];
    return {
        ...series,
        y: series.y.map((value, index) => {
            const xValue = Number(series.x[index].toFixed(1));
            if (affectedSteps.has(xValue)) return ema;
            ema = alpha * value + (1 - alpha) * ema;
            return value;
        })
    };
}

const chartConfigs = [
    {id: 'chart-reward', dataKey: 'reward', title: 'Episode Reward', yLabel: 'Average Reward'},
    {id: 'chart-env-done', dataKey: 'env_done', title: 'Completion Rate', yLabel: 'Completion Rate'},
    {id: 'chart-response', dataKey: 'response_length', title: 'Response Length', yLabel: '# Tokens of Trajectory'},
    {id: 'chart-steps', dataKey: 'steps', title: 'Trajectory Steps', yLabel: '# Steps of Trajectory'},
    {id: 'chart-search', dataKey: 'unique_search', title: 'Unique Search Calls', yLabel: '# Web Search of Trajectory'},
    {id: 'chart-unknown', dataKey: 'unknown', title: 'Malformed Action Rate', yLabel: 'Failure Rate'},
    {id: 'chart-grad-norm', dataKey: 'grad_norm', title: 'Gradient Norm', yLabel: 'Grad Norm'},
    {id: 'chart-policy-entropy', dataKey: 'policy_entropy', title: 'Policy Entropy', yLabel: 'Policy Entropy'}
];

// Detect base path from current location
const basePath = window.location.pathname.replace(/\/[^\/]*$/, '') || '';
fetch(basePath + '/assets/training_data.json')
    .then(res => res.json())
    .then(data => {
        chartConfigs.forEach(config => {
            const canvas = document.getElementById(config.id);
            if (!canvas) return;

            // Set high DPI rendering
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = (rect.width / 1.8) * dpr;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = (rect.width / 1.8) + 'px';

            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            const rawChartData = data[config.dataKey];
            const repairSteps = EMA_REPAIR_STEPS[config.dataKey];
            const chartData = repairSteps ? {...rawChartData, '8B': repairWithHistoricalEMA(rawChartData['8B'], repairSteps)} : rawChartData;

            // Responsive font sizes
            const isMobile = window.innerWidth <= 767;
            const isSmallMobile = window.innerWidth <= 480;
            const isTablet = window.innerWidth > 767 && window.innerWidth <= 1024;

            const titleFontSize = isSmallMobile ? 12 : (isMobile ? 14 : 16);
            const legendFontSize = isSmallMobile ? 9 : (isMobile ? 11 : 13);
            const axisTitleFontSize = isSmallMobile ? 9 : (isMobile ? 11 : 13);
            const axisTickFontSize = isSmallMobile ? 8 : (isMobile ? 10 : 11);
            const tooltipTitleFontSize = isSmallMobile ? 10 : (isMobile ? 12 : 13);
            const tooltipBodyFontSize = isSmallMobile ? 9 : (isMobile ? 11 : 12);

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartData['8B'].x,
                    datasets: [
                        {
                            label: 'Odyssey-8B',
                            data: chartData['8B'].y,
                            borderColor: COLOR_8B,
                            backgroundColor: COLOR_8B + '18',
                            borderWidth: isMobile ? 2 : 2.5,
                            pointRadius: 0,
                            pointHoverRadius: isMobile ? 4 : 5,
                            pointHoverBorderWidth: isMobile ? 2 : 2.5,
                            pointHoverBackgroundColor: '#ffffff',
                            pointHoverBorderColor: COLOR_8B,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'Odyssey-14B',
                            data: chartData['14B'].y,
                            borderColor: COLOR_14B,
                            backgroundColor: COLOR_14B + '18',
                            borderWidth: isMobile ? 2 : 2.5,
                            pointRadius: 0,
                            pointHoverRadius: isMobile ? 4 : 5,
                            pointHoverBorderWidth: isMobile ? 2 : 2.5,
                            pointHoverBackgroundColor: '#ffffff',
                            pointHoverBorderColor: COLOR_14B,
                            tension: 0.3,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    aspectRatio: isMobile ? 1.5 : 1.8,
                    devicePixelRatio: dpr,
                    interaction: {mode: 'index', intersect: false},
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle',
                                padding: isMobile ? 10 : 14,
                                boxWidth: isMobile ? 8 : 10,
                                boxHeight: isMobile ? 8 : 10,
                                font: {size: legendFontSize, family: '\'Inter\', -apple-system, system-ui, sans-serif', weight: '500'},
                                color: '#475569'
                            }
                        },
                        title: {
                            display: true,
                            text: config.title,
                            align: 'start',
                            color: '#0f172a',
                            font: {size: titleFontSize, family: '\'Inter\', -apple-system, system-ui, sans-serif', weight: '600'},
                            padding: {top: isMobile ? 4 : 6, bottom: isMobile ? 14 : 22}
                        },
                        tooltip: {
                            enabled: !isMobile || window.innerWidth > 480,
                            backgroundColor: 'rgba(50, 50, 48, 0.95)',
                            padding: isMobile ? 8 : 12,
                            cornerRadius: 6,
                            titleFont: {size: tooltipTitleFontSize, family: '\'Inter\', -apple-system, system-ui, sans-serif', weight: '600'},
                            bodyFont: {size: tooltipBodyFontSize, family: '\'SF Mono\', \'Monaco\', monospace'},
                            bodySpacing: isMobile ? 3 : 5,
                            displayColors: true,
                            boxWidth: isMobile ? 8 : 10,
                            boxHeight: isMobile ? 8 : 10,
                            boxPadding: isMobile ? 3 : 5,
                            callbacks: {
                                title: function(context) {
                                    return 'Step ' + context[0].label;
                                },
                                label: function(context) {
                                    const label = context.dataset.label.replace('Odyssey-', '');
                                    return label + ': ' + context.parsed.y.toFixed(4);
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Training Step',
                                color: '#64748b',
                                font: {size: axisTitleFontSize, family: '\'Inter\', -apple-system, system-ui, sans-serif', weight: '500'},
                                padding: {top: isMobile ? 6 : 10}
                            },
                            min: 0,
                            max: 200,
                            grid: {display: true, color: 'rgba(95, 94, 90, 0.08)', lineWidth: 1},
                            ticks: {
                                color: '#94a3b8',
                                font: {size: axisTickFontSize, family: '\'SF Mono\', \'Monaco\', monospace'},
                                stepSize: 50,
                                autoSkip: false,
                                includeBounds: true,
                                callback: function(value) {
                                    if (value === 0 || value === 50 || value === 100 || value === 150 || value === 200) {
                                        return value;
                                    }
                                    return '';
                                }
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: config.yLabel,
                                color: '#64748b',
                                font: {size: axisTitleFontSize, family: '\'Inter\', -apple-system, system-ui, sans-serif', weight: '500'},
                                padding: {bottom: isMobile ? 6 : 10}
                            },
                            grid: {display: true, color: 'rgba(95, 94, 90, 0.08)', lineWidth: 1},
                            ticks: {
                                color: '#94a3b8',
                                font: {size: axisTickFontSize, family: '\'SF Mono\', \'Monaco\', monospace'},
                                maxTicksLimit: isMobile ? 5 : 6,
                                callback: function(value) {
                                    return value.toFixed(2);
                                }
                            }
                        }
                    }
                }
            });
        });
    })
    .catch(err => console.error('Failed to load training data:', err));
})();
