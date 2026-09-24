(() => {
  const navigation = document.querySelector('.toc');
  if (!navigation) return;

  const links = [...navigation.querySelectorAll('[data-toc-link]')];
  const entries = links.map((link) => ({
    link,
    heading: document.getElementById(decodeURIComponent(link.hash.slice(1)))
  })).filter((entry) => entry.heading);
  if (!entries.length) return;

  const activate = (heading) => {
    entries.forEach((entry) => entry.link.classList.toggle('active', entry.heading === heading));
  };

  const observer = new IntersectionObserver((observed) => {
    const visible = observed.filter((entry) => entry.isIntersecting)
      .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    if (visible.length) activate(visible[0].target);
  }, { rootMargin: '-12% 0px -72% 0px', threshold: [0, 1] });

  entries.forEach((entry) => observer.observe(entry.heading));
  activate(entries[0].heading);
})();
