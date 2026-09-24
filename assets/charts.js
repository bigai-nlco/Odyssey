(() => {
  if (!window.Chart) return;

  document.querySelectorAll('canvas[data-chart-config]').forEach((canvas) => {
    try {
      const config = JSON.parse(atob(canvas.dataset.chartConfig));
      canvas.setAttribute('aria-label', config.options?.plugins?.title?.text || 'Chart');
      new window.Chart(canvas, config);
    } catch (error) {
      canvas.insertAdjacentText('afterend', 'Unable to render chart.');
      console.error('NLCo chart error:', error);
    }
  });
})();
