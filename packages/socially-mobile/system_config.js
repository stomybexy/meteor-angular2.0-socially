System.config({
  packages: {
    'socially': {
      main: 'main',
      format: 'register',
      map: {
        '.': System.normalizeSync('{socially-mobile}')
      }
    }
  }
});
